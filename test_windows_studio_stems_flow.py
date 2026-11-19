"""Studio DAW -> Create Stems with NO stem engine installed, in the REAL page of a sandbox copy of the app (headless Edge).

The stem-engine install dialog (windows-stems-install.js) was so far only tested against a stub page. Here the whole chain runs:
  * the sandbox data folder is the sandbox (AXIOM_RUNTIME_DIR), and GET /api/windows/stem-engine/status says nothing is installed;
  * a project with one clip is opened and the user's button is pressed: Studio's inspector "Create Stems" (a real mouse click);
  * POST /api/studio-daw/stems answers 503 with code stem_runtime_missing, Windows wording (no "Mac", no "Reinstall the
    complete AXIOM app"), install_required and the stem_engine facts;
  * the install dialog shows what is downloaded (size, sources) and an Install button; "Not now" and Escape close it and the
    DAW stays usable (the clip can be asked again, the inspector still answers);
  * Install runs the REAL installer job and its REAL routes, but the server child process replaces the four steps that would
    touch the internet or a real Python (_copy_python, _bootstrap_pip, _pip, _verify) and the model download (_download), and
    makes any real network function (http_open) raise and be recorded: the page shows progress, then success, and the original
    stems request is sent again by itself (a second POST /api/studio-daw/stems, no further click);
  * nothing was downloaded: the recorded real-network attempts are empty and no request left 127.0.0.1.
There is no environment variable for a fake installer in windows_stem_installer.py; the fake is applied in the server child
process of this test (like the other tests patch data_root), never in the application files.

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\\Users\\gatli\\Documents\\PeakHour; & .\\axiom-win-env\\Scripts\\python.exe test_windows_studio_stems_flow.py"
Everything runs in a temp folder on a free port; nothing of the owner's is touched (never port 8080, never the owner's data)."""
import json
import math
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
import wave
from pathlib import Path

workspace = Path(__file__).resolve().parent
sys.path.insert(0, str(workspace))
from feature_check import browser as fb

# a mutated copy of the app can be tested with PH_TEST_APP_DIR (used to prove the test fails when the behaviour is broken)
APP_DIR = os.environ.get('PH_TEST_APP_DIR') or str(workspace / 'axiom-win-probe')

SERVER = r'''
import sys, pathlib, time
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'data'
backend = L.build_app(port)
import windows_stem_installer as W
if sys.argv[4] == 'fake':
    inst = W.INSTALLER
    net = sb / 'real-network-attempts.txt'
    def no_network(*a, **k):
        net.open('a').write('http_open %r\n' % (a[:1],))
        raise OSError('the real network must not be used by this test')
    W.http_open = no_network
    W.free_bytes = lambda path: 500 * 10 ** 9
    W.long_paths_enabled = lambda: True
    W.detect_gpu = lambda: None
    def step(phase, text, seconds=0.9):
        inst._detail(phase, text, 0.5)
        end = time.time() + seconds
        while time.time() < end:
            inst._check_cancel()
            time.sleep(0.05)
        inst._detail(phase, text, 1)
    def copy_python(dest):
        step('python', 'Preparing the Python environment.')
        (dest / 'Scripts').mkdir(parents=True, exist_ok=True)
        (dest / 'Scripts' / 'python.exe').write_bytes(b'MZ')
        (dest / 'python.exe').write_bytes(b'MZ')
    def bootstrap(python, partial):
        step('pip', 'Getting pip.', 0.3)
    def run_pip(python, args, phase, expected, label):
        step(phase, 'Downloading ' + label + '.')
    def verify(partial, flavour):
        step('verify', 'Checking the engine.', 0.3)
        inst._engine_info = {'torch': '2.6.0+cpu', 'cuda': False, 'numpy': '1.26.4'}
    def download(url, target, sha256, size, phase, label):
        step(phase, label)
        pathlib.Path(target).write_bytes(b'fake model')
    inst._copy_python, inst._bootstrap_pip, inst._pip, inst._verify, inst._download = copy_python, bootstrap, run_pip, verify, download
from werkzeug.serving import make_server
make_server('127.0.0.1', port, backend.app, threaded=True).serve_forever()
'''

# Records every /api/studio-daw/stems (POST) answer in the page: status and body.
HOOK = r'''
(() => {
  if (window.__stemLog) return true;
  window.__stemLog = [];
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const post = String((init && init.method) || 'GET').toUpperCase() === 'POST';
    const response = await real(input, init);
    if (post && /\/api\/studio-daw\/stems$/.test(url.split('?')[0])) {
      const copy = response.clone();
      copy.text().then(text => window.__stemLog.push({status: response.status, body: text})).catch(() => {});
    }
    return response;
  };
  return true;
})()
'''

