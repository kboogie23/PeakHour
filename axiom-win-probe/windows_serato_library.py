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
    pass

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
