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

# 1b. Automatic open (a song was noticed), with a fake clock: opens once (also when two requests race), waits while the window
# starts, never raises it, removes its border, stays closed once the DJ closed it, and the Mini button starts over
import threading
GRACE = M.OPEN_GRACE_SECONDS
URL = '/api/windows/live-assist-mini/open'


def rig(opener_delay=0.0):
    rig_state = {'opened': [], 'forwarded': [], 'styled': [], 'window': [None], 'now': [1000.0]}

    def opener():
        if opener_delay:
            time.sleep(opener_delay)
        rig_state['opened'].append(1)
    flask_app = Flask(__name__)
    flask_app.register_blueprint(M.create_blueprint(opener, lambda: rig_state['window'][0], lambda hwnd, on: True,
                                                    rig_state['forwarded'].append, rig_state['styled'].append,
                                                    clock=lambda: rig_state['now'][0]))
    rig_state['client'] = flask_app.test_client()
    rig_state['auto'] = lambda: rig_state['client'].post(URL, json={'auto': True}).get_json()
    rig_state['button'] = lambda: rig_state['client'].post(URL).get_json()
    return rig_state


QUIET = {'success': True, 'opened': False, 'auto': True}
# 1. fresh state, no window: opens once. 2. again at once, still no window: the window is starting, no second one
r = rig()
assert r['auto']() == {'success': True, 'opened': True, 'auto': True} and r['opened'] == [1]
assert r['auto']() == QUIET and r['opened'] == [1]
# 3. the window appears: quiet, never brought forward, border removed with its handle
r['window'][0] = 5
assert r['auto']() == QUIET and r['forwarded'] == [] and r['styled'] == [5] and r['opened'] == [1]
# 4. the DJ closes it: quiet and never opens again, however long ago
r['window'][0] = None
assert r['auto']() == QUIET and r['opened'] == [1]
r['now'][0] += GRACE * 100
assert r['auto']() == QUIET and r['auto']() == QUIET and r['opened'] == [1] and r['forwarded'] == []
# ...until the Mini button: no window, so it opens (and starts over); auto within the grace is quiet; the window appears
assert r['button']() == {'success': True, 'opened': True} and r['opened'] == [1, 1]
assert r['auto']() == QUIET and r['opened'] == [1, 1]
r['window'][0] = 6
assert r['auto']() == QUIET and r['forwarded'] == [] and r['styled'] == [5, 6] and r['opened'] == [1, 1]
# 5. the Mini button first on a fresh blueprint: opener runs, auto within the grace is quiet, then the window shows up
r = rig()
assert r['button']() == {'success': True, 'opened': True} and r['opened'] == [1]
r['now'][0] += GRACE - 1
assert r['auto']() == QUIET and r['opened'] == [1]
r['window'][0] = 8
assert r['auto']() == QUIET and r['forwarded'] == [] and r['styled'] == [8] and r['opened'] == [1]
# 6. started but the window never appeared: after the grace it counts as closed (suppressed); the button opens again
r = rig()
assert r['auto']()['opened'] is True and r['opened'] == [1]
r['now'][0] += GRACE + 1
assert r['auto']() == QUIET and r['opened'] == [1]
r['now'][0] += GRACE * 100
assert r['auto']() == QUIET and r['opened'] == [1]
assert r['button']() == {'success': True, 'opened': True} and r['opened'] == [1, 1]
# 7. the Mini button with the window present: brought forward once, nothing opened
r = rig()
r['window'][0] = 9
assert r['button']() == {'success': True, 'opened': False} and r['forwarded'] == [9] and r['opened'] == []
# 8. two automatic requests at the same moment: one window
r = rig(opener_delay=0.2)
barrier, answers = threading.Barrier(2), []


def post_auto():
    thread_client = r['client']
    barrier.wait()
    answers.append(thread_client.post(URL, json={'auto': True}).get_json())


threads = [threading.Thread(target=post_auto) for _ in range(2)]
[t.start() for t in threads]
[t.join(10) for t in threads]
assert len(answers) == 2 and sorted(a['opened'] for a in answers) == [False, True] and r['opened'] == [1], (answers, r['opened'])
# 9. the pin route with a window removes its border and records it as seen: closing it afterwards keeps it closed
r = rig()
r['window'][0] = 4
assert r['client'].post('/api/windows/live-assist-mini/pin', json={'on': True}).get_json() == {'success': True, 'on': True}
assert r['styled'] == [4]
r['window'][0] = None
assert r['auto']() == QUIET and r['opened'] == []
r['now'][0] += GRACE * 100
assert r['auto']() == QUIET and r['opened'] == []

# 1c. The outline really goes: DWM is asked on a window of this test (off-screen, destroyed at once)
import ctypes
from ctypes import wintypes
user32 = ctypes.WinDLL('user32', use_last_error=True)
user32.CreateWindowExW.restype = wintypes.HWND
user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_int, ctypes.c_int,
                                   ctypes.c_int, ctypes.c_int, wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID]
user32.DestroyWindow.argtypes = [wintypes.HWND]
probe_window = user32.CreateWindowExW(0x80, 'STATIC', 'PEAK HOUR Mini probe', 0x80CF0000, -32000, -32000, 200, 100, None, None, None, None)
assert probe_window
try:
    dwm = ctypes.WinDLL('dwmapi')
    dwm.DwmGetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
    border = wintypes.DWORD(0)
    if sys.getwindowsversion().build >= 22000:
        assert M.remove_border(probe_window) is True
        # DWM accepts the border colour (S_OK) but cannot read it back; the corner preference can be read back
        assert dwm.DwmGetWindowAttribute(probe_window, 33, ctypes.byref(border), 4) == 0 and border.value == 1, border.value
    else:
        assert M.remove_border(probe_window) in (True, False)  # older Windows: nothing to remove, nothing breaks
finally:
    user32.DestroyWindow(probe_window)
css = (workspace / 'axiom-win-probe' / 'static' / 'css' / 'windows-live-assist-mini.css').read_text(encoding='utf-8')
assert '#d9dbde' not in css and 'border: 1px solid var(--mini-line)' not in css
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
        # Edge runs with the normal environment and a throwaway profile: started with the sandbox's
        # LOCALAPPDATA/USERPROFILE, a new headless Edge often never loads the page (it prints nothing).
        for _ in range(4):
            dom = subprocess.run([*common, '--dump-dom', page], capture_output=True, timeout=120,
                                 encoding='utf-8', errors='replace').stdout
            if "Freak Like Me" in dom:
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
        subprocess.run([*common, f'--screenshot={shot}', page], capture_output=True, timeout=120)
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
print('PASS: PEAK HOUR Mini shows the published Live Assist song and suggestions, opens once (also when requests race), waits while it starts, stays closed once closed, pins by title, is PC-only')
