"""Sandbox for a feature-check run: a throw-away home, the child environment, a fingerprint of the owner's real
files (to prove nothing touched them), a free-port helper and the server launcher."""
import os
import sys
import json
import time
import hashlib
import shutil
import socket
import pathlib
import signal
import subprocess
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
PROJECT = HERE.parent
VENV_PYTHON = PROJECT / 'axiom-win-env' / 'Scripts' / 'python.exe'
FORBIDDEN_PORT = 8080  # the owner's PEAK HOUR may be running there


def python_exe():
    return VENV_PYTHON if VENV_PYTHON.is_file() else pathlib.Path(sys.executable)


def free_port():
    """A free loopback port, never 8080."""
    while True:
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            port = s.getsockname()[1]
        if port != FORBIDDEN_PORT:
            return port


class Sandbox:
    def __init__(self, root, real_env=None):
        self.root = pathlib.Path(root)
        self.real_env = dict(real_env or os.environ)  # the owner's environment, captured before anything is replaced
        self.local = self.root / 'AppData' / 'Local'
        self.roaming = self.root / 'AppData' / 'Roaming'
        self.home = self.root / 'User'
        self.desktop = self.home / 'Desktop'
        self.music = self.home / 'Music'
        self.documents = self.home / 'Documents'
        self.runtime = self.local / 'AXIOM DJ'
        self.temp = self.root / 'Temp'
        self.guard_log = self.root / 'guard.jsonl'
        self.server_log = self.root / 'server.log'
        self.process_file = self.root / 'processes.json'  # boot_server's fake process list (see boot_server.py)
        self.shots = self.root / 'shots'

    @classmethod
    def create(cls, base=None, stamp=None):
        base = pathlib.Path(base) if base else PROJECT / 'fixtures' / 'feature-check'
        stamp = stamp or time.strftime('%Y%m%d-%H%M%S')
        root = base / stamp
        n = 1
        while root.exists():
            n += 1
            root = base / ('%s-%d' % (stamp, n))
        box = cls(root)
        for folder in (box.local, box.roaming, box.desktop, box.music, box.documents, box.runtime, box.temp, box.shots):
            folder.mkdir(parents=True, exist_ok=True)
        box.guard_log.touch()
        box.process_file.write_text('[]', encoding='utf-8')
        return box

    def env(self, guard='enforce', allow=(), allow_tmp=None, extra=None, real=False):
        """Environment for a child process: everything points into the sandbox."""
        env = dict(self.real_env)
        for name in ('AXIOM_HUB', 'AXIOM_DEVICE_ID', 'PEAK_HOUR_UPDATE_MANIFEST_URL', 'PYTHONHOME', 'PYTHONSTARTUP'):
            env.pop(name, None)
        env.update(
            LOCALAPPDATA=str(self.local), APPDATA=str(self.roaming), USERPROFILE=str(self.home), HOME=str(self.home),
            TEMP=str(self.temp), TMP=str(self.temp), TMPDIR=str(self.temp),
            AXIOM_RUNTIME_DIR=str(self.runtime), AXIOM_LICENSE_REQUIRED='0', AXIOM_NO_OPEN='1',
            PYTHONUNBUFFERED='1', PYTHONDONTWRITEBYTECODE='1',
            FEATURE_CHECK_GUARD=guard, FEATURE_CHECK_SANDBOX=str(self.root), FEATURE_CHECK_GUARD_LOG=str(self.guard_log),
            FEATURE_CHECK_PROCESS_FILE=str(self.process_file),
        )
        if allow:
            env['FEATURE_CHECK_ALLOW'] = os.pathsep.join(str(a) for a in allow)
        if allow_tmp:
            env['FEATURE_CHECK_ALLOW_TMP'] = str(allow_tmp)
        if real:  # --real: the owner's own folders; only TEMP stays in the sandbox
            for name in ('LOCALAPPDATA', 'APPDATA', 'USERPROFILE'):
                env[name] = self.real_env[name]
            env['HOME'] = self.real_env['USERPROFILE']
            env.pop('AXIOM_RUNTIME_DIR', None)
        env.update(extra or {})
        return env

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)


