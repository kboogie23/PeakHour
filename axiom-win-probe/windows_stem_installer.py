r"""One-time "Install stem engine" for Studio Stems on Windows.

The stem engine (Python + PyTorch + Demucs + the htdemucs checkpoint) is several GB and is not part of the
installer (build_installer.py leaves it out). Clicking Stems without it answers HTTP 503 stem_runtime_missing; this
module downloads it into the app's data folder (AXIOM_RUNTIME_DIR, else %LOCALAPPDATA%\AXIOM DJ) as a background job:

    <data>\stem-runtime\          Python 3.12 (a copy of this app's own) + PyTorch + Demucs 4.0.1 + numpy 1.26.4
    <data>\stem-models\           955717e8-8726e21a.th, SHA-256 checked (the worker checks it again)

Design
- The app's own interpreter has no venv/ensurepip (the installer strips them), so the runtime is a relocatable COPY of
  that interpreter (python.exe, DLLs, Lib without site-packages) with Scripts\python.exe beside python312.dll, which is
  where windows_stems points the worker. pip comes from the official pip wheel on PyPI (exact version and SHA-256 are constants here).
- Everything is built in <data>\stem-new and renamed to stem-runtime in one step at the very end, after
  the worker's own import chain ran in it. A half-installed runtime therefore never has a Scripts\python.exe at the
  path windows_stems.py (and studio_daw.stems, which only checks that file) looks at. A restart after a failure or a
  cancel keeps that folder, skips finished steps and lets pip reuse its cache, so nothing finished is repeated.
- PyTorch is the CUDA 12.4 build (download.pytorch.org/whl/cu124) when nvidia-smi reports a driver that can run it,
  else the CPU build; a CUDA build that cannot be installed or imported is replaced by the CPU build in the same job.
- Every package comes from ONE lock per build (stem_engine_lock_cuda.txt / _cpu.txt: exact versions, SHA-256, torch and every
  dependency included), installed with --no-deps --require-hashes, so a new release can never swap the CUDA torch for another.
  The result is checked by a real ~1 second separation on the device it will use; a CUDA build that fails it is replaced.
- The checkpoint is fetched with HTTP Range resume into a .part file and renamed only after the SHA-256 matches.
- The one sdist in the lock (demucs 4.0.1) is built WITHOUT pip's isolated build environment, whose installs pip does not
  hash-check: the build tool (setuptools; demucs has no pyproject.toml, and setuptools 84 builds wheels itself, so no
  separate wheel package) is installed first from the lock with --require-hashes, then everything else with
  --no-build-isolation --require-hashes. pip is started in exactly one place (_pip), always with --require-hashes.
- The sources are download.pytorch.org, pypi.org, files.pythonhosted.org and dl.fbaipublicfiles.com, over https. pip follows the
  official redirect from download.pytorch.org to download-r2.pytorch.org (the files live there); that is safe because every file
  is checked against its pinned SHA-256 before it is installed, so a different host could not serve a different file. pip runs
  with --isolated (no user pip.ini or PIP_* variables), so no other index can be configured. No console windows.
"""
import hashlib
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from windows_cache_fallback import data_root

CREATE_NO_WINDOW = 0x08000000
ALLOWED_HOSTS = ('download.pytorch.org', 'pypi.org', 'files.pythonhosted.org', 'dl.fbaipublicfiles.com')

MODEL_FILE = '955717e8-8726e21a.th'
MODEL_URL = 'https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/' + MODEL_FILE
MODEL_SHA256 = '8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4'  # also the stem worker's constant
MODEL_SIZE = 84141911

PIP_VERSION = '26.3'
PIP_SHA256 = 'f3b60b20ffaadd4415ed7957212a38ac63fa4c5fa375bd0f4a797777940fad13'  # pip-26.3-py3-none-any.whl, from PyPI
PIP_WHEEL_NAME = re.compile(r'^pip-[\d.]+-py3-none-any\.whl$')
PIP_JSON = 'https://pypi.org/pypi/pip/%s/json' % PIP_VERSION
PYPI_INDEX = 'https://pypi.org/simple'
TORCH_INDEX = {'cuda': 'https://download.pytorch.org/whl/cu124', 'cpu': 'https://download.pytorch.org/whl/cpu'}
# One fully pinned, fully hashed lock per build (Python 3.12, Windows x86-64): every package incl. torch/torchaudio and all
# transitive dependencies, installed with --no-deps --require-hashes, so nothing can pull in a different torch.
NOT_THE_BUILD = ('PEAK HOUR could not reach', 'The disk filled up', 'Windows could not create a file')  # _explain_pip's wording
LOCK_FILES = {'cuda': 'stem_engine_lock_cuda.txt', 'cpu': 'stem_engine_lock_cpu.txt'}
BUILD_REQUIRES = ('setuptools',)  # what building demucs 4.0.1's sdist needs (no pyproject.toml: setuptools' legacy backend)
BUILD_FILE = '_build-requires.txt'  # the lock lines of BUILD_REQUIRES, written into the new runtime folder for the first pip run
# Runs inside the new runtime after the install: the imports the worker needs, then a real ~1 second separation of synthetic
# audio on the device the engine will use (an untrained htdemucs of the real architecture: same kernels, no checkpoint needed).
VERIFY_CODE = (
    'import json,time,torch,numpy,soundfile,demucs.pretrained,demucs.apply,demucs.htdemucs\n'
    'from demucs.htdemucs import HTDemucs\n'
    'from demucs.apply import apply_model\n'
    'device="cuda" if torch.cuda.is_available() else "cpu"\n'
    'torch.manual_seed(0)\n'
    'model=HTDemucs(["drums","bass","other","vocals"],segment=7).eval().to(device)\n'
    't=torch.arange(44100,dtype=torch.float32)/44100\n'
    'mix=torch.stack([torch.sin(2*3.14159265*220*t),torch.sin(2*3.14159265*330*t)])[None]\n'
    'start=time.time()\n'
    'with torch.inference_mode():\n'
    '    out=apply_model(model,mix,device=device,shifts=0,split=True,segment=7,overlap=.25)\n'
    'if device=="cuda":\n'
    '    torch.cuda.synchronize()\n'
    'out=out.cpu()\n'
    'assert tuple(out.shape)==(1,4,2,44100) and bool(torch.isfinite(out).all()),tuple(out.shape)\n'
    'print("PEAKHOUR "+json.dumps({"torch":torch.__version__,"cuda":device=="cuda","device":device,"numpy":numpy.__version__,"separation_seconds":round(time.time()-start,2)}))\n')
