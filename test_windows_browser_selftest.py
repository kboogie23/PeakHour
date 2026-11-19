"""Settings > System > Run Browser Test (POST /api/browser/self_test): the real app, on a small sandbox library, answers in
the shape the report window reads, with real checks (library, files on disk, formats, audio stream, browser layer, folder
picker); it is fast, reads the library file only when it changes, reports missing files and an empty library honestly,
and laptops cannot reach it."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

workspace = Path(__file__).resolve().parent
sys.path.insert(0, str(workspace / 'axiom-win-probe'))
from windows_remote_hub import blocked

assert blocked('/api/browser/self_test')

SERVER = r'''
import sys, pathlib
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'data'
backend = L.build_app(port)
import windows_browser_selftest as S
calls = []
real = backend.load_cache
def counting(*a, **k):
    calls.append(1)
    return real(*a, **k)
backend.load_cache = counting
streamed = []
@backend.app.before_request
def note_stream():
    from flask import request
    if request.path == '/api/library/stream':
        streamed.append(request.args.get('path'))
@backend.app.get('/__test/streamed')
def streamed_paths():
    import os
    folder = getattr(backend, 'TRANSCODE_DIR', None)
    return {'streamed': streamed, 'transcoded': sorted(os.listdir(folder)) if folder and os.path.isdir(folder) else []}
@backend.app.get('/__test/loads')
def loads():
    return {'loads': len(calls)}
@backend.app.post('/__test/library')
def library():
    from flask import request
    backend.safe_write_json(backend.CACHE_PATH, {'tracks': request.get_json()['tracks']})
    return {'ok': True}
from werkzeug.serving import make_server
make_server('127.0.0.1', port, backend.app, threaded=True).serve_forever()
'''
import socket
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
base_url = f'http://127.0.0.1:{port}'
base = Path(tempfile.mkdtemp(prefix='phselftest'))
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'),
       'AXIOM_RUNTIME_DIR': str(base / 'data'), 'AXIOM_LICENSE_REQUIRED': '0'}
(base / 'local').mkdir()
(base / 'home').mkdir()
music = base / 'home' / 'Music' / 'Test'
music.mkdir(parents=True)
songs = []
for n in range(5):
    path = music / f'Song {n}.wav'
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1), out.setsampwidth(2), out.setframerate(8000)
        out.writeframes(b'\x00\x01' * 8000)
    songs.append(str(path))


def post(path, body=None):
    request = urllib.request.Request(base_url + path, data=json.dumps(body or {}).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', 'Origin': base_url})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, {}


def get(path):
    return json.load(urllib.request.urlopen(base_url + path, timeout=60))


server = subprocess.Popen([sys.executable, '-c', SERVER, str(base), str(port), str(workspace / 'axiom-win-probe')],
                          env=env, cwd=str(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(240):
        try:
            get('/__test/loads')
            break
        except OSError:
            time.sleep(0.5)
    by_name = lambda data: {c['name']: c for c in data['checks']}

    # no library yet: honest failure, still the expected shape
    status, data = post('/api/browser/self_test')
    assert status == 200 and data['success'] is False and data['total_tracks'] == 0, data
    assert not by_name(data)['library_loaded']['ok'] and isinstance(data['limitations'], list) and data['message'], data

    # a small library: 5 real wav files, one missing file, one video
    tracks = [{'path': p, 'title': Path(p).stem} for p in songs]
    tracks.append({'path': str(music / 'Gone.mp3'), 'title': 'Gone'})
    tracks.append({'path': str(music / 'clip.mp4'), 'title': 'clip'})
    assert post('/__test/library', {'tracks': tracks})[1] == {'ok': True}
    before = get('/__test/loads')['loads']
    started = time.perf_counter()
    status, data = post('/api/browser/self_test')
    first = time.perf_counter() - started
    checks = by_name(data)
    assert status == 200 and data['total_tracks'] == 7 and data['playable_tracks'] == 6, data
    assert set(checks) == {'library_loaded', 'song_files', 'playable_formats', 'audio_stream', 'browser_layer', 'folder_picker'}, checks
    assert all(set(c) == {'name', 'ok', 'detail'} and c['detail'] for c in data['checks']), data
    assert checks['library_loaded']['ok'] and checks['audio_stream']['ok'], checks
    assert not checks['song_files']['ok'] and '2 of 7' in checks['song_files']['detail'], checks  # Gone.mp3 and clip.mp4 are not on disk
    assert checks['folder_picker']['ok'] and checks['browser_layer']['detail'], checks
    assert data['success'] is False and data['message'].startswith('4 of 6 browser checks passed.'), data  # files and formats are flagged
    assert data['sampled'] == 7 and all('AXIOM' not in c['detail'] and 'AXIOM' not in data['message'] for c in data['checks']), data

    # again: the library file is not read a second time, and it answers quickly
    loads = get('/__test/loads')['loads']
    assert loads - before == 1, (before, loads)
    started = time.perf_counter()
    for _ in range(5):
        post('/api/browser/self_test')
    again = (time.perf_counter() - started) / 5
    assert get('/__test/loads')['loads'] == loads
    assert again < 2 and first < 10, (first, again)

    # all files present: everything passes
    ok_tracks = [{'path': p, 'title': Path(p).stem} for p in songs]
    post('/__test/library', {'tracks': ok_tracks})
    status, data = post('/api/browser/self_test')
    assert data['success'] is True and all(c['ok'] for c in data['checks']) and data['playable_tracks'] == 5, data
    assert data['message'] == '6 of 6 browser checks passed.', data

    # FLAC / AIFF / video first: the stream test must pick a directly streamable song and never trigger a conversion
    flac, aiff, video = music / 'First.flac', music / 'Second.aiff', music / 'Third.mp4'
    for extra in (flac, aiff, video):
        extra.write_bytes(b'not really audio' * 100)
    post('/__test/library', {'tracks': [{'path': str(p)} for p in (flac, aiff, video, *map(Path, songs))]})
    already = len(get('/__test/streamed')['streamed'])
    status, data = post('/api/browser/self_test')
    checks = by_name(data)
    seen = get('/__test/streamed')
    assert checks['audio_stream']['ok'] and 'Song 0.wav' in checks['audio_stream']['detail'], checks
    assert seen['streamed'][already:] == [songs[0]] and seen['transcoded'] == [], seen  # only the wav was requested; nothing converted or written
    # only convertible songs: the stream call is skipped, honestly
    post('/__test/library', {'tracks': [{'path': str(p)} for p in (flac, aiff, video)]})
    before_calls = len(get('/__test/streamed')['streamed'])
    status, data = post('/api/browser/self_test')
    detail = by_name(data)['audio_stream']['detail']
    assert detail.startswith('Skipped') and len(get('/__test/streamed')['streamed']) == before_calls, detail
    assert get('/__test/streamed')['transcoded'] == []

    # a big library is sampled, not walked
    big = [{'path': str(music / f'Song {n % 5}.wav') if n < 400 else f'Z:\\nowhere\\{n}.mp3', 'title': str(n)} for n in range(49000)]
    post('/__test/library', {'tracks': big})
    started = time.perf_counter()
    status, data = post('/api/browser/self_test')
    assert data['total_tracks'] == 49000 and data['sampled'] <= 200, data
    assert time.perf_counter() - started < 15

    # templates and script versions
    template = (workspace / 'axiom-win-probe' / 'templates' / 'index.html').read_text(encoding='utf-8')
    assert 'health-repairs.js?v=20260904-segmentation-v2' in template and 'runBrowserParityCheck()' in template
    script = (workspace / 'axiom-win-probe' / 'static' / 'js' / 'surfaces' / 'health-repairs.js').read_text(encoding='utf-8')
    assert 'AXIOM browser' not in script and 'browser shim' not in script and '/api/browser/self_test' in script
finally:
    subprocess.run(['taskkill', '/T', '/F', '/PID', str(server.pid)], capture_output=True)
    shutil.rmtree(base, ignore_errors=True)
print('PASS: Run Browser Test answers with real checks, is fast, reads the library file once, and is PC-only')
