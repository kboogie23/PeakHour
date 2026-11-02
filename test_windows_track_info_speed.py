"""Track Information and the Performance live poll answer the same, faster (windows_track_info.py,
windows_virtualdj_live.py, windows_intake.FastRealpath.direct).

Sandbox: temp LOCALAPPDATA / USERPROFILE / AXIOM_RUNTIME_DIR, a small library of real files plus tracks on a drive
that is not connected and files missing on a connected drive, run in a child process through the real AXIOM core.
  /api/library/track gives byte-identical JSON with and without the speed-up (existing, missing drive, missing
    file on an existing drive, different case, not in the library)
  the library is read once and every track's path resolved once for repeated opens
  a library write (any AXIOM save changes size/mtime) is seen by the next open; so is a track added
  a drive appearing or leaving makes every path resolve again
  source_connected is checked on the file at every open (move the file away -> False at once, no cache involved)
  a track limit (access policy) never uses the shortcut
and the live poll: process checks shared for a moment inside a poll only, history file parsed once per change,
the poll never lists a 20,000-file folder."""
import os, sys, json, time, pathlib, tempfile, subprocess
BS = chr(92)

root = pathlib.Path(__file__).resolve().parent
python = root / 'axiom-win-env' / 'Scripts' / 'python.exe'
probe = root / 'axiom-win-probe'
CHILD = (root / 'track_info_speed_child.py').read_text(encoding='utf-8')


def make_library(sandbox):
    music = sandbox / 'Music'
    music.mkdir(parents=True)
    tracks = []

    def add(path, i):
        tracks.append({'path': str(path), 'filename': os.path.basename(str(path)), 'folder': 'Music', 'title': 'Song %d' % i,
                       'artist': 'Artist', 'bpm': 120.0 + i, 'camelot': '8A', 'file_size': 10, 'source': 'virtualdj_database'})
    for i in range(12):
        path = music / ('song%02d.mp3' % i)
        path.write_bytes(bytes(10))
        add(path, i)
    for i in range(12, 16):  # tracks whose files are gone from a connected drive
        add(music / ('gone%02d.mp3' % i), i)
    letter = next(c for c in 'QRSTUVWXY' if not os.path.exists(c + ':' + BS))
    for i in range(16, 22):  # a drive that is not connected
        add(pathlib.PureWindowsPath(letter + ':' + BS + 'Gigs' + BS + 'song%02d.mp3' % i), i)
    paths = [str(music / 'song00.mp3'), str(music / 'song05.mp3'), str(music / 'gone13.mp3'), letter + ':' + BS + 'Gigs' + BS + 'song17.mp3',
             letter + ':' + BS + 'Gigs' + BS + 'song20.mp3', str(music / 'SONG03.MP3'), str(music / 'not_in_library.mp3')]
    data_dir = sandbox / 'AppData' / 'Local' / 'AXIOM DJ' / 'data'
    data_dir.mkdir(parents=True)
    (data_dir / 'library_cache.json').write_text(json.dumps({'tracks': tracks, 'total_tracks': len(tracks)}), encoding='utf-8')
    return paths


with tempfile.TemporaryDirectory(prefix='phti') as base:
    sandbox = pathlib.Path(base)
    paths = make_library(sandbox)
    done = subprocess.run([str(python), '-I', '-c', CHILD, str(sandbox), str(probe), json.dumps(paths)],
                          capture_output=True, text=True, timeout=300, cwd=str(probe))
    lines = [l for l in done.stdout.splitlines() if l.startswith('RESULT ')]
    assert done.returncode == 0 and lines, (done.stdout[-1500:], done.stderr[-3000:])
    out = json.loads(lines[-1][7:])
    print('  ', json.dumps(out))
    assert all(out['identical'].values()), out['identical']
    assert out['status'][:6] == [200] * 6, out['status']  # existing, missing file, missing drive x2, other case
    assert out['connected'][:5] == [True, True, False, False, False], out['connected']
    assert out['extra_loads'] == 0 and out['extra_canonical'] <= 6, out  # only each request's own path is resolved live
    assert out['live_after_move'] is False and out['live_after_restore'] is True, out
    assert out['new_before_write'] == 404 and out['new_after_write'] == [200, 'Brand New'] and out['loads_after_write'] == 1, out
    assert out['new_matches_original'] is True, out
    assert out['same_drives_resolved'] == 0 and out['drive_change_resolved'] > 5, out
    assert out['limit_used_core'] is True and out['other_route_is_core'] is True, out
    assert out['kept_when_used'] is True and 95 < out['rearmed_for'] < 105 and out['released_after_idle'] is True, out
    assert out['other_caller_not_blocked'] is True, out
