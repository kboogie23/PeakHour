"""Headless Edge driven over the DevTools protocol by cdp_driver.mjs (node).

    browser = Browser(sandbox, base_url='http://127.0.0.1:8123')
    run = browser.run([{'op': 'navigate', 'url': '/'}, {'op': 'eval', 'expr': 'document.title', 'as': 'title'}])
    run.ok, run.vars['title'], run.steps[0]['seconds'], run.network, run.errors, run.dialogs

The browser starts on the first run() and keeps its page between runs. Its profile lives in the sandbox.
"""
import json
import os
import queue
import shutil
import socket
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DRIVER = HERE / 'cdp_driver.mjs'
EDGES = [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
         r'C:\Program Files\Microsoft\Edge\Application\msedge.exe']
NODES = [r'C:\Program Files\nodejs\node.exe', r'C:\Program Files (x86)\nodejs\node.exe']
# axiom_windows_launcher.KEEP_AWAKE: a covered or minimised window must keep polling
KEEP_AWAKE = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding',
              '--disable-backgrounding-occluded-windows']


def find_edge():
    return next((e for e in EDGES if os.path.isfile(e)), None)


def find_node():
    return shutil.which('node') or next((n for n in NODES if os.path.isfile(n)), None)


def available():
    """(ok, reason) - can the UI checks run on this PC?"""
    if not find_edge():
        return False, 'Microsoft Edge is not installed'
    if not find_node():
        return False, 'node.js is not installed'
    return True, ''


def _free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def _kill_tree(proc):
    if proc is None or proc.poll() is not None:
        return
    subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)], capture_output=True)
    try:
        proc.wait(10)
    except Exception:
        proc.kill()


def _kill_profile_users(profile):
    """Edge processes left over from an earlier run on this profile (they would hand the new window to the old process)."""
    script = ("Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -and "
              "$_.CommandLine.ToLower().Contains($env:FC_PROFILE.ToLower()) } | ForEach-Object { taskkill /F /T /PID $_.ProcessId | Out-Null }")
    try:
        subprocess.run(['powershell', '-NoProfile', '-Command', script], capture_output=True, timeout=30,
                       env=dict(os.environ, FC_PROFILE=str(profile)))
    except (OSError, subprocess.SubprocessError):
        pass


class Run(dict):
    """The reply of one run(): ok, steps (one dict per step), vars, network, errors, dialogs, shots."""

    @property
    def ok(self):
        return bool(self.get('ok'))

    @property
    def steps(self):
        return self.get('steps', [])

    @property
    def vars(self):
        return self.get('vars', {})

    @property
    def network(self):
        return self.get('network', [])

    @property
    def errors(self):
        return self.get('errors', [])

    @property
    def dialogs(self):
        return self.get('dialogs', [])

    @property
    def shots(self):
        return self.get('shots', [])

    def failed(self):
        """The steps that did not work, as 'op: error' strings."""
        return [f"{s.get('op')}: {s.get('error', 'failed')}" for s in self.steps if not s.get('ok')]

    def step(self, index):
        return self.steps[index]


class BrowserError(RuntimeError):
    pass


