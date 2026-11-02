"""--real mode: run the feature checks against the owner's actual data, with a backup before and a restore after.

Safety design
  * preflight (running_blockers): refuses while PEAK HOUR, VirtualDJ, Serato DJ or djay run, or something answers on port 8080.
    The same check runs again before the automatic restore: if one of them started during the run nothing is restored
    automatically (their files are theirs now); the set stays 'running' and the instructions are printed.
  * plan(): what is backed up (read-write; restored byte for byte) and what is only watched (create-only output folders).
  * BackupSet.create(): fixtures\\feature-check\\real-backup-<stamp>\\ with files\\NNNNNN copies, manifest.json (static: path, size,
    mtime_ns, sha256, listings) and state.json (mutable: state, server_pid, last_activity heartbeat, sandbox). The state is
    'backing-up' while copying (a failure or kill there deletes the folder: nothing was touched yet), then 'running'.
    guard.jsonl in the same folder is the guard log of the run: it records every file / folder the run created.
  * Restore never deletes anything: files the run created (only those recorded by the guard, only inside watched roots, never ones
    newer than last_activity) and strays are MOVED to quarantine\\ with an index.json. Backed-up files that changed after
    last_activity (the run was over; somebody else wrote them) are listed with dates and only overwritten after a y/N confirmation
    (non-interactive: refused); the version that was there is kept in quarantine\\.
  * SQLite: every -wal / -shm / -journal next to a backed-up .db / .sqlite that is not in the manifest is quarantined before the main
    file is put back; the ones that are in the manifest are restored with it. The server is stopped gracefully first (sandbox.stop).
  * Verify: sha256 of every restored file. A mismatch -> state 'verify-failed', backup kept, exit 2.
  * Limits: a file created by C code (a SQLite database that sqlite3 opens itself) is not seen by Python's audit hook, so it is not
    recorded as created; it is left behind, never removed (the safe direction).
  * prune(): keeps the newest 3 closed (restored / abandoned) sets; running, backing-up leftovers and verify-failed are never touched.
"""
import os
import sys
import json
import time
import hashlib
import shutil
import socket
import pathlib
import threading
import subprocess
import datetime

PROJECT = pathlib.Path(__file__).resolve().parent.parent
BACKUP_BASE = PROJECT / 'fixtures' / 'feature-check'
KEEP_SETS = 3
HEARTBEAT = 3.0       # seconds between last_activity writes while a run is going
WATCHDOG = 600.0      # the heartbeat thread stops touching after this long without progress from the main thread
CUTOFF_SLACK = 6.0    # a file newer than last_activity + this was not written by the run
LISTING_DEPTH = {'Documents': 4}
DJ_PROGRAMS = {'virtualdj': 'VirtualDJ', 'serato dj': 'Serato DJ', 'djay': 'djay'}
SQLITE_EXT = ('.db', '.sqlite', '.sqlite3')
SIDE_SUFFIXES = ('-wal', '-shm', '-journal')
LONG = '\\\\?\\'


def _long(path):
    path = os.path.abspath(str(path))
    return path if path.startswith(LONG) else LONG + path


def sha256(path):
    digest = hashlib.sha256()
    with open(_long(path), 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def drive_roots():
    return [pathlib.Path('%s:\\' % c) for c in 'CDEFGHIJKLMNOPQRSTUVWXYZ' if os.path.isdir('%s:\\' % c)]


def _iso(ts):
    return datetime.datetime.fromtimestamp(ts).strftime('%Y-%m-%d %H:%M:%S')


# --------------------------------------------------------------------------- preconditions

def running_blockers():
    """Names of things that must not be running (empty = fine)."""
    problems = []
    try:
        tasks = subprocess.run(['tasklist', '/FO', 'CSV', '/NH'], capture_output=True, text=True, timeout=30).stdout.lower()
    except (OSError, subprocess.SubprocessError):
        return ['cannot list processes (tasklist failed)']
    for needle, name in DJ_PROGRAMS.items():
        if '"' + needle in tasks or needle.replace(' ', '') + '.exe' in tasks:
            problems.append('%s is running' % name)
    try:
        ps = subprocess.run(['powershell', '-NoProfile', '-Command',
                             "Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -like '*axiom_windows_launcher*' -and $_.CommandLine -notlike '*Get-CimInstance*') -or $_.Name -like 'PEAK HOUR*' } "
                             "| ForEach-Object { $_.ProcessId }"], capture_output=True, text=True, timeout=60).stdout.split()
        mine = {str(os.getpid())}
        if [p for p in ps if p not in mine]:
            problems.append('PEAK HOUR is running (process %s)' % ', '.join(p for p in ps if p not in mine))
    except (OSError, subprocess.SubprocessError):
        problems.append('cannot inspect processes (powershell failed)')
    with socket.socket() as s:
        s.settimeout(1)
        if s.connect_ex(('127.0.0.1', 8080)) == 0:
            problems.append('something is answering on port 8080 (PEAK HOUR?)')
    return problems


def _pid_alive(pid):
    try:
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, int(pid))  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        ok = ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return bool(ok) and code.value == 259  # STILL_ACTIVE
    except Exception:
        return True  # cannot tell: assume it is alive, never delete


