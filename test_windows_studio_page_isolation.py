"""Studio content must only show on the Studio page (headless Edge, real app, synthetic songs).

The owner built a Magic Set (36 songs, 5 segments), opened Health and saw the Studio sub-navigation (Studio DAW / Magic Set /
Manual Build / Harmonic Route / Suggest Order), the Fill strip ("Full 8/8 ...", "Fill empty segments") and the track table
header on top of / under the Health page. Health opens inside the Studio container, so a Windows rule that shows a Studio-only
element whenever the body is not in Magic Set mode also matched Health.

Per window size (1280x720, 1920x1080) and per Studio view (Manual Build with a full set, Magic Set with a full set) it opens
every other page the way a user does (sidebar click, or showTab for the pages with no sidebar button) and checks that none of
the Studio-only elements is displayed, then returns to Studio and checks they show again.

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\\Users\\gatli\\Documents\\PeakHour; & .\\axiom-win-env\\Scripts\\python.exe test_windows_studio_page_isolation.py"
Everything runs in a temp folder on a free port; nothing of the owner's is touched (never port 8080)."""
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
APP_DIR = Path(os.environ.get('PH_TEST_APP_DIR') or workspace / 'axiom-win-probe')
sys.path.insert(0, str(workspace))
from feature_check import browser as fb, synthetic_library as sl

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
base = Path(tempfile.mkdtemp(prefix='phiso'))
runtime = base / 'runtime'
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'), 'APPDATA': str(base / 'roaming'),
       'AXIOM_RUNTIME_DIR': str(runtime), 'AXIOM_LICENSE_REQUIRED': '0', 'AXIOM_NO_OPEN': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
for name in ('local', 'home', 'roaming', 'runtime'):
    (base / name).mkdir()
servers, browsers = [], []
failures = []
KEYS = [f'{n}{letter}' for n in range(1, 13) for letter in 'AB']
LIBRARY_SIZE = 140

# Studio-only things: none may be displayed on any other page. (selector, what the owner sees it as)
STUDIO_ONLY = [
    ('#studio-mode-controls', 'the Studio / Magic Set / Manual Build / Harmonic Route bar'),
    ('#studio-open-daw', 'the Studio DAW button'), ('#studio-tab-magic', 'the Magic Set button'),
    ('#studio-tab-manual', 'the Manual Build button'), ('#studio-tab-route', 'the Harmonic Route button'),
    ('#btn-optimize', 'the Suggest Order button'), ('#magic-flow', 'the 1-2-3 flow bar'),
    ('#studio-build-controls', 'the Magic Set controls'), ('#graph-container', 'the BPM chart'),
    ('#energy-ladder', 'the energy ladder'), ('#wms-fill-ladder', 'the Fill segment strip'), ('#wms-fill-bar', 'the Fill empty segments bar'),
    ('.wms-fill-seg', 'a segment Fill button'), ('.wms-fill-all', 'the Fill empty segments button'), ('.wms-fill-count', 'a segment count'),
    ('#wms-fill-hint', 'the Fill hint'), ('#wms-fill-result-chart', 'the Fill result chip'), ('#wms-fill-result-manual', 'the Fill result line'),
    ('#magic-list-head', 'the track table header'), ('#active-playlist-container', 'the track list'), ('#magic-manual-empty', 'the empty Manual Build card'),
    ('#studio-daw-shell', 'the Studio DAW'), ('.ph-pan', 'the DAW pan control'), ('.ph-auto', 'the DAW automation overlay'),
    ('#magic-route-banner', 'the Harmonic Route banner'), ('#magic-set-command', 'the score card'), ('#studio-workspace', 'the Studio workspace'),
]
# pages other than Studio, and how a user gets there ('click' = the sidebar button; 'showTab' = pages that have no button of their own)
PAGES = [
    ('Health', 'click', '#tab-btn-health'), ('Library', 'click', '#tab-btn-library'), ('Performance', 'click', '#tab-btn-performance'),
    ('Playlists', 'showTab', 'playlists'), ('Health review', 'showTab', 'health-review'), ('Duplicates', 'showTab', 'duplicates'),
    ('Era review', 'showTab', 'era-review'),
]