print('PASS: /api/library/track is identical with the speed-up; library read once, invalidated by a write or a drive change')

# ---------------------------------------------------------------- live poll
sys.path.insert(0, str(probe))
import windows_virtualdj_live as live
import windows_djay
import windows_intake
import windows_serato_processes

# process checks: shared inside a poll, fresh outside it
listed = []
clock = [100.0]
fake = lambda: listed.append(1) or [(1, 'C:' + BS + 'x' + BS + 'VirtualDJ.exe'), (2, 'C:' + BS + 'x' + BS + 'other.exe')]
real_snapshot = lambda *names, snapshot=fake: windows_djay.process_snapshot(*names, snapshot=snapshot)
polls = live.PollSnapshots(ttl=1.5, clock=lambda: clock[0])
snap = polls.wrap(real_snapshot)
windows_serato_processes.snapshot_processes, saved_lister = fake, windows_serato_processes.snapshot_processes
try:
    for _ in range(3):
        snap('VirtualDJ')
    assert len(listed) == 3, 'outside a poll every check lists the processes'
    del listed[:]

    @polls.scope
    def one_poll():
        return [snap('Serato DJ Pro', 'Serato DJ'), snap('VirtualDJ'), snap('djay Pro', 'djay'), snap('VirtualDJ')]

    first = one_poll()
    assert len(listed) == 1, listed  # one process list serves all four asks
    assert [r['running'] for r in first] == [False, True, False, True], first
    clock[0] += 1.0
    one_poll()
    assert len(listed) == 1, 'kept for the ttl'
    clock[0] += 1.0
    one_poll()
    assert len(listed) == 2, 'listed again once the ttl passed'
    first[1]['pids'].append(99)
    assert one_poll()[1]['pids'] == [1], 'callers get copies'

    # fail closed as before: an unreadable process list is reported as running and nothing is kept
    def boom():
        raise windows_serato_processes.ProcessInspectionError('x')
    windows_serato_processes.snapshot_processes = boom
    clock[0] += 5.0
    answer = one_poll()[1]
    assert answer['running'] is True and answer['token'] == 'unverifiable', answer
finally:
    windows_serato_processes.snapshot_processes = saved_lister
print('PASS: the poll lists processes once per ttl, never outside a poll, fails closed')

# history parsed once per change
with tempfile.TemporaryDirectory(prefix='phth') as base:
    history = pathlib.Path(base) / 'h.m3u'
    history.write_text('#EXTVDJ:<artist>A</artist><title>T</title><lastplaytime>5</lastplaytime>' + chr(10) + 'D:' + BS + 'a.mp3' + chr(10), encoding='utf-8')
    real_parse, parses = live.parse_history, []
    live.parse_history = lambda p: parses.append(p) or real_parse(p)
    try:
        for _ in range(10):
            entries = live.parse_history_cached(history)
        assert len(parses) == 1 and entries[0]['title'] == 'T', parses
        time.sleep(0.05)
        history.write_text(history.read_text(encoding='utf-8') + '#EXTVDJ:<artist>B</artist><title>U</title>' + chr(10) + 'D:' + BS + 'b.mp3' + chr(10), encoding='utf-8')
        assert [e['title'] for e in live.parse_history_cached(history)] == ['T', 'U'] and len(parses) == 2
    finally:
        live.parse_history = real_parse
print('PASS: a history file is parsed once per change')

# the poll's real-path lookups do not list the folder
with tempfile.TemporaryDirectory(prefix='phrp') as base:
    folder = pathlib.Path(base) / 'many'
    folder.mkdir()
    for i in range(30):
        (folder / ('f%02d.mp4' % i)).write_bytes(b'x')
    resolver = windows_intake.FastRealpath()
    listings = []
    scandir = os.scandir
    os.scandir = lambda *a, **k: listings.append(a) or scandir(*a, **k)
    try:
        with resolver.direct():
            for _ in range(10):
                assert resolver(str(folder / 'f01.mp4')).lower() == str(folder / 'f01.mp4').lower()
        assert not listings, 'direct mode never lists a folder'
        for _ in range(10):
            resolver(str(folder / 'f01.mp4'))
        assert listings, 'outside direct mode the shared listing is used'
        del listings[:]
        resolver.shared.clear()
        with resolver.direct():
            with resolver.direct(False):
                for _ in range(10):
                    resolver(str(folder / 'f01.mp4'))
        assert listings, 'direct(False) keeps the shared listing for bulk work'
    finally:
        os.scandir = scandir
print('PASS: the poll resolves the playing file with Windows realpath, bulk work keeps the shared listing')
