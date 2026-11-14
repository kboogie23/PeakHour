"""The page must never show first-step onboarding ("Connect your music") for a library that has songs.

Found on the owner's PC (21,477 videos): the page sat on "First Step / Choose where your music lives". Two ways to get there
that this test pins:
 1. /api/library/stats did not answer on the first tries (busy or still-starting server). The page then knew nothing, and
    startup treated "not known" as "no music" and showed onboarding for good. Now it says "Loading your library..." and asks again.
 2. Library > Type kept as "MP3" on an all-video library: the Library must open on "No Matching Records" with a hint and a
    "Show all files" button, never on onboarding.
Runs the real app (stats refused for the first 3 calls) and a real (headless) Edge with its own profile, in a temp folder."""
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
import sys, pathlib, threading
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3]); refuse = int(sys.argv[4])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'data'
backend = L.build_app(port)
inner, seen, lock = backend.app.wsgi_app, [0], threading.Lock()
def gate(environ, start_response):
    if environ.get('PATH_INFO') == '/api/library/stats':
        with lock:
            seen[0] += 1
            refused = seen[0] <= refuse
        if refused:
            start_response('503 Service Unavailable', [('Content-Type', 'application/json')])
            return [b'{"error":"starting"}']
    return inner(environ, start_response)
backend.app.wsgi_app = gate
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
base = Path(tempfile.mkdtemp(prefix='phunknown'))
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'),
       'AXIOM_RUNTIME_DIR': str(base / 'data'), 'AXIOM_LICENSE_REQUIRED': '0'}
(base / 'local').mkdir()
(base / 'home').mkdir()
video = base / 'VIDEO'
for n in range(3):
    media.make_mp4(video / f'clip{n}.mp4', 1)
servers = []


def start(refuse):
    process = subprocess.Popen([sys.executable, '-c', SERVER, str(base), str(port), str(workspace / 'axiom-win-probe'), str(refuse)],
                               env=env, cwd=str(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    servers.append(process)
    for _ in range(240):
        try:
            urllib.request.urlopen(url + '/get-tracks?limit=1', timeout=2).read()
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


STATE = ("(()=>{const shown=id=>{const e=document.getElementById(id);return !!(e&&e.offsetParent)};let has;try{has=libraryHasTracks}catch(e){has='undef'};"
         "return {has,count:document.getElementById('lib-track-count-val').textContent,connect:shown('connect-music-view'),"
         "library:shown('tab-content-library'),cards:document.querySelectorAll('#search-results .library-track-card').length,"
         "hint:!!document.getElementById('ph-filetype-hint'),noMatch:!!document.querySelector('#search-results .library-no-results')}})()")
OPEN_LIBRARY = "(async()=>{showTab('library');await new Promise(r=>setTimeout(r,3000));return " + STATE + "})()"

try:
    process = start(0)
    job = call('POST', '/api/library/add_folder', {'folder_path': str(video), 'async': True, 'confirmed_music_preflight': True})
    for _ in range(300):
        if call('GET', f'/api/library/add_folder/status/{job["job_id"]}').get('phase') == 'complete':
            break
        time.sleep(0.5)
    assert call('GET', '/api/library/stats')['total_tracks'] == 3
    stop(process)
    process = start(3)  # the first three /api/library/stats calls fail with 503
    browser = fb.Browser(sandbox=base / 'edge', base_url=url)
    try:
        browser.open('/', settle=1000)
        browser.eval("localStorage.setItem('peakhour.libraryFileType','mp3')")
        # 1. stats refused at first: never onboarding while the answer is unknown, and the page recovers by itself
        seen = []
        run = browser.run([{'op': 'navigate', 'url': '/', 'settle': 0}] + [s for _ in range(12) for s in
                          ({'op': 'eval', 'expr': STATE, 'timeout': 30}, {'op': 'sleep', 'seconds': 1})])
        seen = [step['value'] for step in run.steps if step.get('op') == 'eval' and step.get('ok')]
        assert seen and all(state['connect'] is False for state in seen), seen
        assert seen[-1]['has'] is True and seen[-1]['count'] == '3', [(s['has'], s['connect'], s['count']) for s in seen]
        # 2. Type = MP3 on an all-video library: the Library opens on No Matching Records with a way out
        state = browser.eval(OPEN_LIBRARY, timeout=90)
        assert state['has'] is True and state['connect'] is False and state['library'] is True, state
        assert state['noMatch'] is True and state['hint'] is True, state
        assert 'MP3' in browser.eval("document.getElementById('ph-filetype-hint').textContent")
        # 3. a search that matches nothing is not about Type: no Type note while the search box has text
        browser.eval("(async()=>{document.getElementById('main-search').value='zzzqqq';runSearch();await new Promise(r=>setTimeout(r,2500))})()")
        state = browser.eval(STATE)
        assert state['noMatch'] is True and state['hint'] is False, state
        browser.eval("(async()=>{document.getElementById('main-search').value='';runSearch();await new Promise(r=>setTimeout(r,2500))})()")
        assert browser.eval(STATE)['hint'] is True
        browser.eval("document.querySelector('#ph-filetype-hint button').click()")
        time.sleep(3)
        state = browser.eval(STATE)
        assert state['cards'] == 3 and state['hint'] is False and state['connect'] is False, state
        # 4. a saved Type value is text, never HTML
        evil = '<img src=x onerror="window.__pwn=1">'
        browser.eval("localStorage.setItem('peakhour.libraryFileType',%s)" % json.dumps(evil))
        browser.open('/', settle=4000)
        browser.eval("(async()=>{showTab('library');await new Promise(r=>setTimeout(r,3500))})()", timeout=60)
        page = browser.eval("({pwn:window.__pwn===undefined?null:window.__pwn,img:document.querySelectorAll('#ph-library-filetype img, #ph-filetype-hint img').length,"
                            "option:[...document.querySelectorAll('#ph-library-filetype option')].some(o=>o.value===%s)})" % json.dumps(evil))
        assert page == {'pwn': None, 'img': 0, 'option': True}, page
        browser.eval("localStorage.removeItem('peakhour.libraryFileType')")
        # 5. the server never answers /api/library/stats: after the (shortened) wait the page says so, and is not onboarding
        stop(process)
        process = start(10**6)
        browser.eval("localStorage.setItem('peakhour.libraryWaitMs','3000')")
        browser.open('/', settle=9000)
        page = browser.eval("({msg:(document.getElementById('library-server-silent')||{}).textContent||'',"
                            "connect:!!(document.getElementById('connect-music-view')||{}).offsetParent})")
        assert "isn't answering" in page['msg'] and page['connect'] is False, page
    finally:
        browser.close()
finally:
    for process in servers:
        stop(process)
    shutil.rmtree(base, ignore_errors=True)
print('PASS: an unanswered /api/library/stats never shows onboarding (the page retries); a Type that matches nothing shows a hint with Show all files')
