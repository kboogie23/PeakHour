r"""Studio DAW plug-in effects on Windows (VST3 through pedalboard; the page was written for Mac Audio Units).

- With no VST3 plug-in installed (the VST3 folders are pointed at an empty folder, the real worker is asked) the Plug-ins dialog
  says so plainly: "No VST3 plug-ins found in C:\Program Files\Common Files\VST3 ..." and the list shows "No VST3 plug-ins found"
  instead of a blank choice.
- A VST3 effect that the worker lists (a stand-in catalogue answers the plug-in routes, shaped exactly like the worker's replies:
  the worker's ids look like Audio Unit ids on purpose, so AXIOM's compiled checks accept them) can be chosen and attached to a clip:
  the saved effect passes the page's own validation, is stored on the clip, and its settings survive reopening the dialog. The
  prepare step asks the render route and returns the processed audio address.
- Nothing on the page calls it an "Audio Unit" or a "Mac" effect.
The worker itself (scan, inspect, render with a tail, the real endpoint) is covered by test_windows_vst3.py.

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\Users\gatli\Documents\PeakHour; & .\axiom-win-env\Scripts\python.exe test_windows_studio_plugins.py"
Everything runs in a temp folder on a free port; no plug-in installed on this PC is loaded."""
import json
import math
import os
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
ok, why = fb.available()
if not ok:
    print('SKIPPED page check: ' + why)
    sys.exit(0)

with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
url = f'http://127.0.0.1:{port}'
base = Path(tempfile.mkdtemp(prefix='phrec'))
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'),
       'AXIOM_RUNTIME_DIR': str(base / 'data'), 'AXIOM_LICENSE_REQUIRED': '0',
       'AXIOM_VST3_FOLDERS': str(base / 'no-vst3')}  # the worker scans only this empty folder, never the PC's real VST3 folders
(base / 'local').mkdir()
(base / 'no-vst3').mkdir()
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


def tone(path, seconds=6, sr=44100, freq=440, amp=12000):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b''.join(struct.pack('<hh', *(int(amp * math.sin(2 * math.pi * freq * i / sr)),) * 2) for i in range(seconds * sr)))


def page(extra):
    b = fb.Browser(sandbox=base / ('edge-' + str(len(browsers))), base_url=url, extra_args=['--autoplay-policy=no-user-gesture-required', *extra])
    browsers.append(b)
    b.run([{'op': 'navigate', 'url': '/', 'settle': 4000}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 3}])
    b.eval("(()=>{showTab('studio');return 1})()")
    b.eval('new Promise(r => setTimeout(r, 800))')
    return b


BS = chr(92)
EMPTY_MESSAGE = 'No VST3 plug-ins found in C:' + BS + 'Program Files' + BS + 'Common Files' + BS + 'VST3'
PLUGIN = {'id': '61756678-1a2b3c4d-5e6f7a8b', 'name': 'Fixture Gain', 'manufacturer': 'Fixture Audio', 'version': 66051}
RENDER_ID = 'ab' * 32
# Edge's fetch answers the plug-in routes like the worker does: scan lists one VST3 effect, inspect returns its controls and state
STUB = """
(() => {
  const real = window.fetch.bind(window);
  window.__calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  window.fetch = (input, init) => {
    const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
    if (!path.startsWith('/api/studio-daw/plugins/')) return real(input, init);
    const body = init && init.body ? JSON.parse(init.body) : null;
    window.__calls.push([path, body]);
    if (path.endsWith('/scan')) return Promise.resolve(json({plugins: [PLUGIN_JSON]}));
    if (path.endsWith('/inspect')) return Promise.resolve(json({state: body.state || 'AAAA', parameters: [
      {address: '0', name: 'Gain', value: body.parameters ? body.parameters['0'] : 0.5, min: 0, max: 1, unitCode: 0, writable: true, displayValue: '0.50'},
      {address: '1', name: 'Bypass', value: 0, min: 0, max: 1, unitCode: 2, writable: true, displayValue: 'Off'}]}));
    if (path === '/api/studio-daw/plugins/render') return Promise.resolve(json({id: 'RENDER_ID', state: 'ready'}, 202));
    return Promise.resolve(json({state: 'ready', id: 'RENDER_ID'}));
  };
  return 1;
})()
""".replace('PLUGIN_JSON', json.dumps(PLUGIN)).replace('RENDER_ID', RENDER_ID)

