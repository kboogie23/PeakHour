"""Stress test: AXIOM's Windows build on large generated libraries (sandbox only).

1. Library caches of 10,000 and 50,000 songs (shaped like the user's real 56-track cache) through AXIOM's
   own routes: stats, search, Health, era audit (Smart, with the missing-year rows), duplicates.
2. A 50,000-song VirtualDJ database: parsing, the Health Accelerator preview, the grid-check song list.
3. 5,000 real tagged MP3 files: AXIOM's "Add Folder" tag scan.
Prints timings and peak memory. Nothing outside work/fixtures/stress is written.
"""
import os, sys, pathlib, json, time, random, uuid, shutil, ctypes, subprocess, traceback
import imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
workspace = pathlib.Path(__file__).resolve().parent
probe = workspace / 'axiom-win-probe'; home = workspace / 'probe-home'
os.environ.update({'USERPROFILE': str(home), 'HOME': str(home), 'APPDATA': str(home / 'AppData/Roaming'),
                   'LOCALAPPDATA': str(home / 'AppData/Local'), 'AXIOM_RUNTIME_DIR': str(home / 'axiom-runtime'), 'NO_PROXY': '*',
                   'AXIOM_LICENSE_REQUIRED': '0'})  # as the launcher runs AXIOM (activation off)
sys.path.insert(0, str(probe)); os.chdir(probe)
STRESS = workspace / 'fixtures' / 'stress'


def audit(event, args):  # FFmpeg only; no network; writes only inside the workspace
    if event == 'subprocess.Popen' and not os.path.normcase(str(args[1])).lstrip('"').startswith(os.path.normcase(FF)):
        raise PermissionError('Stress test blocks ' + str(args[1])[:80])
    if event in ('socket.connect', 'socket.connect_ex'):
        raise PermissionError('Stress test blocks network')
    if event == 'open' and len(args) > 1 and isinstance(args[0], (str, os.PathLike)) and isinstance(args[1], str) and any(x in args[1] for x in 'wax+'):
        if not pathlib.Path(args[0]).resolve().is_relative_to(workspace):
            raise PermissionError('Stress test blocks file write outside workspace')
sys.addaudithook(audit)


class Counters(ctypes.Structure):
    _fields_ = [('cb', ctypes.c_ulong), ('faults', ctypes.c_ulong)] + [(n, ctypes.c_size_t) for n in
               ('peak', 'ws', 'qpp', 'qp', 'qpnp', 'qnp', 'pf', 'ppf')]


_kernel = ctypes.WinDLL('kernel32')
_kernel.GetCurrentProcess.restype = ctypes.c_void_p
_kernel.K32GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(Counters), ctypes.c_ulong]


def peak_mb():
    c = Counters(cb=ctypes.sizeof(Counters))
    _kernel.K32GetProcessMemoryInfo(_kernel.GetCurrentProcess(), ctypes.byref(c), c.cb)
    return c.peak / 1024 / 1024


def timed(label, fn):
    t0 = time.perf_counter(); value = fn(); took = time.perf_counter() - t0
    print(f'  {label:<44} {took:8.2f}s   peak {peak_mb():6.0f} MB', flush=True)
    return value, took


def synthetic_tracks(template, count, rng):
    words = 'love night fever summer dance groove soul fire heart rain baby money party light dream city'.split()
    tracks = []
    for i in range(count):
        t = dict(rng.choice(template))
        artist = f'{rng.choice(words).title()} {rng.choice(words).title()} {i % 997}'
        title = f'{rng.choice(words).title()} {rng.choice(words).title()} {i}'
        t.update(path=f'Z:\\Stress\\{i // 500:03d}\\{artist} - {title}.mp3', filename=f'{artist} - {title}.mp3',
                 folder=f'{i // 500:03d}', title=title, artist=artist, bpm=round(rng.uniform(70, 140), 1),
                 year=rng.choice([None] * 3 + list(range(1965, 2026))), axiom_track_id=uuid.uuid4().hex)
        for key in list(t):
            if key.startswith(('year_research', 'year_health')):
                t.pop(key)
        tracks.append(t)
    return tracks