MIN_CUDA_DRIVER = 527.41  # CUDA 12.x minor-version compatibility on Windows

# what the user is told, per build: bytes to download (estimate), disk needed while installing (download cache + unpacked)
SIZES = {'cuda': {'download': 2_700_000_000, 'disk': 10_000_000_000},  # measured: torch 2.53 GB + libraries; 4.9 GB unpacked + pip's cache
         'cpu': {'download': 350_000_000, 'disk': 3_000_000_000}}
MODEL_DISK = 200_000_000

INSTALLING = 'stem-new'  # short: torch's deepest file paths must stay under Windows' 260 limit
OLD = 'stem-old'
LONGEST_RELATIVE = 140  # longest path inside the runtime: Lib\site-packages\torch\include\ATen\ops\_fake_quantize_..._dispatch.h = 136
MARKER = 'stem-engine.json'
PROGRESS_FILE = '.peak-hour-install.json'
SKIP_LIB = {'site-packages', '__pycache__', 'test', 'tests', 'idlelib', 'turtledemo', 'tkinter', 'ensurepip', 'venv',
            'EXTERNALLY-MANAGED'}


class InstallError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class BuildError(InstallError):
    """The PyTorch step failed: the one failure a different PyTorch build (CPU instead of CUDA) can fix."""


class Cancelled(Exception):
    pass


# ---------------------------------------------------------------- where things live

def runtime_dir(root=None):
    return Path(root or data_root()) / 'stem-runtime'


def models_dir(root=None):
    return Path(root or data_root()) / 'stem-models'


def legacy_root():
    return Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local') / 'AXIOM'


def python_in(runtime):
    return Path(runtime) / 'Scripts' / 'python.exe'


def model_ok(folder):
    model = Path(folder) / MODEL_FILE
    try:
        return model.is_file() and not model.is_symlink() and model.stat().st_size > 0
    except OSError:
        return False


def active_runtime(root=None):
    """The runtime in use: this app's own, else one that already exists in the old %LOCALAPPDATA%\\AXIOM folder."""
    own = runtime_dir(root)
    old = legacy_root() / 'stem-runtime'
    if not python_in(own).is_file() and python_in(old).is_file():
        return old
    return own


def active_models(root=None):
    own = models_dir(root)
    old = legacy_root() / 'stem-models'
    if not model_ok(own) and model_ok(old):
        return old
    return own


def file_sha256(path, cancel=None):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        while True:
            block = stream.read(1 << 20)
            if not block:
                return digest.hexdigest()
            if cancel is not None and cancel.is_set():
                raise Cancelled()
            digest.update(block)


# ---------------------------------------------------------------- outside world (replaced in tests)

