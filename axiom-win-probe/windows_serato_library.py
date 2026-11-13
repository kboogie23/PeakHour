"""Serato DJ Pro 5 modern library locations on Windows.

Observed with Serato DJ Pro 5.0.0.1278 on Windows (2026-10-30):
  %LOCALAPPDATA%\\Serato\\Library\\master.sqlite   links every location
  %LOCALAPPDATA%\\Serato\\Library\\root.sqlite     the system drive's location
  <drive>:\\_Serato_\\Library\\location.sqlite      one per other drive
master.sqlite's connection table lists these. Track portable_id values are
relative to the drive root with forward slashes ("Samples/a b.mp3").

master.sqlite uses Serato-only collations and functions in its indexes and
triggers and is never written. root.sqlite and location.sqlite have neither.
AXIOM's portable_id kept the drive ("E:/Samples/..."), so it would not find
existing Serato assets and would add duplicates; this module fixes that and
writes each crate into the database of the drive holding its tracks. The
system drive (root.sqlite) is refused until a real root.sqlite with tracks
has shown how Serato for Windows records them there.
"""
import contextvars
import ntpath
import os
from pathlib import Path

class SeratoLibraryError(RuntimeError):
    code = 'error'

def library_folder():
    return Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local') / 'Serato' / 'Library'

def system_drive():
    return (os.environ.get('SystemDrive') or 'C:').upper()

def portable_id(path):
    """Serato's drive-relative id: "E:\\Samples\\a b.mp3" -> "Samples/a b.mp3"."""
    absolute = ntpath.normpath(os.path.abspath(os.path.expandvars(os.path.expanduser(str(path)))))
    drive, tail = ntpath.splitdrive(absolute)
    if len(drive) != 2 or drive[1] != ':':
        raise SeratoLibraryError('Serato tracks must be on a local drive with a letter')
    return tail.lstrip('\\').replace('\\', '/')

def location_database(drive):
    """The Serato database holding tracks on this drive ("E:")."""
    drive = drive.upper()
    if drive == system_drive():
        return library_folder() / 'root.sqlite'
    return Path(drive + '\\', '_Serato_', 'Library', 'location.sqlite')

def database_for_tracks(tracks):
    """One location database for these tracks, or a clear refusal."""
    drives = {ntpath.splitdrive(str(t.get('path') if isinstance(t, dict) else t))[0].upper() for t in tracks}
    if len(drives) != 1 or '' in drives:
        raise SeratoLibraryError('Serato keeps crates per drive. Choose tracks from one drive for this crate.')
    drive = drives.pop()
    if drive == system_drive():
        raise SeratoLibraryError('Crates for tracks on ' + drive + " aren't supported in Serato's newer library yet. "
                                 'Use the legacy crate export instead.')
    database = location_database(drive)
    if not database.is_file():
        raise SeratoLibraryError('Serato has not set up a library on ' + drive + ' yet. Open Serato DJ once with that drive connected.')
    return database

PRESERVED_FIELDS = (('title', 'name'), ('artist', 'artist'), ('bpm', 'bpm'), ('key', 'key'), ('year', 'year'))
_KNOWN_ASSETS = contextvars.ContextVar('serato_known_assets', default=None)

def existing_assets(database_path):
    """Serato's own asset rows by case-folded portable_id (read-only)."""
    import sqlite3
    connection = sqlite3.connect(Path(database_path).resolve().as_uri() + '?mode=ro', uri=True)
    try:
        connection.row_factory = sqlite3.Row
        return {row['portable_id'].casefold(): dict(row)
                for row in connection.execute('SELECT portable_id, name, artist, bpm, key, year, file_size FROM asset')}
    finally:
        connection.close()

def make_track_fields(original):
    """Wrap app._serato_modern_track_fields: during a crate write, a track Serato
    already has keeps Serato's exact title (AXIOM strips spaces) and stored size."""
    def fields(track):
        result = original(track)
        known = _KNOWN_ASSETS.get()
        row = known.get(str(result.get('portable_id', '')).casefold()) if known else None
        if row:
            result = dict(result, title=row['name'], file_size=row['file_size'])
        return result
    return fields

def make_crate_database_writer(original):
    """Wrap app._write_serato_modern_crate_to_database so tracks Serato already
    has keep Serato's title, artist, BPM, key and year.

    AXIOM's writer updates existing assets from AXIOM's own track details; where
    those lack a key it wrote '' over Serato's key, and it replaced an empty
    artist with "Unknown Artist". A crate export only adds membership.
    """
    def write(database_path, tracks, name):
        known = existing_assets(database_path)
        prepared = []
        for track in tracks:
            row = known.get(portable_id(track.get('path', '')).casefold()) if isinstance(track, dict) else None
            if row:
                track = dict(track, **{field: row[column] for field, column in PRESERVED_FIELDS})
            prepared.append(track)
        token = _KNOWN_ASSETS.set(known)
        try:
            return original(database_path, prepared, name)
        finally:
            _KNOWN_ASSETS.reset(token)
    return write

def make_visible_crate_writer(original):
    """Wrap app._write_serato_modern_visible_crate to pick the drive's database."""
    def write(tracks, name, database_path=None):
        if database_path is None:
            database_path = str(database_for_tracks(tracks))
        return original(tracks, name, database_path)
    return write

