"""Keep VirtualDJ's record of a song's file size in step when another program changes the file.

VirtualDJ's database.xml stores the size of every song file (<Song FilePath="..." FileSize="...">) and keys a song by
path plus size. When PEAK HOUR writes Serato cue points into a song that had no room in its tag, the file gets a little
bigger; without this VirtualDJ may treat the song as a different or changed file. Payload for the queue job
program 'virtualdj', kind 'filesize_sync':

    {"songs": [{"path": "D:\\\\Music\\\\a.mp3", "old_size": 5000000, "new_size": 5002100}]}

Only the digits of the FileSize attribute of a matching <Song> are replaced, and only if its current FileSize equals
old_size (anything else is skipped and reported). Every other byte of database.xml stays as VirtualDJ wrote it.
VirtualDJ must be closed (the write queue waits for that). Each write keeps a backup of the database it changed and a
receipt, re-reads the result and can be undone (until VirtualDJ changes the file again).

PEAK HOUR's own VirtualDJ lists (.m3u #EXTVDJ <filesize>, .vdjfolder size="...") also carry a size; VirtualDJ treats those
as hints, so they are not rewritten.
"""
import hashlib
import json
import ntpath
import os
import re
import threading
import time
import uuid
from pathlib import Path

KIND = 'filesize_sync'
_SONG_TAG = re.compile(r'<Song\b(?:[^>"]|"[^"]*")*?>', re.S)  # a song's opening tag (it holds FilePath and FileSize)
_FILE_PATH = re.compile(r'\sFilePath="([^"]*)"')
_FILE_SIZE = re.compile(r'(\sFileSize=")(\d+)(")')
_LOCK = threading.Lock()
_state = {'root': None, 'databases': None, 'ensure_closed': None}


class VirtualDJSizeError(RuntimeError):
    """code: 'virtualdj_open', 'bad_request', 'changed', 'verify_failed', 'write_failed'."""

    def __init__(self, message, code='error'):
        super().__init__(message)
        self.code = code


def configure(root=None, databases=None, ensure_closed=None):
    """Tests may replace the receipts folder, the list of database.xml files and the "VirtualDJ is closed" check."""
    for name, value in (('root', root), ('databases', databases), ('ensure_closed', ensure_closed)):
        if value is not None:
            _state[name] = value


def _root():
    if _state['root'] is not None:
        return Path(_state['root'])
    return Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local') / 'AXIOM DJ' / 'virtualdj-size-writes'


def _databases():
    if _state['databases'] is not None:
        return [Path(p) for p in _state['databases']()]
    from windows_virtualdj_library import database_paths
    return [Path(p) for p in database_paths()]


def _ensure_closed():
    check = _state['ensure_closed']
    if check is None:
        from windows_virtualdj_lists import ensure_virtualdj_closed as check
    try:
        check()
    except Exception as exc:
        raise VirtualDJSizeError(str(exc) or 'Quit VirtualDJ, then try again.', 'virtualdj_open') from exc


def _key(path):
    return ntpath.normcase(ntpath.normpath(str(path)))


def _sha(data):
    return hashlib.sha256(data).hexdigest()


