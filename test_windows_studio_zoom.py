"""Studio DAW zoom in a real (headless) Edge against the real app: Ctrl+wheel and Ctrl +, -, 0 must never change the
whole window's page zoom (the events are cancelled anywhere in the app), and while the Studio DAW is showing they
zoom the TIMELINE instead (--visible-bars changes; Ctrl+wheel keeps the beat under the pointer still; focus in a text
box, a menu or a slider makes no difference). Outside the DAW the events are cancelled and nothing else changes, and
normal text shortcuts (Ctrl+A, Ctrl+C) are left alone. Also checks the window launcher: --disable-pinch is in every
window's flags, the lanes carry touch-action: pan-x pan-y, and a page zoom Edge saved earlier (Preferences
partition.per_host_zoom_levels) is cleared before the window starts but nothing else in the file is touched.

Real Edge page zoom cannot be driven in headless Edge (there is no browser chrome to zoom), so the page-zoom side is
proven by what decides it: the wheel / keydown events reach the page cancelled (defaultPrevented), which is the only
thing Edge looks at before it zooms the page.

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\\Users\\gatli\\Documents\\PeakHour; & .\\axiom-win-env\\Scripts\\python.exe test_windows_studio_zoom.py"
Everything runs in a temp folder on a free port; nothing of the owner's is touched."""
import json
import math
import os
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

SERVER = r'''
import sys, pathlib
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'data'
backend = L.build_app(port)
from werkzeug.serving import make_server
make_server('127.0.0.1', port, backend.app, threaded=True).serve_forever()
'''

# Runs in the page: dispatches the event on the target and reports whether the page cancelled it.
FIRE = r'''
((kind, target, init) => {
  const el = typeof target === 'string' ? document.querySelector(target) : document.body;
  const event = kind === 'wheel' ? new WheelEvent('wheel', {bubbles: true, cancelable: true, ...init}) : new KeyboardEvent(kind, {bubbles: true, cancelable: true, ...init});
  el.dispatchEvent(event);
  return event.defaultPrevented;
})(%s, %s, %s)
'''

STATE = r'''
(() => {
  const timeline = document.querySelector('.studio-daw-timeline');
  const lanes = document.getElementById('studio-daw-lanes');
  return {bars: timeline ? Number(timeline.style.getPropertyValue('--visible-bars')) : null,
          start: lanes ? Number(lanes.dataset.viewStart) : null, beats: lanes ? Number(lanes.dataset.viewBeats) : null,
          visible: !!(window.AxiomStudioDaw && window.AxiomStudioDaw.surfaceVisible)};
})()
'''

ok, why = fb.available()
if not ok:
    print('SKIPPED page check: ' + why)
    sys.exit(0)

with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
url = f'http://127.0.0.1:{port}'
base = Path(tempfile.mkdtemp(prefix='phzoom'))
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'),
       'AXIOM_RUNTIME_DIR': str(base / 'data'), 'AXIOM_LICENSE_REQUIRED': '0'}
(base / 'local').mkdir()
(base / 'home').mkdir()
servers, browsers, failures = [], [], []


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)


