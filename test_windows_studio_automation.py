"""Studio DAW automation on the timeline, in a real (headless) Edge against the real app: a clip with a filter lane and a
volume lane draws two curves inside the clip (distinct colours, a "Filter" and a "Volume" label), deck and master lanes
draw across their lane, the curve geometry follows timeline zoom and scrolling (checked against the points, the clip's
position and the lanes' view), a clip with no lanes draws nothing, edits and undo redraw them, and a label opens the
existing Parameter Automation dialog.

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\\Users\\gatli\\Documents\\PeakHour; & .\\axiom-win-env\\Scripts\\python.exe test_windows_studio_automation.py"
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

# Everything the page drew: per overlay host (clip id, deck section or master), each curve's parameter, colour and vertices,
# plus the lanes' view and every clip's place on the timeline, so the test can work out where each vertex belongs.
READ = r'''
(() => {
  const lanes = document.getElementById('studio-daw-lanes');
  const project = AxiomStudioDaw.activeProject;
  const curves = [];
  for (const wrap of document.querySelectorAll('#studio-daw-lanes .ph-auto, #studio-daw-master-strip .ph-auto')) {
    const clip = wrap.closest('[data-daw-clip-id]'), lane = wrap.closest('.studio-daw-lane[data-daw-section]');
    const host = wrap.closest('.studio-daw-master-clip') ? 'master' : clip ? 'clip:' + clip.dataset.dawClipId : 'deck:' + (lane && lane.dataset.dawSection);
    for (const line of wrap.querySelectorAll('polyline')) {
      curves.push({host, parameter: line.dataset.phAutoParameter, scope: line.dataset.phAutoScope, stroke: getComputedStyle(line).stroke,
                   points: line.getAttribute('points').split(' ').map(p => p.split(',').map(Number))});
    }
  }
  const chips = [...document.querySelectorAll('#studio-daw-lanes .ph-auto-chip, #studio-daw-master-strip .ph-auto-chip')].map(c => c.textContent.trim());
  return {curves, chips, viewStart: Number(lanes.dataset.viewStart), viewBeats: Number(lanes.dataset.viewBeats),
          clips: project.arrangementClips.map(c => ({id: c.id, section: c.sectionId, start: c.timelineStartBeat, length: c.timelineDurationBeats}))};
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
base = Path(tempfile.mkdtemp(prefix='phauto'))
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


def read(b):
    return b.eval(READ)


def settle(b, ms=400):
    b.eval('new Promise(r => setTimeout(r, %d))' % ms)


def apply(b, lanes):
    return b.eval('(()=>{const p=AxiomStudioDaw.activeProject;return AxiomDawAutomation.apply(p,%s)})()' % json.dumps(lanes))


def expected(points, shift, view_start, view_beats, clip, lo, hi, default):
    """The vertices the page should draw, from the lane's points, with the visible part of the clip as the x range."""
    start = max(view_start, clip['start']) if clip else view_start
    end = min(view_start + view_beats, clip['start'] + clip['length']) if clip else view_start + view_beats
    span = end - start

    def at(beat):
        if beat < points[0]['beat'] + shift:
            return default
        for a, b2 in zip(points, points[1:]):
            if beat < b2['beat'] + shift:
                return a['value'] if a.get('curve') == 'hold' else a['value'] + (b2['value'] - a['value']) * (beat - a['beat'] - shift) / (b2['beat'] - a['beat'])
        return points[-1]['value']
    out = [(start, at(start))]
    for i, p in enumerate(points):
        beat = p['beat'] + shift
        if beat <= start or beat >= end:
            continue
        before = points[i - 1] if i else None
        if before is None or before.get('curve') == 'hold':
            out.append((beat, before['value'] if before else default))
        out.append((beat, p['value']))
    out.append((end, at(end)))
    return [((beat - start) / span * 100, 94 - (min(hi, max(lo, v)) - lo) / (hi - lo) * 88) for beat, v in out]


