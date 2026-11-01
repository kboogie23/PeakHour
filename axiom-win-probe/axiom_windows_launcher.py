"""AXIOM DJ launcher for Windows (prototype).

The Windows counterpart of the packaged macOS launcher (axiom_desktop_launcher):
start AXIOM's Flask server on the loopback interface and open the cockpit.

Differences from macOS, by design:
- Data lives in %LOCALAPPDATA%\\AXIOM DJ (AXIOM_RUNTIME_DIR), not ~/Library.
- If the port is taken by another program it is never killed (macOS used
  kill -9); a free port is chosen instead. A running AXIOM is reused.
- The cockpit opens in a Microsoft Edge app window with its own profile, or in
  Google Chrome when chosen in Settings (windows_browser.py), and AXIOM stops when
  that window closes. With neither, the default browser opens and a "Quit AXIOM"
  dialog stops it.
- Requests are accepted only from this computer with the expected Host header, and a
  request that changes something must come from AXIOM's own page (Origin check).
- The home-network hub for other laptops (windows_remote_hub.py) starts only when
  AXIOM_HUB=1.
- Activation is off by default for now, at the owner's request (2026-10-30), using
  AXIOM's own AXIOM_LICENSE_REQUIRED setting, which reports "dev_unlocked".
  Start with AXIOM_LICENSE_REQUIRED=1 to require activation again; AXIOM's licence
  code itself is unchanged.
"""
import ctypes
import msvcrt
import os
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP_NAME = 'AXIOM DJ'  # data and recordings folder name; kept so libraries and settings never move
DISPLAY_NAME = 'PEAK HOUR'  # the Windows edition's name, shown to the user
HOST = '127.0.0.1'
PREFERRED_PORT = int(os.environ.get('AXIOM_PORT', '8080'))


def data_root():
    return Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local') / APP_NAME


def log_file():
    return data_root() / 'Logs' / 'launch.log'


def log(message):
    try:
        log_file().parent.mkdir(parents=True, exist_ok=True)
        with open(log_file(), 'a', encoding='utf-8') as handle:
            handle.write(time.strftime('%Y-%m-%d %H:%M:%S ') + message + '\n')
    except OSError:
        pass


def show_dialog(title, message):
    """Windows message box; returns True when OK was pressed."""
    flags = 0x40 | 0x40000  # information icon, topmost
    return ctypes.windll.user32.MessageBoxW(None, message, title, flags) == 1


def port_is_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind((HOST, port))
            return True
        except OSError:
            return False


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((HOST, 0))
        return probe.getsockname()[1]


def is_axiom(url):
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            return b'AXIOM' in response.read(65536)
    except OSError:
        return False


class SingleInstance:
    """Exclusive lock on %LOCALAPPDATA%\\AXIOM DJ\\launcher.lock; the port of the
    running instance is kept in launcher.port."""

    def __init__(self):
        root = data_root()
        root.mkdir(parents=True, exist_ok=True)
        self.lock_path, self.port_path = root / 'launcher.lock', root / 'launcher.port'
        self.handle = open(self.lock_path, 'a+b')

    def acquire(self):
        try:
            self.handle.seek(0)
            msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            return True
        except OSError:
            return False

    def running_port(self):
        try:
            return int(self.port_path.read_text(encoding='ascii').strip())
        except (OSError, ValueError):
            return None

    def publish(self, port):
        self.port_path.write_text(str(port), encoding='ascii')

    def release(self):
        try:
            self.port_path.unlink(missing_ok=True)
            self.handle.seek(0)
            msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
        self.handle.close()


def virtualdj_policy(is_safe_location):
    """Files the VirtualDJ endpoints may open: AXIOM's normal safe locations plus
    VirtualDJ's own home folder (AppData is otherwise excluded)."""
    homes = [Path(os.environ.get('LOCALAPPDATA', ''), 'VirtualDJ'), Path(os.environ.get('USERPROFILE', ''), 'Documents', 'VirtualDJ')]
    homes = [h.resolve() for h in homes if h.is_dir()]

    def allowed(path):
        path = Path(path)
        if is_safe_location(path):
            return True
        resolved = path.resolve()
        return resolved.is_file() and any(resolved.is_relative_to(home) for home in homes)
    return allowed