def find_nvidia_smi():
    for candidate in (shutil.which('nvidia-smi'),
                      os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'System32', 'nvidia-smi.exe'),
                      os.path.join(os.environ.get('ProgramFiles', r'C:\Program Files'), 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')):
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


_GPU = {'value': None, 'known': False, 'thread': None}
_GPU_LOCK = threading.Lock()


def _look_for_gpu():
    value = None
    try:
        value = query_gpu()
    finally:  # "known" is always set, even if the lookup raised: otherwise the job waits 30 s and wrongly picks the CPU build
        _GPU['value'], _GPU['known'] = value, True


def start_gpu_detection():
    """Look for the GPU once, in a background thread (nvidia-smi can take 20 s). Routes never wait for it."""
    with _GPU_LOCK:
        thread = _GPU['thread']
        if _GPU['known'] or (thread is not None and thread.is_alive()):
            return thread
        _GPU['thread'] = threading.Thread(target=_look_for_gpu, name='peak-hour-gpu-detect', daemon=True)
        _GPU['thread'].start()
        return _GPU['thread']


def gpu_known():
    return _GPU['known']


def ensure_gpu_known(timeout=30):
    """For the install job's own thread (never a route): wait until the GPU lookup has finished."""
    thread = start_gpu_detection()
    if thread is not None:
        thread.join(timeout)
    return _GPU['value']


def detect_gpu():
    """{'name', 'driver', 'memory_mb'} of the first NVIDIA GPU nvidia-smi reports, or None. Never blocks: None while the
    background lookup is still running (gpu_known() says whether None means "no GPU" or "not known yet")."""
    return _GPU['value']


def query_gpu():
    exe = find_nvidia_smi()
    if not exe:
        return None
    try:
        done = subprocess.run([exe, '--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits'],
                              capture_output=True, text=True, timeout=20, creationflags=CREATE_NO_WINDOW)
        first = done.stdout.strip().splitlines()[0]
        name, driver, memory = [part.strip() for part in first.split(',')[:3]]
        return {'name': name, 'driver': float(driver), 'memory_mb': int(float(memory))}
    except (OSError, subprocess.SubprocessError, IndexError, ValueError):
        return None


def long_paths_enabled():
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SYSTEM\CurrentControlSet\Control\FileSystem') as key:
            return bool(winreg.QueryValueEx(key, 'LongPathsEnabled')[0])
    except (ImportError, OSError):
        return False


def free_bytes(path):
    path = Path(path)
    while not path.exists() and path != path.parent:
        path = path.parent
    return shutil.disk_usage(path).free


class _Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def check_url(url):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != 'https' or (parts.hostname or '').lower() not in ALLOWED_HOSTS:
        raise InstallError('bad_host', 'Refusing to download from %s (only PEAK HOUR\'s official sources are used).' % url)


def http_open(url, headers=None, timeout=45):
    check_url(url)
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context()), _Redirects())
    request = urllib.request.Request(url, headers=dict(headers or {}, **{'User-Agent': 'PEAK-HOUR-stem-installer'}))
    try:
        return opener.open(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        if error.code == 416:
            return error  # an HTTPError is a response too; the caller reads .code
        raise


def kill_tree(process, job=None):
    if job is not None:
        try:
            job.terminate()
            return
        except OSError:
            pass
    try:
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, timeout=20,
                       creationflags=CREATE_NO_WINDOW)
    except (OSError, subprocess.SubprocessError):
        process.kill()