# --------------------------------------------------------------------------- fingerprints of the owner's real files

HASH_LIMIT = 100 * 1024 * 1024


def real_dj_files(env=None):
    """The owner's real DJ databases that must never change during a run."""
    env = env or os.environ
    files = []
    local = env.get('LOCALAPPDATA')
    home = env.get('USERPROFILE') or str(pathlib.Path.home())
    if local:
        files += [pathlib.Path(local) / 'AXIOM DJ' / 'data' / 'library_cache.json', pathlib.Path(local) / 'VirtualDJ' / 'database.xml']
    drives = [pathlib.Path('%s:\\' % c) for c in 'CDEFGHIJKLMNOPQRSTUVWXYZ' if os.path.isdir('%s:\\' % c)]
    for drive in drives:
        files.append(drive / 'VirtualDJ' / 'database.xml')
        files.append(drive / '_Serato_' / 'database V2')
        files.append(drive / '_Serato_' / 'Library' / 'location.sqlite')
    if local:
        files.append(pathlib.Path(local) / 'Serato' / 'Library' / 'root.sqlite')
    files.append(pathlib.Path(home) / 'Music' / '_Serato_' / 'Library' / 'location.sqlite')
    music = pathlib.Path(home) / 'Music'
    for name in ('_Serato_', 'Serato'):
        for candidate in (music / name / 'database V2', pathlib.Path(home) / name / 'database V2'):
            files.append(candidate)
    djay = music / 'djay'
    for name in ('djay Media Library', 'djay Media Library.djayMediaLibrary'):
        for db in ('MediaLibrary.db', 'MediaLibrary.db-wal'):
            files.append(djay / name / db)
    if djay.is_dir():
        base = len(djay.parts)
        for dirpath, dirnames, filenames in os.walk(djay):
            if len(pathlib.Path(dirpath).parts) - base >= 3:
                dirnames[:] = []
            for name in filenames:
                if name.lower().endswith(('.sqlite', '.db', '.sqlite3')) and 'cache' not in dirpath.lower():
                    files.append(pathlib.Path(dirpath) / name)
    seen, out = set(), []
    for path in files:
        if str(path).lower() not in seen:
            seen.add(str(path).lower())
            out.append(path)
    return out


def fingerprint(paths=None):
    """{path: None | {size, mtime_ns, sha1}} for every real DJ file that exists."""
    result = {}
    for path in (paths if paths is not None else real_dj_files()):
        path = pathlib.Path(path)
        try:
            if not path.is_file():
                continue
            stat = path.stat()
            entry = {'size': stat.st_size, 'mtime_ns': stat.st_mtime_ns, 'sha1': None}
            if stat.st_size < HASH_LIMIT:
                digest = hashlib.sha1()
                with open(path, 'rb') as handle:
                    for block in iter(lambda: handle.read(1 << 20), b''):
                        digest.update(block)
                entry['sha1'] = digest.hexdigest()
            result[str(path)] = entry
        except OSError as exc:
            result[str(path)] = {'error': repr(exc)}
    return result


def fingerprint_diff(before, after):
    """Human-readable differences between two fingerprints (empty list = untouched)."""
    changes = []
    for path in sorted(set(before) | set(after)):
        if path not in after:
            changes.append('%s: disappeared' % path)
        elif path not in before:
            changes.append('%s: appeared' % path)
        elif before[path] != after[path]:
            changes.append('%s: changed (%s -> %s)' % (path, json.dumps(before[path]), json.dumps(after[path])))
    return changes


def changed_paths(before, after):
    return [p for p in sorted(set(before) | set(after)) if before.get(p) != after.get(p)]


