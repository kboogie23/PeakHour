"""PEAK HOUR (Windows) does not offer the Mac releases from AXIOM's update feed: the check answers "not
configured" without contacting it, and PEAK_HOUR_UPDATE_MANIFEST_URL still sets a feed."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

workspace = Path(__file__).resolve().parent
script = r'''
import json, os, sys, pathlib
sb = pathlib.Path(sys.argv[1])
sys.path.insert(0, sys.argv[2])
import requests
contacted = []
requests.get = lambda url, *a, **k: contacted.append(url) or (_ for _ in ()).throw(AssertionError('update feed contacted: ' + url))
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'data'
c = L.build_app(8091).app.test_client()
r = c.get('/api/app/check_update', base_url='http://127.0.0.1:8091').get_json()
import app
print(json.dumps({'response': r, 'feed': app.AXIOM_UPDATE_MANIFEST_URL, 'contacted': contacted}))
'''
with tempfile.TemporaryDirectory(prefix='phupd') as base:
    base = Path(base)
    env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'),
           'AXIOM_RUNTIME_DIR': str(base / 'data'), 'AXIOM_LICENSE_REQUIRED': '0'}
    env.pop('PEAK_HOUR_UPDATE_MANIFEST_URL', None)
    env.pop('AXIOM_UPDATE_MANIFEST_URL', None)

    def run(extra):
        out = subprocess.run([sys.executable, '-c', script, str(base), str(workspace / 'axiom-win-probe')],
                             env={**env, **extra}, capture_output=True, text=True, timeout=300, cwd=str(workspace))
        assert out.returncode == 0, out.stderr[-3000:]
        return json.loads(out.stdout.strip().splitlines()[-1])

    off = run({})
    assert off['feed'] == '' and off['contacted'] == [], off
    assert off['response'].get('updates_configured') is False and not off['response'].get('update_available'), off
    feed = 'https://example.invalid/peak-hour/update.json'  # the stand-in refuses it; the attempt is what counts
    on = run({'PEAK_HOUR_UPDATE_MANIFEST_URL': feed})
    assert on['feed'] == feed and on['contacted'] == [feed], on
print('PASS: no Mac updates on Windows: the check answers "not configured" without contacting the feed; PEAK_HOUR_UPDATE_MANIFEST_URL still sets one')
