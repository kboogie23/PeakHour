"""The video preview player in a real (headless) Edge against the real app: H.264+AAC MP4 with the index at the end,
the same with +faststart, and (when this PC's ffmpeg has libx265) an HEVC+AAC MP4. Each file is opened twice: once with
autoplay allowed and once with autoplay refused ("Press play to begin."). Measures time to first frame, time to unmute,
that the picture really moves, and how many prepare / plan / delete requests the page makes.

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\\Users\\gatli\\Documents\\PeakHour; & .\\axiom-win-env\\Scripts\\python.exe test_windows_video_player_page.py"
Everything runs in a temp folder on a free port; nothing of the owner's is touched. The Edge audio is muted
(--mute-audio) and the <video> volume is set to 0 after the unmute check."""
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

# Runs in the page: opens the file the way a Library click does and samples the player every 50 ms.
MEASURE = r'''
(async (path, name, waitMs) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = window.__vlog = [];
  if (!window.__vfetch) {
    window.__vfetch = true;
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/windows/video/')) log.push({url, method: (init && init.method) || 'GET', body: (init && init.body) || '', at: performance.now()});
      return real(input, init);
    };
  }
  log.length = 0;
  const t0 = performance.now();
  // diagnostic: when does play() settle, and how
  const plays = r0 => { r0.plays = []; if (!HTMLMediaElement.prototype.__wrapped) { const real = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.__wrapped = true;
    HTMLMediaElement.prototype.play = function () { const p = real.apply(this, arguments); const rec = window.__playLog; const at0 = performance.now(); p.then(() => rec && rec.push(['ok', Math.round(performance.now() - window.__t0)]), e => rec && rec.push([e.name, Math.round(performance.now() - window.__t0)])); return p; }; } };
  window.__playLog = []; window.__t0 = t0; plays({});
  playAudioFile(path, name, '', 0, '', 0);
  const video = () => document.querySelector('dialog.axiom-windows-video video');
  const statusEl = () => document.querySelector('dialog.axiom-windows-video [role=status]');
  const r = {mutedAtStart: video() ? video().muted : null, status: [], t: {}};
  let startTime = null, lastStatus = null, blackSince = null, blackMax = 0, converting = false;
  while (performance.now() - t0 < waitMs) {
    const v = video(); const now = Math.round(performance.now() - t0);
    if (v) {
      const s = statusEl() ? statusEl().textContent : '';
      if (s !== lastStatus) { r.status.push([now, s]); lastStatus = s; }
      if (/Converting/.test(s)) converting = true;
      const src = v.getAttribute('src');
      if (src && r.t.src === undefined) r.t.src = now;
      if (src && src !== r.src0 && r.src0 === undefined) r.src0 = src;
      if (src && r.src0 !== undefined && src !== r.src0) r.srcChanged = true;
      if (v.readyState >= 2 && r.t.ready === undefined) r.t.ready = now;
      if (v.videoWidth > 0 && r.t.width === undefined) r.t.width = now;
      if (r.t.unmuted === undefined && v.muted === false) r.t.unmuted = now;
      if (v.readyState >= 2 && startTime === null && !v.paused) startTime = v.currentTime;
      if (startTime !== null && v.currentTime - startTime > 1 && r.t.advance === undefined) r.t.advance = now;
      // sound without a picture: playing, time moving, no video dimensions
      if (!v.paused && v.currentTime > 0.3 && v.videoWidth === 0) { if (blackSince === null) blackSince = now; blackMax = Math.max(blackMax, now - blackSince); } else blackSince = null;
      if (r.t.refusedSeen === undefined && /Press play/.test(s)) r.t.refusedSeen = now;
      if (r.t.soundSeen === undefined && /Click for sound/.test(s)) r.t.soundSeen = now;
    }
    const swapDone = log.some(e => /prepare$/.test(e.url) && /"convert":true/.test(e.body));
    if (swapDone) r.convertRequested = true;
    await sleep(50);
    if (window.__vstop && window.__vstop(r)) break;
  }
  const v = video();
  r.final = v ? {paused: v.paused, muted: v.muted, readyState: v.readyState, videoWidth: v.videoWidth, currentTime: v.currentTime,
                 duration: v.duration, frames: v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : null,
                 error: v.error ? v.error.code : null, status: statusEl() ? statusEl().textContent : ''} : null;
  r.plays = window.__playLog; r.blackMax = blackMax; r.converting = converting;
  r.videos = document.querySelectorAll('dialog.axiom-windows-video video').length;
  r.log = log.map(e => ({m: e.method, u: e.url.replace(/^.*\/api\/windows\/video\//, ''), b: e.body}));
  r.entries = performance.getEntriesByType('resource').filter(e => e.name.includes('/api/windows/video/')).map(e => e.name.replace(/^.*\/api\/windows\/video\//, '')).length;
  return r;
})(%s, %s, %d)
'''

