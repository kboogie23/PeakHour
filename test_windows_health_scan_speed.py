"""Health scan on a huge exFAT folder (windows_intake.FastRealpath.islink / isfile / listed_files).

Each Health save asked islink/isfile for every track: 8.6 ms a file on exFAT, 4.6 minutes per save for 18,885 files in one
folder. Now a folder asked about repeatedly is listed once (shared listing, SHARED_AFTER calls, kept SHARED_TTL seconds):
  islink: False for a plain file straight from the listing (never True from it); everything else asks Windows
  isfile: only inside listed_files() (thread-local, the Health job thread); plain file True, plain folder False
  agreement with ntpath for files, folder, link, missing names, other letter case, non-ASCII names
  staleness bounded by SHARED_TTL; work no longer scales with the number of files
  wiring in the real app (child process, temp sandbox): os.path.isfile/islink are FAST_REALPATH's, the Health job runs inside listed_files()
Fresh FastRealpath() instances with counting stubs; nothing global is patched. Nothing of the owner's is touched."""
import os, sys, json, ntpath, pathlib, shutil, tempfile, threading, time, subprocess, socket

workspace = pathlib.Path(__file__).resolve().parent
probe = workspace / 'axiom-win-probe'
sys.path.insert(0, str(probe))
import windows_intake as I

base = pathlib.Path(tempfile.mkdtemp(prefix='phhsc_'))
notes = []


def fresh(ext=True):
    """A new FastRealpath whose originals count their calls (per thread id as well).
    ext=True: '.mp3' is a listed (media) extension, as install() does from scanner.SUPPORTED_FORMATS."""
    f = I.FastRealpath()
    assert f.listed_extensions == frozenset()
    if ext:
        f.listed_extensions = frozenset({'.mp3'})
    f.calls = {'islink': [], 'isfile': []}
    real_link, real_file = ntpath.islink, ntpath.isfile

    def link(p):
        f.calls['islink'].append((threading.get_ident(), p))
        return real_link(p)

    def isf(p):
        f.calls['isfile'].append((threading.get_ident(), p))
        return real_file(p)
    f.original_islink, f.original_isfile = link, isf
    return f


def n(f):
    return len(f.calls['islink']), len(f.calls['isfile'])


