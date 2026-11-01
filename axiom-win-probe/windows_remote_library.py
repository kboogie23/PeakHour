"""DJ-database uploads for a laptop's own AXIOM library (Windows hub).

AXIOM's /api/library/connect_dj_source takes an uploaded rekordbox XML or
djay export from the browser and merges its songs with
_merge_connected_dj_tracks. A laptop using AXIOM through the hub
(windows_remote_hub) can upload its own library the same way; this adds two
more upload kinds to that route, parsed with the readers AXIOM already uses on
this PC:
- source "virtualdj": VirtualDJ's database.xml (windows_virtualdj_database);
- source "serato": Serato's "database V2" (AXIOM's _load_serato_library_tracks).
The songs keep the laptop's own file paths, stored as "laptop:" + path so that no
path can name a file on this PC (nothing here checks, opens or plays them), and are
marked needs_relink without looking (the files are on the laptop); BPM, key, year, genre and cue counts come
from the database. rekordbox and djay uploads go to AXIOM's own code unchanged.
"""
import ntpath
import os
import tempfile
from pathlib import Path

from flask import jsonify, request

from windows_virtualdj_database import read_database, VirtualDJDatabaseError
from windows_virtualdj_library import axiom_track, MEDIA_EXTENSIONS

UPLOAD_LIMIT = 256 * 1024 * 1024
SOURCES = {'virtualdj': 'VirtualDJ', 'serato': 'Serato'}
PREFIX = 'laptop:'  # not a valid Windows path: os.path.exists / isfile / open all fail on it


def on_laptop():
    return bool(os.environ.get('AXIOM_DEVICE_ID'))


def foreign(tracks):
    """A laptop's songs: paths that cannot resolve on this PC, never checked here."""
    return [dict(t, path=PREFIX + str(t.get('path') or ''), needs_relink=True) for t in tracks]


def virtualdj_tracks(app, path):
    tracks = []
    for track in read_database(path)['tracks']:
        name = track.get('path', '')
        extension = (ntpath.splitext(name)[1] or os.path.splitext(name)[1]).lower()
        if name and extension in MEDIA_EXTENSIONS:
            tracks.append(axiom_track(track, app, check_file=not on_laptop()))
    return foreign(tracks) if on_laptop() else tracks


def serato_tracks(app, path):
    loaded = app._load_serato_library_tracks(database_paths=[str(path)])
    tracks = loaded[0] if isinstance(loaded, tuple) else loaded
    if on_laptop():
        return foreign(tracks or [])
    return [dict(t, needs_relink=not os.path.isfile(str(t.get('path') or ''))) for t in tracks or []]


def make_connect_view(app, original):
    def connect_dj_source(*args, **kwargs):
        source = str(request.form.get('source') or '').strip().lower()
        if source not in SOURCES:
            return original(*args, **kwargs)
        gate = app._initial_activation_gate('connect a DJ library')  # as AXIOM's own route does first
        if gate:
            return gate
        upload = request.files.get('file')
        if upload is None or not upload.filename:
            return jsonify(success=False, error=f'Choose your {SOURCES[source]} database file.'), 400
        folder = Path(tempfile.mkdtemp(prefix='axiom-upload-', dir=os.path.dirname(app.CACHE_PATH)))
        target = folder / ('database.xml' if source == 'virtualdj' else 'database V2')
        try:
            written = 0
            with open(target, 'xb') as handle:
                while True:
                    chunk = upload.stream.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > UPLOAD_LIMIT:
                        raise ValueError('That database is larger than PEAK HOUR accepts (256 MB).')
                    handle.write(chunk)
            tracks = virtualdj_tracks(app, target) if source == 'virtualdj' else serato_tracks(app, target)
            if not tracks:
                return jsonify(success=False, error=f'No songs were found in that {SOURCES[source]} database.',
                               source_audio_untouched=True), 400
            cache, added, updated, policy, trimmed = app._merge_connected_dj_tracks(tracks, source)
            result = {'success': True, 'connection_source': source, 'scanned_count': len(tracks), 'added_count': added,
                      'updated_count': updated, 'total_tracks': cache.get('total_tracks', 0),
                      'message': f'{SOURCES[source]} library loaded: {len(tracks):,} songs read, {added:,} added to this library.',
                      'source_audio_untouched': True, 'dj_source_untouched': True}
            result.update(app._track_limit_payload(policy, trimmed))
            return jsonify(result)
        except (VirtualDJDatabaseError, ValueError, OSError) as exc:
            return jsonify(success=False, error=str(exc), source_audio_untouched=True), 400
        finally:
            for item in folder.glob('*'):
                item.unlink(missing_ok=True)
            folder.rmdir()
    return connect_dj_source


def install(app):
    flask_app = app.app
    for rule in flask_app.url_map.iter_rules():
        if rule.rule == '/api/library/connect_dj_source':
            view = flask_app.view_functions[rule.endpoint]
            if not getattr(view, '_windows_remote_library', False):
                wrapped = make_connect_view(app, view)
                wrapped._windows_remote_library = True
                flask_app.view_functions[rule.endpoint] = wrapped
            return True
    return False
