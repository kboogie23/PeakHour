"""PEAK HOUR Mini: the small window shows what the main window published for Live Assist, in a real (headless) Edge;
it opens once and is pinned by its title, and laptops cannot reach it."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from flask import Flask

workspace = Path(__file__).resolve().parent
sys.path.insert(0, str(workspace / 'axiom-win-probe'))
import windows_live_assist_mini as M
from windows_remote_hub import blocked

# 1. Routes: opens once, brings an open window forward, pins by handle, and refuses nothing silently
opened, forwarded, pins, window = [], [], [], [None]
app = Flask(__name__)
app.register_blueprint(M.create_blueprint(lambda: opened.append(1), lambda: window[0],
                                          lambda hwnd, on: pins.append((hwnd, on)) or True, forwarded.append))
client = app.test_client()
assert client.post('/api/windows/live-assist-mini/open').get_json() == {'success': True, 'opened': True} and opened == [1]
assert client.post('/api/windows/live-assist-mini/pin', json={'on': True}).get_json() == {'success': False, 'on': True} and not pins
window[0] = 77
assert client.post('/api/windows/live-assist-mini/open').get_json() == {'success': True, 'opened': False}
assert opened == [1] and forwarded == [77]
assert client.post('/api/windows/live-assist-mini/pin', json={'on': False}).get_json() == {'success': True, 'on': False}
assert pins == [(77, False)]
assert M.find_window() is None or isinstance(M.find_window(), int)
assert blocked('/api/windows/live-assist-mini/open') and blocked('/api/windows/live-assist-mini/pin')

# 2. The real page, on the real app, in headless Edge
SERVER = r'''
import sys, pathlib
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'data'
backend = L.build_app(port)
from werkzeug.serving import make_server
make_server('127.0.0.1', port, backend.app, threaded=True).serve_forever()
'''
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if not os.path.exists(EDGE):
    print('SKIPPED page check: Edge is not installed')
else:
    import socket
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    base_url = f'http://127.0.0.1:{port}'
    base = Path(tempfile.mkdtemp(prefix='phmini'))
    env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'),
           'AXIOM_RUNTIME_DIR': str(base / 'data'), 'AXIOM_LICENSE_REQUIRED': '0'}
    (base / 'local').mkdir()
    (base / 'home').mkdir()
    server = subprocess.Popen([sys.executable, '-c', SERVER, str(base), str(port), str(workspace / 'axiom-win-probe')],
                              env=env, cwd=str(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(240):
            try:
                urllib.request.urlopen(base_url + '/static/windows-live-assist-mini.html', timeout=2).read()
                break
            except OSError:
                time.sleep(0.5)
        anchor = {'title': 'Freak Like Me <Pt. 2>', 'artist': 'Adina Howard', 'bpm': 92, 'camelot': '8A', 'year': 1995,
                  'energy': 'Mid', 'path': 'D:\\a.mp3', 'source_label': 'VirtualDJ'}
        rows = [{'title': f'Next Song {n}', 'artist': f'Artist {n}', 'bpm': 92 + (n - 3), 'camelot': f'{n}A', 'fit': 'Solid Match',
                 'path': f'D:\\{n}.mp3'} for n in range(1, 8)]  # 90-96 BPM: all within 5 of the playing song
        rows += [{'title': 'Too Fast', 'artist': 'Out Of Range', 'bpm': 120, 'path': 'D:\\fast.mp3'},
                 {'title': 'Next Song 1 (Dirty Extended Mix)', 'artist': 'Artist 1', 'bpm': 90, 'path': 'D:\\dupe.mp3'}]
        body = json.dumps({'anchor': anchor, 'suggestions': rows, 'total': len(rows)}).encode()
        request = urllib.request.Request(base_url + '/api/performance/live_assist/state', data=body, method='POST',
                                         headers={'Content-Type': 'application/json', 'Origin': base_url})
        urllib.request.urlopen(request, timeout=20).read()
        state = json.load(urllib.request.urlopen(base_url + '/api/performance/live_assist/state', timeout=20))
        assert (state.get('anchor') or {}).get('title') == anchor['title'], state

        page = base_url + '/static/windows-live-assist-mini.html'
        common = [EDGE, '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--user-data-dir={base / "edge"}',
                  '--window-size=380,560', '--virtual-time-budget=5000']
        for _ in range(4):  # the first headless Edge in a brand-new profile can print nothing
            dom = subprocess.run([*common, '--dump-dom', page], capture_output=True, timeout=120, env=env,
                                 encoding='utf-8', errors='replace').stdout
            if 'Freak Like Me' in dom:
                break
        assert 'Freak Like Me &lt;Pt. 2&gt;' in dom, dom[:2000]  # shown as text, never as markup
        assert 'Adina Howard · 92.0 BPM' in dom and 'VirtualDJ' in dom, dom[:2000]
        # Live Assist's default rules: within 5 BPM, closest tempo first, one version per song
        import re
        shown = re.findall(r'mini-row-title"[^>]*>([^<]+)<', dom)
        assert shown[0] == 'Next Song 3' and 'Too Fast' not in shown and len(shown) == 7, shown
        assert not any('Dirty' in title for title in shown), shown
        assert 'Year unconfirmed' in dom and '92 BPM' in dom and '(7)' in dom, dom[:2000]
        shot = os.environ.get('PEAK_HOUR_MINI_SHOT') or str(base / 'mini.png')
        subprocess.run([*common, f'--screenshot={shot}', page], capture_output=True, timeout=120, env=env)
        for _ in range(20):
            if os.path.exists(shot):
                break
            time.sleep(0.5)
        assert os.path.exists(shot) and os.path.getsize(shot) > 1000

        for template in ('index.html', 'live_assist_window.html'):
            assert 'windows-live-assist-mini-button.js' in (workspace / 'axiom-win-probe' / 'templates' / template).read_text(encoding='utf-8')
        assert 'windows-live-assist-publish.js' in (workspace / 'axiom-win-probe' / 'templates' / 'live_assist_window.html').read_text(encoding='utf-8')
    finally:
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(server.pid)], capture_output=True)
        shutil.rmtree(base, ignore_errors=True)
print('PASS: PEAK HOUR Mini shows the published Live Assist song and suggestions, opens once, pins by title, is PC-only')