def clean_environment():
    """No inherited PYTHON*/PIP_* settings (they could add other indexes); keep proxies, certificates and temp."""
    root = os.environ.get('SystemRoot', r'C:\Windows')
    env = {'PATH': os.pathsep.join([os.path.join(root, 'System32'), root]), 'PYTHONUTF8': '1', 'PIP_NO_INPUT': '1',
           'PIP_DISABLE_PIP_VERSION_CHECK': '1', 'NO_COLOR': '1'}
    for name in ('SystemRoot', 'SystemDrive', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
                 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'COMSPEC', 'PATHEXT', 'HTTP_PROXY', 'HTTPS_PROXY',
                 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE'):
        if name in os.environ:
            env[name] = os.environ[name]
    return env


def human(size):
    return '%.1f GB' % (size / 1e9) if size >= 1e9 else '%d MB' % round(size / 1e6)


# ---------------------------------------------------------------- the job

class StemInstaller:
    def __init__(self, root=None):
        self._root = Path(root) if root else None
        self._lock = threading.RLock()
        self._thread = None
        self._cancel = threading.Event()
        self._process = None
        self._job = None
        self._status = self._idle()
        self._stages = []
        self._done_weight = 0.0
        self._bytes = {'done': 0, 'total': 0, 'files': 0}
        self.sleep = time.sleep

    # -- paths
    @property
    def root(self):
        return self._root or Path(data_root())

    @property
    def runtime(self):
        return runtime_dir(self.root)

    @property
    def models(self):
        return models_dir(self.root)

    @property
    def partial(self):
        return self.root / INSTALLING

    # -- status
    @staticmethod
    def _idle():
        return {'state': 'idle', 'phase': '', 'detail': '', 'percent': 0, 'error': None, 'error_code': None}

    def _set(self, **changes):
        with self._lock:
            self._status.update(changes)

    def _detail(self, phase, detail, fraction=None):
        with self._lock:
            self._status['phase'] = phase
            self._status['detail'] = detail
            if fraction is not None:
                self._status['percent'] = self._percent(phase, fraction)

    def _percent(self, phase, fraction):
        fraction = max(0.0, min(1.0, fraction))
        total = sum(weight for _, weight in self._stages) or 1.0
        done = 0.0
        for name, weight in self._stages:
            if name == phase:
                return min(99, int(100 * (done + weight * fraction) / total))
            done += weight
        return self._status['percent']

    def plan(self, build='auto'):
        """What is missing and what installing it would cost; no changes."""
        runtime_ready = python_in(active_runtime(self.root)).is_file()
        model_ready = model_ok(active_models(self.root))
        gpu = detect_gpu()
        checking = gpu is None and not gpu_known()  # the lookup runs in the background: say so instead of waiting for it
        flavour = build if build in ('cuda', 'cpu') else (
            'cuda' if gpu and gpu['driver'] >= MIN_CUDA_DRIVER else 'cpu')
        marker = self._read(active_runtime(self.root) / MARKER) if runtime_ready else {}
        size = (SIZES[flavour]['download'] if not runtime_ready else 0) + (0 if model_ready else MODEL_SIZE)
        disk = (SIZES[flavour]['disk'] if not runtime_ready else 0) + (0 if model_ready else MODEL_DISK)
        return {'runtime_ready': runtime_ready, 'model_ready': model_ready, 'ready': runtime_ready and model_ready,
                'flavour': flavour, 'gpu': gpu['name'] if gpu else None, 'gpu_checking': checking, 'installed_flavour': marker.get('flavour'),
                'download_bytes': size, 'download_text': human(size), 'disk_bytes': disk, 'disk_text': human(disk),
                'resumable': self.partial.is_dir() or (self.models / (MODEL_FILE + '.part')).is_file(),
                'sources': ['download.pytorch.org', 'pypi.org', 'files.pythonhosted.org', 'dl.fbaipublicfiles.com']}

    def status(self):
        with self._lock:
            result = dict(self._status)
            running = self._thread is not None and self._thread.is_alive()
        result['running'] = running
        result.update(self.plan(result.get('requested_build', 'auto')))
        return result

    @staticmethod
    def _read(path):
        try:
            return json.loads(Path(path).read_text('utf-8'))
        except (OSError, ValueError):
            return {}

    # -- control
    def start(self, build='auto'):
        """Start the job unless one runs already. Returns (status, started)."""
        with self._lock:
            started = not (self._thread is not None and self._thread.is_alive())
            if started:
                self._cancel.clear()
                self._status = dict(self._idle(), state='running', phase='space', detail='Checking this PC.', requested_build=build)
                self._thread = threading.Thread(target=self._main, args=(build,), name='peak-hour-stem-install', daemon=True)
                self._thread.start()
        return self.status(), started

    def cancel(self):
        with self._lock:
            running = self._thread is not None and self._thread.is_alive()
            if running:
                self._cancel.set()
                self._status['state'] = 'cancelling'
                self._status['detail'] = 'Cancelling. What is already downloaded is kept.'
                process, job = self._process, self._job
        if not running:
            return self.status(), False
        if process is not None and process.poll() is None:
            kill_tree(process, job)
        return self.status(), True

    def wait(self, timeout=None):
        thread = self._thread
        if thread is not None:
            thread.join(timeout)
        return self.status()

    def _main(self, build):
        lock = None
        try:
            lock = self._take_process_lock()
            try:  # only the window that holds the cross-process lock may reset the log another window may be writing
                (self.root / 'stem-engine.log').unlink()
            except OSError:
                pass
            self._run(build)
            self._set(state='done', phase='done', detail='The stem engine is installed.', percent=100)
        except Cancelled:
            self._set(state='cancelled', detail='Cancelled. Install again to continue where it stopped.')
        except InstallError as error:
            self._fail(error.code, str(error))
        except Exception as error:  # a bug or an OS error must still end as a readable failure, never a stuck job
            self._fail('unexpected', '%s: %s' % (type(error).__name__, error))
        finally:
            self._process = None
            if lock is not None:
                self._release_process_lock(lock)

    def _fail(self, code, message):
        if self._cancel.is_set():
            self._set(state='cancelled', detail='Cancelled. Install again to continue where it stopped.')
        else:
            self._set(state='failed', error=message, error_code=code, detail=message)

    def _take_process_lock(self):
        """One installer per data folder across PEAK HOUR windows/processes (released if the process dies)."""
        self.root.mkdir(parents=True, exist_ok=True)
        handle = open(self.root / 'stem-engine.lock', 'a+b')
        try:
            import msvcrt
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except ImportError:
            pass
        except OSError:
            handle.close()
            raise InstallError('busy', 'Another PEAK HOUR window is already installing the stem engine.')
        return handle

    @staticmethod
    def _release_process_lock(handle):
        try:
            import msvcrt
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        except (ImportError, OSError):
            pass
        handle.close()

    def _check_cancel(self):
        if self._cancel.is_set():
            raise Cancelled()

    # -- the steps
    def _run(self, build):
        if build not in ('cuda', 'cpu'):
            ensure_gpu_known()  # this job's own thread may wait for nvidia-smi; a route never does
        plan = self.plan(build)
        want_runtime, want_model = not plan['runtime_ready'], not plan['model_ready']
        if not (want_runtime or want_model):
            return
        flavour = plan['flavour']
        self._stages = []
        if want_runtime:
            self._stages += [('space', 1), ('python', 3), ('pip', 2), ('packages', 66 if flavour == 'cuda' else 41), ('verify', 6)]
        else:
            self._stages += [('space', 1)]
        if want_model:
            self._stages += [('model', 10 if want_runtime else 90)]
        self._check_space(plan, want_runtime)
        self._check_cancel()
        if want_runtime:
            self._install_runtime(flavour)
        if want_model:
            self._install_model()

    def _check_space(self, plan, want_runtime):
        self._detail('space', 'Checking free disk space.', 0)
        if want_runtime and len(str(self.partial)) + LONGEST_RELATIVE > 259 and not long_paths_enabled():
            raise InstallError('path_too_long', 'The PEAK HOUR data folder (%s) is too deep for the engine files: Windows limits '
                                                'paths to 260 characters. Use a data folder closer to the drive root.' % self.root)
        need = plan['disk_bytes']
        if self.partial.is_dir():  # a resumed install already holds part of it
            need = max(0, need - sum(f.stat().st_size for f in self.partial.rglob('*') if f.is_file()))
        have = free_bytes(self.root)
        if have < need:
            drive = self.root.drive or str(self.root)
            raise InstallError('no_space', 'Not enough free disk space on %s: the stem engine needs about %s while it installs '
                                           'and %s are free. Free some space and try again.' % (drive, human(need), human(have)))
        self._detail('space', 'Enough free disk space (%s free).' % human(have), 1)

    def _install_runtime(self, flavour):
        partial = self.partial
        state = self._read(partial / PROGRESS_FILE) if partial.is_dir() else {}
        steps = state.get('steps', {})
        if (state.get('flavour') not in (None, flavour) or (partial.is_dir() and not steps.get('python'))
                or any(step in steps for step in ('torch', 'demucs'))):  # 'torch'/'demucs': an unpinned install of an older build
            self._rmtree(partial)  # a different build, or a copy that was interrupted: begin that folder again
            steps = {}
        partial.mkdir(parents=True, exist_ok=True)
        state = {'flavour': flavour, 'steps': steps}

        def done(step):
            state['steps'][step] = True
            self._write_json(partial / PROGRESS_FILE, state)

        if not steps.get('python'):
            self._detail('python', 'Preparing the Python environment.', 0)
            self._copy_python(partial)
            done('python')
        python = partial / 'python.exe'
        self._check_cancel()
        if not steps.get('pip'):
            self._detail('pip', 'Getting pip.', 0)
            self._bootstrap_pip(python, partial)
            done('pip')
        self._check_cancel()
        try:
            try:
                self._pip_lock(python, partial, flavour, state, done)
                self._verify(partial, flavour)
            except InstallError as error:
                if flavour != 'cuda' or self._cancel.is_set() or not (
                        isinstance(error, BuildError) or error.code in ('verify_failed', 'wrong_build')):
                    raise
                self._set(notice='The GPU build could not be installed (%s). Installing the CPU build; stems will be slower.' % error)
                flavour = 'cpu'
                state = {'flavour': 'cpu', 'steps': {'python': True, 'pip': True}}
                self._write_json(partial / PROGRESS_FILE, state)
                self._pip_lock(python, partial, 'cpu', state, done, force=True)
                self._verify(partial, 'cpu')
        except InstallError as error:
            if error.code in ('verify_failed', 'wrong_build'):
                self._rmtree(partial)  # an engine that does not start is not worth resuming; pip's cache keeps the downloads
            raise
        self._finish_runtime(partial, flavour)

    @staticmethod
    def lock_path(flavour):
        return Path(__file__).with_name(LOCK_FILES[flavour])

    @classmethod
    def read_lock(cls, flavour):
        """The lock's requirement lines. Refuses a missing lock or any line that is not an exact pin with a SHA-256."""
        path = cls.lock_path(flavour)
        try:
            text = path.read_text('utf-8')
        except OSError:
            raise InstallError('lock_missing', 'This PEAK HOUR install is missing %s, the list of exact package versions for the '
                                               'stem engine. Reinstall PEAK HOUR.' % path.name) from None
        lines = [line.split('#')[0].strip() for line in text.splitlines()]
        lines = [line for line in lines if line]
        pin = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]*==[0-9][A-Za-z0-9.+!_-]*(\s+--hash=sha256:[0-9a-f]{64})+$')
        bad = [line[:60] for line in lines if not pin.match(line)]
        if bad or not lines:
            raise InstallError('lock_invalid', '%s is not a fully pinned and hashed list (%s).' % (path.name, bad[0] if bad else 'empty'))
        return lines

    def _pip_lock(self, python, partial, flavour, state, done, force=False):
        """The whole engine in one pip run: the build's lock (every package, exact version, SHA-256), nothing resolved at install time."""
        if state['steps'].get('packages'):
            return
        lines = self.read_lock(flavour)
        lock = str(self.lock_path(flavour))
        sources = ['--index-url', TORCH_INDEX[flavour], '--extra-index-url', PYPI_INDEX]
        # 1. the build tools, from the lock, hash-checked, in their own run: the demucs sdist is then built in THIS runtime
        #    (--no-build-isolation) and not in pip's isolated build environment, whose installs are not hash-checked
        build = [line for line in lines if line.split('==')[0].lower() in BUILD_REQUIRES]
        if {line.split('==')[0].lower() for line in build} != set(BUILD_REQUIRES):
            raise InstallError('lock_invalid', '%s does not pin %s.' % (self.lock_path(flavour).name, ', '.join(BUILD_REQUIRES)))
        build_file = partial / BUILD_FILE
        build_file.write_text('\n'.join(build) + '\n', 'utf-8')
        self._detail('packages', 'Downloading PyTorch (%s build) and the audio libraries.' % ('GPU' if flavour == 'cuda' else 'CPU'), 0)
        extra = ['--force-reinstall'] if force else []
        try:
            if not state['steps'].get('build'):
                self._pip(python, ['install', '--no-deps', '--require-hashes', '-r', str(build_file)] + sources + extra,
                          'packages', SIZES[flavour]['download'], 'the build tools')
                done('build')
            # 2. everything else, including demucs built from its sdist with the tools installed above
            self._pip(python, ['install', '--no-deps', '--require-hashes', '--no-build-isolation', '-r', lock] + sources + extra,
                      'packages', SIZES[flavour]['download'], 'PyTorch and the audio libraries')
        except InstallError as error:
            if error.code in ('lock_missing', 'lock_invalid') or str(error).startswith(NOT_THE_BUILD):
                raise  # no internet, a full disk or a long path would fail the CPU build just the same: do not start over with it
            raise BuildError(error.code, str(error)) from None
        done('packages')

    def _copy_python(self, dest):
        base = Path(sys.base_prefix)
        version = '%d%d' % sys.version_info[:2]
        if not (base / 'python.exe').is_file() or not (base / 'Lib' / 'os.py').is_file() or not (base / ('python%s.dll' % version)).is_file():
            raise InstallError('no_python', 'This PEAK HOUR install has no complete Python to build the stem engine from (%s).' % base)
        if not (3, 9) <= sys.version_info[:2] <= (3, 13):
            raise InstallError('python_version', 'PyTorch 2.6 does not support Python %d.%d.' % sys.version_info[:2])
        self._detail('python', 'Copying Python.', 0.1)
        dlls = [p for p in base.iterdir() if p.is_file() and p.suffix.lower() in ('.dll', '.exe', '.txt') and p.name.lower() != 'pythonw.exe']
        for item in dlls:
            shutil.copy2(item, dest / item.name)
        for folder in ('DLLs', 'Lib'):
            self._check_cancel()
            shutil.copytree(base / folder, dest / folder, ignore=lambda src, names: [n for n in names if n in SKIP_LIB] if Path(src) == base / 'Lib'
                            else [n for n in names if n == '__pycache__'])
        (dest / 'Lib' / 'site-packages').mkdir(exist_ok=True)
        scripts = dest / 'Scripts'  # the worker is started as <runtime>\Scripts\python.exe (windows_stems.stem_python)
        scripts.mkdir(exist_ok=True)
        for item in dlls:
            if item.suffix.lower() == '.dll' or item.name.lower() == 'python.exe':
                shutil.copy2(item, scripts / item.name)
        self._detail('python', 'Python is ready.', 1)

    def _bootstrap_pip(self, python, partial):
        downloads = partial / '_downloads'
        downloads.mkdir(exist_ok=True)
        info = json.load(http_open(PIP_JSON))
        wheel = next((u for u in info['urls'] if u['filename'].endswith('-py3-none-any.whl')), None)
        if wheel is None:
            raise InstallError('pip_missing', 'PyPI has no pip wheel for version %s.' % PIP_VERSION)
        name = wheel['filename']
        if not isinstance(name, str) or not PIP_WHEEL_NAME.match(name) or name != 'pip-%s-py3-none-any.whl' % PIP_VERSION:
            raise InstallError('pip_missing', 'PyPI returned an unexpected pip file name.')
        if wheel['digests']['sha256'] != PIP_SHA256:  # PyPI's JSON is only used to find the file; the hash is this build's own
            raise InstallError('hash_mismatch', 'PyPI lists a different pip %s than the one PEAK HOUR was built with.' % PIP_VERSION)
        target = downloads / name
        self._download(wheel['url'], target, PIP_SHA256, wheel['size'], 'pip', 'Downloading pip.')
        site = partial / 'Lib' / 'site-packages'
        with zipfile.ZipFile(target) as archive:
            for member in archive.namelist():
                destination = (site / member).resolve()
                if site.resolve() not in destination.parents and destination != site.resolve():
                    raise InstallError('bad_archive', 'The pip download contains an unsafe path.')
            archive.extractall(site)
        shutil.rmtree(downloads, ignore_errors=True)

    def _pip(self, python, args, phase, expected_bytes, label):
        """Run pip in the runtime; stream its progress into the status. Raises InstallError when pip fails."""
        self._check_cancel()
        if 'install' in args and '--require-hashes' not in args:
            args = list(args) + ['--require-hashes']  # the only place pip is started: nothing installs without a pinned SHA-256
        command = [str(python), '-I', '-m', 'pip'] + args + ['--progress-bar', 'raw', '--isolated', '--no-input',
                                                              '--disable-pip-version-check', '--no-color',
                                                              '--retries', '5', '--timeout', '30', '--resume-retries', '5']
        tail = []
        seen = {'finished': 0, 'file_total': 0, 'current': 0, 'name': label}

        def on_line(line):
            tail.append(line)
            del tail[:-30]
            match = re.match(r'Downloading (\S+) \(([\d.]+) ([kKMG]?B)\)', line)
            if match:
                seen['finished'] += seen['current'] if seen['file_total'] else 0
                seen['file_total'] = int(float(match.group(2)) * {'B': 1, 'kB': 1e3, 'KB': 1e3, 'MB': 1e6, 'GB': 1e9}[match.group(3)])
                seen['current'] = 0
                seen['name'] = match.group(1).split('-')[0]
                return
            match = re.match(r'Progress (\d+) of (\d+)', line)
            if match:
                seen['current'] = int(match.group(1))
                got = seen['finished'] + seen['current']
                total = max(expected_bytes, seen['finished'] + seen['file_total'])
                self._detail(phase, 'Downloading %s (%s of about %s).' % (seen['name'], human(got), human(total)), 0.95 * got / total)
            elif line.startswith('Installing collected packages'):
                self._detail(phase, 'Installing %s.' % label, 0.96)
            elif line.startswith('Successfully installed'):
                self._detail(phase, 'Installed %s.' % label, 1)

        code = self._run_process(command, on_line, cwd=str(python.parent))
        self._check_cancel()
        if code != 0:
            raise InstallError('pip_failed', self._explain_pip(tail) or 'pip stopped with code %s while installing %s.' % (code, label))

    @staticmethod
    def _explain_pip(lines):
        text = '\n'.join(lines)
        if re.search(r'getaddrinfo|Connection|timed out|Temporary failure|NameResolution|ProxyError|SSLError', text):
            return 'PEAK HOUR could not reach the download servers. Check the internet connection and try again.'
        if re.search(r'No space left|Errno 28', text):
            return 'The disk filled up while installing. Free some space and try again.'
        if re.search(r'Errno 2\]|FileNotFoundError|path.*too long|WinError 206', text):
            return 'Windows could not create a file with a very long path. Move the PEAK HOUR data folder closer to the drive root.'
        if re.search(r'No matching distribution', text):
            return 'The download server has no matching build for this PC.'
        last = [line for line in lines if line.strip()][-1:] or ['']
        return 'pip failed: ' + last[0][:200]

    def _run_process(self, command, on_line, cwd=None):
        """Run a console-less child, feed its output lines to on_line; killed on cancel (and with the app, via a job)."""
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                   text=True, encoding='utf-8', errors='replace', env=clean_environment(), cwd=cwd,
                                   creationflags=CREATE_NO_WINDOW)
        job = None
        try:
            from windows_job import Job
            job = Job()
            job.assign(int(process._handle))
        except Exception:
            job = None
        with self._lock:
            self._process, self._job = process, job
        try:
            if self._cancel.is_set():
                kill_tree(process, job)
            for line in process.stdout:
                line = line.rstrip()
                if line:
                    self._log(line)
                    on_line(line)
            return process.wait()
        finally:
            with self._lock:
                self._process, self._job = None, None
            if process.poll() is None:
                kill_tree(process, job)
            if job is not None:
                job.close()

    def _verify(self, partial, flavour):
        self._detail('verify', 'Checking the engine.', 0.1)
        code = VERIFY_CODE
        out = []
        status = self._run_process([str(python_in(partial)), '-I', '-B', '-c', code], out.append, cwd=str(partial))
        self._check_cancel()
        result = next((json.loads(l[9:]) for l in out if l.startswith('PEAKHOUR ')), None)
        if status != 0 or not result:
            raise InstallError('verify_failed', 'The installed engine does not start or cannot separate audio: ' + ((out or ['no output'])[-1])[:200])
        if flavour == 'cuda' and '+cu' not in result['torch']:
            raise InstallError('wrong_build', 'PyTorch installed without GPU support (%s).' % result['torch'])
        self._engine_info = result
        if not result['torch'].startswith('2.6.0'):
            raise InstallError('wrong_build', 'PyTorch %s was installed instead of the pinned 2.6.0.' % result['torch'])
        self._detail('verify', 'The engine separates audio (PyTorch %s, %s).' % (result['torch'], 'GPU ready' if result['cuda'] else 'CPU'), 1)

    def _finish_runtime(self, partial, flavour):
        info = dict(getattr(self, '_engine_info', {}), flavour=flavour, installed=time.strftime('%Y-%m-%dT%H:%M:%S'),
                    demucs='4.0.1', complete=True)
        self._rmtree(partial / '_downloads')
        self._write_json(partial / MARKER, info)
        self._check_cancel()  # the last moment a cancel keeps the folder out of place
        final, old = self.runtime, self.root / OLD
        self._rmtree(old)
        if final.exists():  # a stale folder without a working Python (the check above would otherwise have skipped installing)
            self._replace(final, old)
        self._replace(partial, final)  # one rename: before it there is no stem-runtime\Scripts\python.exe, after it all of it
        self._rmtree(old)

    def _replace(self, source, target):
        """os.replace of a folder; Windows refuses it ("Access is denied") for a while after thousands of files were just written
        (virus scanner, search indexer): measured on the real install, the same rename worked seconds later."""
        for attempt in range(40):
            try:
                os.replace(source, target)
                return
            except PermissionError:
                if attempt == 39:
                    raise
                self._check_cancel()
                self._detail('verify', 'Windows is still scanning the new files; finishing in a moment.')
                self.sleep(1.5)

    # -- the checkpoint
    def _install_model(self):
        self.models.mkdir(parents=True, exist_ok=True)
        target = self.models / MODEL_FILE
        self._download(MODEL_URL, target, MODEL_SHA256, MODEL_SIZE, 'model', 'Downloading the separation model.')

    def _download(self, url, target, sha256, size, phase, label):
        """Resumable download of one file into target (via target.part); hash-checked before it takes its name."""
        target = Path(target)
        part = target.with_name(target.name + '.part')
        if target.is_file() and file_sha256(target, self._cancel) == sha256:
            self._detail(phase, label, 1)
            return
        attempts = 0
        while True:
            self._check_cancel()
            have = part.stat().st_size if part.is_file() else 0
            if have > size:
                part.unlink()
                have = 0
            try:
                if have == size:
                    pass
                else:
                    self._fetch_range(url, part, have, size, phase, label)
            except (OSError, urllib.error.URLError, TimeoutError) as error:
                attempts += 1
                if attempts >= 6:
                    raise InstallError('network', 'PEAK HOUR could not finish downloading %s (%s). Check the internet connection and try again; '
                                                  'the download continues where it stopped.' % (url.split('/')[2], error))
                self._detail(phase, 'Connection interrupted; resuming (%d of 5).' % attempts)
                self.sleep(min(30, 2 * attempts))
                continue
            if part.is_file() and part.stat().st_size == size:
                break
            attempts += 1
            if attempts >= 6:
                raise InstallError('network', 'The download from %s ended early. Try again; it continues where it stopped.' % url.split('/')[2])
        self._detail(phase, 'Checking the download.', 0.99)
        if file_sha256(part, self._cancel) != sha256:
            part.unlink()
            raise InstallError('hash_mismatch', 'The downloaded file did not match its official checksum and was discarded. Try again.')
        os.replace(part, target)
        self._detail(phase, label, 1)

    def _fetch_range(self, url, part, have, size, phase, label):
        headers = {'Range': 'bytes=%d-' % have} if have else {}
        response = http_open(url, headers)
        try:
            code = getattr(response, 'status', None) or getattr(response, 'code', 200)
            if code == 416:  # the server holds fewer bytes than our part: start over
                part.unlink()
                return
            if code not in (200, 206):
                raise InstallError('http_%s' % code, 'The download server answered HTTP %s.' % code)
            mode = 'ab'
            if code == 200 and have:  # Range ignored: the body is the whole file
                mode, have = 'wb', 0
            done = have
            with open(part, mode) as out:
                while True:
                    self._check_cancel()
                    block = response.read(1 << 18)
                    if not block:
                        break
                    out.write(block)
                    done += len(block)
                    self._detail(phase, '%s %s of %s.' % (label, human(done), human(size)), 0.97 * done / size)
        finally:
            response.close()

    # -- small helpers
    def _log(self, line):
        """Everything pip and the checks print, for support: <data>/stem-engine.log (reset when a job starts)."""
        try:
            with open(self.root / 'stem-engine.log', 'a', encoding='utf-8') as stream:
                stream.write(line + '\n')
        except OSError:
            pass

    @staticmethod
    def _write_json(path, data):
        Path(path).write_text(json.dumps(data), 'utf-8')

    @staticmethod
    def _rmtree(path):
        path = Path(path)
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=False)
        elif path.exists():
            path.unlink()