class Browser:
    def __init__(self, sandbox=None, base_url='', port=None, shots=None, edge=None, node=None, width=1400, height=900,
                 headless=True, autostart=True, **ignored):
        """sandbox: folder for the browser profile; base_url: where relative navigate urls go. edge / node: program paths
        (found when not given). The browser opens now (autostart) so a PC without Edge or node fails here, not in a check."""
        self.sandbox = Path(sandbox)
        self.base_url = base_url.rstrip('/') + '/' if base_url else ''
        self.port = port
        self.shots = Path(shots) if shots else None
        self.edge_path = str(edge) if edge else None
        self.node_path = str(node) if node else None
        self.width, self.height = width, height
        self.headless = headless
        self.edge = None
        self.node = None
        self.debug_port = None
        self._lines = queue.Queue()
        self._next_id = 0
        self._started = False
        self.downloads = self.sandbox / 'downloads'
        if autostart:
            self.start()

    # ------------------------------------------------------------------ lifecycle
    def start(self):
        if self._started:
            return self
        ok, why = available()
        if not ok:
            raise BrowserError(why)
        self.downloads = self.sandbox / 'downloads'
        self.downloads.mkdir(parents=True, exist_ok=True)
        child_env = self._child_env()                      # raises rather than starting Edge in the real environment
        profile = self.sandbox / ('browser-profile-%d-%d' % (os.getpid(), int(time.time() * 1000) % 10**8))
        profile.mkdir(parents=True, exist_ok=True)
        self._write_preferences(profile)
        for attempt in range(4):
            _kill_profile_users(profile)
            self.debug_port = _free_port()
            args = [self.edge_path or find_edge(), f'--remote-debugging-port={self.debug_port}', f'--user-data-dir={profile}',
                    '--no-first-run', '--no-default-browser-check', '--disable-features=msEdgeStartupBoost',
                    '--disable-extensions', '--mute-audio', f'--window-size={self.width},{self.height}',
                    # no internet: everything but this PC goes to a proxy that nothing listens on
                    '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost;[::1]', *KEEP_AWAKE]
            if self.headless:
                args.insert(1, '--headless=new')
            args.append('about:blank')
            self.edge = subprocess.Popen(args, env=child_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{self.debug_port}/json/version', timeout=2):
                        break
                except OSError:
                    time.sleep(0.2)
            else:
                _kill_tree(self.edge)
                self.edge = None
                continue
            if self._wait_for_page():
                break
            _kill_tree(self.edge)
            self.edge = None
        else:
            raise BrowserError('Edge did not open its debugging port')
        self.node = subprocess.Popen([self.node_path or find_node(), str(DRIVER), str(self.debug_port), '--serve'], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', bufsize=1)
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=lambda: [None for _ in self.node.stderr], daemon=True).start()
        self._started = True
        self.run([{'op': 'downloads', 'path': str(self.downloads)}])
        return self

    def _child_env(self):
        """Edge runs in the sandbox's environment (home, AppData, Temp inside the sandbox), like the app and the legacy tests.
        Raises when that cannot be built: Edge must never fall back to the real environment."""
        from feature_check import sandbox as sb
        return sb.Sandbox(self.sandbox).env(guard='off')

    def _write_preferences(self, profile):
        """Every tab (popups and new tabs too) downloads into the sandbox downloads folder without asking."""
        default = Path(profile) / 'Default'
        default.mkdir(parents=True, exist_ok=True)
        path = default / 'Preferences'
        try:
            prefs = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            prefs = {}
        prefs.setdefault('download', {}).update(default_directory=str(self.downloads), prompt_for_download=False, directory_upgrade=True)
        prefs.setdefault('savefile', {}).update(default_directory=str(self.downloads))
        path.write_text(json.dumps(prefs), encoding='utf-8')

    def _wait_for_page(self, seconds=25):
        """True once the debugging port lists a page target the driver can attach to (a cold Edge can take many seconds)."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline and self.edge is not None and self.edge.poll() is None:
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{self.debug_port}/json', timeout=2) as r:
                    if any(t.get('type') == 'page' and t.get('webSocketDebuggerUrl') for t in json.load(r)):
                        return True
            except (OSError, ValueError):
                pass
            time.sleep(0.25)
        return False

    def _read(self):
        for line in self.node.stdout:
            self._lines.put(line)
        self._lines.put(None)

    def close(self):
        node, edge = self.node, self.edge
        self.node = self.edge = None
        self._started = False
        if node is not None:
            try:
                node.stdin.close()
            except Exception:
                pass
            _kill_tree(node)
        _kill_tree(edge)

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.close()

    # ------------------------------------------------------------------ steps
    def run(self, steps, timeout=180):
        """Run the steps in order in the one open tab; returns a Run (a dict with helpers)."""
        self.start()
        steps = [dict(s) for s in steps]
        for step in steps:
            if step.get('op') == 'navigate' and step['url'].startswith('/') and self.base_url:
                step['url'] = self.base_url.rstrip('/') + step['url']
            if step.get('op') == 'screenshot':
                step['path'] = str(step['path'])
        self._next_id += 1
        request = {'id': self._next_id, 'base': self.base_url, 'steps': steps}
        try:
            self.node.stdin.write(json.dumps(request) + '\n')
            self.node.stdin.flush()
        except (OSError, ValueError) as exc:
            raise BrowserError(f'the browser driver is not running: {exc}')
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise BrowserError(f'the browser did not answer within {timeout} s')
            try:
                line = self._lines.get(timeout=min(left, 1.0))
            except queue.Empty:
                if self.node.poll() is not None:
                    raise BrowserError('the browser driver stopped')
                continue
            if line is None:
                raise BrowserError('the browser driver stopped')
            try:
                reply = json.loads(line)
            except ValueError:
                continue
            if reply.get('id') == request['id'] or 'error' in reply and 'id' not in reply:
                done = reply.setdefault('steps', [])
                for step in steps[len(done):]:     # steps after a failed required one: present, marked not run
                    done.append({'op': step.get('op'), 'ok': False, 'error': 'not run: an earlier required step failed', 'seconds': 0})
                return Run(reply)

    # Short forms the checks share
    def open(self, path='/', settle=2500):
        return self.run([{'op': 'navigate', 'url': path, 'settle': settle}])

    def eval(self, expr, timeout=60):
        r = self.run([{'op': 'eval', 'expr': expr, 'timeout': timeout}])
        step = r.steps[0] if r.steps else {}
        if not step.get('ok'):
            raise BrowserError(step.get('error', 'eval failed'))
        return step.get('value')
