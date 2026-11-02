"""Closing PEAK HOUR stops AXIOM's background library jobs and the process exits even if a worker thread is stuck,
so a Health scan can no longer keep PEAK HOUR running for hours after its window closed."""
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

workspace = Path(__file__).resolve().parent
app_dir = str(workspace / 'axiom-win-probe')

# 1. a non-daemon worker that never ends no longer keeps the process alive
stuck = r'''
import sys, threading, time
sys.path.insert(0, sys.argv[1])
import axiom_windows_launcher as L
L.log = lambda message: print('LOG', message, flush=True)
threading.Thread(target=time.sleep, args=(600,), name='axiom-health-audio_0').start()
L.exit_when_done(7, seconds=1)
'''
start = time.monotonic()
out = subprocess.run([sys.executable, '-c', stuck, app_dir], capture_output=True, text=True, timeout=60)
assert out.returncode == 7 and time.monotonic() - start < 30, (out.returncode, out.stdout, out.stderr[-2000:])
assert 'axiom-health-audio_0' in out.stdout, out.stdout

# 2. the stop requests reach AXIOM's Stop routes (not refused by the launcher's same-origin check)
stop = r'''
import json, sys, pathlib
sb = pathlib.Path(sys.argv[2]); sys.path.insert(0, sys.argv[1])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'data'
backend = L.build_app(8096)
seen = []
@backend.app.after_request
def record(response):
    from flask import request
    seen.append((request.path, response.status_code))
    return response
L.log = lambda message: seen.append(('log', message))
L.stop_background_jobs(backend, 8096)
print(json.dumps(seen))
'''
with tempfile.TemporaryDirectory(prefix='phexit') as base:
    env = {**os.environ, 'LOCALAPPDATA': str(Path(base) / 'local'), 'USERPROFILE': str(Path(base) / 'home'),
           'AXIOM_RUNTIME_DIR': str(Path(base) / 'data'), 'AXIOM_LICENSE_REQUIRED': '0'}
    out = subprocess.run([sys.executable, '-c', stop, app_dir, base], env=env, capture_output=True, text=True,
                         timeout=300, cwd=str(workspace))
    assert out.returncode == 0, out.stderr[-3000:]
    import json
    seen = json.loads(out.stdout.strip().splitlines()[-1])
    assert seen == [['/api/library/unified_health/stop', 200], ['/api/library/year_research/cancel', 200]], seen
print('PASS: closing stops the Health scan and year research, and PEAK HOUR exits even with a stuck worker')