try:
    music = base / 'Music'
    music.mkdir()
    N = 2000
    for i in range(N):
        (music / ('song%04d.mp3' % i)).write_bytes(b'\0')
    (music / 'sub').mkdir()
    UNI = 'Beyoncé – Déjà Vu.mp3'
    (music / UNI).write_bytes(b'\0')
    (music / 'Mixed Case.MP3').write_bytes(b'\0')
    link = music / 'link.mp3'
    try:
        os.symlink(music / 'song0000.mp3', link)
        have_link = True
        notes.append('symlink creation: possible, link tested')
    except (OSError, NotImplementedError):
        have_link = False
        notes.append('symlink creation: NOT permitted on this PC, link parts skipped')
    files = [str(music / ('song%04d.mp3' % i)) for i in range(N)]
    AFTER = I.FastRealpath.SHARED_AFTER
    assert AFTER == 3, AFTER

    # ---- 1. islink
    f = fresh()
    for p in files:
        assert f.islink(p) is False, p
    assert all(not ntpath.islink(p) for p in files[:20])
    assert n(f)[0] <= AFTER - 1 and n(f)[1] == 0, n(f)
    # the folder is listed now: the rest of the checks are against the warm listing
    if have_link:
        b = n(f)[0]
        assert f.islink(str(link)) is ntpath.islink(str(link)) is True
        assert n(f)[0] == b + 1, 'a symlink is answered by the original'
    b = n(f)[0]
    assert f.islink(str(music / 'nothere.mp3')) is False and n(f)[0] == b + 1, 'missing name -> original'
    sub = str(music / 'sub')
    assert f.islink(sub) == ntpath.islink(sub)
    dots = str(music / 'sub' / '..' / 'song0001.mp3')
    b = n(f)[0]
    assert f.islink(dots) == ntpath.islink(dots) and n(f)[0] == b + 1, 'a path with .. -> original'
    byts = os.fsencode(files[5])
    b = n(f)[0]
    assert f.islink(byts) == ntpath.islink(byts) and n(f)[0] == b + 1, 'bytes -> original'
    b = n(f)[0]
    with f.direct():
        for p in files[:10]:
            assert f.islink(p) is False
    assert n(f)[0] == b + 10, 'direct() mode: every call goes to the original'
    b = n(f)[0]
    with f.active():
        for p in files[:5] + [sub] + ([str(link)] if have_link else []):
            assert f.islink(p) == ntpath.islink(p), p
    assert n(f)[0] == b, 'active(): answered from the thread listing, as before'
    print('  islink ok: %d plain files, %d original calls' % (N, n(f)[0]))

    # ---- 2. agreement with ntpath.islink (and ntpath.isfile) on a fresh instance, warm listing
    names = [p.name for p in music.iterdir()] + ['missing%02d.mp3' % i for i in range(20)] + ['SONG0007.MP3', 'song0007.MP3', UNI.upper(), UNI.lower(), 'MIXED case.mp3']
    f = fresh()
    paths = [str(music / x) for x in names]
    for _ in range(2):
        for p in paths:
            assert f.islink(p) == ntpath.islink(p), (p, f.islink(p), ntpath.islink(p))
    # isfile with the flag on agrees too
    with f.listed_files():
        for _ in range(2):
            for p in paths:
                assert f.isfile(p) == ntpath.isfile(p), (p, f.isfile(p), ntpath.isfile(p))
    assert f.islink(str(music / UNI)) is False and f.islink(str(music / 'Mixed Case.MP3')) is False
    print('  agreement ok: %d names' % len(paths))

    # ---- 3. isfile, flag off
    f = fresh()
    for i in range(50):
        p = files[i % 5]
        assert f.isfile(p) == os.path.isfile(p) is True
    assert n(f)[1] == 50, n(f)
    assert f.isfile(str(music / 'sub')) is False and f.isfile(str(music / 'gone.mp3')) is False and n(f)[1] == 52
    print('  isfile flag off ok')

    # ---- 4. isfile, flag on
    f = fresh()
    with f.listed_files():
        for p in files:
            assert f.isfile(p) is True, p
        assert n(f)[1] <= AFTER - 1 and n(f)[0] == 0, n(f)
        b = n(f)[1]
        assert f.isfile(sub) is False and n(f)[1] == b + 1, 'a folder has no media extension -> original'
        b = n(f)[1]
        assert f.isfile(str(music / 'gone.mp3')) is False and n(f)[1] == b + 1, 'missing -> original'
        for x in ('SONG0003.MP3', 'mixed CASE.mp3', UNI, UNI.upper()):
            p = str(music / x)
            assert f.isfile(p) == ntpath.isfile(p), p
        # thread-local: another thread started now sees the flag off
        other = []

        def work():
            other.append([f.isfile(p) for p in files[:10]])
        t = threading.Thread(target=work)
        t.start()
        t.join()
        mine = threading.get_ident()
        theirs = [c for c in f.calls['isfile'] if c[0] != mine]
        assert other == [[True] * 10] and len(theirs) == 10, (other, len(theirs))
        # nested with restores
        with f.listed_files():
            pass
        b = n(f)[1]
        f.isfile(files[1])
        assert n(f)[1] == b, 'still on after the inner with'
    b = n(f)[1]
    f.isfile(files[1])
    assert n(f)[1] == b + 1 and not getattr(f.local, 'listed_files', False), 'cleared after with'
    try:
        with f.listed_files():
            raise RuntimeError('boom')
    except RuntimeError:
        pass
    b = n(f)[1]
    f.isfile(files[2])
    assert n(f)[1] == b + 1 and f.local.listed_files is False, 'cleared after an exception'
    print('  isfile flag on ok')

    # ---- 5. staleness is bounded (SHARED_TTL set to 1.0 on the instance to keep the test short)
    f = fresh()
    f.SHARED_TTL = 1.0
    victim = music / 'victim.mp3'
    victim.write_bytes(b'\0')
    with f.listed_files():
        for _ in range(AFTER + 2):
            assert f.isfile(str(victim)) is True
        victim.unlink()
        t0 = time.monotonic()
        while f.isfile(str(victim)):
            assert time.monotonic() - t0 < f.SHARED_TTL + 1.0, 'stale answer lasted longer than SHARED_TTL + 1 s'
            time.sleep(0.05)
        lag = time.monotonic() - t0
    print('  staleness ok: deleted file reported gone after %.2f s (TTL 1.0 s, set on the instance)' % lag)

    # ---- 6. speed proxy: work does not scale with the number of files
    f = fresh()
    with f.listed_files():
        for p in files:
            f.islink(p)
            f.isfile(p)
    total = sum(n(f))
    assert total <= 2 * (AFTER - 1) + 2, 'original calls for %d files: %s' % (N, n(f))
    print('  speed proxy ok: %d original calls for %d islink + %d isfile' % (total, N, N))

    # ---- 6a. extensions: only listed_extensions are answered from the listing
    f = fresh(ext=False)
    with f.listed_files():
        for p in files[:200]:
            assert f.isfile(p) is True
    assert n(f)[1] == 200, 'default empty listed_extensions: every isfile call goes to the original (%s)' % (n(f),)
    mixed = base / 'Mixed'
    mixed.mkdir()
    (mixed / 'song.mp3').write_bytes(b'\0')
    (mixed / 'SONG2.MP3').write_bytes(b'\0')
    (mixed / 'notes.txt').write_bytes(b'\0')
    (mixed / 'x.lock').write_bytes(b'\0')
    (mixed / 'folder.mp3').mkdir()
    mp = lambda x: str(mixed / x)
    f = fresh()
    with f.listed_files():
        for _ in range(AFTER + 1):  # warm the listing of this folder
            assert f.isfile(mp('song.mp3')) is True
        assert f.islink(mp('song.mp3')) is False
        b = n(f)[1]
        for x in ('song.mp3', 'SONG2.MP3', 'song3.mp3', 'Song.Mp3'):
            assert f.isfile(mp(x)) == ntpath.isfile(mp(x)), x
        assert n(f)[1] == b + 1, 'media files answered from the listing, only the missing name song3.mp3 goes to the original'
        assert f.isfile(mp('SONG2.MP3')) is True
        b = n(f)[1]
        assert f.isfile(mp('SONG2.MP3')) is True and n(f)[1] == b, 'upper-case extension is matched case-insensitively'
        for x in ('notes.txt', 'x.lock', 'noext'):
            b = n(f)[1]
            assert f.isfile(mp(x)) == ntpath.isfile(mp(x)), x
            assert n(f)[1] == b + 1, 'non-media name %s goes to the original' % x
        assert f.isfile(mp('notes.txt')) is True and f.isfile(mp('x.lock')) is True
        assert f.isfile(mp('folder.mp3')) is False and ntpath.isfile(mp('folder.mp3')) is False, 'a directory named like media is not a file'
    print('  extensions ok: empty set -> original, .txt/.lock -> original, folder.mp3 False, SONG2.MP3 case-insensitive')

    # ---- 6b. path forms Windows treats differently
    f = fresh()
    song = mp('song.mp3')
    forms = [song + '\\', song + '/', '\\\\?\\' + song.replace('\\', '/'), '\\\\?\\' + str(mixed) + '\\.\\song.mp3',
             '\\\\.\\' + song, '//?/' + song.replace('\\', '/'), '//./' + song.replace('\\', '/')]
    with f.listed_files():
        for _ in range(AFTER + 1):
            f.isfile(song)
        for text in forms:
            assert f.isfile(text) == ntpath.isfile(text), (text, f.isfile(text), ntpath.isfile(text))
            assert f.islink(text) == ntpath.islink(text), text
            assert f(text) == f.original(text), (text, f(text), f.original(text))
        assert f.isfile(song + '\\') is False
        assert f.isfile('\\\\?\\' + song.replace('\\', '/')) == ntpath.isfile('\\\\?\\' + song.replace('\\', '/'))
        b = n(f)
        f.isfile(song + '\\'); f.islink(song + '\\')
        assert n(f) == (b[0] + 1, b[1] + 1), 'trailing slash / extended prefix: original, not the listing'
    print('  path forms ok: %d odd spellings of an existing file agree with Windows' % len(forms))

    # ---- 6c. reentrancy: the realpath stub calls the patched islink/isfile/realpath for a file in the folder it resolves
    reent = base / 'Reent'
    reent.mkdir()
    for i in range(10):
        (reent / ('r%d.mp3' % i)).write_bytes(b'\0')
    rp = str(reent / 'r0.mp3')

    def reentrant(f):
        def stub(path, *a, **k):
            if os.fspath(path) == rp:
                return ntpath.realpath(path)
            seen = (f.islink(rp), f.isfile(rp), f(rp))
            with f.listed_files():
                seen += (f.isfile(rp),)
            f.reent_seen.append(seen)
            return ntpath.realpath(path)
        f.original = stub
        f.reent_seen = []
        return f

    f = reentrant(fresh())
    result = []

    def drive():
        with f.listed_files():
            for i in range(AFTER + 3):
                result.append((f(str(reent / ('r%d.mp3' % i))), f.isfile(str(reent / ('r%d.mp3' % i))), f.islink(rp)))
    t = threading.Thread(target=drive, daemon=True)
    t.start()
    t.join(timeout=10)
    assert not t.is_alive(), 'DEADLOCK: realpath calling the patched islink/isfile for its own folder never returned'
    assert len(result) == AFTER + 3 and f.reent_seen, (len(result), f.reent_seen)
    for i, (rpath, isf, isl) in enumerate(result):
        want = ntpath.realpath(str(reent / ('r%d.mp3' % i)))
        assert rpath == want and isf is True and isl is False, (i, rpath, want, isf, isl)
    assert all(s == (False, True, ntpath.realpath(rp), True) for s in f.reent_seen), f.reent_seen

    f = reentrant(fresh())
    done_threads = []

    def hammer(k):
        with f.listed_files():
            for i in range(AFTER + 4):
                assert f(str(reent / ('r%d.mp3' % ((i + k) % 10)))) == ntpath.realpath(str(reent / ('r%d.mp3' % ((i + k) % 10))))
                assert f.isfile(str(reent / ('r%d.mp3' % i))) is True
        done_threads.append(k)
    ts = [threading.Thread(target=hammer, args=(k,), daemon=True) for k in range(2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(timeout=10)
    assert not any(t.is_alive() for t in ts) and sorted(done_threads) == [0, 1], 'two threads on one folder did not both finish'
    print('  reentrancy ok: no deadlock, answers correct, two threads finish')

    # ---- 6d. two names differing only by case are never answered from the listing
    twins = base / 'Twins'
    twins.mkdir()
    (twins / 'song.mp3').write_bytes(b'\0')
    (twins / 'other.mp3').write_bytes(b'\0')
    tw = lambda x: str(twins / x)

    class FakeStat:
        st_file_attributes = 0

    class FakeEntry:
        def __init__(self, name):
            self.name = name

        def is_symlink(self):
            return False

        def is_file(self, follow_symlinks=True):
            return True

        def stat(self, follow_symlinks=True):
            return FakeStat()

    class FakeScan:
        def __init__(self, names):
            self.names = names

        def __enter__(self):
            return iter([FakeEntry(x) for x in self.names])

        def __exit__(self, *a):
            return False
    f = fresh()
    real_scandir = os.scandir
    with f.listed_files():
        f.isfile(tw('other.mp3')); f.isfile(tw('other.mp3'))  # hits 1, 2: Windows
        try:
            os.scandir = lambda folder: FakeScan(['Song.mp3', 'song.mp3', 'other.mp3'])  # the 3rd call lists, single-threaded
            f.isfile(tw('other.mp3'))
        finally:
            os.scandir = real_scandir
        assert os.scandir is real_scandir
        b = n(f)
        for x in ('Song.mp3', 'song.mp3', 'SONG.MP3'):
            assert f.isfile(tw(x)) == ntpath.isfile(tw(x)), x
            assert f.islink(tw(x)) == ntpath.islink(tw(x)), x
        assert n(f) == (b[0] + 3, b[1] + 3), 'case twins: all six calls go to the original (%s -> %s)' % (b, n(f))
        b = n(f)
        assert f.isfile(tw('other.mp3')) is True and f.islink(tw('other.mp3')) is False and n(f) == b, 'a non-twin name is still answered from the listing'
    print('  case twins ok: lookups of a twin name fall back to Windows')

    # ---- 6e. windows_posix.is_link: Windows' own islink (never the listing) or a junction
    import windows_posix
    F = I.FAST_REALPATH
    saved = F.original_islink
    counted = []

    def counting_islink(p):
        counted.append(p)
        return ntpath.islink(p)
    F.original_islink = counting_islink
    junction = None
    try:
        for _ in range(AFTER + 2):  # warm the global instance's shared listing for the Music folder
            F.islink(files[3])
        del counted[:]
        assert windows_posix.is_link(files[3]) is False and counted == [files[3]], counted
        assert windows_posix.is_link(files[3]) is False and len(counted) == 2
        target = base / 'JTarget'
        target.mkdir()
        junction = base / 'jlink'
        made = subprocess.run(['cmd', '/c', 'mklink', '/J', str(junction), str(target)], capture_output=True, text=True, timeout=30)
        if made.returncode == 0 and junction.exists() and hasattr(os.path, 'isjunction'):
            assert windows_posix.is_link(str(junction)) is True
            assert ntpath.islink(str(junction)) is False
            notes.append('junction creation: possible, is_link(junction) True')
        else:
            junction = None
            notes.append('junction creation: not possible here (%s), junction part skipped' % (made.stderr or made.stdout).strip()[:80])
    finally:
        F.original_islink = saved
        if junction is not None and os.path.lexists(str(junction)):
            os.rmdir(str(junction))
    print('  is_link ok: plain file asks the original islink once, answers False; junction True')
finally:
    shutil.rmtree(base, ignore_errors=True)

# ---- 7. wiring in the real app, in a child process
CHILD = r'''
import os, sys, json, pathlib, threading
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[3])
os.environ.update(LOCALAPPDATA=str(sb / 'local'), USERPROFILE=str(sb / 'home'), APPDATA=str(sb / 'roaming'),
                  AXIOM_RUNTIME_DIR=str(sb / 'runtime'), AXIOM_LICENSE_REQUIRED='0', AXIOM_NO_OPEN='1', PYTHONDONTWRITEBYTECODE='1')
os.environ.pop('AXIOM_DEVICE_ID', None)
sys.path.insert(0, sys.argv[2]); os.chdir(sys.argv[2])
import axiom_windows_launcher as L
import windows_intake as W
L.data_root = lambda: sb / 'runtime'
backend = L.build_app(port)
out = {}
F = W.FAST_REALPATH
out['isfile_bound'] = getattr(os.path.isfile, '__self__', None) is F
out['islink_bound'] = getattr(os.path.islink, '__self__', None) is F
out['realpath_is_fast'] = os.path.realpath is F
job = backend._run_unified_health_job
out['job_module'] = job.__module__
out['job_qualname'] = job.__qualname__
# run the wrapper with a spy in place of the real job: the flag is on inside, off outside
cell = [c for c in job.__closure__ if callable(c.cell_contents)][0]
real = cell.cell_contents
seen = []
cell.cell_contents = lambda *a, **k: seen.append((getattr(F.local, 'listed_files', False), a, k)) or 'done'
try:
    out['wrapper_result'] = job(1, x=2)
finally:
    cell.cell_contents = real
out['flag_inside'] = seen[0][0] if seen else None
out['args_passed'] = bool(seen) and seen[0][1] == (1,) and seen[0][2] == {'x': 2}
out['flag_after'] = getattr(F.local, 'listed_files', False)
# a second install: no recursion, the originals stay the C-level builtins
before = (F.original_isfile, F.original_islink, F.original)
W.install(backend)
out['same_after_second'] = before == (F.original_isfile, F.original_islink, F.original)
out['orig_isfile_not_wrapper'] = F.original_isfile is not F.isfile and getattr(F.original_isfile, '__self__', None) is not F
out['orig_islink_not_wrapper'] = F.original_islink is not F.islink and getattr(F.original_islink, '__self__', None) is not F
# force the install body to run again (flag reset): the patch lines must still not wrap themselves
backend._windows_intake_installed = False
try:
    W.install(backend)
except Exception as e:
    out['forced_install_error'] = type(e).__name__
out['orig_isfile_after_forced'] = getattr(F.original_isfile, '__self__', None) is not F and F.original_isfile is not F.isfile
out['orig_islink_after_forced'] = getattr(F.original_islink, '__self__', None) is not F and F.original_islink is not F.islink
out['orig_isfile_name'] = getattr(F.original_isfile, '__qualname__', repr(F.original_isfile))
out['ext_mp3'] = '.mp3' in F.listed_extensions
out['ext_video'] = all(e in F.listed_extensions for e in ('.mp4', '.mpg'))
out['ext_sample'] = sorted(F.listed_extensions)[:40]
me = sys.argv[4]
out['isfile_self'] = os.path.isfile(me) is True
out['isfile_dir'] = os.path.isfile(str(sb)) is False
out['islink_file'] = os.path.islink(me) is False
print('RESULT ' + json.dumps(out))
'''

with socket.socket() as s:
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
assert port != 8080
sb = pathlib.Path(tempfile.mkdtemp(prefix='phhsw_'))
try:
    for d in ('local', 'home', 'roaming', 'runtime'):
        (sb / d).mkdir()
    python = workspace / 'axiom-win-env' / 'Scripts' / 'python.exe'
    done = subprocess.run([str(python), '-I', '-c', CHILD, str(sb), str(probe), str(port), str(workspace / 'axiom-win-probe' / 'windows_intake.py')], capture_output=True, text=True,
                          timeout=180, cwd=str(probe))
    lines = [l for l in done.stdout.splitlines() if l.startswith('RESULT ')]
    assert done.returncode == 0 and lines, (done.stdout[-1500:], done.stderr[-3000:])
    out = json.loads(lines[-1][7:])
finally:
    shutil.rmtree(sb, ignore_errors=True)
print('  wiring:', json.dumps(out))
assert out['isfile_bound'] and out['islink_bound'] and out['realpath_is_fast'], out
assert out['job_module'] == 'windows_intake' and 'run_unified_health_job' in out['job_qualname'], out
assert out['wrapper_result'] == 'done' and out['flag_inside'] is True and out['args_passed'] and out['flag_after'] is False, out
assert out['same_after_second'] and out['orig_isfile_not_wrapper'] and out['orig_islink_not_wrapper'], out
assert out['orig_isfile_after_forced'] and out['orig_islink_after_forced'], out
assert out['ext_mp3'] and out['ext_video'], out
assert out['isfile_self'] and out['isfile_dir'] and out['islink_file'], out

for line in notes:
    print('  ' + line)
print('PASS: Health scan islink/isfile answer from one folder listing (media extensions only, no reentrancy deadlock, odd path forms and case twins left to Windows) with the same answers as Windows, bounded staleness, work independent of file count, is_link uses Windows, wired into the real app')
