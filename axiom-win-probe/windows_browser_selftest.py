"""Settings > System > "Run Browser Test": POST /api/browser/self_test.

Cheap, honest checks that the pieces PEAK HOUR's window depends on are really working on this PC:
the library is loaded, a sample of its songs exist and are in a format the player can open, the audio
stream answers, the browser layer is present and the folder picker is available.

Fast on a 49,000-song library: the library file is read at most once per change (its size and
modification time are the cache key; Settings clicks after that cost nothing), at most SAMPLE
songs are looked at on disk, and only the first bytes of one song are streamed. Nothing is rescanned
or written. Not available on a laptop's engine: it looks at this PC's files (also refused by the hub).
"""
import os
import threading
import time
from pathlib import Path

from flask import Blueprint, jsonify, request

from windows_filetypes import AUDIO

SAMPLE = 200  # songs looked at on disk
DIRECT = {'.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus'}  # served as they are; FLAC/AIFF would be converted (CPU, a file written)
HERE = Path(__file__).resolve().parent
_CACHE = {'key': None, 'total': 0, 'playable': 0, 'sample': []}
_LOCK = threading.Lock()


def library_summary(app):
    """(total songs, songs in a playable format, evenly spread sample of paths); the library file is re-read
    only when it changes. None when there is no library file."""
    try:
        stat = os.stat(app.CACHE_PATH)
    except OSError:
        return None
    key = (str(app.CACHE_PATH), stat.st_mtime_ns, stat.st_size)
    with _LOCK:
        if _CACHE['key'] != key:
            tracks = app._all_library_cache_tracks(app.load_cache(app.CACHE_PATH))
            paths = [str(t['path']) for t in tracks if isinstance(t, dict) and t.get('path')]
            step = max(1, len(paths) // SAMPLE)
            _CACHE.update(key=key, total=len(tracks), sample=paths[::step][:SAMPLE],
                          playable=sum(1 for p in paths if os.path.splitext(p)[1].lower() in AUDIO))
        return _CACHE['total'], _CACHE['playable'], list(_CACHE['sample'])


def stream_check(app, path, base_url):
    """(ok, detail): the first bytes of one song come back from the app's own stream address."""
    from urllib.parse import quote
    client = app.app.test_client()
    response = client.get('/api/library/stream?path=' + quote(path, safe=''), base_url=base_url,
                          headers={'Range': 'bytes=0-4095'}, buffered=False)
    try:
        first = next(iter(response.response), b'') if response.status_code in (200, 206) else b''
        if first:
            return True, f'Streaming answered ({response.status_code}) with audio data for {os.path.basename(path)}.'
        return False, f'The audio stream answered {response.status_code} without audio for {os.path.basename(path)}.'
    finally:
        response.close()


def run(app, base_url):
    started = time.perf_counter()
    checks = []

    def add(name, ok, detail):
        checks.append({'name': name, 'ok': bool(ok), 'detail': detail})

    summary = None
    try:
        summary = library_summary(app)
    except Exception as exc:
        add('library_loaded', False, f'The library could not be read: {exc}')
    total = playable = 0
    sample = []
    if summary is None:
        if not checks:
            add('library_loaded', False, 'No library yet. Choose a music source in Library to add your songs.')
    else:
        total, playable, sample = summary
        add('library_loaded', total > 0, f'{total:,} songs in the library.' if total else 'The library is empty. Choose a music source to add songs.')
    present = [p for p in sample if os.path.isfile(p)]
    if sample:
        missing = len(sample) - len(present)
        add('song_files', not missing, f'{len(present)} of {len(sample)} sampled songs were found on disk.' if not missing else
            f'{missing} of {len(sample)} sampled songs were not found. Reconnect the drive or use Library Health to repair paths.')
        add('playable_formats', total and playable * 10 >= total * 9,
            f'{playable:,} of {total:,} songs are in a format the player opens.' + ('' if playable == total else ' The rest (for example video or unusual formats) cannot be previewed.'))
    else:
        add('song_files', False, 'There are no songs to sample.')
        add('playable_formats', False, 'There are no songs to check.')
    direct = next((p for p in present if os.path.splitext(p)[1].lower() in DIRECT), None)
    if direct:
        try:
            add('audio_stream', *stream_check(app, direct, base_url))
        except Exception as exc:
            add('audio_stream', False, f'The audio stream failed: {exc}')
    elif present:
        add('audio_stream', True, 'Skipped: none of the sampled songs is in a format that streams directly (FLAC and AIFF are converted '
            'when played, which the test does not do).')
    else:
        add('audio_stream', False, 'No song file was available to test the audio stream with.')
    layer = [name for name in ('static/js/shared/windows-browser.js', 'windows_browser.py') if (HERE / name).is_file()]
    try:
        from windows_browser import BROWSERS, find
        installed = [info[0] for name, info in BROWSERS.items() if find(name)]
    except Exception:
        installed = []
    add('browser_layer', len(layer) == 2 and installed,
        'PEAK HOUR window browser layer is present; ' + (', '.join(installed) + ' installed.' if installed else 'neither Microsoft Edge nor Google Chrome is installed.'))
    picker = callable(getattr(app, 'choose_folder_dialog', None))
    try:
        import tkinter  # noqa: F401  (the Windows folder picker is built on it)
    except Exception:
        picker = False
    add('folder_picker', picker, 'The Windows folder picker is available.' if picker else 'The Windows folder picker is not available.')
    passed = sum(1 for c in checks if c['ok'])
    return {'success': passed == len(checks), 'total_tracks': total, 'playable_tracks': playable, 'checks': checks,
            'sampled': len(sample), 'elapsed_ms': int((time.perf_counter() - started) * 1000),
            'limitations': ['Only up to %d songs are looked at, spread across the library; use Library Health for a full check.' % SAMPLE,
                            'Playable means the file type is one PEAK HOUR can open; a damaged file is only found when it is played.',
                            'The test does not change your library or your music files.'],
            'message': f'{passed} of {len(checks)} browser checks passed.' + ('' if passed == len(checks) else ' See the rows marked Check.')}


def create_selftest_blueprint(app):
    blueprint = Blueprint('peak_hour_browser_selftest', __name__)

    @blueprint.post('/api/browser/self_test')
    def self_test():
        return jsonify(run(app, request.host_url))

    return blueprint