SHOWN = r'''((list) => JSON.stringify(list.flatMap(([sel, what]) => [...document.querySelectorAll(sel)].map(el => {
  const r = el.getBoundingClientRect();
  const shown = el.checkVisibility({checkVisibilityCSS: true}) && r.width > 0 && r.height > 0;
  return shown ? {sel, what, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), text: (el.textContent || '').trim().slice(0, 30)} : null;
}).filter(Boolean))))'''
# anything displayed inside the Studio tab that is neither the Health page nor a container of it (any element, not only the listed ones)
STRAY = r'''(() => { const health = document.getElementById('health-view');
  return JSON.stringify([...document.querySelectorAll('#tab-content-studio *')].filter(el => {
  if (health.contains(el) || el.contains(health) || el.closest('#audio-player') || el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  return el.checkVisibility({checkVisibilityCSS: true}) && r.width > 0 && r.height > 0;
}).map(el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(/\s+/)[0]) + ' "' + (el.textContent || '').trim().slice(0, 24) + '"').slice(0, 14)); })()'''
VIEW = {'manual': 'setGraphMode(false); setStudioView("manual", {userActivated: true})', 'magic': 'openMagicSetWorkspace()'}


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)


def make_library():
    names = [f'trk-{i:04d}.mp3' for i in range(LIBRARY_SIZE)]
    paths = sl.make_real_files(base, LIBRARY_SIZE, names)
    rng = random.Random(11)
    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    tracks = []
    for index, path in enumerate(paths):
        camelot = rng.choice(KEYS)
        tracks.append({
            'path': path, 'filename': Path(path).name, 'folder': 'Music', 'title': f'Isolation Test {index:03d}', 'artist': f'Artist {index % 9}',
            'album': 'Album', 'genre': 'House', 'comments': '', 'label': '', 'bpm': round(rng.uniform(112, 124), 1), 'camelot': camelot,
            'key_raw': camelot, 'energy': rng.choice(['Low', 'Mid', 'High']), 'year': 2000 + index % 24, 'era': 'Unknown', 'playlist_names': [],
            'cue_count': 1, 'beatgrid_locked': False, 'source': 'virtualdj_database', 'connected_from': 'virtualdj', 'needs_relink': False,
            'duration_sec': rng.randint(170, 280), 'axiom_first_seen_at': stamp, 'file_size': 4000000 + index,
        })
    sl.write_library(runtime, tracks)


