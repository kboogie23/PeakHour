"""The window-zoom lock with REAL input: Ctrl+mouse wheel and Ctrl +, -, 0 sent through the browser's own input channel
(DevTools Input.dispatchMouseEvent type mouseWheel with modifiers=2, Input.dispatchKeyEvent with Ctrl held) to a real page
of a sandbox copy of the app (headless Edge), instead of events made by script (test_windows_studio_zoom.py only looks at
defaultPrevented of synthetic events).

Per place - the Library tab, Studio Magic Set and the Studio DAW timeline - it measures window.devicePixelRatio,
window.innerWidth/innerHeight, visualViewport.scale/width and document.documentElement.clientWidth before and after a burst of
Ctrl+wheel up/down and Ctrl+=, Ctrl+-, Ctrl+0, Ctrl+Shift+=, and asserts none of them changed, and that every one of those
events reached the page CANCELLED (the event objects are kept by a capture listener and read after dispatch). Inside the DAW
--visible-bars (the timeline zoom) must change with the wheel and with the keys.

A control proves the input channel: the same input sent to a bare data: page (none of the app's handlers) must arrive
there uncancelled. Edge's page zoom is kept per site and a data: page has none, so the control does not zoom; the proof that
the metrics DO move when the lock is missing is the mutation run described in the report (the lock removed from a scratch copy
of the app, PH_TEST_APP_DIR): devicePixelRatio 1 -> 1.1 and innerWidth 1376 -> 1251 on the Library, Magic Set and DAW.
Real Edge UI zoom (the browser's own Ctrl+wheel handler in a normal window) cannot run in headless Edge; see the report.

The DevTools socket is used from a small node script written next to the sandbox (feature_check/cdp_driver.mjs has no raw
input op and is not changed). Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\\Users\\gatli\\Documents\\PeakHour; & .\\axiom-win-env\\Scripts\\python.exe test_windows_studio_window_zoom.py"
Everything runs in a temp folder on a free port; nothing of the owner's is touched (never port 8080, never the owner's data)."""
import json
import math
import os
import random
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
from feature_check import browser as fb, synthetic_library as sl

# a mutated copy of the app can be tested with PH_TEST_APP_DIR (used to prove the test fails when the behaviour is broken)
APP_DIR = os.environ.get('PH_TEST_APP_DIR') or str(workspace / 'axiom-win-probe')

SERVER = r'''
import sys, pathlib
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'runtime'
backend = L.build_app(port)
from werkzeug.serving import make_server
make_server('127.0.0.1', port, backend.app, threaded=True).serve_forever()
'''

# Sends real input events to the first page of the Edge on the debugging port. argv: port, file with [actions].
INPUT_JS = r'''
import fs from 'node:fs';
const [port, file] = process.argv.slice(2);
const actions = JSON.parse(fs.readFileSync(file, 'utf8'));
const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
// Edge opens an edge://sync-confirmation-dialog page first: the app's tab is the page that is not an edge:// one
const tab = tabs.find(t => t.type === 'page' && !/^(edge|chrome|devtools):/.test(t.url));
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket failed')); });
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
for (const a of actions) {
  let reply;
  if (a.t === 'wheel') {
    reply = await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: a.x, y: a.y, deltaX: 0, deltaY: a.dy, modifiers: a.mod ?? 2, pointerType: 'mouse' });
  } else if (a.t === 'key') {
    const base = { key: a.key, code: a.code, windowsVirtualKeyCode: a.vk, nativeVirtualKeyCode: a.vk, modifiers: a.mod };
    reply = await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  } else if (a.t === 'move') {
    reply = await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
  }
  if (reply && reply.error) failed++;
  await sleep(a.wait ?? 60);
}
ws.close();
console.log(JSON.stringify({ sent: actions.length, failed }));
process.exit(0);
'''

METRICS = r'''
(() => {
  const vv = window.visualViewport;
  const bars = document.querySelector('.studio-daw-timeline');
  return {dpr: window.devicePixelRatio, innerWidth: window.innerWidth, innerHeight: window.innerHeight,
          vvScale: vv ? vv.scale : null, vvWidth: vv ? vv.width : null, vvHeight: vv ? vv.height : null,
          client: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth,
          bars: bars && bars.offsetParent !== null ? Number(bars.style.getPropertyValue('--visible-bars')) : null};
})()
'''

