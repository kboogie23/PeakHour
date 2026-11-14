r"""Studio DAW: no visible control is a dead placeholder, in a real (headless) Edge against the real app.

- The page's own template no longer carries the "scaffolded" mixer toast or the "No Device" recording-input placeholder.
- The mixer Collapse / Expand button works from the very first click, whether or not composer.js has rewired it yet (the
  template now calls AxiomStudioDaw.toggleMixer() itself): it flips the shell's daw-mixer-collapsed state and shows no toast.
- The static Record button of the transport strip starts the real take recorder (AxiomDawTimelineRecording.toggle).
- The Library rail and the old transport strip are hidden in the Studio DAW (they are placeholders): nothing visible is dead.
- No fake clips ("Drums 01", "Vocal Chop 14", "Scratch Take 03", "Mic Vox 02") appear in the empty lanes of a real project,
  and no text on the page says "scaffold".

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\Users\gatli\Documents\PeakHour; & .\axiom-win-env\Scripts\python.exe test_windows_studio_controls.py"
Everything runs in a temp folder on a free port; nothing of the owner's is touched."""
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
base = Path(tempfile.mkdtemp(prefix='phctl'))
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'),
       'AXIOM_RUNTIME_DIR': str(base / 'data'), 'AXIOM_LICENSE_REQUIRED': '0'}
(base / 'local').mkdir()
(base / 'home').mkdir()
servers, browsers, failures = [], [], []


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)


def tone(path, seconds=6, sr=22050):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b''.join(struct.pack('<hh', *(int(8000 * math.sin(2 * math.pi * 330 * i / sr)),) * 2) for i in range(seconds * sr)))


STATE = """
(() => {
  const shell = document.getElementById('studio-daw-shell');
  const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return {w: Math.round(r.width), h: Math.round(r.height)}; };
  const mixer = shell.querySelector('.studio-daw-mixer-header button');
  const record = shell.querySelector('.studio-daw-transport button[aria-label="Record take"]');
  return {
    collapsed: shell.classList.contains('daw-mixer-collapsed'),
    mixerOnclick: mixer.getAttribute('onclick'), mixerText: mixer.textContent.trim(), mixerExpanded: mixer.getAttribute('aria-expanded'),
    recordOnclick: record && record.getAttribute('onclick'),
    rail: box(shell.querySelector('.studio-daw-library-rail')), transport: box(shell.querySelector('.studio-daw-transport')),
    recordBox: box(record),
    toasts: [...document.querySelectorAll('.toast, .axiom-toast, #toast')].map(t => t.textContent),
    laneClips: [...document.querySelectorAll('#studio-daw-lanes .studio-daw-clip')].map(c => c.textContent.trim().split(String.fromCharCode(10))[0]),
    scaffoldText: /scaffold/i.test(shell.innerText),
  };
})()
"""

