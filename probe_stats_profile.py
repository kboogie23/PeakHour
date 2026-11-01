"""Profiles AXIOM's /api/library/stats on the 50,000-song stress library (sandbox)."""
import os, sys, pathlib, cProfile, pstats, io, glob
workspace = pathlib.Path(__file__).resolve().parent
probe = workspace / 'axiom-win-probe'; home = workspace / 'probe-home'
os.environ.update({'USERPROFILE': str(home), 'HOME': str(home), 'APPDATA': str(home / 'AppData/Roaming'),
                   'LOCALAPPDATA': str(home / 'AppData/Local'), 'AXIOM_RUNTIME_DIR': str(home / 'axiom-runtime'),
                   'AXIOM_LICENSE_REQUIRED': '0'})
sys.path.insert(0, str(probe)); os.chdir(probe)
from windows_bootstrap import build_backend
cache = sorted(glob.glob(str(workspace / 'fixtures' / 'stress' / 'run-*' / 'library_50000.json')), key=os.path.getmtime)[0]
run = pathlib.Path(cache).parent
app = build_backend(recording_settings=run / 'settings.json', recording_directory=run)
app.CACHE_PATH = cache
client = app.app.test_client(); h = {'Host': '127.0.0.1'}
client.get('/api/library/stats', headers=h)  # warm
prof = cProfile.Profile(); prof.enable()
r = client.get('/api/library/stats', headers=h)
prof.disable()
out = io.StringIO(); pstats.Stats(prof, stream=out).sort_stats('cumulative').print_stats(25); print(r.status_code, out.getvalue()[:5000])
