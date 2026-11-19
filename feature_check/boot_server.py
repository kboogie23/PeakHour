"""Boot PEAK HOUR's backend for a feature-check run (run as a subprocess by sandbox.start_server).

  python boot_server.py --sandbox DIR [--installed INSTALL_DIR] [--inject NAME]

Prints "READY <port>" when the server answers. Everything the app could do to the outside world is faked here and
nowhere in the app itself:
  * sounddevice OutputStream / InputStream are silent null streams (nothing plays, nothing records);
  * windows_stress_report.desktop_folder -> <sandbox>\\User\\Desktop;
  * every windows_dialogs chooser returns a sandbox path (overridable per check through <sandbox>\\dialogs.json
    {"folder":..., "serato":..., "vdj_database":..., "vdj_list":..., "cancel": true});
  * app._mac_process_snapshot reads <sandbox>\\processes.json, a list of running program names, e.g. ["VirtualDJ"];
  * requests to anything but loopback raise ConnectionError (urllib and sockets are stopped by the guard);
  * /api/_featurecheck/metrics (check-only blueprint, this script only): load_cache call count, per-route timings.
--inject (only with FEATURE_CHECK_SELFTEST=1) plants one known fault so the harness can prove it notices it:
  prompt_reconnect, slow_source_check, visible_only_poll, reread_cache, mac_update, bad_day_colours.
"""
import os
import re
import sys
import json
import time
import argparse
import pathlib
import threading

HERE = pathlib.Path(__file__).resolve().parent
PROJECT = HERE.parent
sys.path.insert(0, str(HERE))
guard = sys.modules.get('feature_check_guard')  # already loaded by sitecustomize when PYTHONPATH carries feature_check
if guard is None:
    import guard  # noqa: E402  (first: the audit hook is installed before the app is imported)
guard.install()

INJECTIONS = ('prompt_reconnect', 'slow_source_check', 'visible_only_poll', 'reread_cache', 'mac_update', 'bad_day_colours')


def pick_port():
    import socket
    while True:
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            port = s.getsockname()[1]
        if port != 8080:
            return port