CAPTURE = r'''
(() => {
  window.__zoomEvents = [];
  window.__zoomPrevented = new Set();
  if (!window.__zoomCapture) {
    window.__zoomCapture = true;
    // the app's handlers run first (and one stops the event for later listeners), so a listener cannot see every event: the
    // calls of preventDefault() on Ctrl events are recorded instead, whoever makes them
    const real = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function () {
      if (this.ctrlKey && (this.type === 'wheel' || this.type === 'keydown')) window.__zoomPrevented.add(this);
      return real.apply(this, arguments);
    };
    for (const type of ['wheel', 'keydown']) window.addEventListener(type, e => { if (e.ctrlKey) window.__zoomEvents.push(e); }, true);
  }
  return true;
})()
'''

READ_EVENTS = r'''
JSON.stringify({seen: window.__zoomEvents.map(e => ({type: e.type, key: e.key || '', prevented: e.defaultPrevented})),
                cancelled: [...window.__zoomPrevented].map(e => ({type: e.type, key: e.key || '', prevented: e.defaultPrevented}))})
'''

CTRL = 2
SHIFT = 8
KEYS = [('=', 'Equal', 187, CTRL), ('-', 'Minus', 189, CTRL), ('0', 'Digit0', 48, CTRL), ('+', 'Equal', 187, CTRL | SHIFT)]

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
base = Path(tempfile.mkdtemp(prefix='phwzoom'))
runtime = base / 'runtime'
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'), 'APPDATA': str(base / 'roaming'),
       'AXIOM_RUNTIME_DIR': str(runtime), 'AXIOM_LICENSE_REQUIRED': '0', 'AXIOM_NO_OPEN': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
for name in ('local', 'home', 'roaming', 'runtime'):
    (base / name).mkdir()
servers, browsers, failures = [], [], []


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)


