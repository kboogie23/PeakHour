"""The Windows "Install stem engine" job (windows_stem_installer): network, pip and the interpreter copy are faked, the
rest is real (threads, files, the flask routes, console-less child processes, killing a child on cancel).

Checks: not enough disk space is refused before anything is written; the checkpoint download resumes with a Range
request after a dropped connection (and when the server ignores Range); a wrong checksum discards the file; Cancel stops
the job, keeps what was done and the next start skips the finished steps; a second start while one runs does nothing;
stem-runtime\\Scripts\\python.exe never exists before the whole install and its check passed (not while running, not after
a failure); a CUDA build that cannot be installed falls back to the CPU build; only the four official https hosts are
accepted; pip's progress lines become the percentage and the text; children get CREATE_NO_WINDOW; the 503 the Mac stems
code returns is rewritten with Windows wording and the routes are local-only."""
import hashlib, json, os, shutil, subprocess, sys, tempfile, threading, time, traceback, uuid
from pathlib import Path

workspace = Path(__file__).resolve().parent
probe = workspace / 'axiom-win-probe'
base = workspace / 'fixtures' / 'stem_installer'
base.mkdir(parents=True, exist_ok=True)
root = base / uuid.uuid4().hex[:8]
home = root / 'home'
(home / 'AppData' / 'Local').mkdir(parents=True)
os.environ.update({'USERPROFILE': str(home), 'HOME': str(home), 'LOCALAPPDATA': str(home / 'AppData' / 'Local'),
                   'APPDATA': str(home / 'AppData' / 'Roaming'), 'AXIOM_RUNTIME_DIR': str(root / 'data')})
sys.path.insert(0, str(probe))
os.chdir(probe)

import windows_stem_installer as W  # noqa: E402

GOOD_GPU = {'name': 'Test RTX', 'driver': 576.0, 'memory_mb': 6144}
payload = os.urandom(900_000)
W.MODEL_SHA256 = hashlib.sha256(payload).hexdigest()
W.MODEL_SIZE = len(payload)
REAL_GPU = (W.detect_gpu, W.gpu_known, W.query_gpu, W.ensure_gpu_known)
W.detect_gpu = lambda: GOOD_GPU
W.gpu_known = lambda: True
W.ensure_gpu_known = lambda timeout=30: None
W.free_bytes = lambda path: 500 * 10 ** 9
W.long_paths_enabled = lambda: True


def fresh(name):
    folder = root / name
    shutil.rmtree(folder, ignore_errors=True)
    inst = W.StemInstaller(folder)
    inst.sleep = lambda seconds: None
    return inst, folder


class Response:
    def __init__(self, status, body, drop_after=None):
        self.status, self.body, self.drop_after, self.sent = status, body, drop_after, 0
        self.headers = {}

    def read(self, n):
        if self.drop_after is not None and self.sent >= self.drop_after:
            raise ConnectionResetError(10054, 'connection reset')
        limit = n if self.drop_after is None else min(n, self.drop_after - self.sent)
        chunk, self.body = self.body[:limit], self.body[limit:]
        self.sent += len(chunk)
        return chunk

    def close(self):
        pass


class Server:
    """Stands in for dl.fbaipublicfiles.com. drops: bytes to deliver before each successive connection breaks."""
    def __init__(self, data, drops=(), honour_range=True, corrupt=False):
        self.data, self.drops, self.honour_range, self.requests = data, list(drops), honour_range, []
        if corrupt:
            self.data = bytes([data[0] ^ 1]) + data[1:]

    def __call__(self, url, headers=None, timeout=45):
        W.check_url(url)
        headers = headers or {}
        self.requests.append(dict(headers))
        drop = self.drops.pop(0) if self.drops else None
        start = int(headers['Range'].split('=')[1].rstrip('-')) if 'Range' in headers and self.honour_range else 0
        return Response(206 if start else 200, self.data[start:], drop)


def finish(inst, timeout=60):
    inst.wait(timeout)
    status = inst.status()
    assert not status['running'], status
    return status


def fake_steps(inst, log, pip=None, verify_error=None):
    """The parts that need the network or a real interpreter. log collects what would have run."""
    def copy_python(dest):
        log.append('copy')
        (dest / 'Scripts').mkdir(parents=True, exist_ok=True)
        (dest / 'Scripts' / 'python.exe').write_bytes(b'MZ')
        (dest / 'python.exe').write_bytes(b'MZ')

    def bootstrap(python, partial):
        log.append('pip-bootstrap')

    def run_pip(python, args, phase, expected, label):
        log.append(('pip', phase, tuple(args)))
        if pip:
            pip(inst, phase, args)
        inst._check_cancel()

    def verify(partial, flavour):
        log.append(('verify', flavour))
        if verify_error:
            raise verify_error
        inst._engine_info = {'torch': '2.6.0+' + ('cu124' if flavour == 'cuda' else 'cpu'), 'cuda': flavour == 'cuda', 'numpy': '1.26.4'}
    inst._copy_python, inst._bootstrap_pip, inst._pip, inst._verify = copy_python, bootstrap, run_pip, verify


def python_present(folder):
    return (Path(folder) / 'stem-runtime' / 'Scripts' / 'python.exe').exists()


def models_present(folder):
    return (Path(folder) / 'stem-models' / W.MODEL_FILE).exists()


