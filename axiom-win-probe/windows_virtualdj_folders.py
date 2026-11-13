"""VirtualDJ playlist FOLDERS for PEAK HOUR: preview / apply / undo of a list inside one or more folders.

Two layouts, both as VirtualDJ 2025 writes them on the owner's PC (see investigation.md, 2026-11-13):
  m3u      Playlists\\Parent\\Child\\List.m3u            (shown by VirtualDJ as "M3U Playlists"; a folder is a directory)
  mylists  MyLists\\Parent.subfolders\\List.vdjfolder    plus the top-level name appended to MyLists\\order

Rules: the route needs confirm:true to write at all, and never overwrites a list unless replace:true is also passed (then the old file is copied to <root>\\<id>\\ first and restored
by undo); every write is temp file + fsync + read-back + link/replace; a write that only ADDS new files may run while
VirtualDJ is open only when LIVE_ADD_ALLOWED is True (owner's live test not done yet, so False); anything that replaces
an existing file, including adding a line to an existing MyLists\\order, needs VirtualDJ closed ('virtualdj_open').
Queue payload / digest payload: {"path": ["Parent", "List"], "tracks": [absolute paths], "style": "m3u" | "mylists", "replace": true (optional)}.
"""
import hashlib
import threading
import json
import ntpath
import os
import re
import shutil
import stat
import tempfile
import time
import uuid
from pathlib import Path

from windows_virtualdj_lists import (MAX_TRACKS, VirtualDJListError, database_paths, ensure_virtualdj_closed,
                                     format_vdjfolder, list_name, song_entry, virtualdj_home)

LIVE_ADD_ALLOWED = False  # flip to True only after VirtualDJ is proven to pick up new files while it is open
STYLES = ('m3u', 'mylists')
DEFAULT_STYLE = 'm3u'
MAX_DEPTH = 8
BOM = b'\xef\xbb\xbf'
BACKUP_DIR_NAME = 'virtualdj-list-writes'
_WRITE_LOCK = threading.RLock()
_ID = re.compile(r'^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$')


class FolderError(VirtualDJListError):
    def __init__(self, message, code='error'):
        super().__init__(message)
        self.code = code


# ------------------------------------------------------------------ formats

def _text(value):
    return str(value).replace('\r', ' ').replace('\n', ' ')


def format_m3u(entries):
    """Bytes of a VirtualDJ .m3u: BOM, then per song an #EXTVDJ line and the Windows path, CRLF; no entries = BOM only."""
    lines = []
    for entry in entries:
        if not entry.get('path'):
            raise VirtualDJListError('A song has no path')
        tags = ''.join('<%s>%s</%s>' % (k, _text(entry[k]), k)
                       for k in ('filesize', 'artist', 'title', 'remix', 'songlength') if entry.get(k) not in (None, ''))
        lines.append('#EXTVDJ:' + tags)
        lines.append(_text(entry['path']))
    return BOM + ''.join(line + '\r\n' for line in lines).encode('utf-8')


def _order_has(data, name):
    return any(line.strip().casefold() == name.casefold() for line in data.decode('utf-8', 'replace').lstrip('﻿').splitlines())


def _order_append(data, name):
    eol = b'\n' if (b'\n' in data and b'\r\n' not in data) else b'\r\n'
    if data and not data.endswith(b'\n'):
        data += eol
    return data + name.encode('utf-8') + eol


def _order_remove(data, name):
    """Drop the last line equal to name, leaving every other byte as it was."""
    lines = data.splitlines(keepends=True)
    for index in range(len(lines) - 1, -1, -1):
        if lines[index].decode('utf-8', 'replace').strip().casefold() == name.casefold():
            del lines[index]
            break
    return b''.join(lines)


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _is_reparse(path):
    info = os.lstat(path)
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, 'st_file_attributes', 0) & 0x400)


# ------------------------------------------------------------------ planning (read-only)

def _parts(path):
    if not isinstance(path, (list, tuple)) or not 1 <= len(path) <= MAX_DEPTH:
        raise FolderError('Give the list as a folder path such as ["Parent", "List"]', 'bad_request')
    parts = []
    for part in path:
        if not isinstance(part, str):
            raise FolderError('Folder and list names must be text', 'bad_request')
        parts.append(list_name(part))
    return parts


def _lookup(databases):
    found = {}
    for db in databases or ():
        for track in db.get('tracks', ()):
            if track.get('path_kind') == 'windows_absolute':
                found.setdefault(ntpath.normcase(ntpath.normpath(track['path'])), []).append(track)
    return found


