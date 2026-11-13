"""Recent PEAK HOUR writes into VirtualDJ, Serato and djay, so a write can be undone later (not only right after it).

GET /api/windows/dj-writes/recent lists the newest receipts (default 20) found under PEAK HOUR's data folder, read only:
  virtualdj-list-writes   VirtualDJ playlists / MyLists      undo: /api/windows/virtualdj/folders/undo
  djay-folder-writes      djay playlists in folders           undo: /api/windows/djay/folders/undo
  djay-cue-writes         djay cue points                     undo: /api/windows/djay/cues/undo
  serato-crate-writes     Serato crates and crate folders     undo: /api/windows/serato/folders/undo
  serato-cue-writes       Serato cue points                   undo: /api/windows/serato/cues/undo
  virtualdj-size-writes   VirtualDJ file-size sync            undo: /api/windows/dj-writes/undo-size (below)
Each row: {program, label, what, id, created_at, undone, undo_url}. Writes that did not complete (rolled back, still
writing) are not listed. The receipt formats belong to the writers; this module only reads them and never edits one.
POST /api/windows/dj-writes/undo-size {backup_id} undoes a file-size sync (that writer has no route of its own).
"""
import json
from pathlib import Path

LIMIT = 20
SOURCES = (  # folder under the data root, program, label, undo route
    ('virtualdj-list-writes', 'virtualdj', 'VirtualDJ playlist', '/api/windows/virtualdj/folders/undo'),
    ('djay-folder-writes', 'djay', 'djay playlist', '/api/windows/djay/folders/undo'),
    ('djay-cue-writes', 'djay', 'djay cue points', '/api/windows/djay/cues/undo'),
    ('serato-crate-writes', 'serato', 'Serato crate', '/api/windows/serato/folders/undo'),
    ('serato-cue-writes', 'serato', 'Serato cue points', '/api/windows/serato/cues/undo'),
    ('virtualdj-size-writes', 'virtualdj', 'VirtualDJ file sizes', '/api/windows/dj-writes/undo-size'),
)


def _songs(count):
    return f'{count:,} song{"" if count == 1 else "s"}'


def _what(folder, receipt):
    """A short description of what the write was, from whatever the writer put in its receipt."""
    path = receipt.get('path')
    if isinstance(path, list) and path:
        text = ' / '.join(str(part) for part in path)
        songs = receipt.get('songs')
        return f'{text}, {_songs(songs)}' if isinstance(songs, int) else text
    crate = receipt.get('crate')
    if isinstance(crate, str) and crate:
        return crate.replace('%%', ' / ')
    if folder == 'virtualdj-list-writes':
        return Path(str(receipt.get('list_path') or 'list')).stem
    if folder == 'virtualdj-size-writes':
        return _songs(sum(int(item.get('songs') or 0) for item in receipt.get('databases') or []))
    items = receipt.get('files') if isinstance(receipt.get('files'), list) else receipt.get('songs')
    if isinstance(items, list):
        return _songs(len(items))
    return ''


def _listed(folder, receipt):
    """(show it?, undone?) for a receipt. Only completed writes are shown."""
    status = receipt.get('status')
    if status is None:  # VirtualDJ playlist receipts: no status, an 'undone' flag, and what they created or replaced
        if not (receipt.get('created_files') or receipt.get('replaced')):
            return False, False
        return True, bool(receipt.get('undone'))
    if status in ('written', 'partly_undone'):
        return True, False
    if status == 'undone':
        return True, True
    return False, False


def recent(root, limit=LIMIT):
    rows = []
    for folder, program, label, undo_url in SOURCES:
        try:
            receipts = list((Path(root) / folder).glob('*/receipt.json'))
        except OSError:
            continue
        for file in receipts:
            try:
                receipt = json.loads(file.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue
            if not isinstance(receipt, dict):
                continue
            show, undone = _listed(folder, receipt)
            if not show:
                continue
            rows.append({'program': program, 'label': label, 'what': _what(folder, receipt), 'id': str(receipt.get('id') or file.parent.name),
                         'created_at': float(receipt.get('created_at') or file.stat().st_mtime), 'undone': undone, 'undo_url': undo_url})
    rows.sort(key=lambda row: row['created_at'], reverse=True)
    return rows[:limit]


def create_blueprint(root, license_guard=None):
    from flask import Blueprint, jsonify, request
    from windows_dj_write_queue import program_locked
    bp = Blueprint('windows_dj_writes', __name__)

    @bp.get('/api/windows/dj-writes/recent')
    def recent_route():
        return jsonify({'writes': recent(root)})

    @bp.post('/api/windows/dj-writes/undo-size')
    def undo_size_route():
        import windows_virtualdj_filesize as sizes
        origin = request.headers.get('Origin')
        if request.remote_addr not in ('127.0.0.1', '::1') or not origin or origin.rstrip('/') != request.host_url.rstrip('/'):
            return jsonify(success=False, error='Writing to VirtualDJ requires a same-origin request on this PC'), 403
        gate = license_guard('Undo VirtualDJ file sizes') if license_guard else None
        if gate:
            return gate
        data = request.get_json(silent=True) or {}
        try:
            with program_locked('virtualdj'):
                return jsonify(sizes.undo(data.get('backup_id')))
        except sizes.VirtualDJSizeError as exc:
            code = getattr(exc, 'code', 'error')
            return jsonify(success=False, error=str(exc), code=code), 409 if code in ('virtualdj_open', 'changed') else 400
        except (OSError, ValueError) as exc:
            return jsonify(success=False, error=str(exc), code='error'), 400
    return bp
