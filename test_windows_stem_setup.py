"""Setup's "Stem engine" step (axiom-win-probe/windows_stem_setup.py + the last step of installer/install.ps1).

The install job is the real one (windows_stem_installer) with the network, pip and the interpreter copy faked, exactly as in
test_windows_stem_installer.py; everything runs in a sandbox data folder (AXIOM_RUNTIME_DIR) - never %LOCALAPPDATA%\\AXIOM DJ.

Checks: an engine that is already installed ends at once with "already installed - skipped", exit 0, no window, no network
and not one file written; --skip, the PEAK_HOUR_SETUP_SILENT variable and --check; a missing engine with --auto installs through
the real job and the window model shows progress, the app sees the job through the status file while it runs; a failure offers
Retry and Skip and a skip ends with a non-zero exit that Setup ignores; Cancel keeps the download and Continue finishes it;
no internet is detected and offered Retry and Skip, and nothing is started; another process holding the install lock ends
the step with the "skipped" message; the app's status shows "started by Setup" while a fresh status file says so and nothing once
it is stale; the tkinter window (built hidden) shows the right buttons and closes itself; the Setup script text: the step comes
after the shortcuts, the registry entry and the "installed" message, cannot fail Setup, honours silent Setup, never touches the
engine folders, the generated setup.cmd / IExpress sed carry the quiet switch, and install.ps1 parses."""
import contextlib, hashlib, io, json, os, shutil, subprocess, sys, threading, time, uuid
from pathlib import Path

workspace = Path(__file__).resolve().parent
probe = workspace / 'axiom-win-probe'
base = workspace / 'fixtures' / 'stem_setup'
base.mkdir(parents=True, exist_ok=True)
root = base / uuid.uuid4().hex[:8]
home = root / 'home'
(home / 'AppData' / 'Local').mkdir(parents=True)
os.environ.update({'USERPROFILE': str(home), 'HOME': str(home), 'LOCALAPPDATA': str(home / 'AppData' / 'Local'),
                   'APPDATA': str(home / 'AppData' / 'Roaming'), 'AXIOM_RUNTIME_DIR': str(root / 'data')})
os.environ.pop('PEAK_HOUR_SETUP_SILENT', None)
sys.path.insert(0, str(probe))
sys.path.insert(0, str(workspace))
os.chdir(probe)

import windows_stem_installer as W  # noqa: E402
import windows_stem_setup as S  # noqa: E402

assert str(W.data_root()).startswith(str(root)), 'the sandbox must replace the real data folder: ' + str(W.data_root())

GOOD_GPU = {'name': 'Test RTX', 'driver': 576.0, 'memory_mb': 6144}
payload = os.urandom(300_000)
W.MODEL_SHA256 = hashlib.sha256(payload).hexdigest()
W.MODEL_SIZE = len(payload)
W.detect_gpu = lambda: GOOD_GPU
W.gpu_known = lambda: True
W.ensure_gpu_known = lambda timeout=30: None
W.start_gpu_detection = lambda: None
W.free_bytes = lambda path: 500 * 10 ** 9
W.long_paths_enabled = lambda: True
calls = {'network': 0, 'window': 0}


class Response:
    def __init__(self, body):
        self.status, self.body = 200, body

    def read(self, n):
        chunk, self.body = self.body[:n], self.body[n:]
        return chunk

    def close(self):
        pass


def server(url, headers=None, timeout=45):
    W.check_url(url)
    calls['network'] += 1
    return Response(payload)


W.http_open = server


def fresh(name):
    folder = root / name
    shutil.rmtree(folder, ignore_errors=True)
    inst = W.StemInstaller(folder)
    inst.sleep = lambda seconds: None
    return inst, folder