def install(app):
    if getattr(app, '_windows_serato_library_installed', False):
        return
    folder = library_folder()
    app.SERATO_MODERN_LIBRARY_DB = str(folder / 'root.sqlite')
    app._serato_modern_library_candidates = lambda: [str(folder / 'root.sqlite'), str(folder / 'master.sqlite')]
    app._serato_modern_portable_id = portable_id
    app._serato_modern_track_fields = make_track_fields(app._serato_modern_track_fields)
    app._write_serato_modern_visible_crate = make_visible_crate_writer(app._write_serato_modern_visible_crate)
    app._write_serato_modern_crate_to_database = make_crate_database_writer(app._write_serato_modern_crate_to_database)
    app._windows_serato_library_installed = True



# ---------------------------------------------------------------- crate folders (subcrates)
# Serato DJ Pro 5 (observed 2026-11-13, see investigation.md): a subcrate is a container row whose parent_id is the
# parent crate's id; list_order is the 1-based position among its siblings; every crate has a dj_container_metadata
# row naming its legacy file ("Parent%%Child.crate"). Serato also mirrors each crate into <drive>\_Serato_\Subcrates
# and neworder.pref, so both are written here (windows_crate_publish) after the database write is verified.

class SeratoOpenError(SeratoLibraryError):
    code = 'serato_open'


class CrateExistsError(SeratoLibraryError):
    code = 'crate_exists'


_FOLDER_STATE = {'snapshot': None, 'ledger': None, 'backups': None}


def configure_folders(snapshot=None, ledger=None, backups=None):
    """Tests and the launcher may replace the process list, the ledger file and the backup folder."""
    for key, value in (('snapshot', snapshot), ('ledger', ledger), ('backups', backups)):
        if value is not None:
            _FOLDER_STATE[key] = value


def _data_folder():
    return Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local') / 'AXIOM DJ'


def _ledger_file():
    return Path(_FOLDER_STATE['ledger'] or _data_folder() / 'serato-crates.json')


def _ledger_key(database, crate):
    return ntpath.normcase(str(Path(database))) + '|' + crate.casefold()


def _ledger_read():
    try:
        import json
        data = json.loads(_ledger_file().read_text(encoding='utf-8'))
        return set(data['crates']) if isinstance(data, dict) else set()
    except (OSError, ValueError, KeyError, TypeError):
        return set()


def _ledger_forget(key):
    import json
    keys = _ledger_read()
    keys.discard(key)
    path = _ledger_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps({'version': 1, 'crates': sorted(keys)}, indent=1), encoding='utf-8')
    os.replace(temp, path)


