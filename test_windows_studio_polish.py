"""Four small Studio fixes in a real (headless) Edge against the real app:
 1. The clip inspector's Fade In / Fade Out sliders are measured in beats and say "beats" (not "bars").
 2. A Windows path (backslashes) gives its file name as the title (Studio DAW library menu, drag from the Library, CSV import
    name, saved-cue file name), not the whole path.
 3. Mac wording shown on Windows becomes PC wording ("this Mac" -> "this PC", the stem-engine "Reinstall the complete AXIOM
    app for this Mac" message), and a quoted file path is never rewritten.
 4. With activation switched off the page never calls POST /api/license/validate (it answered 400 on every page load);
    when activation is on (the flag cleared) the call is still made, so the macOS path is unchanged.

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\\Users\\gatli\\Documents\\PeakHour; & .\\axiom-win-env\\Scripts\\python.exe test_windows_studio_polish.py"
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
base = Path(tempfile.mkdtemp(prefix='phpolish'))
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


def settle(b, ms=400):
    b.eval('new Promise(r => setTimeout(r, %d))' % ms)


def fetch_text(path):
    return urllib.request.urlopen(url + path, timeout=30).read().decode('utf-8')


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
    settle(b, 4000)  # the page asks about its licence 2.5 s after it loads

    print('[no licence validation while activation is off]')
    flag = b.eval('window.PeakHourActivationOff')
    count = lambda: b.eval("performance.getEntriesByType('resource').filter(e => e.name.includes('/api/license/validate')).length")
    check(flag is True, f'windows-hide-mac.js did not mark activation as off (flag {flag!r})')
    check(count() == 0, f'the page called /api/license/validate {count()} time(s) on load')
    b.eval("""(()=>{window.__lv=0;const real=window.fetch.bind(window);window.fetch=(input,init)=>{if(String(input&&input.url||input).includes('/api/license/validate'))window.__lv++;return real(input,init)};return 1})()""")
    b.eval("(async()=>{await validateAxiomLicenseOnline(false);return 1})()")
    check(b.eval('window.__lv') == 0, 'validateAxiomLicenseOnline() still called the server with activation off')
    b.eval("(async()=>{window.PeakHourActivationOff=false;await validateAxiomLicenseOnline(false);return 1})()")
    check(b.eval('window.__lv') == 1, 'with the flag cleared (activation on, as on macOS) the validation call must still be made')
    b.eval("(()=>{window.PeakHourActivationOff=true;return 1})()")

    print('[Mac wording]')
    said = b.eval("""(() => ({
      toast: PeakHourRename('This Studio track is not playable on this Mac. Reconnect it before opening Studio DAW.'),
      another: PeakHourRename('A portable project with copies of its audio for backup or another Mac.'),
      stem: PeakHourRename('This app is missing its stem engine. Reinstall the complete AXIOM app for this Mac; copying a project alone cannot install the engine.'),
      decoder: PeakHourRename('This app is missing its audio decoder. Reinstall the complete AXIOM app for this Mac.'),
      path: PeakHourRename("Could not open 'C:\\\\Users\\\\Mac\\\\AXIOM DJ\\\\a.wav' on this Mac."),
    }))()""")
    print('  ', said)
    check('this PC' in said['toast'] and 'Mac' not in said['toast'], f'toast still says Mac: {said["toast"]!r}')
    check('another PC' in said['another'] and 'Mac' not in said['another'], f'draft text still says Mac: {said["another"]!r}')
    for key in ('stem', 'decoder'):
        check('Mac' not in said[key] and 'AXIOM' not in said[key] and 'PEAK HOUR' in said[key] and 'this PC' in said[key], f'{key} message not converted: {said[key]!r}')
    check("'C:\\Users\\Mac\\AXIOM DJ\\a.wav'" in said['path'] and said['path'].endswith('on this PC.'), f'a quoted path must stay as it is: {said["path"]!r}')
    # and really on the page: a toast the DAW shows
    shown = b.eval("""(async()=>{showToast('That Studio track is unavailable on this Mac. Reconnect it before adding it to the DAW.', true);
      await new Promise(r => setTimeout(r, 400));
      return [...document.querySelectorAll('body *')].some(e => e.children.length === 0 && /unavailable on this (Mac|PC)/.test(e.textContent) && /this PC/.test(e.textContent))})()""")
    check(shown is True, 'the toast on the page did not say "this PC"')

    print('[beats in the inspector]')
    b.eval("(()=>{showTab('studio');return 1})()")
    settle(b, 800)
    b.eval("(async()=>{window.__T=%s;AxiomStudioDaw.showStudioDawProject(window.__T[0],'track');await new Promise(r=>setTimeout(r,1500));return 1})()" % json.dumps(tracks))
    b.eval("(()=>{document.querySelector('.studio-daw-clip[data-daw-clip-id]').click();return 1})()")
    settle(b, 800)
    sliders = b.eval("""(()=>[...document.querySelectorAll('label.daw-inspector-slider')].filter(l => /Fade (In|Out)/.test(l.textContent)).map(l => l.textContent.replace(/\\s+/g, ' ').trim()))()""")
    print('  ', sliders)
    check(len(sliders) == 2, f'expected the Fade In and Fade Out sliders, found {sliders}')
    check(all('beats' in s and 'bars' not in s for s in sliders), f'the fade sliders should be measured in beats: {sliders}')

    print('[Windows path titles]')
    win = 'C:\\\\Music\\\\Crate\\\\Windows Song.mp3'
    drag = b.eval("""(() => { let seen = ''; dragTrackFromLibrary({dataTransfer: {setData: (t, v) => { if (t === 'text/plain') seen = v; }}}, '%s'); return JSON.parse(decodeURIComponent(seen)).title; })()""" % win)
    check(drag == 'Windows Song.mp3', f'dragging from the Library gave the title {drag!r}')
    b.eval("""(() => { AxiomStudioDaw.openLibraryTrackMenu({preventDefault(){}, stopPropagation(){}, clientX: 20, clientY: 20}, '%s'); return 1 })()""" % win)
    menu = b.eval("""(async () => { const add = document.querySelector('[data-studio-daw-menu-action="add"]'); if (!add) return 'no menu';
      const before = AxiomStudioDaw.activeProject.arrangementClips.length; add.click(); await new Promise(r => setTimeout(r, 1500));
      const clips = AxiomStudioDaw.activeProject.arrangementClips; return clips.length > before ? clips[clips.length - 1].title : 'not added (' + clips.length + ')'; })()""")
    check(menu == 'Windows Song.mp3', f'the Studio DAW library menu titled the track {menu!r}')
    for file, pattern, label in (('/static/js/surfaces/studio-brief.js', r'csvPath\.split\(/\[\\\\/\]/\)', 'CSV import name'),
                                 ('/static/js/surfaces/studio-cues.js', r'b\.replace\(/\^\.\*\[\\\\/\]/', 'saved-cue file name')):
        check(re.search(pattern, fetch_text(file)) is not None, f'{label}: the page script does not split on both separators')
    names = b.eval("""(() => ['C:\\\\Music\\\\cues\\\\set one.json', '/Users/x/cues/set two.json'].map(b => b.replace(/^.*[\\\\/]/, '')))()""")
    check(names == ['set one.json', 'set two.json'], f'the cue name pattern gave {names}')
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
print('PASS: no licence validation call while activation is off, Mac wording shows PC wording (paths untouched), fade sliders say beats, Windows paths give file-name titles'
      if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
