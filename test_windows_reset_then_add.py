"""Reset the library, add a folder, restart: "Connect your music" must not come back while the library has songs.

Found on the owner's PC: after Reset + Add Music Folder (21,477 video files, 21,477 TRACKS in the sidebar) the page
kept showing "First Step / Connect your music" and the Library could not be opened, even after restarting. Cause:
Library > Type (windows-filetypes.js) keeps its choice in localStorage ("All audio" from the earlier library); the
filtered Library list answers total_tracks 0 for an all-video library and AXIOM's page reads that as "no music
connected". Runs the real app and a real (headless) Edge with its own profile, all in a temp folder."""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

workspace = Path(__file__).resolve().parent
sys.path.insert(0, str(workspace))
from feature_check import browser as fb, media

SERVER = r'''
import sys, pathlib
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'data'
backend = L.build_app(port)
from werkzeug.serving import make_server
make_server('127.0.0.1', port, backend.app, threaded=True).serve_forever()
'''
ok, why = fb.available()
if not ok:
    print('SKIPPED page check: ' + why)
    sys.exit(0)

with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
url = f'http://127.0.0.1:{port}'
base = Path(tempfile.mkdtemp(prefix='phreset'))
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'),
       'AXIOM_RUNTIME_DIR': str(base / 'data'), 'AXIOM_LICENSE_REQUIRED': '0'}
(base / 'local').mkdir()
(base / 'home').mkdir()
video = base / 'VIDEO'
for n in range(3):
    media.make_mp4(video / f'clip{n}.mp4', 1)
music = base / 'MUSIC'
for n in range(3):
    media.make_tone(music / f'song{n}.mp3', tags={'artist': 'A', 'title': f'Song {n}', 'bpm': '120'})
servers = []


def start():
    process = subprocess.Popen([sys.executable, '-c', SERVER, str(base), str(port), str(workspace / 'axiom-win-probe')],
                               env=env, cwd=str(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    servers.append(process)
    for _ in range(240):
        try:
            urllib.request.urlopen(url + '/api/library/stats', timeout=2).read()
            return process
        except OSError:
            time.sleep(0.5)
    raise AssertionError('the app did not start')


def stop(process):
    subprocess.run(['taskkill', '/T', '/F', '/PID', str(process.pid)], capture_output=True)
    time.sleep(1)


def call(method, path, body=None):
    request = urllib.request.Request(url + path, data=None if body is None else json.dumps(body).encode(), method=method,
                                     headers={'Content-Type': 'application/json', 'Origin': url})
    return json.load(urllib.request.urlopen(request, timeout=60))


def add_by_api(folder):
    job = call('POST', '/api/library/add_folder', {'folder_path': str(folder), 'async': True, 'confirmed_music_preflight': True})
    for _ in range(300):
        if call('GET', f'/api/library/add_folder/status/{job["job_id"]}').get('phase') == 'complete':
            return
        time.sleep(0.5)
    raise AssertionError('the add-folder job never finished')


STATE = ("(()=>{const shown=id=>{const e=document.getElementById(id);return !!(e&&e.offsetParent)};"
         "return {has:libraryHasTracks,count:document.getElementById('lib-track-count-val').textContent,"
         "connect:shown('connect-music-view'),library:shown('tab-content-library')}})()")
OPEN_LIBRARY = "(async()=>{showTab('library');await new Promise(r=>setTimeout(r,3000));return " + STATE + "})()"

try:
    process = start()
    add_by_api(video)
    assert call('POST', '/api/library/reset_index')['verified_empty'] is True
    add_by_api(video)  # reset, then add a folder again: the owner's order
    assert call('GET', '/api/library/stats')['total_tracks'] == 3
    browser = fb.Browser(sandbox=base / 'edge', base_url=url)
    try:
        # 1. Library > Type was "All audio" from the earlier (audio) library; the list is empty for video files
        browser.open('/', settle=5000)
        browser.eval("localStorage.setItem('peakhour.libraryFileType','audio')")
        browser.open('/', settle=5000)
        for label in ('after reset and add', 'after restart'):
            if label == 'after restart':
                stop(process)
                process = start()
                browser.open('/', settle=5000)
            state = browser.eval(OPEN_LIBRARY, timeout=90)
            assert state['has'] is True and state['connect'] is False and state['library'] is True and state['count'] == '3', (label, state)
        # the filter still works: the list is empty for audio, the video files appear under All files
        browser.eval("localStorage.removeItem('peakhour.libraryFileType')")
        browser.open('/', settle=5000)
        state = browser.eval(OPEN_LIBRARY, timeout=90)
        assert state['has'] is True and state['connect'] is False and state['library'] is True, state
        # 2. Plain first run, no Serato and no VirtualDJ: reset, then add a folder of songs from the page itself
        assert call('POST', '/api/library/reset_index')['verified_empty'] is True
        browser.open('/', settle=5000)
        before = browser.eval(STATE)
        assert before['has'] is False and before['count'] == '0', before
        browser.eval("(async()=>{await addFolder(%s,'MUSIC');await new Promise(r=>setTimeout(r,4000))})()" % json.dumps(str(music)), timeout=240)
        state = browser.eval(OPEN_LIBRARY, timeout=90)
        assert state['has'] is True and state['connect'] is False and state['library'] is True and state['count'] == '3', state
        assert browser.eval("document.querySelectorAll('#search-results .library-track-card').length") == 3
    finally:
        browser.close()
finally:
    for process in servers:
        stop(process)
    shutil.rmtree(base, ignore_errors=True)
print('PASS: after reset + add folder (and a restart) the Library opens, even with Library > Type kept from an earlier library; first run ends on the Library')
