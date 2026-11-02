"""Health opens with its last results (windows_health_snapshot.py, static/js/shared/windows-health-snapshot.js).

Each step is a separate process (a restart) on the same sandbox: temp LOCALAPPDATA / USERPROFILE / AXIOM_RUNTIME_DIR
and a small library of real files. AXIOM's own count job (app._run_health_scan_job) is counted in each process.
  first open counts and saves data\\health_snapshot.json; a second open in the same process uses AXIOM's memory
  restart: the saved count is answered at once (from_snapshot, no count started), and nothing is rewritten
  the library changed (a write through AXIOM) -> counts again, saves again; ?force=1 -> counts again
  a drive of the library gone (a substituted drive removed) -> counts again; and again when it comes back
  older than 24 hours, a different AXIOM build, corrupt, empty or wrong-shaped file -> counts again
  a saved count is never used while a count is running, and tail_meta reads the small fields from the file's end."""
import os, sys, json, time, shutil, pathlib, tempfile, subprocess

root = pathlib.Path(__file__).resolve().parent
python = root / 'axiom-win-env' / 'Scripts' / 'python.exe'
probe = root / 'axiom-win-probe'

CHILD = r'''
import os, sys, json, time, pathlib
sandbox, step = pathlib.Path(sys.argv[1]), sys.argv[2]
local = sandbox / 'AppData' / 'Local'
os.environ.update(LOCALAPPDATA=str(local), APPDATA=str(sandbox / 'AppData' / 'Roaming'), USERPROFILE=str(sandbox),
                  AXIOM_RUNTIME_DIR=str(local / 'AXIOM DJ'), AXIOM_LICENSE_REQUIRED='0')
os.environ.pop('AXIOM_DEVICE_ID', None)
sys.path.insert(0, sys.argv[3]); os.chdir(sys.argv[3])
from windows_bootstrap import build_backend
from windows_paths import is_safe_location
rec = sandbox / 'rec'; rec.mkdir(exist_ok=True)
app = build_backend(recording_settings=rec / 's.json', recording_directory=rec, safe_location=is_safe_location)
import windows_health_snapshot as W
scans = []
real = app._run_health_scan_job
app._run_health_scan_job = lambda *a, **k: scans.append(1) or real(*a, **k)
client = app.app.test_client()
snap = pathlib.Path(app.DATA_DIR) / W.FILE_NAME

def health(url='/api/library/health'):
    began = time.perf_counter(); first = None; polls = 0
    while True:
        j = client.get(url if polls == 0 else '/api/library/health').get_json(); polls += 1
        if first is None: first = dict(from_snapshot=bool(j.get('from_snapshot')), seconds=round(time.perf_counter() - began, 3), status=j.get('status'))
        if j.get('status') == 'complete' and not j.get('stale'): break
        assert time.perf_counter() - began < 120, j
        time.sleep(0.05)
    return first, j

out = {}
if step in ('open', 'open_twice', 'force'):
    first, j = health('/api/library/health?force=1' if step == 'force' else '/api/library/health')
    out.update(first=first, final=dict(from_snapshot=bool(j.get('from_snapshot')), total=j.get('total'), computed_at=j.get('computed_at'), age=j.get('snapshot_age_seconds'), stale=j.get('stale')))
    if step == 'open_twice':
        again, _ = health()
        out['again'] = again
elif step == 'edit_after_open':
    first, j = health(); out['first'] = first
    scans_before = len(scans)
    data = app.load_cache(app.CACHE_PATH)
    row = dict(data['tracks'][0]); row['path'] = row['path'] + '.copy.mp3'; row['filename'] += '.copy.mp3'
    data['tracks'].append(row); data['total_tracks'] = len(data['tracks'])
    app.safe_write_json(app.CACHE_PATH, data, make_backup=False)
    second, j = health(); out['second'] = second; out['total'] = j.get('total'); out['scans_before_edit'] = scans_before
elif step == 'running_blocks':
    # a count already running: the saved count must not be answered
    import threading
    gate = threading.Event()
    app._run_health_scan_job = lambda *a, **k: scans.append(1) or (gate.wait(20), real(*a, **k))[1]
    j = client.get('/api/library/health?force=1').get_json()
    j2 = client.get('/api/library/health').get_json()
    out.update(first=j.get('status'), second=j2.get('status'), second_from_snapshot=bool(j2.get('from_snapshot')))
    gate.set()
    health()
app.app.view_functions['api_library_health'].windows_snapshot.wait()
out['scans'] = len(scans)
out['snapshot_exists'] = snap.exists()
print('RESULT ' + json.dumps(out))
'''