def same(curve, want, label):
    got = curve['points']
    ok_len = len(got) == len(want)
    check(ok_len, f'{label}: drew {len(got)} vertices, expected {len(want)} ({got} vs {want})')
    if ok_len:
        for (gx, gy), (wx, wy) in zip(got, want):
            check(abs(gx - wx) < 0.02 and abs(gy - wy) < 0.02, f'{label}: vertex ({gx}, {gy}) should be ({wx:.3f}, {wy:.3f})')


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
    b.eval("(()=>{showTab('studio');return 1})()")
    settle(b, 800)
    b.eval("(async()=>{window.__T=%s;AxiomStudioDaw.showStudioDawProject(window.__T[0],'track');await new Promise(r=>setTimeout(r,1500));AxiomStudioDaw.addTrackToProject(window.__T[1]);await new Promise(r=>setTimeout(r,1500));return 1})()" % json.dumps(tracks))
    s = read(b)
    print('[no automation yet]', {k: v for k, v in s.items() if k != 'curves'})
    check(len(s['clips']) >= 2, f'expected two clips ({s["clips"]})')
    check(not s['curves'], 'curves drawn before any automation exists')
    c1, c2 = s['clips'][0], s['clips'][1]
    check(c1['id'] != c2['id'], 'the clips should differ')

    print('[a clip with a filter lane and a volume lane]')
    filt = [{'beat': 0, 'value': 0, 'curve': 'linear'}, {'beat': 8, 'value': -80, 'curve': 'linear'}, {'beat': 16, 'value': 60, 'curve': 'linear'}]
    vol = [{'beat': 0, 'value': 1, 'curve': 'hold'}, {'beat': 6, 'value': 0.3, 'curve': 'linear'}, {'beat': 12, 'value': 0.9, 'curve': 'linear'}]
    check(apply(b, [{'scope': 'clip', 'targetId': c1['id'], 'parameter': 'filterPosition', 'points': filt},
                    {'scope': 'clip', 'targetId': c1['id'], 'parameter': 'volume', 'points': vol}]) is True, 'could not write the two lanes')
    settle(b)
    s = read(b)
    by = {(c['host'], c['parameter']): c for c in s['curves']}
    print('  curves:', sorted(by), 'labels:', s['chips'])
    check(('clip:' + c1['id'], 'filterPosition') in by and ('clip:' + c1['id'], 'volume') in by, f'both curves should be inside the first clip ({sorted(by)})')
    check(not any(h == 'clip:' + c2['id'] for h, _ in by), 'the second clip has no lanes and must have no curve')
    check(sorted(s['chips']) == ['Filter', 'Volume'], f'labels should be Filter and Volume, got {s["chips"]}')
    fc, vc = by.get(('clip:' + c1['id'], 'filterPosition')), by.get(('clip:' + c1['id'], 'volume'))
    if fc and vc:
        check(fc['stroke'] != vc['stroke'] and fc['stroke'] not in ('none', '') and vc['stroke'] not in ('none', ''), f'filter and volume curves need distinct colours ({fc["stroke"]} / {vc["stroke"]})')
        same(fc, expected(filt, c1['start'], s['viewStart'], s['viewBeats'], c1, -100, 100, 0), 'filter, whole arrangement')
        same(vc, expected(vol, c1['start'], s['viewStart'], s['viewBeats'], c1, 0, 1, 1), 'volume, whole arrangement')
        whole = json.dumps([fc['points'], vc['points']])

        print('[zoom and scroll]')
        for label, js in (('zoomed to 16 beats from the start', "AxiomStudioDaw.activeProject.editCursorBeat=0;AxiomStudioDaw.setZoom(16)"),
                          ('zoomed to 8 beats from the start', "AxiomStudioDaw.setZoom(8)"),
                          ('zoomed to 16 beats', "AxiomStudioDaw.setZoom(16)"), ('zoomed to 4 beats', "AxiomStudioDaw.setZoom(4)"),
                          ('scrolled right', "AxiomStudioDaw.panTimeline(1)"), ('zoom step out', "AxiomStudioDaw.stepZoom(-1)"),
                          ('back to the whole arrangement', "AxiomStudioDaw.setZoom(0)")):
            b.eval(f"(()=>{{{js};return 1}})()")
            settle(b)
            z = read(b)
            zb = {(c['host'], c['parameter']): c for c in z['curves']}
            visible = z['viewStart'] < c1['start'] + c1['length'] and z['viewStart'] + z['viewBeats'] > c1['start']
            zf, zv = zb.get(('clip:' + c1['id'], 'filterPosition')), zb.get(('clip:' + c1['id'], 'volume'))
            print(f'  {label}: view {z["viewStart"]:.2f}+{z["viewBeats"]:.2f}, vertices {len(zf["points"]) if zf else None}/{len(zv["points"]) if zv else None}')
            if not visible:
                check(zf is None and zv is None, f'{label}: the clip is off screen, no curves expected')
                continue
            if not (zf and zv):
                check(False, f'{label}: curves missing')
                continue
            same(zf, expected(filt, c1['start'], z['viewStart'], z['viewBeats'], c1, -100, 100, 0), f'filter, {label}')
            same(zv, expected(vol, c1['start'], z['viewStart'], z['viewBeats'], c1, 0, 1, 1), f'volume, {label}')
            # a curve fills its clip, so it only differs from the whole-clip drawing once the view cuts the clip
            if label.startswith('zoomed to') and (z['viewStart'] > c1['start'] or z['viewStart'] + z['viewBeats'] < c1['start'] + c1['length']):
                check(json.dumps([zf['points'], zv['points']]) != whole, f'{label}: the curve geometry did not change with zoom')
        final = read(b)
        check(json.dumps([[c['points'] for c in final['curves'] if c['parameter'] == 'filterPosition'][0], [c['points'] for c in final['curves'] if c['parameter'] == 'volume'][0]]) == whole,
              'back at the whole arrangement the curves should be exactly as at first')

    print('[editing redraws]')
    filt2 = [{'beat': 0, 'value': 50, 'curve': 'linear'}, {'beat': 12, 'value': -50, 'curve': 'hold'}]
    check(apply(b, [{'scope': 'clip', 'targetId': c1['id'], 'parameter': 'filterPosition', 'points': filt2}]) is True, 'could not change the filter lane')
    settle(b)
    s = read(b)
    fc = [c for c in s['curves'] if c['parameter'] == 'filterPosition' and c['host'] == 'clip:' + c1['id']]
    check(len(fc) == 1, 'the filter curve should still be drawn exactly once after an edit')
    if fc:
        same(fc[0], expected(filt2, c1['start'], s['viewStart'], s['viewBeats'], c1, -100, 100, 0), 'filter after an edit')
    check(b.eval("AxiomEditHistory.undo ? (AxiomEditHistory.undo(AxiomStudioDaw.activeProject), true) : false") is not None, 'undo call')
    settle(b)
    s = read(b)
    fc = [c for c in s['curves'] if c['parameter'] == 'filterPosition' and c['host'] == 'clip:' + c1['id']]
    if fc:
        same(fc[0], expected(filt, c1['start'], s['viewStart'], s['viewBeats'], c1, -100, 100, 0), 'filter after undo')
    check(sum(1 for c in s['curves'] if c['host'] == 'clip:' + c1['id']) == 2, 'after undo the clip should have exactly two curves, no duplicates')

    print('[deck and master lanes]')
    deck = c1['section']
    deck_points = [{'beat': 0, 'value': 1, 'curve': 'linear'}, {'beat': 32, 'value': 0.2, 'curve': 'linear'}]
    master_points = [{'beat': 0, 'value': 0.8, 'curve': 'linear'}, {'beat': 64, 'value': 0.4, 'curve': 'linear'}]
    check(apply(b, [{'scope': 'deck', 'targetId': deck, 'parameter': 'volume', 'points': deck_points},
                    {'scope': 'project', 'targetId': '', 'parameter': 'volume', 'points': master_points}]) is True, 'could not write the deck and master lanes')
    settle(b)
    s = read(b)
    by = {(c['host'], c['parameter']): c for c in s['curves']}
    print('  curves:', sorted(by))
    check(('deck:' + deck, 'volume') in by, 'the deck volume lane is not drawn across its lane')
    check(('master', 'volume') in by, 'the master volume lane is not drawn on the master clip')
    if ('deck:' + deck, 'volume') in by:
        same(by[('deck:' + deck, 'volume')], expected(deck_points, 0, s['viewStart'], s['viewBeats'], None, 0, 1, 1), 'deck volume')
    if ('master', 'volume') in by:
        same(by[('master', 'volume')], expected(master_points, 0, s['viewStart'], s['viewBeats'], None, 0, 1, 1), 'master volume')
    b.eval("(()=>{AxiomStudioDaw.setZoom(16);return 1})()")
    settle(b)
    s = read(b)
    by = {(c['host'], c['parameter']): c for c in s['curves']}
    if ('deck:' + deck, 'volume') in by:
        same(by[('deck:' + deck, 'volume')], expected(deck_points, 0, s['viewStart'], s['viewBeats'], None, 0, 1, 1), 'deck volume, zoomed')

    print('[a label opens the existing dialog]')
    b.eval("(()=>{AxiomStudioDaw.setZoom(0);return 1})()")
    settle(b)
    opened = b.eval("""(async()=>{const chip=[...document.querySelectorAll('#studio-daw-lanes .studio-daw-clip .ph-auto-chip')].find(c=>c.textContent.trim()==='Filter');
      if(!chip)return 'no chip';chip.click();await new Promise(r=>setTimeout(r,500));
      const d=document.getElementById('daw-parameter-automation');
      const result=d&&d.open?d.querySelector('select[aria-label="Automation parameter"]').value:'no dialog';
      if(d){d.close();d.remove();}return result})()""")
    check(opened == 'filterPosition', f'clicking the Filter label should open the Filter automation dialog (got {opened!r})')

    print('[a lane switched off disappears]')
    b.eval("(()=>{const p=AxiomStudioDaw.activeProject;for(const l of p.automationLanes)if(l.scope==='deck'||l.scope==='project')l.enabled=false;AxiomStudioDaw.refreshArrangement();return 1})()")
    settle(b)
    s = read(b)
    check(not any(c['host'] in ('master',) or c['host'].startswith('deck:') for c in s['curves']), 'disabled deck/master lanes should not be drawn')
    check(any(c['host'] == 'clip:' + c1['id'] for c in s['curves']), 'the clip curves should remain')
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
print('PASS: filter and volume automation is drawn on the clip, deck and master lanes, follows zoom and scroll, redraws on edit and undo, and its label opens the editor'
      if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
