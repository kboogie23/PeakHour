"""AXIOM on a sandbox copy of the user's setup, for the full feature walkthrough.

Usage: python run_axiom_walkthrough_server.py <sandbox folder> <port>

The sandbox holds a profile (copied music, Serato/djay/VirtualDJ data) that
replaces USERPROFILE/LOCALAPPDATA/APPDATA/TEMP, and AXIOM's own data. Safety:
- any Python-level write, rename or delete outside this workspace is refused
  (protects the user's real music files, tags and DJ libraries);
- Serato modern-library crates for other drives (e.g. E:) are refused, since
  SQLite writes bypass the audit hook.
Reading the user's real files (other drives, original track paths) is allowed.
"""
import os, sys, pathlib
root = pathlib.Path(__file__).resolve().parent
sandbox = pathlib.Path(sys.argv[1]).resolve(); port = int(sys.argv[2])
assert sandbox.is_relative_to(root), 'sandbox must be inside the workspace'
profile = sandbox / 'profile'; data = sandbox / 'axiom-data'; temp = sandbox / 'temp'
for p in (data, temp): p.mkdir(parents=True, exist_ok=True)
os.environ.update({'USERPROFILE': str(profile), 'HOME': str(profile), 'LOCALAPPDATA': str(profile / 'AppData' / 'Local'),
                   'APPDATA': str(profile / 'AppData' / 'Roaming'), 'TEMP': str(temp), 'TMP': str(temp),
                   'AXIOM_RUNTIME_DIR': str(data)})
blocked_log = sandbox / 'blocked-writes.log'

def _outside(path):
    if isinstance(path, int): return False
    if os.fsdecode(path).lower() in ('nul', 'con', r'\\.\nul', os.devnull.lower()): return False  # null devices
    try: resolved = pathlib.Path(os.fsdecode(path)).resolve()
    except (TypeError, ValueError, OSError): return False
    return not resolved.is_relative_to(root)

def guard(event, args):
    target = None
    if event == 'open' and len(args) > 1 and isinstance(args[1], str) and any(c in args[1] for c in 'wax+'):
        target = args[0]
    elif event in ('os.remove', 'os.rename', 'os.rmdir', 'shutil.rmtree', 'os.truncate', 'shutil.move', 'os.link', 'os.symlink'):
        target = args[0]
        if event == 'os.rename' and len(args) > 1 and _outside(args[1]): target = args[1]
    if target is not None and isinstance(target, (str, bytes, os.PathLike)) and _outside(target):
        with open(blocked_log, 'a', encoding='utf-8') as f: f.write(f'{event} {os.fsdecode(target)}\n')
        raise PermissionError(f'Walkthrough sandbox refused {event} outside the workspace: {os.fsdecode(target)}')
sys.addaudithook(guard)

sys.path.insert(0, str(root / 'axiom-win-probe'))
import axiom_windows_launcher as L
L.data_root = lambda: data
L.log_server_errors()
axiom = L.build_app(port)
import windows_serato_library as S
_original = S.database_for_tracks
def sandbox_only(tracks):
    database = _original(tracks)
    if not pathlib.Path(database).resolve().is_relative_to(root):
        raise S.SeratoLibraryError('Walkthrough sandbox: Serato crates on other drives are disabled for this test.')
    return database
S.database_for_tracks = sandbox_only
from werkzeug.serving import make_server
print('ready', port, flush=True)
make_server(L.HOST, port, axiom.app, threaded=True).serve_forever()
