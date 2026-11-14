"""The redesigned Magic Set / Manual Build / Harmonic Route look (windows-magic-set.css + windows-magic-set.js) in a real
(headless) Edge against the real app, with a small library that has BPM and key data.

Per window size (1280x720 and 1920x1080) it checks that
  * the Windows Magic Set stylesheet and script are loaded and really restyle the page;
  * the controls exist, are visible, clickable (nothing drawn on top) and do not overlap one another, and the page never
    scrolls sideways;
  * the empty state explains what to do, and Suggest Order says why it is locked;
  * + Mid Point adds start, mid and end points without stacking, Generate Set fills the set and the Set Score appears,
    Build Around keeps the tracks, Suggest Order makes the Harmonic Route (key path banner, way back), removing a track works;
  * every readable text is at least 4.5:1 against its background (feature_check/js_contrast.py);
  * the page raised no script errors.

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\\Users\\gatli\\Documents\\PeakHour; & .\\axiom-win-env\\Scripts\\python.exe test_windows_magic_set.py"
Everything runs in a temp folder on a free port; nothing of the owner's is touched (never port 8080, never the owner's data)."""
import json
import os
import random
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
from feature_check import browser as fb, synthetic_library as sl
from feature_check.js_contrast import SCAN

SERVER = r'''
import sys, pathlib
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'runtime'
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
if port == 8080:
    raise SystemExit('refusing port 8080')
url = f'http://127.0.0.1:{port}'
base = Path(tempfile.mkdtemp(prefix='phmagic'))
runtime = base / 'runtime'
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'), 'APPDATA': str(base / 'roaming'),
       'AXIOM_RUNTIME_DIR': str(runtime), 'AXIOM_LICENSE_REQUIRED': '0', 'AXIOM_NO_OPEN': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
for name in ('local', 'home', 'roaming', 'runtime'):
    (base / name).mkdir()
servers, browsers = [], []
failures = []

KEYS = [f'{n}{letter}' for n in range(1, 13) for letter in 'AB']
DURATIONS = {}  # path -> duration_sec of the synthetic library
LIBRARY_SIZE = 140


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)


def make_library():
    """140 songs with real (tiny) files, BPM 98-136 and a Camelot key each."""
    names = [f'trk-{i:04d}.mp3' for i in range(LIBRARY_SIZE)]
    paths = sl.make_real_files(base, LIBRARY_SIZE, names)
    rng = random.Random(11)
    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    tracks = []
    for index, path in enumerate(paths):
        camelot = rng.choice(KEYS)
        tracks.append({
            'path': path, 'filename': Path(path).name, 'folder': 'Music', 'title': f'Magic Test {index:03d}', 'artist': f'Artist {index % 9}',
            'album': 'Album', 'genre': 'House', 'comments': '', 'label': '', 'bpm': round(rng.uniform(98, 136), 1), 'camelot': camelot,
            'key_raw': camelot, 'energy': rng.choice(['Low', 'Mid', 'High']), 'year': 2000 + index % 24, 'era': 'Unknown', 'playlist_names': [],
            'cue_count': 1, 'beatgrid_locked': False, 'source': 'virtualdj_database', 'connected_from': 'virtualdj', 'needs_relink': False,
            'duration_sec': rng.randint(170, 280), 'axiom_first_seen_at': stamp, 'file_size': 4000000 + index,
        })
    DURATIONS.update({t['path']: t['duration_sec'] for t in tracks})
    sl.write_library(runtime, tracks)


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


class Page:
    """One headless Edge window with a viewport of exactly width x height."""

    def __init__(self, width, height):
        self.width, self.height = width, height
        # the headless window is 24 x 92 pixels larger than the page inside it
        self.browser = fb.Browser(sandbox=base / f'edge-{width}', base_url=url, width=width + 24, height=height + 92)
        browsers.append(self.browser)

    def run(self, steps, timeout=120):
        return self.browser.run(steps, timeout=timeout)

    def ev(self, expr):
        return self.browser.eval(expr)

    def json(self, expr):
        value = self.ev(expr)
        return json.loads(value) if isinstance(value, str) else value

    def click(self, selector, settle=0.3):
        result = self.run([{'op': 'click', 'selector': selector}, {'op': 'sleep', 'seconds': settle}])
        step = result.steps[0]
        check(step.get('ok'), f'click {selector}: {step.get("error")}')
        return step.get('ok')

    def wait(self, expr, seconds=25):
        """Poll a JS condition until it is truthy."""
        deadline = time.time() + seconds
        while time.time() < deadline:
            if self.ev(f'Boolean({expr})'):
                return True
            time.sleep(0.4)
        return False

    def close(self):
        self.browser.close()


BOXES = r'''
(ids => JSON.stringify(ids.map(sel => {
  const el = document.querySelector(sel);
  if (!el) return {sel, missing: true};
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const visible = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  let covered = false;
  if (visible) {
    const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
    covered = !(hit === el || el.contains(hit) || (hit && hit.contains(el) && getComputedStyle(hit).pointerEvents === 'none'));
  }
  return {sel, visible, covered, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, disabled: !!el.disabled};
})))
'''


def layout(page, selectors, label, clickable=True):
    """Every selector is on screen, inside the window, not covered, and no two of them overlap."""
    boxes = page.json(f'({BOXES})({json.dumps(selectors)})')
    for box in boxes:
        sel = box['sel']
        if box.get('missing'):
            check(False, f'{label}: {sel} is missing')
            continue
        check(box['visible'], f'{label}: {sel} is not visible')
        if not box['visible']:
            continue
        check(box['l'] >= -1 and box['r'] <= page.width + 1, f'{label}: {sel} is outside the window sideways ({box["l"]:.0f}..{box["r"]:.0f} of {page.width})')
        if clickable:
            check(not box['covered'], f'{label}: {sel} is covered by something else')
    shown = [b for b in boxes if b.get('visible')]
    for i, a in enumerate(shown):
        for b in shown[i + 1:]:
            across = min(a['r'], b['r']) - max(a['l'], b['l'])
            down = min(a['b'], b['b']) - max(a['t'], b['t'])
            nested = (a['l'] <= b['l'] + 1 and a['r'] >= b['r'] - 1 and a['t'] <= b['t'] + 1 and a['b'] >= b['b'] - 1) or                      (b['l'] <= a['l'] + 1 and b['r'] >= a['r'] - 1 and b['t'] <= a['t'] + 1 and b['b'] >= a['b'] - 1)
            if across > 2 and down > 2 and not nested:
                check(False, f'{label}: {a["sel"]} overlaps {b["sel"]} ({across:.0f} x {down:.0f} px)')
    metrics = page.json('JSON.stringify({sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: innerWidth, ih: innerHeight})')
    check(metrics['sw'] <= metrics['iw'] + 1 and metrics['bw'] <= metrics['iw'] + 1,
          f'{label}: the page scrolls sideways (scrollWidth {metrics["sw"]}/{metrics["bw"]} > window {metrics["iw"]})')
    return boxes


def contrast(page, label):
    result = page.json(f'JSON.stringify(({SCAN.strip()})("#studio-active-view", {{min: 4.5}}))')
    check(not result.get('error'), f'{label}: contrast scan failed: {result.get("error")}')
    check(result.get('failure_count', 0) == 0,
          f'{label}: text under 4.5:1: ' + '; '.join(f'{f["text"]!r} {f["ratio"]} ({f["element"]})' for f in result.get('failures', [])[:5]))
    return result.get('checked', 0)


STATE = '''JSON.stringify({
  tracks: currentPlaylist.length, route: (currentRoutePlaylist || []).length, dots: graphDots.map(d => [d.x, d.y]),
  rows: document.querySelectorAll('#active-playlist-container .playlist-row').length,
  view: document.body.dataset.magicView || '', step: document.body.dataset.magicStep || '',
  score: (document.getElementById('magic-score-value') || {}).textContent, ring: getComputedStyle(document.querySelector('.magic-score-card')).getPropertyValue('--wms-score').trim()
})'''


CHART = """(() => {
  const chart = (window.Chart && Chart.getChart) ? Chart.getChart('bpmChart') : window.bpmChartInstance;
  const o = chart.config.options, pointSet = chart.config.data.datasets.find(d => d.pointRadius === 8);
  return JSON.stringify({bottom: o.layout.padding.bottom, yTitle: o.scales.y.title.display, xFont: o.scales.x.ticks.font && o.scales.x.ticks.font.size,
    yFont: o.scales.y.ticks.font && o.scales.y.ticks.font.size, label: o.scales.x.ticks.color, grid: o.scales.x.grid.color,
    hit: pointSet && pointSet.pointHitRadius, hover: pointSet && pointSet.pointHoverRadius, region: document.body.hasAttribute('data-ph-region')});
})()"""

# the chart config studio-render.js builds, made on a throw-away canvas with and without the PEAK HOUR look
CHART_MAC = """(() => {
  const saved = document.body.getAttribute('data-ph-region');
  const make = () => { const canvas = document.createElement('canvas'); canvas.id = 'bpmChart'; canvas.width = 300; canvas.height = 200;
    const chart = new Chart(canvas.getContext('2d'), {type: 'scatter', data: {datasets: [{data: [], pointRadius: 8}]},
      options: {responsive: false, animation: false, layout: {padding: {top: 12, right: 14, bottom: 34, left: 8}},
        scales: {x: {type: 'linear', ticks: {color: '#666', autoSkip: true}, grid: {color: 'rgba(255,255,255,0.05)'}, title: {display: false, text: 'Time (Minutes)'}},
                 y: {ticks: {color: '#666', stepSize: 10}, grid: {color: 'rgba(255,255,255,0.05)'}, title: {display: true, text: 'BPM', color: '#666'}}}}});
    const o = chart.config.options; const out = {bottom: o.layout.padding.bottom, yTitle: o.scales.y.title.display, font: o.scales.x.ticks.font || null,
      label: o.scales.x.ticks.color, hit: chart.config.data.datasets[0].pointHitRadius === undefined ? null : chart.config.data.datasets[0].pointHitRadius};
    chart.destroy(); return out; };
  document.body.removeAttribute('data-ph-region');
  const mac = make();
  document.body.setAttribute('data-ph-region', saved || 'west');
  const windows = make();
  if (saved === null) document.body.removeAttribute('data-ph-region'); else document.body.setAttribute('data-ph-region', saved);
  return JSON.stringify({mac, windows});
})()"""


def chart_style(page, label):
    """The redesign's chart styling comes from windows-magic-set.js, only with body[data-ph-region]; studio-render.js keeps the Mac values."""
    c = page.json(CHART)
    check(c['region'] and c['bottom'] == 6 and c['yTitle'] is False and c['xFont'] == 12 and c['yFont'] == 12 and c['hit'] == 14 and c['hover'] == 11, f'{label}: the chart does not have the PEAK HOUR styling: {c}')
    check(c['label'] == '#c4c8d0' and c['grid'] == 'rgba(255,255,255,0.08)', f'{label}: chart label/grid colours are not the PEAK HOUR ones: {c}')
    both = page.json(CHART_MAC)
    check(both['mac']['bottom'] == 34 and both['mac']['yTitle'] is True and both['mac']['font'] is None and both['mac']['label'] == '#666' and both['mac']['hit'] is None,
          f'{label}: without body[data-ph-region] the chart styling must stay as studio-render.js makes it: {both["mac"]}')
    check(both['windows']['bottom'] == 6 and both['windows']['yTitle'] is False and both['windows']['label'] == '#c4c8d0', f'{label}: with body[data-ph-region] the plugin did not restyle a new chart: {both["windows"]}')


def clock(seconds):
    seconds = round(seconds)
    return f'{seconds // 60}:{seconds % 60:02d}'


def runtime_text(total_seconds):
    """formatStudioSetRuntime in studio-workspace.js."""
    minutes = int(total_seconds / 60 + 0.5)
    if minutes < 60:
        return f'{minutes} Min'
    hours, rest = divmod(minutes, 60)
    return f'{hours}h' + (f' {rest:02d}m' if rest else '')


def real_times(page, label, what, list_name='currentPlaylist', rows=False):
    """Every song of the list carries its library duration_sec; the header chips use their sum; (rows) the Time column shows them."""
    songs = page.json(f'JSON.stringify({list_name}.map(t => [t.path, t.duration_sec, t.duration_min]))')
    check(len(songs) > 0, f'{label}: {what}: no songs')
    wrong = [(Path(p).name, d) for p, d, _ in songs if DURATIONS.get(p) is None or d != DURATIONS[p]]
    check(not wrong, f'{label}: {what}: songs without their library duration_sec (first: {wrong[:3]} of {len(wrong)}/{len(songs)})')
    if list_name == 'currentPlaylist':
        total = sum(DURATIONS.get(p, 0) for p, _, _ in songs)
        shown = page.json('JSON.stringify([document.getElementById("studio-set-runtime").textContent.trim(), document.getElementById("magic-chip-time").textContent.trim()])')
        check(shown == [runtime_text(total)] * 2, f'{label}: {what}: Total time {shown}, the real durations add up to {runtime_text(total)} ({total} s)')
    if rows:
        cells = page.json('JSON.stringify([...document.querySelectorAll("#active-playlist-container .playlist-row")].map(r => (r.querySelector(".wms-duration") || {}).textContent))')
        want = [clock(DURATIONS.get(p, 0)) for p, _, _ in songs]
        check(cells == want[:len(cells)] and len(cells) >= min(len(want), 5), f'{label}: {what}: the Time column shows {cells[:6]}, the library says {want[:6]}')
        check('--:--' not in cells, f'{label}: {what}: some rows still show --:--')


def foreign_notice_survives(page, label):
    """Generate Set while an export's progress notice is on screen: Magic Set must close only its own notice."""
    page.ev("""(() => { window.__gate = new Promise(r => { window.__openGate = r; }); const real = window.fetch.bind(window);
      if (!window.__gated) { window.__gated = true; window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url;
        if (/generate_from_curve/.test(url)) await window.__gate; return real(input, init); }; } return 1; })()""")
    page.click('#btn-magic-set', settle=0.3)
    surface = 'document.querySelector("#audio-player .player-notification-surface")'
    check(page.wait(f'{surface} && {surface}.dataset.notificationKind === "working" && /Building set/.test({surface}.querySelector("strong").textContent)', 15),
          f'{label}: Magic Set showed no "Building set" notice')
    page.ev('(() => { showToast("Exporting 3 songs to the crate..."); return 1; })()')
    check(page.wait(f'{surface} && /Exporting 3 songs/.test({surface}.querySelector("strong").textContent)', 5), f'{label}: the export notice did not appear (cannot test)')
    page.ev('(() => { window.__openGate(); return 1; })()')
    check(page.wait('currentPlaylist.length > 0', 30), f'{label}: Generate Set produced no tracks while another notice was open')
    time.sleep(1.0)
    left = page.json('JSON.stringify([...document.querySelectorAll("#audio-player .player-notification-surface")].map(s => [s.dataset.notificationKind, s.querySelector("strong").textContent]))')
    check(any(kind == 'working' and 'Exporting 3 songs' in text for kind, text in left), f'{label}: Generate Set closed the export working notice (on screen: {left})')
    page.ev('(() => { document.querySelectorAll("#audio-player .player-notification-dismiss").forEach(b => b.click()); return 1; })()')


def case(width, height):
    label = f'{width}x{height}'
    print(f'[{label}]')
    page = Page(width, height)
    try:
        r = page.run([
            {'op': 'collect_errors', 'clear': True},
            {'op': 'navigate', 'url': '/', 'settle': 4000},
            {'op': 'eval', 'expr': "(()=>{const s=[...document.querySelectorAll('button')].find(x=>/skip tour/i.test(x.textContent)&&x.offsetParent);if(s)s.click();return 1})()"},
            {'op': 'sleep', 'seconds': 1},
            {'op': 'eval', 'expr': "(()=>{showTab('studio');return 1})()"},
            {'op': 'sleep', 'seconds': 1.5},
            {'op': 'eval', 'expr': "(()=>{openMagicSetWorkspace();return 1})()"},
            {'op': 'sleep', 'seconds': 1.5},
        ])
        check(r.steps[1].get('ok'), f'{label}: could not load the app')
        size = page.json('JSON.stringify([innerWidth, innerHeight])')
        check(abs(size[0] - width) <= 2 and abs(size[1] - height) <= 2, f'{label}: the page is {size[0]}x{size[1]}, not {width}x{height}')

        # ---- the Windows stylesheet and script are in and doing something
        applied = page.json('''JSON.stringify({
          sheet: [...document.styleSheets].some(s => /windows-magic-set\\.css/.test(s.href || '')),
          script: !!window.AxiomWindowsMagicSet,
          flow: getComputedStyle(document.querySelector('#magic-flow ol')).display,
          cards: getComputedStyle(document.getElementById('studio-build-controls')).gridTemplateColumns.split(' ').length,
          generate: getComputedStyle(document.getElementById('btn-magic-set')).backgroundColor,
          zones: !!(window.Chart && Chart.registry.plugins.get('phMagicZones'))
        })''')
        check(applied['sheet'], f'{label}: windows-magic-set.css is not loaded')
        check(applied['script'], f'{label}: windows-magic-set.js is not loaded')
        check(applied['flow'] == 'grid', f'{label}: the 1-2-3 flow bar is not laid out (display {applied["flow"]})')
        check(applied['cards'] == 2, f'{label}: the Shape and Build cards are not side by side')
        check(applied['generate'] == 'rgb(163, 29, 41)', f'{label}: Generate Set is not the primary button colour ({applied["generate"]})')
        check(applied['zones'], f'{label}: the chart phase-zone plugin is not registered')

        # ---- empty Magic Set: controls, flow, explanation
        magic_controls = ['#magic-flow-shape', '#magic-flow-build', '#magic-flow-refine', '#set-length-selector', '#avg-duration-selector',
                          '#blueprint-start-bpm', '#blueprint-end-bpm', '.magic-midpoint-btn', '.magic-clear-btn', '#btn-build-around-tracks',
                          '#btn-magic-set', '#bpmChart', '.magic-score-card', '#magic-stat-chips']
        layout(page, magic_controls, f'{label} Magic Set')
        empty = page.json('JSON.stringify({empty: document.getElementById("graph-container").dataset.magicEmpty, shown: getComputedStyle(document.getElementById("magic-empty-state")).display, '
                          'text: document.getElementById("magic-empty-state").textContent, around: document.getElementById("btn-build-around-tracks").disabled, '
                          'hint: document.getElementById("magic-build-hint").textContent, step: document.body.dataset.magicStep, refine: document.getElementById("magic-flow-refine").getAttribute("aria-disabled")})')
        check(empty['empty'] == 'true' and empty['shown'] == 'block', f'{label}: the empty chart does not show the "Your set starts here" card')
        check('Generate Set' in empty['text'] and '5' in empty['text'], f'{label}: the empty state does not say what to do and why Suggest Order needs 5 tracks')
        check(empty['around'] is True and 'Working Set' in empty['hint'], f'{label}: Build Around is not disabled with a reason ("{empty["hint"]}")')
        check(empty['step'] == 'shape' and empty['refine'] == 'true', f'{label}: the flow should start on step 1 with step 3 locked ({empty["step"]})')

        # ---- + Mid Point: needs start and end, never stacks
        page.click('.magic-midpoint-btn')
        page.click('.magic-midpoint-btn')
        dots = page.json(STATE)['dots']
        check(len(dots) == 4 and len({d[0] for d in dots}) == 4, f'{label}: + Mid Point twice should give 4 separate points, got {dots}')
        check(dots and dots[0][0] == 0, f'{label}: + Mid Point did not add the start point first ({dots})')
        page.click('.magic-clear-btn')
        check(page.json(STATE)['dots'] == [], f'{label}: Clear did not remove the BPM points')
        page.click('.magic-midpoint-btn')
        state = page.json(STATE)
        check(state['step'] == 'build', f'{label}: with a shape drawn the flow should be on step 2 ({state["step"]})')
        check(len(state['dots']) == 3, f'{label}: Generate Set should keep the mid point (dots {state["dots"]})')

        # ---- Generate Set (with an export's notice on screen: it must survive)
        foreign_notice_survives(page, label)
        built = page.wait('currentPlaylist.length > 0')
        check(built, f'{label}: Generate Set produced no tracks')
        state = page.json(STATE)
        check(state['tracks'] >= 20, f'{label}: Generate Set made only {state["tracks"]} tracks')
        check(page.wait('Number(document.getElementById("magic-score-value").textContent) > 0'), f'{label}: the Set Score never appeared after Generate Set (audit result dropped)')
        page.wait('document.getElementById("studio-added-tracks") ? !document.querySelector(".studio-added-overlay.active, #studio-added-overlay.active") : true', 10)
        time.sleep(0.5)
        state = page.json(STATE)
        check(float(state['ring'] or 0) > 0, f'{label}: the score ring is empty ({state["ring"]!r})')
        check(page.json('JSON.stringify(document.getElementById("magic-chip-tracks").textContent)') == str(state['tracks']), f'{label}: the tracks chip does not match the set')
        real_times(page, label, 'after Generate Set')
        chart_style(page, label)
        check(state['step'] == 'refine', f'{label}: after building, the flow should point at Refine ({state["step"]})')
        # the "Working Set" overlay that follows a build can sit on top for a few seconds: close it for the layout checks
        page.ev('(()=>{try{hideStudioAddedOverlay()}catch(e){};return 1})()')
        time.sleep(0.6)
        layout(page, magic_controls + ['#btn-view-studio-set', '#magic-chart-footer'], f'{label} Magic Set built')
        contrast(page, f'{label} Magic Set built')

        # ---- Build Around keeps the working set
        before = page.json(STATE)['tracks']
        page.ev('(()=>{currentPlaylist = currentPlaylist.slice(0, 6); renderPlaylist(); updateStudioToolsAvailability(); return 1})()')
        time.sleep(0.5)
        check(page.json('JSON.stringify(!document.getElementById("btn-build-around-tracks").disabled)'), f'{label}: Build Around stayed disabled with 6 tracks')
        page.click('#btn-build-around-tracks', settle=0.5)
        check(page.wait('currentPlaylist.length > 6', 30), f'{label}: Build Around added nothing to the 6 tracks')
        time.sleep(0.8)
        real_times(page, label, 'after Build Around')
        check(page.json('JSON.stringify(!document.querySelector("#audio-player .player-notification-surface[data-notification-kind=working]"))'),
              f'{label}: Build Around left its own working notice on screen')
        kept = page.json('JSON.stringify(currentPlaylist.length)')
        check(kept >= 6 and before >= 6, f'{label}: Build Around lost tracks ({kept})')
        page.ev('(()=>{try{hideStudioAddedOverlay()}catch(e){};return 1})()')
        time.sleep(0.6)

        # ---- Refine: Manual Build
        page.click('#btn-view-studio-set', settle=1.5)
        manual = page.json(STATE)
        check(manual['view'] == 'manual' and manual['rows'] > 5, f'{label}: Refine did not open Manual Build with the list ({manual["view"]}, {manual["rows"]} rows)')
        manual_controls = ['#magic-flow-shape', '#magic-flow-build', '#magic-flow-refine', '#studio-open-daw', '#studio-tab-magic', '#studio-tab-manual',
                           '#btn-optimize', '#magic-list-head', '#active-playlist-container', '#energy-ladder']
        layout(page, [c for c in manual_controls if c != '#studio-open-daw'] + (['#studio-open-daw'] if page.json('JSON.stringify(!!document.getElementById("studio-open-daw"))') else []), f'{label} Manual Build')
        cells = page.json(r'''(() => { const row = document.querySelector('#active-playlist-container .playlist-row');
          const names = ['.drag-handle', '.studio-row-main', '.studio-bpm-metric', '.studio-key-metric', '.studio-harmonic-metric', '.wms-duration', '.studio-row-smart-actions', '.fav-star-btn', '.studio-remove-btn'];
          const out = names.map(n => { const el = row.querySelector(n); if (!el) return {n, missing: true}; const r = el.getBoundingClientRect(); return {n, l: r.left, r: r.right, t: r.top, b: r.bottom}; });
          const rr = row.getBoundingClientRect(); return JSON.stringify({cells: out, row: {l: rr.left, r: rr.right, h: rr.height}, number: getComputedStyle(row, '::before').content, key: getComputedStyle(row.querySelector('.camelot-pill')).backgroundColor}); })()''')
        for cell in cells['cells']:
            check(not cell.get('missing'), f'{label}: row cell {cell["n"]} is missing')
        present = [c for c in cells['cells'] if not c.get('missing')]
        for i, a in enumerate(present):
            for b in present[i + 1:]:
                check(not (min(a['r'], b['r']) - max(a['l'], b['l']) > 2 and min(a['b'], b['b']) - max(a['t'], b['t']) > 2), f'{label}: row cells {a["n"]} and {b["n"]} overlap')
        check(all(c['l'] >= cells['row']['l'] - 1 and c['r'] <= cells['row']['r'] + 1 for c in present), f'{label}: a row cell sticks out of its row')
        check('counter' in cells['number'], f'{label}: rows have no position number')
        check(cells['key'] not in ('rgba(0, 0, 0, 0)', 'rgb(74, 74, 74)'), f'{label}: the key badge has no key colour ({cells["key"]})')
        check(page.json('JSON.stringify(!!document.querySelector("#active-playlist-container .playlist-row .wms-duration"))'), f'{label}: rows have no duration cell')
        real_times(page, label, 'Manual Build', rows=True)
        contrast(page, f'{label} Manual Build')

        # remove a track
        rows_before = page.json(STATE)['rows']
        page.click('#active-playlist-container .playlist-row .studio-remove-btn', settle=1.0)
        check(page.wait(f'document.querySelectorAll("#active-playlist-container .playlist-row").length === {rows_before - 1}', 8), f'{label}: removing a track did not remove its row')

        # ---- Suggest Order -> Harmonic Route
        check(page.json('JSON.stringify(!document.getElementById("btn-optimize").disabled)'), f'{label}: Suggest Order is disabled with {rows_before - 1} tracks')
        page.click('#btn-optimize', settle=0.5)
        check(page.wait('(currentRoutePlaylist || []).length > 0 && document.body.dataset.magicView === "route"', 20), f'{label}: Suggest Order produced no Harmonic Route view')
        time.sleep(0.8)
        route = page.json('JSON.stringify({keys: document.querySelectorAll("#magic-route-keys li").length, banner: !document.getElementById("magic-route-banner").hidden, tab: document.getElementById("studio-tab-route").classList.contains("route-tab-hidden")})')
        check(route['banner'] and route['keys'] > 1, f'{label}: the Harmonic Route banner shows no key path ({route})')
        real_times(page, label, 'Harmonic Route', list_name='currentRoutePlaylist')
        layout(page, ['#magic-route-banner', '#magic-route-keys', '#magic-route-back', '#studio-tab-route', '#btn-optimize', '#magic-list-head', '#active-playlist-container'], f'{label} Harmonic Route')
        contrast(page, f'{label} Harmonic Route')
        page.click('#magic-route-back', settle=1.0)
        check(page.json(STATE)['view'] == 'manual', f'{label}: Back to Manual Build did not leave the route view')

        # ---- locked Suggest Order and the manual empty state
        page.ev('(()=>{currentPlaylist = currentPlaylist.slice(0, 3); currentRoutePlaylist = []; setStudioView("manual"); renderPlaylist(); updateStudioToolsAvailability(); return 1})()')
        time.sleep(0.8)
        locked = page.json('JSON.stringify({disabled: document.getElementById("btn-optimize").disabled, hint: document.getElementById("magic-suggest-hint").textContent, title: document.getElementById("btn-optimize").title})')
        check(locked['disabled'] and '5' in locked['hint'] and '5' in locked['title'], f'{label}: Suggest Order is not locked with a reason at 3 tracks ({locked})')
        page.ev('(()=>{currentPlaylist = []; currentRoutePlaylist = []; renderPlaylist(); updateStudioToolsAvailability(); return 1})()')
        time.sleep(0.8)
        empty_manual = page.json('JSON.stringify({empty: getComputedStyle(document.getElementById("magic-manual-empty")).display, text: document.getElementById("magic-manual-empty").textContent, head: getComputedStyle(document.getElementById("magic-list-head")).display})')
        check(empty_manual['empty'] == 'flex' and 'Open Magic Set' in empty_manual['text'] and '5' in empty_manual['text'], f'{label}: the empty Manual Build does not explain what to do')
        layout(page, ['#magic-flow-refine', '#btn-optimize', '#magic-manual-empty'], f'{label} Manual Build empty')
        contrast(page, f'{label} Manual Build empty')

        errors = page.run([{'op': 'collect_errors'}]).steps[0].get('value') or []
        real = [e for e in errors if not any(skip in json.dumps(e) for skip in ('/api/library/artwork', '/api/license/validate', 'favicon'))]
        check(not real, f'{label}: script errors on the page: {json.dumps(real)[:600]}')
    finally:
        page.close()


def static_checks():
    css = (workspace / 'axiom-win-probe' / 'static' / 'css' / 'windows-magic-set.css').read_text('utf-8')
    unscoped = css.count('html body') - css.count('html body[data-ph-region]')
    check(unscoped == 0, f'windows-magic-set.css has {unscoped} "html body" selectors without [data-ph-region] (they would also restyle the macOS look)')
    stems_css = (workspace / 'axiom-win-probe' / 'static' / 'css' / 'windows-stems-install.css').read_text('utf-8')
    check('transition' not in stems_css, 'windows-stems-install.css still has a transition')
    render = (workspace / 'axiom-win-probe' / 'static' / 'js' / 'surfaces' / 'studio-render.js').read_text('utf-8')
    for mac in ("labelColor = isLight ? '#555555' : '#666'", 'bottom: 34', "title: { display: true, text: 'BPM'"):
        check(mac in render, f'studio-render.js (shared with macOS) lost its Mac chart value {mac!r}')
    check('pointHitRadius' not in render and "weight: '600'" not in render and "isHarmonic ? 'Match'" in render, 'studio-render.js still carries Windows chart styling (or lost the Match fix)')


def api_durations():
    # the routes the page does not use in this test: every returned song has its library duration_sec
    headers = {'Content-Type': 'application/json', 'Origin': url, 'Sec-Fetch-Site': 'same-origin'}

    def post(path, body):
        request = urllib.request.Request(url + path, data=json.dumps(body).encode(), method='POST', headers=headers)
        return json.load(urllib.request.urlopen(request, timeout=120))
    songs = [{k: v for k, v in t.items() if k != 'duration_sec'} for t in json.loads((runtime / 'data' / 'library_cache.json').read_text('utf-8'))['tracks'][:8]]
    anchor = songs[0]
    answers = {
        'autofill': (post('/api/studio/autofill', {'start_dot': {'time_min': 0, 'bpm': 116}, 'end_dot': {'time_min': 10, 'bpm': 122}, 'avg_duration': 5, 'max_bpm_step': 6,
                                                   'tempo_flip': '', 'previous_bpm': 0, 'anchor_key': '', 'blacklist': []}), 'tracks'),
        'generate_from_anchor': (post('/api/studio/generate_from_anchor', {'anchor_track': {'bpm': anchor['bpm'], 'camelot': anchor['camelot'], 'duration_min': 5, 'duration_sec': 0, 'path': anchor['path']},
                                                                           'target_time': 30, 'target_bpm': 128, 'avg_duration': 5, 'max_bpm_step': 6, 'tempo_flip': '', 'blacklist': []}), 'tracks'),
        'optimize': (post('/api/studio/optimize', {'playlist': songs}), 'optimized'),
        'build_around_tracks': (post('/api/studio/build_around_tracks', {'seed_tracks': songs[:6], 'bpm_points': [{'time_min': 0, 'bpm': 116}, {'time_min': 60, 'bpm': 132}],
                                                                           'target_count': 12, 'avg_duration': 5, 'max_bpm_step': 6}), 'playlist'),
    }
    for name, (answer, key) in answers.items():
        listed = answer.get(key) or []
        check(len(listed) > 0, f'/api/studio/{name} returned no {key}')
        missing = [Path(t['path']).name for t in listed if t.get('duration_sec') != DURATIONS.get(t['path'])]
        check(not missing, f'/api/studio/{name}: {len(missing)} of {len(listed)} songs lack their duration_sec ({missing[:3]})')


try:
    make_library()
    start()
    static_checks()
    api_durations()
    stats = json.load(urllib.request.urlopen(url + '/api/library/stats', timeout=30))
    check(stats.get('total_tracks') == LIBRARY_SIZE, f'library has {stats.get("total_tracks")} tracks, expected {LIBRARY_SIZE}')
    for size in ((1280, 720), (1920, 1080)):
        case(*size)
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
print('PASS: Magic Set restyle on Windows (1-2-3 flow, chart hero, score ring, track rows, Harmonic Route) works at 1280x720 and 1920x1080: '
      'no overlaps or sideways scroll, text 4.5:1 or better, Generate Set, Build Around, Suggest Order and removing tracks all work'
      if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