def _ledger_add(database, crate):
    """Remember that PEAK HOUR created this crate, so a later export may replace its tracks without asking."""
    import json
    keys = _ledger_read()
    keys.add(_ledger_key(database, crate))
    path = _ledger_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    with open(temp, 'w', encoding='utf-8') as handle:
        json.dump({'version': 1, 'crates': sorted(keys)}, handle, indent=1)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def clean_crate_part(name):
    """One crate name as Serato accepts it in a path: no separators, control or reserved characters."""
    import re
    cleaned = re.sub(r'\.crate$', '', str(name if name is not None else '').strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r'(%%|[/\\])', ' - ', cleaned)
    cleaned = re.sub(r'[\x00-\x1f:<>"|?*]', '', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip(' .')
    if not cleaned:
        raise SeratoLibraryError('A Serato crate needs a name.')
    return cleaned[:140]


def _ensure_serato_closed(snapshot=None):
    from windows_serato_processes import ProcessInspectionError, require_serato_closed, snapshot_processes
    try:
        require_serato_closed(snapshot or _FOLDER_STATE['snapshot'] or snapshot_processes)
    except ProcessInspectionError as exc:
        text = str(exc)
        if text.startswith('Close '):
            raise SeratoOpenError(text + ' Nothing was written.') from None
        raise SeratoLibraryError(text + ' Nothing was written.') from None


_ASSET_INSERT = """
    INSERT INTO asset(revision, portable_id, file_name, file_size, file_bit_rate, file_sample_rate,
        type, format, artist, color, comments, comment_language, comment_descriptor, grouping, remixer,
        name, album, composer, year, genre, key, label, bpm, length_sec, length_ms, time_added,
        time_modified, part_of_set, track_number, video_portable_id, is_corrupt, corrupt_description,
        is_missing, is_readonly, is_beatgrid_locked, third_party_type, is_stale, is_whitelabel,
        is_karaoke, dj_play_count, dj_recently_played, analysis_flags, architectures, stems_analyze_state,
        type_specific_data, rating, emoji, import_id, explicit, pending_tempo_map_analysis)
    VALUES (?, ?, ?, ?, 0, 0, 'audio', ?, ?, NULL, '', '', '', '', '', ?, '', '', ?, '', ?, '', ?,
        0, 0, ?, ?, '', '', NULL, 0, NULL, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, NULL, '', NULL, 0, NULL)
"""


def _container_snapshot(connection):
    return [tuple(row) for row in connection.execute(
        'SELECT id, revision, parent_id, name, type, list_order, space_id, time_added, expanded, portable_id, color '
        'FROM container ORDER BY id')]


def _members(connection, container_id):
    return [row[0] for row in connection.execute(
        'SELECT a.portable_id FROM container_asset ca JOIN space_asset sa ON sa.id = ca.space_asset_id '
        'JOIN asset a ON a.id = sa.asset_id WHERE ca.container_id = ? ORDER BY ca.list_order, ca.id', (container_id,))]


def _write_folder_rows(app, connection, tracks, parts, overwrite, owned, snapshot):
    """Everything in one open transaction; returns (result, container ids touched)."""
    import sqlite3
    import time
    from utils.serato_review_collection import _insert_space_asset, _space_asset_has_revision
    if app._serato_modern_schema_kind(connection) != 'root':
        raise SeratoLibraryError('Unsupported Serato library schema for crate writing.')
    root_id, space_id = app._serato_modern_root_container(connection)
    has_revision = _space_asset_has_revision(connection)
    now = int(time.time())
    connection.execute('BEGIN IMMEDIATE')
    revision = app._serato_modern_revision(connection)
    created, parent_id, container_id, existing_leaf, canonical = [], root_id, None, False, []
    for depth, name in enumerate(parts):
        leaf = depth == len(parts) - 1
        row = connection.execute('SELECT id, name FROM container WHERE parent_id = ? AND name = ? COLLATE NOCASE AND type = 1',
                                 (parent_id, name)).fetchone()
        if row:
            container_id = int(row[0])
            existing_leaf = leaf
            name = row[1]  # Serato's own spelling of an existing crate (names match without regard to case)
        else:
            order = connection.execute('SELECT COALESCE(MAX(list_order), 0) + 1 FROM container WHERE parent_id = ?',
                                       (parent_id,)).fetchone()[0]
            connection.execute("INSERT INTO container(revision, parent_id, name, type, list_order, space_id, time_added, "
                               "expanded, portable_id, color) VALUES (?, ?, ?, 1, ?, ?, ?, ?, '', NULL)",
                               (revision, parent_id, name, int(order or 1), space_id, now, 0 if leaf else 1))
            container_id = int(connection.execute('SELECT last_insert_rowid()').fetchone()[0])
            created.append((container_id, '%%'.join(canonical + [name])))
            existing_leaf = False
        canonical.append(name)
        parent_id = container_id
    seen, wanted, missing, duplicate, new_assets = set(), [], 0, 0, 0
    for track in tracks:
        fields = app._serato_modern_track_fields(track)
        if not fields.get('path') or not os.path.isfile(fields['path']):
            missing += 1
        key = fields['portable_id'].casefold()
        if key in seen:
            duplicate += 1
            continue
        seen.add(key)
        wanted.append(fields)
    desired = [f['portable_id'] for f in wanted]
    unchanged = False
    if existing_leaf:
        current = _members(connection, container_id)
        unchanged = [p.casefold() for p in current] == [p.casefold() for p in desired]
        if not unchanged and not overwrite and not owned:
            raise CrateExistsError('The Serato crate "' + '%%'.join(parts).replace('%%', ' > ') +
                                   '" already exists and PEAK HOUR did not create it. Confirm to replace its tracks.')
    if not unchanged:
        if existing_leaf:
            connection.execute('UPDATE container SET revision = ?, space_id = ?, time_added = COALESCE(time_added, ?) '
                               'WHERE id = ?', (revision, space_id, now, container_id))
            connection.execute('DELETE FROM container_asset WHERE container_id = ?', (container_id,))
        for position, fields in enumerate(wanted, 1):
            asset = connection.execute('SELECT id FROM asset WHERE portable_id = ? COLLATE NOCASE',
                                       (fields['portable_id'],)).fetchone()
            if asset:
                asset_id = int(asset[0])  # Serato's own row is kept as it is: a crate export only adds membership
            else:
                connection.execute(_ASSET_INSERT, (revision, fields['portable_id'], fields['file_name'], fields['file_size'],
                                                   fields['format'], fields['artist'], fields['title'], fields['year'],
                                                   fields['key'], fields['bpm'], now, now))
                asset_id = int(connection.execute('SELECT last_insert_rowid()').fetchone()[0])
                new_assets += 1
                try:
                    connection.execute('INSERT OR IGNORE INTO dj_asset_metadata(asset_id, revision, has_read_tags) VALUES (?, ?, 0)',
                                       (asset_id, revision))
                except sqlite3.Error:
                    pass
            space_asset = connection.execute('SELECT id FROM space_asset WHERE asset_id = ? AND space_id = ?',
                                             (asset_id, space_id)).fetchone()
            if space_asset:
                space_asset_id = int(space_asset[0])
                if has_revision:
                    connection.execute('UPDATE space_asset SET revision = ? WHERE id = ?', (revision, space_asset_id))
            else:
                space_asset_id = _insert_space_asset(connection, asset_id, space_id, revision)
            connection.execute('INSERT INTO container_asset(revision, container_id, space_asset_id, list_order, time_added) '
                               'VALUES (?, ?, ?, ?, ?)', (revision, container_id, space_asset_id, position, now))
    names = dict(created)
    if not unchanged:
        names[container_id] = '%%'.join(canonical)
    new_ids = {cid for cid, _ in created}
    for cid, crate in names.items():
        try:
            # a crate Serato already knows keeps its export_state; only crates made now get a fresh row
            verb = 'INSERT OR REPLACE' if cid in new_ids else 'INSERT OR IGNORE'
            connection.execute(verb + ' INTO dj_container_metadata(container_id, revision, export_state, filename) '
                               'VALUES (?, ?, 0, ?)', (cid, revision, crate + '.crate'))
        except sqlite3.Error:
            pass
    if _members(connection, container_id) != desired and not unchanged:
        raise SeratoLibraryError('The crate did not read back as written; nothing was kept.')
    return {'container_id': container_id, 'created': [name for _, name in created], 'desired': desired,
            'unchanged': unchanged, 'new_assets': new_assets, 'missing': missing, 'duplicate': duplicate,
            'revision': revision, 'created_ids': [cid for cid, _ in created], 'noop': bool(unchanged and not created),
            'replaced': bool(existing_leaf and not unchanged), 'parts': canonical}


def _verify_folder(database, before_containers, before_assets, outcome, parts):
    import sqlite3
    connection = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True)
    try:
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or connection.execute('PRAGMA foreign_key_check').fetchall():
            raise SeratoLibraryError('The Serato library failed its integrity check after the write.')
        if connection.execute('SELECT COUNT(*) FROM asset').fetchone()[0] != before_assets + outcome['new_assets']:
            raise SeratoLibraryError('The Serato asset count changed unexpectedly.')
        touched = set(outcome['created_ids'])
        if outcome['replaced'] or outcome['container_id'] in touched:
            touched.add(outcome['container_id'])
        after = {row[0]: row for row in _container_snapshot(connection)}
        for row in before_containers:
            if row[0] not in touched and after.get(row[0]) != row:
                raise SeratoLibraryError('An existing Serato crate changed unexpectedly.')
        if _members(connection, outcome['container_id']) != outcome['desired']:
            raise SeratoLibraryError('The crate did not read back as written.')
        parent_id = None
        for depth, name in enumerate(parts):  # the whole path resolves, parent to child
            if depth == 0:
                row = connection.execute("SELECT c.id FROM container c JOIN container r ON r.id = c.parent_id "
                                         "WHERE r.name = 'Serato Library root' AND c.name = ? COLLATE NOCASE AND c.type = 1",
                                         (name,)).fetchone()
            else:
                row = connection.execute('SELECT id FROM container WHERE parent_id = ? AND name = ? COLLATE NOCASE AND type = 1',
                                         (parent_id, name)).fetchone()
            if not row:
                raise SeratoLibraryError('The crate path did not read back as written.')
            parent_id = row[0]
        if parent_id != outcome['container_id']:
            raise SeratoLibraryError('The crate path did not read back as written.')
    finally:
        connection.close()