def build_app(port, device=False):
    """The backend for this PC; device=True is a laptop's engine: no file of this PC is permitted."""
    os.environ.setdefault('AXIOM_RUNTIME_DIR', str(data_root()))
    os.environ.setdefault('AXIOM_LICENSE_REQUIRED', '0')  # activation off for now; see module notes
    log('Activation ' + ('required' if os.environ['AXIOM_LICENSE_REQUIRED'].strip().lower() in ('1', 'true', 'yes', 'on') else 'not required (AXIOM_LICENSE_REQUIRED=0)'))
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    os.chdir(HERE)
    import imageio_ffmpeg
    from windows_bootstrap import build_backend
    from windows_paths import is_safe_location
    deny_all = lambda path: False
    video_policy, vdj_policy = (deny_all, deny_all) if device else (is_safe_location, virtualdj_policy(is_safe_location))
    root = data_root()
    recordings = Path(os.environ.get('USERPROFILE') or Path.home(), 'Music', APP_NAME, 'Recordings')
    recordings.mkdir(parents=True, exist_ok=True)
    (root / 'Video Cache').mkdir(parents=True, exist_ok=True)
    axiom = build_backend(recording_settings=root / 'recording-settings.json', recording_directory=recordings,
                          video_cache_root=root / 'Video Cache', video_allowed_path=video_policy,
                          video_ffmpeg=imageio_ffmpeg.get_ffmpeg_exe(),
                          virtualdj_allowed_path=vdj_policy, safe_location=deny_all if device else None)
    if device:
        from windows_audio import NoAudioDeck
        axiom.NATIVE_AUDIO_DECK = NoAudioDeck()
    from windows_hotkey import LiveAssistHotkey, create_hotkey_blueprint
    axiom.LIVE_ASSIST_HOTKEY = LiveAssistHotkey(root / 'live-assist-hotkey.json')  # started by main() once the window URL is known
    axiom.app.register_blueprint(create_hotkey_blueprint(axiom.LIVE_ASSIST_HOTKEY))
    from windows_mac_parity import reveal
    from windows_stress_report import Activity, StressReport, create_stress_report_blueprint
    version_file = HERE.parent / 'version.txt'  # present in an installed copy
    version = version_file.read_text(encoding='utf-8').strip() if version_file.is_file() else 'development copy'
    axiom.STRESS_REPORT = StressReport(axiom, Activity().install(axiom.app), cache_path=axiom.CACHE_PATH,
                                       log_folder=log_file().parent, version=version)
    axiom.app.register_blueprint(create_stress_report_blueprint(axiom.STRESS_REPORT, reveal))
    from windows_ai import AIAssist, create_ai_blueprint
    axiom.app.config['PEAK_HOUR_HOST'] = f'{HOST}:{port}'  # AI Assist saves approved changes through PEAK HOUR's own endpoints
    axiom.AI_ASSIST = AIAssist(axiom, root / 'ai')
    axiom.app.register_blueprint(create_ai_blueprint(axiom.AI_ASSIST))
    from windows_browser import WindowBrowser, create_browser_blueprint
    axiom.app.register_blueprint(create_browser_blueprint(WindowBrowser(root), lambda: (window_browser() or [None])[0]))
    allowed_hosts = {f'{HOST}:{port}', f'localhost:{port}'}
    allowed_origins = {f'http://{host}' for host in allowed_hosts}
    from flask import request, abort

    @axiom.app.before_request
    def local_only():
        if request.remote_addr not in ('127.0.0.1', '::1') or request.host not in allowed_hosts:
            abort(403)
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):  # cross-site pages may not change anything
            origin = request.headers.get('Origin')
            if origin is not None:  # includes the opaque "null" origin, which is never accepted
                if origin.rstrip('/') not in allowed_origins:
                    abort(403)
            elif request.headers.get('Sec-Fetch-Site') not in ('same-origin', 'none'):
                abort(403)
    return axiom


