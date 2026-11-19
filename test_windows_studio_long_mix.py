r"""Studio DAW playback of a long MIXTAPE, in a real (headless) Edge against the real app, with the two failures a 45-clip,
three-hour mix showed on a real PC reproduced on purpose and shown to be survived.

The mix is scaled down (10 clips of 12 s, alternating Left and Right Deck, tempo mapped 94-104 BPM, so every clip is
stretched; MP3 and MP4-with-AAC music-like sources made here). The sandbox server delays things the way a busy PC does:
  slow render   every tempo-stretch render waits 4.5 s before it starts (a window is 4-8 s of audio, so the second window
                is not ready when the first has been played);
  stalled lease every sixth cache-lease reply is held for 12 s (the page gives up on a lease reply after 10 s).
Before the fix the first stopped playback with "Audio scheduling fell behind" (the engine looked ahead 2 s on start) and the
second paused a clip with the browser's raw "signal is aborted without reason" and left the next clip late. Now:
  - a late section pauses, says so, and resumes by itself from exactly where it stopped, looking further ahead;
  - a slow lease reply never stops a clip or the mix (the audio carries on, the lease finishes behind it);
  - playback crosses every clip boundary with audio present (the Web Audio graph is tapped just before the speakers);
  - the timeline is not repainted on every playback tick: the page main thread stays quiet (long tasks counted).
While it plays the page stays quiet: the song rows of a 45-song set made the button-typography observer repaint the whole page
for every small change, which kept the main thread busy and the scheduler late; it is paused while the DAW plays.

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\Users\gatli\Documents\PeakHour; & .\axiom-win-env\Scripts\python.exe test_windows_studio_long_mix.py"
Everything runs in a sandbox folder on a free port; nothing of the owner's is touched. LONG_MIX_OLD=<transport.js> serves that
file as the page's transport (to see the old behaviour fail); LONG_MIX_KEEP=1 keeps the sandbox."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

workspace = Path(__file__).resolve().parent
sys.path.insert(0, str(workspace))
from feature_check import browser as fb
from feature_check import sandbox as sb

ok, why = fb.available()
if not ok:
    print('SKIPPED page check: ' + why)
    sys.exit(0)

CLIPS, SECONDS = 10, 12
SLOW_RENDER, LEASE_STALL = 4.5, 12.0
failures = []
box = sb.Sandbox.create(base=Path(tempfile.mkdtemp(prefix='phlm')))
server = browser = None

SERVER = r'''
import sys, pathlib, time, json, os, threading
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'data'
backend = L.build_app(port)
CTL = sb / 'ctl.json'
def ctl():
    try:
        return json.loads(CTL.read_text())
    except Exception:
        return {}
import subprocess
base_init = subprocess.Popen.__init__
SLEEPER = 'import subprocess,sys,time; time.sleep(float(sys.argv[1])); sys.exit(subprocess.call(sys.argv[2:]))'
def delayed(self, args, *rest, **kw):
    # The wait happens inside the render process itself (it sleeps, then runs the real command), so stopping playback
    # cancels it the way it cancels a real render.
    delay = float(ctl().get('render_delay', 0))
    if delay and isinstance(args, (list, tuple)) and any('windows_rubberband' in str(a) for a in args[:4]):
        args = [sys.executable, '-c', SLEEPER, str(delay), *[str(a) for a in args]]
    return base_init(self, args, *rest, **kw)
subprocess.Popen.__init__ = delayed
app = backend.app
inner = app.wsgi_app
leases = [0]; stalled = [0]
OLD = os.environ.get('LONG_MIX_OLD')
def middleware(environ, start_response):
    path = environ.get('PATH_INFO', '')
    if OLD and path.endswith('/studio-daw/transport.js'):
        body = pathlib.Path(OLD).read_bytes()
        start_response('200 OK', [('Content-Type', 'application/javascript'), ('Content-Length', str(len(body)))])
        return [body]
    if path.endswith('/stretch/cache-lease') and environ.get('REQUEST_METHOD') == 'POST':
        hold = float(ctl().get('lease_stall', 0))
        if hold:
            leases[0] += 1
            if leases[0] % 6 == 4:
                stalled[0] += 1
                (sb / 'stalls.txt').write_text(str(stalled[0]))
                time.sleep(hold)
    return inner(environ, start_response)
app.wsgi_app = middleware
from werkzeug.serving import make_server
make_server('127.0.0.1', port, app, threaded=True).serve_forever()
'''


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)


def make_media(folder):
    """CLIPS music-like sources (a bass, a second partial, pink noise, pumped at the song tempo): MP3 and MP4+AAC."""
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    tracks = []
    for n in range(CLIPS):
        bpm = 94 + (n * 5) % 11
        ext = 'mp4' if n % 2 == 0 else 'mp3'
        path = folder / f'Song {n + 1:02d}.{ext}'
        f1 = 55 * 2 ** ((n % 7) / 12.0) * 2
        graph = '[0][1][2]amix=inputs=3:normalize=0,tremolo=f=%.4f:d=0.85,volume=0.8[a]' % (bpm / 60.0)
        cmd = [ff, '-v', 'error', '-y', '-f', 'lavfi', '-i', f'sine=f={f1:.2f}:d={SECONDS}:r=44100', '-f', 'lavfi', '-i', f'sine=f={f1 * 2.52:.2f}:d={SECONDS}:r=44100',
               '-f', 'lavfi', '-i', f'anoisesrc=d={SECONDS}:a=0.12:c=pink:r=44100']
        if ext == 'mp4':
            cmd += ['-f', 'lavfi', '-i', f'color=c=black:s=160x90:r=10:d={SECONDS}', '-filter_complex', graph, '-map', '[a]', '-map', '3:v', '-c:v', 'libx264',
                    '-preset', 'ultrafast', '-crf', '40', '-c:a', 'aac', '-b:a', '160k', '-shortest', str(path)]
        else:
            cmd += ['-filter_complex', graph, '-map', '[a]', '-c:a', 'libmp3lame', '-b:a', '160k', str(path)]
        subprocess.run(cmd, check=True)
        tracks.append({'path': str(path), 'title': f'Song {n + 1:02d}', 'artist': 'Test', 'bpm': bpm, 'durationSec': SECONDS, 'duration': SECONDS,
                       'key': '8A', 'name': path.name})
    return tracks


def set_ctl(**values):
    (box.root / 'ctl.json').write_text(json.dumps(values), encoding='utf-8')


def evaluate(expr, timeout=120):
    return browser.eval(expr, timeout=timeout)


def js(expr, timeout=120):
    return json.loads(evaluate('JSON.stringify(%s)' % expr, timeout))


# Everything the page does while a phase runs: toasts (with when), a sample every 100 ms (timeline position, state, speaker
# level from the tapped Web Audio graph) and long tasks (> 50 ms) on the main thread.
INSTR = r'''(()=>{
  if(window.__lm)return 'already';
  const L=window.__lm={t0:performance.now(),toasts:[],samples:[],long:[]};
  const now=()=>Math.round(performance.now()-L.t0);
  const toast=window.showToast;window.showToast=function(m,e){L.toasts.push({t:now(),m:String(m),err:!!e});return toast&&toast.apply(this,arguments);};
  try{new PerformanceObserver(l=>{for(const e of l.getEntries())L.long.push({t:Math.round(e.startTime-L.t0),d:Math.round(e.duration)});}).observe({entryTypes:['longtask']});}catch(e){}
  const connect=AudioNode.prototype.connect;let tap=null;
  AudioNode.prototype.connect=function(dest,...rest){const r=connect.call(this,dest,...rest);
    try{if(typeof AudioDestinationNode!=='undefined'&&dest instanceof AudioDestinationNode&&!this.__t){this.__t=true;const c=this.context;
      if(!c.__tp){const sum=c.createGain(),an=c.createAnalyser();an.fftSize=2048;connect.call(sum,an);c.__tp={c,sum,an,buf:new Float32Array(2048)};tap=c.__tp;}
      connect.call(this,c.__tp.sum);}}catch(e){}
    return r;};
  const level=()=>{if(!tap)return 0;tap.an.getFloatTimeDomainData(tap.buf);let s=0;for(const v of tap.buf)s+=v*v;return Math.sqrt(s/tap.buf.length);};
  L.reset=()=>{L.t0=performance.now();L.toasts=[];L.samples=[];L.long=[];L.ended=false;};
  setInterval(()=>{const d=window.AxiomArrangement.transportDiagnostics();if(!d.playing&&d.lastStopReason==='end')L.ended=true;
    L.samples.push({t:now(),pos:+d.positionSeconds.toFixed(2),playing:d.playing,loading:window.AxiomArrangement.loading,rms:+level().toFixed(4),stop:d.lastStopReason,
                    lease:d.leaseFailures||0,retries:d.retries||0,tick:d.maxTickGapMs});},100);
  return 'installed';})()'''

OPEN = r'''(async()=>{const T=%s;const ok=await AxiomStudioDaw.showStudioDawSetProject(T,'mixtape');
  await new Promise(r=>setTimeout(r,2000));AxiomStudioDaw.setPlaybackMode('preserve-pitch');await new Promise(r=>setTimeout(r,500));
  const p=AxiomStudioDaw.activeProject,map=AxiomStudioDaw.compileTempoMap(p);
  const clips=[...p.arrangementClips].sort((a,b)=>a.timelineStartBeat-b.timelineStartBeat);
  const bpm=(p.automationLanes||[]).find(l=>l.parameter==='bpm');
  return JSON.stringify({ok,mode:p.mode,playbackMode:p.playbackMode,sections:clips.map(c=>c.sectionId),
    starts:clips.map(c=>map.beatToSeconds(c.timelineStartBeat)),end:map.beatToSeconds(Math.max(...clips.map(c=>c.timelineStartBeat+c.timelineDurationBeats))),
    bpmPoints:bpm?bpm.points.map(x=>x.value):[]});})()'''


def play_from(seconds):
    evaluate('(()=>{window.__lm.reset();AxiomArrangement.play(AxiomStudioDaw.activeProject,%f);return 1})()' % seconds)


def run_until(done_expr, limit):
    """Poll until the page expression is true or limit seconds pass; returns the seconds waited."""
    start = time.time()
    while time.time() - start < limit:
        time.sleep(1.0)
        if evaluate(done_expr):
            break
    return time.time() - start


def report():
    return js('({toasts:__lm.toasts,samples:__lm.samples,long:__lm.long})')


def judge(label, rep, until_pos, boundaries=()):
    """Shared checks for one playback: no stop or paused clip, the position carried on from every pause, audio present."""
    toasts, samples = rep['toasts'], rep['samples']
    # background AXIOM Snap notices (the synthetic songs have no stems) are not about playback
    errors = [t['m'] for t in toasts if t['err'] and not t['m'].startswith(('Audio fell behind', 'AXIOM Snap'))]
    check(not errors, f'{label}: error toasts: {errors}')
    check(not any('signal is aborted' in t['m'] for t in toasts), f'{label}: the raw browser abort text reached the screen')
    playing = [s for s in samples if s['playing']]
    check(bool(playing) and playing[-1]['pos'] >= until_pos - 1.0, f'{label}: playback never got to {until_pos:.0f} s ({playing[-1]["pos"] if playing else None})')
    previous = None
    for s in samples:  # the position never goes back and never jumps ahead of the music
        if previous and s['playing'] and previous['playing']:
            check(-0.4 <= s['pos'] - previous['pos'] <= 1.2, f'{label}: position jumped {previous["pos"]} -> {s["pos"]}')
        previous = s
    stops = [i for i in range(1, len(samples)) if samples[i - 1]['playing'] and not samples[i]['playing'] and samples[i]['stop'] != 'end']
    for i in stops:  # every pause continues from exactly where it stopped
        after = next((s for s in samples[i:] if s['playing']), None)
        check(after is not None and abs(after['pos'] - samples[i - 1]['pos']) < 2.0, f'{label}: a pause at {samples[i - 1]["pos"]} s did not resume from there ({after})')
    bins = {}
    for s in playing:  # every second of the timeline that was played has sound at the speakers
        if not s['loading']:
            bins[int(s['pos'])] = max(bins.get(int(s['pos']), 0), s['rms'])
    # a clip fades out as the next fades in, so the second either side of a boundary may be quiet: the boundary check below covers it
    seconds = [k for k in bins if 1 <= k <= until_pos - 1 and not any(abs(k + 0.5 - at) < 2.5 for at in boundaries)]
    quiet = sorted(k for k in seconds if bins[k] < 0.004)
    check(len(quiet) <= max(2, len(seconds) // 40), f'{label}: {len(quiet)} of {len(seconds)} played seconds were silent at the speakers: {quiet[:12]}')
    for at in boundaries:
        near = [s['rms'] for s in playing if at - 1.5 <= s['pos'] <= at + 1.5]
        check(bool(near) and max(near) >= 0.004, f'{label}: no audio across the boundary at {at:.1f} s ({max(near) if near else None})')
    return len(stops)


CENSUS = r'''(async()=>{const shell=document.getElementById('studio-daw-shell');let child=0,retry=0,attr=0;
  const o=new MutationObserver(rs=>{for(const r of rs){if(r.type==='childList')child++;else if(r.attributeName==='data-wave-layout-retry')retry++;else attr++;}});
  o.observe(shell,{subtree:true,childList:true,attributes:true});await new Promise(r=>setTimeout(r,5000));o.disconnect();
  return JSON.stringify({child,retry,attr});})()'''


def main():
    global server, browser
    tracks = make_media(box.music)
    port = sb.free_port()
    (box.root / 'server.py').write_text(SERVER, encoding='utf-8')
    env = box.env(extra={'LONG_MIX_OLD': os.environ.get('LONG_MIX_OLD', ''), 'PYTHONUNBUFFERED': '1'})
    server = subprocess.Popen([str(sb.python_exe()), str(box.root / 'server.py'), str(box.root), str(port), str(workspace / 'axiom-win-probe')],
                              env=env, cwd=str(workspace), stdout=open(box.server_log, 'wb'), stderr=subprocess.STDOUT)
    url = f'http://127.0.0.1:{port}'
    for _ in range(240):
        try:
            urllib.request.urlopen(url + '/api/library/stats', timeout=2).read()
            break
        except OSError:
            time.sleep(0.5)
    else:
        raise AssertionError('the app did not start')
    browser = fb.Browser(box.root / 'edge', base_url=url, shots=box.shots, extra_args=['--autoplay-policy=no-user-gesture-required'])
    browser.run([{'op': 'navigate', 'url': '/', 'settle': 4000}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 3}])
    evaluate("(()=>{showTab('studio');return 1})()")
    evaluate(INSTR)

    print('[the mix: %d clips of %d s, alternating decks, tempo mapped]' % (CLIPS, SECONDS))
    mix = json.loads(evaluate(OPEN % json.dumps(tracks), timeout=300))
    print('  ', {k: (v if k != 'starts' else [round(x, 1) for x in v]) for k, v in mix.items()})
    check(mix['mode'] == 'mixtape' and mix['playbackMode'] == 'preserve-pitch' and len(mix['starts']) == CLIPS, f'the mixtape did not open as {CLIPS} clips ({mix})')
    check(mix['sections'][:4] == ['left-deck', 'right-deck', 'left-deck', 'right-deck'], f'clips should alternate decks ({mix["sections"][:4]})')
    check(len(mix['bpmPoints']) >= CLIPS and 93.5 <= min(mix['bpmPoints']) and max(mix['bpmPoints']) <= 104.5 and len(set(mix['bpmPoints'])) > 4,
          f'the tempo map should run between 94 and 104 BPM ({mix["bpmPoints"]})')
    starts, end = mix['starts'], mix['end']

    print('[slow render: every stretch waits %.1f s]' % SLOW_RENDER)
    set_ctl(render_delay=SLOW_RENDER)
    play_from(0)
    waited = run_until('(()=>{const d=AxiomArrangement.transportDiagnostics();return d.playing&&d.positionSeconds>=22})()', 160)
    rep = report()
    resumed = [t for t in rep['toasts'] if t['m'].startswith('Audio fell behind')]
    print('   waited %.0f s, late-section notices: %d' % (waited, len(resumed)), [t['m'] for t in rep['toasts'] if t['err']])
    judge('slow render', rep, 20)
    check(len(resumed) <= 3, f'too many automatic resumes ({len(resumed)})')
    evaluate('(()=>{AxiomArrangement.stop(true);return 1})()')
    time.sleep(1)

    print('[stalled lease replies: every sixth is held %.0f s; the whole mix, every boundary]' % LEASE_STALL)
    set_ctl(render_delay=1.0, lease_stall=LEASE_STALL)
    play_from(0)
    time.sleep(24)
    census = json.loads(evaluate(CENSUS, timeout=60))
    print('   mutations in the DAW over 5 s of playback:', census)
    check(census['child'] <= 40, f'the timeline is being rebuilt while playing: {census["child"]} child-list changes in 5 s')
    check(census['retry'] <= 400, f'unlaid-out waveforms are retried every frame: {census["retry"]} in 5 s')
    check(evaluate('(window.AxiomWindowsStudioPlayback||{}).paused===true') is True, 'the button-typography observer should be paused while the mix plays')
    waited = run_until('__lm.ended===true', end + 150)
    rep = report()
    last = [s for s in rep['samples'] if s['playing']][-1:] or [{}]
    stalls = int((box.root / 'stalls.txt').read_text()) if (box.root / 'stalls.txt').exists() else 0
    print('   waited %.0f s, stalled lease replies: %d, lease failures seen by the page: %s, retries: %s, late-section notices: %d, last position %s of %.0f' % (
        waited, stalls, last[0].get('lease'), last[0].get('retries'), len([t for t in rep['toasts'] if t['m'].startswith('Audio fell behind')]), last[0].get('pos'), end))
    check(stalls >= 1, 'the sandbox never stalled a lease reply, so this run proved nothing')
    judge('long mix', rep, end - 2, boundaries=starts[1:])
    ended = [s for s in rep['samples'] if s['stop'] == 'end']
    check(bool(ended), 'the mix should play to its end and stop there')
    time.sleep(1.5)
    check(evaluate('(window.AxiomWindowsStudioPlayback||{}).paused===false') is True, 'the button-typography observer should run again once the mix has stopped')
    longs = sum(x['d'] for x in rep['long'])
    duration = max(s['t'] for s in rep['samples']) / 1000.0
    print('   main thread: %d long tasks, %.1f s of %.0f s (%.0f%%), longest %d ms' % (len(rep['long']), longs / 1000.0, duration, 100.0 * longs / 1000.0 / duration,
                                                                              max([x['d'] for x in rep['long']] or [0])))
    check(longs / 1000.0 < 0.30 * duration, f'the page spent {longs / 1000.0:.0f} s of {duration:.0f} s in long tasks while playing')


try:
    main()
except BaseException:
    import traceback
    traceback.print_exc()
    failures.append('the test itself crashed')
finally:
    if browser:
        try:
            browser.close()
        except Exception:
            pass
    try:
        fb._kill_profile_users(box.root)
    except Exception:
        pass
    if server:
        sb.kill_tree(server)
    time.sleep(1)
    if not os.environ.get('LONG_MIX_KEEP'):
        shutil.rmtree(box.root.parent, ignore_errors=True)
print('PASS: a 10-clip tempo-mapped mixtape plays through a slow render and stalled cache replies, resumes by itself from where it paused, '
      'crosses every clip boundary with audio, and does not repaint the timeline on every tick' if not failures else 'FAIL: ' + '; '.join(failures[:12]))
sys.exit(1 if failures else 0)
