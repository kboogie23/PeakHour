r"""The Health apply status bar (headless Edge, real app, synthetic songs).

Title/Artist Cleanup and DJ Metadata Publish gave almost no visible result on the Health review page. A status bar
(#ph-apply-status, windows-health-apply.js) now shows what is running, how far, and the result, with the error in plain words.

Checks: no bar for an old "complete" answer when nothing was started in this visit; publish progress ("Applying 9 of 20...",
fill ~45%); a publish where every file failed ("0 applied, 20 could not be applied", "First reason: ...", no "[Errno" on the
bar); cleanup running / ok / partial / failed wording; a real cleanup request from the page (bar matches the answer's count);
the bar survives a toast, goes when the tab is left, goes on Hide, is replaced (never doubled) by a new apply; no transitions
or animations; text/background contrast of at least 3:1 in every state.

Rules of the banner (second round): any 'partial' status shows the partial state (the failed state when nothing was published);
the could-not-apply count is failed + skipped, else the result rows that are not 'published', else total - published, else the
wording "P applied, some could not be applied"; green only for 'complete' with nothing missed. A publish apply or rollback request
that is rejected at the network level (an aborted fetch through the page's wrapper) shows "Checking..." and later status answers
decide; an HTTP rejection still shows failed; "Checking..." ends in "PEAK HOUR could not confirm the changes" after
window.AxiomWindowsHealthApply.lostTimeoutMs (default 20000; an invalid value falls back to it), and any deciding answer cancels
that timer. A cleanup request lost at the network level says the connection dropped. A failed or rejected rollback says
"Nothing was restored".

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\\Users\\gatli\\Documents\\PeakHour; & .\\axiom-win-env\\Scripts\\python.exe test_windows_health_apply_status.py"
Everything runs in a temp folder on a free port; nothing of the owner's is touched (never port 8080)."""
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
base = Path(tempfile.mkdtemp(prefix='phapply'))
runtime = base / 'runtime'
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'), 'APPDATA': str(base / 'roaming'),
       'AXIOM_RUNTIME_DIR': str(runtime), 'AXIOM_LICENSE_REQUIRED': '0', 'AXIOM_NO_OPEN': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
for name in ('local', 'home', 'roaming', 'runtime'):
    (base / name).mkdir()
servers, browsers = [], []
failures = []
COUNT = 6
CLEANUP = '/api/library/utility_metadata_cleanup'
PUBLISH_APPLY = '/api/library/metadata_publish/apply'
PUBLISH_STATUS = '/api/library/metadata_publish/status'
PUBLISH_ROLLBACK = '/api/library/metadata_publish/rollback'
CHECKING_DETAIL = 'PEAK HOUR lost contact for a moment and is checking what happened. Keep this page open.'
COULD_NOT_CONFIRM = 'PEAK HOUR could not confirm the changes'
FRIENDLY = 'This file is read-only or protected.'


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)


def make_library():
    names = [f'trk-{i:04d}.mp3' for i in range(COUNT)]
    paths = sl.make_real_files(base, COUNT, names)
    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    tracks = [{'path': path, 'filename': Path(path).name, 'folder': 'Music', 'title': f'Signal Fire {i:02d} (Music Junkie Slam Edit)',
               'artist': f'Artist {i % 5}', 'album': 'Album', 'genre': 'House', 'comments': '', 'label': '', 'bpm': 120.0, 'camelot': '8A',
               'key_raw': '8A', 'energy': 'Mid', 'year': 2010 + i, 'era': 'Unknown', 'playlist_names': [], 'cue_count': 1,
               'beatgrid_locked': False, 'source': 'virtualdj_database', 'connected_from': 'virtualdj', 'needs_relink': False,
               'duration_sec': 200, 'axiom_first_seen_at': stamp, 'file_size': 4000000 + i} for i, path in enumerate(paths)]
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


