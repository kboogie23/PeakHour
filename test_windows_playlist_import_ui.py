r"""Playlists > Import Playlist, what the DJ sees (headless Edge, real app, synthetic songs).

  * the "Import Playlist" button sits right after "Import Sets" (still there), with no transition
  * a .m3u8 with 5 library paths and 2 unknown lines becomes a saved set named after the file, 5 songs in file order, selected,
    and the result panel says "5 of 7" and lists the two lines with the reason
  * the same file again becomes "Name (2)" and the first set is untouched (same id, same songs)
  * a file with no matches adds nothing and says why; two files at once give two sets
  * a line with HTML in it is shown as text, nothing runs; a server refusal (.xyz) is shown in plain words
  * Close removes the panel; dragging a file over the page marks it (ph-drop), dropping imports and clears the mark
  * guests are told to sign in; a .json backup is still read in the page
  * an imported set is saved with an empty Set Brief ({}), not the brief open on the page (a non-default one is set first), and the
    page's own brief is left alone (an empty saved brief opens as the default one)
  * the "more than 3,000 songs" refusal reads the server's matched_total (the rows returned stop at 3,001): the answer is replaced
    in the page for one call (test side only); the refusal line shows, no set is saved; exactly 3,000 is still saved
  * panel text contrast is at least 3:1 in night and day mode, no script errors, no leftover processes, temp folder removed

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\\Users\\gatli\\Documents\\PeakHour; & .\\axiom-win-env\\Scripts\\python.exe test_windows_playlist_import_ui.py"
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
base = Path(tempfile.mkdtemp(prefix='phimpui'))
runtime = base / 'runtime'
files = base / 'files'
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'), 'APPDATA': str(base / 'roaming'),
       'AXIOM_RUNTIME_DIR': str(runtime), 'AXIOM_LICENSE_REQUIRED': '0', 'AXIOM_NO_OPEN': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
env.pop('AXIOM_DEVICE_ID', None)
for name in ('local', 'home', 'roaming', 'runtime'):
    (base / name).mkdir()
files.mkdir()
servers, browsers = [], []
failures = []
COUNT = 12
GONE_A, GONE_B = 'Z:\\gone\\a.mp3', 'Z:\\gone\\b.mp3'
NOT_FOUND = 'Not in your library'


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)
    return bool(cond)


STATE = r'''JSON.stringify({
  sets: JSON.parse(localStorage.getItem('axiomSavedPlaylists') || '[]').map(s => ({id: s.id, name: s.name, paths: s.tracks.map(t => t.path), tracks: s.tracks, brief: s.setBrief})),
  sel: (document.getElementById('playlist-listen-title') || {}).textContent,
  panel: (document.getElementById('ph-playlist-import-result') || {}).innerText || null,
  working: !!document.querySelector('#ph-playlist-import-result .is-working'),
  drop: document.getElementById('tab-content-playlists').classList.contains('ph-drop')})'''
CONTRAST = r'''(() => {
  const parse = c => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const panel = document.getElementById('ph-playlist-import-result');
  const bgc = parse(getComputedStyle(panel).backgroundColor);
  const bg = bgc.slice(0, 3);
  const out = {bgAlpha: bgc.length > 3 ? bgc[3] : 1, bg: bg.join(','), rows: []};
  const lb = lum(bg);
  for (const sel of ['.ph-pi-line:not(.is-problem):not(.ph-pi-sub)', '.ph-pi-line.is-problem', '.ph-pi-sub', 'summary', 'li', '.ph-pi-close']) {
    const el = panel.querySelector(sel);
    if (!el) { out.rows.push({sel, missing: true}); continue; }
    const fg = parse(getComputedStyle(el).color).slice(0, 3);
    const a = lum(fg), hi = Math.max(a, lb), lo = Math.min(a, lb);
    out.rows.push({sel, fg: fg.join(','), ratio: Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100, text: (el.textContent || '').trim().slice(0, 30)});
  }
  const cs = getComputedStyle(panel);
  out.transition = cs.transitionDuration; out.animation = cs.animationName;
  return JSON.stringify(out); })()'''


class Page:
    def __init__(self):
        self.browser = fb.Browser(sandbox=base / 'edge', base_url=url, width=1424, height=992)
        browsers.append(self.browser)

    def run(self, steps, timeout=120):
        return self.browser.run(steps, timeout=timeout)

    def ev(self, expr):
        return self.browser.eval(expr)

    def json(self, expr):
        value = self.ev(expr)
        return json.loads(value) if isinstance(value, str) else value

    def state(self):
        return self.json(STATE)

    def wait(self, test, seconds=40, what='the import to finish'):
        end = time.monotonic() + seconds
        state = self.state()
        while time.monotonic() < end:
            state = self.state()
            if test(state):
                return state
            time.sleep(0.4)
        check(False, f'timed out waiting for {what}: {json.dumps(state)[:500]}')
        return state

    def finished(self, state):
        return state['panel'] is not None and not state['working']

    def close_panel(self):
        self.ev("(()=>{const b=document.querySelector('#ph-playlist-import-result .ph-pi-close');if(b)b.click();return 1})()")

    def upload(self, names):
        """Choose files in the hidden input (as the file dialog would) and wait for the panel to finish."""
        self.close_panel()
        step = self.run([{'op': 'set_files', 'selector': '#ph-playlist-import-input', 'files': [str(files / n) for n in names]}])
        check(step.steps[0].get('ok'), f'set_files {names}: {step.steps[0].get("error")}')
        return self.wait(self.finished)


def make_library():
    names = [f'trk-{i:04d}.mp3' for i in range(COUNT)]
    paths = sl.make_real_files(base, COUNT, names)
    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    tracks = [{'path': p, 'filename': Path(p).name, 'folder': 'Music', 'title': f'Import Test {i:02d}', 'artist': f'Artist {i % 4}', 'album': 'Album',
               'genre': 'House', 'comments': '', 'label': '', 'bpm': 120.0 + i, 'camelot': f'{i % 12 + 1}A', 'key_raw': f'{i % 12 + 1}A', 'energy': 'Mid',
               'year': 2000 + i, 'era': 'Unknown', 'playlist_names': [], 'cue_count': 0, 'beatgrid_locked': False, 'source': 'virtualdj_database',
               'connected_from': 'virtualdj', 'needs_relink': False, 'duration_sec': 200 + i, 'axiom_first_seen_at': stamp, 'file_size': 4000000 + i}
              for i, p in enumerate(paths)]
    sl.write_library(runtime, tracks)
    return paths


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


def scenario(paths):
    seven = [paths[4], paths[2], GONE_A, paths[0], paths[7], GONE_B, paths[9]]
    (files / 'Seven Mix.m3u8').write_text('\n'.join(seven) + '\n', encoding='utf-8')
    (files / 'Nothing.m3u').write_text('Z:\\a.mp3\nZ:\\b.mp3\n', encoding='utf-8')
    (files / 'Other One.m3u').write_text(paths[1] + '\n' + paths[3] + '\n', encoding='utf-8')
    (files / 'A&amp;B.m3u').write_text('<img src=x onerror=window.__xss=1>\n' + paths[5] + '\n<script>window.__xss=2</script>\n', encoding='utf-8')
    (files / 'bad.xyz').write_text('whatever', encoding='utf-8')
    (files / 'backup.json').write_text(json.dumps([{'path': paths[1], 'title': 'Import Test 01', 'artist': 'Artist 1'},
                                                   {'path': paths[3], 'title': 'Import Test 03', 'artist': 'Artist 3'}]), encoding='utf-8')
    (files / 'broken.json').write_text('{not json', encoding='utf-8')

    page = Page()
    r = page.run([{'op': 'collect_errors', 'clear': True}, {'op': 'navigate', 'url': '/', 'settle': 4000},
                  {'op': 'eval', 'expr': "(()=>{const s=[...document.querySelectorAll('button')].find(x=>/skip tour/i.test(x.textContent)&&x.offsetParent);if(s)s.click();return 1})()"},
                  {'op': 'sleep', 'seconds': 1},
                  {'op': 'eval', 'expr': "(()=>{localStorage.removeItem('axiomSavedPlaylists');showTab('playlists');return 1})()"},
                  {'op': 'sleep', 'seconds': 1.5}])
    check(r.steps[1].get('ok'), 'could not load the app')

    # ---- a non-default brief is open on the page: an imported set must not copy it
    brief = page.json("""JSON.stringify((()=>{currentSetBrief=normalizeSetBrief({enabled:true,intention:'wedding',duration:120,era:'Recent'});
      const b=setBriefPayload();return {intention:b.intention,duration:b.duration,enabled:b.enabled,era:b.era}})())""")
    check(brief == {'intention': 'wedding', 'duration': 120, 'enabled': True, 'era': 'Recent'}, f'test setup: the page brief was not changed: {brief}')

    # ---- the button
    info = page.json("""JSON.stringify((()=>{const bs=[...document.querySelectorAll('#tab-content-playlists .playlist-toolbar-actions button')];
      const i=bs.findIndex(b=>b.textContent.trim()==='Import Sets'); const btn=document.getElementById('ph-playlist-import-btn'); const cs=btn&&getComputedStyle(btn);
      const input=document.getElementById('ph-playlist-import-input');
      return {labels: bs.map(b=>b.textContent.trim()), setsIndex: i, next: i>=0&&bs[i+1]?bs[i+1].id:null, text: btn&&btn.textContent.trim(), shown: !!btn&&btn.offsetParent!==null,
        transition: cs&&cs.transitionDuration, transitionProp: cs&&cs.transitionProperty, hasTransitionClass: !!btn&&btn.className.includes('transition'),
        setsShown: i>=0&&bs[i].offsetParent!==null, input: input&&{multiple: input.multiple, accept: input.accept, type: input.type, hidden: input.hidden}}})())""")
    check(info['setsIndex'] >= 0, f'the Import Sets button is gone: {info["labels"]}')
    check(info['next'] == 'ph-playlist-import-btn' and info['text'] == 'Import Playlist', f'Import Playlist must come right after Import Sets: {info["labels"]} (next {info["next"]})')
    check(info['shown'] and info['setsShown'], 'both import buttons must be visible')
    check(info['transition'] and all(part.strip() == '0s' for part in info['transition'].split(',')), f'the button has a transition: {info["transition"]} {info["transitionProp"]}')
    check(not info['hasTransitionClass'], 'the button carries a transition class')
    check(info['input'] and info['input']['multiple'] and info['input']['type'] == 'file' and info['input']['hidden'], f'the file input: {info["input"]}')
    accept = set((info['input'] or {}).get('accept', '').split(','))
    check({'.m3u', '.m3u8', '.pls', '.txt', '.csv', '.xml', '.crate', '.vdjfolder', '.json'} <= accept, f'accepted types: {accept}')
    check(page.state()['panel'] is None, 'no result panel should show before an import')

    # ---- one file: 5 of 7
    s = page.upload(['Seven Mix.m3u8'])
    want = [paths[4], paths[2], paths[0], paths[7], paths[9]]
    seven_sets = [x for x in s['sets'] if x['name'] == 'Seven Mix']
    check(len(s['sets']) == 1 and len(seven_sets) == 1, f'one saved set called "Seven Mix" expected, got {[x["name"] for x in s["sets"]]}')
    if seven_sets:
        check(seven_sets[0]['paths'] == want, f'saved songs not the 5 library paths in file order: {seven_sets[0]["paths"]}')
    check((s['sel'] or '').strip().lower() == 'seven mix', f'the new set should be the selected one (playlist-listen-title): {s["sel"]!r}')
    text = s['panel'] or ''
    check("Imported 'Seven Mix': 5 of 7 songs." in text, f'panel should say 5 of 7: {text!r}')
    check(f'{GONE_A} \u2014 {NOT_FOUND}' in text and f'{GONE_B} \u2014 {NOT_FOUND}' in text, f'panel should list both unknown lines with the reason: {text!r}')
    check(text.index(GONE_A) < text.index(GONE_B), 'unmatched lines should be in file order')
    check(page.json("JSON.stringify(!!document.querySelector('#ph-playlist-import-result details[open]'))"), 'the not-found list should be open')
    check(page.json("JSON.stringify(document.querySelector('#playlist-listen-tracks').querySelectorAll('[data-path]').length)") == 5, 'the selected set should list its 5 songs on the page')
    first = seven_sets[0] if seven_sets else {}
    check(first.get('brief') == {}, f'an imported set is saved with an empty Set Brief, not the page brief (wedding, 120 min): {first.get("brief")!r}')
    after_brief = page.json("JSON.stringify((()=>{const b=setBriefPayload();return {intention:b.intention,duration:b.duration,enabled:b.enabled}})())")
    check(after_brief == {'intention': 'wedding', 'duration': 120, 'enabled': True}, f'importing must not change the brief open on the page: {after_brief}')
    check(page.json("JSON.stringify(normalizeSetBrief(JSON.parse(localStorage.getItem('axiomSavedPlaylists'))[0].setBrief).intention)") == 'party', 'an empty saved brief should open as the default one (party)')

    # ---- same file again
    s = page.upload(['Seven Mix.m3u8'])
    names = [x['name'] for x in s['sets']]
    check(names == ['Seven Mix (2)', 'Seven Mix'], f'second import should add "Seven Mix (2)" in front: {names}')
    again = [x for x in s['sets'] if x['name'] == 'Seven Mix']
    check(again and again[0]['id'] == first.get('id') and again[0]['tracks'] == first.get('tracks'), 'the first set must be unchanged (same id, same songs)')
    check((s['sel'] or '').strip().lower() == 'seven mix (2)', f'the newest set should be selected: {s["sel"]!r}')
    check("Imported 'Seven Mix (2)': 5 of 7 songs." in (s['panel'] or ''), f'second panel text: {s["panel"]!r}')
    s = page.upload(['Seven Mix.m3u8'])
    check([x['name'] for x in s['sets']][:3] == ['Seven Mix (3)', 'Seven Mix (2)', 'Seven Mix'], f'third import name: {[x["name"] for x in s["sets"]]}')

    # ---- no matches
    before = page.state()['sets']
    s = page.upload(['Nothing.m3u'])
    check([x['id'] for x in s['sets']] == [x['id'] for x in before], 'a file with no matches must not add a set')
    text = s['panel'] or ''
    check("'Nothing' was not imported" in text and 'none of its 2 songs are in your PEAK HOUR library' in text, f'panel should explain why nothing was saved: {text!r}')

    # ---- two files at once
    before = page.state()['sets']
    s = page.upload(['Other One.m3u', 'Nothing.m3u'])
    check(len(s['sets']) == len(before) + 1 and s['sets'][0]['name'] == 'Other One', f'one of the two files has songs: {[x["name"] for x in s["sets"]][:3]}')
    s = page.upload(['Other One.m3u', 'Seven Mix.m3u8'])
    new = [x['name'] for x in s['sets']][:2]
    check(len(s['sets']) == len(before) + 3 and set(new) == {'Other One (2)', 'Seven Mix (4)'}, f'two files chosen together should give two sets: {new}, count {len(s["sets"])} from {len(before)}')
    text = s['panel'] or ''
    check("Imported 'Other One (2)': 2 of 2 songs." in text and "Imported 'Seven Mix (4)': 5 of 7 songs." in text, f'panel should report both files: {text!r}')

    # ---- HTML in the file stays text
    before = page.state()['sets']
    s = page.upload(['A&amp;B.m3u'])
    text = s['panel'] or ''
    check(len(s['sets']) == len(before) + 1 and s['sets'][0]['name'] == 'A&amp;B', f'set from the HTML-ish file: {[x["name"] for x in s["sets"]][:2]}')
    check('<img src=x onerror=window.__xss=1>' in text and '<script>window.__xss=2</script>' in text, f'the markup should be shown literally: {text!r}')
    check("Imported 'A&amp;B': 1 of 3 songs." in text, f'text of the HTML file panel: {text!r}')
    check(page.json("JSON.stringify([typeof window.__xss, document.querySelectorAll('#ph-playlist-import-result img, #ph-playlist-import-result script').length])") == ['undefined', 0],
          'file content must never run or become elements')
    check(page.json("JSON.stringify(document.querySelectorAll('img[src=x], script[src]:not([src])').length)") == 0, 'an <img src=x> element appeared on the page')

    # ---- a refusal from the server, in plain words
    before = page.state()['sets']
    s = page.upload(['bad.xyz'])
    text = s['panel'] or ''
    check("PEAK HOUR can't read this kind of file." in text and 'bad.xyz' in text, f'the refusal should be shown: {text!r}')
    check(not any(bad in text for bad in ('Traceback', 'undefined', '[object', 'null', 'NaN')), f'panel has non-plain text: {text!r}')
    check([x['id'] for x in s['sets']] == [x['id'] for x in before], 'a refused file must not add a set')
    check(page.json("JSON.stringify(!!document.querySelector('#ph-playlist-import-result .is-problem'))"), 'a refusal should be marked as a problem line')

    # ---- .json backups are read in the page
    s = page.upload(['backup.json'])
    check(s['sets'][0]['name'] == 'backup' and s['sets'][0]['paths'] == [paths[1], paths[3]], f'.json backup: {s["sets"][0]["name"]} {s["sets"][0]["paths"]}')
    check("Imported 'backup': 2 of 2 songs." in (s['panel'] or ''), f'.json panel: {s["panel"]!r}')
    before = page.state()['sets']
    s = page.upload(['broken.json'])
    check([x['id'] for x in s['sets']] == [x['id'] for x in before] and 'could not be read' in (s['panel'] or ''), f'broken .json: {s["panel"]!r}')

    check(all(x.get('brief') == {} for x in page.state()['sets']), f'every imported set should carry an empty Set Brief: {[x.get("brief") for x in page.state()["sets"]]}')

    # ---- a playlist of more than 3,000 songs: the page reads matched_total (the answer holds at most 3,001 rows)
    library_rows = json.loads((runtime / 'data' / 'library_cache.json').read_text(encoding='utf-8'))['tracks'][:3]

    def crafted(name, matched, unmatched_total=0):
        return {'success': True, 'format': 'm3u', 'skipped_playlists': 0,
                'playlists': [{'name': name, 'total': matched + unmatched_total, 'matched_total': matched, 'tracks': library_rows, 'unmatched': [], 'unmatched_total': unmatched_total}]}
    page.ev("""(()=>{window.__realFetch=window.fetch;window.__fake=null;window.__realCalls=0;
      window.fetch=function(u,o){if(String(u).indexOf('/api/windows/playlists/import')>=0&&window.__fake){const body=window.__fake;window.__fake=null;
        return Promise.resolve(new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}}))}
        if(String(u).indexOf('/api/windows/playlists/import')>=0)window.__realCalls++;return window.__realFetch.apply(window,arguments)};return 1})()""")
    before = page.state()['sets']
    page.ev('window.__fake=' + json.dumps(crafted('Huge', 3001)))
    s = page.upload(['Other One.m3u'])
    text = s['panel'] or ''
    check(page.json('JSON.stringify(window.__fake===null)'), 'the crafted answer was not used')
    check("'Huge' has 3,001 songs. PEAK HOUR saves sets of up to 3,000 songs; split it in your DJ software and import the parts." in text, f'the over-3,000 refusal line: {text!r}')
    check('Imported' not in text, f'a refused playlist must not report an import: {text!r}')
    check([x['id'] for x in s['sets']] == [x['id'] for x in before], 'a playlist over 3,000 songs must not be saved')
    check(page.json("JSON.stringify(!!document.querySelector('#ph-playlist-import-result .is-problem'))"), 'the refusal should be marked as a problem line')
    page.ev('window.__fake=' + json.dumps(crafted('Huge', 7000, 12)))
    s = page.upload(['Other One.m3u'])
    check("'Huge' has 7,000 songs." in (s['panel'] or '') and [x['id'] for x in s['sets']] == [x['id'] for x in before], f'matched_total 7000 with 12 unmatched: {s["panel"]!r}')
    page.ev('window.__fake=' + json.dumps(crafted('Edge', 3000)))
    s = page.upload(['Other One.m3u'])
    check(len(s['sets']) == len(before) + 1 and s['sets'][0]['name'] == 'Edge' and len(s['sets'][0]['paths']) == 3 and s['sets'][0]['brief'] == {},
          f'exactly 3,000 matched songs is still saved: {[x["name"] for x in s["sets"]][:2]}')
    check("Imported 'Edge': 3 of 3,000 songs." in (s['panel'] or '') and '2,997 repeated songs were saved once.' in (s['panel'] or ''), f'the Edge panel: {s["panel"]!r}')
    check(page.json('JSON.stringify(window.__realCalls)') == 0, 'the crafted answers should have replaced the server calls')
    page.ev('(()=>{window.fetch=window.__realFetch;return 1})()')

    # ---- contrast, with every kind of line in the panel (a good file, a file with unknown lines and a file with none found)
    results = {}
    for mode in ('night', 'day'):
        page.ev("(()=>{document.body.classList.toggle('light-mode', %s);return 1})()" % ('true' if mode == 'day' else 'false'))
        page.upload(['Seven Mix.m3u8', 'Nothing.m3u', 'bad.xyz'])
        results[mode] = page.json(CONTRAST)
        c = results[mode]
        check(c['bgAlpha'] == 1, f'{mode}: the panel background should be opaque, alpha {c["bgAlpha"]}')
        check(c['transition'].split(',')[0].strip() == '0s' and c['animation'] == 'none', f'{mode}: panel has a transition/animation: {c["transition"]} {c["animation"]}')
        for entry in c['rows']:
            check(not entry.get('missing'), f'{mode}: no {entry["sel"]} in the panel to measure')
            if not entry.get('missing'):
                check(entry['ratio'] >= 3, f'{mode}: contrast of {entry["sel"]} ({entry["text"]!r}) is {entry["ratio"]}:1 (text {entry["fg"]} on {c["bg"]})')
        print(f'  {mode}: ' + ', '.join(f'{e["sel"].split(":")[0]} {e.get("ratio")}' for e in c['rows']))
    check(results['night']['bg'] != results['day']['bg'], 'the panel did not change colours between night and day')
    page.ev("(()=>{document.body.classList.remove('light-mode');return 1})()")

    # ---- Close
    page.ev("(()=>{window.scrollTo(0,0);return 1})()")
    r = page.run([{'op': 'click', 'selector': '#ph-playlist-import-result .ph-pi-close'}, {'op': 'sleep', 'seconds': 0.5}])
    check(r.steps[0].get('ok'), f'could not click Close: {r.steps[0].get("error")}')
    check(page.state()['panel'] is None, 'Close should remove the panel')

    # ---- drag and drop
    before = page.state()['sets']
    page.ev("""(()=>{window.__dt=new DataTransfer();window.__dt.items.add(new File([%s],'Dropped.m3u',{type:'audio/x-mpegurl'}));
      const t=document.getElementById('tab-content-playlists');const over=new DragEvent('dragover',{dataTransfer:window.__dt,bubbles:true,cancelable:true});t.dispatchEvent(over);
      window.__over={had:t.classList.contains('ph-drop'),prevented:over.defaultPrevented};return 1})()""" % json.dumps(paths[5] + '\n' + 'Z:\\none.mp3\n'))
    over = page.json('JSON.stringify(window.__over)')
    check(over == {'had': True, 'prevented': True}, f'dragging a file over the page should mark it (ph-drop) and allow the drop: {over}')
    page.ev("""(()=>{const t=document.getElementById('tab-content-playlists');const e=new DragEvent('dragleave',{dataTransfer:window.__dt,bubbles:true,cancelable:true});t.dispatchEvent(e);return 1})()""")
    check(not page.state()['drop'], 'dragleave should clear ph-drop')
    page.ev("""(()=>{const t=document.getElementById('tab-content-playlists');t.dispatchEvent(new DragEvent('dragover',{dataTransfer:window.__dt,bubbles:true,cancelable:true}));
      const drop=new DragEvent('drop',{dataTransfer:window.__dt,bubbles:true,cancelable:true});t.dispatchEvent(drop);window.__dropPrevented=drop.defaultPrevented;return 1})()""")
    check(not page.state()['drop'], 'dropping should clear ph-drop')
    check(page.json('JSON.stringify(window.__dropPrevented)'), 'drop should be handled (default prevented) so the browser does not open the file')
    s = page.wait(page.finished, what='the dropped file to import')
    check(len(s['sets']) == len(before) + 1 and s['sets'][0]['name'] == 'Dropped' and s['sets'][0]['paths'] == [paths[5]], f'dropped file: {[x["name"] for x in s["sets"]][:2]}')
    check("Imported 'Dropped': 1 of 2 songs." in (s['panel'] or ''), f'dropped panel: {s["panel"]!r}')
    # something that is not a file does not light the page up or swallow the event
    r = page.json("""JSON.stringify((()=>{const t=document.getElementById('tab-content-playlists');const dt=new DataTransfer();dt.setData('text/plain','x');
      const e=new DragEvent('dragover',{dataTransfer:dt,bubbles:true,cancelable:true});t.dispatchEvent(e);return [e.defaultPrevented,t.classList.contains('ph-drop')]})())""")
    check(r == [False, False], f'a text drag must be ignored: {r}')

    # ---- guests are told to sign in
    # (the page shows toasts in its player bar, so record what showToast is asked to say)
    toast = page.json("""JSON.stringify((()=>{const said=[];const real=window.showToast;window.showToast=(m,e)=>{said.push([String(m),!!e])};
      window.AXIOM_ACCESS_CONTEXT={mode:'guest'};const before=document.getElementById('ph-playlist-import-input').value;document.getElementById('ph-playlist-import-btn').click();
      window.AXIOM_ACCESS_CONTEXT=undefined;window.showToast=real;return said})())""")
    check(toast == [['Sign in to save playlists.', True]], f'guest toast: {toast!r}')

    errors = page.run([{'op': 'collect_errors'}]).steps[0].get('value') or []
    real = [e for e in errors if not any(skip in json.dumps(e) for skip in ('/api/library/artwork', '/api/license/validate', 'favicon'))]
    # the three bad.xyz uploads (one on its own, two in the contrast rounds) are answered 400 on purpose: the browser logs those as resources
    refusals = [e for e in real if e.get('kind') == 'resource' and e.get('url', '').endswith('/api/windows/playlists/import') and '400' in e.get('text', '')]
    check(len(refusals) == 3, f'expected exactly the 3 deliberate 400 answers, saw {len(refusals)}')
    real = [e for e in real if e not in refusals]
    check(not real, f'script errors on the page: {json.dumps(real)[:700]}')
    check(page.json('JSON.stringify(window.__xss === undefined)'), 'window.__xss was set: file content ran')


try:
    paths = make_library()
    start()
    scenario(paths)
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
    if base.exists():
        failures.append(f'temp folder was not removed: {base}')
print('PASS: Import Playlist button follows Import Sets without a transition; a playlist file becomes a selected, correctly ordered saved set with a 5-of-7 panel, '
      'repeats get (2)/(3) names, no-match and refused files say why, file text never runs, Close/drag-and-drop/guest work, panel contrast is 3:1 or better in night and day'
      if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