def start():
    process = subprocess.Popen([sys.executable, '-c', SERVER, str(base), str(port), str(workspace / 'axiom-win-probe')],
                               env=env, cwd=str(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    servers.append(process)
    for _ in range(240):
        try:
            urllib.request.urlopen(url + '/api/library/stats', timeout=2).read()
            return
        except OSError:
            time.sleep(0.5)
    raise AssertionError('the app did not start')


def tone(path, seconds=6, sr=22050):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b''.join(struct.pack('<hh', *(int(8000 * math.sin(2 * math.pi * 330 * i / sr)),) * 2) for i in range(seconds * sr)))


def fire(b, kind, target, **init):
    return b.eval(FIRE % (json.dumps(kind), json.dumps(target), json.dumps(init)))


def state(b):
    return b.eval(STATE)


def settle(b, ms=250):
    b.eval('new Promise(r => setTimeout(r, %d))' % ms)


def key(b, target, k, code=None, **extra):
    return fire(b, 'keydown', target, key=k, code=code or '', ctrlKey=True, **extra)


try:
    music = base / 'music'
    music.mkdir()
    tracks = []
    for name in ('one.wav', 'two.wav'):
        tone(music / name)
        tracks.append({'path': str(music / name), 'title': name, 'artist': 'Test', 'bpm': 120, 'durationSec': 6, 'duration': 6, 'key': '8A', 'name': name})
    start()
    b = fb.Browser(sandbox=base / 'edge', base_url=url)
    browsers.append(b)
    b.run([{'op': 'navigate', 'url': '/', 'settle': 4000}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 3}])

    print('[outside the DAW]')
    check(b.eval('!!window.AxiomStudioDaw && AxiomStudioDaw.surfaceVisible === false'), 'the DAW should not be showing yet')
    check(fire(b, 'wheel', 'body', ctrlKey=True, deltaY=-100, clientX=300, clientY=300) is True, 'Ctrl+wheel outside the DAW was not cancelled (the window would zoom)')
    check(fire(b, 'wheel', 'body', ctrlKey=False, deltaY=-100, clientX=300, clientY=300) is False, 'a plain wheel must be left alone')
    for k, code in (('=', 'Equal'), ('+', 'Equal'), ('-', 'Minus'), ('0', 'Digit0'), ('+', 'NumpadAdd'), ('-', 'NumpadSubtract'), ('0', 'Numpad0')):
        check(key(b, 'body', k, code) is True, f'Ctrl+{k} ({code}) outside the DAW was not cancelled')
    check(fire(b, 'keydown', 'body', key='=', code='Equal', ctrlKey=False) is False, 'plain "=" must be left alone')
    check(fire(b, 'keydown', 'body', key='0', code='Digit0', ctrlKey=True, altKey=True) is False, 'Ctrl+Alt (AltGr) typing must be left alone')

    print('[open the DAW]')
    b.eval("(()=>{showTab('studio');return 1})()")
    settle(b, 800)
    b.eval("(async()=>{window.__T=%s;AxiomStudioDaw.showStudioDawProject(window.__T[0],'track');await new Promise(r=>setTimeout(r,1500));AxiomStudioDaw.addTrackToProject(window.__T[1]);await new Promise(r=>setTimeout(r,1500));return 1})()" % json.dumps(tracks), )
    s0 = state(b)
    print('  state:', s0)
    check(s0['visible'] and s0['bars'] and s0['bars'] > 0, f'the DAW did not open ({s0})')
    lanes_css = b.eval("getComputedStyle(document.getElementById('studio-daw-lanes')).touchAction")
    check(lanes_css == 'pan-x pan-y', f'lanes touch-action is {lanes_css!r}, expected "pan-x pan-y"')

    print('[Ctrl+wheel over the lanes]')
    rect = b.eval("(()=>{const r=document.querySelector('#studio-daw-lanes .studio-daw-lane').getBoundingClientRect();return {l:r.left,w:r.width,t:r.top+r.height/2}})()")
    x = rect['l'] + rect['w'] * 0.5
    beat_at = lambda s, px: s['start'] + (px - rect['l']) / rect['w'] * s['beats']
    anchor_before = beat_at(s0, x)
    check(fire(b, 'wheel', '#studio-daw-lanes .studio-daw-lane', ctrlKey=True, deltaY=-100, clientX=x, clientY=rect['t']) is True, 'Ctrl+wheel over the lanes was not cancelled')
    settle(b)
    s1 = state(b)
    print('  after zoom in:', s1)
    check(s1['bars'] < s0['bars'], f'Ctrl+wheel up did not zoom the timeline in ({s0["bars"]} -> {s1["bars"]})')
    check(abs(beat_at(s1, x) - anchor_before) < 0.5, f'the beat under the pointer moved: {anchor_before} -> {beat_at(s1, x)}')
    # a second step with the pointer near the left edge: the beat there stays put as well
    x2 = rect['l'] + rect['w'] * 0.2
    anchor2 = beat_at(s1, x2)
    fire(b, 'wheel', '#studio-daw-lanes .studio-daw-lane', ctrlKey=True, deltaY=-100, clientX=x2, clientY=rect['t'])
    settle(b)
    s2 = state(b)
    check(s2['bars'] < s1['bars'], 'a second Ctrl+wheel up did not zoom further in')
    check(abs(beat_at(s2, x2) - anchor2) < 0.5 or s2['start'] == 0, f'the beat under the pointer moved: {anchor2} -> {beat_at(s2, x2)}')
    check(fire(b, 'wheel', '#studio-daw-ruler', ctrlKey=True, deltaY=100, clientX=x, clientY=rect['t']) is True, 'Ctrl+wheel over the ruler was not cancelled')
    settle(b)
    s3 = state(b)
    check(s3['bars'] > s2['bars'], f'Ctrl+wheel down over the ruler did not zoom out ({s2["bars"]} -> {s3["bars"]})')

    print('[Ctrl +, -, 0]')
    full = s0['bars']
    for target, label in (('#studio-daw-lanes', 'lanes'), ('body', 'body')):
        b.eval("(()=>{AxiomStudioDaw.setZoom(0);return 1})()")
        before = state(b)['bars']
        check(key(b, target, '=', 'Equal') is True, f'Ctrl+= ({label}) not cancelled')
        zoomed = state(b)['bars']
        check(zoomed < before, f'Ctrl+= ({label}) did not zoom the timeline in ({before} -> {zoomed})')
        check(key(b, target, '-', 'Minus') is True, f'Ctrl+- ({label}) not cancelled')
        out = state(b)['bars']
        check(out > zoomed, f'Ctrl+- ({label}) did not zoom the timeline out ({zoomed} -> {out})')
        key(b, target, '+', 'Equal', shiftKey=True)
        check(state(b)['bars'] < out, f'Ctrl+Shift+= ({label}) did not zoom in')
        check(key(b, target, '0', 'Digit0') is True, f'Ctrl+0 ({label}) not cancelled')
        check(abs(state(b)['bars'] - full) < 1e-6, f'Ctrl+0 ({label}) did not go back to the default zoom ({state(b)["bars"]} vs {full})')
    # one press is one step (the DAW's own handler must not step it a second time)
    b.eval("(()=>{AxiomStudioDaw.setZoom(0);return 1})()")
    a = state(b)['bars']
    key(b, 'body', '=', 'Equal')
    once = state(b)['bars']
    b.eval("(()=>{AxiomStudioDaw.setZoom(0);AxiomStudioDaw.stepZoom(1);return 1})()")
    check(abs(state(b)['bars'] - once) < 1e-6, f'Ctrl+= stepped {a} -> {once}, a toolbar + step gives {state(b)["bars"]}')

    print('[focus in a text box, a menu, a slider]')
    b.eval("""(()=>{const shell=document.getElementById('studio-daw-shell');
      const t=document.createElement('input');t.type='text';t.id='ph-zoom-text';shell.appendChild(t);
      const r=document.createElement('input');r.type='range';r.id='ph-zoom-range';shell.appendChild(r);
      const s=document.createElement('div');s.id='ph-zoom-slider';s.setAttribute('role','slider');s.tabIndex=0;shell.appendChild(s);return 1})()""")
    for sel in ('#ph-zoom-text', '#ph-zoom-range', '#ph-zoom-slider', '#daw-zoom-resolution'):
        if not b.eval(f"!!document.querySelector({json.dumps(sel)})"):
            continue
        b.eval(f"(()=>{{AxiomStudioDaw.setZoom(0);document.querySelector({json.dumps(sel)}).focus();return 1}})()")
        before = state(b)['bars']
        check(key(b, sel, '=', 'Equal') is True, f'Ctrl+= with focus in {sel} was not cancelled')
        zoomed = state(b)['bars']
        check(zoomed < before, f'Ctrl+= with focus in {sel} did not zoom the timeline ({before} -> {zoomed})')
        key(b, sel, '-', 'Minus')
        check(state(b)['bars'] > zoomed, f'Ctrl+- with focus in {sel} did not zoom out')
        key(b, sel, '=', 'Equal')
        key(b, sel, '0', 'Digit0')
        check(abs(state(b)['bars'] - full) < 1e-6, f'Ctrl+0 with focus in {sel} did not reset')
        check(fire(b, 'wheel', sel, ctrlKey=True, deltaY=-100, clientX=x, clientY=rect['t']) is True, f'Ctrl+wheel over {sel} was not cancelled')
    # normal text-field shortcuts are not touched
    for letter in ('a', 'c', 'v', 'x'):
        check(fire(b, 'keydown', '#ph-zoom-text', key=letter, code='Key' + letter.upper(), ctrlKey=True) is False, f'Ctrl+{letter.upper()} in a text box was cancelled')

    print('[away from the DAW again]')
    b.eval("(()=>{AxiomStudioDaw.setZoom(0);return 1})()")
    b.eval("(()=>{AxiomStudioDaw.closeStudioDawShell();return 1})()")
    settle(b, 500)
    away = state(b)
    check(away['visible'] is False, f'the DAW should be hidden after closing it ({away})')
    check(fire(b, 'wheel', 'body', ctrlKey=True, deltaY=-100, clientX=300, clientY=300) is True, 'Ctrl+wheel with the DAW hidden was not cancelled')
    check(key(b, 'body', '=', 'Equal') is True, 'Ctrl+= with the DAW hidden was not cancelled')
    check(key(b, 'body', '0', 'Digit0') is True, 'Ctrl+0 with the DAW hidden was not cancelled')
    check(state(b)['bars'] in (None, 0) or abs(state(b)['bars'] - full) < 1e-6, 'the timeline zoom changed while the DAW was hidden')

    print('[launcher]')
    sys.path.insert(0, str(workspace / 'axiom-win-probe'))
    import axiom_windows_launcher as L
    check('--disable-pinch' in L.WINDOW_FLAGS, '--disable-pinch missing from WINDOW_FLAGS')
    check('--disable-pinch' in L.edge_command('edge.exe', 'http://127.0.0.1:1/', str(base / 'p')), '--disable-pinch missing from the app window command')
    profile = base / 'profile'
    (profile / 'Default').mkdir(parents=True)
    prefs = profile / 'Default' / 'Preferences'
    original = {'browser': {'x': 1}, 'partition': {'per_host_zoom_levels': {'1': {'127.0.0.1': {'zoom_level': 2.4, 'last_modified': '1'}}},
                                                   'default_zoom_level': {'x': 1.5}, 'keep': {'a': 1}}, 'name': 'caf\u00e9'}
    prefs.write_text(json.dumps(original), encoding='utf-8')
    check(L.reset_page_zoom(profile) is True, 'reset_page_zoom did not report removing a saved zoom')
    after = json.loads(prefs.read_text(encoding='utf-8'))
    check('per_host_zoom_levels' not in after['partition'] and 'default_zoom_level' not in after['partition'], 'saved zoom still in Preferences')
    check(after['partition'].get('keep') == {'a': 1} and after['browser'] == {'x': 1} and after['name'] == 'caf\u00e9', 'reset_page_zoom changed more than the zoom keys')
    check(L.reset_page_zoom(profile) is False, 'a second reset should find nothing to do')
    check(not (profile / 'Default' / 'Preferences.peak-hour-tmp').exists(), 'a temporary Preferences file was left behind')
    prefs.write_text('not json', encoding='utf-8')
    check(L.reset_page_zoom(profile) is False and prefs.read_text(encoding='utf-8') == 'not json', 'a damaged Preferences file must be left alone')
    check(L.reset_page_zoom(base / 'no-such-profile') is False, 'a missing profile must be ignored')
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
print('PASS: Ctrl+wheel and Ctrl +/-/0 never zoom the page (always cancelled); in the DAW they zoom the timeline around the pointer, also with focus in a text box, menu or slider; --disable-pinch, touch-action and the saved-zoom reset are in place'
      if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