def fake_steps(inst, log, pip=None):
    def copy_python(dest):
        log.append('copy')
        (dest / 'Scripts').mkdir(parents=True, exist_ok=True)
        (dest / 'Scripts' / 'python.exe').write_bytes(b'MZ')
        (dest / 'python.exe').write_bytes(b'MZ')

    def run_pip(python, args, phase, expected, label):
        log.append(('pip', phase))
        if pip:
            pip(inst, phase, args)
        inst._check_cancel()

    def verify(partial, flavour):
        inst._engine_info = {'torch': '2.6.0+' + ('cu124' if flavour == 'cuda' else 'cpu'), 'cuda': flavour == 'cuda', 'numpy': '1.26.4'}
    inst._copy_python, inst._bootstrap_pip, inst._pip, inst._verify = copy_python, lambda python, partial: log.append('pip-bootstrap'), run_pip, verify


def install_engine(folder):
    (folder / 'stem-runtime' / 'Scripts').mkdir(parents=True)
    (folder / 'stem-runtime' / 'Scripts' / 'python.exe').write_bytes(b'MZ')
    (folder / 'stem-models').mkdir()
    (folder / 'stem-models' / W.MODEL_FILE).write_bytes(payload)


def peek(folder):
    try:
        return json.loads((Path(folder) / W.SETUP_STATUS).read_text('utf-8'))
    except (OSError, ValueError):
        return None


def as_other_process(folder):
    """The status file as another process (Setup's window) wrote it: this process ignores its own."""
    data = peek(folder)
    data['pid'] = os.getpid() + 1
    (Path(folder) / W.SETUP_STATUS).write_text(json.dumps(data))


def files_under(folder):
    return sorted(str(p.relative_to(folder)) for p in Path(folder).rglob('*')) if Path(folder).exists() else []


def run_main(argv, inst, online=lambda: True, window=None, env=None):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = S.main(argv, installer=inst, online=online, window=window or no_window)
    return code, out.getvalue()


def no_window(controller, auto=False):
    calls['window'] += 1
    raise AssertionError('no window expected')


def driver(seen=None, then=None, timeout=60):
    """A window stand-in: with auto it begins by itself, polls like the real window and returns once the step ended."""
    def window(controller, auto=False):
        calls['window'] += 1
        if auto:
            controller.begin()
        end = time.time() + timeout
        while time.time() < end:
            view = controller.poll()
            if seen is not None:
                seen.append((controller.state, view))
            if then:
                then(controller, view)
            if controller.state in ('done', 'skipped', 'closed', 'elsewhere') and not controller.busy:
                return
            time.sleep(0.02)
        raise AssertionError('the step did not end: ' + controller.state)
    return window


passed = []


def ok(message):
    passed.append(message)
    print('PASS:', message)