def start():
    process = subprocess.Popen([sys.executable, '-c', SERVER, str(base), str(port), APP_DIR],
                               env=env, cwd=str(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    servers.append(process)
    for _ in range(240):
        try:
            urllib.request.urlopen(url + '/api/library/stats', timeout=2).read()
            return
        except OSError:
            time.sleep(0.5)
    raise AssertionError('the app did not start')


def make_library(count=30):
    names = [f'trk-{i:04d}.mp3' for i in range(count)]
    paths = sl.make_real_files(base, count, names)
    rng = random.Random(5)
    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    keys = [f'{n}{letter}' for n in range(1, 13) for letter in 'AB']
    tracks = []
    for index, path in enumerate(paths):
        camelot = rng.choice(keys)
        tracks.append({'path': path, 'filename': Path(path).name, 'folder': 'Music', 'title': f'Zoom Test {index:03d}', 'artist': f'Artist {index % 5}',
                       'album': 'Album', 'genre': 'House', 'comments': '', 'label': '', 'bpm': round(rng.uniform(100, 130), 1), 'camelot': camelot,
                       'key_raw': camelot, 'energy': 'Mid', 'year': 2010, 'era': 'Unknown', 'playlist_names': [], 'cue_count': 1,
                       'beatgrid_locked': False, 'source': 'virtualdj_database', 'connected_from': 'virtualdj', 'needs_relink': False,
                       'duration': 200, 'axiom_first_seen_at': stamp, 'file_size': 4000000 + index})
    sl.write_library(runtime, tracks)


def tone(path, seconds=6, sr=22050):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b''.join(struct.pack('<hh', *(int(8000 * math.sin(2 * math.pi * 330 * i / sr)),) * 2) for i in range(seconds * sr)))


def send_input(b, actions):
    job = base / 'input-job.json'
    job.write_text(json.dumps(actions), encoding='utf-8')
    done = subprocess.run([fb.find_node(), str(base / 'input.mjs'), str(b.debug_port), str(job)], capture_output=True, text=True, timeout=60)
    try:
        reply = json.loads(done.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise AssertionError('the input helper failed: ' + done.stdout + done.stderr)
    check(reply['failed'] == 0 and reply['sent'] == len(actions), f'the browser refused some input events: {reply}')
    time.sleep(0.4)


def burst(x, y, with_keys=True):
    actions = [{'t': 'move', 'x': x, 'y': y}]
    for dy in (-120, -120, -120, 120, -240, 120, 120):
        actions.append({'t': 'wheel', 'x': x, 'y': y, 'dy': dy, 'mod': CTRL})
    if with_keys:
        for key, code, vk, mod in KEYS * 2:
            actions.append({'t': 'key', 'key': key, 'code': code, 'vk': vk, 'mod': mod})
    return actions


def metrics(b):
    return b.eval(METRICS)


def same_metrics(before, after, label):
    for name in ('dpr', 'innerWidth', 'innerHeight', 'vvScale', 'vvWidth', 'vvHeight', 'client'):
        check(before[name] == after[name], f'{label}: {name} changed {before[name]} -> {after[name]}')


def exercise(b, label, x, y, expect_bars=False):
    b.eval(CAPTURE)
    before = metrics(b)
    send_input(b, burst(x, y))
    after = metrics(b)
    events = json.loads(b.eval(READ_EVENTS))
    wheels = [e for e in events['cancelled'] if e['type'] == 'wheel']
    keys = [e for e in events['cancelled'] if e['type'] == 'keydown']
    seen_wheels = [e for e in events['seen'] if e['type'] == 'wheel']
    print(f'  {label}: {len(seen_wheels)} Ctrl+wheel seen, {len(wheels)} Ctrl+wheel and {len(keys)} Ctrl+key events cancelled; dpr {before["dpr"]}->{after["dpr"]}, '
          f'inner {before["innerWidth"]}->{after["innerWidth"]}, scale {before["vvScale"]}->{after["vvScale"]}, '
          f'client {before["client"]}->{after["client"]}, bars {before["bars"]}->{after["bars"]}')
    check(len(wheels) == 7 and all(e['prevented'] for e in wheels), f'{label}: only {len(wheels)} of 7 Ctrl+wheel events were cancelled ({[e["prevented"] for e in wheels]}): the window would zoom')
    check(len(keys) == 8 and all(e['prevented'] for e in keys), f'{label}: only {len(keys)} of 8 Ctrl +/-/0 key events were cancelled ({[(e["key"], e["prevented"]) for e in keys]}): the window would zoom')
    same_metrics(before, after, label)
    return before, after


try:
    music = base / 'music'
    music.mkdir()
    make_library()
    tone(music / 'one.wav')
    track = {'path': str(music / 'one.wav'), 'title': 'one.wav', 'artist': 'Test', 'bpm': 120, 'durationSec': 6, 'duration': 6, 'key': '8A', 'name': 'one.wav'}
    (base / 'input.mjs').write_text(INPUT_JS, encoding='utf-8')
    start()
    b = fb.Browser(sandbox=base / 'edge', base_url=url)
    browsers.append(b)

    print('[control: a bare page without the app\'s handlers]')
    b.run([{'op': 'navigate', 'url': 'data:text/html,<body style="margin:0;height:3000px"><p>bare page</p></body>', 'settle': 500}])
    b.eval(CAPTURE)
    c0 = metrics(b)
    send_input(b, burst(500, 300, with_keys=False))
    c1 = metrics(b)
    ev = json.loads(b.eval(READ_EVENTS))['seen']
    print(f'  bare page: {len(ev)} Ctrl+wheel events, none cancelled={not any(e["prevented"] for e in ev)}')
    check(len(ev) >= 5, f'the input channel delivered only {len(ev)} Ctrl+wheel events to a bare page')
    check(not any(e['prevented'] for e in ev), 'a bare page cancelled Ctrl+wheel (the control is not clean)')

    print('[Library tab]')
    b.run([{'op': 'navigate', 'url': '/', 'settle': 4000}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 3}])
    b.eval("(()=>{showTab('library');return 1})()")
    time.sleep(1.5)
    total = json.load(urllib.request.urlopen(url + '/api/library/stats', timeout=10)).get('library_total_tracks')
    check(total == 30, f'the sandbox library has {total} songs, expected 30')
    check(b.eval("document.getElementById('library') ? getComputedStyle(document.getElementById('library')).display !== 'none' : true"), 'the Library tab is not showing')
    exercise(b, 'Library', 700, 450)

    print('[Studio Magic Set]')
    b.eval("(()=>{showTab('studio');return 1})()")
    time.sleep(0.8)
    b.eval("(()=>{openMagicSetWorkspace();return 1})()")
    time.sleep(1.2)
    check(b.eval("document.body.classList.contains('studio-magic-mode')"), 'Magic Set did not open')
    exercise(b, 'Magic Set', 700, 450)

    print('[Studio DAW timeline]')
    b.eval("(()=>{if(typeof closeMagicSetWorkspace==='function')closeMagicSetWorkspace();return 1})()")
    b.eval("(async()=>{window.__T=%s;AxiomStudioDaw.showStudioDawProject(window.__T,'track');await new Promise(r=>setTimeout(r,2500));return 1})()" % json.dumps(track))
    check(b.eval('!!(window.AxiomStudioDaw && AxiomStudioDaw.surfaceVisible)'), 'the DAW did not open')
    rect = b.eval("(()=>{const r=document.querySelector('#studio-daw-lanes .studio-daw-lane').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()")
    b.eval('(()=>{AxiomStudioDaw.setZoom(0);return 1})()')
    b.eval(CAPTURE)
    b0 = metrics(b)
    check(b0['bars'] and b0['bars'] > 0, f'no --visible-bars in the DAW ({b0["bars"]})')
    # the timeline zoom answers to the real wheel...
    send_input(b, [{'t': 'move', 'x': rect['x'], 'y': rect['y']}, {'t': 'wheel', 'x': rect['x'], 'y': rect['y'], 'dy': -120, 'mod': CTRL},
                   {'t': 'wheel', 'x': rect['x'], 'y': rect['y'], 'dy': -120, 'mod': CTRL}])
    w1 = metrics(b)
    check(w1['bars'] < b0['bars'], f'real Ctrl+wheel up over the lanes did not zoom the timeline in (--visible-bars {b0["bars"]} -> {w1["bars"]})')
    send_input(b, [{'t': 'wheel', 'x': rect['x'], 'y': rect['y'], 'dy': 120, 'mod': CTRL}, {'t': 'wheel', 'x': rect['x'], 'y': rect['y'], 'dy': 120, 'mod': CTRL},
                   {'t': 'wheel', 'x': rect['x'], 'y': rect['y'], 'dy': 120, 'mod': CTRL}])
    w2 = metrics(b)
    check(w2['bars'] > w1['bars'], f'real Ctrl+wheel down did not zoom the timeline out ({w1["bars"]} -> {w2["bars"]})')
    # ...and to the real keys
    key = lambda k: [{'t': 'key', 'key': k[0], 'code': k[1], 'vk': k[2], 'mod': k[3]}]
    b.eval('(()=>{AxiomStudioDaw.setZoom(0);return 1})()')
    k0 = metrics(b)['bars']
    send_input(b, key(KEYS[0]))
    k1 = metrics(b)['bars']
    check(k1 < k0, f'real Ctrl+= did not zoom the timeline in ({k0} -> {k1})')
    send_input(b, key(KEYS[1]))
    k2 = metrics(b)['bars']
    check(k2 > k1, f'real Ctrl+- did not zoom the timeline out ({k1} -> {k2})')
    send_input(b, key(KEYS[0]) + key(KEYS[0]))
    send_input(b, key(KEYS[2]))
    k3 = metrics(b)['bars']
    check(abs(k3 - k0) < 1e-6, f'real Ctrl+0 did not reset the timeline zoom ({k0} -> {k3})')
    # the page itself never moved, over the same events plus a full burst
    b.eval('(()=>{AxiomStudioDaw.setZoom(0);return 1})()')
    before, after = exercise(b, 'DAW (lanes)', rect['x'], rect['y'])
    check(abs(metrics(b)['dpr'] - b0['dpr']) < 1e-9 and metrics(b)['vvScale'] == b0['vvScale'], 'the page zoom differs from where it started')

    # Edge keeps ONE page zoom per host, so the Mini window (live_assist_window) and the coach prompt, which open as their own
    # windows on the same host and profile, must cancel Ctrl+wheel / Ctrl +/-/0 too, or they zoom the main window as well
    for label, path, ready in (('PEAK HOUR Mini window', '/live_assist_window?popup=1', "document.querySelector('.assist-shell, #live-assist-root, body > *') !== null"),
                               ('Coach prompt window', '/live_assist_coach_prompt', "document.getElementById('coach-prompt') !== null"),
                               # the launcher's real Mini window (axiom_windows_launcher.py open_mini) is this static page
                               ('Static Mini page', '/static/windows-live-assist-mini.html', "document.getElementById('mini-list') !== null")):
        print(f'[{label}]')
        b.run([{'op': 'navigate', 'url': path, 'settle': 2500}])
        check(b.eval(ready), f'{label} did not load')
        check(b.eval("[...document.scripts].some(s => /windows-studio-zoom[.]js/.test(s.src))"), f'{label} does not load windows-studio-zoom.js')
        size = b.eval('({w: innerWidth, h: innerHeight})')
        exercise(b, label, min(size['w'] // 2, 600), min(size['h'] // 2, 300))
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
print('PASS: real Ctrl+wheel and Ctrl +/-/0 never change devicePixelRatio, innerWidth, visualViewport.scale or the document width on the Library, Magic Set or the DAW, are always cancelled, and zoom the DAW timeline'
      if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