def running_dj_programs():
    """{'virtualdj', 'serato', 'djay'} that have a running process right now."""
    try:
        text = subprocess.run(['tasklist', '/FO', 'CSV', '/NH'], capture_output=True, text=True, timeout=30).stdout.lower()
    except (OSError, subprocess.SubprocessError):
        return {'virtualdj', 'serato', 'djay'}  # cannot tell: be lenient
    found = set()
    if 'virtualdj' in text:
        found.add('virtualdj')
    if 'serato' in text:
        found.add('serato')
    if '"djay' in text:
        found.add('djay')
    return found


def program_of(path):
    low = path.lower()
    if 'virtualdj' in low:
        return 'virtualdj'
    if 'serato' in low:
        return 'serato'
    if 'djay' in low:
        return 'djay'
    return None  # library_cache.json and anything else: strict


# --------------------------------------------------------------------------- server

class ServerHandle:
    def __init__(self, proc, port, log_path):
        self.proc = proc
        self.port = port
        self.base_url = 'http://127.0.0.1:%d' % port
        self.log_path = pathlib.Path(log_path)

    def alive(self):
        return self.proc.poll() is None

    def log_tail(self, lines=40):
        try:
            text = self.log_path.read_text(encoding='utf-8', errors='replace')
        except OSError:
            return []
        return text.splitlines()[-lines:]

    def stop(self, grace=20):
        """Ask the server to shut down (so SQLite can checkpoint and close), then CTRL_BREAK, and only then taskkill /F."""
        if self.proc is not None and self.proc.poll() is None:
            try:
                req = urllib.request.Request(self.base_url + '/api/_featurecheck/shutdown', data=b'{}', method='POST',
                                             headers={'Origin': self.base_url, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json'})
                urllib.request.urlopen(req, timeout=10).read()
            except Exception:
                pass
            try:
                self.proc.wait(timeout=grace)
            except subprocess.TimeoutExpired:
                try:
                    os.kill(self.proc.pid, signal.CTRL_BREAK_EVENT)
                    self.proc.wait(timeout=8)
                except Exception:
                    pass
        kill_tree(self.proc)


def kill_tree(proc):
    if proc is None:
        return
    if proc.poll() is None:
        subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], capture_output=True)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def start_server(box, installed=None, inject=None, guard='enforce', timeout=120, real_env=None):
    """Start boot_server.py with the sandbox environment; returns a ServerHandle once it printed READY <port>."""
    if installed:
        installed = pathlib.Path(installed)
        python = installed / 'runtime' / 'python.exe'
    else:
        python = python_exe()
    cmd = [str(python), str(HERE / 'boot_server.py'), '--sandbox', str(box.root)]
    if installed:
        cmd += ['--installed', str(installed)]
    extra = {'PYTHONPATH': str(HERE)}  # Python children get the guard too; the owner's own PYTHONPATH is not passed on
    if inject:
        cmd += ['--inject', inject]
        extra['FEATURE_CHECK_SELFTEST'] = '1'
    # the server never writes outside the sandbox; the installed copy gets no extra allowance either
    if real_env is not None:
        extra.update(real_env)
        cmd.append('--real')
    env = box.env(guard=guard, extra=extra, real=real_env is not None)
    log = open(box.server_log, 'ab')
    proc = subprocess.Popen(cmd, env=env, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                            cwd=str(box.root), creationflags=getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0))
    log.close()
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            text = box.server_log.read_text(encoding='utf-8', errors='replace')
        except OSError:
            text = ''
        for line in text.splitlines():
            if line.startswith('READY '):
                return ServerHandle(proc, int(line.split()[1]), box.server_log)
        if proc.poll() is not None:
            raise RuntimeError('server exited with %s before it was ready:\n%s' % (proc.returncode, '\n'.join(text.splitlines()[-30:])))
        time.sleep(0.3)
    kill_tree(proc)
    raise RuntimeError('server not ready after %ds' % timeout)