try:
    # 1. not enough space: refused, nothing written, message names the need
    inst, folder = fresh('space')
    W.free_bytes = lambda path: 2 * 10 ** 9
    log = []
    fake_steps(inst, log)
    inst.start()
    status = finish(inst)
    W.free_bytes = lambda path: 500 * 10 ** 9
    assert status['state'] == 'failed' and status['error_code'] == 'no_space', status
    assert 'free' in status['error'] and 'GB' in status['error'] and log == [], (status['error'], log)
    assert not (folder / W.INSTALLING).exists() and not python_present(folder) and not models_present(folder)

    # 2. checkpoint: the connection drops twice; each retry sends Range from the .part size; the file is verified and renamed
    inst, folder = fresh('model')
    log = []
    server = Server(payload, drops=[300_000, 250_000])
    W.http_open = server
    inst._copy_python = None
    inst.plan = lambda build='auto': dict(W.StemInstaller.plan(inst, build), runtime_ready=True, flavour='cpu')
    # the runtime is "ready" for this case, so only the model is missing
    inst.start()
    status = finish(inst)
    assert status['state'] == 'done', status
    assert [r.get('Range') for r in server.requests] == [None, 'bytes=300000-', 'bytes=550000-'], server.requests
    final = folder / 'stem-models' / W.MODEL_FILE
    assert final.read_bytes() == payload and not final.with_name(final.name + '.part').exists()
    assert status['percent'] == 100

    # 2b. a server that ignores Range answers 200 with the whole file: the resume starts over instead of appending
    inst, folder = fresh('model_norange')
    server = Server(payload, drops=[200_000], honour_range=False)
    W.http_open = server
    inst.plan = lambda build='auto': dict(W.StemInstaller.plan(inst, build), runtime_ready=True)
    inst.start()
    status = finish(inst)
    assert status['state'] == 'done' and (folder / 'stem-models' / W.MODEL_FILE).read_bytes() == payload, status

    # 3. wrong checksum: discarded, never named like the model, a clear error
    inst, folder = fresh('model_bad')
    W.http_open = Server(payload, corrupt=True)
    inst.plan = lambda build='auto': dict(W.StemInstaller.plan(inst, build), runtime_ready=True)
    inst.start()
    status = finish(inst)
    assert status['state'] == 'failed' and status['error_code'] == 'hash_mismatch', status
    assert not models_present(folder) and not list((folder / 'stem-models').glob('*')), list((folder / 'stem-models').glob('*'))

    # 4. cancel keeps the work; the next start skips the finished steps; the runtime appears only at the very end
    inst, folder = fresh('cancel')
    log, gate = [], threading.Event()
    seen_python = []

    def blocking(i, phase, args):
        seen_python.append(python_present(folder))  # while running, stem-runtime\Scripts\python.exe must not exist
        if phase == 'packages' and not gate.is_set():
            gate.set()
            while not i._cancel.is_set():
                time.sleep(0.02)
    fake_steps(inst, log, pip=blocking)
    inst.plan = lambda build='auto': dict(W.StemInstaller.plan(inst, build), model_ready=True)
    inst.start()
    assert gate.wait(10)
    second, started = inst.start()
    assert started is False and second['running'], (started, second)  # 5. a second start while one runs does nothing
    _, cancelled = inst.cancel()
    assert cancelled
    status = finish(inst)
    assert status['state'] == 'cancelled', status
    assert (folder / W.INSTALLING).is_dir() and not python_present(folder), 'partial kept, runtime not published'
    assert log.count('copy') == 1 and log.count('pip-bootstrap') == 1
    log.clear()
    inst.start()
    status = finish(inst)
    assert status['state'] == 'done' and python_present(folder), status
    assert 'copy' not in log and 'pip-bootstrap' not in log, log  # finished steps are not repeated
    pips = [e for e in log if isinstance(e, tuple) and e[0] == 'pip']
    assert [e[1] for e in pips] == ['packages', 'packages'], log  # two hash-checked runs: the build tool, then the whole engine from the lock
    assert not any(seen_python), seen_python
    marker = json.loads((folder / 'stem-runtime' / W.MARKER).read_text('utf-8'))
    assert marker['complete'] is True and marker['flavour'] == 'cuda' and not (folder / W.INSTALLING).exists(), marker

    # 6. a failed install never leaves a runtime that passes the "python exists" check
    inst, folder = fresh('failed')
    log = []

    def failing(i, phase, args):
        if phase == 'packages':
            raise W.InstallError('pip_failed', 'PEAK HOUR could not reach the download servers. Check the internet connection and try again.')
    fake_steps(inst, log, pip=failing)
    inst.plan = lambda build='auto': dict(W.StemInstaller.plan(inst, build), model_ready=True)
    inst.start()
    status = finish(inst)
    assert status['state'] == 'failed' and status['error'].startswith('PEAK HOUR could not reach') and status['error_code'] == 'pip_failed', status
    assert not any(e[0] == 'pip' and 'cpu' in e[2][-3] for e in log if isinstance(e, tuple) and e[0] == 'pip'), log  # no pointless CPU retry
    assert not python_present(folder) and (folder / W.INSTALLING / 'Scripts' / 'python.exe').exists()
    assert W.python_in(W.active_runtime(folder)) == folder / 'stem-runtime' / 'Scripts' / 'python.exe'
    assert not W.python_in(W.active_runtime(folder)).exists() and status['runtime_ready'] is False
    # ... and a retry resumes (no second copy), then publishes
    log.clear()
    fake_steps(inst, log)
    inst.start()
    status = finish(inst)
    assert status['state'] == 'done' and 'copy' not in log and python_present(folder), (status, log)
    # an engine that fails its start check is thrown away entirely
    inst, folder = fresh('verify')
    fake_steps(inst, [], verify_error=W.InstallError('verify_failed', 'import error'))
    inst.plan = lambda build='auto': dict(W.StemInstaller.plan(inst, build), model_ready=True, flavour='cpu')
    inst.start()
    status = finish(inst)
    assert status['error_code'] == 'verify_failed' and not python_present(folder) and not (folder / W.INSTALLING).exists(), status

    # 7. CUDA that cannot be installed -> the same job installs the CPU build
    inst, folder = fresh('fallback')
    log = []

    def cuda_fails(i, phase, args):
        if phase == 'packages' and 'https://download.pytorch.org/whl/cu124' in args:
            raise W.InstallError('pip_failed', 'No matching distribution')
    fake_steps(inst, log, pip=cuda_fails)
    inst.plan = lambda build='auto': dict(W.StemInstaller.plan(inst, build), model_ready=True)
    inst.start()
    status = finish(inst)
    assert status['state'] == 'done', status
    torch_calls = [e for e in log if isinstance(e, tuple) and e[1] == 'packages']
    # the failed CUDA build-tool run, then the CPU build's own two runs (build tool, then the lock)
    assert len(torch_calls) == 3 and all('https://download.pytorch.org/whl/cpu' in c[2] and '--force-reinstall' in c[2] for c in torch_calls[1:]), torch_calls
    assert 'CPU build' in status['notice'], status
    assert json.loads((folder / 'stem-runtime' / W.MARKER).read_text('utf-8'))['flavour'] == 'cpu'
    assert torch_calls[2][2][torch_calls[2][2].index('-r') + 1].endswith('stem_engine_lock_cpu.txt'), torch_calls[2]

    # 8. which build: CUDA only with an NVIDIA GPU whose driver can run it
    inst, folder = fresh('plan')
    assert inst.plan()['flavour'] == 'cuda'
    W.detect_gpu = lambda: {'name': 'Old', 'driver': 391.0, 'memory_mb': 2048}
    assert inst.plan()['flavour'] == 'cpu'
    W.detect_gpu = lambda: None
    plan = inst.plan()
    assert plan['flavour'] == 'cpu' and plan['download_bytes'] < 10 ** 9 and not plan['ready'], plan
    assert inst.plan('cuda')['flavour'] == 'cuda'
    W.detect_gpu = lambda: GOOD_GPU
    assert inst.plan()['download_bytes'] > 2 * 10 ** 9 and 'GB' in inst.plan()['download_text']

    # 9. old %LOCALAPPDATA%\AXIOM runtime is still used when it exists; the new folder wins once it exists
    inst, folder = fresh('legacy')
    old = W.legacy_root() / 'stem-runtime' / 'Scripts'
    old.mkdir(parents=True)
    (old / 'python.exe').write_bytes(b'MZ')
    assert W.active_runtime(folder) == W.legacy_root() / 'stem-runtime' and inst.plan()['runtime_ready']
    (folder / 'stem-runtime' / 'Scripts').mkdir(parents=True)
    (folder / 'stem-runtime' / 'Scripts' / 'python.exe').write_bytes(b'MZ')
    assert W.active_runtime(folder) == folder / 'stem-runtime'
    shutil.rmtree(W.legacy_root())

    # 9b. a data folder too deep for torch's longest file name is refused up front (Windows' 260 limit), with a way out
    deep = root / ('d' * 120)
    inst = W.StemInstaller(deep)
    W.long_paths_enabled = lambda: False
    inst.plan = lambda build='auto': dict(W.StemInstaller.plan(inst, build), model_ready=True)
    inst.start()
    status = finish(inst)
    W.long_paths_enabled = lambda: True
    assert status['error_code'] == 'path_too_long' and 'closer to the drive root' in status['error'], status

    # 10. only the official https hosts
    for good in ('https://download.pytorch.org/whl/cu124/torch/', 'https://pypi.org/simple/numpy/',
                 'https://files.pythonhosted.org/packages/x.whl', 'https://dl.fbaipublicfiles.com/demucs/x.th'):
        W.check_url(good)
    for bad in ('http://download.pytorch.org/x', 'https://evil.example/x', 'https://download.pytorch.org.evil.example/x',
                'https://pypi.org@evil.example/x', 'ftp://pypi.org/x', 'file:///C:/x'):
        try:
            W.check_url(bad)
        except W.InstallError as error:
            assert error.code == 'bad_host'
        else:
            raise AssertionError('accepted ' + bad)
    assert all(h in W.ALLOWED_HOSTS for h in ('download.pytorch.org', 'pypi.org', 'files.pythonhosted.org', 'dl.fbaipublicfiles.com'))
    assert all(u.startswith('https://') for u in (W.MODEL_URL, W.PIP_JSON, W.PYPI_INDEX, *W.TORCH_INDEX.values()))

    # 11. the real pip runner: progress lines -> percent and text; the child has no console; Cancel kills it
    inst, folder = fresh('pip')
    folder.mkdir(parents=True)
    fake_python = folder / 'fakepip.cmd'
    fake_python.write_text('@echo off\r\necho Collecting torch==2.6.0\r\necho Downloading torch-2.6.0%%2Bcu124-cp312-cp312-win_amd64.whl (2.5 GB)\r\n'
                           'echo Progress 0 of 2500000000\r\necho Progress 1500000000 of 2500000000\r\necho Progress 2500000000 of 2500000000\r\n'
                           'echo Installing collected packages: torch\r\necho Successfully installed torch-2.6.0\r\n', 'utf-8')
    inst._stages = [('torch', 50), ('packages', 50)]
    snapshots = []
    original = inst._detail
    inst._detail = lambda phase, detail, fraction=None: (original(phase, detail, fraction), snapshots.append((inst._status['percent'], detail)))
    flags = []
    real_popen = subprocess.Popen

    class Spy(real_popen):
        def __init__(self, *a, **k):
            flags.append(k.get('creationflags', 0))
            super().__init__(*a, **k)
    subprocess.Popen = Spy
    try:
        inst._pip(fake_python, ['install', 'torch==2.6.0'], 'torch', 2_500_000_000, 'PyTorch')
    finally:
        subprocess.Popen = real_popen
    percents = [p for p, _ in snapshots]
    assert percents == sorted(percents) and percents[-1] == 50, snapshots  # 'torch' is half of this plan
    assert any('1.5 GB of about 2.5 GB' in d for _, d in snapshots) and any(d.startswith('Installed') for _, d in snapshots), snapshots
    assert flags and all(f & 0x08000000 for f in flags), flags
    assert 'Successfully installed' in (folder / 'stem-engine.log').read_text('utf-8')
    slow = folder / 'slow.cmd'
    slow.write_text('@echo off\r\necho Downloading x-1.whl (1.0 GB)\r\nping -n 60 127.0.0.1 > nul\r\n', 'utf-8')
    box = {}

    def run_slow():
        try:
            inst._pip(slow, ['install', 'x'], 'torch', 10 ** 9, 'x')
        except BaseException as error:
            box['error'] = error
    inst._cancel.clear()
    runner = threading.Thread(target=run_slow)
    runner.start()
    for _ in range(100):
        if inst._process is not None:
            break
        time.sleep(0.05)
    assert inst._process is not None
    pid = inst._process.pid
    started = time.time()
    inst._cancel.set()
    W.kill_tree(inst._process, inst._job)
    runner.join(20)
    assert not runner.is_alive() and isinstance(box.get('error'), W.Cancelled), box
    assert time.time() - started < 15
    assert subprocess.run(['tasklist', '/FI', 'PID eq %d' % pid], capture_output=True, text=True, creationflags=0x08000000).stdout.count(str(pid)) == 0
    assert 'could not reach' in W.StemInstaller._explain_pip(['ERROR: Could not install: ProxyError'])
    assert 'filled up' in W.StemInstaller._explain_pip(['OSError: [Errno 28] No space left on device'])

    # 12. HTTP: routes are local-only, status/install/cancel answer, the Mac wording of stems' 503 becomes the Windows one
    from flask import Flask, jsonify
    inst, folder = fresh('http')
    log = []
    gate = threading.Event()

    def hold(i, phase, args):
        gate.set()
        while not i._cancel.is_set():
            time.sleep(0.02)
    fake_steps(inst, log, pip=hold)
    inst.plan = lambda build='auto': dict(W.StemInstaller.plan(inst, build), model_ready=True)
    flask_app = Flask('t')
    flask_app.register_blueprint(W.create_blueprint(inst))
    flask_app.after_request(W.make_after_request(inst))

    @flask_app.post('/api/studio-daw/stems')
    def stems():
        return jsonify(error='This app is missing its stem engine. Reinstall the complete AXIOM app for this Mac; copying a project alone cannot install the engine.',
                       code='stem_runtime_missing', identity={'build': 'x', 'macos_version': '14.5'}), 503

    @flask_app.post('/api/studio-daw/model')
    def model():
        return jsonify(error='This app is missing its local stem model. Reinstall the complete AXIOM app for this Mac. No download was attempted.',
                       code='stem_model_missing'), 503

    @flask_app.post('/api/studio-daw/other')
    def other():
        return jsonify(error='This app is missing its audio decoder. Reinstall the complete AXIOM app for this Mac.', code='stem_decoder_missing'), 503
    client = flask_app.test_client()
    local = {'Host': '127.0.0.1', 'Origin': 'http://127.0.0.1'}
    answer = client.post('/api/studio-daw/stems', headers=local)
    data = answer.get_json()
    assert answer.status_code == 503 and data['code'] == 'stem_runtime_missing' and data['install_required'] is True, data
    assert data['error'].startswith('Stems need a one-time engine download (about ') and 'Mac' not in data['error'], data
    assert data['stem_engine']['download_text'] and data['identity'] == {'build': 'x'}, data['identity']  # the Mac version key is dropped
    data = client.post('/api/studio-daw/model', headers=local).get_json()
    assert data['install_required'] and 'separation model' in data['error'] and 'Mac' not in data['error'], data
    data = client.post('/api/studio-daw/other', headers=local).get_json()
    assert 'install_required' not in data and 'Mac' in data['error']  # the decoder error is not ours to rewrite
    assert client.get('/api/windows/stem-engine/status', headers=local).get_json()['state'] == 'idle'
    refused = client.post('/api/windows/stem-engine/install', headers={'Host': '127.0.0.1', 'Origin': 'http://evil.example'})
    assert refused.status_code == 403 and not inst.status()['running'], refused.status_code
    refused = client.post('/api/windows/stem-engine/install', headers={'Host': 'attacker.example'})
    assert refused.status_code == 403
    started = client.post('/api/windows/stem-engine/install', json={}, headers=local)
    assert started.status_code == 202 and started.get_json()['started'] is True
    assert gate.wait(10)
    again = client.post('/api/windows/stem-engine/install', json={}, headers=local)
    assert again.status_code == 200 and again.get_json()['started'] is False
    assert client.get('/api/windows/stem-engine/status', headers=local).get_json()['running'] is True
    assert client.post('/api/windows/stem-engine/cancel', headers=local).get_json()['cancelled'] is True
    finish(inst)
    assert client.get('/api/windows/stem-engine/status', headers=local).get_json()['state'] == 'cancelled'

    # 12b. the pinned engine: ONE hashed lock per build, installed with --no-deps --require-hashes from the official indexes only
    import re as _re, io as _io, zipfile as _zip
    for flavour, torch_tag in (('cuda', '+cu124'), ('cpu', '+cpu')):
        lines = W.StemInstaller.read_lock(flavour)  # raises unless every line is name==version plus a sha256
        names = {l.split('==')[0] for l in lines}
        assert len(lines) == len(names) >= 25, (flavour, len(lines))
        assert {'torch', 'torchaudio', 'demucs', 'numpy', 'soundfile', 'einops', 'julius', 'pyyaml', 'tqdm', 'lameenc', 'openunmix',
                'dora-search', 'setuptools'} <= names, names
        pins = dict(l.split(' ')[0].split('==') for l in lines)
        assert pins['torch'] == '2.6.0' + torch_tag and pins['torchaudio'] == '2.6.0' + torch_tag, (flavour, pins['torch'])
        assert pins['demucs'] == '4.0.1' and pins['numpy'] == '1.26.4', pins
        assert b'\r\n' in W.StemInstaller.lock_path(flavour).read_bytes() and all(_re.search(r'--hash=sha256:[0-9a-f]{64}', l) for l in lines)
        # the unpinned lists are gone
        assert not hasattr(W, 'DEPENDENCY_PINS') and not hasattr(W, 'TORCH_PINS') and not hasattr(W, 'DEMUCS_REQUIREMENT')
    cuda_lock = {l.split(' ')[0] for l in W.StemInstaller.read_lock('cuda')}
    cpu_lock = {l.split(' ')[0] for l in W.StemInstaller.read_lock('cpu')}
    assert {x.split('==')[0] for x in cuda_lock - cpu_lock} == {'torch', 'torchaudio'}, cuda_lock ^ cpu_lock  # only the torch build differs
    inst, folder = fresh('lockrun')
    seen_args = []
    inst._pip = lambda python, args, phase, expected, label: seen_args.append((phase, list(args)))
    (folder / W.INSTALLING).mkdir(parents=True)
    state = {'flavour': 'cuda', 'steps': {}}
    inst._pip_lock(Path('python.exe'), folder / W.INSTALLING, 'cuda', state, lambda step: state['steps'].__setitem__(step, True))
    (build_phase, build_args), (phase, args) = seen_args  # two pip runs: the build tool first, then everything else
    lock = str(W.StemInstaller.lock_path('cuda'))
    sources = ('https://download.pytorch.org/whl/cu124', 'https://pypi.org/simple')
    # run 1: the build requirements only (setuptools, from the lock), hash-checked, so the sdist build needs nothing unchecked
    assert build_phase == 'packages' and build_args[:3] == ['install', '--no-deps', '--require-hashes'], build_args
    build_file = Path(build_args[build_args.index('-r') + 1])
    build_text = build_file.read_text('utf-8').strip().splitlines()
    assert len(build_text) == 1 and build_text[0].startswith('setuptools==') and _re.search(r'--hash=sha256:[0-9a-f]{64}', build_text[0]), build_text
    assert '--no-build-isolation' not in build_args and '--build-constraint' not in build_args
    # run 2: the whole lock, no isolated build environment (whose installs pip does not hash-check), no dependency resolution
    assert phase == 'packages' and args[:4] == ['install', '--no-deps', '--require-hashes', '--no-build-isolation'], args
    assert args[args.index('-r') + 1] == lock and '--build-constraint' not in args, args
    for run in (build_args, args):
        assert run[run.index('--index-url') + 1] == sources[0] and run[run.index('--extra-index-url') + 1] == sources[1]
        assert run.count('--index-url') == 1 and not any(a.startswith(('http://', 'torch', 'numpy', 'demucs')) for a in run), run
    assert state['steps'].get('build') and state['steps'].get('packages')
    # a lock without the build tool is refused before pip runs
    assert W.BUILD_REQUIRES == ('setuptools',)
    # _pip is the one place pip starts, and it always adds --require-hashes to an install, whoever calls it
    started = []
    real_run_process = inst._run_process
    inst._run_process = lambda command, on_line, cwd=None: (started.append(list(command)), 0)[1]
    try:
        real_pip = W.StemInstaller._pip
        real_pip(inst, Path('python.exe'), ['install', 'x==1'], 'packages', 1, 'x')
        real_pip(inst, Path('python.exe'), ['install', '--require-hashes', 'x==1'], 'packages', 1, 'x')
    finally:
        inst._run_process = real_run_process
    assert all(c.count('--require-hashes') == 1 and c[:4] == [str(Path('python.exe')), '-I', '-m', 'pip'] for c in started) and len(started) == 2, started
    # the GPU lookup thread always sets "known", even when the lookup raises
    saved_gpu, saved_query = dict(W._GPU), W.query_gpu
    try:
        W._GPU.update(value=None, known=False, thread=None)
        def boom():
            raise RuntimeError('nvidia-smi exploded')
        W.query_gpu = boom
        thread = threading.Thread(target=W._look_for_gpu)
        thread.start(); thread.join(5)
        assert W._GPU['known'] is True and W._GPU['value'] is None, W._GPU
    finally:
        W.query_gpu = saved_query
        W._GPU.update(saved_gpu)
    # the status route and the Windows wording of the 503 are registered even when install/cancel are not (no FFmpeg)
    limited = Flask('limited')
    limited.register_blueprint(W.create_blueprint(inst, can_install=False))
    rules = {rule.rule for rule in limited.url_map.iter_rules()}
    assert '/api/windows/stem-engine/status' in rules and '/api/windows/stem-engine/install' not in rules, rules
    boot = (probe / 'windows_bootstrap.py').read_text('utf-8')
    assert 'install_stem_installer(app, can_install=bool(video_ffmpeg))' in boot
    assert 'if video_ffmpeg:\n        from windows_stem_installer' not in boot, 'the stem installer must not be registered only when FFmpeg is found'
    # a lock that is missing, or has an unpinned / unhashed line, stops the install before pip runs
    real_lock_path = W.StemInstaller.lock_path
    bad_lock = folder / 'bad.txt'
    try:
        for content in ('numpy\n', 'numpy==1.26.4\n', 'numpy>=1 --hash=sha256:' + '0' * 64 + '\n', 'torch==2.6.0 --hash=sha256:abc\n', '# only a comment\n'):
            bad_lock.write_text(content, 'utf-8')
            W.StemInstaller.lock_path = staticmethod(lambda flavour: bad_lock)
            try:
                W.StemInstaller.read_lock('cuda')
            except W.InstallError as error:
                assert error.code == 'lock_invalid', (content, error.code)
            else:
                raise AssertionError('accepted ' + content)
        W.StemInstaller.lock_path = staticmethod(lambda flavour: folder / 'missing.txt')
        try:
            W.StemInstaller.read_lock('cpu')
        except W.InstallError as error:
            assert error.code == 'lock_missing' and 'Reinstall' in str(error)
        else:
            raise AssertionError('accepted a missing lock')
    finally:
        W.StemInstaller.lock_path = staticmethod(real_lock_path)
    # the lock files ship with the app: build_installer copies the whole app folder and refuses to build without them
    sys.path.insert(0, str(workspace))
    import build_installer as B
    assert all((probe / n).is_file() for n in W.LOCK_FILES.values())
    assert set(W.LOCK_FILES.values()) <= set(B.REQUIRED_APP_FILES), B.REQUIRED_APP_FILES
    assert not any(n in B.SKIP_FILES or n.endswith(('.partial', '.tmp')) for n in W.LOCK_FILES.values())

    # 12c. the bootstrap pip wheel: exact version + SHA-256 are constants, its file name is validated before it is used as a path
    assert W.PIP_VERSION == '26.3' and _re.fullmatch(r'[0-9a-f]{64}', W.PIP_SHA256)
    good_name = 'pip-%s-py3-none-any.whl' % W.PIP_VERSION
    buffer = _io.BytesIO()
    with _zip.ZipFile(buffer, 'w') as archive:
        archive.writestr('pip/__init__.py', '')
    wheel_bytes = buffer.getvalue()
    real_sha = W.PIP_SHA256
    W.PIP_SHA256 = hashlib.sha256(wheel_bytes).hexdigest()

    def pip_server(filename, digest, wheel=wheel_bytes):
        def opener(url, headers=None, timeout=45):
            if url == W.PIP_JSON:
                return _io.BytesIO(json.dumps({'urls': [{'filename': filename, 'digests': {'sha256': digest}, 'size': len(wheel),
                                                          'url': 'https://files.pythonhosted.org/packages/x/' + filename}]}).encode())
            return Response(200, wheel)
        return opener
    try:
        inst, folder = fresh('pipwheel')
        python = folder / W.INSTALLING / 'python.exe'
        (folder / W.INSTALLING / 'Lib' / 'site-packages').mkdir(parents=True)
        W.http_open = pip_server(good_name, W.PIP_SHA256)
        inst._bootstrap_pip(python, folder / W.INSTALLING)
        assert (folder / W.INSTALLING / 'Lib' / 'site-packages' / 'pip' / '__init__.py').is_file()
        for evil in ('..\\..\\evil-py3-none-any.whl', 'pip-26.3-py3-none-any.whl\\..\\x', 'pip-26.3.1-py3-none-any.whl', 'pip-.-py3-none-any.whl\n',
                     'pip-26.3-py3-none-any.whl.exe', 'C:\\x\\pip-26.3-py3-none-any.whl', 'pip-26.3/../pip-26.3-py3-none-any.whl'):
            inst, folder = fresh('pipevil')
            (folder / W.INSTALLING / 'Lib' / 'site-packages').mkdir(parents=True)
            W.http_open = pip_server(evil, W.PIP_SHA256)
            try:
                inst._bootstrap_pip(python, folder / W.INSTALLING)
            except W.InstallError:
                pass
            else:
                raise AssertionError('accepted pip file name %r' % evil)
            assert not (folder / W.INSTALLING / '_downloads').exists() or not list((folder / W.INSTALLING / '_downloads').iterdir()), evil
        inst, folder = fresh('pipdigest')  # PyPI lists another file than the one this build knows
        (folder / W.INSTALLING / 'Lib' / 'site-packages').mkdir(parents=True)
        W.http_open = pip_server(good_name, '0' * 64)
        try:
            inst._bootstrap_pip(python, folder / W.INSTALLING)
        except W.InstallError as error:
            assert error.code == 'hash_mismatch', error.code
        else:
            raise AssertionError('accepted a pip wheel with another SHA-256')
        inst, folder = fresh('pipbytes')  # the right digest in the JSON but other bytes on the wire: _download's own check refuses it
        (folder / W.INSTALLING / 'Lib' / 'site-packages').mkdir(parents=True)
        W.http_open = pip_server(good_name, W.PIP_SHA256, wheel=wheel_bytes[:-1] + bytes([wheel_bytes[-1] ^ 1]))
        try:
            inst._bootstrap_pip(python, folder / W.INSTALLING)
        except W.InstallError as error:
            assert error.code == 'hash_mismatch', error.code
        else:
            raise AssertionError('accepted tampered pip bytes')
    finally:
        W.PIP_SHA256 = real_sha

    # 12d. _verify runs a real ~1 second separation (not only imports) on the device the engine will use
    compile(W.VERIFY_CODE, 'verify', 'exec')
    for needle in ('import json,time,torch,numpy,soundfile,demucs.pretrained', 'HTDemucs(', 'apply_model(', 'torch.arange(44100', 'isfinite', 'torch.cuda.is_available()'):
        assert needle in W.VERIFY_CODE, needle
    inst, folder = fresh('verify_real')
    partial = folder / W.INSTALLING
    (partial / 'Scripts').mkdir(parents=True)
    captured = []

    def fake_process(output, status):
        def run(command, on_line, cwd=None):
            captured.append(command)
            for line in output:
                on_line(line)
            return status
        return run
    result_line = 'PEAKHOUR ' + json.dumps({'torch': '2.6.0+cu124', 'cuda': True, 'device': 'cuda', 'numpy': '1.26.4', 'separation_seconds': 1.9})
    inst._run_process = fake_process([result_line], 0)
    inst._verify(partial, 'cuda')
    assert captured[0][-1] == W.VERIFY_CODE and inst._engine_info['device'] == 'cuda'
    inst._run_process = fake_process(['Traceback (most recent call last):', 'RuntimeError: CUDA error: no kernel image is available'], 1)
    try:
        inst._verify(partial, 'cuda')  # imports fine, separation fails -> verify_failed -> the install falls back to the CPU build
    except W.InstallError as error:
        assert error.code == 'verify_failed' and 'cannot separate' in str(error) and 'no kernel image' in str(error), (error.code, str(error))
    else:
        raise AssertionError('a failed separation passed the check')
    inst._run_process = fake_process(['PEAKHOUR ' + json.dumps({'torch': '2.7.0+cu124', 'cuda': True, 'device': 'cuda', 'numpy': '1.26.4'})], 0)
    try:
        inst._verify(partial, 'cuda')
    except W.InstallError as error:
        assert error.code == 'wrong_build', error.code
    else:
        raise AssertionError('a different torch version passed the check')
    # ... and the job really falls back: a separation failure on the GPU build installs the CPU lock and verifies that one
    inst, folder = fresh('verify_fallback')
    log = []
    fake_steps(inst, log)
    outcomes = iter([W.InstallError('verify_failed', 'The installed engine does not start or cannot separate audio: CUDA error')])

    def verify_once(partial, flavour):
        log.append(('verify', flavour))
        error = next(outcomes, None)
        if error:
            raise error
        inst._engine_info = {'torch': '2.6.0+cpu', 'cuda': False, 'numpy': '1.26.4'}
    inst._verify = verify_once
    inst.plan = lambda build='auto': dict(W.StemInstaller.plan(inst, build), model_ready=True)
    inst.start()
    status = finish(inst)
    assert status['state'] == 'done' and [e for e in log if e[0] == 'verify'] == [('verify', 'cuda'), ('verify', 'cpu')], (status, log)

    # 12e. the log is reset only after the cross-process lock is held: a window that is refused must not wipe the running one's log
    inst, folder = fresh('logorder')
    folder.mkdir(parents=True)
    (folder / 'stem-engine.log').write_text('pip output of the running install\n', 'utf-8')
    holder = W.StemInstaller(folder)
    handle = holder._take_process_lock()
    try:
        fake_steps(inst, [])
        inst.start()
        status = finish(inst)
        assert status['state'] == 'failed' and status['error_code'] == 'busy', status
        assert (folder / 'stem-engine.log').read_text('utf-8') == 'pip output of the running install\n', 'a refused start deleted the log'
    finally:
        holder._release_process_lock(handle)
    fake_steps(inst, [])
    inst.plan = lambda build='auto': dict(W.StemInstaller.plan(inst, build), model_ready=True)
    inst.start()
    assert finish(inst)['state'] == 'done'
    assert not (folder / 'stem-engine.log').exists(), 'the lock holder did not reset the log'  # the fake steps write none

    # 12f. nvidia-smi is looked up once in the background; routes never wait for it ("checking" until it is known)
    W.detect_gpu, W.gpu_known, W.query_gpu, W.ensure_gpu_known = REAL_GPU
    W.query_gpu = lambda: (time.sleep(2.5), GOOD_GPU)[1]
    W._GPU.update(value=None, known=False, thread=None)
    inst, folder = fresh('gpu')
    started = time.time()
    W.start_gpu_detection()
    assert W.start_gpu_detection() is W._GPU['thread']  # one lookup, not one per call
    first = inst.plan()
    assert time.time() - started < 1.0 and first['gpu_checking'] is True and first['gpu'] is None and first['flavour'] == 'cpu', first
    flask_gpu = Flask('gpu')
    flask_gpu.register_blueprint(W.create_blueprint(inst))
    flask_gpu.after_request(W.make_after_request(inst))

    @flask_gpu.post('/api/studio-daw/stems')
    def stems_gpu():
        return jsonify(error='x', code='stem_runtime_missing'), 503
    gpu_client = flask_gpu.test_client()
    started = time.time()
    status_now = gpu_client.get('/api/windows/stem-engine/status', headers=local).get_json()
    refusal = gpu_client.post('/api/studio-daw/stems', headers=local).get_json()
    assert time.time() - started < 1.0, 'the status route or the 503 rewrite waited for nvidia-smi'
    assert status_now['gpu_checking'] is True and refusal['stem_engine']['gpu_checking'] is True and refusal['install_required'], (status_now, refusal)
    W._GPU['thread'].join(10)
    done_plan = inst.plan()
    assert done_plan['gpu_checking'] is False and done_plan['gpu'] == 'Test RTX' and done_plan['flavour'] == 'cuda', done_plan
    W._GPU.update(value=None, known=False, thread=None)
    W.query_gpu = lambda: None
    W.start_gpu_detection()
    W._GPU['thread'].join(10)
    assert inst.plan()['gpu_checking'] is False and inst.plan()['flavour'] == 'cpu'  # "no GPU" is an answer, not "checking"
    # the install job itself waits for the lookup before it picks the build (it runs in its own thread, never in a route)
    W._GPU.update(value=None, known=False, thread=None)
    W.query_gpu = lambda: (time.sleep(1.0), GOOD_GPU)[1]
    inst, folder = fresh('gpu_job')
    log = []
    fake_steps(inst, log)
    real_plan = W.StemInstaller.plan
    inst.plan = lambda build='auto': dict(real_plan(inst, build), model_ready=True)
    W.ensure_gpu_known = REAL_GPU[3]
    inst.start()
    status = finish(inst)
    assert status['state'] == 'done' and ('verify', 'cuda') in log, (status, log)
    W.detect_gpu, W.gpu_known, W.query_gpu, W.ensure_gpu_known = (lambda: GOOD_GPU), (lambda: True), REAL_GPU[2], (lambda timeout=30: None)

    # 12g. the folder rename after the verify retries while Windows still scans the new files ("Access is denied" measured for real)
    inst, folder = fresh('rename')
    real_replace, tries = os.replace, []

    def flaky(source, target):
        tries.append(str(source))
        if len(tries) <= 3:
            raise PermissionError(5, 'Access is denied')
        return real_replace(source, target)
    fake_steps(inst, [])
    inst.plan = lambda build='auto': dict(W.StemInstaller.plan(inst, build), model_ready=True)
    os.replace = flaky
    try:
        inst.start()
        status = finish(inst)
    finally:
        os.replace = real_replace
    assert status['state'] == 'done' and python_present(folder) and len(tries) >= 4, (status, tries)

    # 12h. small things: no TAB where a backslash belongs (site-packages\torch), no CSS transition on the progress bar
    for path in (probe / 'windows_stem_installer.py', workspace / 'investigation.md'):
        content = path.read_text('utf-8')
        assert 'site-packages' + chr(9) + 'orch' not in content, path.name
        assert 'Lib' + chr(92) + 'site-packages' + chr(92) + 'torch' + chr(92) + 'include' in content, path.name
    css = (probe / 'static' / 'css' / 'windows-stems-install.css').read_text('utf-8')
    assert 'transition' not in css and 'animation' not in css, 'no transitions or animations (performance rule)'

    # 12i. the POST routes are as strict as the djay / Serato write routes: this PC, same origin, a fetch from our own page
    inst_guard, _ = fresh('guard')
    flask_guard = Flask('guard')
    flask_guard.register_blueprint(W.create_blueprint(inst_guard))
    guard_client = flask_guard.test_client()
    for headers, environ, why in (({'Host': '127.0.0.1'}, {}, 'no Origin'),
                                  ({'Host': '127.0.0.1', 'Origin': 'null'}, {}, 'opaque origin'),
                                  ({'Host': '127.0.0.1', 'Origin': 'http://127.0.0.1', 'Sec-Fetch-Site': 'cross-site'}, {}, 'cross-site fetch'),
                                  ({'Host': '127.0.0.1', 'Origin': 'http://127.0.0.1', 'Sec-Fetch-Site': 'same-site'}, {}, 'same-site fetch'),
                                  ({'Host': '127.0.0.1', 'Origin': 'http://127.0.0.1'}, {'REMOTE_ADDR': '192.168.1.20'}, 'another PC'),
                                  ({'Host': '192.168.1.5', 'Origin': 'http://192.168.1.5'}, {}, 'not the loopback host')):
        for route in ('install', 'cancel'):
            answer = guard_client.post('/api/windows/stem-engine/' + route, json={}, headers=headers, environ_base=environ)
            assert answer.status_code == 403, (route, why, answer.status_code)
    assert not inst_guard.status()['running']
    allowed = guard_client.post('/api/windows/stem-engine/cancel', json={}, headers={'Host': '127.0.0.1:5000', 'Origin': 'http://127.0.0.1:5000', 'Sec-Fetch-Site': 'same-origin'})
    assert allowed.status_code == 200, allowed.status_code

    # 13. windows_stems follows the data folder (the old code read %LOCALAPPDATA%\AXIOM: a folder nothing else uses)
    import windows_stems as S
    assert S.stem_python() == Path(os.environ['AXIOM_RUNTIME_DIR']) / 'stem-runtime' / 'Scripts' / 'python.exe', S.stem_python()
    assert S.resolve_stem_models() is None
    (Path(os.environ['AXIOM_RUNTIME_DIR']) / 'stem-models').mkdir(parents=True)
    (Path(os.environ['AXIOM_RUNTIME_DIR']) / 'stem-models' / W.MODEL_FILE).write_bytes(b'x')
    assert S.resolve_stem_models() == str(Path(os.environ['AXIOM_RUNTIME_DIR']) / 'stem-models')
    saved = os.environ.pop('AXIOM_RUNTIME_DIR')  # no override: the same "AXIOM DJ" folder every other module uses
    try:
        assert W.runtime_dir() == Path(os.environ['LOCALAPPDATA']) / 'AXIOM DJ' / 'stem-runtime', W.runtime_dir()
    finally:
        os.environ['AXIOM_RUNTIME_DIR'] = saved
    # 14. the dialog in headless Edge, against a fake engine API: ask -> install -> progress -> error -> Retry -> done (true),
    #     and Cancel -> Continue -> Not now (false). Skipped where Edge is missing.
    EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    if not os.path.exists(EDGE):
        print('SKIPPED dialog check: Edge is not installed')
    else:
        import html, http.server, re, socket
        static = probe / 'static'
        BASE = {'success': True, 'runtime_ready': False, 'model_ready': False, 'ready': False, 'flavour': 'cuda', 'gpu': 'Test GPU',
                'download_text': '2.7 GB', 'disk_text': '10.0 GB', 'resumable': False, 'running': False, 'percent': 0, 'detail': '',
                'error': None, 'state': 'idle', 'sources': ['download.pytorch.org', 'pypi.org', 'files.pythonhosted.org', 'dl.fbaipublicfiles.com']}
        fake = {'timelines': [], 'line': [BASE], 'index': 0, 'calls': [], 'checking': 0}

        def step(n):
            return dict(BASE, running=n['state'] in ('running', 'cancelling'), **n)

        def run_line(pct, text):
            return step({'state': 'running', 'percent': pct, 'detail': text})

        def timelines():
            return [[run_line(10, 'Downloading torch (300 MB of about 2.7 GB).'), run_line(55, 'Installing PyTorch.'),
                     step({'state': 'failed', 'error': 'PEAK HOUR could not reach the download servers.', 'detail': 'x'})],
                    [run_line(60, 'Installing Demucs.'),
                     step({'state': 'done', 'percent': 100, 'ready': True, 'runtime_ready': True, 'model_ready': True})],
                    [run_line(5, 'Checking this PC.'), run_line(12, 'Downloading torch (100 MB of about 2.7 GB).')]]
        HARNESS = """<!doctype html><html><head><link rel="stylesheet" href="/static/css/windows-virtualdj.css">
<link rel="stylesheet" href="/static/css/windows-stems-install.css"></head><body><script>
const toasts=[];window.showToast=(t,b)=>toasts.push([t,!!b]);
</script><script src="/static/js/shared/windows-stems-install.js"></script><script>
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const out={};
const q=(sel)=>document.querySelector('#axiom-stem-install '+sel);
const snap=()=>({detail:q('.axiom-stem-phase').textContent,error:q('.axiom-stem-error').textContent,width:q('.axiom-stem-bar>i').style.width,
 barHidden:q('.axiom-stem-bar').hidden,install:q('#axiom-stem-install-go').hidden?'':q('#axiom-stem-install-go').textContent,
 cancel:!q('#axiom-stem-install-cancel').hidden,close:q('.axiom-vdj-actions button:first-child').hidden?'':q('.axiom-vdj-actions button:first-child').textContent});
(async()=>{try{
 const first=AxiomStemInstall.ensure({});
 await wait(300);
 out.checking={items:[...document.querySelectorAll('#axiom-stem-install li')].map(l=>l.textContent),disabled:q('#axiom-stem-install-go').disabled};
 await wait(1300);
 out.open=document.getElementById('axiom-stem-install').open;out.title=q('h2').textContent;
 out.items=[...document.querySelectorAll('#axiom-stem-install li')].map(l=>l.textContent);
 out.facts=q('.axiom-stem-install-facts').textContent;out.ask=snap();
 q('#axiom-stem-install-go').click();
 await wait(1000);out.progress=snap();
 await wait(2500);out.failed=snap();
 q('#axiom-stem-install-go').click();
 await wait(300);out.retrying=snap();
 out.result=await Promise.race([first,wait(8000).then(()=>'timeout')]);
 out.gone=!document.getElementById('axiom-stem-install');out.toasts=toasts.slice();
 await fetch('/__idle');   // the engine is gone again (as if removed): ask once more
 const second=AxiomStemInstall.ensure({});
 await wait(400);q('#axiom-stem-install-go').click();await wait(900);
 q('#axiom-stem-install-cancel').click();await wait(900);out.cancelled=snap();
 q('.axiom-vdj-actions button:first-child').click();
 out.result2=await Promise.race([second,wait(3000).then(()=>'timeout')]);
}catch(e){out.error=String(e&&e.stack||e);}
document.body.append(Object.assign(document.createElement('pre'),{textContent:'PH'+'RESULT<'+JSON.stringify(out)+'>PH'+'END'}));
})();
</script></body></html>"""

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def send(self, code, body, kind):
                data = body if isinstance(body, bytes) else body.encode('utf-8')
                self.send_response(code)
                self.send_header('Content-Type', kind)
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                path = self.path.split('?')[0]
                if path == '/':
                    return self.send(200, HARNESS, 'text/html; charset=utf-8')
                if path == '/__idle':
                    fake['line'], fake['index'] = [BASE], 0
                    return self.send(200, '{}', 'application/json')
                if path == '/api/windows/stem-engine/status':
                    line = fake['line']
                    answer = line[min(fake['index'], len(line) - 1)]
                    if fake['checking'] > 0:  # nvidia-smi is still being asked in the background
                        fake['checking'] -= 1
                        answer = dict(answer, gpu_checking=True, gpu=None, flavour='cpu')
                    fake['index'] += 1
                    fake['calls'].append('status')
                    return self.send(200, json.dumps(answer), 'application/json')
                target = static / path[len('/static/'):] if path.startswith('/static/') else None
                if target and target.is_file():
                    return self.send(200, target.read_bytes(), 'text/css' if target.suffix == '.css' else 'text/javascript')
                self.send(404, 'no', 'text/plain')

            def do_POST(self):
                self.rfile.read(int(self.headers.get('Content-Length') or 0))
                if self.path == '/api/windows/stem-engine/install':
                    fake['calls'].append('install')
                    fake['line'], fake['index'] = fake['timelines'].pop(0), 1
                    return self.send(202, json.dumps(dict(fake['line'][0], started=True)), 'application/json')
                if self.path == '/api/windows/stem-engine/cancel':
                    fake['calls'].append('cancel')
                    fake['line'], fake['index'] = [step({'state': 'cancelled', 'detail': 'Cancelled. Install again to continue where it stopped.',
                                                          'resumable': True})], 0
                    return self.send(200, json.dumps(dict(fake['line'][0], cancelled=True)), 'application/json')
                self.send(404, 'no', 'text/plain')
        sock = socket.socket()
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
        sock.close()
        httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            dom = ''
            for attempt in range(4):  # a fresh profile per try: headless Edge crashes when a profile is reused
                fake.update(timelines=timelines(), line=[BASE], index=0, calls=[], checking=1)
                dom = subprocess.run([EDGE, '--headless=new', '--disable-gpu', '--user-data-dir=' + str(root / ('edge%d' % attempt)),
                                      '--window-size=900,900', '--virtual-time-budget=30000', '--dump-dom', 'http://127.0.0.1:%d/' % port],
                                     capture_output=True, timeout=180, encoding='utf-8', errors='replace', creationflags=0x08000000).stdout
                if 'PHRESULT<' in dom:
                    break
            match = re.search(r'PHRESULT<(.*?)>PHEND', html.unescape(dom), re.S)
            assert match, dom[-2500:]
            ui = json.loads(match.group(1))
        finally:
            httpd.shutdown()
        assert not ui.get('error'), ui
        assert ui['open'] and ui['title'] == 'Install stem engine', ui
        assert 'Checking this PC' in ui['checking']['items'][0] and not any('PyTorch' in i for i in ui['checking']['items']) and ui['checking']['disabled'] is True, ui['checking']  # no guess before nvidia-smi answered
        assert any('GPU support' in i and 'Test GPU' in i for i in ui['items']) and any('84 MB' in i for i in ui['items']), ui['items']
        assert '2.7 GB' in ui['facts'] and '10.0 GB' in ui['facts'] and 'download.pytorch.org' in ui['facts'] and 'dl.fbaipublicfiles.com' in ui['facts'], ui['facts']
        assert ui['ask']['install'] == 'Install' and ui['ask']['barHidden'] and not ui['ask']['cancel'] and ui['ask']['close'] == 'Not now', ui['ask']
        assert ui['progress']['cancel'] and not ui['progress']['barHidden'] and ui['progress']['install'] == '' and ui['progress']['close'] == '', ui['progress']
        assert re.search(r'\((10|55)%\)', ui['progress']['detail']) and re.match(r'(10|55)%', ui['progress']['width']), ui['progress']
        assert 'could not reach the download servers' in ui['failed']['error'] and ui['failed']['install'] == 'Retry' and ui['failed']['close'] == 'Close', ui['failed']
        assert ui['retrying']['cancel'] and ui['retrying']['error'] == '', ui['retrying']
        assert ui['result'] is True and ui['gone'] is True and any('Stem engine installed' in t and not bad for t, bad in ui['toasts']), ui
        assert ui['cancelled']['install'] == 'Continue install' and 'Cancelled' in ui['cancelled']['detail'] and ui['cancelled']['close'] == 'Close', ui['cancelled']
        assert ui['result2'] is False, ui
        assert fake['calls'].count('install') == 3 and fake['calls'].count('cancel') == 1, fake['calls']
    print('PASS: stem engine installer: space check, Range resume, checksum, cancel and resume, one job at a time, '
          'no half-installed runtime, CPU fallback, official hosts only, progress, no console windows, Windows wording and routes')
except BaseException:
    traceback.print_exc()
    sys.exit(1)
finally:
    shutil.rmtree(root, ignore_errors=True)
    try:
        base.rmdir()  # only when empty
    except OSError:
        pass