def main():
    STRESS.mkdir(parents=True, exist_ok=True)
    run = STRESS / ('run-' + uuid.uuid4().hex[:6]); run.mkdir()
    rng = random.Random(7)
    template = json.loads((workspace / 'fixtures' / 'health-year' / 'library_before.json').read_text(encoding='utf-8'))['tracks']
    from windows_bootstrap import build_backend
    app = build_backend(recording_settings=run / 'settings.json', recording_directory=run)
    client = app.app.test_client(); h = {'Host': '127.0.0.1', 'Origin': 'http://127.0.0.1'}
    results = {}
    for size in (10_000, 50_000):
        print(f'\n[{size:,}-song library]')
        app.CACHE_PATH = str(run / f'library_{size}.json')
        tracks = synthetic_tracks(template, size, rng)
        timed('write cache', lambda: pathlib.Path(app.CACHE_PATH).write_text(json.dumps({'tracks': tracks, 'total_tracks': size}), encoding='utf-8'))
        timed('load_cache (AXIOM)', lambda: app.load_cache(app.CACHE_PATH))
        for label, url in (('stats', '/api/library/stats'), ('search "love night"', '/api/library/search?q=love%20night'),
                           ('Health summary', '/api/library/health'),
                           ('era audit Smart (+missing-year rows)', '/api/library/era_audit?mode=smart&q=&page=0'),
                           ('duplicates', '/api/library/dupes')):
            response, took = timed(label, lambda: client.get(url, headers=h))
            ok = response.status_code < 500
            results[(size, label)] = (took, response.status_code)
            assert ok, (label, response.status_code, response.data[:300])
        era = client.get('/api/library/era_audit?mode=smart&q=&page=0', headers=h).get_json()
        print(f'  era audit rows {len(era["rows"]):,} (cap 500 added), Manual count {era["summary"].get("review"):,}')

    print('\n[50,000-song VirtualDJ database]')
    db = run / 'database.xml'
    def write_db():
        with open(db, 'w', encoding='utf-8') as f:
            f.write('<?xml version="1.0" encoding="UTF-8"?>\n<VirtualDJ_Database Version="2024">\n')
            for i, t in enumerate(tracks):
                f.write(f'<Song FilePath="{t["path"]}" FileSize="9000000"><Tags Author="{t["artist"]}" Title="{t["title"]}" Year="{t["year"] or ""}"/>'
                        f'<Infos SongLength="200.0"/><Scan Bpm="{60 / t["bpm"]:.6f}" Key="Am"/><Poi Pos="0.1" Type="beatgrid"/></Song>\n')
            f.write('</VirtualDJ_Database>\n')
    timed('write database.xml', write_db)
    print(f'  database size {db.stat().st_size / 1024 / 1024:.1f} MB')
    from windows_virtualdj_database import read_database
    inventory, _ = timed('read_database', lambda: read_database(db))
    assert len(inventory['tracks']) == 50_000
    import windows_virtualdj_health as V
    for t in tracks[:25_000]:
        t['bpm'] = None
    pathlib.Path(app.CACHE_PATH).write_text(json.dumps({'tracks': tracks, 'total_tracks': 50_000}), encoding='utf-8')
    preview, _ = timed('Health Accelerator preview (50k vs 50k)', lambda: V.pull(app, apply=False, databases=lambda: [db]))
    print(f'  matched {preview["summary"]["matched"]:,}, BPM fills {preview["summary"]["bpm"]:,}, keys {preview["summary"]["key"]:,}')
    applied, _ = timed('Health Accelerator apply', lambda: V.pull(app, apply=True, databases=lambda: [db]))
    assert applied['summary']['updated'] >= 25_000
    import windows_virtualdj_grids as G
    checker = G.VirtualDJGridCheck(app, run / 'grid.json', databases=lambda: [db])
    songs, _ = timed('grid check song list', lambda: checker.songs('full'))
    assert len(songs[0]) == 50_000

    print('\n[5,000 tagged MP3 files: Add Folder tag scan]')
    music = STRESS / 'mp3-5000'
    if not music.is_dir() or len(list(music.glob('*.mp3'))) < 5000:
        music.mkdir(parents=True, exist_ok=True)
        seed = STRESS / 'seed.mp3'
        subprocess.run([FF, '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
                        '-c:a', 'libmp3lame', '-b:a', '64k', str(seed)], check=True)
        from mutagen.easyid3 import EasyID3
        def make():
            for i in range(5000):
                target = music / f'Stress Artist {i % 400} - Song {i}.mp3'
                shutil.copyfile(seed, target)
                tags = EasyID3(); tags.update({'artist': f'Stress Artist {i % 400}', 'title': f'Song {i}', 'bpm': str(80 + i % 60), 'date': str(1970 + i % 55)})
                tags.save(target)
        timed('generate 5,000 MP3 files', make)
    app.CACHE_PATH = str(run / 'scan.json'); pathlib.Path(app.CACHE_PATH).write_text(json.dumps({'tracks': []}), encoding='utf-8')
    app.is_safe_location = lambda p: True
    result, took = timed('Add Folder scan (tags)', lambda: app._scan_and_merge_folder(str(music)))
    print('  scan result', {k: v for k, v in (result[0] if isinstance(result, tuple) else result).items() if k in ('scanned_count','added_count','total_tracks','track_limit','track_limit_applied','trimmed_tracks','access_tier')})
    scanned = json.loads(pathlib.Path(app.CACHE_PATH).read_text(encoding='utf-8'))['tracks']
    print(f'  {len(scanned):,} songs indexed, {sum(1 for t in scanned if t.get("bpm")):,} with BPM from tags, {len(scanned) / took:,.0f} songs/s')
    assert len(scanned) == 5000
    print('\nSTRESS PASS')


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        traceback.print_exc(); sys.exit(1)