def read_json(path, default):
    try:
        return json.loads(pathlib.Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return default


class NullStream:
    """Stands in for sounddevice.OutputStream / InputStream: accepts everything, makes and hears nothing."""

    def __init__(self, *args, **kwargs):
        self.samplerate = kwargs.get('samplerate') or 44100.0
        self.channels = kwargs.get('channels') or 2
        self.latency = 0.0
        self.active = False
        self.closed = False
        self.device = kwargs.get('device')

    def start(self):
        self.active = True

    def stop(self):
        self.active = False

    def abort(self):
        self.active = False

    def close(self):
        self.active = False
        self.closed = True

    def write(self, data):
        return False

    def read(self, frames):
        import numpy
        return numpy.zeros((frames, self.channels), dtype='float32'), False

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.close()
        return False


def fake_outside_world():
    """Before the launcher is imported: modules such as windows_feed / windows_capture keep sd.OutputStream as a default
    argument, so sounddevice must already be faked when they load. Also nothing may open a player or a browser."""
    try:
        import sounddevice
        sounddevice.OutputStream = NullStream
        sounddevice.InputStream = NullStream
        sounddevice.play = lambda *a, **k: None
    except Exception as exc:  # no PortAudio: the audio code reports its own error
        print('feature-check: sounddevice not faked (%r)' % (exc,), flush=True)
    os.startfile = lambda *a, **k: print('feature-check: os.startfile blocked: %r' % (a[:1],), flush=True)  # windows_recording.play_saved
    import webbrowser
    for name in ('open', 'open_new', 'open_new_tab'):
        setattr(webbrowser, name, lambda *a, **k: True)
    import subprocess
    real_init = subprocess.Popen.__init__

    def guarded_init(self, args, *a, **k):
        # python -I ignores PYTHONPATH (and so the guard): run those children with -s -P instead
        if isinstance(args, (list, tuple)) and '-I' in list(args)[:3]:
            args = [x for item in args for x in (((['-s', '-P'] if sys.version_info >= (3, 11) else ['-s']) if item == '-I' else [item]))]
        return real_init(self, args, *a, **k)

    subprocess.Popen.__init__ = guarded_init


def guard_unhooked_writes():
    """Shell / ctypes writes the audit hook cannot see get the guard's path rules by hand."""
    check = guard.check_path
    try:
        import windows_mac_parity as parity
        original = parity._shell_recycle

        def guarded_shell(path):
            check(path, 'remove')  # the media rule applies: a music file is never sent to the Recycle Bin
            return original(path)

        parity._shell_recycle = guarded_shell
        defaults = tuple(guarded_shell if d is original else d for d in (parity.recycle.__defaults__ or ()))
        parity.recycle.__defaults__ = defaults
    except Exception as exc:
        print('feature-check: recycle not guarded (%r)' % (exc,), flush=True)
    try:
        import windows_djay as djay
        original_replace = djay._replace

        def guarded_replace(src, dst, **kw):
            check(src, 'rename-from')
            check(dst, 'dst')
            return original_replace(src, dst, **kw)

        djay._replace = guarded_replace
        djay.OS_PROXY.replace = guarded_replace
    except Exception as exc:
        print('feature-check: djay replace not guarded (%r)' % (exc,), flush=True)


def close_databases():
    import gc
    import sqlite3
    gc.collect()
    for obj in gc.get_objects():
        if isinstance(obj, sqlite3.Connection):
            try:
                obj.close()
            except Exception:
                pass


def install_fakes(axiom, sandbox, real=False):
    desktop = sandbox / 'User' / 'Desktop'
    try:
        import sounddevice
        sounddevice.OutputStream = NullStream
        sounddevice.InputStream = NullStream
        sounddevice.play = lambda *a, **k: None
    except Exception as exc:  # no PortAudio: the audio code reports its own error
        print('feature-check: sounddevice not faked (%r)' % (exc,), flush=True)

    import windows_stress_report
    windows_stress_report.desktop_folder = lambda: desktop
    if getattr(axiom, 'STRESS_REPORT', None) is not None:
        axiom.STRESS_REPORT.output = lambda: desktop

    import windows_dialogs

    def answers():
        return read_json(sandbox / 'dialogs.json', {})

    def answer(key, default):
        data = answers()
        if data.get('cancel'):
            return '', True
        return os.path.normpath(str(data.get(key) or default)), False

    music = sandbox / 'User' / 'Music'
    vdj_home = sandbox / 'AppData' / 'Local' / 'VirtualDJ'
    serato_db = music / '_Serato_' / 'database V2'
    if real:  # the dialogs answer with the owner's real places unless a check says otherwise (dialogs.json)
        music = pathlib.Path(os.environ['USERPROFILE']) / 'Music'
        vdj_home = pathlib.Path(os.environ['LOCALAPPDATA']) / 'VirtualDJ'
        serato_db = music / '_Serato_' / 'database V2'

    def fake_dialog(choose, **options):
        title = str(options.get('title', ''))
        if 'Serato' in title:
            return answer('serato', serato_db)
        if 'VirtualDJ' in title and 'list' in title.lower():
            return answer('vdj_list', vdj_home / 'Folders' / 'list.vdjfolder')
        if 'VirtualDJ' in title:
            return answer('vdj_database', vdj_home / 'database.xml')
        return answer('folder', music)

    windows_dialogs._dialog = fake_dialog
    axiom.choose_folder_dialog = lambda prompt='Choose your music folder': answer('folder', music)
    axiom.choose_serato_database_dialog = lambda: answer('serato', serato_db)
    if getattr(axiom, 'WINDOWS_RECONNECT', None) is not None:
        axiom.WINDOWS_RECONNECT.chooser = lambda prompt: answer('folder', music)

    process_file = sandbox / 'processes.json'

    def snapshot(*names):
        running = {str(n).casefold() for n in read_json(process_file, [])}
        if any(str(n).casefold() in running for n in names):
            return {'running': True, 'token': '4242', 'started_at': None, 'pids': [4242]}
        if 'Serato DJ Pro' in names and 'virtualdj' in running:  # VirtualDJ is served through the Serato slot, as in the app
            return {'running': True, 'token': 'virtualdj:4242', 'started_at': None, 'pids': [4242]}
        return {'running': False, 'token': '', 'started_at': None, 'pids': []}

    axiom._mac_process_snapshot = snapshot

    # drive discovery must not reach the owner's real DJ folders (D:\VirtualDJ, E:\_Serato_ ...): only the sandbox homes are used
    import importlib
    for name in (() if real else ('windows_serato_paths', 'windows_virtualdj_library', 'windows_virtualdj_write', 'windows_virtualdj_lists')):
        try:
            module = importlib.import_module(name)
        except Exception:
            continue
        if hasattr(module, 'local_drive_roots'):
            module.local_drive_roots = lambda: []
    for name, module in list(sys.modules.items()):
        if not real and name.startswith('windows_') and hasattr(module, 'local_drive_roots'):
            module.local_drive_roots = lambda: []

    try:
        import requests
        real_request = requests.sessions.Session.request

        def request(self, method, url, *args, **kwargs):
            from urllib.parse import urlsplit
            host = (urlsplit(str(url)).hostname or '').lower()
            if host in ('127.0.0.1', 'localhost', '::1'):
                return real_request(self, method, url, *args, **kwargs)
            raise requests.exceptions.ConnectionError('feature-check: network is disabled (%s %s)' % (method, url))

        requests.sessions.Session.request = request
    except ImportError:
        pass


def install_metrics(axiom):
    from flask import Blueprint, jsonify, request, g
    lock = threading.Lock()
    state = {'load_cache_calls': 0, 'routes': {}, 'recent': [], 'started': time.time()}
    real_load = axiom.load_cache

    def counting_load(*args, **kwargs):
        with lock:
            state['load_cache_calls'] += 1
        return real_load(*args, **kwargs)

    axiom.load_cache = counting_load
    axiom.app.config['FEATURE_CHECK_REAL_LOAD_CACHE'] = real_load
    blueprint = Blueprint('featurecheck', __name__)

    @blueprint.route('/api/_featurecheck/shutdown', methods=['POST'])
    def shutdown():
        server = axiom.app.config.get('FEATURE_CHECK_SERVER')
        if server is not None:
            threading.Thread(target=server.shutdown, daemon=True).start()
        return jsonify(ok=True)

    @blueprint.route('/api/_featurecheck/metrics')
    def metrics():
        with lock:
            if request.args.get('reset'):
                state['load_cache_calls'] = 0
                state['routes'] = {}
                state['recent'] = []
            return jsonify(load_cache_calls=state['load_cache_calls'], routes=dict(state['routes']),
                           recent=list(state['recent'][-100:]), uptime=round(time.time() - state['started'], 1))

    @axiom.app.before_request
    def start_timer():
        g._fc_t0 = time.perf_counter()

    @axiom.app.after_request
    def record(response):
        t0 = getattr(g, '_fc_t0', None)
        if t0 is not None and not request.path.startswith('/api/_featurecheck/'):
            seconds = time.perf_counter() - t0
            key = '%s %s' % (request.method, request.url_rule.rule if request.url_rule else request.path)
            with lock:
                row = state['routes'].setdefault(key, {'count': 0, 'total_s': 0.0, 'max_s': 0.0, 'last_s': 0.0})
                row['count'] += 1
                row['total_s'] = round(row['total_s'] + seconds, 4)
                row['max_s'] = round(max(row['max_s'], seconds), 4)
                row['last_s'] = round(seconds, 4)
                state['recent'].append({'method': request.method, 'path': request.full_path.rstrip('?'), 'status': response.status_code,
                                        'seconds': round(seconds, 4), 'at': round(time.time(), 3)})
                del state['recent'][:-200]
        return response

    axiom.app.register_blueprint(blueprint)


def install_injection(axiom, name):
    """Deliberate faults for the harness self-test. Only reachable with FEATURE_CHECK_SELFTEST=1."""
    from flask import request, jsonify
    app = axiom.app

    def rewrite(response, function):
        if response.status_code != 200:
            return response
        response.direct_passthrough = False
        text = function(response.get_data(as_text=True))
        response.set_data(text)
        response.headers['Content-Length'] = str(len(response.get_data()))
        response.headers.pop('ETag', None)
        response.headers['Cache-Control'] = 'no-store'
        response.headers.pop('Last-Modified', None)
        return response

    def is_html(response):
        return 'text/html' in (response.headers.get('Content-Type') or '')

    if name == 'prompt_reconnect':
        @app.after_request
        def prompt_override(response):
            if request.path.endswith('windows-reconnect.js'):
                return rewrite(response, lambda t: t.replace('window.relocateLibrary=open;', "window.relocateLibrary=function(){return window.prompt('Old folder path?')};"))
            return response
    elif name == 'slow_source_check':
        @app.before_request
        def slow():
            if request.path == '/api/library/track':
                time.sleep(10)
    elif name == 'visible_only_poll':
        @app.after_request
        def strip_live_watch(response):
            if is_html(response):
                return rewrite(response, lambda t: re.sub(r'<script[^>]*windows-live-watch\.js[^>]*></script>', '', t))
            return response
    elif name == 'reread_cache':
        @app.before_request
        def reread():
            if request.path == '/api/performance/dj/live':
                axiom.load_cache(axiom.CACHE_PATH)
    elif name == 'mac_update':
        @app.before_request
        def fake_update():
            if request.path == '/api/app/check_update':
                return jsonify(success=True, update_available=True, updates_configured=True, version='9.9.9', url='https://example.invalid/mac.dmg')
    elif name == 'bad_day_colours':
        style = ('<style id="featurecheck-bad-day">body.light-mode #axiom-sidebar,body.light-mode #axiom-sidebar *{color:#111 !important;'
                 'background-color:#111 !important;}</style>')

        @app.after_request
        def add_style(response):
            if is_html(response):
                return rewrite(response, lambda t: t.replace('</head>', style + '</head>', 1) if '</head>' in t else t + style)
            return response
    else:
        raise SystemExit('unknown injection %r (known: %s)' % (name, ', '.join(INJECTIONS)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sandbox', required=True)
    parser.add_argument('--installed')
    parser.add_argument('--inject')
    parser.add_argument('--real', action='store_true')
    args = parser.parse_args()
    sandbox = pathlib.Path(args.sandbox)
    if args.inject and os.environ.get('FEATURE_CHECK_SELFTEST') != '1':
        raise SystemExit('--inject needs FEATURE_CHECK_SELFTEST=1')
    for name in ('LOCALAPPDATA', 'USERPROFILE'):
        if not args.real and not os.environ.get(name, '').lower().startswith(str(sandbox).lower()):
            raise SystemExit('refusing to start: %s is not inside the sandbox (%s)' % (name, os.environ.get(name)))
    app_dir = pathlib.Path(args.installed) / 'app' if args.installed else PROJECT / 'axiom-win-probe'
    sys.path.insert(0, str(app_dir))
    fake_outside_world()
    import axiom_windows_launcher as L
    sys.path[:] = [p for p in sys.path if p != str(HERE)]  # the app never sees feature_check's module names
    L.log_server_errors()
    port = pick_port()
    axiom = L.build_app(port)
    install_fakes(axiom, sandbox, args.real)
    guard_unhooked_writes()
    install_metrics(axiom)
    if args.inject:
        install_injection(axiom, args.inject)
    from werkzeug.serving import make_server
    server = make_server(L.HOST, port, axiom.app, threaded=True)
    axiom.app.config['FEATURE_CHECK_SERVER'] = server
    import signal
    for name in ('SIGBREAK', 'SIGTERM'):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), lambda *a: threading.Thread(target=server.shutdown, daemon=True).start())
    print('READY %d' % port, flush=True)
    server.serve_forever()
    close_databases()  # a clean close lets SQLite checkpoint its -wal file
    print('feature-check: server stopped cleanly', flush=True)
    sys.stdout.flush()
    os._exit(0)


if __name__ == '__main__':
    main()