DIALOG = r'''
(() => {
  const d = document.getElementById('axiom-stem-install');
  if (!d) return null;
  const vis = e => !!e && !e.hidden && !!e.getClientRects().length;
  const go = d.querySelector('#axiom-stem-install-go'), stop = d.querySelector('#axiom-stem-install-cancel');
  return {open: d.open, text: d.innerText, install: vis(go) && go.textContent, running: vis(stop),
          bar: !d.querySelector('.axiom-stem-bar').hidden, buttons: [...d.querySelectorAll('button')].filter(vis).map(b => b.textContent)};
})()
'''

ok, why = fb.available()
if not ok:
    print('SKIPPED page check: ' + why)
    sys.exit(0)

with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
if port == 8080:
    raise SystemExit('refusing port 8080')
url = f'http://127.0.0.1:{port}'
base = Path(tempfile.mkdtemp(prefix='phstems'))
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'), 'APPDATA': str(base / 'roaming'),
       'AXIOM_RUNTIME_DIR': str(base / 'data'), 'AXIOM_LICENSE_REQUIRED': '0', 'AXIOM_NO_OPEN': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
for name in ('local', 'home', 'roaming', 'data'):
    (base / name).mkdir()
servers, browsers, failures = [], [], []


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)


def start():
    process = subprocess.Popen([sys.executable, '-c', SERVER, str(base), str(port), APP_DIR, 'fake'],
                               env=env, cwd=str(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    servers.append(process)
    for _ in range(240):
        try:
            urllib.request.urlopen(url + '/api/library/stats', timeout=2).read()
            return
        except OSError:
            time.sleep(0.5)
    raise AssertionError('the app did not start')


def get(path):
    with urllib.request.urlopen(url + path, timeout=10) as r:
        return json.loads(r.read().decode('utf-8'))


def tone(path, seconds=6, sr=22050):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b''.join(struct.pack('<hh', *(int(8000 * math.sin(2 * math.pi * 330 * i / sr)),) * 2) for i in range(seconds * sr)))


def wait(b, expr, seconds=20):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if b.eval(f'Boolean({expr})'):
            return True
        time.sleep(0.25)
    return False


def dialog(b):
    return b.eval(DIALOG)


def log(b):
    return json.loads(b.eval('JSON.stringify(window.__stemLog || [])'))


def click_create(b):
    # a user selects the clip on the timeline (real click), the inspector then offers "Create Stems"
    if not b.eval("[...document.querySelectorAll('button')].some(x => x.getClientRects().length && /^create stems$/i.test(x.innerText.trim()))"):
        b.run([{'op': 'click', 'selector': '[data-daw-clip-id]', 'timeout': 8}, {'op': 'sleep', 'seconds': 0.6}])
    r = b.run([{'op': 'click_text', 'text': 'Create Stems', 'timeout': 8}])
    check(r.steps[0].get('ok'), f'could not click the inspector "Create Stems" button: {r.steps[0].get("error")}')
    if not r.steps[0].get('ok'):
        sys.stdout.reconfigure(errors='replace')
        print('  diag:', b.eval("JSON.stringify({sel: typeof selectedClipId, buttons: [...document.querySelectorAll('button')].filter(x=>x.getClientRects().length).map(x=>x.innerText.trim()).filter(Boolean).slice(0,60), "
                              "inspector: (document.getElementById('studio-daw-inspector')||{}).className, clips: AxiomStudioDaw.activeProject.arrangementClips.map(c=>c.id)})"))


try:
    music = base / 'music'
    music.mkdir()
    tone(music / 'one.wav')
    track = {'path': str(music / 'one.wav'), 'title': 'one.wav', 'artist': 'Test', 'bpm': 120, 'durationSec': 6, 'duration': 6, 'key': '8A', 'name': 'one.wav'}
    start()

    print('[no engine installed, data folder is the sandbox]')
    status = get('/api/windows/stem-engine/status')
    check(status.get('runtime_ready') is False and status.get('ready') is False, f'the sandbox should have no stem engine: {status}')
    check(not (base / 'data' / 'stem-runtime').exists(), 'stem-runtime exists in the sandbox before the test')
    check(status.get('download_text'), f'status has no download size ({status})')

    b = fb.Browser(sandbox=base / 'edge', base_url=url)
    browsers.append(b)
    b.run([{'op': 'navigate', 'url': '/', 'settle': 4000}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 3},
           {'op': 'collect_network', 'clear': True}])
    b.eval(HOOK)
    b.eval("(()=>{showTab('studio');return 1})()")
    time.sleep(0.8)
    b.eval("(async()=>{window.__T=%s;AxiomStudioDaw.showStudioDawProject(window.__T,'track');await new Promise(r=>setTimeout(r,2500));return 1})()" % json.dumps(track))
    check(b.eval('!!(window.AxiomStudioDaw && AxiomStudioDaw.surfaceVisible)'), 'the Studio DAW did not open')
    clips = b.eval('AxiomStudioDaw.activeProject.arrangementClips.length')
    check(clips and clips >= 1, f'the project has no clip ({clips})')
    check(b.eval('!!window.AxiomStemInstall'), 'AxiomStemInstall is not loaded on the real page')

    print('[click Create Stems: 503 stem_runtime_missing]')
    click_create(b)
    check(wait(b, "document.getElementById('axiom-stem-install')"), 'the install dialog did not appear after Create Stems')
    entries = log(b)
    check(len(entries) == 1, f'expected exactly 1 POST /api/studio-daw/stems so far, saw {len(entries)}')
    if entries:
        body = json.loads(entries[0]['body'])
        text = json.dumps(body)
        check(entries[0]['status'] == 503, f'stems answered {entries[0]["status"]}, expected 503')
        check(body.get('code') == 'stem_runtime_missing', f'code is {body.get("code")!r}')
        check(body.get('install_required') is True, 'install_required missing from the 503')
        check('macos_version' not in (body.get('identity') or {}), 'the Windows 503 still carries the Mac identity key macos_version')
        check(body.get('stem_engine', {}).get('gpu_checking') in (True, False), 'the 503 does not say whether the GPU lookup is still running')
        # wording = the string VALUES the page can show (the identity block has a key named macos_version; that is never shown)
        values = []
        stack = [body]
        while stack:
            item = stack.pop()
            if isinstance(item, dict):
                stack.extend(item.values())
            elif isinstance(item, list):
                stack.extend(item)
            elif isinstance(item, str):
                values.append(item)
        words = ' '.join(values).lower()
        check(not re.search(r'\bmac(os)?\b|\bapple\b|\.app\b', words), f'the 503 still has Mac wording: {words[:300]}')
        check('reinstall the complete axiom app' not in text.lower(), f'the 503 still says to reinstall the app: {text[:300]}')
        check('download' in body.get('error', '').lower(), f'the 503 does not explain the one-time download: {body.get("error")}')
        check(isinstance(body.get('stem_engine'), dict) and body['stem_engine'].get('download_text'), 'the 503 has no stem_engine facts')

    print('[the install dialog]')
    d = dialog(b)
    check(d and d['open'], 'the dialog is not open as a modal')
    if d:
        text = d['text']
        check('Install stem engine' in text, 'dialog has no title')
        check('Download: about' in text and 'Disk space needed' in text, f'no size text: {text[:300]}')
        check('download.pytorch.org' in text and 'pypi.org' in text and 'dl.fbaipublicfiles.com' in text, 'no download sources shown')
        check('Mac' not in text and 'Reinstall' not in text, 'Mac wording in the dialog')
        check(d['install'] == 'Install', f'no Install button ({d["buttons"]})')
        check('Not now' in d['buttons'], f'no way to decline ({d["buttons"]})')
        check(d['running'] is False and d['bar'] is False, 'progress/Cancel install should not show before Install is pressed')

    print('[decline with Not now: the DAW stays usable]')
    b.run([{'op': 'click', 'selector': '#axiom-stem-install button', 'text': 'Not now'}])
    check(wait(b, "!document.getElementById('axiom-stem-install')", 5), 'Not now did not close the dialog')
    check(b.eval('AxiomStudioDaw.surfaceVisible'), 'the DAW closed with the dialog')
    check(len(log(b)) == 1, 'declining must not send another stems request')
    check(not (base / 'data' / 'stem-runtime').exists(), 'declining created a stem-runtime folder')
    # the DAW still answers: the clip can be asked again (Create Stems is offered again) and the toolbar zoom still works
    check(b.eval('AxiomStudioDaw.activeProject.arrangementClips[0].stemState') != 'processing', 'the clip is stuck in "processing" after Not now')
    bars = b.eval("Number(document.querySelector('.studio-daw-timeline').style.getPropertyValue('--visible-bars'))")
    b.eval('(()=>{AxiomStudioDaw.stepZoom(1);return 1})()')
    check(b.eval("Number(document.querySelector('.studio-daw-timeline').style.getPropertyValue('--visible-bars'))") != bars, 'the DAW timeline no longer responds after Not now')
    b.eval('(()=>{AxiomStudioDaw.setZoom(0);return 1})()')

    print('[ask again, decline with Escape]')
    click_create(b)
    check(wait(b, "document.getElementById('axiom-stem-install')"), 'the dialog did not come back on a second Create Stems')
    check(len(log(b)) == 2, f'second click should send a second request ({len(log(b))})')
    b.run([{'op': 'press', 'key': 'Escape'}])
    check(wait(b, "!document.getElementById('axiom-stem-install')", 5), 'Escape did not close the dialog')
    check(b.eval('AxiomStudioDaw.surfaceVisible'), 'the DAW closed with the dialog (Escape)')

    print('[ask again and Install (fake installer, no network)]')
    click_create(b)
    check(wait(b, "document.getElementById('axiom-stem-install')"), 'the dialog did not come back for the install run')
    before = len(log(b))
    b.run([{'op': 'click', 'selector': '#axiom-stem-install-go'}])
    check(wait(b, "(()=>{const d=document.getElementById('axiom-stem-install');return !!d&&!d.querySelector('.axiom-stem-bar').hidden})()", 8),
          'no progress bar after Install')
    seen = set()
    cancel_visible = False
    deadline = time.time() + 40
    while time.time() < deadline:
        d = dialog(b)
        if not d:
            break
        m = d['text']
        seen.add(m)
        cancel_visible = cancel_visible or d['running']
        time.sleep(0.3)
    check(cancel_visible, 'Cancel install was never offered while the install ran')
    check(len(seen) > 2, f'the dialog text never changed while installing (only {len(seen)} different texts)')
    check(any('%' in s for s in seen), 'no percentage was shown during the install')
    check(wait(b, "!document.getElementById('axiom-stem-install')", 5), 'the dialog did not close after the install finished')
    status = get('/api/windows/stem-engine/status')
    check(status.get('ready') is True and status.get('state') == 'done', f'the installer did not finish: {status.get("state")} {status.get("error")}')

    print('[the original request is retried by itself]')
    check(wait(b, f'window.__stemLog.length > {before}', 15), 'no second stems request was sent after the install (not retried)')
    entries = log(b)
    print('  stems answers:', [e['status'] for e in entries])
    check(len(entries) == before + 1, f'expected exactly one automatic retry, stems requests: {len(entries) - before}')
    if len(entries) > before:
        retried = json.loads(entries[before]['body'] or '{}')
        check(retried.get('code') != 'stem_runtime_missing', f'the retry still says the engine is missing: {retried}')
        check(retried.get('install_required') is not True, 'the retry asked for the install again (loop)')
    time.sleep(1.5)
    check(not b.eval("!!document.getElementById('axiom-stem-install')"), 'the dialog came back after the install')
    check(len(log(b)) == before + 1, 'more than one automatic retry (an endless loop?)')

    print('[nothing was downloaded]')
    attempts = base / 'real-network-attempts.txt'
    check(not attempts.exists(), 'the installer tried the real network: ' + (attempts.read_text() if attempts.exists() else ''))
    net = b.run([{'op': 'collect_network'}]).steps[0].get('value') or []
    outside = [n for n in net if not n['url'].startswith(url) and not n['url'].startswith('data:')]
    check(not outside, f'requests left the sandbox app: {outside[:3]}')
except BaseException:
    import traceback
    traceback.print_exc()
    failures.append('the test itself crashed')
finally:
    for br in browsers:
        try:
            br.close()
        except Exception:
            pass
    fb._kill_profile_users(base)
    for process in servers:
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(process.pid)], capture_output=True)
    time.sleep(2)
    left = subprocess.run(['powershell', '-NoProfile', '-Command',
                           "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($env:FC_BASE.ToLower()) } | Select-Object -ExpandProperty ProcessId"],
                          capture_output=True, text=True, env=dict(os.environ, FC_BASE=str(base))).stdout.split()
    print('leftover processes using the temp folder:', left or 'none')
    if left:
        failures.append(f'leftover processes: {left}')
        for pid in left:
            subprocess.run(['taskkill', '/T', '/F', '/PID', pid], capture_output=True)
    shutil.rmtree(base, ignore_errors=True)
print('PASS: Create Stems with no engine -> 503 stem_runtime_missing with Windows wording -> install dialog (size, sources, Install, Not now/Escape keep the DAW usable) -> fake install with progress -> the stems request is retried by itself; nothing downloaded'
      if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
