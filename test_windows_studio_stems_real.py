r"""Studio DAW -> Create Stems with a REAL stem engine, end to end, in the real page of a sandbox copy of the app (headless Edge).

test_windows_studio_stems_flow.py proves the dialog chain with a FAKE engine. This one runs the real thing: a real Demucs
separation of a 30-second MP4 music VIDEO (AAC audio, like most of the owner's library), an MP3 and a WAV, and checks what the
user sees:
  A. engine present from the start: Create Stems on the MP4 clip shows progress (elapsed time, device), then the four stems are
     in the DAW (Play Stems offered, the four stem channels enabled) and every stem file has sound. A second click (Create Stems
     on the MP3 clip) works too.
  B. the engine appears WHILE THE APP RUNS (the owner's sequence): the app starts with no engine, Create Stems opens the install
     dialog, the engine is put into place while the dialog is open, Install finishes at once, the original request is retried by
     itself and the stems appear without restarting the app; then a second click works.
  C. forced failures show a message the user can SEE (on top of the DAW, not hidden behind it) and leave Create Stems usable: a
     source file that is gone, and a stems output folder this account cannot use (the owner's ~/.cache/axiom-stems/outputs-managed-v1
     denies its own user): PEAK HOUR replaces it with its own folder and the stems still work.

It needs a real engine and SKIPS cleanly without one. Point PH_STEM_ENGINE_ROOT at a DISPOSABLE folder that contains
`stem-runtime` and `stem-models` (a copy of <data>\stem-runtime and <data>\stem-models; torch needs short paths, so use something
like C:\Users\<you>\AppData\Local\Temp\ph_stemdbg\engine). The test never downloads and never touches the owner's data: it
MOVES (renames, instant) the two folders into its sandbox data folder, which lives inside that folder, and moves them back.

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "$env:PH_STEM_ENGINE_ROOT='C:\...\engine'; cd C:\Users\gatli\Documents\PeakHour; & .\axiom-win-env\Scripts\python.exe test_windows_studio_stems_real.py [A] [B] [C]"
PH_TEST_APP_DIR points at another app folder (e.g. dist\PEAK HOUR\app) to run the same flow on the built app."""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

workspace = Path(__file__).resolve().parent
sys.path.insert(0, str(workspace))
sys.stdout.reconfigure(errors='replace')
APP_DIR = os.environ.get('PH_TEST_APP_DIR') or str(workspace / 'axiom-win-probe')
ENGINE = os.environ.get('PH_STEM_ENGINE_ROOT')


def skip(why):
    print('SKIP: real stem separation: ' + why)
    sys.exit(0)


if not ENGINE:
    skip('PH_STEM_ENGINE_ROOT is not set. Set it to a disposable folder holding stem-runtime and stem-models (a real, installed stem engine).')
ENGINE = Path(ENGINE)
for part, probe in (('stem-runtime', Path('Scripts') / 'python.exe'), ('stem-models', Path('955717e8-8726e21a.th'))):
    if not (ENGINE / part / probe).is_file():
        skip(f'{ENGINE / part / probe} does not exist: PH_STEM_ENGINE_ROOT does not hold a real stem engine.')
if len(str(ENGINE)) > 60:
    skip(f'{ENGINE} is too long: PyTorch needs short paths. Use a folder close to the drive root.')
from feature_check import browser as fb
ok, why = fb.available()
if not ok:
    skip('page check unavailable: ' + why + ' (run from PowerShell)')
import imageio_ffmpeg
import numpy as np
import soundfile as sf

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
DATA = ENGINE / 'sandbox-data'  # same volume as the engine: moving it in and out is a rename

SERVER = r'''
import sys, pathlib
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3])
import axiom_windows_launcher as L
backend = L.build_app(port)
from werkzeug.serving import make_server
make_server('127.0.0.1', port, backend.app, threaded=True).serve_forever()
'''

