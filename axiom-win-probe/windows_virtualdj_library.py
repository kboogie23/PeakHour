"""Connect VirtualDJ as an AXIOM library source on Windows (read-only).

AXIOM's macOS build connects Serato, rekordbox XML and djay exports; VirtualDJ
has no source. VirtualDJ keeps a database in its home folder and one per
drive (<drive>:\\VirtualDJ\\database.xml), so no export file is needed: every
database is read with windows_virtualdj_database.read_database and its media
tracks go through AXIOM's own _merge_connected_dj_tracks, shaped like AXIOM's
rekordbox tracks and using AXIOM's key, energy, era, BPM and year helpers.
"""
import ntpath
import os
from pathlib import Path

from windows_serato_paths import local_drive_roots
from windows_virtualdj_database import read_database, VirtualDJDatabaseError

MEDIA_EXTENSIONS = {'.mp3', '.wav', '.aif', '.aiff', '.flac', '.m4a', '.aac', '.ogg', '.alac', '.wma',
                    '.mp4', '.m4v', '.mov', '.avi', '.vob', '.mkv', '.mpg', '.mpeg', '.wmv'}


def database_paths(home=None, roots=None):
    """VirtualDJ's home database plus each local drive's VirtualDJ database."""
    found = []
    if home is None:
        for base in (os.environ.get('LOCALAPPDATA'), os.path.join(os.environ.get('USERPROFILE', ''), 'Documents')):
            if base and os.path.isfile(os.path.join(base, 'VirtualDJ', 'database.xml')):
                home = os.path.join(base, 'VirtualDJ')
                break
    if home:
        found.append(Path(home, 'database.xml'))
    for root in (local_drive_roots() if roots is None else roots):
        found.append(Path(root, 'VirtualDJ', 'database.xml'))
    unique = {}
    for path in found:
        if path.is_file():
            unique.setdefault(ntpath.normcase(str(path)), path)
    return list(unique.values())


def _attributes(track, section):
    entries = track.get('source_sections', {}).get(section) or [{}]
    return entries[0].get('attributes', {}) if len(entries) == 1 else {}


def file_checker():
    """os.path.isfile for many songs: one directory listing per folder instead of one call per file. A song on an
    external drive costs ~10 ms per isfile, so a 50,000-song database took minutes. Names a listing cannot answer
    (8.3 short names, trailing dots or spaces) and folders that cannot be listed use os.path.isfile."""
    listings = {}

    def isfile(path):
        folder, name = ntpath.split(path)
        key = ntpath.normcase(folder)
        names = listings.get(key)
        if names is None:
            try:
                with os.scandir(folder) as entries:
                    names = {ntpath.normcase(entry.name) for entry in entries if entry.is_file()}
            except OSError:
                names = False  # missing drive or folder: answered below
            listings[key] = names
        if names is False:
            return os.path.isfile(path)
        if ntpath.normcase(name) in names:
            return True
        return ('~' in name or name.endswith(('.', ' '))) and os.path.isfile(path)
    return isfile


def axiom_track(track, app, check_file=True, isfile=os.path.isfile):
    """AXIOM library record for one VirtualDJ database song (rekordbox-shaped)."""
    path = track['path']
    tags = _attributes(track, 'Tags')
    comment = (track.get('source_sections', {}).get('Comment') or [{}])[0].get('text', '')
    bpm = app.coerce_bpm_value(track.get('bpm')) if track.get('bpm') else None
    year = app.coerce_release_year(tags.get('Year')) if tags.get('Year') else None
    key_raw = track.get('key') or ''
    stem = ntpath.splitext(ntpath.basename(path))[0]
    return {
        'path': path, 'filename': ntpath.basename(path), 'folder': ntpath.basename(ntpath.dirname(path)),
        'title': tags.get('Title') or stem, 'artist': tags.get('Author') or 'Unknown Artist',
        'album': tags.get('Album', ''), 'genre': tags.get('Genre', ''), 'comments': comment, 'label': tags.get('Label', ''),
        'bpm': bpm, 'camelot': app.get_camelot(key_raw) if key_raw else None, 'key_raw': key_raw,
        'energy': app.classify_energy(bpm) if bpm else 'Unknown', 'year': year,
        'era': app.get_era_from_year(year) if year else 'Unknown',
        'playlist_names': [], 'cue_count': sum(1 for p in track.get('source_sections', {}).get('Poi', [])
                                               if p.get('attributes', {}).get('Type') == 'cue'),
        'beatgrid_locked': False, 'source': 'virtualdj_database', 'connected_from': 'virtualdj',
        'needs_relink': not isfile(path) if check_file else True,
    }


def read_tracks(app, paths=None):
    """(tracks, databases_read, errors) from every VirtualDJ database."""
    tracks, seen, read, errors = [], set(), 0, []
    isfile = file_checker()
    for database in (database_paths() if paths is None else paths):
        try:
            inventory = read_database(database)
        except VirtualDJDatabaseError as exc:
            errors.append(f'{database}: {exc}')
            continue
        read += 1
        for track in inventory['tracks']:
            path = track.get('path', '')
            key = ntpath.normcase(path)
            if (track.get('path_kind') != 'windows_absolute' or ntpath.splitext(path)[1].lower() not in MEDIA_EXTENSIONS
                    or key in seen):
                continue
            seen.add(key)
            tracks.append(axiom_track(track, app, isfile=isfile))
    return tracks, read, errors


def connect(app, paths=None):
    """Merge VirtualDJ's tracks into the AXIOM library; returns a JSON-ready dict."""
    tracks, read, errors = read_tracks(app, paths)
    if not tracks:
        detail = ' ' + errors[0] if errors else ''
        return {'success': False, 'error': 'PEAK HOUR could not find VirtualDJ tracks on this PC.' + detail,
                'source_audio_untouched': True, 'dj_source_untouched': True}
    cache, added, updated, policy, trimmed = app._merge_connected_dj_tracks(tracks, 'virtualdj')
    result = {'success': True, 'connection_source': 'virtualdj', 'scanned_count': len(tracks), 'added_count': added,
              'updated_count': updated, 'total_tracks': cache.get('total_tracks', 0), 'databases_read': read,
              'database_errors': errors, 'source_audio_untouched': True, 'dj_source_untouched': True,
              'message': f'VirtualDJ connected. PEAK HOUR read {len(tracks)} tracks from {read} VirtualDJ '
                         f"database{'s' if read != 1 else ''} and added them to your library."}
    result.update(app._track_limit_payload(policy, trimmed))  # as AXIOM's connect_dj_source does
    return result