try:
    # 1. already installed and complete: skipped at once; no window, no network, not one file written or changed
    inst, folder = fresh('ready')
    install_engine(folder)
    before = {p: (folder / p).stat().st_mtime_ns for p in files_under(folder)}
    calls.update(network=0, window=0)
    code, text = run_main([], inst)
    assert code == 0 and S.ALREADY in text, (code, text)
    assert 'already installed' in S.ALREADY and calls == {'network': 0, 'window': 0}, calls
    assert {p: (folder / p).stat().st_mtime_ns for p in files_under(folder)} == before, 'the skip changed files'
    code, text = run_main(['--auto'], inst)
    assert code == 0 and S.ALREADY in text and calls == {'network': 0, 'window': 0}
    ok('an installed engine is skipped with exit 0: no window, no network, nothing written')

    # the same in a real child process of the dev Python with the network blocked
    audit = ("import sys,runpy\n"
             "def audit(e,a):\n"
             " if e in ('socket.connect','socket.connect_ex','socket.getaddrinfo'): raise PermissionError('network blocked')\n"
             "sys.addaudithook(audit)\n"
             "sys.argv=['windows_stem_setup.py']\n"
             "runpy.run_path(%r, run_name='__main__')\n" % str(probe / 'windows_stem_setup.py'))
    env = dict(os.environ, AXIOM_RUNTIME_DIR=str(folder), PYTHONIOENCODING='utf-8')
    done = subprocess.run([sys.executable, '-c', audit], capture_output=True, text=True, encoding='utf-8', env=env, timeout=120, cwd=str(probe),
                          creationflags=0x08000000)
    assert done.returncode == 0 and S.ALREADY in done.stdout, (done.returncode, done.stdout, done.stderr[-500:])
    ok('the script run as a program (no network allowed) prints "Stem engine already installed - skipped" and exits 0')

    # 2. --skip, the silent variable, --check
    inst, folder = fresh('empty')
    calls.update(network=0, window=0)
    code, text = run_main(['--skip'], inst)
    assert code == 0 and 'skipped' in text and calls == {'network': 0, 'window': 0} and not folder.exists(), (code, text)
    os.environ['PEAK_HOUR_SETUP_SILENT'] = '1'
    code, text = run_main([], inst)
    os.environ.pop('PEAK_HOUR_SETUP_SILENT')
    assert code == 0 and 'skipped' in text and calls == {'network': 0, 'window': 0} and not folder.exists()
    os.environ['PEAK_HOUR_SETUP_SILENT'] = '0'
    assert not S.silent()
    os.environ.pop('PEAK_HOUR_SETUP_SILENT')
    code, text = run_main(['--check'], inst)
    data = json.loads(text)
    assert code == 1 and data['ready'] is False and data['runtime_ready'] is False and data['busy'] is False and not folder.exists(), (code, text)
    ready, ready_folder = fresh('ready2')
    install_engine(ready_folder)
    code, text = run_main(['--check'], ready)
    assert code == 0 and json.loads(text)['ready'] is True
    ok('--skip and PEAK_HOUR_SETUP_SILENT do nothing (exit 0, no folder created); --check prints JSON and exits 0 (ready) or 1')

    # 3. not installed, --auto, the real job: progress, then done; the app sees the job while it runs
    inst, folder = fresh('auto')
    log = []

    def pip(i, phase, args):
        if phase == 'packages':
            for step in (0.2, 0.5, 0.9):
                i._detail('packages', 'Downloading torch', step)
                time.sleep(0.15)
    fake_steps(inst, log, pip)
    seen, outside = [], []

    def watch_app(controller, view):
        if controller.state == 'running':
            outside.append(peek(folder))
    calls.update(network=0, window=0)
    code, text = run_main(['--auto'], inst, window=driver(seen, watch_app))
    assert code == 0 and 'installed' in text.lower(), (code, text)
    assert W.python_in(folder / 'stem-runtime').is_file() and (folder / 'stem-models' / W.MODEL_FILE).is_file()
    states = [s for s, _ in seen]
    assert 'running' in states and states[-1] == 'done', states
    percents = [v['percent'] for s, v in seen if s == 'running']
    assert percents == sorted(percents) and max(percents) > 0, percents
    running = [v for s, v in seen if s == 'running']
    assert any(v['bar'] and 'Downloading torch' in v['phase'] for v in running), [v['phase'] for v in running][:5]
    assert all(v['buttons'][0][:2] == ('cancel', 'Cancel') for v in running)
    assert any(o and o['state'] == 'running' and o['percent'] >= 0 for o in outside), 'the status file was never published'
    assert peek(folder)['state'] == 'done' and W.read_setup_status(folder) is None, 'a finished step must not look running'
    assert seen[-1][1]['heading'] == 'The stem engine is installed' and seen[-1][1]['buttons'][0][0] == 'close'
    ok('--auto installs through the real job with a live percent, publishes status while running, ends done with exit 0')

    # 4. the app's own status shows the job started by Setup, and stops showing it once it is stale or ended
    inst, folder = fresh('app')
    assert inst.status()['state'] == 'idle' and not inst.status().get('external')
    W.write_setup_status(folder, {'state': 'running', 'phase': 'packages', 'detail': 'Downloading torch (1.0 GB of about 2.7 GB).',
                                  'percent': 41, 'elapsed_seconds': 90, 'idle_seconds': 1, 'stalled': False, 'stall_text': ''})
    assert inst.status()['state'] == 'idle', 'a process ignores the status file it wrote itself'
    as_other_process(folder)
    status = inst.status()
    assert status['external'] and status['started_by'] == 'setup' and status['state'] == 'running' and status['running'], status
    assert status['percent'] == 41 and 'torch' in status['detail'] and status['elapsed_seconds'] == 90 and not status['ready']
    assert W.read_setup_status(folder, now=time.time() + 60) is None
    old = peek(folder)
    old['written'] -= 600
    (folder / W.SETUP_STATUS).write_text(json.dumps(old))
    status = inst.status()
    assert not status.get('external') and status['state'] == 'idle', status
    W.write_setup_status(folder, {'state': 'done'})
    assert not inst.status().get('external')
    (folder / W.SETUP_STATUS).write_text('{broken')
    assert W.read_setup_status(folder) is None
    js = (probe / 'static' / 'js' / 'shared' / 'windows-stems-install.js').read_text('utf-8')
    assert 'started by Setup' in js and 's.external' in js and 'windows-stems-install.js?v=4' in (probe / 'templates' / 'index.html').read_text('utf-8')
    ok('the app shows "started by Setup" with live percent while the status file is fresh, nothing when stale, ended or broken')

    # 5. failure: plain words with Retry and Skip; skipping ends non-zero (Setup ignores it); Retry works after the problem is fixed
    inst, folder = fresh('fail')
    log, broken = [], {'on': True}

    def pip_fails(i, phase, args):
        if broken['on'] and phase == 'packages':
            raise W.InstallError('network', 'PEAK HOUR could not finish downloading download.pytorch.org. Check the internet connection and try again.')
    fake_steps(inst, log, pip_fails)
    seen = []

    def press(controller, view):
        if controller.state == 'failed' and not getattr(press, 'done', False):
            press.done = True
            names = [b[0] for b in view['buttons']]
            assert names == ['retry', 'skip'], names
            assert 'internet connection' in view['error'] and view['heading'] == 'The stem engine could not be installed'
            assert 'Create Stems' in view['phase']
            controller.act('skip')
    def begin_then_drive(c, auto=False):
        c.begin()
        driver(seen, press)(c)
    code, text = run_main([], inst, window=begin_then_drive)
    assert code == 1 and 'not installed' in text and not W.python_in(folder / 'stem-runtime').exists(), (code, text)
    # Retry after the cause is gone
    broken['on'] = False
    press.done = False
    controller = S.SetupController(inst, lambda: True)
    controller.begin()
    for _ in range(300):
        controller.poll()
        if controller.state in ('done', 'failed'):
            break
        time.sleep(0.02)
    assert controller.state == 'done' and controller.exit_code == 0 and W.python_in(folder / 'stem-runtime').is_file(), controller.state
    ok('a failed install says why in plain words with Retry and Skip; Skip exits 1 (non-fatal for Setup); Retry then installs')

    # 6. Cancel keeps the download; Continue finishes it; exit code 2 when it ends cancelled
    inst, folder = fresh('cancel')
    log, gate = [], {'block': True}

    def pip_waits(i, phase, args):
        if gate['block'] and phase == 'packages':
            while not i._cancel.is_set():
                time.sleep(0.01)
    fake_steps(inst, log, pip_waits)
    controller = S.SetupController(inst, lambda: True)
    controller.begin()
    for _ in range(300):
        controller.poll()
        if controller.state == 'running' and inst.status()['phase'] == 'packages':
            break
        time.sleep(0.02)
    assert controller.state == 'running', controller.state
    controller.cancel()
    assert controller.state == 'cancelling' and dict((b[0], b[2]) for b in controller.view()['buttons'])['cancel'] is False
    for _ in range(300):
        view = controller.poll()
        if controller.state == 'cancelled':
            break
        time.sleep(0.02)
    assert controller.state == 'cancelled' and controller.exit_code == 2, controller.state
    assert (folder / 'stem-new').is_dir() and not W.python_in(folder / 'stem-runtime').exists(), 'the partial install must be kept'
    assert [b[0] for b in view['buttons']] == ['continue', 'close'] and 'kept' in view['phase']
    gate['block'] = False
    controller.act('continue')
    for _ in range(300):
        controller.poll()
        if controller.state == 'done':
            break
        time.sleep(0.02)
    assert controller.state == 'done' and W.python_in(folder / 'stem-runtime').is_file()
    assert log.count('copy') == 1, 'Continue must not copy Python again: %s' % log
    ok('Cancel keeps the downloaded parts (exit 2), Continue resumes without repeating finished steps')

    # 7. offline: detected before anything starts, said plainly, Retry and Skip; nothing started
    inst, folder = fresh('offline')
    log = []
    fake_steps(inst, log)
    state = {'online': False}
    controller = S.SetupController(inst, lambda: state['online'])
    controller.begin()
    for _ in range(200):
        view = controller.poll()
        if controller.state == 'offline':
            break
        time.sleep(0.02)
    assert controller.state == 'offline' and not log and not (folder / 'stem-new').exists(), log
    assert 'could not reach the internet' in view['error'] and [b[0] for b in view['buttons']] == ['retry', 'skip']
    assert controller.exit_code == 1
    state['online'] = True
    controller.act('retry')
    for _ in range(300):
        controller.poll()
        if controller.state == 'done':
            break
        time.sleep(0.02)
    assert controller.state == 'done'
    controller2 = S.SetupController(fresh('offline2')[0], lambda: False)
    controller2.begin()
    for _ in range(200):
        controller2.poll()
        if controller2.state == 'offline':
            break
        time.sleep(0.02)
    controller2.act('skip')
    assert controller2.state == 'skipped' and controller2.exit_code == 1
    # the real online check: any answer is "online", a refused connection is "offline"
    W.http_open = server
    assert S.check_online() is True
    import urllib.error
    def raising(url, headers=None, timeout=45):
        raise urllib.error.URLError('no route')
    W.http_open = raising
    assert S.check_online() is False
    def http_503(url, headers=None, timeout=45):
        raise urllib.error.HTTPError(url, 503, 'busy', {}, None)
    W.http_open = http_503
    assert S.check_online() is True
    W.http_open = server
    ok('no internet is detected before anything starts, said plainly with Retry and Skip, and Retry continues when it is back')

    # 8. another process holds the install lock: the step ends with the "skipped" message, no window
    inst, folder = fresh('locked')
    folder.mkdir(parents=True)
    holder = subprocess.Popen([sys.executable, '-c', "import msvcrt,sys\nh=open(sys.argv[1],'a+b');h.seek(0)\nmsvcrt.locking(h.fileno(),msvcrt.LK_NBLCK,1)\n"
                               "print('locked',flush=True);sys.stdin.readline()", str(folder / 'stem-engine.lock')],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, creationflags=0x08000000)
    try:
        assert holder.stdout.readline().strip() == 'locked'
        calls.update(network=0, window=0)
        code, text = run_main([], inst)
        assert code == 0 and S.ELSEWHERE in text and calls == {'network': 0, 'window': 0}, (code, text)
        assert json.loads(run_main(['--check'], inst)[1])['busy'] is True
        # a controller that starts while the other process works: ends as "already being installed", not as a failure
        fake_steps(inst, [])
        controller = S.SetupController(inst, lambda: True)
        controller.begin()
        for _ in range(200):
            view = controller.poll()
            if controller.state == 'elsewhere':
                break
            time.sleep(0.02)
        assert controller.state == 'elsewhere' and controller.exit_code == 0 and view['heading'] == 'Already being installed'
    finally:
        holder.stdin.write('\n')
        holder.stdin.flush()
        holder.wait(20)
    inst2, _ = fresh('locked')  # the lock is free again: nothing is "busy"
    folder.mkdir(parents=True, exist_ok=True)
    assert S.other_install_running(inst2) is False
    ok('another process installing (lock held) ends the step with "skipped", exit 0, no window')

    # 9. what the first screen says: why, the build, the size, the later route; Install waits for the GPU look
    inst, folder = fresh('ask')
    controller = S.SetupController(inst, lambda: True)
    view = controller.view()
    text = ' '.join([view['heading'], view['text'], ' '.join(view['items']), view['facts'], view['phase']])
    assert view['title'] == 'PEAK HOUR — Stem engine' and [b[0] for b in view['buttons']] == ['install', 'skip']
    assert dict((b[0], b[1]) for b in view['buttons']) == {'install': 'Install now', 'skip': 'Skip for now'}
    assert 'NVIDIA GPU support' in text and 'Test RTX' in text and '2.7 GB' in text and '10.2 GB' in text and '4.9 GB' in text, text
    assert 'too large to be inside Setup' in text and 'Studio' in text and 'Create Stems' in text and 'works without it' in text
    W.detect_gpu = lambda: None
    view = controller.view()
    assert 'CPU' in ' '.join(view['items']) and '350 MB' in view['facts'] and 'NVIDIA GPU support' not in ' '.join(view['items'])
    W.gpu_known = lambda: False
    view = controller.view()
    assert dict((b[0], b[2]) for b in view['buttons'])['install'] is False and 'Checking this PC' in ' '.join(view['items'])
    W.detect_gpu, W.gpu_known = (lambda: GOOD_GPU), (lambda: True)
    controller.act('skip')
    assert controller.state == 'skipped' and controller.exit_code == 0
    ok('the first screen says what, why, the GPU/CPU build with download and disk size, and how to install later; Skip for now exits 0')

    # 10. the tkinter window, built hidden: it shows what the model says and closes itself
    try:
        import tkinter
        probe_root = tkinter.Tk()
        probe_root.destroy()
        have_tk = True
    except Exception as error:
        have_tk = False
        print('SKIP: tkinter window checks (%s)' % error)
    if have_tk:
        inst, folder = fresh('tk')
        controller = S.SetupController(inst, lambda: True)
        win = S.Window(controller, show=False)
        win.root.update()
        assert win.root.title() == 'PEAK HOUR — Stem engine'
        assert set(win.buttons) == {'install', 'skip'} and win.heading.cget('text') == 'Install the stem engine'
        assert 'Studio' in win.phase.cget('text')
        win.buttons['skip'].invoke()
        win.run()  # the window ends itself (its after-timer sees "skipped")
        assert controller.state == 'skipped'
        # auto: starts by itself, shows the bar, installs for real (faked parts), closes itself after "installed"
        inst, folder = fresh('tk-auto')
        fake_steps(inst, [])
        controller = S.SetupController(inst, lambda: True)
        win = S.Window(controller, auto=True, show=False)
        win.run()
        assert controller.state == 'done' and W.python_in(folder / 'stem-runtime').is_file() and controller.exit_code == 0
        # the X while it works asks the job to stop and leaves once it has
        inst, folder = fresh('tk-x')
        fake_steps(inst, [], pip_waits)
        gate['block'] = True
        controller = S.SetupController(inst, lambda: True)
        win = S.Window(controller, auto=True, show=False)
        win.root.after(1500, win.on_close)
        win.run()
        assert controller.state in ('cancelled', 'closed') and not controller.busy and controller.exit_code == 2, controller.state
        gate['block'] = False
        ok('the tkinter window (built hidden) shows Install now / Skip for now, installs with --auto and closes itself, and its X cancels safely')

    # 11. Setup's script: the step is last, cannot fail Setup, honours a silent Setup, never touches the engine folders
    import build_installer as B
    ps = (workspace / 'installer' / 'install.ps1').read_text(encoding='utf-8')
    order = [ps.index('$shortcut.Save()'), ps.index('New-ItemProperty -Force -Path $UninstallKey -Name EstimatedSize'),
             ps.index('Say "PEAK HOUR $version is installed in $Destination"'), ps.index("Join-Path $app 'windows_stem_setup.py'")]
    assert order == sorted(order), order
    step = ps[ps.index('# Last step: the stem engine'):]
    assert ps.index('# Last step: the stem engine') > order[2]
    assert 'try {' in step and 'catch {' in step and '-Wait' in step and 'windows_stem_setup.py' in step
    code_lines = '\n'.join(l for l in step.splitlines() if not l.lstrip().startswith('#'))
    assert 'throw' not in code_lines and 'Fail ' not in code_lines and 'exit' not in code_lines, 'the stem step must never fail Setup'
    assert '$Quiet' in step and 'PEAK_HOUR_SETUP_SILENT' in step and '$NoStemEngine' in step
    assert "runtime\\python.exe" in step and '-NoNewWindow' in step
    assert ps.count('windows_stem_setup.py') >= 2  # the header comment and the step
    for name in ('install.ps1', 'uninstall.ps1'):
        text = (workspace / 'installer' / name).read_text(encoding='utf-8')
        assert 'stem-runtime' not in text and 'stem-models' not in text and 'stem-new' not in text, name
        assert not [l for l in text.splitlines() if 'AXIOM' in l and not l.lstrip().startswith('#')], name  # the data folder is only named in comments
        assert not [l for l in text.splitlines() if 'Remove-Item' in l and ('AXIOM' in l or 'LOCALAPPDATA' in l)], name
    assert 'windows_stem_setup.py' in B.REQUIRED_APP_FILES
    cmd = B.setup_cmd_text()
    assert '/quiet' in cmd and '-Quiet' in cmd and 'install.ps1' in cmd and cmd.index('PH_QUIET') < cmd.index('powershell.exe')
    sed = B.setup_sed_text(Path('x.exe'), Path('w'), ['a', 'b'])
    assert 'AdminQuietInstCmd=cmd.exe /c setup.cmd /quiet' in sed and 'UserQuietInstCmd=cmd.exe /c setup.cmd /quiet' in sed
    assert 'AppLaunched=cmd.exe /c setup.cmd' in sed and 'PostInstallCmd=<None>' in sed
    # install.ps1 parses (PowerShell's own parser; nothing is run)
    parse = subprocess.run(['powershell.exe', '-NoProfile', '-Command',
                            "$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('%s',[ref]$null,[ref]$e);$e.Count;$e|%%{$_.Message}"
                            % (workspace / 'installer' / 'install.ps1')], capture_output=True, text=True, timeout=120, creationflags=0x08000000)
    assert parse.stdout.split()[:1] == ['0'], parse.stdout + parse.stderr
    ok('install.ps1 runs the stem step last (after shortcuts, registry, "installed"), cannot fail Setup, skips when silent, leaves engine folders alone; setup.cmd/sed carry /quiet; it parses')

    # 12. the packaged app (when dist is staged) contains the step and the Python it needs
    staged = workspace / 'dist' / 'PEAK HOUR'
    if (staged / 'app' / 'windows_stem_setup.py').exists():
        assert (staged / 'runtime' / 'DLLs' / '_tkinter.pyd').exists() and (staged / 'runtime' / 'tcl').is_dir()
        ok('the staged package has tkinter for the window')
    else:
        print('SKIP: dist/PEAK HOUR has no windows_stem_setup.py yet (it is added by the next build)')
finally:
    shutil.rmtree(root, ignore_errors=True)
    try:
        base.rmdir()
    except OSError:
        pass
print('ALL PASSED (%d groups)' % len(passed))