_ENTITY = re.compile(r'&(#x[0-9A-Fa-f]+|#[0-9]+|amp|lt|gt|quot|apos);')
_NAMED = {'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'"}


def _plain(value):
    """An attribute value as text: the five named XML entities and numeric ones (&#39; &#x27; ...), in one pass."""
    def replace(match):
        name = match.group(1)
        if name[0] != '#':
            return _NAMED[name]
        try:
            return chr(int(name[2:], 16) if name[1] in 'xX' else int(name[1:]))
        except (ValueError, OverflowError):
            return match.group(0)
    return _ENTITY.sub(replace, value)


def _wanted(payload):
    songs = payload.get('songs') if isinstance(payload, dict) else None
    if not isinstance(songs, list) or not songs:
        raise VirtualDJSizeError('Send a list of songs with path, old_size and new_size.', 'bad_request')
    wanted = {}
    for song in songs:
        try:
            path, old, new = song['path'], song['old_size'], song['new_size']
        except (TypeError, KeyError):
            raise VirtualDJSizeError('Every song needs a path, old_size and new_size.', 'bad_request') from None
        if not isinstance(path, str) or not path or any(isinstance(n, bool) or not isinstance(n, int) or n < 0 for n in (old, new)):
            raise VirtualDJSizeError('Every song needs a path and whole-number sizes.', 'bad_request')
        wanted[_key(path)] = {'path': path, 'old_size': old, 'new_size': new}
    return wanted


def _song_tags(text):
    """Every <Song ...> opening tag of the text (found with str.find, which is much faster than one big regex scan)."""
    position = text.find('<Song')
    while position >= 0:
        match = _SONG_TAG.match(text, position)
        if match:
            yield match
        position = text.find('<Song', position + 5)


def _plan_database(text, wanted):
    """([(start, end, new digits, tag start, tag end)], {key: reason or None}) for one database's text."""
    edits, seen = [], {}
    for match in _song_tags(text):
        tag = match.group(0)
        path = _FILE_PATH.search(tag)
        if not path:
            continue
        key = _key(_plain(path.group(1)))
        song = wanted.get(key)
        if song is None:
            continue
        size = _FILE_SIZE.search(tag)
        if size is None:
            seen[key] = 'VirtualDJ has no file size recorded for this song'
        elif int(size.group(2)) != song['old_size']:
            seen[key] = f"VirtualDJ's record says {int(size.group(2)):,} bytes, not {song['old_size']:,}; left alone"
        else:
            start = match.start() + size.start(2)
            edits.append((start, match.start() + size.end(2), str(song['new_size']), match.start(), match.end()))
            seen[key] = None
    return edits, seen


def _apply_edits(text, edits):
    out, cursor = [], 0
    for start, end, digits, *_tag in sorted(edits):
        out.append(text[cursor:start])
        out.append(digits)
        cursor = end
    out.append(text[cursor:])
    return ''.join(out)


def _plan(payload):
    wanted = _wanted(payload)
    plans, reasons, unreadable = [], {}, []
    for database in _databases():
        try:
            data = Path(database).read_bytes()
            text = data.decode('utf-8')
        except (OSError, UnicodeDecodeError) as exc:
            unreadable.append({'database': str(database), 'reason': 'not UTF-8 text' if isinstance(exc, UnicodeDecodeError) else str(exc)})
            continue
        edits, seen = _plan_database(text, wanted)
        for key, reason in seen.items():
            if reasons.get(key, 'x') is not None:
                reasons[key] = reason
        if edits:
            plans.append({'database': str(database), 'before': data, 'text': text, 'edits': edits,
                          'after': _apply_edits(text, edits).encode('utf-8')})
    skipped = [{'path': song['path'], 'reason': reasons.get(key) or "not in VirtualDJ's database"}
               for key, song in wanted.items() if reasons.get(key, 'x') is not None]
    return {'plans': plans, 'skipped': skipped, 'songs': len(wanted), 'databases_skipped': unreadable}


def digest(payload=None):
    """Stable hash of the request alone: each song is re-checked against VirtualDJ's current record when it is written."""
    wanted = _wanted(payload)
    return _sha(json.dumps(sorted(wanted.values(), key=lambda s: _key(s['path'])), sort_keys=True).encode())


def preview(payload=None):
    plan = _plan(payload)
    return {'success': True, 'databases': [{'path': p['database'], 'songs': len(p['edits'])} for p in plan['plans']],
            'skipped': plan['skipped'], 'databases_skipped': plan['databases_skipped'], 'songs': plan['songs'],
            'digest': digest(payload)}


def _replace(target, data):
    from windows_virtualdj_write import _replace as replace
    replace(Path(target), data)


def _fsync(path):
    with open(path, 'rb+') as handle:
        os.fsync(handle.fileno())


def _verify(plan):
    """The new text is the old one with only the planned digits swapped: its length is off by exactly the digit-length changes,
    the number of <Song> tags is the same, and each edited opening tag is the old one except for its FileSize digits and still
    parses. (Everything between edits is copied from the old text by slicing, never rebuilt, so this stays cheap on a 60 MB file.)"""
    from windows_virtualdj_write import SafeET
    old, new = plan['text'], plan['after'].decode('utf-8')
    delta = sum(len(digits) - (end - start) for start, end, digits, *_tag in plan['edits'])
    if len(new) != len(old) + delta or new.count('<Song') != old.count('<Song'):
        raise VirtualDJSizeError('The new database differs from the old one in more than the file sizes.', 'verify_failed')
    shift = 0
    for start, end, digits, tag_start, tag_end in sorted(plan['edits']):
        old_tag = old[tag_start:tag_end]
        new_tag = new[tag_start + shift:tag_end + shift + len(digits) - (end - start)]
        offset = start - tag_start
        if new_tag[:offset] + old[start:end] + new_tag[offset + len(digits):] != old_tag or new_tag[:5] != '<Song':
            raise VirtualDJSizeError('A song entry changed in more than its file size.', 'verify_failed')
        try:
            SafeET.fromstring(new_tag if new_tag.endswith('/>') else new_tag + '</Song>')
        except Exception as exc:
            raise VirtualDJSizeError('A changed song entry no longer parses.', 'verify_failed') from exc
        shift += len(digits) - (end - start)


def _save(folder, receipt):
    stage = folder / 'receipt.json.tmp'
    with open(stage, 'w', encoding='utf-8') as handle:
        handle.write(json.dumps(receipt, indent=1))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(stage, folder / 'receipt.json')


def apply(payload=None):
    """Change FileSize in VirtualDJ's database(s) for the songs whose current record equals old_size."""
    with _LOCK:
        _ensure_closed()
        plan = _plan(payload)
        if not plan['plans']:
            return {'success': True, 'written': 0, 'skipped': plan['skipped'], 'receipt': '',
                    'databases_skipped': plan['databases_skipped'], 'message': "VirtualDJ's file sizes needed no change."}
        for item in plan['plans']:
            _verify(item)
        identifier = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
        folder = _root() / identifier
        folder.mkdir(parents=True)
        receipt = {'kind': 'peakhour_virtualdj_filesize', 'id': identifier, 'created_at': time.time(), 'status': 'writing',
                   'databases': []}
        for number, item in enumerate(plan['plans']):
            backup = folder / f'{number}-database.xml'
            backup.write_bytes(item['before'])
            _fsync(backup)
            receipt['databases'].append({'path': item['database'], 'backup': str(backup), 'songs': len(item['edits']),
                                         'before_sha256': _sha(item['before']), 'after_sha256': _sha(item['after'])})
        _save(folder, receipt)
        done = []
        try:
            for item, entry in zip(plan['plans'], receipt['databases']):
                if _sha(Path(item['database']).read_bytes()) != entry['before_sha256']:
                    raise VirtualDJSizeError('VirtualDJ changed its database while PEAK HOUR was preparing this. Try again.', 'changed')
                _ensure_closed()
                _replace(item['database'], item['after'])
                done.append(entry)
                if _sha(Path(item['database']).read_bytes()) != entry['after_sha256']:
                    raise VirtualDJSizeError('The database did not read back as written.', 'verify_failed')
        except BaseException:
            for entry in done:
                try:
                    _replace(entry['path'], Path(entry['backup']).read_bytes())
                except OSError:
                    pass
            receipt['status'] = 'rolled_back'
            _save(folder, receipt)
            raise
        receipt['status'] = 'written'
        _save(folder, receipt)
        _prune_backups()
        return {'success': True, 'written': sum(e['songs'] for e in receipt['databases']), 'skipped': plan['skipped'],
                'databases_skipped': plan['databases_skipped'], 'receipt': identifier,
                'message': "VirtualDJ's file sizes were updated. A backup was kept."}


KEEP_BACKUPS = 5  # database.xml backups kept per database (the newest ones)


def _prune_backups(keep=KEEP_BACKUPS):
    """A database.xml copy can be tens of MB: only the newest few per database are kept (older receipts lose their backup)."""
    entries = {}
    for file in _root().glob('*/receipt.json'):
        try:
            receipt = json.loads(file.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if receipt.get('kind') != 'peakhour_virtualdj_filesize':
            continue
        for entry in receipt.get('databases', []):
            entries.setdefault(_key(entry['path']), []).append((receipt.get('created_at', 0), file, receipt, entry))
    changed = {}
    for items in entries.values():
        for created, file, receipt, entry in sorted(items, key=lambda item: item[0], reverse=True)[keep:]:
            if entry.get('backup'):
                try:
                    os.unlink(entry['backup'])
                except OSError:
                    pass
                entry['backup'] = None
                changed[file] = receipt
    for file, receipt in changed.items():
        try:
            _save(file.parent, receipt)
        except OSError:
            pass


def undo(receipt_id):
    """Put the database back as it was before that write (VirtualDJ closed, database not changed since)."""
    if not isinstance(receipt_id, str) or not re.fullmatch(r'[0-9A-Za-z_-]{1,64}', receipt_id):
        raise VirtualDJSizeError('Unknown backup.', 'bad_request')
    with _LOCK:
        folder = _root() / receipt_id
        try:
            receipt = json.loads((folder / 'receipt.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            raise VirtualDJSizeError('There is no such backup.', 'bad_request') from None
        if receipt.get('kind') != 'peakhour_virtualdj_filesize' or receipt.get('status') != 'written':
            raise VirtualDJSizeError('That write cannot be undone (it did not complete, or was undone already).', 'bad_request')
        _ensure_closed()
        for entry in receipt['databases']:
            if _sha(Path(entry['path']).read_bytes()) != entry['after_sha256']:
                raise VirtualDJSizeError('VirtualDJ has changed its database since this write, so it cannot be undone safely.', 'changed')
            if not entry.get('backup') or not Path(entry['backup']).is_file():
                raise VirtualDJSizeError('This backup was removed to save space (only the newest 5 are kept), so this write can no longer be undone. '
                                         'Nothing was changed.', 'verify_failed')
            if _sha(Path(entry['backup']).read_bytes()) != entry['before_sha256']:
                raise VirtualDJSizeError('The backup is damaged. Nothing was changed.', 'verify_failed')
        for entry in receipt['databases']:
            _replace(entry['path'], Path(entry['backup']).read_bytes())
        receipt.update(status='undone', undone_at=time.time())
        _save(folder, receipt)
        return {'success': True, 'restored': [e['path'] for e in receipt['databases']], 'receipt': receipt_id}


def register_with_queue(queue, root=None):
    """Register program 'virtualdj', kind 'filesize_sync' with the DJ write queue."""
    if root is not None:
        configure(root=root)
    queue.register('virtualdj', KIND, apply, digest)
