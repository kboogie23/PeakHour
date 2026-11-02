"""Tests for --real mode on a throw-away copy structure (never the owner's data):
  axiom-win-env\\Scripts\\python.exe feature_check\\test_real_mode.py
Covers: backup / modify / create / delete / restore / verify; a user's own file created during the run is NOT removed;
removed files go to quarantine; stray SQLite side files; the runner killed mid-run and a late --restore (asks / refuses,
keeps the version it overwrites); DJ programs started during the run (no automatic restore); an interrupted backup;
--abandon; pruning; and the guard's real-data rules (created files recorded, music files, backups, utime, network)."""
import io
import os
import sys
import json
import time
import shutil
import pathlib
import tempfile
import subprocess

PROJECT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))
from feature_check import real_mode, sandbox as sb  # noqa: E402

real_mode.drive_roots = lambda: []  # the test must not look at the real drives
real_mode.running_blockers = lambda: []
QUIET = lambda *_: None  # noqa: E731


def build(root):
    local, home = root / 'L', root / 'U'
    files = {
        local / 'AXIOM DJ' / 'data' / 'library_cache.json': b'{"tracks":[1,2,3]}' * 1000,
        local / 'AXIOM DJ' / 'data' / 'library_cache.json.bak.1': b'old backup',
        local / 'AXIOM DJ' / 'hub.json': b'{}',
        local / 'AXIOM DJ' / 'Logs' / 'launch.log': b'log line\n',
        local / 'VirtualDJ' / 'database.xml': b'<VirtualDJ_Database/>',
        local / 'VirtualDJ' / 'settings.xml': b'<s/>',
        local / 'VirtualDJ' / 'MyLists' / 'a.vdjfolder': b'<list/>',
        local / 'VirtualDJ' / 'History' / '2026-11-01.m3u': b'#EXTVDJ',
        local / 'VirtualDJ' / 'license.dat': b'lic',
        home / 'Music' / '_Serato_' / 'database V2': b'\x00\x01' * 5000,
        home / 'Music' / '_Serato_' / 'Library' / 'location.sqlite': b'SQLite format 3' * 50,
        home / 'Music' / '_Serato_' / 'Subcrates' / 'a.crate': b'crate',
        home / 'Music' / '_Serato_' / 'History' / 'h.session': b'hist',
        home / 'Music' / 'djay' / 'djay Media Library' / 'MediaLibrary.db': b'SQLite format 3' * 100,
        home / 'Music' / 'djay' / 'djay Media Library' / 'MediaLibrary.db-wal': b'wal',
        home / 'Desktop' / 'old.txt': b'mine',
        home / 'Music' / 'AXIOM DJ' / 'Recordings' / 'r.wav': b'RIFF',
        home / 'Documents' / 'd.txt': b'doc',
    }
    for path, data in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        old = time.time() - 3600  # the owner's files are older than any run
        os.utime(path, (old, old))
    return {'LOCALAPPDATA': str(local), 'USERPROFILE': str(home)}, files


def everything(root):
    out, dirs = {}, set()
    for dirpath, dirnames, filenames in os.walk(root):
        dirs.update(os.path.join(dirpath, d) for d in dirnames)
        for name in filenames:
            path = os.path.join(dirpath, name)
            out[path] = (real_mode.sha256(path), os.stat(path).st_mtime_ns)
    return out, dirs


def record(log, kind, path):
    """What guard.py writes when it allows a create."""
    with open(log, 'a', encoding='utf-8') as handle:
        handle.write(json.dumps({'t': time.time(), 'pid': 1, 'kind': kind, 'detail': str(path), 'blocked': False}) + '\n')


