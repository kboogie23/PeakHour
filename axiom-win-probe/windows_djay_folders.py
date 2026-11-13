"""Put a PEAK HOUR playlist into djay Pro's library on Windows, inside folders.

A djay folder is an ordinary playlist record (ADCMediaItemPlaylist) of type 1.0 that lists its
children in childUUIDs; a playlist is type 0.0 with itemUUIDs and a parentUUID that points at its
folder (or at 'mediaItemPlaylist-root' at the top level). The records, relationships, view pages
and index rows are written the way djay writes them (checked against a real djay 5.6 library in
test_windows_djay_folders.py).

Public functions take and return plain JSON, so the write queue can call them later:
  preview(payload)   what would be written; reads djay's library read-only
  apply(payload)     backs the library up, writes in one transaction, reads it back, checks
                     integrity, puts the backup back on any failure
  undo(backup_id)    puts the backed-up library back, byte for byte
  digest(payload)    stable hash of the preview, for a stale check before apply
payload is {"path": ["Parent", "Child playlist"], "tracks": ["C:\\\\Music\\\\a.mp3", ...]}: the last
name is the playlist, every name before it a folder (any depth, at least the playlist itself).
Folders are found by name under their parent (case-insensitive) and created when missing; an
existing folder is never renamed, moved or emptied. If the playlist already exists in that folder:
the same songs in the same order (in it or in an earlier 'Name (2)') -> nothing is written; other
songs -> a new 'Name (2)' is made (as for flat playlists), unless the payload has "replace": true, which replaces the songs of a
playlist PEAK HOUR made earlier (or of any playlist when "confirm_replace" is true too).
apply also takes an optional "digest": if the preview no longer hashes the same, nothing is
written (code 'stale').

djay must be closed. If it is open apply/undo raise DjayFolderError with code 'djay_open' and write
nothing; this is checked again right before the commit.
"""
import hashlib
import json
import os
import re
import sqlite3
import struct
import threading
import time
import uuid
from pathlib import Path

from windows_djay_cues import (DjayCueError, _companions, _file_sha, _open_note, _readonly, _restore, _save, _sha,
                               _state_sha)

ROOT = 'mediaItemPlaylist-root'
KIND = 'peakhour_djay_folders'
MAX_DEPTH = 12
MAX_NAME = 200
_LOCK = threading.Lock()
_TABLES = ('database2', 'relationship_relationship', 'secondaryIndex_mediaItemPlaylistIndex', 'fts_searchIndex',
           'view_mediaView_page', 'view_mediaView_map', 'view_mediaItemPlaylistsView_page', 'view_mediaItemPlaylistsView_map',
           'view_mediaItemPlaylistView_page', 'view_mediaItemPlaylistView_map')
_VIEWS = (('view_mediaView_page', 'view_mediaView_map'), ('view_mediaItemPlaylistsView_page', 'view_mediaItemPlaylistsView_map'),
          ('view_mediaItemPlaylistView_page', 'view_mediaItemPlaylistView_map'))


class DjayFolderError(DjayCueError):
    """code: 'djay_open', 'stale', 'no_library', 'changed', 'verify_failed', 'write_failed', 'bad_request',
    'name_conflict', 'exists', 'no_tracks', 'unsupported'."""


def new_uuid():
    return str(uuid.uuid4()).upper()


# ------------------------------------------------------------------ configuration

_state = {'app': None, 'root': None, 'database': None, 'running': None}


def configure(app=None, root=None, database=None, running=None):
    """Set what the module works on; unset values fall back to windows_djay_cues' settings and the app.

    root      where backups and receipts go
    database  djay's MediaLibrary.db (default app.DJAY_MEDIA_LIBRARY_DB)
    running   callable -> True while djay is open (default: Windows process list)
    """
    for name, value in (('app', app), ('root', root), ('database', database), ('running', running)):
        if value is not None:
            _state[name] = value


def _app():
    import windows_djay_cues
    app = _state['app'] or windows_djay_cues._state['app']
    if app is None:
        raise DjayFolderError('PEAK HOUR is not ready to write to djay yet.', 'no_library')
    return app


def _database():
    import windows_djay_cues
    database = _state['database'] or windows_djay_cues._state['database'] or getattr(_app(), 'DJAY_MEDIA_LIBRARY_DB', '') or ''
    return os.path.abspath(str(database)) if database else ''


def _root():
    if _state['root'] is not None:
        return Path(_state['root'])
    cache = getattr(_state['app'], 'CACHE_PATH', None)
    if cache:
        return Path(cache).parent / 'djay-folder-writes'
    raise DjayFolderError('No folder is set for djay playlist backups.', 'no_library')