DIALOG = """
(async () => {
  const p = AxiomStudioDaw.activeProject, clip = p.arrangementClips[0];
  document.querySelectorAll('#daw-native-effect-dialog').forEach(d => d.remove());  // a dialog closed a moment ago may not have left the page yet
  AxiomNativeEffects.open(clip.id);
  const dialog = document.getElementById('daw-native-effect-dialog');
  for (let i = 0; i < 30 && /Finding/.test(dialog.querySelector('output').textContent); i++) await new Promise(r => setTimeout(r, 200));
  return {text: dialog.innerText, options: [...dialog.querySelectorAll('select option')].map(o => o.textContent), status: dialog.querySelector('output').textContent, dialogs: document.querySelectorAll('#daw-native-effect-dialog').length, calls: (window.__calls || []).map(c => c[0])};
})()
"""
CHOOSE = """
(async () => {
  const p = AxiomStudioDaw.activeProject, clip = p.arrangementClips[0];
  const dialog = document.getElementById('daw-native-effect-dialog');
  const select = dialog.querySelector('select'); select.value = 'PLUGIN_ID'; select.dispatchEvent(new Event('change'));
  for (let i = 0; i < 30 && !dialog.querySelector('[data-address]'); i++) await new Promise(r => setTimeout(r, 200));
  const input = dialog.querySelector('[data-address="0"]'); input.value = '0.8'; input.dispatchEvent(new Event('input'));
  const apply = dialog.querySelector('[data-apply]'); const enabled = !apply.disabled;
  apply.click();
  for (let i = 0; i < 30 && document.getElementById('daw-native-effect-dialog'); i++) await new Promise(r => setTimeout(r, 200));
  const saved = clip.nativeEffect;
  let valid = true; try { AxiomNativeEffects.validate(saved); } catch (e) { valid = e.message; }
  return {enabled, closed: !document.getElementById('daw-native-effect-dialog'), saved: saved && {id: saved.id, name: saved.name, enabled: saved.enabled, parameters: saved.parameters, format: saved.format}, valid};
})()
""".replace('PLUGIN_ID', PLUGIN['id'])
REOPEN = """
(async () => {
  AxiomNativeEffects.open(AxiomStudioDaw.activeProject.arrangementClips[0].id);
  const d = document.getElementById('daw-native-effect-dialog');
  for (let i = 0; i < 30 && !d.querySelector('[data-address]'); i++) await new Promise(r => setTimeout(r, 200));
  const value = d.querySelector('[data-address="0"]').value; d.close(); return value;
})()
"""
PREPARE = """
(async () => {
  const p = AxiomStudioDaw.activeProject, clip = p.arrangementClips[0];
  const url = await AxiomNativeEffects.prepare(clip, '/api/studio-daw/stretch/' + 'cd'.repeat(32) + '/audio', () => false, p);
  const render = window.__calls.filter(c => c[0] === '/api/studio-daw/plugins/render').map(c => ({id: c[1].id, preparedId: c[1].preparedId}));
  return {url, render};
})()
"""

try:
    music = base / 'music'
    music.mkdir()
    start()
    b = page([])
    tone(music / 'one.wav', sr=22050, freq=330, amp=8000)
    track = {'path': str(music / 'one.wav'), 'title': 'one.wav', 'artist': 'Test', 'bpm': 120, 'durationSec': 6, 'duration': 6, 'key': '8A', 'name': 'one.wav'}
    b.eval("(async()=>{AxiomStudioDaw.showStudioDawProject(%s,'track');await new Promise(r=>setTimeout(r,1500));return 1})()" % json.dumps(track))

    print('[no VST3 plug-in installed: the real worker scans an empty folder]')
    empty = b.eval(DIALOG)
    print('  options:', empty['options'], '| status:', empty['status'])
    check(empty['status'].startswith(EMPTY_MESSAGE), f'the empty state should name the folder: {empty["status"]}')
    check(empty['options'] == ['No VST3 plug-ins found'], f'the list should say there is nothing, not show a blank choice: {empty["options"]}')
    check('Audio Unit' not in empty['text'] and ' Mac ' not in empty['text'], f'the dialog still talks about Audio Units / Mac: {empty["text"]}')
    b.eval("document.getElementById('daw-native-effect-dialog').close()")

    print('[a listed VST3 effect can be chosen, saved on the clip and prepared]')
    b.eval(STUB)
    listed = b.eval(DIALOG)
    print('  options:', listed['options'], '| status:', listed['status'])
    check(listed['options'] == ['Choose effect', 'Fixture Audio: Fixture Gain'], f'the plug-in should be listed: {listed}')
    check(listed['status'] == 'Choose an effect', f'status with plug-ins: {listed["status"]}')
    chosen = b.eval(CHOOSE)
    print('  saved:', chosen)
    check(chosen['enabled'] and chosen['closed'], f'the effect could not be attached: {chosen}')
    check(chosen['valid'] is True, f'the saved VST3 effect fails the page validation: {chosen["valid"]}')
    saved = chosen['saved'] or {}
    check(saved.get('id') == PLUGIN['id'] and saved.get('name') == 'Fixture Gain' and saved.get('enabled') is True and (saved.get('parameters') or {}).get('0') == 0.8,
          f'the clip should hold the effect with its settings: {saved}')
    again = b.eval(REOPEN)
    check(float(again) == 0.8, f'reopening the dialog should show the saved setting 0.8, got {again}')
    prepared = b.eval(PREPARE)
    print('  prepared:', prepared)
    check(prepared['url'] == f'/api/studio-daw/plugins/render/{RENDER_ID}/audio', f'prepare should return the processed audio: {prepared["url"]}')
    check(prepared['render'] and prepared['render'][0]['id'] == PLUGIN['id'], f'prepare should ask the render route for the chosen plug-in: {prepared["render"]}')
finally:
    for b in browsers:
        b.close()
    for s in servers:
        s.terminate()
        try:
            s.wait(15)
        except Exception:
            s.kill()
    import shutil
    shutil.rmtree(base, ignore_errors=True)
if failures:
    print('FAIL (%d)' % len(failures))
    sys.exit(1)
print('PASS: an empty VST3 folder says so; a listed VST3 effect is chosen, validated, saved on the clip and prepared')