def mutate(env, log):
    """Modify, delete and create like a run would; creates are recorded in the guard log like the guard does."""
    local, home = pathlib.Path(env['LOCALAPPDATA']), pathlib.Path(env['USERPROFILE'])
    (local / 'AXIOM DJ' / 'data' / 'library_cache.json').write_bytes(b'{"tracks":[]}')  # modified
    (local / 'VirtualDJ' / 'database.xml').unlink()  # deleted
    (home / 'Music' / 'djay' / 'djay Media Library' / 'MediaLibrary.db-wal').write_bytes(b'changed wal')
    made = [local / 'AXIOM DJ' / 'data' / 'new.lock', local / 'AXIOM DJ' / 'newdir' / 'x.json',
            home / 'Music' / '_Serato_' / 'Subcrates' / 'new.crate', home / 'Desktop' / 'report.txt',
            home / 'Music' / 'AXIOM DJ' / 'Recordings' / 'new.wav', home / 'Music' / 'AXIOM DJ' / 'Exports' / 'e.m3u',
            local / 'VirtualDJ' / 'MyLists' / 'created.vdjfolder']
    for path in made:
        for parent in reversed(list(path.parents)):
            if str(parent).startswith(str(local)) or str(parent).startswith(str(home)):
                if not parent.exists() and parent.name in ('newdir', 'Exports'):
                    parent.mkdir()
                    record(log, 'created-dir', parent)
        path.write_bytes(b'new')
        record(log, 'created', path)
    # stray SQLite side files nobody backed up (a database that was opened during the run)
    (home / 'Music' / '_Serato_' / 'Library' / 'location.sqlite-wal').write_bytes(b'stray wal')
    (home / 'Music' / 'djay' / 'djay Media Library' / 'MediaLibrary.db-journal').write_bytes(b'stray journal')
    return made


def check(cond, message):
    print(('ok    ' if cond else 'FAIL  ') + message)
    if not cond:
        check.failed += 1


check.failed = 0