INSTALLER = StemInstaller()


# ---------------------------------------------------------------- HTTP

def create_blueprint(installer=None, can_install=True):
    """The status route always; install and cancel only where an engine could be used (can_install)."""
    from flask import Blueprint, jsonify, request
    blueprint = Blueprint('windows_stem_installer', __name__)

    def local_only():
        """Same rule as the djay/Serato write routes: this PC only, this app's own host, and a same-origin request."""
        origin = request.headers.get('Origin')
        site = request.headers.get('Sec-Fetch-Site')
        if (request.remote_addr not in ('127.0.0.1', '::1') or request.host.split(':')[0] not in ('127.0.0.1', 'localhost')
                or not origin or origin.rstrip('/') != request.host_url.rstrip('/')
                or (site is not None and site not in ('same-origin', 'none'))):
            return jsonify(success=False, error='Installing the stem engine requires the local PEAK HOUR engine.'), 403
        return None

    def current():
        return installer or INSTALLER

    @blueprint.get('/api/windows/stem-engine/status')
    def status():
        return jsonify(success=True, **current().status())

    if not can_install:
        return blueprint

    @blueprint.post('/api/windows/stem-engine/install')
    def install():
        refused = local_only()
        if refused:
            return refused
        body = request.get_json(silent=True)
        build = body.get('build') if isinstance(body, dict) else None
        result, started = current().start(build if build in ('cuda', 'cpu') else 'auto')
        return jsonify(success=True, started=started, **result), 202 if started else 200

    @blueprint.post('/api/windows/stem-engine/cancel')
    def cancel():
        refused = local_only()
        if refused:
            return refused
        result, cancelled = current().cancel()
        return jsonify(success=True, cancelled=cancelled, **result)
    return blueprint