def _running():
    check = _state['running']
    if check is not None:
        return bool(check())
    import windows_djay_cues
    return windows_djay_cues._running()


def _ensure_closed():
    if _running():
        raise DjayFolderError('Quit djay Pro, then try again. Nothing was written.', 'djay_open')


# ------------------------------------------------------------------ djay playlist records

def _decode(blob):
    """Decoded playlist record; it must re-encode to the very same bytes, or it is not touched."""
    import windows_djay
    decoded = _app()._djay_decode_fastcoding_object(bytes(blob))
    try:
        same = isinstance(decoded, dict) and decoded.get('class_name') == 'ADCMediaItemPlaylist' \
            and windows_djay.encode_windows_playlist(decoded) == bytes(blob)
    except ValueError:
        same = False
    if not same:
        raise DjayFolderError("djay stores a playlist in a layout PEAK HOUR does not know; nothing was written.", 'unsupported')
    return decoded


def _encode(properties):
    import windows_djay
    return windows_djay.encode_windows_playlist({'class_name': 'ADCMediaItemPlaylist', 'header': (3, 3, 0), 'properties': properties})


def _prop(decoded, name, default=None):
    for key, _kind, value in decoded['properties']:
        if key == name:
            return value
    return default


def _folder_properties(key, name, parent, child):
    return [('uuid', 'string', key), ('name', 'string', name), ('parentUUID', 'string', parent), ('type', 'integer', 1),
            ('childUUIDs', 'ordered_set', [child])]


def _playlist_properties(key, name, parent, items):
    return [('uuid', 'string', key), ('name', 'string', name), ('parentUUID', 'string', parent), ('type', 'integer', 0),
            ('itemUUIDs', 'ordered_set', list(items))]


def _with_child(blob, child):
    """The parent's record with one more child at the end of childUUIDs (added at the end of the properties if it has none)."""
    decoded = _decode(blob)
    properties, done = [], False
    for key, kind, value in decoded['properties']:
        if key == 'childUUIDs':
            if kind != 'ordered_set':
                raise DjayFolderError('djay lists a folder\'s children in a way PEAK HOUR does not know.', 'unsupported')
            kind, value, done = kind, list(value) + [child], True
        properties.append((key, kind, value))
    if not done:
        properties.append(('childUUIDs', 'ordered_set', [child]))
    return _encode(properties)


def _with_items(blob, items):
    decoded = _decode(blob)
    properties = [(key, kind, list(items) if key == 'itemUUIDs' else value) for key, kind, value in decoded['properties']]
    return _encode(properties)


def _record(connection, key):
    found = connection.execute("SELECT rowid, data FROM database2 WHERE collection='mediaItemPlaylists' AND key=?", (key,)).fetchone()
    if found is None:
        return None
    blob = bytes(found[1])
    return {'rowid': found[0], 'key': key, 'blob': blob, 'sha': _sha(blob), 'decoded': _decode(blob)}


def _children(connection, parent):
    """The parent's child records in djay's order; children that have no record are left out."""
    result = []
    for key in _prop(parent['decoded'], 'childUUIDs', []) or []:
        child = _record(connection, key)
        if child is not None:
            result.append(child)
    return result


def _find(children, name):
    wanted = name.strip().casefold()
    return [child for child in children if str(_prop(child['decoded'], 'name', '')).strip().casefold() == wanted]


def _item_media(connection, playlist):
    """[media uuid of each item] of an existing playlist, in order."""
    media = []
    for key in _prop(playlist['decoded'], 'itemUUIDs', []) or []:
        found = connection.execute("SELECT data FROM database2 WHERE collection='mediaItemPlaylistItems' AND key=?", (key,)).fetchone()
        if found is None:
            raise DjayFolderError('An existing djay playlist has a missing song record; nothing was written.', 'unsupported')
        values = {k: v for k, _kind, v in _app()._djay_decode_fastcoding_object(bytes(found[0]))['properties']}
        media.append(values.get('mediaItemUUID'))
    return media


# ------------------------------------------------------------------ request and plan

def _names(payload):
    path = payload.get('path') if isinstance(payload, dict) else None
    if not isinstance(path, list) or not path or len(path) > MAX_DEPTH:
        raise DjayFolderError('Give the playlist as a path of names: folders first, the playlist last.', 'bad_request')
    names = []
    for part in path:
        if not isinstance(part, str):
            raise DjayFolderError('Every name in the path must be text.', 'bad_request')
        text = part.strip()
        if not text or len(text) > MAX_NAME or re.search(r'[\x00-\x1f\x7f]', text):
            raise DjayFolderError('A folder or playlist name is empty, too long, or has control characters.', 'bad_request')
        names.append(text)
    return names