ok, why = fb.available()
if not ok:
    print('SKIPPED page check: ' + why)
    sys.exit(0)

with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
url = f'http://127.0.0.1:{port}'
base = Path(tempfile.mkdtemp(prefix='phvideo'))
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'),
       'AXIOM_RUNTIME_DIR': str(base / 'data'), 'AXIOM_LICENSE_REQUIRED': '0'}
(base / 'local').mkdir()
(base / 'home').mkdir()
servers, browsers = [], []
failures = []
report = []


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
            return process
        except OSError:
            time.sleep(0.5)
    raise AssertionError('the app did not start')


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


def ffmpeg_encoders():
    return subprocess.run([media.ffmpeg(), '-hide_banner', '-encoders'], capture_output=True, text=True).stdout


def make(name, vcodec, extra=(), seconds=20):
    out = base / 'VIDEO' / name
    out.parent.mkdir(parents=True, exist_ok=True)
    media.run_ffmpeg('-f', 'lavfi', '-i', f'testsrc=size=320x240:rate=25:duration={seconds}',
                     '-f', 'lavfi', '-i', f'sine=frequency=330:duration={seconds}:sample_rate=44100',
                     '-c:v', vcodec, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', *extra, out, timeout=300)
    return out


def routes(log):
    prep = [e for e in log if e['m'] == 'POST' and e['u'] == 'prepare']
    return {'prepare': len(prep), 'convert_prepare': sum(1 for e in prep if '"convert":true' in e['b'].replace(' ', '')),
            'plan': sum(1 for e in log if e['u'].endswith('/plan')), 'delete': sum(1 for e in log if e['m'] == 'DELETE')}


def measure(browser, path, name, wait_ms, stop=None):
    browser.eval('window.__vstop = ' + (stop or 'null'))
    return browser.eval(MEASURE % (json.dumps(path), json.dumps(name), wait_ms), timeout=wait_ms // 1000 + 60)


def fresh_page(browser):
    browser.open('/', settle=4000)
    browser.eval("localStorage.removeItem('peakhour.videoAudioOnly')")
    for _ in range(40):
        if browser.eval('!!(window.AxiomWindowsVideoPreview && window.AxiomWindowsVideoPreview.enabled && typeof playAudioFile==="function")'):
            return
        time.sleep(0.5)
    raise AssertionError('the video preview never became enabled on the page')


def silence(browser):
    browser.eval("(()=>{const v=document.querySelector('dialog.axiom-windows-video video');if(v){v.volume=0;v.muted=true}})()")


def close_dialog(browser):
    browser.eval("(()=>{const d=document.querySelector('dialog.axiom-windows-video');if(d&&d.open)d.close()})()")
    time.sleep(1)


def case_allowed(browser, label, path, hevc=False):
    print(f'[{label}] autoplay allowed')
    fresh_page(browser)
    # stop 1.5 s after the picture moved >1 s, has a size and the sound is back (HEVC: wait for whatever settles, up to 28 s)
    stop = "r => r.t.advance !== undefined && r.t.unmuted !== undefined && r.t.width !== undefined && ((r.stopAt = r.stopAt || performance.now()) && performance.now() - r.stopAt > 1500)"
    wait = 28000 if hevc else 14000
    r = measure(browser, str(path), Path(path).stem, wait, stop)
    silence(browser)
    t, n = r['t'], routes(r['log'])
    print('  times (ms after click):', t, '| mutedAtStart:', r['mutedAtStart'], '| requests:', n, '| status:', r['status'], '| final:', r['final'])
    report.append((label, 'allowed', t, n, r['status'], r['final']))
    check(r['mutedAtStart'] is True, f'{label}: video not muted at start')
    check(t.get('src') is not None, f'{label}: video never got a src')
    check(t.get('ready') is not None and t['ready'] <= 15000, f'{label}: readyState>=2 not reached within 15 s ({t.get("ready")})')
    check(t.get('width') is not None, f'{label}: videoWidth stayed 0')
    check(t.get('unmuted') is not None and t['unmuted'] <= 3000, f'{label}: not unmuted within 3 s ({t.get("unmuted")})')
    check(r['blackMax'] <= 12000, f'{label}: sound without picture for {r["blackMax"]} ms')
    final = r['final'] or {}
    check(final.get('videoWidth', 0) > 0, f'{label}: final videoWidth is 0 ({final})')
    if not hevc:
        check(t.get('advance') is not None and t['advance'] <= 10000 + (t.get('ready') or 0), f'{label}: currentTime did not advance >1 s in time ({t.get("advance")})')
        check(n['prepare'] == 1 and n['convert_prepare'] == 0 and n['plan'] <= 1, f'{label}: unexpected request counts {n}')
        check(not r.get('srcChanged'), f'{label}: the source changed (a swap happened) for an H.264 file')
        check(final.get('status', '') in ('', 'Preview ready'), f'{label}: odd final status {final.get("status")!r}')
        check(not any(s == 'Loading video…' for _, s in r['status'][-1:]), f'{label}: stuck on "Loading video…"')
    else:
        outcome = 'converted' if (n['convert_prepare'] or r['converting']) else 'decoded directly (no conversion)'
        print(f'  HEVC outcome: {outcome}; converting message seen: {r["converting"]}; src changed: {bool(r.get("srcChanged"))}')
        report.append((label, 'hevc-outcome', outcome))
        check(final.get('videoWidth', 0) > 0 and (final.get('frames') or 0) > 0 or final.get('currentTime', 0) > 1, f'{label}: no moving picture at the end ({final})')
        check(not r['converting'] or final.get('videoWidth', 0) > 0, f'{label}: conversion message but no picture afterwards')
    # a second click on the same file while it plays
    ids_before = [e['u'] for e in r['log'] if e['m'] == 'POST']
    two = browser.eval("""(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      window.__vlog.length = 0;
      playAudioFile(%s, %s, '', 0, '', 0);
      await sleep(4000);
      const vs = document.querySelectorAll('dialog.axiom-windows-video video');
      const v = vs[0]; v.volume = 0; v.muted = true;
      return {videos: vs.length, dialogs: document.querySelectorAll('dialog.axiom-windows-video').length, paused: v.paused,
              t: v.currentTime, ready: v.readyState, width: v.videoWidth, log: window.__vlog.map(e => ({m: e.method, u: e.url.replace(/^.*\\/api\\/windows\\/video\\//, ''), b: e.body}))};
    })()""" % (json.dumps(str(path)), json.dumps(Path(path).stem)), timeout=60)
    n2 = routes(two['log'])
    print('  second click:', {k: v for k, v in two.items() if k != 'log'}, n2)
    check(two['videos'] == 1 and two['dialogs'] == 1, f'{label}: second click made {two["videos"]} video elements')
    check(n2['delete'] >= 1 and n2['prepare'] == 1 or hevc, f'{label}: second click request counts {n2}')
    check(two['width'] > 0 and two['ready'] >= 2, f'{label}: second click did not end up with a picture ({two})')
    close_dialog(browser)


def case_refused(browser, label, path):
    print(f'[{label}] autoplay refused')
    fresh_page(browser)
    stop = "r => (r.t.refusedSeen !== undefined || r.t.soundSeen !== undefined) && ((r.stopAt = r.stopAt || performance.now()) && performance.now() - r.stopAt > 1000)"
    r = measure(browser, str(path), Path(path).stem, 10000, stop)
    t, n = r['t'], routes(r['log'])
    print('  play() outcomes:', r.get('plays'), '| times:', t, '| requests:', n, '| status:', r['status'], '| final:', r['final'])
    report.append((label, 'refused', t, n, r['status'], r['final']))
    final = r['final'] or {}
    # Designed behaviour (changed from "always paused + Press play"): Edge allows MUTED autoplay without a click, so the
    # picture keeps playing muted and says "Click for sound" (play() refused outright still gives paused + "Press play").
    muted_ok = t.get('soundSeen') is not None
    if muted_ok:
        check(final.get('paused') is False and final.get('muted') is True and final.get('status') == 'Click for sound',
              f'{label}: muted autoplay should be playing muted with "Click for sound" ({final})')
    else:
        check(t.get('refusedSeen') is not None, f'{label}: neither "Press play to begin." nor "Click for sound" shown (status {r["status"]})')
        check(final.get('paused') is True, f'{label}: video not paused after refused autoplay ({final})')
    # a real mouse click (user activation) on the dialog title starts the video through a listener that calls play()
    browser.eval("""(() => { const d = document.querySelector('dialog.axiom-windows-video');
      d.addEventListener('click', () => { const v = d.querySelector('video'); v.volume = 0; v.muted = true; window.__playResult = 'pending';
        v.play().then(() => { window.__playResult = 'ok'; }).catch(e => { window.__playResult = e.name; }); }, {once: true}); })()""")
    click = browser.run([{'op': 'click', 'selector': 'dialog.axiom-windows-video h2', 'force': False}])
    check(click.ok, f'{label}: could not click the dialog title ({click.failed()})')
    time.sleep(3)
    after = browser.eval("""(() => { const v = document.querySelector('dialog.axiom-windows-video video');
      return {paused: v.paused, t: v.currentTime, result: window.__playResult, width: v.videoWidth, ready: v.readyState,
              status: document.querySelector('dialog.axiom-windows-video [role=status]').textContent}; })()""")
    print('  after click + play():', after)
    check(after['paused'] is False and after['t'] > 0.5 and after['width'] > 0, f'{label}: play() from a click did not start the video ({after})')
    if muted_ok:
        # a real click on the picture gives it sound (user activation) and clears the message; it keeps playing
        click = browser.run([{'op': 'click', 'selector': 'dialog.axiom-windows-video video', 'force': True}])
        time.sleep(1.5)
        sound = browser.eval("""(() => { const v = document.querySelector('dialog.axiom-windows-video video');
          const r = {paused: v.paused, muted: v.muted, status: document.querySelector('dialog.axiom-windows-video [role=status]').textContent}; v.volume = 0; v.muted = true; return r; })()""")
        print('  after click on the picture:', sound)
        check(click.ok and sound['paused'] is False and sound['muted'] is False and sound['status'] == '', f'{label}: click on the picture did not give sound ({sound})')
    close_dialog(browser)


try:
    files = {}
    files['h264-moov-at-end'] = make('h264_moov_end.mp4', 'libx264')
    files['h264-faststart'] = make('h264_faststart.mp4', 'libx264', ('-movflags', '+faststart'))
    if 'libx265' in ffmpeg_encoders():
        try:
            files['hevc'] = make('hevc.mp4', 'libx265', ('-tag:v', 'hvc1', '-x265-params', 'log-level=error'))
        except Exception as exc:
            print('SKIP: HEVC case, could not generate the file:', exc)
    else:
        print('SKIP: HEVC case, this ffmpeg has no libx265')
    process = start()
    add_by_api(base / 'VIDEO')
    stats = call('GET', '/api/library/stats')
    check(stats['total_tracks'] == len(files), f'library has {stats["total_tracks"]} tracks, expected {len(files)}')
    saved_flags = list(fb.KEEP_AWAKE)
    for mode, flag in (('allowed', '--autoplay-policy=no-user-gesture-required'), ('refused', '--autoplay-policy=document-user-activation-required')):
        fb.KEEP_AWAKE[:] = saved_flags + [flag]
        browser = fb.Browser(sandbox=base / 'edge', base_url=url)
        browsers.append(browser)
        try:
            for label, path in files.items():
                if mode == 'allowed':
                    case_allowed(browser, label, path, hevc=(label == 'hevc'))
                elif label != 'hevc':
                    case_refused(browser, label, path)
                else:
                    case_refused(browser, label, path)
        finally:
            browser.close()
except BaseException:
    import traceback
    traceback.print_exc()
    failures.append('the test itself crashed')
finally:
    for b in browsers:
        try:
            b.close()
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
print('PASS: video preview plays H.264 (moov at end and faststart) at once, muted then unmuted, no second request, refused autoplay says "Press play to begin."'
      if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