HOOK = r'''
(() => {
  if (window.__log) return true;
  window.__log = {stems: [], toasts: [], errors: []};
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const post = String((init && init.method) || 'GET').toUpperCase() === 'POST';
    try {
      const response = await real(input, init);
      if (post && /\/api\/studio-daw\/stems$/.test(url.split('?')[0])) {
        const copy = response.clone();
        copy.text().then(text => window.__log.stems.push({status: response.status, body: text.slice(0, 600)})).catch(() => {});
      }
      return response;
    } catch (error) { if (post) window.__log.stems.push({status: 0, body: String(error)}); throw error; }
  };
  const toast = window.showToast;
  window.showToast = function (msg, bad, o) { window.__log.toasts.push({msg: String(msg), bad: !!bad}); return toast.apply(this, arguments); };
  window.addEventListener('error', e => window.__log.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => window.__log.errors.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));
  return true;
})()
'''

# what is on the screen, at a point you can actually see (not covered by the DAW)
SCREEN = r'''
(() => {
  const out = [];
  const seen = el => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
    const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const top = document.elementFromPoint(x, y); return !!top && (top === el || el.contains(top) || top.contains(el)); };
  for (const el of document.querySelectorAll('#toast-container > *, .player-notification-surface, [role=status], [role=alert], .daw-stem-progress, .daw-stem-message'))
    if (seen(el) && el.innerText.trim()) out.push(el.innerText.trim().replace(/\s+/g, ' '));
  return out;
})()
'''

CLIP = r'''
(() => {
  const p = AxiomStudioDaw.activeProject; if (!p) return null;
  return p.arrangementClips.map(c => ({id: c.id, path: c.path, state: c.stemState, job: c.stemJob || null,
    progress: window.AxiomStems && AxiomStems.progress(c)}));
})()
'''

failures = []
servers, browsers = [], []


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)
    return bool(cond)


def free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


def make_media(folder):
    """30 s of tones + noise as an MP4 music video (H.264 + AAC), an MP3 and a WAV."""
    folder.mkdir(parents=True, exist_ok=True)
    audio = ['-f', 'lavfi', '-i', 'sine=f=220:d=30', '-f', 'lavfi', '-i', 'sine=f=330:d=30', '-f', 'lavfi', '-i', 'anoisesrc=d=30:a=0.08:c=pink',
             '-f', 'lavfi', '-i', 'sine=f=60:d=30']
    mix = '[0][1][2][3]amix=inputs=4:duration=first:normalize=0,volume=2,tremolo=f=2:d=0.6[a]'

    def run(*args):
        r = subprocess.run([FFMPEG, '-nostdin', '-v', 'error', '-y', *args], capture_output=True, text=True, creationflags=0x08000000)
        assert r.returncode == 0, r.stderr
    run(*audio, '-f', 'lavfi', '-i', 'testsrc=s=320x240:r=15:d=30', '-filter_complex', mix, '-map', '4:v', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
        str(folder / 'clip video.mp4'))
    run(*audio, '-filter_complex', mix, '-map', '[a]', '-c:a', 'libmp3lame', '-b:a', '160k', '-ar', '44100', '-ac', '2', str(folder / 'clip.mp3'))
    run(*audio, '-filter_complex', mix, '-map', '[a]', '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2', str(folder / 'clip.wav'))
    return {name: str(folder / name) for name in ('clip video.mp4', 'clip.mp3', 'clip.wav')}


def track_for(path):
    name = Path(path).name
    return {'path': path, 'title': name, 'artist': 'Test', 'bpm': 120, 'durationSec': 30, 'duration': 30, 'key': '8A', 'name': name}