def step(sandbox, name):
    started = time.time()
    done = subprocess.run([str(python), '-I', '-c', CHILD, str(sandbox), name, str(probe)], capture_output=True, text=True, timeout=300, cwd=str(probe))
    lines = [l for l in done.stdout.splitlines() if l.startswith('RESULT ')]
    assert done.returncode == 0 and lines, (name, done.stdout[-1500:], done.stderr[-3000:])
    result = json.loads(lines[-1][7:])
    print('  %-16s %5.1fs  %s' % (name, time.time() - started, json.dumps({k: v for k, v in result.items()})))
    return result


def make_library(sandbox, drive=None):
    music = sandbox / 'Music'
    music.mkdir(parents=True)
    tracks = []

    def add(path, i):
        tracks.append({'path': str(path), 'filename': path.name if hasattr(path, 'name') else os.path.basename(str(path)), 'folder': 'Music',
                       'title': 'Song %d' % i, 'artist': 'Artist', 'bpm': 120.0 + i, 'camelot': '8A', 'file_size': 10, 'source': 'virtualdj_database'})
    for i in range(12):
        path = music / ('song%02d.mp3' % i)
        path.write_bytes(bytes(10))
        add(path, i)
    if drive:
        for i in range(3):
            add(drive + '\\other%d.mp3' % i, 100 + i)
    library = {'tracks': tracks, 'total_tracks': len(tracks), 'folder_structure': {}, 'source_audio_untouched': True,
               'reset_generation': 2, 'latest_import_batch': {'id': 'abc123', 'count': 3}, 'connected_source': 'virtualdj'}
    cache = sandbox / 'AppData' / 'Local' / 'AXIOM DJ' / 'data'
    cache.mkdir(parents=True)
    (cache / 'library_cache.json').write_text(json.dumps(library, indent=2), encoding='utf-8')
    (sandbox / 'AppData' / 'Roaming').mkdir(parents=True)
    return cache


def free_letter():
    return next((c for c in 'XYZWVUTS' if not os.path.exists(c + ':\\')), None)