def write_crate_folder(app, tracks, path_parts, *, overwrite=False, database_path=None, backup_dir=None, snapshot=None):
    """Write a crate at path_parts (any depth >= 1, last item = the crate holding the tracks) into the location
    database of the tracks' drive, plus Serato's legacy Subcrates file and neworder.pref lines.

    Parents are found by name (case-insensitive) or created; existing crates are never renamed or removed. The leaf's
    tracks are replaced only if PEAK HOUR created that crate before or overwrite is True. The database is backed up
    first and put back, with the legacy files, if any later step fails."""
    import shutil
    import sqlite3
    import time
    import uuid
    from windows_crate_publish import legacy_crate_name, restore_file, update_neworder, write_legacy_crate
    parts = [clean_crate_part(p) for p in (path_parts if isinstance(path_parts, (list, tuple)) else [path_parts])]
    if not parts or len(parts) > 12:
        raise SeratoLibraryError('Choose a crate name, or a folder path of up to 12 levels.')
    tracks = [t if isinstance(t, dict) else {'path': str(t)} for t in tracks or []]
    if not tracks:
        raise SeratoLibraryError('No tracks were supplied for the Serato crate.')
    database = Path(database_path) if database_path else database_for_tracks(tracks)
    if not database.is_file() or database.parent.name.casefold() != 'library':
        raise SeratoLibraryError('Serato has not set up a library here yet: ' + str(database))
    serato_root = database.parent.parent
    _refuse_wal(database)
    known = existing_assets(database)
    prepared = []
    for track in tracks:
        row = known.get(portable_id(track.get('path', '')).casefold())
        prepared.append(dict(track, **{field: row[column] for field, column in PRESERVED_FIELDS}) if row else track)
    leaf = '%%'.join(parts)
    owned = _ledger_key(database, leaf) in _ledger_read()
    _ensure_serato_closed(snapshot)
    backups = Path(backup_dir or _FOLDER_STATE['backups'] or _data_folder() / 'serato-crate-writes')
    identifier = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
    receipt_folder = backups / identifier
    receipt_folder.mkdir(parents=True, exist_ok=True)
    backup = receipt_folder / 'location.sqlite.bak'
    receipt = {'kind': 'peakhour_serato_crates', 'id': identifier, 'created_at': time.time(), 'status': 'writing',
               'database': str(database), 'backup': str(backup), 'legacy': [], 'crate': '%%'.join(parts)}
    _save_receipt(receipt_folder, receipt)
    source = sqlite3.connect(database, timeout=5.0)
    try:
        target = sqlite3.connect(backup)
        try:
            source.backup(target)
        finally:
            target.close()
        _fsync_path(backup)  # the backup is on disk before the library is changed
        before_assets = source.execute('SELECT COUNT(*) FROM asset').fetchone()[0]
        before_containers = _container_snapshot(source)
    finally:
        source.close()
    legacy_before, warnings = {}, []
    connection = sqlite3.connect(database, timeout=5.0, isolation_level=None)
    connection.row_factory = sqlite3.Row
    committed = False
    token = _KNOWN_ASSETS.set(known)
    try:
        connection.execute('PRAGMA foreign_keys=ON')
        outcome = _write_folder_rows(app, connection, prepared, parts, overwrite, owned, snapshot)
        parts = outcome['parts']  # existing crates keep Serato's own spelling
        leaf = '%%'.join(parts)
        _ensure_serato_closed(snapshot)  # last look before the commit
        if outcome['noop']:  # already exactly as wanted: keep Serato's revision counters as they are
            connection.execute('ROLLBACK')
        else:
            connection.execute('COMMIT')
            committed = True
        connection.close()
        _verify_folder(database, before_containers, before_assets, outcome, parts)
        names = ['%%'.join(parts[:i + 1]) for i in range(len(parts))]
        crate_file = legacy_crate_name(parts)
        try:
            write_legacy_crate(serato_root, parts, outcome['desired'], legacy_before)
            update_neworder(serato_root, names, legacy_before)
        except Exception as legacy_error:
            if len(parts) != 1:
                raise
            # a plain crate already works from the database rows alone (the old behaviour): keep them, report the files
            for path, old in list(legacy_before.items()):
                try:
                    restore_file(path, old)
                except Exception:
                    pass
            legacy_before.clear()
            warnings.append("The crate is in Serato's library, but PEAK HOUR could not write Serato's legacy crate file "
                            f'or crate order ({legacy_error}).')
        if leaf in outcome['created']:
            _ledger_add(database, leaf)
            receipt['ledger_key'] = _ledger_key(database, leaf)
        if outcome['noop'] and not legacy_before:  # nothing changed anywhere: no backup is needed
            shutil.rmtree(receipt_folder, ignore_errors=True)
            identifier = ''
        else:
            for number, (path, old) in enumerate(legacy_before.items()):  # previous bytes of every file touched
                kept = None
                if old is not None:
                    kept = f'legacy-{number}.bin'
                    (receipt_folder / kept).write_bytes(old)
                receipt['legacy'].append({'path': str(path), 'before': kept})
            receipt.update(status='written', after_sha256=_state_sha(database))
            _save_receipt(receipt_folder, receipt)
    except BaseException as error:
        try:
            connection.close()
        except Exception:
            pass
        problem = None
        try:
            if committed:
                _restore_database(backup, database)
            else:
                pass  # the transaction was never committed; closing the connection rolled it back
            for path, old in legacy_before.items():
                restore_file(path, old)
        except Exception as failure:
            problem = failure
        if problem is not None:
            raise SeratoLibraryError(f'{error} PEAK HOUR could not put the Serato library back ({problem}); '
                                     f'the backup is {backup}.') from error
        raise
    finally:
        _KNOWN_ASSETS.reset(token)
    return {'success': True, 'database_path': str(database), 'backup_path': str(backup), 'container_id': outcome['container_id'],
            'backup_id': identifier, 'crate_name': leaf, 'path_parts': parts, 'created_crates': outcome['created'], 'unchanged': outcome['unchanged'],
            'replaced_existing': outcome['replaced'], 'exported_tracks': len(outcome['desired']),
            'verified_tracks': len(outcome['desired']), 'missing_tracks': outcome['missing'],
            'duplicate_tracks': outcome['duplicate'], 'new_assets': outcome['new_assets'],
            'legacy_crate': str(serato_root / 'Subcrates' / crate_file), 'neworder': str(serato_root / 'neworder.pref'),
            'warnings': warnings, 'delivery_verified': True}