def start():
    process = subprocess.Popen([sys.executable, '-c', SERVER, str(base), str(port), str(APP_DIR)],
                               env=env, cwd=str(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    servers.append(process)
    for _ in range(240):
        try:
            urllib.request.urlopen(url + '/api/library/stats', timeout=2).read()
            return
        except OSError:
            time.sleep(0.5)
    raise AssertionError('the app did not start')


class Page:
    def __init__(self, width, height):
        self.width, self.height = width, height
        self.browser = fb.Browser(sandbox=base / f'edge-{width}', base_url=url, width=width + 24, height=height + 92)
        browsers.append(self.browser)

    def run(self, steps, timeout=120):
        return self.browser.run(steps, timeout=timeout)

    def ev(self, expr):
        return self.browser.eval(expr)

    def json(self, expr):
        value = self.ev(expr)
        return json.loads(value) if isinstance(value, str) else value

    def close(self):
        self.browser.close()


def go(page, kind, target):
    """Open a page the way a user does."""
    if kind == 'click':
        r = page.run([{'op': 'click', 'selector': target}, {'op': 'sleep', 'seconds': 1.3}])
        check(r.steps[0].get('ok'), f'click {target}: {r.steps[0].get("error")}')
    else:
        page.ev(f"(()=>{{showTab('{target}');return 1}})()")
        time.sleep(1.3)


def studio(page, view):
    # Health swaps the sidebar for its own menu (no Studio button), so leave it through its "Back to PEAK HOUR" button first
    if not page.json('JSON.stringify(!!document.querySelector("#tab-btn-studio") && document.querySelector("#tab-btn-studio").offsetParent !== null)'):
        go(page, 'click', '.health-workspace-back')
    go(page, 'click', '#tab-btn-studio')
    page.ev(f'(()=>{{ {VIEW[view]}; return 1 }})()')
    time.sleep(1.0)


def shown_now(page):
    return page.json(f'({SHOWN})({json.dumps(STUDIO_ONLY)})')


def case(width, height):
    label = f'{width}x{height}'
    print(f'[{label}]')
    shutil.rmtree(runtime / 'window-data-snapshot', ignore_errors=True)
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
        cache = json.loads((runtime / 'data' / 'library_cache.json').read_text('utf-8'))['tracks']
        seed = sorted(cache, key=lambda t: t['bpm'])[:36]
        page.ev('''(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', {bubbles: true})); };
          set('set-length-selector', '60'); set('avg-duration-selector', '3'); set('blueprint-start-bpm', '116'); set('blueprint-end-bpm', '132');
          applyBpmBlueprint(); return 1; })()''')
        # 36 songs against 12 slots: every segment is Full, like the owner's 36-song set
        page.ev(f'(() => {{ currentPlaylist = {json.dumps(seed)}; currentRoutePlaylist = []; renderPlaylist(); updateStudioToolsAvailability(); recalculateAudit(); '
                f'AxiomWindowsMagicSet.refresh(); return 1; }})()')
        time.sleep(1.2)

        for view in ('manual', 'magic'):
            tag = f'{label} {view}'
            want = ['#studio-mode-controls', '#btn-optimize', '#wms-fill-ladder', '#wms-fill-bar', '#magic-list-head', '#active-playlist-container'] if view == 'manual' \
                else ['#graph-container', '#magic-flow'] 
            for name, kind, target in PAGES:
                studio(page, view)
                seen = {s['sel'] for s in shown_now(page)}
                missing = [s for s in want if s not in seen]
                check(not missing, f'{tag}: before leaving Studio these are not displayed: {missing}')
                if view == 'manual':
                    counts = page.json('JSON.stringify([...document.querySelectorAll("#wms-fill-ladder .wms-fill-count")].map(e => e.textContent))')
                    check(len(counts) == 5 and all(c.split('/')[0] == c.split('/')[1] for c in counts), f'{tag}: the strip should show five full segments, shows {counts}')

                go(page, kind, target)
                leaks = shown_now(page)
                check(not leaks, f'{tag} -> {name}: Studio content is displayed on the {name} page: ' +
                      '; '.join(f'{l["what"]} ({l["sel"]}, {l["w"]}x{l["h"]} at y={l["top"]}, "{l["text"]}")' for l in leaks[:30]))
                if name == 'Health':
                    check(page.json("JSON.stringify(document.body.classList.contains('studio-health-mode'))"), f'{tag}: the Health page did not open (cannot test)')
                    stray = page.json(STRAY)
                    check(not stray, f'{tag} -> Health: Studio elements displayed outside the Health page: {stray}')

                studio(page, view)
                again = {s['sel'] for s in shown_now(page)}
                back = [s for s in want if s not in again]
                check(not back, f'{tag} -> {name} -> Studio: these did not come back: {back}')
        errors = page.run([{'op': 'collect_errors'}]).steps[0].get('value') or []
        real = [e for e in errors if not any(skip in json.dumps(e) for skip in ('/api/library/artwork', '/api/license/validate', 'favicon'))]
        check(not real, f'{label}: script errors on the page: {json.dumps(real)[:600]}')
    finally:
        page.close()


try:
    make_library()
    start()
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
print('PASS: Studio content (sub-navigation, Fill strip, Fill empty segments, track table header, chart) is hidden on Health, Library, Performance, '
      'Playlists and the review pages at 1280x720 and 1920x1080, and Studio shows everything again on return'
      if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