def _tracks(payload):
    tracks = payload.get('tracks') if isinstance(payload, dict) else None
    if not isinstance(tracks, list) or not tracks:
        raise DjayFolderError('Choose the songs for the playlist.', 'bad_request')
    paths = []
    for entry in tracks:
        path = entry.get('path') if isinstance(entry, dict) else entry
        if not isinstance(path, str) or not path:
            raise DjayFolderError('A song in the list has no file path.', 'bad_request')
        paths.append(path)
    return paths


def _owned(playlist_uuid):
    """True if one of PEAK HOUR's completed folder writes made this playlist."""
    try:
        folders = list(_root().iterdir())
    except (OSError, DjayFolderError):
        return False
    for folder in folders:
        try:
            receipt = json.loads((folder / 'receipt.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if receipt.get('kind') == KIND and receipt.get('status') == 'written' and receipt.get('playlist_uuid') == playlist_uuid:
            return True
    return False


def _need_tables(connection):
    have = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type IN ('table')")}
    if not set(_TABLES) <= have:
        raise DjayFolderError('This djay library version is not supported safely yet.', 'unsupported')
    if connection.execute("SELECT 1 FROM sqlite_master WHERE type='trigger'").fetchone():
        raise DjayFolderError('This djay library has triggers PEAK HOUR does not know. Nothing was changed.', 'unsupported')


def _plan_on(connection, payload):
    names, wanted = _names(payload), _tracks(payload)
    replace = bool(isinstance(payload, dict) and payload.get('replace'))
    confirm_replace = bool(isinstance(payload, dict) and payload.get('confirm_replace'))
    _need_tables(connection)
    root = _record(connection, ROOT)
    if root is None or _prop(root['decoded'], 'type') != 1:
        raise DjayFolderError("djay has no playlist root in this library yet. Open djay once, then try again.", 'unsupported')
    matches, report, duplicates, missing, not_in_djay = _app()._djay_native_track_matches(connection, [{'path': p} for p in wanted])
    if not matches:
        raise DjayFolderError('None of these songs are in djay Pro yet. Add them in djay first.', 'no_tracks')
    skipped = [{'path': row['path'], 'reason': {'missing_skipped': 'The file is missing', 'duplicate_skipped': 'Listed twice',
                                                'not_in_djay_skipped': 'Not in the djay library'}.get(row['status'], row['status'])}
               for row in report if row['status'] != 'exported']
    steps, parent, created = [], root, False
    touched = {}
    for name in names[:-1]:
        found = [] if created else _find(_children(connection, parent), name)
        if found:
            child = found[0]
            if _prop(child['decoded'], 'type') != 1:
                raise DjayFolderError(f'"{name}" is a playlist in djay, not a folder. Nothing was written.', 'name_conflict')
            steps.append({'name': name, 'action': 'existing', 'uuid': child['key']})
            parent = child
        else:
            steps.append({'name': name, 'action': 'create'})
            created = True
    touched[parent['key']] = parent['sha']  # the deepest existing folder (or the root) gets the first new child
    playlist = {'name': names[-1], 'final_name': names[-1], 'action': 'create', 'existing_uuid': '', 'replaced_songs': 0}
    siblings = [] if created else _children(connection, parent)
    same = _find(siblings, names[-1])
    wanted_media = [m['media_uuid'] for m in matches]
    if same and _prop(same[0]['decoded'], 'type') != 0:
        raise DjayFolderError(f'"{names[-1]}" is a folder in djay, not a playlist. Nothing was written.', 'name_conflict')
    numbered = [c for c in siblings if re.fullmatch(re.escape(names[-1]) + r' \(\d+\)', str(_prop(c['decoded'], 'name', '')).strip(), re.I)]
    twins = [c for c in same + numbered if _prop(c['decoded'], 'type') == 0 and _item_media(connection, c) == wanted_media]
    if twins:  # the playlist (or an earlier "Name (2)" of it) is already there with these songs
        playlist.update(action='unchanged', existing_uuid=twins[0]['key'])
    elif same:
        existing = same[0]
        playlist['existing_uuid'] = existing['key']
        if replace:
            if not (_owned(existing['key']) or confirm_replace):
                raise DjayFolderError(f'A playlist called "{names[-1]}" is already in that djay folder and PEAK HOUR did not make it. '
                                      'Confirm replacing it, or choose another name.', 'exists')
            playlist.update(action='replace', replaced_songs=len(_item_media(connection, existing)))
            touched[existing['key']] = existing['sha']
        else:
            taken = {str(_prop(c['decoded'], 'name', '')).strip().casefold() for c in siblings}
            number = 2
            while f'{names[-1]} ({number})'.casefold() in taken:
                number += 1
            playlist.update(action='create', final_name=f'{names[-1]} ({number})', existing_uuid='')
    database = _database()
    result = {'database': database, 'path': names, 'steps': steps, 'playlist': playlist,
              'tracks': [{'path': m['path'], 'media_uuid': m['media_uuid'], 'media_rowid': m['media_rowid']} for m in matches],
              'skipped': skipped, 'touched': touched, 'will_write': playlist['action'] != 'unchanged'}
    # The job digest changes only when the TARGET changed (the folders/playlist it would create or replace, and the record of
    # the folder it goes into); the song list is the requested one, and the root record is left out because djay rewrites it
    # for any unrelated top-level folder. Songs are matched again when the write runs.
    result['digest'] = _sha(json.dumps([os.path.normcase(database), result['path'], steps, playlist, sorted(wanted),
                                        {key: sha for key, sha in touched.items() if key != ROOT}], sort_keys=True).encode())
    return result


def _plan(payload):
    database = _database()
    if not database or not os.path.isfile(database):
        raise DjayFolderError('djay Pro has no library on this PC yet.', 'no_library')
    note = _open_note()
    try:
        connection = _readonly(database, closed=not note)
        try:
            plan = _plan_on(connection, payload)
        finally:
            connection.close()
    except sqlite3.Error as error:
        raise DjayFolderError(f'{note or "djay library could not be read."} ({error}) Try again in a moment.', 'busy') from error
    plan['note'] = note
    return plan


def _public(plan):
    created = [s['name'] for s in plan['steps'] if s['action'] == 'create']
    return {'success': True, 'database': plan['database'], 'path': plan['path'], 'folders': plan['steps'],
            'playlist': plan['playlist'], 'songs': plan['tracks'], 'skipped': plan['skipped'], 'digest': plan['digest'],
            'will_write': plan['will_write'], 'note': plan.get('note', ''),
            'counts': {'folders_to_create': len(created), 'songs': len(plan['tracks']), 'skipped': len(plan['skipped'])},
            'writes_to': 'nothing (preview)'}


def preview(payload=None):
    """What apply would do. Reads djay's library read-only and writes nothing."""
    return _public(_plan(payload))


def digest(payload=None):
    """Stable hash of what would be written; equal while nothing relevant changed."""
    return _plan(payload)['digest']


# ------------------------------------------------------------------ checks

def _affected(connection, plan):
    """(existing rowids a write changes or removes, view groups it rewrites): used to prove nothing else changed."""
    rowids = set()
    marks = ','.join('?' * len(plan['touched'])) or "''"
    for row in connection.execute(f"SELECT rowid FROM database2 WHERE collection='mediaItemPlaylists' AND key IN ({marks})",
                                  list(plan['touched'])):
        rowids.add(row[0])
    if plan['playlist']['action'] == 'replace':
        record = _record(connection, plan['playlist']['existing_uuid'])
        for item in _prop(record['decoded'], 'itemUUIDs', []):
            for row in connection.execute("SELECT rowid FROM database2 WHERE collection='mediaItemPlaylistItems' AND key=?", (item,)):
                rowids.add(row[0])
    return rowids, set(plan['touched']) | {'playlist'}


def _others(connection, rowids, groups):
    """Hash of every playlist row, relationship, view page and index row that a folder write must leave alone."""
    digest_ = hashlib.sha256()

    def add(*parts):
        digest_.update(repr(tuple(bytes(p) if isinstance(p, (bytes, memoryview)) else p for p in parts)).encode())

    for row in connection.execute('SELECT rowid, collection, key, data, metadata FROM database2 ORDER BY rowid'):
        if row[0] not in rowids:
            add(*row)
    for row in connection.execute('SELECT rowid, name, src, dst, rules, manual FROM relationship_relationship ORDER BY rowid'):
        if row[2] not in rowids and row[3] not in rowids:
            add(*row)
    for page, map_ in _VIEWS:
        keys = {r[0] for r in connection.execute(f'SELECT pageKey FROM "{page}" WHERE "group" IN ({",".join("?" * len(groups))})', list(groups))}
        for row in connection.execute(f'SELECT pageKey, "group", prevPageKey, count, data FROM "{page}" ORDER BY pageKey'):
            if row[1] not in groups:
                add(page, *row)
        for row in connection.execute(f'SELECT rowid, pageKey FROM "{map_}" ORDER BY rowid'):
            if row[0] not in rowids and row[1] not in keys:
                add(map_, *row)
    for row in connection.execute('SELECT rowid, name FROM secondaryIndex_mediaItemPlaylistIndex ORDER BY rowid'):
        if row[0] not in rowids:
            add(*row)
    for row in connection.execute('SELECT docid, * FROM fts_searchIndex_content ORDER BY docid'):
        if row[0] not in rowids:
            add(*row)
    add(_app()._djay_non_playlist_records_digest(connection))
    return digest_.hexdigest()


def _group_rowids(connection, page, group):
    return _app()._djay_page_rowids(connection, page, group)


def _check(connection, plan):
    """The folders, playlist, songs, relationships, view pages and index rows are all there, as djay keeps them."""
    def fail(text):
        raise DjayFolderError(f'djay playlist check failed: {text}', 'verify_failed')

    def relation(name, src, dst, rules):
        found = connection.execute('SELECT count(*), min(rules), min(manual) FROM relationship_relationship WHERE name=? AND src=? AND dst=?',
                                   (name, src, dst)).fetchone()
        if found != (1, rules, 0):
            fail(f'relationship {name} {src}->{dst}')

    def in_view(page, map_, group, rowid):
        if rowid not in _group_rowids(connection, page, group):
            fail(f'{rowid} is not in {page} group {group}')
        key = connection.execute(f'SELECT pageKey FROM "{map_}" WHERE rowid=?', (rowid,)).fetchone()
        if key is None or connection.execute(f'SELECT 1 FROM "{page}" WHERE pageKey=? AND "group"=?', (key[0], group)).fetchone() is None:
            fail(f'{rowid} has no page in {page}')

    def indexed(rowid, name):
        found = connection.execute('SELECT name FROM secondaryIndex_mediaItemPlaylistIndex WHERE rowid=?', (rowid,)).fetchone()
        text = connection.execute('SELECT playlist FROM fts_searchIndex WHERE rowid=?', (rowid,)).fetchone()
        if found is None or found[0] != name or text is None or text[0] != name:
            fail(f'index rows of "{name}"')

    parent = _record(connection, ROOT)
    if parent is None:
        fail('the playlist root is gone')
    names = [s['name'] for s in plan['steps']] + [plan['playlist']['final_name']]
    walked = []
    for position, name in enumerate(names):
        last = position == len(names) - 1
        found = [c for c in _children(connection, parent) if str(_prop(c['decoded'], 'name', '')).strip().casefold() == name.casefold()]
        if len(found) != 1:
            fail(f'"{name}" is not listed once under its parent')
        child = found[0]
        decoded = child['decoded']
        if _prop(decoded, 'parentUUID') != parent['key'] or _prop(decoded, 'uuid') != child['key'] \
                or _prop(decoded, 'type') != (0 if last else 1):
            fail(f'the record of "{name}"')
        relation('mediaItemPlaylistParent', child['rowid'], parent['rowid'], 4)
        relation('mediaItemPlaylistChild', parent['rowid'], child['rowid'], 2)
        in_view('view_mediaItemPlaylistsView_page', 'view_mediaItemPlaylistsView_map', parent['key'], child['rowid'])
        indexed(child['rowid'], _prop(decoded, 'name'))
        if last and _prop(decoded, 'name') != name:
            fail(f'the name of "{name}"')
        walked.append(child)
        parent = child
    playlist = parent
    in_view('view_mediaView_page', 'view_mediaView_map', 'playlist', playlist['rowid'])
    for folder in walked[:-1]:
        if folder['rowid'] in _group_rowids(connection, 'view_mediaView_page', 'playlist'):
            fail('a folder is listed among the playlists')
    items = _prop(playlist['decoded'], 'itemUUIDs', [])
    if len(items) != len(plan['tracks']):
        fail('the number of songs')
    page = _group_rowids(connection, 'view_mediaItemPlaylistView_page', playlist['key'])
    app = _app()
    for number, (item, track) in enumerate(zip(items, plan['tracks'])):
        row = connection.execute("SELECT rowid, data FROM database2 WHERE collection='mediaItemPlaylistItems' AND key=?", (item,)).fetchone()
        if row is None:
            fail('a song record is missing')
        values = {k: v for k, _kind, v in app._djay_decode_fastcoding_object(bytes(row[1]))['properties']}
        if values.get('playlistUUID') != playlist['key'] or values.get('mediaItemUUID') != track['media_uuid'] or values.get('uuid') != item:
            fail('a song record')
        if page[number:number + 1] != [row[0]]:
            fail('the song order in the playlist view')
        relation('mediaItemPlaylistItem', playlist['rowid'], row[0], 2)
        relation('mediaItemPlaylistItemPlaylist', row[0], playlist['rowid'], 4)
        relation('mediaItemPlaylistItemMediaItem', row[0], track['media_rowid'], 4)
    if len(page) != len(items):
        fail('extra songs in the playlist view')
    return playlist['key']




# ------------------------------------------------------------------ the write

def _relate(connection, name, src, dst, rules):
    connection.execute('INSERT INTO relationship_relationship(name, src, dst, rules, manual) VALUES(?, ?, ?, ?, 0)', (name, src, dst, rules))


def _page_add(connection, page, map_, group, rowids):
    """Append rowids to the end of a view group's pages."""
    app = _app()
    app._djay_write_pages(connection, page, map_, group, app._djay_page_rowids(connection, page, group) + list(rowids))


def _node(connection, name, parent, key, blob):
    """Insert a folder or playlist record with its djay index rows and parent/child relationships; returns its rowid."""
    connection.execute("INSERT INTO database2(collection, key, data) VALUES('mediaItemPlaylists', ?, ?)", (key, blob))
    rowid = connection.execute('SELECT last_insert_rowid()').fetchone()[0]
    connection.execute('INSERT INTO secondaryIndex_mediaItemPlaylistIndex(rowid, name) VALUES(?, ?)', (rowid, name))
    _relate(connection, 'mediaItemPlaylistParent', rowid, parent['rowid'], 4)
    _relate(connection, 'mediaItemPlaylistChild', parent['rowid'], rowid, 2)
    connection.execute('INSERT INTO fts_searchIndex(rowid, playlist) VALUES(?, ?)', (rowid, name))
    _page_add(connection, 'view_mediaItemPlaylistsView_page', 'view_mediaItemPlaylistsView_map', parent['key'], [rowid])
    return rowid


def _items(connection, playlist_key, playlist_rowid, tracks, keys):
    """Insert the song records of a playlist, in djay's relationship order; returns their rowids."""
    app, rowids = _app(), []
    for key, track in zip(keys, tracks):
        connection.execute("INSERT INTO database2(collection, key, data) VALUES('mediaItemPlaylistItems', ?, ?)",
                           (key, app._djay_fastcoding_playlist_item_blob(key, playlist_key, track['media_uuid'])))
        rowid = connection.execute('SELECT last_insert_rowid()').fetchone()[0]
        _relate(connection, 'mediaItemPlaylistItemMediaItem', rowid, track['media_rowid'], 4)
        _relate(connection, 'mediaItemPlaylistItemPlaylist', rowid, playlist_rowid, 4)
        _relate(connection, 'mediaItemPlaylistItem', playlist_rowid, rowid, 2)
        rowids.append(rowid)
    return rowids


def _create(connection, plan, new_rows, new_groups, created):
    """Add the missing folders and the playlist below the deepest existing folder (or the root)."""
    existing = [s for s in plan['steps'] if s['action'] == 'existing']
    parent = _record(connection, existing[-1]['uuid'] if existing else ROOT)
    nodes = [(s['name'], new_uuid()) for s in plan['steps'] if s['action'] == 'create'] + [(plan['playlist']['final_name'], new_uuid())]
    connection.execute('UPDATE database2 SET data=? WHERE rowid=?', (_with_child(parent['blob'], nodes[0][1]), parent['rowid']))
    item_keys = [new_uuid() for _ in plan['tracks']]
    for position, (name, key) in enumerate(nodes):
        if position == len(nodes) - 1:
            blob = _encode(_playlist_properties(key, name, parent['key'], item_keys))
        else:
            blob = _encode(_folder_properties(key, name, parent['key'], nodes[position + 1][1]))
            created.append(key)
        rowid = _node(connection, name, parent, key, blob)
        new_rows.append(rowid)
        new_groups.add(key)
        parent = {'rowid': rowid, 'key': key}
    item_rows = _items(connection, parent['key'], parent['rowid'], plan['tracks'], item_keys)
    new_rows.extend(item_rows)
    _app()._djay_write_pages(connection, 'view_mediaItemPlaylistView_page', 'view_mediaItemPlaylistView_map', parent['key'], item_rows)
    _page_add(connection, 'view_mediaView_page', 'view_mediaView_map', 'playlist', [parent['rowid']])
    return parent['key']


def _replace(connection, plan, new_rows):
    """Give an existing playlist the new songs: its old song records go, new ones come, the playlist keeps its uuid and place."""
    row = _record(connection, plan['playlist']['existing_uuid'])
    old = _prop(row['decoded'], 'itemUUIDs', [])
    old_rows = [r[0] for r in connection.execute(
        "SELECT rowid FROM database2 WHERE collection='mediaItemPlaylistItems' AND key IN (%s)" % (','.join('?' * len(old)) or "''"), old)]
    marks = ','.join('?' * len(old_rows)) or '0'
    connection.execute(f"DELETE FROM relationship_relationship WHERE name LIKE 'mediaItemPlaylistItem%' AND (src IN ({marks}) OR dst IN ({marks}))",
                       old_rows + old_rows)
    connection.execute(f'DELETE FROM database2 WHERE rowid IN ({marks})', old_rows)
    keys = [new_uuid() for _ in plan['tracks']]
    connection.execute('UPDATE database2 SET data=? WHERE rowid=?', (_with_items(row['blob'], keys), row['rowid']))
    rowids = _items(connection, row['key'], row['rowid'], plan['tracks'], keys)
    new_rows.extend(rowids)
    _app()._djay_write_pages(connection, 'view_mediaItemPlaylistView_page', 'view_mediaItemPlaylistView_map', row['key'], rowids)
    return row['key']


def _write(database, payload, plan):
    """Write the planned folders and playlist in one transaction; returns (playlist uuid, created folder uuids)."""
    connection = sqlite3.connect(database, isolation_level=None, timeout=5)
    try:
        connection.execute('BEGIN IMMEDIATE')
        fresh = _plan_on(connection, payload)  # the library may have moved since the preview
        if fresh['digest'] != plan['digest']:
            raise DjayFolderError('djay changed since the preview. Preview again.', 'stale')
        rowids, groups = _affected(connection, fresh)
        before = _others(connection, rowids, groups)
        new_rows, new_groups, created = [], set(), []
        key = _replace(connection, fresh, new_rows) if fresh['playlist']['action'] == 'replace' \
            else _create(connection, fresh, new_rows, new_groups, created)
        if _others(connection, rowids | set(new_rows), groups | new_groups | {key}) != before:
            raise DjayFolderError('Other djay records changed; nothing was written.', 'verify_failed')
        _check(connection, fresh)
        _ensure_closed()  # last look, right before the commit
        connection.execute('COMMIT')
        return key, created
    except BaseException:
        try:
            connection.execute('ROLLBACK')
        except sqlite3.Error:
            pass
        raise
    finally:
        connection.close()


def _verify(database, plan):
    connection = _readonly(database)
    try:
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise DjayFolderError('The djay library failed its integrity check after the write.', 'verify_failed')
        _check(connection, plan)
    finally:
        connection.close()


# ------------------------------------------------------------------ apply / undo

def _written_plan(plan):
    """The plan as the library looks once it is written: every folder exists."""
    return dict(plan, steps=[dict(step, action='existing') for step in plan['steps']])


def apply(payload=None):
    """Write the playlist (and any missing folders) into djay's library, with a backup kept."""
    with _LOCK:
        plan = _plan(payload)
        expected = payload.get('digest') if isinstance(payload, dict) else None
        if expected and expected != plan['digest']:
            raise DjayFolderError('The djay library changed since the preview. Preview again.', 'stale')
        summary = _public(plan)
        if not plan['will_write']:
            return dict(summary, written=0, backup_id='', playlist_uuid=plan['playlist']['existing_uuid'],
                        message='That playlist is already in djay with the same songs. Nothing was written.')
        database = plan['database']
        _ensure_closed()
        identifier = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
        folder = _root() / identifier
        folder.mkdir(parents=True)
        before_state = _state_sha(database)
        for companion in [Path(database)] + _companions(database):
            if companion.is_file():
                (folder / ('MediaLibrary.db' + companion.name[len(Path(database).name):])).write_bytes(companion.read_bytes())
        receipt = {'kind': KIND, 'id': identifier, 'created_at': time.time(), 'status': 'writing', 'database': database,
                   'before_sha256': _file_sha(folder / 'MediaLibrary.db'), 'before_state': before_state,
                   'path': plan['path'], 'action': plan['playlist']['action'], 'songs': len(plan['tracks'])}
        if _state_sha(database) != before_state:
            raise DjayFolderError('djay changed its library while PEAK HOUR was backing it up. Try again.', 'changed')
        _save(folder, receipt)
        try:
            playlist_key, created = _write(database, payload, plan)
            receipt.update(playlist_uuid=playlist_key, folders_created=created)
            _verify(database, _written_plan(plan))
        except BaseException as error:
            problem = None
            try:
                if _state_sha(database) != before_state:
                    _restore(database, folder, receipt)
                receipt['status'] = 'rolled_back'
            except Exception as failure:
                receipt['status'] = 'rollback_failed'
                problem = failure
            try:
                _save(folder, receipt)
            except OSError:
                pass
            if problem is not None:
                raise DjayFolderError(f'{error} PEAK HOUR could not put the djay library back ({problem}); '
                                      f'the backup is in {folder}.', 'write_failed') from error
            if isinstance(error, DjayCueError) or not isinstance(error, Exception):
                raise
            raise DjayFolderError(f'Could not write the playlist to djay ({error}). The library was left as it was.',
                                  'write_failed') from error
        receipt.update(status='written', after_state=_state_sha(database), after_sha256=_file_sha(database))
        _save(folder, receipt)
        return dict(summary, written=1, backup_id=identifier, playlist_uuid=playlist_key, folders_created=created,
                    message='Playlist written to djay. A backup was kept and this can be undone.')


def undo(backup_id):
    """Put the library back as it was before that write, byte for byte (djay closed, and unchanged since)."""
    if not isinstance(backup_id, str) or not re.fullmatch(r'[0-9A-Za-z_-]{1,64}', backup_id):
        raise DjayFolderError('Unknown backup.', 'bad_request')
    with _LOCK:
        folder = _root() / backup_id
        try:
            receipt = json.loads((folder / 'receipt.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            raise DjayFolderError('There is no such djay playlist backup.', 'bad_request') from None
        if receipt.get('kind') != KIND or receipt.get('status') != 'written':
            raise DjayFolderError('That write cannot be undone (it did not complete, or was undone already).', 'bad_request')
        _ensure_closed()
        database = receipt['database']
        if not os.path.isfile(database) or _state_sha(database) != receipt['after_state']:
            raise DjayFolderError('djay has changed its library since this write, so it cannot be undone safely.', 'changed')
        if _file_sha(folder / 'MediaLibrary.db') != receipt['before_sha256']:
            raise DjayFolderError('The backup is damaged. Nothing was changed.', 'verify_failed')
        _restore(database, folder, receipt)
        receipt.update(status='undone', undone_at=time.time())
        _save(folder, receipt)
        return {'success': True, 'restored': database, 'backup_id': backup_id}


# ------------------------------------------------------------------ routes and queue

def register_with_queue(queue):
    """Let the DJ write queue run djay writes (it waits while djay is open): folders/playlists and cues."""
    import windows_djay_cues
    queue.register('djay', 'playlist_folder', apply, digest)
    queue.register('djay', 'cues', windows_djay_cues.apply, windows_djay_cues.digest)


def create_blueprint(app, root=None, license_guard=None):
    from flask import Blueprint, jsonify, request
    configure(app=app, root=root)
    bp = Blueprint('windows_djay_folders', __name__)

    @bp.before_request
    def local_only():
        if request.remote_addr not in ('127.0.0.1', '::1'):
            return jsonify(success=False, error='Writing to djay requires this PC'), 403
        origin = request.headers.get('Origin')
        if request.method != 'GET' and (not origin or origin.rstrip('/') != request.host_url.rstrip('/')):
            return jsonify(success=False, error='Writing to djay requires a same-origin request'), 403

    def respond(action):
        try:
            result = action()
            if isinstance(result, tuple):  # (body, status): queued until djay closes
                return jsonify(result[0]), result[1]
            return jsonify(result)
        except DjayCueError as exc:
            return jsonify(success=False, error=str(exc), code=exc.code), 409 if exc.code == 'djay_open' else 400
        except (ValueError, OSError) as exc:
            return jsonify(success=False, error=str(exc), code='error'), 400

    def gated(action):
        gate = license_guard('Send playlists to djay') if license_guard else None
        return gate if gate else respond(action)

    @bp.post('/api/windows/djay/folders/preview')
    def preview_route():
        data = request.get_json(silent=True) or {}
        return gated(lambda: preview(data))

    def queued_or_apply(data):
        from windows_dj_write_queue import queue_if_open
        payload = {key: value for key, value in data.items() if key != 'confirm'}
        return queue_if_open('djay', 'playlist_folder', payload, 'djay', lambda: apply(payload)) or apply(payload)

    @bp.post('/api/windows/djay/folders/apply')
    def apply_route():
        data = request.get_json(silent=True) or {}
        if data.get('confirm') is not True:
            return jsonify(success=False, error='Confirm before writing to djay', code='bad_request'), 400
        return gated(lambda: queued_or_apply(data))

    @bp.post('/api/windows/djay/folders/undo')
    def undo_route():
        data = request.get_json(silent=True) or {}
        from windows_dj_write_queue import program_locked

        def locked_undo():
            with program_locked('djay'):
                return undo(data.get('backup_id'))
        return gated(locked_undo)

    return bp