def main():
    work = PROJECT / 'fixtures' / 'feature-check' / ('rmtest-' + time.strftime('%H%M%S'))
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    ext = pathlib.Path(tempfile.mkdtemp(prefix='fcreal'))  # outside fixtures\feature-check, which the guard always allows
    import check_features
    try:
        # 1. a normal run
        data = work / 'data1'
        env, files = build(data)
        before, dirs_before = everything(data)
        bs = real_mode.BackupSet.create(real_mode.plan(env), time.time() - 1, stamp='t1', base=work / 'backups', log=QUIET)
        n_files = len(bs.manifest['files'])
        check(n_files == 13, 'backup holds %d files (13 expected: Logs, license.dat, Desktop, Documents, Recordings only watched)' % n_files)
        check(bs.state['state'] == 'running' and not (bs.folder / 'quarantine').exists(), 'state is running')
        bs.start_heartbeat(0.2)
        made = mutate(env, bs.guard_log)
        home = pathlib.Path(env['USERPROFILE'])
        mine = [home / 'Documents' / 'download.pdf', home / 'Desktop' / 'user_note.txt']  # the owner's own files, made meanwhile
        for f in mine:
            f.write_bytes(b'precious')
        late = home / 'Desktop' / 'late_export.txt'  # recorded as created, but written after the run's last activity
        late.write_bytes(b'x')
        record(bs.guard_log, 'created', late)
        os.utime(late, (time.time() + 300, time.time() + 300))
        changes = {(c['kind'], pathlib.Path(c['path']).name) for c in bs.changes()}
        for want in (('modified', 'library_cache.json'), ('deleted', 'database.xml'), ('modified', 'MediaLibrary.db-wal'), ('created', 'new.lock'),
                     ('created', 'report.txt'), ('created', 'created.vdjfolder')):
            check(want in changes, 'changes() reports %s %s' % want)
        check(('created', 'download.pdf') not in changes, "changes() does not claim the owner's own download.pdf")
        time.sleep(0.5)
        result, _ = check_features.finalize_data(bs, lambda: None)
        after, dirs_after = everything(data)
        extras = {str(p) for p in mine} | {str(late)}
        check(not result['mismatches'] and not result['refused'], 'verify clean: %s' % (result['mismatches'] or result['refused']))
        check({k: v[0] for k, v in after.items() if k not in extras} == {k: v[0] for k, v in before.items()}, 'every backed-up file is byte-for-byte as before; recorded creates and stray side files are gone')
        check(all(pathlib.Path(p).read_bytes() == b'precious' for p in mine), "the owner's own files created during the run were NOT removed")
        check(late.exists() and str(late) in result['left_behind'], 'a recorded file newer than the run was left behind and reported')
        check(dirs_after == dirs_before, 'folders the run created are gone (%s)' % sorted(dirs_after - dirs_before))
        index = json.loads((bs.quarantine_dir / 'index.json').read_text(encoding='utf-8'))
        moved = {pathlib.Path(i['from']).name for i in index}
        check({'new.lock', 'x.json', 'new.crate', 'report.txt', 'new.wav', 'e.m3u', 'created.vdjfolder'} <= moved, 'removed files are in quarantine, not deleted: %s' % sorted(moved))
        check({'location.sqlite-wal', 'MediaLibrary.db-journal'} <= moved, 'stray -wal and -journal were quarantined')
        check(all((bs.quarantine_dir / i['name']).is_file() for i in index), 'every quarantine entry exists on disk')
        check(all(after[k][1] == before[k][1] for k in before), 'modification times restored')
        check(bs.state['state'] == 'restored', 'state is restored')
        bs.stop_heartbeat()

        # 2. the runner is killed mid-run; a late --restore
        data = work / 'data2'
        env2, _ = build(data)
        before, dirs_before = everything(data)
        child_code = ("import sys,time,json,runpy;sys.path.insert(0,%r);from feature_check import real_mode;real_mode.drive_roots=lambda:[];"
                      "env=json.loads(sys.argv[1]);bs=real_mode.BackupSet.create(real_mode.plan(env),time.time(),stamp='t2',base=sys.argv[2],log=lambda *a:None);"
                      "bs.start_heartbeat(0.2);m=runpy.run_path(%r);m['mutate'](env,bs.guard_log);print('MUTATED',flush=True);time.sleep(600)"
                      % (str(PROJECT), str(pathlib.Path(__file__))))
        child = subprocess.Popen([sys.executable, '-c', child_code, json.dumps(env2), str(work / 'backups')], stdout=subprocess.PIPE, text=True)
        line = child.stdout.readline()
        check('MUTATED' in line, 'child backed up, kept a heartbeat and modified the data')
        time.sleep(0.6)
        subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'], capture_output=True)
        folder = work / 'backups' / 'real-backup-t2'
        state = json.loads((folder / 'state.json').read_text(encoding='utf-8'))
        check(state['state'] == 'running' and state['last_activity'] > state['run_start'], 'a killed run leaves state running with a last_activity heartbeat')
        pending = real_mode.unfinished_backups(work / 'backups')
        check(any(f.name == 'real-backup-t2' and s == 'running' for f, s in pending), 'the killed set is reported as unfinished (next --real is refused)')
        home2 = pathlib.Path(env2['USERPROFILE'])
        later_user = home2 / 'Documents' / 'written_days_later.txt'
        later_user.write_bytes(b'days later')
        cache2 = pathlib.Path(env2['LOCALAPPDATA']) / 'AXIOM DJ' / 'data' / 'library_cache.json'
        cache2.write_bytes(b'the owner edited this after the crash')  # a backed-up file changed after the run ended
        os.utime(cache2, (time.time() + 120, time.time() + 120))
        old_stdin = sys.stdin
        sys.stdin = io.StringIO('')  # not a terminal
        try:
            code = check_features.do_restore(str(folder))
        finally:
            sys.stdin = old_stdin
        check(code == 2 and cache2.read_bytes() == b'the owner edited this after the crash', 'non-interactive late --restore refuses and changes nothing')
        check(not (folder / 'quarantine').exists() and json.loads((folder / 'state.json').read_text())['state'] == 'running', 'refusal leaves the set open')
        code = check_features.do_restore(str(folder), confirm=lambda late: False)
        check(code == 2 and cache2.read_bytes() == b'the owner edited this after the crash', 'answering N refuses and changes nothing')
        asked = []
        code = check_features.do_restore(str(folder), confirm=lambda late: asked.append(late) or True)
        after, dirs_after = everything(data)
        check(len(asked) == 1 and any(p.endswith('library_cache.json') and '-' in when for p, when in asked[0]), 'the changed file was listed with its date before asking')
        check(code == 0, '--restore after confirmation: exit code 0')
        extras = {str(later_user)}
        check({k: v[0] for k, v in after.items() if k not in extras} == {k: v[0] for k, v in before.items()}, '--restore after a kill: every backed-up file identical, recorded creates quarantined')
        check(later_user.read_bytes() == b'days later', 'a file written days later (not recorded by the run) is untouched')
        kept = [p for p in (folder / 'quarantine').iterdir() if 'overwritten' in p.name and p.read_bytes() == b'the owner edited this after the crash']
        check(kept, 'the version that was overwritten is kept in quarantine')

        # 3. DJ programs started during the run: no automatic restore
        data = work / 'data3'
        env3, _ = build(data)
        bs3 = real_mode.BackupSet.create(real_mode.plan(env3), time.time(), stamp='t3', base=work / 'backups', log=QUIET)
        mutate(env3, bs3.guard_log)
        real_mode.running_blockers = lambda: ['VirtualDJ is running']
        try:
            result, _ = check_features.finalize_data(bs3, lambda: None)
        finally:
            real_mode.running_blockers = lambda: []
        cache3 = pathlib.Path(env3['LOCALAPPDATA']) / 'AXIOM DJ' / 'data' / 'library_cache.json'
        check(result['refused'] and 'VirtualDJ is running' in result['refused'][0], 'a DJ program running at the end blocks the automatic restore: %s' % result['refused'][:1])
        check(cache3.read_bytes() == b'{"tracks":[]}' and bs3.state['state'] == 'running', 'nothing was restored and the set stays running')
        check(check_features.do_restore(str(bs3.folder)) == 0 and bs3.load(bs3.folder).state['state'] == 'restored', 'once the program is closed, --restore works')

        # 3b. VirtualDJ was opened during the run, saved its database and was closed again: the restore overwrites, but keeps that version
        data = work / 'data3b'
        env3b, _ = build(data)
        bs3b = real_mode.BackupSet.create(real_mode.plan(env3b), time.time(), stamp='t3b', base=work / 'backups', log=QUIET)
        bs3b.start_heartbeat(0.2)
        bs3b.progress()
        vdj_db = pathlib.Path(env3b['LOCALAPPDATA']) / 'VirtualDJ' / 'database.xml'
        vdj_db.write_bytes(b'<VirtualDJ_Database>saved by VirtualDJ during the run</VirtualDJ_Database>')
        time.sleep(0.5)
        result, _ = check_features.finalize_data(bs3b, lambda: None)
        check(not result['refused'] and not result['mismatches'] and vdj_db.read_bytes() == b'<VirtualDJ_Database/>', 'the DJ database is back as it was')
        saved = [i for i in json.loads((bs3b.quarantine_dir / 'index.json').read_text(encoding='utf-8')) if i['from'] == str(vdj_db)]
        check(saved and (bs3b.quarantine_dir / saved[0]['name']).read_bytes().startswith(b'<VirtualDJ_Database>saved by VirtualDJ')
              and 'during the run' in saved[0]['why'], 'the changed database.xml is kept in quarantine (%s)' % (saved[0]['why'] if saved else 'missing'))
        # a hung run does not keep last_activity advancing, so the late-change check still means something
        data = work / 'data3c'
        env3c, _ = build(data)
        bs3c = real_mode.BackupSet.create(real_mode.plan(env3c), time.time(), stamp='t3c', base=work / 'backups', log=QUIET)
        real_mode.WATCHDOG = 0.5
        bs3c.start_heartbeat(0.2)
        time.sleep(1.5)  # no progress for longer than the watchdog: the thread stops touching
        frozen = json.loads((bs3c.folder / 'state.json').read_text())['last_activity']
        time.sleep(0.8)
        check(json.loads((bs3c.folder / 'state.json').read_text())['last_activity'] == frozen, 'a hung run: the heartbeat thread stops advancing last_activity')
        real_mode.WATCHDOG = 600.0
        bs3c.progress()
        check(json.loads((bs3c.folder / 'state.json').read_text())['last_activity'] > frozen, 'main-thread progress moves last_activity')
        bs3c.stop_heartbeat()
        db_late = pathlib.Path(env3c['LOCALAPPDATA']) / 'VirtualDJ' / 'database.xml'
        db_late.write_bytes(b'saved after the run')
        os.utime(db_late, (time.time() + 60, time.time() + 60))
        result, _ = check_features.finalize_data(bs3c, lambda: None)
        check(result['refused'] and result['restored'] == [] and db_late.read_bytes() == b'saved after the run',
              'a database changed after the last activity is NOT overwritten by the automatic restore (it asks instead)')

        # 4. --abandon closes a set without restoring
        data = work / 'data4'
        env4, _ = build(data)
        bs4 = real_mode.BackupSet.create(real_mode.plan(env4), time.time(), stamp='t4', base=work / 'backups', log=QUIET)
        mutate(env4, bs4.guard_log)
        check(check_features.do_abandon(str(bs4.folder)) == 0 and json.loads((bs4.folder / 'state.json').read_text())['state'] == 'abandoned', '--abandon closes the set')
        check((pathlib.Path(env4['LOCALAPPDATA']) / 'AXIOM DJ' / 'data' / 'library_cache.json').read_bytes() == b'{"tracks":[]}', '--abandon restores nothing')
        check(not any(f.name == 'real-backup-t4' for f, _ in real_mode.unfinished_backups(work / 'backups')), 'an abandoned set no longer blocks a new run')

        # 5. an interrupted backup leaves nothing that blocks later runs
        data = work / 'data5'
        env5, _ = build(data)
        real_sha, calls = real_mode.sha256, []

        def flaky_sha(path):
            calls.append(path)
            if len(calls) == 4:
                raise KeyboardInterrupt()
            return real_sha(path)
        real_mode.sha256 = flaky_sha
        try:
            try:
                real_mode.BackupSet.create(real_mode.plan(env5), time.time(), stamp='t5', base=work / 'backups', log=QUIET)
                check(False, 'create should have been interrupted')
            except KeyboardInterrupt:
                pass
        finally:
            real_mode.sha256 = real_sha
        check(not (work / 'backups' / 'real-backup-t5').exists(), 'an interrupted backup deletes its half-made folder (nothing was touched yet)')
        half = work / 'backups' / 'real-backup-t5b'
        (half / 'files').mkdir(parents=True)
        (half / 'state.json').write_text(json.dumps({'state': 'backing-up'}))
        check(not any(f.name == 'real-backup-t5b' for f, _ in real_mode.unfinished_backups(work / 'backups')) and not half.exists(), 'a killed backup (state backing-up, no manifest) is cleaned up, not reported as blocking')
        bare = work / 'backups' / 'real-backup-t5c'
        bare.mkdir()
        os.utime(bare, (time.time() - 3600, time.time() - 3600))
        check(not any(f.name == 'real-backup-t5c' for f, _ in real_mode.unfinished_backups(work / 'backups')) and not bare.exists(), 'an old empty manifest-less folder is cleaned up')
        # two runs at once: a set whose copying process is still alive is not ours to delete
        live = work / 'backups' / 'real-backup-t5d'
        (live / 'files').mkdir(parents=True)
        (live / 'state.json').write_text(json.dumps({'state': 'backing-up', 'pid': os.getpid()}))
        pending = real_mode.unfinished_backups(work / 'backups')
        check(live.exists() and any(f.name == 'real-backup-t5d' for f, _ in pending), 'a set still being copied by a live process is kept and blocks a second run')
        dead = work / 'backups' / 'real-backup-t5e'
        (dead / 'files').mkdir(parents=True)
        (dead / 'state.json').write_text(json.dumps({'state': 'backing-up', 'pid': 99999999}))
        real_mode.unfinished_backups(work / 'backups')
        check(not dead.exists(), 'a backing-up set whose process is gone is cleaned up')
        shutil.rmtree(live, ignore_errors=True)

        # 6. corrupted backup copy: verify fails, the set is kept and never pruned
        data = work / 'data6'
        env6, _ = build(data)
        bs6 = real_mode.BackupSet.create(real_mode.plan(env6), time.time(), stamp='t6', base=work / 'backups', log=QUIET)
        victim = next(e for e in bs6.manifest['files'] if e['path'].endswith('library_cache.json'))
        (bs6.folder / victim['rel']).write_bytes(b'corrupt')
        (pathlib.Path(env6['LOCALAPPDATA']) / 'AXIOM DJ' / 'data' / 'library_cache.json').write_bytes(b'x')
        os.utime(pathlib.Path(env6['LOCALAPPDATA']) / 'AXIOM DJ' / 'data' / 'library_cache.json', (time.time() - 50, time.time() - 50))
        bs6.touch()
        result = bs6.restore(confirm=lambda late: True)
        check(result['mismatches'] and bs6.state['state'] == 'verify-failed', 'corrupt backup -> mismatch reported, state verify-failed')
        for n in range(7, 12):
            d = work / ('data%d' % n)
            e, _ = build(d)
            b = real_mode.BackupSet.create(real_mode.plan(e), time.time(), stamp='t%d' % n, base=work / 'backups', log=QUIET)
            b.touch()
            b.restore(log=QUIET)
        real_mode.prune(work / 'backups', log=QUIET)
        left = sorted(p.name for p in (work / 'backups').glob('real-backup-*'))
        check('real-backup-t6' in left, 'prune kept the verify-failed set and thinned closed ones: %s' % left)
        closed = [n for n in left if json.loads((work / 'backups' / n / 'state.json').read_text())['state'] in ('restored', 'abandoned')]
        check(len(closed) == 3, 'prune kept exactly 3 closed sets (%d)' % len(closed))

        # 7. guard rules in real mode
        data = ext / 'data7'
        env7, _ = build(data)
        cfg = real_mode.plan(env7)
        gbox = sb.Sandbox(work / 'gsb', dict(os.environ))
        gbox.root.mkdir()
        (gbox.root / 'Temp').mkdir()
        gbox.guard_log.touch()
        genv = gbox.env(guard='enforce', extra=dict(real_mode.guard_env(cfg, time.time()), PYTHONPATH=str(sb.HERE), PROJ=str(PROJECT)), real=False)
        genv.update(env7)
        probe = r'''
import os, sys, pathlib, socket, json
L = pathlib.Path(os.environ['LOCALAPPDATA']); H = pathlib.Path(os.environ['USERPROFILE']); P = pathlib.Path(os.environ['PROJ'])
out = {}
def t(name, fn):
    try: fn(); out[name] = 'allowed'
    except PermissionError: out[name] = 'blocked'
    except Exception as e: out[name] = 'other:' + type(e).__name__
t('rw: modify library_cache', lambda: (L/'AXIOM DJ'/'data'/'library_cache.json').write_text('{}'))
t('rw: new file in backed-up tree', lambda: (L/'AXIOM DJ'/'data'/'z.lock').write_text(''))
t('rw: log append (volatile)', lambda: open(L/'AXIOM DJ'/'Logs'/'launch.log', 'a').close())
t('new-only: create export on Desktop', lambda: (H/'Desktop'/'export.txt').write_text('x'))
t('new-only: touch (utime) the export it made', lambda: os.utime(H/'Desktop'/'export.txt', None))
t('new-only: overwrite existing Desktop file', lambda: (H/'Desktop'/'old.txt').write_text('x'))
t('new-only: utime existing Desktop file', lambda: os.utime(H/'Desktop'/'old.txt', None))
t('new-only: chmod existing Desktop file', lambda: os.chmod(H/'Desktop'/'old.txt', 0o666))
t('new-only: delete existing Desktop file', lambda: os.remove(H/'Desktop'/'old.txt'))
t('new-only: delete file made this run', lambda: os.remove(H/'Desktop'/'export.txt'))
t('new-only: rename existing doc away', lambda: os.rename(H/'Documents'/'d.txt', H/'Documents'/'d2.txt'))
t('music file: new mp3 on Desktop', lambda: (H/'Desktop'/'song.mp3').write_bytes(b'x'))
t('music file: write wav in recordings', lambda: (H/'Music'/'AXIOM DJ'/'Recordings'/'n.wav').write_bytes(b'x'))
t('music file: delete existing wav', lambda: os.remove(H/'Music'/'AXIOM DJ'/'Recordings'/'r.wav'))
t('not allowed: elsewhere in home', lambda: (H/'elsewhere.txt').write_text('x'))
t('not allowed: other file in VirtualDJ home', lambda: (L/'VirtualDJ'/'license.dat').write_text('x'))
t('not allowed: raw volume path', lambda: open('\\\\.\\' + str(H)[:2] + '\\x', 'wb'))
t('never: write into a backup set', lambda: (P/'fixtures'/'feature-check'/'real-backup-zz'/'x.txt').write_text('x'))
t('sandbox temp', lambda: (pathlib.Path(os.environ['FEATURE_CHECK_SANDBOX'])/'Temp'/'t.txt').write_text('x'))
def net():
    s = socket.socket(); s.settimeout(1)
    try: s.connect(('192.0.2.1', 9))
    finally: s.close()
t('network', net)
print(json.dumps(out))
'''
        done = subprocess.run([str(sb.python_exe()), '-c', probe], env=genv, capture_output=True, text=True, timeout=60)
        got = json.loads(done.stdout.strip().splitlines()[-1]) if done.stdout.strip() else {}
        want = {'rw: modify library_cache': 'allowed', 'rw: new file in backed-up tree': 'allowed', 'rw: log append (volatile)': 'allowed',
                'new-only: create export on Desktop': 'allowed', 'new-only: touch (utime) the export it made': 'allowed',
                'new-only: overwrite existing Desktop file': 'blocked', 'new-only: utime existing Desktop file': 'blocked',
                'new-only: chmod existing Desktop file': 'blocked', 'new-only: delete existing Desktop file': 'blocked',
                'new-only: delete file made this run': 'allowed', 'new-only: rename existing doc away': 'blocked',
                'music file: new mp3 on Desktop': 'blocked', 'music file: write wav in recordings': 'blocked', 'music file: delete existing wav': 'blocked',
                'not allowed: elsewhere in home': 'blocked', 'not allowed: other file in VirtualDJ home': 'blocked',
                'not allowed: raw volume path': 'blocked', 'never: write into a backup set': 'blocked', 'sandbox temp': 'allowed', 'network': 'blocked'}
        if not got:
            print(done.stdout[-500:], done.stderr[-800:])
        for name, expected in want.items():
            check(got.get(name) == expected, 'guard (real mode): %s -> %s (want %s)' % (name, got.get(name), expected))
        rows = [json.loads(l) for l in gbox.guard_log.read_text().splitlines()]
        media = [r for r in rows if r['kind'] == 'media-write']
        check(len(media) >= 3, 'media refusals are logged as kind media-write (%d)' % len(media))
        created = {pathlib.Path(r['detail']).name for r in rows if r['kind'] == 'created'}
        check({'z.lock', 'export.txt'} <= created and 'old.txt' not in created and 'library_cache.json' not in created,
              'the guard recorded exactly the creates (%s)' % sorted(created))
    finally:
        shutil.rmtree(work, ignore_errors=True)
        shutil.rmtree(ext, ignore_errors=True)
    print('\n%s' % ('ALL OK' if not check.failed else '%d FAILED' % check.failed))
    return 1 if check.failed else 0


if __name__ == '__main__':
    sys.exit(main())