def _file_sha(path):
    import hashlib
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _state_sha(database):
    """Hash of the database as Serato would see it: the file and its write-ahead log (if there is one)."""
    import hashlib
    digest = hashlib.sha256(_file_sha(database).encode())
    wal = Path(str(database) + '-wal')
    if wal.is_file() and wal.stat().st_size:
        digest.update(b'-wal' + _file_sha(wal).encode())
    return digest.hexdigest()


def _refuse_wal(database):
    """A non-empty -wal holds changes that are not in location.sqlite yet; replacing the file would lose or corrupt them."""
    wal = Path(str(database) + '-wal')
    if wal.is_file() and wal.stat().st_size:
        raise SeratoLibraryError('Serato left unsaved changes next to its library (' + wal.name + '). Open Serato once and '
                                 'close it normally so it saves them, then try again. Nothing was written.')


def _restore_database(backup, database):
    """Put the backed-up library back; its -wal/-shm files belong to the file being replaced, so they go too
    (they were absent or empty when the write began)."""
    import shutil
    database = Path(database)
    stage = database.with_name(database.name + '.restoring')
    shutil.copyfile(backup, stage)
    _fsync_path(stage)
    os.replace(stage, database)
    for suffix in ('-wal', '-shm'):
        try:
            os.unlink(str(database) + suffix)
        except FileNotFoundError:
            pass


def _fsync_path(path):
    with open(path, 'rb+') as handle:
        os.fsync(handle.fileno())


def _save_receipt(folder, receipt):
    import json
    stage = Path(folder) / 'receipt.json.tmp'
    with open(stage, 'w', encoding='utf-8') as handle:
        handle.write(json.dumps(receipt, indent=1))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(stage, Path(folder) / 'receipt.json')