NEEDS_ENGINE = {'stem_runtime_missing', 'stem_model_missing'}


def make_after_request(installer=None):
    """Replaces the Mac wording of studio_daw.stems' 503 (its start() is compiled) with the Windows answer."""
    def after(response):
        if response.status_code != 503 or response.mimetype != 'application/json':
            return response
        try:
            data = json.loads(response.get_data(as_text=True))
        except ValueError:
            return response
        if not isinstance(data, dict) or data.get('code') not in NEEDS_ENGINE:
            return response
        plan = (installer or INSTALLER).plan()
        missing = data['code']
        if missing == 'stem_runtime_missing':
            data['error'] = 'Stems need a one-time engine download (about %s).' % plan['download_text']
        else:
            data['error'] = 'Stems need a one-time download of the separation model (about %s).' % human(MODEL_SIZE)
        data['install_required'] = True
        if isinstance(data.get('identity'), dict):
            data['identity'].pop('macos_version', None)  # a Mac build detail; nothing on this page reads it
        data['stem_engine'] = {k: plan[k] for k in ('runtime_ready', 'model_ready', 'flavour', 'gpu', 'gpu_checking', 'download_text', 'disk_text', 'sources')}
        response.set_data(json.dumps(data))
        response.headers['Content-Length'] = str(len(response.get_data()))
        return response
    return after


def install(app, can_install=True):
    """Routes and the 503 rewrite; app is AXIOM's app module (flask app in app.app). The status route and the Windows wording of
    the stems 503 are always registered, so the Mac wording never shows; install/cancel only when can_install."""
    flask_app = app.app
    if getattr(flask_app, '_windows_stem_installer', False):
        return
    start_gpu_detection()  # nvidia-smi can take seconds: look once in the background, never inside a route
    flask_app.register_blueprint(create_blueprint(can_install=can_install))
    flask_app.after_request(make_after_request())
    flask_app._windows_stem_installer = True