try:
    start_process = subprocess.Popen([sys.executable, '-c', SERVER, str(base), str(port), str(workspace / 'axiom-win-probe')],
                                     env=env, cwd=str(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    servers.append(start_process)
    for _ in range(240):
        try:
            html = urllib.request.urlopen(url + '/', timeout=5).read().decode('utf-8')
            break
        except OSError:
            time.sleep(0.5)
    else:
        raise AssertionError('the app did not start')
    print('[the template]')
    check('scaffolded for this DAW slice' not in html, 'the mixer button still shows the "scaffolded" toast')
    check('No Device' not in html, 'the "No Device" recording-input placeholder is still in the page')
    check('AxiomStudioDaw.toggleMixer()' in html, 'the mixer button does not call toggleMixer() itself')

    music = base / 'music'
    music.mkdir()
    tone(music / 'one.wav')
    track = {'path': str(music / 'one.wav'), 'title': 'one.wav', 'artist': 'Test', 'bpm': 120, 'durationSec': 6, 'duration': 6, 'key': '8A', 'name': 'one.wav'}
    b = fb.Browser(sandbox=base / 'edge', base_url=url)
    browsers.append(b)
    b.run([{'op': 'navigate', 'url': '/', 'settle': 4000}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 3}])
    b.eval("(()=>{showTab('studio');return 1})()")
    b.eval('new Promise(r => setTimeout(r, 800))')
    b.eval("(async()=>{AxiomStudioDaw.showStudioDawProject(%s,'track');await new Promise(r=>setTimeout(r,1500));return 1})()" % json.dumps(track))

    print('[the page]')
    s = b.eval(STATE)
    print('  ', {k: s[k] for k in ('mixerOnclick', 'mixerText', 'recordOnclick', 'rail', 'transport', 'laneClips', 'scaffoldText')})
    check(s['mixerOnclick'] == 'AxiomStudioDaw.toggleMixer()', f'mixer button onclick: {s["mixerOnclick"]}')
    check(s['recordOnclick'] and 'AxiomDawTimelineRecording?.toggle' in s['recordOnclick'], f'transport Record button must start the real recorder: {s["recordOnclick"]}')
    check('window.AxiomDawTimelineRecording?.toggle?.()' in s['recordOnclick'] and 'window.AxiomDawTimelineRecording?.setup?.()' in html,
          f'the Record button must not reference AxiomDawTimelineRecording as a bare name: {s["recordOnclick"]}')
    unloaded = b.eval("""(()=>{const record=document.querySelector('#studio-daw-shell .studio-daw-transport button[aria-label="Record take"]');
      const saved=window.AxiomDawTimelineRecording;delete window.AxiomDawTimelineRecording;const errors=[];
      const listen=e=>errors.push(String(e.message));window.addEventListener('error',listen);
      record.click();record.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
      window.removeEventListener('error',listen);window.AxiomDawTimelineRecording=saved;return errors})()""")
    check(unloaded == [], f'clicking Record before the recorder script is loaded threw: {unloaded}')
    check(not s['rail'] or s['rail']['w'] == 0, f'the decorative Library rail is visible: {s["rail"]}')
    check(not s['transport'] or s['transport']['w'] == 0, f'the old transport strip is visible: {s["transport"]}')
    check(not any(re.search(r'Drums 01|Vocal Chop 14|Scratch Take 03|Mic Vox 02|Horn Stab|Impact 07', c) for c in s['laneClips']), f'fake clips on the lanes: {s["laneClips"]}')
    check(not s['scaffoldText'], 'the page text says "scaffold"')
    check(b.eval("(async()=>{AxiomStudioDaw.showStudioDawProject([%s,%s],'set');await new Promise(r=>setTimeout(r,1200));return /scaffold/i.test(document.getElementById('studio-daw-project-subtitle').textContent)})()" % (json.dumps(track), json.dumps(track))) is False,
          'a set project subtitle says "scaffold"')

    print('[the mixer button, before anything rewired it and after]')
    for label, prepare in (('as the template has it', "mixer.setAttribute('onclick','AxiomStudioDaw.toggleMixer()');mixer.textContent='Collapse';"), ('after composer.js', '')):
        toggled = b.eval("(async()=>{const shell=document.getElementById('studio-daw-shell');const mixer=shell.querySelector('.studio-daw-mixer-header button');%s"
                         "const was=shell.classList.contains('daw-mixer-collapsed');mixer.click();await new Promise(r=>setTimeout(r,200));const now=shell.classList.contains('daw-mixer-collapsed');"
                         "const text=mixer.textContent.trim();mixer.click();await new Promise(r=>setTimeout(r,200));return {was,now,text,back:shell.classList.contains('daw-mixer-collapsed'),"
                         "toast:/scaffold/i.test(document.body.innerText)}})()" % prepare)
        print('  ', label, toggled)
        check(toggled['was'] is False and toggled['now'] is True and toggled['back'] is False, f'{label}: the mixer button did not collapse and expand the mixer: {toggled}')
        check(toggled['text'] == 'Expand' and not toggled['toast'], f'{label}: label {toggled["text"]}, scaffold toast {toggled["toast"]}')
finally:
    for b in browsers:
        b.close()
    for s in servers:
        s.terminate()
        try:
            s.wait(15)
        except Exception:
            s.kill()
    shutil.rmtree(base, ignore_errors=True)
if failures:
    print('FAIL (%d)' % len(failures))
    sys.exit(1)
print('PASS: no placeholder control is visible or dead: the mixer button works from the first click, Record starts the recorder, no scaffold text or fake clips')