def undo_crate_write(backup_id, backup_dir=None, snapshot=None):
    """Put Serato's library, the legacy crate files and neworder.pref back as they were before that write.

    Refused while Serato is open, and when location.sqlite is no longer the file PEAK HOUR wrote (Serato or the owner
    changed it since): restoring would throw those changes away."""
    import json
    import re
    import shutil
    import time
    from windows_crate_publish import restore_file
    if not isinstance(backup_id, str) or not re.fullmatch(r'[0-9A-Za-z_-]{1,64}', backup_id):
        raise SeratoLibraryError('Unknown backup.')
    folder = Path(backup_dir or _FOLDER_STATE['backups'] or _data_folder() / 'serato-crate-writes') / backup_id
    try:
        receipt = json.loads((folder / 'receipt.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        raise SeratoLibraryError('There is no such Serato crate backup.') from None
    if receipt.get('kind') == 'peakhour_serato_crates_multi':  # a send that spanned drives: every drive goes back
        if receipt.get('status') not in ('written', 'partly_undone'):
            raise SeratoLibraryError('That write cannot be undone (it did not complete, or was undone already).')
        _ensure_serato_closed(snapshot)
        problems = []
        for entry in reversed(receipt['drives']):
            if not entry.get('backup_id') or entry.get('undone'):
                continue
            try:
                undo_crate_write(entry['backup_id'], backup_dir=entry['backup_dir'], snapshot=snapshot)
                entry['undone'] = True
            except SeratoLibraryError as exc:
                problems.append(f"{entry['drive']}: {exc}")
        receipt.update(status='partly_undone' if problems else 'undone', undone_at=time.time())
        _save_receipt(folder, receipt)
        if problems:
            exc = SeratoLibraryError('Not every drive could be put back. ' + ' '.join(problems))
            exc.code = 'changed'
            raise exc
        return {'success': True, 'backup_id': backup_id, 'drives': [e['drive'] for e in receipt['drives'] if e.get('backup_id')]}
    if receipt.get('kind') != 'peakhour_serato_crates' or receipt.get('status') != 'written':
        raise SeratoLibraryError('That write cannot be undone (it did not complete, or was undone already).')
    _ensure_serato_closed(snapshot)
    database, backup = Path(receipt['database']), Path(receipt['backup'])
    _refuse_wal(database)
    if not database.is_file() or _state_sha(database) != receipt['after_sha256']:
        exc = SeratoLibraryError('Serato has changed its library since PEAK HOUR added this crate, so PEAK HOUR will not '
                                 'put the old copy back: that would undo your later changes in Serato. Nothing was changed. '
                                 'Remove the crate in Serato instead.')
        exc.code = 'changed'
        raise exc
    if not backup.is_file():
        raise SeratoLibraryError('The backup of the library is missing. Nothing was changed.')
    _restore_database(backup, database)
    for item in receipt['legacy']:
        old = (folder / item['before']).read_bytes() if item['before'] else None
        restore_file(item['path'], old)
    if receipt.get('ledger_key'):
        _ledger_forget(receipt['ledger_key'])
    receipt.update(status='undone', undone_at=time.time())
    _save_receipt(folder, receipt)
    return {'success': True, 'backup_id': backup_id, 'restored': str(database)}


def _folder_request(tracks, path_parts):
    parts = [clean_crate_part(p) for p in (path_parts if isinstance(path_parts, (list, tuple)) else [path_parts])]
    if not parts or len(parts) > 12:
        raise SeratoLibraryError('Choose a crate name, or a folder path of up to 12 levels.')
    tracks = [t if isinstance(t, dict) else {'path': str(t)} for t in tracks or []]
    if not tracks:
        raise SeratoLibraryError('No tracks were supplied for the Serato crate.')
    return tracks, parts


def preview_crate_folder(app, tracks, path_parts, *, overwrite=False, database_path=None):
    """What write_crate_folder would do, read-only: which crates are new, whether the last one exists and may be replaced."""
    import sqlite3
    tracks, parts = _folder_request(tracks, path_parts)
    database = Path(database_path) if database_path else database_for_tracks(tracks)
    if not database.is_file():
        raise SeratoLibraryError('Serato has not set up a library here yet: ' + str(database))
    wanted, seen = [], set()
    for track in tracks:
        pid = portable_id(track.get('path', ''))
        if pid.casefold() not in seen:
            seen.add(pid.casefold())
            wanted.append(pid)
    connection = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True)
    try:
        row = connection.execute("SELECT id FROM container WHERE name = 'Serato Library root' ORDER BY id LIMIT 1").fetchone()
        parent_id, existing, create = (row[0] if row else None), [], []
        for depth, name in enumerate(parts):
            found = connection.execute('SELECT id FROM container WHERE parent_id = ? AND name = ? COLLATE NOCASE AND type = 1',
                                       (parent_id, name)).fetchone() if parent_id is not None else None
            if found:
                existing.append('%%'.join(parts[:depth + 1]))
                parent_id = found[0]
            else:
                create.append('%%'.join(parts[:depth + 1]))
                parent_id = None
        leaf_exists = len(existing) == len(parts)
        current = _members(connection, parent_id) if leaf_exists else []
        known = {r[0].casefold() for r in connection.execute('SELECT portable_id FROM asset')}
    finally:
        connection.close()
    leaf = '%%'.join(parts)
    owned = _ledger_key(database, leaf) in _ledger_read()
    unchanged = leaf_exists and [p.casefold() for p in current] == [p.casefold() for p in wanted]
    return {'database_path': str(database), 'crate_path': parts, 'crate_name': leaf, 'will_create': create,
            'leaf_exists': leaf_exists, 'created_by_peak_hour': owned, 'unchanged': unchanged,
            'will_replace': bool(leaf_exists and not unchanged),
            'needs_confirm': bool(leaf_exists and not unchanged and not owned and not overwrite),
            'tracks': len(wanted), 'new_assets': sum(1 for p in wanted if p.casefold() not in known), 'tracklist': wanted}


def digest_crate_folder(app, tracks, path_parts, *, overwrite=False, database_path=None):
    import hashlib
    import json
    plan = preview_crate_folder(app, tracks, path_parts, overwrite=overwrite, database_path=database_path)
    return hashlib.sha256(json.dumps(plan, sort_keys=True).encode('utf-8')).hexdigest()


# ---------------------------------------------------------------- one send, several drives
# Serato keeps one library per drive, so a set that spans drives is written as the same crate path on each drive that has a
# Serato library, with that drive's songs in their order. Songs that cannot go anywhere are skipped one by one, with a reason.

_is_file = os.path.isfile  # tests may replace this
SKIP_LABELS = {'missing': 'file not found', 'system_drive': 'on {drive}', 'no_library': 'no Serato library', 'bad_path': 'not a local file'}


def _title_of(track, path):
    title = track.get('title') if isinstance(track, dict) else ''
    return str(title or os.path.splitext(ntpath.basename(str(path)))[0])


def split_tracks_by_drive(tracks):
    """({drive: [track dicts, in order]}, [skipped {path, title, reason, code}]). A song is skipped (never the whole send) if its
    file is missing, it is on the system drive (Serato's newer library there is not supported), its drive has no Serato
    library, or it has no drive letter."""
    groups, skipped = {}, []
    for track in tracks or []:
        track = track if isinstance(track, dict) else {'path': str(track)}
        path = str(track.get('path') or '')
        drive = ntpath.splitdrive(path)[0].upper()

        def skip(code, reason):
            skipped.append({'path': path, 'title': _title_of(track, path), 'reason': reason, 'code': code})
        if len(drive) != 2 or drive[1] != ':' or not ntpath.isabs(path):
            skip('bad_path', 'not a file on a local drive')
        elif drive == system_drive():
            skip('system_drive', f"on {drive} (Serato's library on the system drive is not supported yet)")
        elif not _is_file(path):
            skip('missing', 'file not found')
        elif not location_database(drive).is_file():
            skip('no_library', f'no Serato library on {drive} (open Serato once with that drive connected)')
        else:
            groups.setdefault(drive, []).append(track)
    return groups, skipped


def _skip_counts(skipped):
    counts = {}
    for item in skipped:
        label = SKIP_LABELS[item['code']].format(drive=ntpath.splitdrive(item['path'])[0].upper())
        counts[label] = counts.get(label, 0) + 1
    return counts


def _summary(drives, skipped, key='songs_to_write'):
    text = ', '.join(f"{d[key]} song{'s' if d[key] != 1 else ''} on {d['drive']}" for d in drives) or 'no songs'
    if skipped:
        text += f"; {len(skipped)} skipped (" + ', '.join(f'{n} {label}' for label, n in _skip_counts(skipped).items()) + ')'
    return 'Serato: ' + text


def preview_crate_folders(app, tracks, path_parts, *, overwrite=False):
    """What write_crate_folders would do, read only.

    {'success', 'crate_path', 'crate_name',
     'drives': [{'drive', 'database_path', 'crate_path', 'songs_to_write', 'new_assets', 'will_create', 'leaf_exists',
                 'created_by_peak_hour', 'unchanged', 'will_replace', 'needs_confirm'}],
     'skipped': [{'path', 'title', 'reason', 'code'}], 'skipped_counts': {label: n}, 'summary': 'Serato: 52 songs on D:, ...',
     'songs_to_write', 'tracks', 'new_assets', 'will_create', 'leaf_exists', 'list_exists', 'unchanged', 'will_replace',
     'needs_confirm'}   (the flat fields summarise all drives)"""
    tracks, parts = _folder_request(tracks, path_parts)
    groups, skipped = split_tracks_by_drive(tracks)
    drives = []
    for drive, drive_tracks in groups.items():
        plan = preview_crate_folder(app, drive_tracks, parts, overwrite=overwrite, database_path=location_database(drive))
        plan.pop('tracklist', None)
        drives.append(dict(plan, drive=drive, songs_to_write=plan['tracks']))
    leaf = '%%'.join(parts)
    return {'success': True, 'crate_path': parts, 'crate_name': leaf, 'drives': drives, 'skipped': skipped,
            'skipped_counts': _skip_counts(skipped), 'summary': _summary(drives, skipped),
            'songs_to_write': sum(d['songs_to_write'] for d in drives), 'tracks': sum(d['songs_to_write'] for d in drives),
            'new_assets': sum(d['new_assets'] for d in drives),
            'will_create': sorted({name for d in drives for name in d['will_create']}),
            'leaf_exists': any(d['leaf_exists'] for d in drives), 'list_exists': any(d['leaf_exists'] for d in drives),
            'created_by_peak_hour': bool(drives) and all(d['created_by_peak_hour'] for d in drives if d['leaf_exists']),
            'unchanged': bool(drives) and all(d['unchanged'] for d in drives),
            'will_replace': any(d['will_replace'] for d in drives), 'needs_confirm': any(d['needs_confirm'] for d in drives)}


def digest_crate_folders(app, tracks, path_parts, *, overwrite=False):
    """Stable hash of what each target crate holds and would get. Songs skipped for missing files are left out, so only a change
    to a target crate (or to which songs go where) makes a queued job stale."""
    import hashlib
    import json
    plan = preview_crate_folders(app, tracks, path_parts, overwrite=overwrite)
    core = [{k: d[k] for k in ('drive', 'database_path', 'crate_path', 'leaf_exists', 'unchanged', 'will_create', 'songs_to_write')}
            for d in plan['drives']]
    return hashlib.sha256(json.dumps({'crate': plan['crate_path'], 'drives': core, 'overwrite': bool(overwrite)}, sort_keys=True).encode()).hexdigest()


def write_crate_folders(app, tracks, path_parts, *, overwrite=False, backup_dir=None, snapshot=None):
    """Write the crate path on every drive that holds songs of the set (see write_crate_folder), one transaction and backup per
    drive and ONE receipt for the whole send. If a later drive fails the earlier ones are rolled back. Raises only if no song
    can be written at all. Result: preview_crate_folders' fields (drives, skipped, summary) with the written numbers, and
    'backup_id' (undo with undo_crate_write)."""
    import shutil
    import time
    import uuid
    tracks, parts = _folder_request(tracks, path_parts)
    groups, skipped = split_tracks_by_drive(tracks)
    if not groups:
        counts = ', '.join(f'{n} {label}' for label, n in _skip_counts(skipped).items())
        raise SeratoLibraryError('None of these songs can be sent to Serato' + (f' ({counts}).' if counts else '.') + ' Nothing was written.')
    _ensure_serato_closed(snapshot)
    backups = Path(backup_dir or _FOLDER_STATE['backups'] or _data_folder() / 'serato-crate-writes')
    identifier = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
    folder = backups / identifier
    folder.mkdir(parents=True, exist_ok=True)
    receipt = {'kind': 'peakhour_serato_crates_multi', 'id': identifier, 'created_at': time.time(), 'status': 'writing', 'drives': [],
               'crate': '%%'.join(parts)}
    _save_receipt(folder, receipt)
    written = []
    try:
        for drive, drive_tracks in groups.items():
            sub = folder / ('drive-' + drive[0])
            result = write_crate_folder(app, drive_tracks, parts, overwrite=overwrite, database_path=location_database(drive),
                                        backup_dir=sub, snapshot=snapshot)
            written.append((drive, result))
            receipt['drives'].append({'drive': drive, 'backup_id': result['backup_id'], 'backup_dir': str(sub)})
            _save_receipt(folder, receipt)
    except BaseException as error:
        problems = []
        for drive, result in reversed(written):  # this send leaves nothing half done
            if result['backup_id']:
                try:
                    undo_crate_write(result['backup_id'], backup_dir=folder / ('drive-' + drive[0]), snapshot=snapshot)
                except Exception as exc:
                    problems.append(f'{drive} {exc}')
        receipt['status'] = 'rolled_back' if not problems else 'rollback_failed'
        try:
            _save_receipt(folder, receipt)
        except OSError:
            pass
        if problems:
            raise SeratoLibraryError(f'{error} PEAK HOUR could not put back what it had written on the other drives ({"; ".join(problems)}).') from error
        raise
    if not any(result['backup_id'] for _, result in written):  # everything was already as wanted
        shutil.rmtree(folder, ignore_errors=True)
        identifier = ''
    else:
        receipt['status'] = 'written'
        _save_receipt(folder, receipt)
    drives = [dict(result, drive=drive, songs_to_write=result['exported_tracks'], crate_path=result['path_parts'])
              for drive, result in written]
    first = written[0][1]
    return {'success': True, 'delivery_verified': True, 'backup_id': identifier, 'crate_path': first['path_parts'], 'crate_name': first['crate_name'],
            'path_parts': first['path_parts'], 'drives': drives, 'skipped': skipped, 'skipped_counts': _skip_counts(skipped),
            'summary': _summary(drives, skipped), 'songs_to_write': sum(d['exported_tracks'] for d in drives),
            'exported_tracks': sum(r['exported_tracks'] for _, r in written), 'verified_tracks': sum(r['verified_tracks'] for _, r in written),
            'missing_tracks': sum(r['missing_tracks'] for _, r in written), 'duplicate_tracks': sum(r['duplicate_tracks'] for _, r in written),
            'new_assets': sum(r['new_assets'] for _, r in written), 'created_crates': sorted({n for _, r in written for n in r['created_crates']}),
            'unchanged': all(r['unchanged'] for _, r in written), 'replaced_existing': any(r['replaced_existing'] for _, r in written),
            'database_path': first['database_path'], 'backup_path': first['backup_path'], 'legacy_crate': first['legacy_crate'],
            'neworder': first['neworder'], 'warnings': [w for _, r in written for w in r['warnings']]}
