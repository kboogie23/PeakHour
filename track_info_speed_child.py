"""Child process of test_windows_track_info_speed.py: argv = sandbox, probe folder, JSON list of paths."""
import os, sys, json, time, pathlib, urllib.parse
sandbox = pathlib.Path(sys.argv[1])
local = sandbox / 'AppData' / 'Local'
os.environ.update(LOCALAPPDATA=str(local), APPDATA=str(sandbox / 'AppData' / 'Roaming'), USERPROFILE=str(sandbox),
                  AXIOM_RUNTIME_DIR=str(local / 'AXIOM DJ'), AXIOM_LICENSE_REQUIRED='0')
os.environ.pop('AXIOM_DEVICE_ID', None)
sys.path.insert(0, sys.argv[2]); os.chdir(sys.argv[2])
from windows_bootstrap import build_backend
from windows_paths import is_safe_location
rec = sandbox / 'rec'; rec.mkdir(exist_ok=True)
app = build_backend(recording_settings=rec / 's.json', recording_directory=rec, safe_location=is_safe_location)
client = app.app.test_client()
cache = app.TRACK_INFO_CACHE
fast = (cache.load, cache.resolve, cache.canonical)
slow = (cache.original_load, cache.original_resolve, cache.original_canonical)

def use(which):
    app._load_access_limited_cache, app._resolve_library_cache_tracks_for_health, app.canonical_path = which

def track(path):
    r = client.get('/api/library/track?path=' + urllib.parse.quote(path))
    return r.status_code, r.get_data(as_text=True)

paths = json.loads(sys.argv[3])
out = {}
use(slow)
before = {p: track(p) for p in paths}
use(fast)
after = {p: track(p) for p in paths}
out['identical'] = {p: before[p] == after[p] for p in paths}
out['status'] = [after[p][0] for p in paths]
out['connected'] = [json.loads(after[p][1])['track'].get('source_connected') for p in paths if after[p][0] == 200]

# repeated opens of tracks that are in the library: no more reads, no more resolving
known = paths[:6]
loads, canon = cache.load_calls, cache.canonical_calls
for _ in range(3):
    for p in known:
        track(p)
out['extra_loads'] = cache.load_calls - loads
out['extra_canonical'] = cache.canonical_calls - canon

# source_connected is live
live = paths[0]
assert json.loads(track(live)[1])['track']['source_connected'] is True
os.replace(live, live + '.moved')
gone = json.loads(track(live)[1])['track']['source_connected']
os.replace(live + '.moved', live)
out['live_after_move'] = gone
out['live_after_restore'] = json.loads(track(live)[1])['track']['source_connected']

# a library write invalidates
loads = cache.load_calls
data = app.load_cache(app.CACHE_PATH)
row = dict(data['tracks'][0]); row['path'] = str(sandbox / 'Music' / 'brand_new.mp3'); row['filename'] = 'brand_new.mp3'; row['title'] = 'Brand New'
(sandbox / 'Music' / 'brand_new.mp3').write_bytes(bytes(10))
out['new_before_write'] = track(row['path'])[0]
data['tracks'].append(row); data['total_tracks'] = len(data['tracks'])
app.safe_write_json(app.CACHE_PATH, data, make_backup=False)
code, body = track(row['path'])
out['new_after_write'] = [code, json.loads(body).get('track', {}).get('title')]
out['loads_after_write'] = cache.load_calls - loads
use(slow); out['new_matches_original'] = (code, body) == track(row['path']); use(fast)

# a drive appearing or leaving: paths resolve again
state = {'mask': cache.drives()}
cache.drives = lambda: state['mask']
track(paths[0])
canon = cache.canonical_calls
track(paths[0]); out['same_drives_resolved'] = cache.canonical_calls - canon
state['mask'] ^= 1 << 25  # Z: appears
track(paths[0]); out['drive_change_resolved'] = cache.canonical_calls - canon

# a track limit never takes the shortcut
loads = cache.load_calls
real_policy = app._current_access_policy
app._current_access_policy = lambda: dict(real_policy(), track_limit=3)
try:
    track(paths[0])
finally:
    app._current_access_policy = real_policy
out['limit_used_core'] = cache.load_calls == loads
with app.app.test_request_context('/api/library/stats'):
    out['other_route_is_core'] = cache.in_track_request() is False

# idle release re-arms after a use; the library is let go after the last open, not kept for good
import threading
track(paths[0])
assert cache.entry is not None
now = [cache.entry['used']]
cache.clock = lambda: now[0]
armed = []
cache._schedule_expiry = lambda delay=None: armed.append(delay)
now[0] += 100
cache.entry['used'] = now[0]          # opened again 100 s after creation
now[0] += 21                           # the first timer fires 121 s after creation
cache.expire()
out['kept_when_used'] = cache.entry is not None
out['rearmed_for'] = round(armed[-1]) if armed else None
now[0] += 100
cache.expire()
out['released_after_idle'] = cache.entry is None

# other callers are not serialised behind a Track Information resolve
track(paths[0])  # entry again
other_done = []
cache.fill_lock.acquire()
try:
    def other():
        app._resolve_library_cache_tracks_for_health({'tracks': [{'path': paths[0]}]}, paths[0])
        other_done.append(1)
    thread = threading.Thread(target=other); thread.start(); thread.join(5)
finally:
    cache.fill_lock.release()
out['other_caller_not_blocked'] = bool(other_done)
print('RESULT ' + json.dumps(out))