def finish_recording(axiom, instance=None, wav_seconds=60, mp3_seconds=1900):
    """Closing the window must not lose a set that is still being recorded: stop it cleanly so the
    WAV is finalised and renamed. If that fails, the partial file is left where it is for recovery.
    The stop runs in a thread with a time limit (a stuck driver must not keep PEAK HOUR open forever);
    while it runs a second launch is told the recording is being saved instead of opening a window."""
    manager = getattr(axiom, 'SET_RECORDING_MANAGER', None)
    stop = getattr(manager, 'stop_if_recording', None)
    if stop is None:
        return

    def work():
        try:
            result = stop()
        except Exception:
            log('A recording was in progress and could not be stopped cleanly; the partial file was left for recovery:\n' + traceback.format_exc())
            return
        if result:
            log(f'A recording was in progress; stopped and saved it ({result.get("saved_path") or "path unknown"}, '
                f'{result.get("dropouts", 0)} short dropouts)')
    try:
        mp3 = manager.status().get('format') == 'mp3'
    except Exception:
        mp3 = False
    if instance is not None:
        try:
            instance.publish(0)  # port 0: "saving your recording" (see main)
        except OSError:
            pass
    worker = threading.Thread(target=work, name='axiom-finish-recording', daemon=True)
    worker.start()
    worker.join(mp3_seconds if mp3 else wav_seconds)
    if worker.is_alive():
        log(f'Stopping the recording took longer than {mp3_seconds if mp3 else wav_seconds} s; closing anyway. '
            'The files in the recordings folder were left as they are and can be recovered.')


def edge_command(edge, url, profile):
    """App window for the cockpit (Edge or Chrome take the same switches): its own profile, opened
    maximized like the full-size macOS window (Edge's default placement could sit off to the right)."""
    return [str(edge), f'--app={url}', f'--user-data-dir={profile}', '--start-maximized', '--no-first-run',
            '--no-default-browser-check', '--disable-features=msEdgeStartupBoost']


# The browser the open window uses: (name, program, profile), or None for the default browser.
WINDOW = None


def window_browser():
    global WINDOW
    if WINDOW is None:
        from windows_browser import WindowBrowser
        WINDOW = WindowBrowser(data_root()).resolve() or False
    return WINDOW or None


def open_live_assist(url):
    """Live Assist in its own app window, in the cockpit's browser and profile (Ctrl+F in the DJ software)."""
    browser = window_browser()
    target = f'{url}live_assist_window?popup=1&open={int(time.time() * 1000)}'
    if not browser:
        os.startfile(target)
        return
    subprocess.Popen([str(browser[1]), f'--app={target}', f'--user-data-dir={browser[2]}', '--window-size=438,690',
                      '--no-first-run', '--no-default-browser-check', '--disable-features=msEdgeStartupBoost'], close_fds=True)


def open_window(url):
    """Open the cockpit; returns a process to wait on, or None (browser fallback)."""
    browser = window_browser()
    if browser:
        log(f'Opening {browser[0]} app window')
        return subprocess.Popen(edge_command(browser[1], url, browser[2]), close_fds=True)
    log('Neither Edge nor Chrome found; opening the default browser')
    os.startfile(url)
    return None


def profile_in_use(profile):
    """True while an Edge process has AXIOM's window profile open: Edge keeps the
    profile's lockfile open without sharing until its last window closes."""
    lock = Path(profile) / 'lockfile'
    try:
        with open(lock, 'rb'):
            return False
    except FileNotFoundError:
        return False
    except PermissionError:
        return True


