"""Page cost: PEAK HOUR's window must be idle when nothing is happening. AXIOM's always-on decorative loops (the active
sidebar icon's pulsing glow, one 'shine' button per page) made the browser repaint 60 times a second: about 7 s of
renderer CPU and 4 s of GPU CPU per 8 s on a 20,000-song library, ~1 s without. This checks the style rules that stop
them, and, in a real (headless) Edge on the real app, that the animations removed (sidebar pulse, per-page shine) do not run on the Library, Studio and Performance pages."""
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

workspace = Path(__file__).resolve().parent
css = (workspace / 'axiom-win-probe' / 'static' / 'css' / 'windows-theme-urban.css').read_text(encoding='utf-8')
html = (workspace / 'axiom-win-probe' / 'templates' / 'index.html').read_text(encoding='utf-8')
for selector in ('#axiom-sidebar .axiom-sidebar-nav-item[data-nav-state="active"] :is(svg, img, .axiom-sidebar-nav-icon)',
                 '#studio-tab-magic#studio-tab-magic::after', '#performance-rail-open-receipt::after', '.library-gap-launch::after'):
    rule = next((r for r in re.findall(r'([^{}]+)\{([^{}]*)\}', css) if selector in r[0]), None)
    assert rule and 'animation: none !important' in rule[1] and 'will-change: auto !important' in rule[1], selector
assert int(re.search(r'windows-theme-urban\.css\?v=(\d+)', html).group(1)) >= 15  # existing installs reload the stylesheet

sys.path.insert(0, str(workspace))
from feature_check import browser as fb
ok, why = fb.available()
if not ok:
    print('PASS (style rules only; no page check:', why + ')')
    sys.exit(0)

SERVER = r'''
import sys
sys.path.insert(0, sys.argv[2])
import axiom_windows_launcher as L
b = L.build_app(int(sys.argv[1]))
from werkzeug.serving import make_server
make_server('127.0.0.1', int(sys.argv[1]), b.app, threaded=True).serve_forever()
'''
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
base = Path(tempfile.mkdtemp(prefix='phcost'))
(base / 'local').mkdir()
(base / 'home').mkdir()
env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'), 'AXIOM_LICENSE_REQUIRED': '0'}
server = subprocess.Popen([sys.executable, '-c', SERVER, str(port), str(workspace / 'axiom-win-probe')], env=env,
                          cwd=str(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
browser = None
try:
    url = f'http://127.0.0.1:{port}'
    for _ in range(240):
        try:
            urllib.request.urlopen(url + '/', timeout=3).read()
            break
        except OSError:
            time.sleep(0.5)
    browser = fb.Browser(base / 'browser', base_url=url)
    browser.run([{'op': 'navigate', 'url': '/', 'settle': 4000}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 2}])
    banned = ['axiomSidebarSignalPulse', 'axiomSidebarSignalPulseDay', 'axiom-library-paste-playlist-shine',
              'studio-magic-shine', 'axiom-performance-session-receipt-shine']
    running = ("JSON.stringify(document.getAnimations().filter(a=>a.playState==='running').map(a=>a.animationName||a.transitionProperty||'?')"
               ".filter(n=>%s.includes(n)))" % banned)
    for tab in ('library', 'studio', 'performance'):
        browser.run([{'op': 'click', 'selector': f'#tab-btn-{tab}'}, {'op': 'sleep', 'seconds': 2.5}])
        names = browser.eval(running)
        assert names == '[]', f'{tab}: always-on decorative animations still running: {names}'  # a real loading spinner is allowed
finally:
    if browser:
        browser.close()
    subprocess.run(['taskkill', '/T', '/F', '/PID', str(server.pid)], capture_output=True)
    shutil.rmtree(base, ignore_errors=True)
print('PASS: the sidebar pulse and the per-page shine loops do not run on Library, Studio or Performance (idle page = idle browser)')