def _read_state(folder):
    folder = pathlib.Path(folder)
    try:
        return json.loads((folder / 'state.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def unfinished_backups(base=BACKUP_BASE):
    """Backup sets whose run was never restored (or abandoned). A set that was only being copied is deleted: nothing was touched."""
    out = []
    for folder in sorted(pathlib.Path(base).glob('real-backup-*')):
        state = (_read_state(folder) or {}).get('state')
        has_manifest = (folder / 'manifest.json').is_file()
        if not has_manifest and state in (None, 'backing-up'):
            pid = (_read_state(folder) or {}).get('pid')
            young = time.time() - folder.stat().st_mtime < 60
            if (pid and _pid_alive(pid)) or (not pid and state is None and young):
                out.append((folder, 'backing-up (another run is copying right now)'))  # two runs at once: not ours to delete
                continue
            shutil.rmtree(folder, ignore_errors=True)  # interrupted before the first byte of real data was touched
            continue
        if state in ('restored', 'abandoned'):
            continue
        out.append((folder, state or 'unreadable'))
    return out


# --------------------------------------------------------------------------- what is touched

def _glob(root, pattern):
    try:
        return sorted(pathlib.Path(root).glob(pattern))
    except OSError:
        return []


def plan(env=None):
    """{'trees': [(root, excluded top-level names)], 'files': [...], 'newonly': [(root, depth)], 'volatile': [...], 'media_exempt': [...]}"""
    env = env or os.environ
    local = pathlib.Path(env.get('LOCALAPPDATA') or pathlib.Path.home() / 'AppData' / 'Local')
    home = pathlib.Path(env.get('USERPROFILE') or pathlib.Path.home())
    axiom = local / 'AXIOM DJ'
    trees, files, newonly, volatile = [], [], [], []
    if axiom.is_dir():
        trees.append((axiom, ['Video Cache', 'Window', 'Logs', 'Cache', 'EBWebView', 'Edge']))
    volatile += [axiom / 'Logs', axiom / 'Video Cache']
    vdj = local / 'VirtualDJ'
    if vdj.is_dir():
        files += [vdj / 'database.xml', vdj / 'settings.xml']
        trees += [(vdj / 'MyLists', []), (vdj / 'History', [])]
        newonly.append((vdj, None))
    drives = drive_roots()
    for serato in [home / 'Music' / '_Serato_'] + [r / '_Serato_' for r in drives]:
        if serato.is_dir():
            files += [serato / 'database V2', serato / 'Library' / 'location.sqlite']
            trees += [(serato / 'Subcrates', []), (serato / 'History', [])]
    files.append(local / 'Serato' / 'Library' / 'root.sqlite')
    for root in drives:
        if (root / 'VirtualDJ').is_dir():
            files.append(root / 'VirtualDJ' / 'database.xml')
            trees.append((root / 'VirtualDJ' / 'MyLists', []))
    djay = home / 'Music' / 'djay'
    for name in ('djay Media Library', 'djay Media Library.djayMediaLibrary'):
        if (djay / name).is_dir():
            trees.append((djay / name, []))
        else:
            files += [djay / name / n for n in ('MediaLibrary.db', 'MediaLibrary.db-wal', 'MediaLibrary.db-shm')]
    for pattern_root, pattern in ((djay, '**/Packages/*/Metadata'), (local / 'Packages', '*djay*/**/Metadata')):
        for found in _glob(pattern_root, pattern):
            if found.is_dir():
                trees.append((found, []))
    for out in (home / 'Desktop', home / 'Music' / 'AXIOM DJ', home / 'Documents'):
        if out.is_dir() or out.parent.is_dir():
            newonly.append((out, LISTING_DEPTH.get(out.name)))
    dedup, seen = [], set()
    for tree in trees:
        key = os.path.normcase(str(tree[0]))
        if key not in seen:
            seen.add(key)
            dedup.append(tree)
    return {'trees': dedup, 'files': files, 'newonly': newonly, 'volatile': volatile,
            'media_exempt': [axiom / 'Video Cache']}


def guard_env(cfg, run_start):
    """Environment variables that put guard.py into real-data mode."""
    rw = [str(r) for r, _ in cfg['trees']] + [str(f) for f in cfg['files']]
    return {'FEATURE_CHECK_REAL': '1', 'FEATURE_CHECK_ALLOW': os.pathsep.join(rw),
            'FEATURE_CHECK_NEWONLY': os.pathsep.join(str(r) for r, _ in cfg['newonly']),
            'FEATURE_CHECK_VOLATILE': os.pathsep.join(str(v) for v in cfg['volatile']),
            'FEATURE_CHECK_MEDIA_EXEMPT': os.pathsep.join(str(m) for m in cfg['media_exempt']),
            'FEATURE_CHECK_RUN_START': '%.3f' % run_start}


def walk(root, excluded=(), depth=None):
    """(files, dirs) below root as {path: (size, mtime_ns)} / [path]; junctions and symlinks are not followed."""
    files, dirs = {}, []
    root = pathlib.Path(root)
    if not root.is_dir():
        return files, dirs
    skip = {n.lower() for n in excluded}
    stack = [(str(root), 0)]
    while stack:
        current, level = stack.pop()
        try:
            entries = list(os.scandir(_long(current)))
        except OSError:
            continue
        for entry in entries:
            path = os.path.join(current, entry.name)
            try:
                if entry.is_symlink() or (entry.is_dir(follow_symlinks=False) and os.path.isjunction(path)):
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if level == 0 and entry.name.lower() in skip:
                        continue
                    dirs.append(path)
                    if depth is None or level + 1 < depth:
                        stack.append((path, level + 1))
                elif entry.is_file(follow_symlinks=False):
                    st = entry.stat(follow_symlinks=False)
                    files[path] = (st.st_size, st.st_mtime_ns)
            except OSError:
                continue
    return files, dirs


def _key(path):
    return os.path.normcase(os.path.abspath(str(path)))


def _inside(path, roots):
    path = _key(path)
    return any(path == r or path.startswith(r.rstrip('\\/') + os.sep) for r in roots)


# --------------------------------------------------------------------------- backup set

class BackupSet:
    def __init__(self, folder):
        self.folder = pathlib.Path(folder)
        self.manifest_path = self.folder / 'manifest.json'
        self.state_path = self.folder / 'state.json'
        self.guard_log = self.folder / 'guard.jsonl'
        self.quarantine_dir = self.folder / 'quarantine'
        self.manifest = {}
        self.state = {}
        self._beat = None
        self._progress = time.time()
        self._stop_beat = threading.Event()

    # ---- state.json (small, rewritten often)
    def _write_state(self):
        tmp = self.state_path.with_suffix('.tmp')
        tmp.write_text(json.dumps(self.state, indent=1), encoding='utf-8')
        os.replace(tmp, self.state_path)

    def set(self, **values):
        self.state.update(values)
        self._write_state()

    def touch(self):
        self.set(last_activity=time.time())

    def progress(self):
        """Called by the main thread whenever the run makes progress (a check starts / ends, a legacy test ends)."""
        self._progress = time.time()
        try:
            self.touch()
        except OSError:
            pass

    def start_heartbeat(self, interval=HEARTBEAT):
        self._progress = time.time()
        self.touch()

        def beat():
            # a watchdog, not a clock: while the main thread keeps reporting progress it keeps last_activity fresh through a long
            # check; a hung run stops advancing it after WATCHDOG seconds, so the late-change check still means something
            while not self._stop_beat.wait(interval):
                if time.time() - self._progress > WATCHDOG:
                    continue
                try:
                    self.touch()
                except OSError:
                    pass
        self._stop_beat.clear()
        self._beat = threading.Thread(target=beat, daemon=True)
        self._beat.start()

    def stop_heartbeat(self):
        self._stop_beat.set()
        if self._beat is not None:
            self._beat.join(timeout=5)
            self._beat = None

    # ---- creating
    @classmethod
    def create(cls, cfg, run_start, stamp=None, base=BACKUP_BASE, log=print):
        stamp = stamp or time.strftime('%Y%m%d-%H%M%S')
        self = cls(pathlib.Path(base) / ('real-backup-' + stamp))
        (self.folder / 'files').mkdir(parents=True)
        self.state = {'state': 'backing-up', 'pid': os.getpid(), 'created': time.strftime('%Y-%m-%d %H:%M:%S'), 'run_start': run_start, 'server_pid': None,
                      'sandbox': None, 'last_activity': None, 'guard_log': str(self.guard_log)}
        self._write_state()
        try:
            self._copy_everything(cfg, run_start, log)
        except BaseException:
            shutil.rmtree(self.folder, ignore_errors=True)  # nothing of the owner's was touched while copying
            raise
        self.guard_log.touch()
        self.set(state='running', last_activity=time.time())
        return self

    def _copy_everything(self, cfg, run_start, log):
        entries, listing, sources = [], {}, {}
        for root, excluded in cfg['trees']:
            found, dirs = walk(root, excluded)
            listing[str(root)] = {'files': {p: list(v) for p, v in found.items()}, 'dirs': dirs, 'excluded': list(excluded), 'depth': None, 'rw': True}
            sources.update(found)
        for path in cfg['files']:
            if os.path.isfile(_long(path)):
                st = os.stat(_long(path))
                sources[str(path)] = (st.st_size, st.st_mtime_ns)
        for path in list(sources):  # SQLite side files travel with their database
            if path.lower().endswith(SQLITE_EXT):
                for suffix in SIDE_SUFFIXES:
                    if os.path.isfile(_long(path + suffix)) and (path + suffix) not in sources:
                        st = os.stat(_long(path + suffix))
                        sources[path + suffix] = (st.st_size, st.st_mtime_ns)
        for root, depth in cfg['newonly']:
            found, dirs = walk(root, (), depth)
            listing[str(root)] = {'files': {p: list(v) for p, v in found.items()}, 'dirs': dirs, 'excluded': [], 'depth': depth, 'rw': False}
        total = 0
        for index, (path, _) in enumerate(sorted(sources.items())):
            rel = 'files/%06d' % index
            digest = hashlib.sha256()
            before = os.stat(_long(path))
            with open(_long(path), 'rb') as src, open(self.folder / rel, 'wb') as dst:
                for block in iter(lambda: src.read(1 << 20), b''):
                    digest.update(block)
                    dst.write(block)
                dst.flush()
                os.fsync(dst.fileno())
            if sha256(self.folder / rel) != digest.hexdigest():
                raise RuntimeError('backup copy of %s does not match the original' % path)
            after = os.stat(_long(path))
            if (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
                raise RuntimeError('%s changed while it was being backed up (is the program still running?)' % path)
            entries.append({'path': path, 'rel': rel, 'size': before.st_size, 'mtime_ns': before.st_mtime_ns, 'sha256': digest.hexdigest()})
            total += before.st_size
        self.manifest = {
            'version': 2, 'created': time.strftime('%Y-%m-%d %H:%M:%S'), 'run_start': run_start, 'files': entries, 'listing': listing,
            'targets': {'trees': [[str(r), list(e)] for r, e in cfg['trees']], 'files': [str(f) for f in cfg['files']],
                        'newonly': [[str(r), d] for r, d in cfg['newonly']], 'volatile': [str(v) for v in cfg['volatile']]},
            'total_bytes': total}
        tmp = self.manifest_path.with_suffix('.tmp')
        tmp.write_text(json.dumps(self.manifest, indent=1), encoding='utf-8')
        os.replace(tmp, self.manifest_path)  # the manifest appears only when the copy is complete
        log('backup: %d file(s), %.1f MB in %s' % (len(entries), total / 1e6, self.folder))

    @classmethod
    def load(cls, folder):
        self = cls(folder)
        self.manifest = json.loads(self.manifest_path.read_text(encoding='utf-8'))
        self.state = _read_state(folder) or {'state': 'unreadable'}
        return self

    # ---- what the run did
    def roots(self):
        t = self.manifest['targets']
        return [_key(r) for r, _ in t['trees']] + [_key(f) for f in t['files']] + [_key(r) for r, _ in t['newonly']]

    def cutoff(self):
        return (self.state.get('last_activity') or self.state.get('run_start') or 0) + CUTOFF_SLACK

    def created_by_run(self):
        """(files, dirs) the guard saw the run create, in order. Only these are ever cleaned up."""
        files, dirs, seen = [], [], set()
        try:
            lines = self.guard_log.read_text(encoding='utf-8').splitlines()
        except OSError:
            lines = []
        for line in lines:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get('kind') in ('created', 'created-dir') and row.get('detail') and row['detail'] not in seen:
                seen.add(row['detail'])
                (files if row['kind'] == 'created' else dirs).append(row['detail'])
        return files, dirs

    def _differs(self, entry):
        path = entry['path']
        if not os.path.isfile(_long(path)):
            return 'deleted'
        st = os.stat(_long(path))
        if st.st_size == entry['size'] and st.st_mtime_ns == entry['mtime_ns']:
            return None
        return 'modified' if sha256(path) != entry['sha256'] else None

    def late_changes(self):
        """Backed-up files that differ from the backup AND were written after the run's last activity: [(path, 'YYYY-MM-DD HH:MM:SS')]."""
        cutoff, out = self.cutoff(), []
        for entry in self.manifest['files']:
            if self._differs(entry) == 'modified' and os.stat(_long(entry['path'])).st_mtime > cutoff:
                out.append((entry['path'], _iso(os.stat(_long(entry['path'])).st_mtime)))
        return out

    def changes(self):
        """What the run did to the backed-up data: [{'path', 'kind': modified|deleted|created}]."""
        out = []
        for entry in self.manifest['files']:
            kind = self._differs(entry)
            if kind:
                out.append({'path': entry['path'], 'kind': kind})
        files, _ = self.created_by_run()
        out += [{'path': p, 'kind': 'created'} for p in files if os.path.isfile(_long(p))]
        return out

    # ---- quarantine
    def _quarantine(self, path, why):
        self.quarantine_dir.mkdir(exist_ok=True)
        index_path = self.quarantine_dir / 'index.json'
        try:
            index = json.loads(index_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            index = []
        name = '%05d_%s' % (len(index) + 1, os.path.basename(path))
        try:
            os.chmod(_long(path), 0o666)
        except OSError:
            pass
        shutil.move(_long(path), str(self.quarantine_dir / name))
        index.append({'name': name, 'from': path, 'why': why, 'time': time.strftime('%Y-%m-%d %H:%M:%S')})
        index_path.write_text(json.dumps(index, indent=1), encoding='utf-8')

    # ---- restoring
    def restore(self, confirm=None, log=print):
        """Put everything back. confirm(late) -> bool is asked when backed-up files changed after last_activity (None = refuse).
        Returns {'restored','quarantined','left_behind','mismatches','refused'}; nothing is deleted - removed files go to quarantine."""
        result = {'restored': [], 'quarantined': [], 'left_behind': [], 'mismatches': [], 'refused': []}
        late = self.late_changes()
        if late and not (confirm and confirm(late)):
            result['refused'] = ['%s (changed %s, after the run ended)' % item for item in late]
            return result
        late_paths = {p for p, _ in late}
        paths = {_key(e['path']) for e in self.manifest['files']}
        # stray SQLite side files first, so a stale -wal can never be replayed onto the restored database
        for entry in self.manifest['files']:
            if entry['path'].lower().endswith(SQLITE_EXT):
                for suffix in SIDE_SUFFIXES:
                    side = entry['path'] + suffix
                    if _key(side) not in paths and os.path.isfile(_long(side)):
                        self._quarantine(side, 'SQLite side file that was not in the backup')
                        result['quarantined'].append(side)
        for entry in self.manifest['files']:
            path = entry['path']
            source = self.folder / entry['rel']
            try:
                if self._differs(entry) is None:
                    continue
                os.makedirs(os.path.dirname(_long(path)), exist_ok=True)
                if os.path.isfile(_long(path)):  # whatever is there differs from the backup: keep it before it is replaced
                    self._quarantine_copy(path, 'overwritten by restore; written after the run ended' if path in late_paths else
                                          'overwritten by restore; changed during the run (by PEAK HOUR or another program)')
                tmp = path + '.fcrestore.tmp'
                shutil.copyfile(source, _long(tmp))
                os.utime(_long(tmp), ns=(entry['mtime_ns'], entry['mtime_ns']))
                try:
                    os.chmod(_long(path), 0o666)
                except OSError:
                    pass
                os.replace(_long(tmp), _long(path))
                result['restored'].append(path)
            except OSError as exc:
                result['mismatches'].append('%s: restore failed (%s)' % (path, exc))
        before = {_key(p) for info in self.manifest['listing'].values() for p in info['files']}
        roots = self.roots()
        files, dirs = self.created_by_run()
        cutoff = self.cutoff()
        for path in files:
            if not os.path.isfile(_long(path)):
                continue
            if _key(path) in before or _key(path) in paths or not _inside(path, roots):
                continue  # not something the run made, or outside the watched places
            if os.stat(_long(path)).st_mtime > cutoff:
                result['left_behind'].append(path)  # newer than the run's last activity: somebody else's
                continue
            try:
                self._quarantine(path, 'created during the run')
                result['quarantined'].append(path)
            except OSError as exc:
                result['left_behind'].append('%s (%s)' % (path, exc))
        for path in sorted(dirs, key=len, reverse=True):
            if _inside(path, roots) and os.path.isdir(_long(path)):
                try:
                    os.rmdir(_long(path))  # only if empty
                    result['quarantined'].append(path + '\\ (empty folder removed)')
                except OSError:
                    pass
        for entry in self.manifest['files']:
            try:
                if sha256(entry['path']) != entry['sha256']:
                    result['mismatches'].append('%s: content differs from the backup' % entry['path'])
            except OSError as exc:
                result['mismatches'].append('%s: %s' % (entry['path'], exc))
        self.set(state='restored' if not result['mismatches'] else 'verify-failed', restored_count=len(result['restored']),
                 quarantined_count=len(result['quarantined']))
        return result

    def _quarantine_copy(self, path, why):
        """Keep the current version of a file that is about to be overwritten."""
        self.quarantine_dir.mkdir(exist_ok=True)
        index_path = self.quarantine_dir / 'index.json'
        try:
            index = json.loads(index_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            index = []
        name = '%05d_overwritten_%s' % (len(index) + 1, os.path.basename(path))
        shutil.copy2(_long(path), str(self.quarantine_dir / name))
        index.append({'name': name, 'from': path, 'why': why, 'time': time.strftime('%Y-%m-%d %H:%M:%S')})
        index_path.write_text(json.dumps(index, indent=1), encoding='utf-8')

    def abandon(self):
        """Close the set without restoring anything."""
        self.set(state='abandoned')

    def restore_command(self):
        return 'axiom-win-env\\Scripts\\python.exe check_features.py --restore "%s"' % self.folder

    def summary(self):
        trees = self.manifest['targets']['trees']
        return {'folder': str(self.folder), 'files': len(self.manifest['files']), 'bytes': self.manifest['total_bytes'],
                'roots': [t[0] for t in trees] + self.manifest['targets']['files'][:20],
                'watched': [n[0] for n in self.manifest['targets']['newonly']]}


def prune(base=BACKUP_BASE, keep=KEEP_SETS, log=print):
    """Delete the oldest closed (restored / abandoned) sets beyond `keep`. Running, verify-failed and half-made sets are never touched."""
    good = []
    for folder in sorted(pathlib.Path(base).glob('real-backup-*')):
        if (_read_state(folder) or {}).get('state') in ('restored', 'abandoned'):
            good.append(folder)
    for folder in good[:-keep] if len(good) > keep else []:
        shutil.rmtree(folder, ignore_errors=True)
        log('pruned old backup set %s' % folder.name)


def kill_leftover_server(state):
    pid = (state or {}).get('server_pid')
    if not pid:
        return
    try:
        out = subprocess.run(['powershell', '-NoProfile', '-Command',
                              "(Get-CimInstance Win32_Process -Filter 'ProcessId=%d').CommandLine" % int(pid)], capture_output=True, text=True, timeout=30).stdout
        if 'boot_server.py' in out:
            subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True)
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