def main():
    sandbox_root = pathlib.Path(tempfile.mkdtemp(prefix='hs', dir=tempfile.gettempdir()))
    sandbox = sandbox_root / 's'
    other = sandbox_root / 'other'
    other.mkdir()
    for i in range(3):
        (other / ('other%d.mp3' % i)).write_bytes(bytes(10))
    letter = free_letter()
    mapped = subprocess.run(['subst', letter + ':', str(other)], capture_output=True, text=True) if letter else None
    drive = letter + ':' if mapped is not None and mapped.returncode == 0 else None
    try:
        data = make_library(sandbox, drive)
        snap = data / 'health_snapshot.json'
        cache = data / 'library_cache.json'

        # --- tail_meta and helpers, in this process
        sys.path.insert(0, str(probe))
        import windows_health_snapshot as W
        meta = W.tail_meta(str(cache))
        assert meta == {'total_tracks': 15 if drive else 12, 'reset_generation': 2, 'latest_import_batch': 'abc123', 'connected_source': 'virtualdj'}, meta
        assert W.tail_meta(str(data / 'nothing.json')) == {k: None for k in meta}
        assert W.drive_root('D:\\Music\\a.mp3') == 'D:\\' and W.drive_root('\\\\nas\\share\\a\\b.mp3') == '\\\\nas\\share\\' and W.drive_root('relative.mp3') == ''
        assert W.drive_presence({'C:\\', 'Q:\\'}) == {'C:\\': True, 'Q:\\': False} or os.path.isdir('Q:\\')
        # a network share that does not answer: "not there" after the time limit, never a long wait; answers are reused briefly
        share = '\\\\nas\\share\\'
        real_isdir, calls = os.path.isdir, []
        os.path.isdir = lambda p: calls.append(p) or time.sleep(3) or True
        try:
            started = time.time()
            assert W.drive_presence({'C:\\', share}, timeout=0.3) == {'C:\\': True, share: False}
            assert time.time() - started < 2 and calls == [share]
        finally:
            os.path.isdir = real_isdir
        os.path.isdir = lambda p: True
        try:
            W._unc_seen.clear()
            assert W.drive_presence({share}) == {share: True}
            os.path.isdir = lambda p: 1 / 0
            assert W.drive_presence({share}) == {share: True}  # reused, not asked again
        finally:
            os.path.isdir = real_isdir
            W._unc_seen.clear()
        # drive types (injected): fixed by the table alone; removable, remote and CD are asked; none/no root are absent
        real_types, real_isdir, asked = W.drive_types, os.path.isdir, []
        W.drive_types = lambda: {'F': 3, 'R': 2, 'N': 4, 'K': 5, 'B': 1, 'U': 0}
        os.path.isdir = lambda p: asked.append(p) or p in ('R:\\', 'K:\\')  # card reader and CD answer; the mapped drive's server is off
        try:
            W._unc_seen.clear()
            got = W.drive_presence({'F:\\', 'R:\\', 'N:\\', 'K:\\', 'B:\\', 'U:\\', 'Z:\\'}, timeout=1)
            assert got == {'F:\\': True, 'R:\\': True, 'N:\\': False, 'K:\\': True, 'B:\\': False, 'U:\\': False, 'Z:\\': False}, got
            assert sorted(asked) == ['K:\\', 'N:\\', 'R:\\']  # never F:, never the unusable ones
            os.path.isdir = lambda p: False  # the card is taken out: reused for 30 s, then asked again
            assert W.drive_presence({'R:\\'})['R:\\'] is True
            W._unc_seen.clear()
            assert W.drive_presence({'R:\\'})['R:\\'] is False
            os.path.isdir = lambda p: time.sleep(3) or True  # a mapped drive that never answers
            W._unc_seen.clear()
            started = time.time()
            assert W.drive_presence({'N:\\'}, timeout=0.3) == {'N:\\': False} and time.time() - started < 2
        finally:
            W.drive_types, os.path.isdir = real_types, real_isdir
            W._unc_seen.clear()
        # one save attempt per count, even when it fails
        class FakeApp:
            DATA_DIR = str(data)
            CACHE_PATH = str(cache)
            BACKGROUND_HEALTH_SCAN_LOCK = __import__('threading').Lock()
            BACKGROUND_HEALTH_SCAN_STATE = {'scan_id': 7, 'snapshot_fingerprint': 'x:1:1:1'}
            loads = []
            _all_library_cache_tracks = staticmethod(lambda d: d)
            load_cache = staticmethod(lambda p: FakeApp.loads.append(1) or {})
        fake = W.HealthSnapshot(FakeApp)
        done = {'status': 'complete', 'summary': {}, 'completed_at': 't'}
        for _ in range(5):
            fake.remember(done)
            fake.wait()
        assert fake.written == (7, 't') and FakeApp.loads == []  # fingerprint did not match: nothing was read
        FakeApp.BACKGROUND_HEALTH_SCAN_STATE['snapshot_fingerprint'] = 'x:1:%d:%d' % (cache.stat().st_size, cache.stat().st_mtime_ns)
        fake.written = None
        for _ in range(5):
            fake.remember(done)
            fake.wait()
        assert FakeApp.loads == [1] and not (data / 'nothing.json').exists()  # failing save: read once, not on every poll

        # --- first open counts and saves; a second open in the same process answers from AXIOM's memory
        r = step(sandbox, 'open_twice')
        assert r['scans'] == 1 and not r['first']['from_snapshot'] and r['final']['stale'] is False and not r['final']['from_snapshot'], r
        assert not r['again']['from_snapshot'] and r['snapshot_exists'], r
        saved = json.loads(snap.read_text(encoding='utf-8'))
        assert saved['payload']['status'] == 'complete' and saved['key']['size'] == cache.stat().st_size and saved['key']['mtime_ns'] == cache.stat().st_mtime_ns, saved['key']
        assert saved['key']['reset_generation'] == 2 and saved['key']['latest_import_batch'] == 'abc123' and saved['key']['connected_source'] == 'virtualdj'
        assert saved['key']['total_tracks'] == meta['total_tracks'] and saved['key']['module'] == W.MODULE_VERSION and saved['key']['version']
        assert 'C:\\' in saved['drives'] and all(saved['drives'].values()) and (not drive or drive + '\\' in saved['drives']), saved['drives']
        assert not list(data.glob('health_snapshot.json.*.tmp'))
        saved_bytes = snap.read_bytes()

        # --- restart: answered from the snapshot, no count, nothing rewritten
        r = step(sandbox, 'open')
        assert r['scans'] == 0 and r['first']['from_snapshot'] and r['first']['status'] == 'complete' and r['first']['seconds'] < 2, r
        assert r['final']['stale'] is False and r['final']['total'] == meta['total_tracks'] and r['final']['computed_at'] == saved['computed_at'], r
        assert snap.read_bytes() == saved_bytes

        # --- a library change counts again and saves again; the next restart uses the new save
        r = step(sandbox, 'edit_after_open')
        assert r['first']['from_snapshot'] and r['scans'] == 1 and not r['second']['from_snapshot'] and r['total'] == meta['total_tracks'] + 1, r
        assert snap.read_bytes() != saved_bytes
        r = step(sandbox, 'open')
        assert r['scans'] == 0 and r['first']['from_snapshot'] and r['final']['total'] == meta['total_tracks'] + 1, r
        saved_bytes = snap.read_bytes()

        # --- the tail fields differ although size and time were put back: counts again
        original = json.loads(saved_bytes)
        for field, value in (('reset_generation', 3), ('latest_import_batch', 'other'), ('connected_source', 'serato'), ('total_tracks', 1)):
            changed = json.loads(saved_bytes)
            changed['key'][field] = value
            snap.write_text(json.dumps(changed), encoding='utf-8')
            r = step(sandbox, 'open')
            assert r['scans'] == 1 and not r['first']['from_snapshot'], (field, r)
            assert json.loads(snap.read_text(encoding='utf-8'))['key'][field] == original['key'][field], field  # saved again, correctly
        saved_bytes = snap.read_bytes()

        # --- ?force=1 always counts and saves
        r = step(sandbox, 'force')
        assert r['scans'] == 1 and not r['first']['from_snapshot'] and not r['final']['from_snapshot'], r
        assert json.loads(snap.read_text(encoding='utf-8'))['computed_epoch'] >= original['computed_epoch']

        # --- 24 hours, build, module version, access tier, damage
        base = json.loads(snap.read_text(encoding='utf-8'))

        def damaged(label, change, expect_scan=True):
            doc = json.loads(json.dumps(base))
            text = change(doc)
            snap.write_text(text if isinstance(text, str) else json.dumps(doc), encoding='utf-8')
            r = step(sandbox, 'open')
            assert (r['scans'] == 1 and not r['first']['from_snapshot']) == expect_scan, (label, r)
            if expect_scan:
                assert json.loads(snap.read_text(encoding='utf-8'))['payload']['status'] == 'complete', label  # replaced by a good one
            return r
        damaged('older than 24 h', lambda d: d.update(computed_epoch=time.time() - 24 * 3600 - 60))
        damaged('in the future', lambda d: d.update(computed_epoch=time.time() + 3600))
        damaged('other build', lambda d: d['key'].update(build='1900_0101'))
        damaged('other version', lambda d: d['key'].update(version='0.0.1'))
        damaged('other module', lambda d: d['key'].update(module=W.MODULE_VERSION + 1))
        damaged('other tier', lambda d: d['key'].update(access_tier='preview'))
        damaged('track limit', lambda d: d['key'].update(track_limit=100))
        damaged('not json', lambda d: '{"payload": ')
        damaged('empty file', lambda d: '')
        damaged('a list', lambda d: '[1, 2]')
        damaged('no payload', lambda d: d.pop('payload'))
        damaged('no drives', lambda d: d.pop('drives'))
        damaged('no time', lambda d: d.update(computed_epoch='yesterday'))
        damaged('a drive missing', lambda d: d['drives'].update({'Q:\\': True}) if not os.path.isdir('Q:\\') else None)
        damaged('a drive that was missing is back', lambda d: d['drives'].update({'C:\\': False}))
        snap.write_bytes(b'\xff\xfe\x00garbage')
        r = step(sandbox, 'open')
        assert r['scans'] == 1 and not r['first']['from_snapshot'], r
        damaged('control: untouched snapshot is used', lambda d: None, expect_scan=False)

        # --- a count running now is joined, not answered from the file
        r = step(sandbox, 'running_blocks')
        assert r['first'] == 'scanning' and r['scans'] == 1, r
        assert r['second'] == 'scanning' and not r['second_from_snapshot'], r

        # --- a drive of the library removed -> counts again; back -> counts again
        if drive:
            subprocess.run(['subst', drive, '/d'], capture_output=True)
            assert not os.path.isdir(drive + '\\')
            r = step(sandbox, 'open')  # saved while the drive was there
            assert r['scans'] == 1 and not r['first']['from_snapshot'], ('drive removed', r)
            r = step(sandbox, 'open')  # saved with the drive away: used
            assert r['scans'] == 0 and r['first']['from_snapshot'], ('drive still away', r)
            assert subprocess.run(['subst', drive, str(other)], capture_output=True).returncode == 0
            r = step(sandbox, 'open')
            assert r['scans'] == 1 and not r['first']['from_snapshot'], ('drive back', r)
            r = step(sandbox, 'open')
            assert r['scans'] == 0 and r['first']['from_snapshot'], r
            print('drive removal and return checked with', drive)
        else:
            print('SKIPPED drive removal: no free drive letter or subst failed')
        print('windows_health_snapshot: all checks passed')
    finally:
        if drive:
            subprocess.run(['subst', drive, '/d'], capture_output=True)
        shutil.rmtree(sandbox_root, ignore_errors=True)


def front_end():
    """The script and its tag exist; the tag is once, in CRLF; the script parses."""
    page = (probe / 'templates' / 'index.html').read_bytes()
    tag = b'<script src="/static/js/shared/windows-health-snapshot.js?v=1"></script>\r\n'
    assert page.count(tag) == 1
    script = probe / 'static' / 'js' / 'shared' / 'windows-health-snapshot.js'
    text = script.read_text(encoding='utf-8')
    assert 'runLibraryHealthCheck({force:true})' in text and 'from_snapshot' in text and 'color:inherit' in text
    node = shutil.which('node')
    if node:
        assert subprocess.run([node, '--check', str(script)], capture_output=True).returncode == 0
    manual = (probe / 'static' / 'manual' / 'index.html').read_text(encoding='utf-8')
    assert 'Last checked' in manual and 'Refresh' in manual


if __name__ == '__main__':
    front_end()
    main()