class Sandbox:
    def __init__(self, label):
        self.base = Path(os.environ.get('TEMP', str(ENGINE))) / ('phr' + label + str(os.getpid()))
        shutil.rmtree(self.base, ignore_errors=True)
        for name in ('local', 'home', 'roaming', 'music'):
            (self.base / name).mkdir(parents=True)
        (self.base / 'home' / '.cache').mkdir()
        self.port = free_port()
        assert self.port != 8080
        self.url = f'http://127.0.0.1:{self.port}'
        self.env = {**os.environ, 'LOCALAPPDATA': str(self.base / 'local'), 'USERPROFILE': str(self.base / 'home'), 'HOME': str(self.base / 'home'),
                    'APPDATA': str(self.base / 'roaming'), 'AXIOM_RUNTIME_DIR': str(DATA), 'AXIOM_LICENSE_REQUIRED': '0',
                    'AXIOM_NO_OPEN': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
        self.proc = None
        self.browser = None

    def start_server(self):
        self.proc = subprocess.Popen([sys.executable, '-c', SERVER, str(self.base), str(self.port), APP_DIR], env=self.env,
                                     cwd=str(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        servers.append(self.proc)
        for _ in range(240):
            try:
                urllib.request.urlopen(self.url + '/api/library/stats', timeout=2).read()
                return
            except OSError:
                time.sleep(0.5)
        raise AssertionError('the app did not start')

    def get(self, path):
        with urllib.request.urlopen(self.url + path, timeout=30) as r:
            return json.loads(r.read().decode('utf-8'))

    def open_page(self):
        self.browser = fb.Browser(sandbox=self.base / 'edge', base_url=self.url)
        browsers.append(self.browser)
        b = self.browser
        b.run([{'op': 'navigate', 'url': '/', 'settle': 4000}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 3}])
        b.eval(HOOK)
        b.eval("(()=>{showTab('studio');return 1})()")
        time.sleep(0.8)
        return b

    def open_daw(self, *paths):
        b = self.browser
        b.eval("(async()=>{AxiomStudioDaw.showStudioDawProject(%s,'track');await new Promise(r=>setTimeout(r,2500));return 1})()" % json.dumps(track_for(paths[0])))
        check(b.eval('!!(window.AxiomStudioDaw && AxiomStudioDaw.surfaceVisible)'), 'the Studio DAW did not open')
        for path in paths[1:]:  # more songs: each is its own clip
            b.eval("(async()=>{AxiomStudioDaw.addTrackToProject(%s);await new Promise(r=>setTimeout(r,800));return 1})()" % json.dumps(track_for(path)))

    def clips(self):
        return self.browser.eval(CLIP)

    def log(self):
        return json.loads(self.browser.eval('JSON.stringify(window.__log)'))

    def screen(self):
        return self.browser.eval(SCREEN)

    def select(self, index):
        b = self.browser
        clip_id = self.clips()[index]['id']
        r = b.run([{'op': 'click', 'selector': '[data-daw-clip-id="%s"]' % clip_id, 'timeout': 8}, {'op': 'sleep', 'seconds': 0.6}])
        check(r.steps[0].get('ok'), f'could not select clip {index}: {r.steps[0].get("error")}')

    def click_create(self, index=0):
        self.select(index)
        r = self.browser.run([{'op': 'click_text', 'text': 'Create Stems', 'timeout': 8}])
        check(r.steps[0].get('ok'), f'could not click the inspector "Create Stems" button: {r.steps[0].get("error")}')

    def wait(self, expr, seconds=20):
        end = time.time() + seconds
        while time.time() < end:
            if self.browser.eval(f'Boolean({expr})'):
                return True
            time.sleep(0.25)
        return False

    def watch_job(self, index=0, seconds=420):
        """Follow the clip until it is ready or failed; returns (final state, texts the user saw while it ran, seconds)."""
        seen, start = [], time.time()
        while time.time() - start < seconds:
            state = self.clips()[index]
            shown = self.browser.eval("[...document.querySelectorAll('.daw-stem-progress')].filter(e=>e.getClientRects().length).map(e=>e.innerText.trim().replace(/\\s+/g,' '))")
            for text in shown:
                if text not in seen:
                    seen.append(text)
            if state['state'] in ('ready', 'failed', 'cancelled', 'stale'):
                return state['state'], seen, time.time() - start
            time.sleep(0.4)
        return 'timeout', seen, time.time() - start

    def stems_visible_and_loud(self, index, label):
        """The DAW offers the stems (Play Stems, enabled channels) and every stem file the page would play has sound."""
        b = self.browser
        job = self.clips()[index]['job']
        check(bool(job), f'{label}: the clip has no stem job after "ready"')
        self.select(index)
        buttons = b.eval("[...document.querySelectorAll('button')].filter(x=>x.getClientRects().length).map(x=>x.innerText.trim())")
        check(any('play stems' in x.lower() for x in buttons), f'{label}: no "Play Stems" button in the DAW: {[x for x in buttons if x][:30]}')
        pending = b.eval("document.querySelectorAll('#studio-daw-clip-inspector .daw-inspector-stem.pending').length")
        sliders = b.eval("[...document.querySelectorAll('#studio-daw-clip-inspector .daw-inspector-stem')].map(e=>e.innerText.trim().split(/\\s+/)[0]).join(',')")
        check(pending == 0 and all(n in sliders.lower() for n in ('vocals', 'drums', 'bass', 'harmony')), f'{label}: the four stem channels are not all usable in the inspector ({sliders}, pending={pending})')
        levels = {}
        for name in ('vocals', 'other', 'bass', 'drums'):
            with urllib.request.urlopen(f'{self.url}/api/studio-daw/stems/{job}/{name}', timeout=60) as r:
                data = r.read()
            path = self.base / f'{label}-{name}.wav'
            path.write_bytes(data)
            y, rate = sf.read(path)
            levels[name] = float(np.sqrt(np.mean(np.square(y)))) if len(y) else 0.0
            check(rate == 44100 and len(y) > 44100 * 20, f'{label}: {name} is not about 30 s at 44.1 kHz ({len(y)} samples at {rate})')
            # the test song has no singer, so the vocals stem is nearly empty by design: it must still be a real, non-zero signal
            check(levels[name] > (1e-5 if name == 'vocals' else 5e-3), f'{label}: the {name} stem is silent (rms {levels[name]:.6f})')
        print('  stems rms:', {k: round(v, 4) for k, v in levels.items()})

    def stop(self):
        if self.browser is not None:
            try:
                self.browser.close()
            except Exception:
                pass
        if self.proc is not None:
            subprocess.run(['taskkill', '/T', '/F', '/PID', str(self.proc.pid)], capture_output=True)
            self.proc = None
        time.sleep(1)
        shutil.rmtree(self.base, ignore_errors=True)


def engine_in():
    DATA.mkdir(parents=True, exist_ok=True)
    for part in ('stem-runtime', 'stem-models'):
        if (ENGINE / part).is_dir() and not (DATA / part).exists():
            for attempt in range(60):  # a virus scanner may hold freshly written files for a while ("Access is denied")
                try:
                    os.replace(ENGINE / part, DATA / part)
                    break
                except PermissionError:
                    if attempt == 59:
                        raise
                    time.sleep(2)


def engine_out():
    for part in ('stem-runtime', 'stem-models'):
        if (DATA / part).is_dir() and not (ENGINE / part).exists():
            for attempt in range(40):
                try:
                    os.replace(DATA / part, ENGINE / part)
                    break
                except PermissionError:
                    time.sleep(1.5)


def scenario_a(media):
    print('[A: engine present from the start; MP4 video clip, then an MP3 clip]')
    engine_in()
    sb = Sandbox('A')
    try:
        sb.start_server()
        check(sb.get('/api/windows/stem-engine/status').get('ready') is True, 'the engine is not ready in the sandbox')
        sb.open_page()
        sb.open_daw(media['clip video.mp4'], media['clip.mp3'])
        clips = sb.clips()
        check(len(clips) >= 2, f'expected an MP4 and an MP3 clip in the project, got {len(clips)}')
        sb.click_create(0)
        time.sleep(1.5)
        print('  after click:', sb.clips()[0]['state'], sb.log()['stems'], sb.log()['toasts'], sb.screen())
        state, seen, took = sb.watch_job(0)
        print(f'  MP4: {state} after {took:.0f} s; progress texts the user saw: {seen[:4]}')
        check(len(seen) >= 1, 'no progress text was ever visible while separating')
        check(any('CUDA' in s.upper() or 'CPU' in s.upper() for s in seen), f'progress never named the device (GPU/CUDA or CPU): {seen[-3:]}')
        print('  distinct progress texts:', len(seen), '| last:', seen[-1:] )
        check(state == 'ready', f'MP4 stems ended {state}; toasts: {sb.log()["toasts"][-3:]}; stems answers: {sb.log()["stems"][-2:]}')
        if state == 'ready':
            sb.stems_visible_and_loud(0, 'mp4')
        w = sb.log()
        check(not w['errors'], f'the page raised errors: {w["errors"][:3]}')
        print('  toasts:', [t['msg'] for t in w['toasts']][-3:])
        sb.click_create(1)
        time.sleep(1.5)
        state, seen, took = sb.watch_job(1)
        print(f'  MP3 (second click): {state} after {took:.0f} s')
        check(state == 'ready', f'the second click (MP3) ended {state}; toasts: {sb.log()["toasts"][-3:]}')
        if state == 'ready':
            sb.stems_visible_and_loud(1, 'mp3')
    finally:
        sb.stop()
        engine_out()


def scenario_b(media):
    print('[B: the engine appears while the app runs]')
    engine_out()
    shutil.rmtree(DATA, ignore_errors=True)
    sb = Sandbox('B')
    try:
        sb.start_server()
        check(sb.get('/api/windows/stem-engine/status').get('ready') is False, 'the sandbox should start without an engine')
        sb.open_page()
        sb.open_daw(media['clip video.mp4'], media['clip.mp3'])
        sb.click_create(0)
        check(sb.wait("document.getElementById('axiom-stem-install')"), 'the install dialog did not appear')
        engine_in()  # the install "finishes": the engine is in place while the app keeps running
        sb.browser.run([{'op': 'click', 'selector': '#axiom-stem-install-go'}])
        check(sb.wait("!document.getElementById('axiom-stem-install')", 30), 'the dialog did not close once the engine was there')
        time.sleep(1.5)
        print('  after install:', sb.clips()[0]['state'], [s['status'] for s in sb.log()['stems']], sb.log()['toasts'][-3:], sb.screen())
        state, seen, took = sb.watch_job(0)
        w = sb.log()
        print(f'  after the install: {state} after {took:.0f} s; stems answers {[s["status"] for s in w["stems"]]}; progress: {seen[:3]}')
        print('  toasts:', w['toasts'][-4:], 'errors:', w['errors'])
        check(len(w['stems']) == 2 and w['stems'][0]['status'] == 503 and w['stems'][1]['status'] == 202, f'expected 503 then 202, saw {[s["status"] for s in w["stems"]]}')
        check(len(seen) >= 1, 'no progress text was visible after the install')
        check(state == 'ready', f'stems did not appear after the install ({state}); toasts {w["toasts"][-3:]}; answers {w["stems"][-2:]}')
        if state == 'ready':
            sb.stems_visible_and_loud(0, 'appear')
        sb.click_create(1)
        time.sleep(1.5)
        state, seen, took = sb.watch_job(1)
        print(f'  second click: {state} after {took:.0f} s')
        check(state == 'ready', f'the second click after the install ended {state}; toasts {sb.log()["toasts"][-3:]}')
    finally:
        sb.stop()
        engine_out()


def scenario_c(media):
    print('[C: failures show a visible message]')
    engine_in()
    sb = Sandbox('C')
    try:
        sb.start_server()
        sb.open_page()
        missing = str(sb.base / 'music' / 'gone.mp3')
        sb.open_daw(missing)
        sb.click_create(0)
        time.sleep(2.5)
        screen = sb.screen()
        w = sb.log()
        print('  missing source: state', sb.clips()[0]['state'], '| on screen:', screen[:3], '| toasts:', [t['msg'] for t in w['toasts']][-2:], '| answers', [(s['status'], s['body'][:120]) for s in w['stems']])
        check(sb.clips()[0]['state'] != 'processing', 'the clip is stuck "processing" after a missing source')
        check(any(t['bad'] for t in w['toasts']), 'a missing source file produced no error message at all')
        check(not any(re.search(r'\bMac\b', s) for s in screen), f'the visible error talks about a Mac: {screen[:2]}')
        check(any(len(s) > 12 for s in screen), f'the error was not visible on screen (nothing readable on top of the DAW): toasts {w["toasts"][-2:]}')
        again = sb.browser.eval("[...document.querySelectorAll('button')].some(x=>x.getClientRects().length&&/^create stems$/i.test(x.innerText.trim()))")
        check(again, 'Create Stems is not offered again after the failure')
    finally:
        sb.stop()
        engine_out()


def scenario_d(media):
    print('[D: the stems output folder cannot be used by this account (the owner\'s ~/.cache/axiom-stems/outputs-managed-v1)]')
    engine_in()
    sb = Sandbox('D')
    try:
        # What the owner's folder does: opening a file in it raises PermissionError [Errno 13]. A folder in the place of .lock does the
        # same on Windows without touching any permission.
        (sb.base / 'home' / '.cache' / 'axiom-stems' / 'outputs-managed-v1' / '.lock').mkdir(parents=True)
        sb.start_server()
        sb.open_page()
        sb.open_daw(media['clip video.mp4'])
        sb.click_create(0)
        time.sleep(3)
        state = sb.clips()[0]['state']
        if state == 'processing':
            state, seen, took = sb.watch_job(0)
        w = sb.log()
        print('  state', state, '| answers', [(s['status'], s['body'][:200]) for s in w['stems']], '| toasts', [t['msg'] for t in w['toasts']][-2:], '| screen', sb.screen()[:2], '| errors', w['errors'])
        check(state == 'ready', f'stems did not work with an unusable output folder ({state})')
        if state == 'ready':
            sb.stems_visible_and_loud(0, 'cachefallback')
        jobs = [p for p in (DATA / 'cache' / 'axiom-stems' / 'outputs-managed-v1').glob('*') if p.is_dir()]
        check(bool(jobs), 'the stems were not written to PEAK HOUR\'s own cache folder (data folder\\cache\\axiom-stems)')
        check(not [p for p in (sb.base / 'home' / '.cache' / 'axiom-stems' / 'outputs-managed-v1').iterdir() if p.name != '.lock'],
              'the unusable folder was written to')
    finally:
        sb.stop()
        engine_out()


try:
    wanted = [a.upper() for a in sys.argv[1:]] or ['A', 'B', 'C', 'D']
    media = make_media(ENGINE / 'media')
    for name, fn in (('A', scenario_a), ('B', scenario_b), ('C', scenario_c), ('D', scenario_d)):
        if name in wanted:
            fn(media)
except BaseException:
    import traceback
    traceback.print_exc()
    failures.append('the test itself crashed')
finally:
    try:
        engine_out()
    except Exception:
        pass
    for b in browsers:
        try:
            b.close()
        except Exception:
            pass
    for p in servers:
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(p.pid)], capture_output=True)
    shutil.rmtree(ENGINE / 'media', ignore_errors=True)
    shutil.rmtree(DATA, ignore_errors=True)
print('PASS: real Create Stems (MP4/MP3), engine appearing while the app runs, failures visible' if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