def wait_for_server(port, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.settimeout(0.5)
            if probe.connect_ex((HOST, port)) == 0:
                return True
        time.sleep(0.25)
    return False


def log_server_errors():
    """pythonw has no console: send AXIOM's warnings and request errors to the log."""
    import logging
    log_file().parent.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(log_file(), encoding='utf-8')
    handler.setLevel(logging.WARNING)
    handler.setFormatter(logging.Formatter('%(asctime)s %(name)s %(levelname)s %(message)s', '%Y-%m-%d %H:%M:%S'))
    logging.getLogger().addHandler(handler)
    logging.getLogger('werkzeug').setLevel(logging.WARNING)  # no per-request lines in the log
    if sys.stderr is None:  # pythonw
        sys.stderr = open(log_file(), 'a', encoding='utf-8', buffering=1)


def main():
    log_server_errors()
    log('=' * 72)
    log(f'AXIOM launch requested executable={sys.executable}')
    instance = SingleInstance()
    if not instance.acquire():
        port = instance.running_port()
        if port == 0:  # the first PEAK HOUR is finishing a recording
            show_dialog(DISPLAY_NAME, 'PEAK HOUR is saving your recording. Please wait a moment, then open it again.')
            return 0
        url = f'http://{HOST}:{port}/' if port else None
        log(f'Another AXIOM launcher is running (port {port})')
        if url and is_axiom(url):
            if os.environ.get('AXIOM_NO_OPEN') != '1':
                open_window(url)
        else:
            show_dialog(DISPLAY_NAME, 'PEAK HOUR is already starting. Please wait a moment, then try again.')
        return 0
    server = hub = axiom = None
    try:
        port = PREFERRED_PORT if port_is_free(PREFERRED_PORT) else free_port()
        if port != PREFERRED_PORT:
            log(f'Port {PREFERRED_PORT} is in use by another program; using {port}')
        url = f'http://{HOST}:{port}/'
        axiom = build_app(port)
        from werkzeug.serving import make_server
        server = make_server(HOST, port, axiom.app, threaded=True)
        threading.Thread(target=server.serve_forever, name='axiom-server', daemon=True).start()
        if not wait_for_server(port):
            raise RuntimeError(f'AXIOM did not start listening at {url}')
        instance.publish(port)
        log(f'AXIOM server running at {url}')
        if os.environ.get('AXIOM_HUB') == '1':  # opt-in: other laptops on the home network
            try:
                from windows_remote_hub import start_hub
                hub = start_hub(data_root(), port, log=log)
                log(f'Other laptops on the home network: {hub[2]}' if hub else 'No home network found; laptops cannot connect.')
            except OSError as exc:
                log(f'Home-network access unavailable: {exc}')
        axiom.LIVE_ASSIST_HOTKEY.opener = lambda: open_live_assist(url)
        axiom.LIVE_ASSIST_HOTKEY.start()
        log('Ctrl+F in the DJ software shows Live Assist (' + ('on' if axiom.LIVE_ASSIST_HOTKEY.snapshot()['enabled'] else 'off') + ')')
        if os.environ.get('AXIOM_NO_OPEN') == '1':
            threading.Event().wait()
        window = open_window(url)
        if window is not None:
            window.wait()
            # If an AXIOM window was already open, Edge (or Chrome) hands the new one
            # to that process and this one exits within seconds. Serve until no
            # browser process holds AXIOM's window profile any more.
            while profile_in_use(window_browser()[2]):
                time.sleep(1)
        else:
            show_dialog(DISPLAY_NAME, f'PEAK HOUR is running at {url}\n\nKeep this message open while you use PEAK HOUR.\nClick OK to quit PEAK HOUR.')
        log('AXIOM window closed; stopping')
        finish_recording(axiom, instance)
        return 0
    except Exception:
        detail = traceback.format_exc()
        log('AXIOM failed to start:\n' + detail)
        show_dialog(DISPLAY_NAME, f'PEAK HOUR could not start.\n\nDetails are in:\n{log_file()}')
        return 1
    finally:
        if axiom is not None:
            finish_recording(axiom, instance)  # also when startup failed or something else ended the launcher
        if hub:
            hub[0].shutdown()
            hub[1].stop_all()
        if server is not None:
            server.shutdown()
        instance.release()


if __name__ == '__main__':
    sys.exit(main())