def luminance(rgb):
    def channel(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def colour(text):
    import re
    nums = [float(n) for n in re.findall(r'[\d.]+', text)]
    alpha = nums[3] if len(nums) > 3 else 1.0
    return tuple(nums[:3]), alpha


BANNER = r'''(() => { const n = document.getElementById('ph-apply-status'); if (!n) return JSON.stringify(null);
  const q = s => n.querySelector(s); const bar = q('.ph-apply-bar'), fill = q('.ph-apply-fill');
  return JSON.stringify({state: n.dataset.state, title: q('.ph-apply-title').textContent, detail: q('.ph-apply-detail').textContent,
    text: n.innerText, count: document.querySelectorAll('#ph-apply-status').length, parent: n.parentElement && n.parentElement.id,
    prev: n.previousElementSibling && n.previousElementSibling.className, barShown: bar.getBoundingClientRect().height > 0,
    fillPct: bar.getBoundingClientRect().width ? Math.round(fill.getBoundingClientRect().width / bar.getBoundingClientRect().width * 1000) / 10 : 0,
    shown: n.checkVisibility({checkVisibilityCSS: true}) && n.getBoundingClientRect().height > 0,
    closeShown: q('.ph-apply-close').getBoundingClientRect().height > 0}); })()'''
MOTION = r'''(() => { const n = document.getElementById('ph-apply-status'); if (!n) return JSON.stringify(null);
  return JSON.stringify([n, ...n.querySelectorAll('*')].map(e => { const s = getComputedStyle(e);
    return {el: e.className || e.tagName, td: s.transitionDuration, tdelay: s.transitionDelay, an: s.animationName}; })); })()'''
COLOURS = r'''(() => { const n = document.getElementById('ph-apply-status'); const bg = getComputedStyle(n).backgroundColor;
  return JSON.stringify({bg, parts: ['.ph-apply-title', '.ph-apply-detail', '.ph-apply-close'].map(s => { const e = n.querySelector(s); const c = getComputedStyle(e);
    return {sel: s, color: c.color, shown: e.getBoundingClientRect().height > 0, text: e.textContent}; })}); })()'''


def more_rules(browser, js, banner, observe):
    """The banner rules added after the code review."""
    body = json.dumps({'category': 'title_cleanup', 'paths': ['a', 'b', 'c', 'd', 'e'], 'apply': True})

    def begin():
        observe(PUBLISH_APPLY, 'POST', '{}', None)

    def status(data):
        observe(PUBLISH_STATUS, 'GET', None, dict({'success': True}, **data))
        return banner()

    def abort_post(path, request_body='{}'):
        """A real request through the page's fetch (and so through the banner's wrapper) that is rejected before it reaches the server."""
        browser.eval("(()=>{fetch(%s,{method:'POST',headers:{'Content-Type':'application/json'},body:%s,signal:AbortSignal.abort()}).catch(()=>1);return 1})()"
                     % (json.dumps(path), json.dumps(request_body)))
        time.sleep(0.4)
        return banner()

    # --- partial and complete: which count, which state
    begin()
    b = status({'status': 'partial', 'total': 5, 'summary': {'published': 3}})
    check(b and b['state'] == 'partial' and b['title'] == '3 applied, 2 could not be applied', f'partial, summary {{published: 3}} (no failed key), total 5: {b}')
    begin()
    b = status({'status': 'partial', 'summary': {'published': 3, 'failed': 1, 'skipped': 1}, 'total': 9})
    check(b and b['state'] == 'partial' and b['title'] == '3 applied, 2 could not be applied', f'failed + skipped are both counted (not total - published): {b}')
    begin()
    b = status({'status': 'partial', 'summary': {'published': 3}, 'results': [{'status': 'published'}] * 3 + [{'status': 'skipped', 'reason': 'Source file changed after preview'}, {'status': 'weird'}]})
    check(b and b['state'] == 'partial' and b['title'] == '3 applied, 2 could not be applied' and 'First reason: Source file changed after preview' in b['detail'],
          f'no failed/skipped count: the result rows that are not published are counted: {b}')
    begin()
    b = status({'status': 'partial', 'summary': {'published': 3}})
    check(b and b['state'] == 'partial' and b['title'] == '3 applied, some could not be applied', f'partial with nothing to count: {b}')
    begin()
    b = status({'status': 'partial', 'total': 4, 'summary': {'published': 0}})
    check(b and b['state'] == 'failed' and b['title'] == '0 applied, 4 could not be applied', f'partial with nothing published is the failed state: {b}')
    begin()
    b = status({'status': 'partial', 'summary': {}})
    check(b and b['state'] == 'failed' and b['title'] == '0 applied, some could not be applied', f'partial with an empty summary: {b}')
    begin()
    b = status({'status': 'complete', 'total': 5, 'summary': {'published': 3}})
    check(b and b['state'] == 'partial' and b['title'] == '3 applied, 2 could not be applied', f'complete but 2 of 5 missing is not green: {b}')
    begin()
    b = status({'status': 'complete', 'total': 3, 'summary': {'published': 3, 'skipped': 1}})
    check(b and b['state'] == 'partial' and b['title'] == '3 applied, 1 could not be applied', f'complete with a skipped song is not green: {b}')
    begin()
    b = status({'status': 'complete', 'total': 3, 'summary': {'published': 3, 'failed': 0}, 'results': [{'status': 'published'}] * 3})
    check(b and b['state'] == 'ok' and b['title'] == '3 changes applied', f'complete with nothing missed is green: {b}')
    begin()
    b = status({'status': 'complete', 'total': 1, 'summary': {'published': 1}})
    check(b and b['state'] == 'ok' and b['title'] == '1 change applied', f'singular: {b}')

    # --- a publish request lost at the network level: "Checking...", later status answers decide
    check(js('window.AxiomWindowsHealthApply.lostTimeoutMs') == 20000, 'lostTimeoutMs should default to 20000')
    browser.eval('(()=>{window.AxiomWindowsHealthApply.lostTimeoutMs=60000;return 1})()')
    b = abort_post(PUBLISH_APPLY, json.dumps({'confirmation': 'PUBLISH CLEAN TITLES AND ARTISTS', 'include_conflicts': True}))
    check(b and b['state'] == 'running' and b['title'] == 'Checking…' and b['detail'] == CHECKING_DETAIL and b['count'] == 1, f'a lost publish apply request: {b}')
    check(b and not b['closeShown'] and b['barShown'], f'Checking...: the bar is waiting and Hide is not shown: {b}')
    b = status({'status': 'publishing', 'progress': 2, 'total': 5})
    check(b and b['state'] == 'running' and b['title'] == 'Applying 2 of 5…', f'a status answer replaces Checking...: {b}')
    b = status({'status': 'complete', 'total': 5, 'summary': {'published': 5}})
    check(b and b['state'] == 'ok' and b['title'] == '5 changes applied', f'lost, then a complete status: green: {b}')
    check(b and b['detail'] == 'Titles and artists were written into your music files.', f'green detail: {b}')
    b = abort_post(PUBLISH_APPLY)
    check(b and b['title'] == 'Checking…', f'lost again: {b}')
    b = status({'status': 'partial', 'total': 5, 'summary': {'published': 4}})
    check(b and b['state'] == 'partial' and b['title'] == '4 applied, 1 could not be applied', f'lost, then a partial status: {b}')
    b = abort_post(PUBLISH_APPLY)
    b = status({'status': 'error', 'error': 'The job could not start.'})
    check(b and b['state'] == 'failed' and b['title'] == 'No changes were applied' and 'The job could not start' in b['detail'], f'lost, then an error status: {b}')

    # an HTTP rejection is still the failed state (the real server refuses a wrong confirmation with a 4xx answer)
    begin()
    browser.eval("(()=>{fetch(%s,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation:'wrong',include_conflicts:true})}).catch(()=>1);return 1})()" % json.dumps(PUBLISH_APPLY))
    time.sleep(1.0)
    b = banner()
    check(b and b['state'] == 'failed' and b['title'] == 'No changes were applied' and b['title'] != 'Checking…' and b['closeShown'], f'an HTTP-level rejection of apply must show failed: {b}')
    observe(PUBLISH_APPLY, 'POST', '{}', None)
    observe(PUBLISH_APPLY, 'POST', '{}', {'success': False, 'error': 'Publish is not ready.'}, False)
    b = banner()
    check(b and b['state'] == 'failed' and b['title'] == 'No changes were applied' and 'Publish is not ready' in b['detail'], f'rejected apply (observe): {b}')

    # --- the time limit on Checking...
    browser.eval('(()=>{window.AxiomWindowsHealthApply.lostTimeoutMs=300;return 1})()')
    b = abort_post(PUBLISH_APPLY)
    # (abort_post waits 0.4 s, longer than the limit: the limit has already fired)
    check(b and b['state'] == 'failed' and b['title'] == COULD_NOT_CONFIRM and b['detail'] == 'Open the list again to see what was applied, then try again if needed.' and b['closeShown'] and not b['barShown'],
          f'Checking... must end after lostTimeoutMs in the failed state with Hide shown: {b}')
    b = status({'status': 'complete', 'total': 5, 'summary': {'published': 5}})
    check(b and b['state'] == 'failed' and b['title'] == COULD_NOT_CONFIRM, f'a late status answer after the time limit must not change the failed state: {b}')
    # a deciding answer before the limit cancels the timer
    browser.eval('(()=>{window.AxiomWindowsHealthApply.lostTimeoutMs=1200;return 1})()')
    browser.eval("(()=>{fetch(%s,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.abort()}).catch(()=>1);return 1})()" % json.dumps(PUBLISH_APPLY))
    time.sleep(0.2)
    check((banner() or {}).get('title') == 'Checking…', f'Checking... should still be showing 0.2 s after the lost request: {banner()}')
    status({'status': 'complete', 'total': 5, 'summary': {'published': 5}})
    time.sleep(2.0)
    b = banner()
    check(b and b['state'] == 'ok' and b['title'] == '5 changes applied', f'the timer must be cancelled by the status answer (still green 2 s later): {b}')
    # any new state cancels it too
    browser.eval("(()=>{window.AxiomWindowsHealthApply.lostTimeoutMs=800;fetch(%s,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.abort()}).catch(()=>1);return 1})()" % json.dumps(PUBLISH_APPLY))
    time.sleep(0.2)
    observe(CLEANUP, 'POST', body, None)
    time.sleep(1.6)
    b = banner()
    check(b and b['state'] == 'running' and b['title'] == 'Applying 5 changes…', f'a new running state replaces Checking... and its timer: {b}')
    observe(CLEANUP, 'POST', body, {'success': True, 'count': 5})
    # a limit of 0 fires at once; an invalid one falls back to 20 s (still waiting after 1 s)
    browser.eval('(()=>{window.AxiomWindowsHealthApply.lostTimeoutMs=0;return 1})()')
    b = abort_post(PUBLISH_APPLY)
    check(b and b['state'] == 'failed' and b['title'] == COULD_NOT_CONFIRM, f'lostTimeoutMs 0: {b}')
    for bad in ('-5', "'soon'", 'NaN', 'Infinity', 'null', 'undefined'):
        browser.eval(f'(()=>{{window.AxiomWindowsHealthApply.lostTimeoutMs={bad};return 1}})()')
        begin()
        b = abort_post(PUBLISH_APPLY)
        time.sleep(0.7)
        b = banner()
        check(b and b['state'] == 'running' and b['title'] == 'Checking…', f'lostTimeoutMs {bad} should fall back to 20 s, not fire at once: {b}')
        status({'status': 'complete', 'total': 1, 'summary': {'published': 1}})   # decides; cancels the 20 s timer
    browser.eval('(()=>{window.AxiomWindowsHealthApply.lostTimeoutMs=20000;return 1})()')
    check(browser.eval('typeof window.AxiomWindowsHealthApply.observe') == 'function', 'the exposed object must keep observe')

    # --- rollback
    browser.eval('(()=>{window.AxiomWindowsHealthApply.lostTimeoutMs=60000;return 1})()')
    b = abort_post(PUBLISH_ROLLBACK)
    check(b and b['state'] == 'running' and b['title'] == 'Checking…' and b['detail'] == CHECKING_DETAIL, f'a rollback request lost at the network level: {b}')
    b = status({'status': 'rolled_back', 'summary': {'rolled_back': 5}})
    check(b and b['state'] == 'ok' and b['title'] == '5 files restored', f'lost rollback, then rolled_back: {b}')
    observe(PUBLISH_ROLLBACK, 'POST', '{}', None)
    check(banner()['title'] == 'Starting…', 'a rollback start shows Starting...')
    observe(PUBLISH_ROLLBACK, 'POST', '{}', {'success': False, 'error': 'There is nothing to roll back.'}, False)
    b = banner()
    check(b and b['state'] == 'failed' and b['title'] == 'Nothing was restored' and 'There is nothing to roll back' in b['detail'], f'a rejected rollback says nothing was restored: {b}')
    observe(PUBLISH_ROLLBACK, 'POST', '{}', None)
    b = status({'status': 'error', 'error': 'Rollback stopped.'})
    check(b and b['state'] == 'failed' and b['title'] == 'Nothing was restored', f'a failed rollback (status error): {b}')
    observe(PUBLISH_ROLLBACK, 'POST', '{}', None)
    b = status({'status': 'rollback_partial', 'summary': {'rolled_back': 2}})
    check(b and b['state'] == 'partial' and b['title'] == '2 files restored', f'rollback_partial: {b}')
    begin()   # a later apply is worded as an apply again
    b = status({'status': 'error', 'error': ''})
    check(b and b['title'] == 'No changes were applied' and 'stopped before it could change anything' in b['detail'], f'an apply after a rollback uses the apply wording: {b}')

    # --- a cleanup request lost at the network level
    observe(CLEANUP, 'POST', body, None)
    observe(CLEANUP, 'POST', body, {'success': False, 'error': 'PEAK HOUR could not be reached.', 'lost': True}, False)
    b = banner()
    check(b and b['state'] == 'failed' and b['title'] == COULD_NOT_CONFIRM and b['detail'] == 'The connection dropped. Open the list again to see what was applied.' and b['closeShown'], f'cleanup lost (observe): {b}')
    b = abort_post(CLEANUP, body)
    check(b and b['state'] == 'failed' and b['title'] == COULD_NOT_CONFIRM and b['detail'] == 'The connection dropped. Open the list again to see what was applied.', f'cleanup lost (real aborted request): {b}')
    check('Errno' not in (b or {}).get('text', ''), 'no error code on the bar')
    observe(CLEANUP, 'POST', body, None)
    observe(CLEANUP, 'POST', body, {'success': False, 'error': 'Not allowed.'}, False)
    b = banner()
    check(b and b['title'] == 'No changes were applied' and 'Not allowed' in b['detail'], f'an HTTP-level cleanup rejection is still the failed state, not "could not confirm": {b}')
    browser.eval("(()=>{document.querySelector('#ph-apply-status .ph-apply-close').click();return 1})()")
    check(banner() is None, 'Hide did not remove the banner after the new rules')


def main():
    browser = fb.Browser(sandbox=base / 'edge', base_url=url, width=1424, height=992)
    browsers.append(browser)

    def js(expr):
        value = browser.eval(expr)
        return json.loads(value) if isinstance(value, str) else value

    def banner():
        return js(BANNER)

    def observe(path, method, body, data, ok_flag=True):
        browser.eval(f'(()=>{{window.AxiomWindowsHealthApply.observe({json.dumps(path)},{json.dumps(method)},{json.dumps(body)},'
                     f'{json.dumps(data)},{json.dumps(ok_flag)});return 1}})()')

    r = browser.run([
        {'op': 'collect_errors', 'clear': True},
        {'op': 'navigate', 'url': '/', 'settle': 4000},
        {'op': 'eval', 'expr': "(()=>{const s=[...document.querySelectorAll('button')].find(x=>/skip tour/i.test(x.textContent)&&x.offsetParent);if(s)s.click();return 1})()"},
        {'op': 'sleep', 'seconds': 1},
        {'op': 'eval', 'expr': "(()=>{showTab('health-review');return 1})()"},
        {'op': 'sleep', 'seconds': 1.5},
    ])
    check(r.steps[1].get('ok'), 'could not load the app')
    check(js("typeof window.AxiomWindowsHealthApply === 'object' && typeof window.AxiomWindowsHealthApply.observe === 'function'"),
          'window.AxiomWindowsHealthApply.observe is not there (script not loaded?)')
    check(js("!!document.querySelector('link[href*=\"windows-health-apply.css\"]') && !!document.querySelector('script[src*=\"windows-health-apply.js\"]')"),
          'the page does not load windows-health-apply.css / .js')
    check(js("!document.getElementById('tab-content-health-review').classList.contains('hidden')"), 'the health-review tab did not open (cannot test)')
    check(banner() is None, 'a banner is on the page before anything was applied')

    # --- an old finished answer, with nothing started in this visit, shows nothing
    observe('/api/library/metadata_publish/status', 'GET', None, {'success': True, 'status': 'complete', 'progress': 5, 'total': 5, 'summary': {'published': 5}})
    observe('/api/library/metadata_publish/status', 'GET', None, {'success': True, 'status': 'partial', 'summary': {'published': 1, 'failed': 4}})
    check(banner() is None, 'an old "complete"/"partial" status answer showed a banner although no apply was started in this visit')
    # a real status poll from the page (fresh server: nothing ever published) also shows nothing
    browser.eval("fetch('/api/library/metadata_publish/status').then(r => r.json()).then(() => 1)")
    time.sleep(0.5)
    check(banner() is None, 'a real status poll showed a banner with no apply started')

    # --- publish progress
    observe(PUBLISH_APPLY, 'POST', json.dumps({'confirmation': 'PUBLISH CLEAN TITLES AND ARTISTS', 'include_conflicts': True}), None)
    b = banner()
    check(b and b['state'] == 'running' and b['title'] == 'Starting…', f'publish start: {b}')
    observe(PUBLISH_STATUS, 'GET', None, {'success': True, 'status': 'publishing', 'progress': 9, 'total': 20})
    b = banner()
    check(b and b['title'] == 'Applying 9 of 20…' and b['state'] == 'running', f'publish progress banner: {b}')
    check(b and 44 <= b['fillPct'] <= 46, f'fill should be ~45%, is {b and b["fillPct"]}')
    check(b and b['barShown'], 'the progress bar is not shown while running')
    check(b and b['parent'] == 'tab-content-health-review' and 'health-review-page-head' in (b['prev'] or ''),
          f'the bar should sit right after .health-review-page-head in #tab-content-health-review: parent={b and b["parent"]} prev={b and b["prev"]}')
    check(b and b['shown'] and not b['closeShown'], 'running: the bar must be visible and Hide hidden')
    # contrast, running state
    contrast = {}

    def measure(state):
        data = js(COLOURS)
        bg, alpha = colour(data['bg'])
        check(alpha == 1.0, f'{state}: the bar background should be opaque, is {data["bg"]}')
        for part in data['parts']:
            if not part['shown']:
                continue
            fg, _ = colour(part['color'])
            value = ratio(fg, bg)
            contrast[(state, part['sel'])] = round(value, 2)
            check(value >= 3.0, f'{state}: {part["sel"]} text {part["color"]} on {data["bg"]} has contrast {value:.2f}:1 (needs 3:1)')
    measure('running')
    motion = js(MOTION)
    check(all(m['td'] in ('0s', '0s, 0s') and m['an'] == 'none' for m in motion), f'transition/animation found: {[m for m in motion if m["td"] != "0s" or m["an"] != "none"]}')

    # --- every file failed
    observe(PUBLISH_STATUS, 'GET', None, {'success': True, 'status': 'partial', 'progress': 20, 'total': 20, 'summary': {'failed': 20},
                                          'results': [{'path': 'x.mp3', 'status': 'failed', 'reason': FRIENDLY, 'technical_detail': '[Errno 13] Permission denied'}]})
    b = banner()
    check(b and b['state'] == 'failed' and b['title'] == '0 applied, 20 could not be applied', f'all-failed banner: {b}')
    check(b and 'First reason: ' + FRIENDLY[:-1] in b['detail'], f'detail should say "First reason: {FRIENDLY}": {b and b["detail"]!r}')
    check(b and '[Errno' not in b['text'] and 'Errno' not in b['text'], f'the bar shows an error code: {b and b["text"]!r}')
    check(b and not b['barShown'] and b['closeShown'], 'finished: progress bar hidden, Hide shown')
    measure('failed')
    # an unreworded server answer must still not put a code on screen
    observe(PUBLISH_APPLY, 'POST', '{}', None)
    observe(PUBLISH_STATUS, 'GET', None, {'success': True, 'status': 'partial', 'summary': {'published': 3, 'failed': 2},
                                          'results': [{'status': 'published'}, {'status': 'failed', 'reason': '[Errno 9] Bad file descriptor'}]})
    b = banner()
    check(b and b['state'] == 'partial' and b['title'] == '3 applied, 2 could not be applied' and 'Errno' not in b['text'], f'partial publish banner: {b}')
    measure('partial')
    observe(PUBLISH_APPLY, 'POST', '{}', None)
    observe(PUBLISH_STATUS, 'GET', None, {'success': True, 'status': 'complete', 'summary': {'published': 20}})
    b = banner()
    check(b and b['state'] == 'ok' and b['title'] == '20 changes applied' and b['count'] == 1, f'complete publish banner: {b}')
    measure('ok')
    observe(PUBLISH_STATUS, 'GET', None, {'success': True, 'status': 'complete', 'summary': {'published': 1}})  # a later poll: finished already, ignored
    check(banner()['title'] == '20 changes applied', 'a second finished poll must not change the result')

    # --- cleanup wording
    body = json.dumps({'category': 'title_cleanup', 'paths': ['a', 'b', 'c', 'd', 'e'], 'apply': True})
    observe(CLEANUP, 'POST', body, None)
    b = banner()
    check(b and b['state'] == 'running' and b['title'] == 'Applying 5 changes…' and b['count'] == 1, f'cleanup running: {b}')
    observe(CLEANUP, 'POST', body, {'success': True, 'count': 3})
    b = banner()
    check(b and b['state'] == 'partial' and b['title'] == '3 applied, 2 could not be applied', f'cleanup partial: {b}')
    observe(CLEANUP, 'POST', body, None)
    observe(CLEANUP, 'POST', body, {'success': True, 'count': 0})
    b = banner()
    check(b and b['state'] == 'failed' and b['title'] == 'No changes were applied', f'cleanup none applied: {b}')
    observe(CLEANUP, 'POST', body, None)
    observe(CLEANUP, 'POST', body, {'success': False, 'error': FRIENDLY}, False)
    b = banner()
    check(b and b['state'] == 'failed' and b['title'] == 'No changes were applied' and FRIENDLY[:-1] in b['detail'], f'cleanup rejected: {b}')
    observe(CLEANUP, 'POST', body, None)
    observe(CLEANUP, 'POST', body, {'success': True, 'count': 5})
    b = banner()
    check(b and b['state'] == 'ok' and b['title'] == '5 changes applied', f'cleanup ok: {b}')
    observe(CLEANUP, 'GET', body, None)
    check(banner()['title'] == '5 changes applied', 'a GET to the cleanup route must be ignored')
    observe(CLEANUP, 'POST', json.dumps({'paths': ['a'], 'apply': True}), None)
    check(banner()['title'] == 'Applying 1 change…', f'one change must be singular: {banner()}')
    observe(CLEANUP, 'POST', json.dumps({'paths': ['a'], 'apply': True}), {'success': True, 'count': 1})

    # --- a real cleanup request from the page
    real = js('''(async () => {
      const post = async (u, b) => (await fetch(u, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)})).json();
      const plan = await post('/api/library/utility_metadata_preview', {category: 'title_cleanup', excluded_paths: [], expected_values: []});
      const paths = plan.expected_values.map(r => r.path);
      const running = new Promise(res => setTimeout(res, 0));
      const pending = post('/api/library/utility_metadata_cleanup', {category: 'title_cleanup', paths, apply: true, scope: 'sample', excluded_paths: [],
        custom_overrides: [], expected_values: plan.expected_values, review_rules_signature: plan.review_rules_signature});
      await running;
      const during = document.getElementById('ph-apply-status') && document.getElementById('ph-apply-status').dataset.state;
      const done = await pending;
      await new Promise(res => setTimeout(res, 500));
      return JSON.stringify({count: done.count, success: done.success, sent: paths.length, during});
    })()''')
    check(real['success'] is True and real['count'] == real['sent'] == COUNT, f'the real cleanup did not apply every song: {real}')
    b = banner()
    check(b and b['state'] == 'ok' and b['title'] == f'{real["count"]} changes applied', f'banner after a real cleanup should match the answer ({real["count"]}): {b}')

    # --- survives a toast, goes with the tab, goes on Hide, replaced not doubled
    browser.eval("(()=>{showToast('Utility review refreshed. Source audio untouched.');return 1})()")
    time.sleep(0.8)
    b = banner()
    check(b and b['state'] == 'ok' and b['shown'], f'the banner did not survive a toast: {b}')
    browser.eval("(()=>{showTab('health');return 1})()")
    time.sleep(0.8)
    check(banner() is None, 'the banner is still on the page after leaving the review page (showTab("health"))')
    observe(CLEANUP, 'POST', body, None)  # started elsewhere: it shows on whatever page is open, once
    check((banner() or {}).get('count') == 1, 'a cleanup started on another page should show exactly one bar')
    browser.eval("(()=>{showTab('health-review');return 1})()")
    time.sleep(1.0)
    observe(CLEANUP, 'POST', body, None)
    observe(CLEANUP, 'POST', body, None)
    b = banner()
    check(b and b['count'] == 1 and b['parent'] == 'tab-content-health-review', f'a new apply must replace the bar, not add one: {b}')
    observe(CLEANUP, 'POST', body, {'success': True, 'count': 5})
    browser.eval("(()=>{document.querySelector('#ph-apply-status .ph-apply-close').click();return 1})()")
    time.sleep(0.3)
    check(banner() is None, 'Hide did not remove the banner')
    observe(PUBLISH_STATUS, 'GET', None, {'success': True, 'status': 'complete', 'summary': {'published': 5}})
    check(banner() is None, 'after Hide, a late finished status answer must not bring the banner back')

    more_rules(browser, js, banner, observe)

    errors = browser.run([{'op': 'collect_errors'}]).steps[0].get('value') or []
    real_errors = [e for e in errors if not any(skip in json.dumps(e) for skip in ('/api/library/artwork', '/api/license/validate', 'favicon'))]
    # the one deliberate wrong-confirmation apply request is answered 400; the browser logs that as a resource error
    deliberate = [e for e in real_errors if e.get('kind') == 'resource' and e.get('url', '').endswith('/api/library/metadata_publish/apply') and '400' in e.get('text', '')]
    check(len(deliberate) == 1, f'expected exactly one deliberate 400 answer, saw {len(deliberate)}')
    real_errors = [e for e in real_errors if e not in deliberate]
    check(not real_errors, f'script errors on the page: {json.dumps(real_errors)[:600]}')
    print('  contrast:', {f'{k[0]} {k[1]}': v for k, v in contrast.items()})


try:
    make_library()
    start()
    main()
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
print('PASS: the Health apply status bar shows progress, plain-worded results and a real cleanup count, ignores old answers, survives toasts, '
      'leaves with the page or Hide, has no motion and readable text in every state'
      if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