def _databases(home, tracks):
    from windows_virtualdj_database import read_database
    result = []
    for db in database_paths(Path(home), tracks):
        try:
            result.append(read_database(db))
        except Exception:  # metadata is optional; path and size are enough
            pass
    return result


def _track_strings(payload):
    tracks = payload.get('tracks') if isinstance(payload, dict) else None
    return [t for t in tracks if isinstance(t, str)] if isinstance(tracks, (list, tuple)) else []


def _plan(payload, home, databases=None):
    if not isinstance(payload, dict):
        raise FolderError('Invalid request', 'bad_request')
    style = payload.get('style') or DEFAULT_STYLE
    if style not in STYLES:
        raise FolderError('Style must be "m3u" or "mylists"', 'bad_request')
    parts = _parts(payload.get('path'))
    tracks = payload.get('tracks')
    if not isinstance(tracks, (list, tuple)) or not tracks or len(tracks) > MAX_TRACKS:
        raise FolderError('Provide a nonempty, bounded track list', 'bad_request')
    home = Path(home)
    base = home / ('Playlists' if style == 'm3u' else 'MyLists')
    if not base.is_absolute() or not base.is_dir() or _is_reparse(base):
        raise FolderError('VirtualDJ %s folder not found: %s' % (base.name, base), 'no_library')
    folders, name = parts[:-1], parts[-1]
    suffix = '' if style == 'm3u' else '.subfolders'
    chain, current = [], base
    for part in folders:
        current = current / (part + suffix)
        chain.append(current)
    directory = chain[-1] if chain else base
    target = directory / (name + ('.m3u' if style == 'm3u' else '.vdjfolder'))
    missing = []
    for folder in chain:
        if os.path.lexists(folder):
            if not folder.is_dir() or _is_reparse(folder):
                raise FolderError('A file or link is in the way of the folder: ' + folder.name, 'blocked')
        else:
            missing.append(folder)
    exists = os.path.lexists(target)
    if exists and (not target.is_file() or _is_reparse(target)):
        raise FolderError('Something other than a list is at the target name', 'blocked')

    lookup, entries, identities, skipped = _lookup(databases), [], [], []
    for value in tracks:
        if not isinstance(value, str):
            raise FolderError('Track paths must be text', 'bad_request')
        path = Path(value)
        if not path.is_absolute():
            raise FolderError('Track paths must be absolute', 'bad_request')
        try:
            info = os.stat(path, follow_symlinks=False)
        except (FileNotFoundError, NotADirectoryError):  # moved or deleted while the write waited
            skipped.append({'path': str(path), 'reason': 'The file is missing'})
            continue
        if not stat.S_ISREG(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise FolderError('Track must be a regular non-reparse file', 'bad_request')
        identities.append((str(path), info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns))
        matches = lookup.get(ntpath.normcase(ntpath.normpath(str(path))), [])
        match = matches[0] if len(matches) == 1 else None
        entry = song_entry(path, match)
        entry['size'] = str(info.st_size)
        if style == 'm3u':
            duration = (match or {}).get('duration_sec')
            entry['filesize'] = entry.pop('size')
            entry['songlength'] = '%.3f' % duration if duration else ''
        entries.append(entry)
    if not entries:
        raise FolderError('None of the songs could be found, so nothing was written. Missing: ' +
                          ', '.join(ntpath.basename(item['path']) for item in skipped[:5]) + ('...' if len(skipped) > 5 else ''), 'no_tracks')
    data = format_m3u(entries) if style == 'm3u' else format_vdjfolder(entries)

    order = None
    if style == 'mylists':
        order_path = base / 'order'
        existing = None
        if os.path.lexists(order_path):
            if not order_path.is_file() or _is_reparse(order_path):
                raise FolderError('MyLists order is not a regular file', 'blocked')
            existing = order_path.read_bytes()
        if existing is None or not _order_has(existing, parts[0]):
            order = {'path': order_path, 'name': parts[0], 'existing': existing,
                     'new': _order_append(existing or b'', parts[0])}
    # stale only if the target itself changed: the list file (or its absence) and the folders to create.
    # Songs, their sizes and MyLists\order are read again when the write runs.
    digest = _sha(json.dumps([style, str(target), exists, _sha(target.read_bytes()) if exists else None,
                              [str(m) for m in missing]]).encode('utf-8'))
    return {'style': style, 'parts': parts, 'base': base, 'target': target, 'missing': missing, 'exists': exists,
            'data': data, 'order': order, 'identities': identities, 'entries': entries, 'digest': digest, 'skipped': skipped,
            'new_only': not exists and not (order and order['existing'] is not None)}


# ------------------------------------------------------------------ file writes

def _stage(directory, data):
    fd, name = tempfile.mkstemp(prefix='.peakhour-vdj-', suffix='.tmp', dir=directory)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if Path(name).read_bytes() != data:
            raise VirtualDJListError('List verification failed')
    except BaseException:
        Path(name).unlink(missing_ok=True)
        raise
    return Path(name)


def _write_new(target, data):
    stage = _stage(target.parent, data)
    try:
        os.link(stage, target)  # fails if the name appeared meanwhile: never overwrites
    finally:
        stage.unlink(missing_ok=True)


def _write_replace(target, data):
    stage = _stage(target.parent, data)
    try:
        os.replace(stage, target)
    finally:
        stage.unlink(missing_ok=True)


def _require_closed(new_only, ensure_closed):
    if new_only and LIVE_ADD_ALLOWED:
        return
    try:
        (ensure_closed or ensure_virtualdj_closed)()
    except VirtualDJListError as exc:
        raise FolderError(str(exc) or 'Quit VirtualDJ, then try again.', 'virtualdj_open') from exc


def _root(root):
    if root is not None:
        return Path(root)
    return Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local', 'AXIOM DJ', BACKUP_DIR_NAME)


def _home(home):
    return Path(home() if callable(home) else home) if home else virtualdj_home()


def _receipt_path(root, backup_id):
    if not isinstance(backup_id, str) or not _ID.match(backup_id):
        raise FolderError('Unknown undo id', 'bad_request')
    return Path(root) / backup_id / 'receipt.json'


def _save_receipt(root, receipt):
    path = _receipt_path(root, receipt['id'])
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name('receipt.json.tmp')
    with open(temp, 'w', encoding='utf-8') as handle:
        json.dump(receipt, handle, indent=1)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def _backup(root, receipt, source, label):
    folder = _receipt_path(root, receipt['id']).parent
    folder.mkdir(parents=True, exist_ok=True)
    copy = folder / ('%s.bak' % label)
    shutil.copy2(source, copy)
    return str(copy)


# ------------------------------------------------------------------ public API

def preview(payload, home=None, root=None, ensure_closed=None, databases=None):
    """What apply would do. Writes nothing."""
    home = _home(home)
    plan = _plan(payload, home, _databases(home, _track_strings(payload)) if databases is None else databases)
    try:
        (ensure_closed or ensure_virtualdj_closed)()
        running = False
    except Exception:
        running = True
    return {'success': True, 'style': plan['style'], 'list_path': str(plan['target']), 'list_exists': plan['exists'],
            'needs_confirm': plan['exists'], 'folders_to_create': [str(m) for m in plan['missing']],
            'order_change': bool(plan['order']), 'tracks': len(plan['entries']),
            'with_metadata': sum(1 for e in plan['entries'] if e.get('title')), 'bytes': len(plan['data']),
            'skipped': plan['skipped'], 'new_files_only': plan['new_only'], 'virtualdj_open': running, 'live_add_allowed': LIVE_ADD_ALLOWED,
            'digest': plan['digest']}


def digest(payload, home=None, databases=None):
    """Stable fingerprint of what apply would write now (for the DJ write queue's stale check)."""
    home = _home(home)
    return _plan(payload, home, _databases(home, _track_strings(payload)) if databases is None else databases)['digest']


def apply(payload, home=None, root=None, ensure_closed=None, databases=None, replace=False):
    with _WRITE_LOCK:  # one write at a time: MyLists\order is read, changed and written back
        return _apply(payload, home, root, ensure_closed, databases, replace)


def _apply(payload, home, root, ensure_closed, databases, replace):
    """Write the list. An existing list with the same name is replaced only when replace is True (or payload['replace'])."""
    home = _home(home)
    root = _root(root)
    replace = bool(replace) or (isinstance(payload, dict) and payload.get('replace') is True)
    plan = _plan(payload, home, _databases(home, _track_strings(payload)) if databases is None else databases)
    if plan['exists'] and not replace:
        raise FolderError('A VirtualDJ list with this name already exists. Nothing was overwritten.', 'exists')
    _require_closed(plan['new_only'], ensure_closed)
    backup_id = '%s-%s' % (time.strftime('%Y%m%d-%H%M%S'), uuid.uuid4().hex[:8])
    receipt = {'id': backup_id, 'created_at': time.time(), 'style': plan['style'], 'path': plan['parts'],
               'list_path': str(plan['target']), 'created_files': [], 'created_dirs': [], 'replaced': [],
               'order': None, 'undone': False}
    try:
        for folder in plan['missing']:
            folder.mkdir()
            receipt['created_dirs'].append(str(folder))
        for path, dev, ino, size, mtime in plan['identities']:  # a track must not have changed while preparing
            now = os.stat(path, follow_symlinks=False)
            if (now.st_dev, now.st_ino, now.st_size, now.st_mtime_ns) != (dev, ino, size, mtime):
                raise VirtualDJListError('A track changed during preparation')
        _require_closed(plan['new_only'], ensure_closed)
        target = plan['target']
        if plan['exists']:
            entry = {'path': str(target), 'backup': _backup(root, receipt, target, 'list'), 'sha256_after': _sha(plan['data'])}
            receipt['replaced'].append(entry)
            _save_receipt(root, receipt)
            _write_replace(target, plan['data'])
        else:
            _write_new(target, plan['data'])
            receipt['created_files'].append({'path': str(target), 'sha256': _sha(plan['data'])})
        order = plan['order']
        if order:
            record = {'path': str(order['path']), 'name': order['name'], 'sha256_after': _sha(order['new']),
                      'kind': 'create' if order['existing'] is None else 'append', 'backup': None}
            current = order['path'].read_bytes() if os.path.lexists(order['path']) else None
            if current != order['existing']:  # someone changed it since the plan: never write a stale copy of it
                raise FolderError('MyLists order changed while PEAK HOUR was writing. Nothing was kept; try again.', 'changed')
            if order['existing'] is None:
                _write_new(order['path'], order['new'])
            else:
                record['backup'] = _backup(root, receipt, order['path'], 'order')
                receipt['order'] = record
                _save_receipt(root, receipt)
                _write_replace(order['path'], order['new'])
            receipt['order'] = record
        _save_receipt(root, receipt)
    except FileExistsError as exc:
        _revert(receipt, root)
        raise FolderError('A VirtualDJ list with this name already exists. Nothing was overwritten.', 'exists') from exc
    except BaseException:
        _revert(receipt, root)
        raise
    return {'success': True, 'backup_id': backup_id, 'list_path': str(target), 'tracks': len(plan['entries']),
            'with_metadata': sum(1 for e in plan['entries'] if e.get('title')), 'replaced': bool(plan['exists']),
            'skipped': plan['skipped'], 'folders_created': receipt['created_dirs'], 'order_updated': bool(order),
            'message': 'Wrote VirtualDJ list %s.' % target.name}


def _revert(receipt, root):
    """Undo what a receipt recorded; only touches files that still hold exactly what PEAK HOUR wrote."""
    restored, removed, skipped = [], [], []
    order = receipt.get('order')
    if order:
        path = Path(order['path'])
        try:
            current = path.read_bytes()
            if _sha(current) == order['sha256_after']:
                if order['kind'] == 'create':
                    path.unlink()
                    removed.append(str(path))
                else:
                    _write_replace(path, Path(order['backup']).read_bytes())
                    restored.append(str(path))
            elif _order_has(current, order['name']):  # edited since: take out only our line
                _write_replace(path, _order_remove(current, order['name']))
                restored.append(str(path))
        except FileNotFoundError:
            skipped.append(str(path))
    for item in receipt.get('replaced', ()):
        path = Path(item['path'])
        try:
            if _sha(path.read_bytes()) == item['sha256_after']:
                _write_replace(path, Path(item['backup']).read_bytes())
                restored.append(str(path))
            else:
                skipped.append(str(path))
        except FileNotFoundError:
            skipped.append(str(path))
    for item in receipt.get('created_files', ()):
        path = Path(item['path'])
        try:
            if _sha(path.read_bytes()) == item['sha256']:
                path.unlink()
                removed.append(str(path))
            else:
                skipped.append(str(path))
        except FileNotFoundError:
            pass
    for folder in reversed(receipt.get('created_dirs', ())):
        try:
            Path(folder).rmdir()  # only if empty
            removed.append(folder)
        except OSError:
            skipped.append(folder)
    return {'restored': restored, 'removed': removed, 'skipped': skipped}


def undo(backup_id, root=None, ensure_closed=None):
    """Delete what apply created and restore what it replaced. Needs VirtualDJ closed."""
    root = _root(root)
    path = _receipt_path(root, backup_id)
    if not path.is_file():
        raise FolderError('Nothing to undo for this id', 'not_found')
    receipt = json.loads(path.read_text(encoding='utf-8'))
    if receipt.get('undone'):
        raise FolderError('This write was already undone', 'bad_request')
    _require_closed(False, ensure_closed)
    result = _revert(receipt, root)
    receipt['undone'] = True
    _save_receipt(root, receipt)
    return dict(success=True, backup_id=backup_id, **result)


def register_with_queue(queue, root=None, home=None, ensure_closed=None):
    """Register the writer with the DJ write queue as program 'virtualdj', kind 'list_folder'."""
    def apply_job(payload):
        return apply(payload, home=home, root=root, ensure_closed=ensure_closed)

    def preview_job(payload):
        return digest(payload, home=home)
    queue.register('virtualdj', 'list_folder', apply_job, preview_job)


# ------------------------------------------------------------------ routes

def create_blueprint(allowed_path, license_guard=None, root=None, home=None, ensure_closed=None):
    from flask import Blueprint, jsonify, request
    bp = Blueprint('windows_virtualdj_folders', __name__)

    @bp.before_request
    def local_only():
        if request.remote_addr not in ('127.0.0.1', '::1'):
            return jsonify(success=False, error='Writing to VirtualDJ requires this PC'), 403
        origin = request.headers.get('Origin')
        if request.method != 'GET' and (not origin or origin.rstrip('/') != request.host_url.rstrip('/')):
            return jsonify(success=False, error='Writing to VirtualDJ requires a same-origin request'), 403

    def body():
        if request.content_length is not None and request.content_length > 4 * 1024 * 1024:
            raise FolderError('Request is too large', 'bad_request')
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            raise FolderError('Invalid request', 'bad_request')
        return data

    def checked(data):
        payload = {'path': data.get('path'), 'tracks': data.get('tracks'), 'style': data.get('style') or DEFAULT_STYLE}
        if not isinstance(payload['tracks'], list):
            raise FolderError('Provide the track paths', 'bad_request')
        for value in payload['tracks']:
            if not isinstance(value, str) or not Path(value).is_absolute():
                raise FolderError('Track paths must be absolute', 'bad_request')
            path = Path(value)
            if path.is_symlink() or not path.is_file() or not allowed_path(path.resolve(strict=True)):
                raise FolderError('A track is not permitted: ' + path.name, 'bad_request')
        return payload

    def respond(action):
        gate = license_guard('VirtualDJ list export') if license_guard else None
        if gate:
            return gate
        try:
            result = action()
            if isinstance(result, tuple):  # (body, status): queued until VirtualDJ closes
                return jsonify(result[0]), result[1]
            return jsonify(result)
        except FolderError as exc:
            return jsonify(success=False, error=str(exc), code=exc.code), (409 if exc.code in ('virtualdj_open', 'exists') else 400)
        except (OSError, ValueError, VirtualDJListError) as exc:
            return jsonify(success=False, error=str(exc), code='error'), 400

    @bp.post('/api/windows/virtualdj/folders/preview')
    def preview_route():
        return respond(lambda: preview(checked(body()), home=home, root=root, ensure_closed=ensure_closed))

    @bp.post('/api/windows/virtualdj/folders/apply')
    def apply_route():
        def action():
            data = body()
            if data.get('confirm') is not True:
                raise FolderError('Confirm before writing to VirtualDJ', 'bad_request')
            payload = checked(data)
            payload['replace'] = data.get('replace') is True  # "send" never implies "replace an existing list"
            if not payload['replace'] and preview(payload, home=home, root=root, ensure_closed=ensure_closed)['list_exists']:
                raise FolderError('A VirtualDJ list with this name already exists. Nothing was overwritten.', 'exists')
            from windows_dj_write_queue import queue_if_open
            direct = lambda: apply(payload, home=home, root=root, ensure_closed=ensure_closed)
            return queue_if_open('virtualdj', 'list_folder', payload, 'VirtualDJ', direct) or direct()
        return respond(action)

    @bp.post('/api/windows/virtualdj/folders/undo')
    def undo_route():
        def locked_undo():
            from windows_dj_write_queue import program_locked
            with program_locked('virtualdj'):
                return undo(body().get('backup_id'), root=root, ensure_closed=ensure_closed)
        return respond(locked_undo)

    return bp
