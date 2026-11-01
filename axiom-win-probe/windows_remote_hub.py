"""AXIOM for other laptops on the home network: one separate library per laptop.

The AXIOM PC keeps serving its own library on 127.0.0.1. This hub listens on
the PC's home-network address (same port) and gives every laptop its own AXIOM
engine: a separate backend process (windows_device_server.py) with its own
AXIOM_RUNTIME_DIR under %LOCALAPPDATA%\\AXIOM DJ\\devices\\<id>, so each
library, its playlists, sets, settings and Health data stay apart. A laptop
names its library on first visit; a cookie brings it back to that library.
A laptop loads its own songs by uploading its DJ database (VirtualDJ
database.xml, Serato database V2 or rekordbox XML; windows_remote_library).

Safety (opt-in: the launcher starts the hub only with AXIOM_HUB=1; this is access
control, not encryption: traffic is plain HTTP, so use it only on a Wi-Fi you trust):
- only private home-network and loopback addresses are served, and only with the
  hub's own address as the Host header (a DNS-rebinding page cannot reach it);
- a laptop must enter a short one-time pairing code, shown on this PC (Library >
  Add music > Other laptops, and the launch log), before it gets a library; the code
  works once, expires after ten minutes, and wrong guesses are limited;
- the laptop then holds a random session token in an HttpOnly, SameSite=Strict
  cookie; only its SHA-256 is stored, and no library ID or token is ever shown;
- requests that would act on this PC are refused for laptops: native file
  dialogs, reading or writing this PC's Serato / djay / VirtualDJ, exports and
  recordings saved to this PC, reopening apps, folder scans of this PC, and
  streaming or previewing this PC's music files. Request targets that are not a
  plain "/path" (percent escapes, "//", dot segments, absolute URLs) are refused;
- a request whose Origin is not the hub itself is refused (cross-site);
- each library engine accepts only requests carrying this run's secret header,
  repeats the same refusals itself, and has no access to this PC's files.
"""
import hashlib
import hmac
import http.client
import ipaddress
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

CREATE_NO_WINDOW = 0x08000000
COOKIE = 'axiom_device'
DEVICE_SERVER = Path(__file__).with_name('windows_device_server.py')
HOP_HEADERS = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers',
               'transfer-encoding', 'upgrade', 'host', 'content-length'}
TOKEN_HEADER = 'X-Axiom-Hub-Token'  # this run's secret: added by the hub, required by every engine
ALLOWED = ('/api/library/connect_dj_source', '/api/windows/remote/whoami')
ACTIVE = {}  # 'registry': the running hub's DeviceRegistry, for the PC-local pairing endpoint
SESSIONS_PER_DEVICE = 20
LOG_LIMIT = 5 * 1024 * 1024  # an engine.log over this size is rotated when its engine starts
LOG_FILES = 3  # engine.log, engine.1.log, engine.2.log
BLOCKED = re.compile(r'choose|serato|djay|virtualdj|/export|export_|publish|recording|reveal|open_|dj_transfer|'
                     r'beatgrid_doctor|/stems|/plugins|mix-export|refresh_audio|coreaudio|add_folder|rescan|'
                     r'^/api/library/scan|ban_folder|/api/windows/|/api/library/stream|/api/video|waveform|'
                     r'^/api/audio/|/api/library/artwork|^/api/studio-daw/|upload_csv_path|import_release_years_csv|'
                     r'lite_migration|^/api/intelligence/|dupes/trash|dupes/software|'
                     r'fix_track|^/api/library/unified_health/|health/audio_sources', re.I)


def rotate_log(path, limit=LOG_LIMIT, files=LOG_FILES):
    """Move a log over the limit to <name>.1<ext> (older ones shift up, the oldest goes). The live file is moved
    aside first: if another program holds it nothing is shifted and no older log is lost."""
    path = Path(path)
    try:
        if path.stat().st_size <= limit:
            return
        moving = path.with_name(f'{path.name}.{os.getpid()}.rotating')
        os.replace(path, moving)
    except OSError:
        return
    try:
        older = [path.with_name(f'{path.stem}.{n}{path.suffix}') for n in range(1, files)]
        for number in range(len(older) - 1, 0, -1):
            if older[number - 1].exists():
                os.replace(older[number - 1], older[number])
        os.replace(moving, older[0])
    except OSError:
        if not path.exists():  # could not shift: put the log back
            try:
                os.replace(moving, path)
            except OSError:
                pass


def is_home_address(address):
    try:
        ip = ipaddress.ip_address(address.split('%')[0])
    except ValueError:
        return False
    return ip.is_loopback or (ip.is_private and not ip.is_multicast) or ip.is_link_local


def blocked(path):
    route = path.split('?', 1)[0]
    if route in ALLOWED or not route.startswith('/api/'):
        return False
    return bool(BLOCKED.search(route))


def plain_target(target):
    """True for a request target of the form /path[?query] that nothing would rewrite: no percent
    escape, "//", backslash, control character or dot segment in the path."""
    route = target.split('?', 1)[0]
    if not route.startswith('/') or '//' in route or '%' in route or '\\' in route or re.search(r'[\x00-\x20\x7f]', target):
        return False
    return not any(part in ('.', '..') for part in route.split('/'))


def install_device_guard(flask_app, token):
    """In a laptop's engine: refuse requests without the hub's secret header, and repeat the hub's
    refusals on the decoded path and the matched route."""
    from flask import abort, request

    def hub_only():
        if not token or not hmac.compare_digest(request.headers.get(TOKEN_HEADER, '').encode(), token.encode()):
            abort(403)
        rule = request.url_rule.rule if request.url_rule else ''
        if blocked(request.path) or blocked(rule) or not plain_target(request.path):
            abort(403)
    flask_app.before_request_funcs.setdefault(None, []).insert(0, hub_only)  # before the core's own hooks


class Pairing:
    """One-time code a laptop enters to get a library; shown only on this PC."""

    def __init__(self, ttl=600, attempts=5, on_new=None):
        self.ttl, self.attempts, self.on_new = ttl, attempts, on_new
        self.lock = threading.Lock()
        self.failures = {}  # client address -> times of wrong codes within the last ttl seconds
        self.code, self.expires = '', 0.0

    def _renew(self):
        self.code, self.expires = f'{secrets.randbelow(10 ** 6):06d}', time.monotonic() + self.ttl
        if self.on_new:
            self.on_new(f'Pairing code for the next laptop: {self.code} (valid {self.ttl // 60} minutes, works once)')

    def current(self):
        """(code, seconds left); a fresh code once the old one has expired."""
        with self.lock:
            if time.monotonic() >= self.expires:
                self._renew()
            return self.code, int(self.expires - time.monotonic())

    def check(self, address, code):
        """(True, '') and the code is spent when right; (False, reason) otherwise."""
        with self.lock:
            now = time.monotonic()
            if now >= self.expires:  # not a wrong guess: a new code is made (and logged) for the next try
                self._renew()
                return False, 'That pairing code has expired. Enter the new code shown on the AXIOM PC.'
            recent = [t for t in self.failures.get(address, []) if now - t < self.ttl]
            self.failures = {a: [t for t in ts if now - t < self.ttl] for a, ts in self.failures.items()}
            self.failures = {a: ts for a, ts in self.failures.items() if ts}
            if len(recent) >= self.attempts or sum(len(ts) for ts in self.failures.values()) >= 6 * self.attempts:
                return False, 'Too many wrong codes. Wait a few minutes, then try again.'
            if not re.fullmatch(r'\d{6}', code or '') or not hmac.compare_digest(code.encode(), self.code.encode()):
                self.failures[address] = recent + [now]
                return False, 'That pairing code is not right, or it has expired. Check the code shown on the AXIOM PC.'
            self._renew()  # single use
            self.failures.pop(address, None)
            return True, ''


def home_address():
    """This PC's address on the home network (no packet is sent)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(('192.168.0.1', 9))
            address = probe.getsockname()[0]
        except OSError:
            address = ''
    return address if address and is_home_address(address) and not address.startswith('127.') else ''


class DeviceRegistry:
    def __init__(self, root, python=sys.executable, server=DEVICE_SERVER, ready_timeout=90):
        self.root = Path(root)
        self.path = self.root / 'devices.json'
        self.python, self.server, self.ready_timeout = python, server, ready_timeout
        self.lock = threading.Lock()
        self.processes = {}
        self.token = secrets.token_hex(32)  # this run's secret between the hub and its engines
        self.pairing = Pairing()
        try:
            self.devices = json.loads(self.path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            self.devices = {}

    def save(self):
        self.root.mkdir(parents=True, exist_ok=True)
        stage = self.path.with_name('devices.json.tmp')
        stage.write_text(json.dumps(self.devices, indent=1), encoding='utf-8')
        os.replace(stage, self.path)

    @staticmethod
    def clean_name(name):
        name = re.sub(r'[\x00-\x1f<>]', '', str(name or '')).strip()[:60]
        if not name:
            raise ValueError('Give this library a name, for example "DJ Mike laptop".')
        return name

    def pair(self, name):
        """(device_id, session_token) for the library called name (made when new); only its hash is kept."""
        name = self.clean_name(name)
        token = secrets.token_urlsafe(32)
        with self.lock:
            device_id = next((i for i, d in self.devices.items() if d['name'].casefold() == name.casefold()), None)
            if device_id is None:
                device_id = secrets.token_hex(8)
                self.devices[device_id] = {'name': name, 'created': time.time()}
            sessions = self.devices[device_id].setdefault('sessions', [])
            sessions.append({'sha256': hashlib.sha256(token.encode()).hexdigest(), 'created': time.time()})
            del sessions[:-SESSIONS_PER_DEVICE]
            self.save()
        return device_id, token

    def device_for(self, token):
        """Library id for a session token, or None."""
        digest = hashlib.sha256(str(token).encode()).hexdigest()
        with self.lock:
            return next((i for i, d in self.devices.items() if any(s.get('sha256') == digest for s in d.get('sessions', []))), None)

    def folder(self, device_id):
        return self.root / 'devices' / device_id

    def backend(self, device_id):
        """Port of the device's running engine, starting it when needed."""
        if device_id not in self.devices:
            raise KeyError(device_id)
        with self.lock:
            running = self.processes.get(device_id)
            if running and running[0].poll() is None:
                return running[1]
            folder = self.folder(device_id)
            folder.mkdir(parents=True, exist_ok=True)
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            rotate_log(folder / 'engine.log')
            log = open(folder / 'engine.log', 'ab')
            env = dict(os.environ, AXIOM_DEVICE_ID=device_id, AXIOM_DEVICE_NAME=self.devices[device_id]['name'],
                       AXIOM_HUB_TOKEN=self.token)
            process = subprocess.Popen([self.python, str(self.server), '--root', str(folder), '--port', str(port)],
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log, env=env,
                                       creationflags=CREATE_NO_WINDOW)
            log.close()
            self.processes[device_id] = (process, port)
        deadline = time.monotonic() + self.ready_timeout
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError('This library\'s AXIOM engine stopped while starting; see its engine.log.')
            with socket.socket() as probe:
                probe.settimeout(0.5)
                if probe.connect_ex(('127.0.0.1', port)) == 0:
                    return port
            time.sleep(0.25)
        raise RuntimeError('This library\'s AXIOM engine did not start in time.')

    def stop_all(self):
        # A venv's python.exe / pythonw.exe is a small launcher that runs the real interpreter as its
        # child, so ending only the launcher would leave the library engine running: end the tree.
        with self.lock:
            for process, _ in self.processes.values():
                if process.poll() is None:
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW)
            for process, _ in self.processes.values():
                try:
                    process.wait(10)
                except subprocess.TimeoutExpired:
                    process.kill()
            self.processes.clear()


def setup_page(message=''):
    escape = lambda s: str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AXIOM library</title><style>
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f0a;color:#eef5e9;font:16px system-ui,sans-serif}}
main{{width:min(440px,calc(100% - 32px));background:#141b12;border:1px solid #2d3a26;border-radius:14px;padding:28px}}
h1{{margin:0 0 6px;font-size:22px;letter-spacing:.08em}}p{{color:#b9c6b0;line-height:1.45}}
input{{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #3c4b33;background:#0b0f0a;color:inherit;font-size:16px}}
button{{margin-top:12px;width:100%;padding:12px;border:0;border-radius:8px;background:#b7f34a;color:#0b0f0a;font-weight:700;font-size:15px;cursor:pointer}}
.error{{color:#ff9a7a}}
</style></head><body><main><h1>AXIOM</h1>
<p>Each laptop keeps its own AXIOM library on this PC. On the AXIOM PC, open Library &gt; Add music to see a pairing code. Enter it here and name this laptop's library (use the same name to open an existing library again), then upload its VirtualDJ, Serato or rekordbox database.</p>
{f'<p class="error">{escape(message)}</p>' if message else ''}
<form method="post" action="/__axiom/device"><input name="code" placeholder="Pairing code from the AXIOM PC" inputmode="numeric" maxlength="6" autocomplete="off" required autofocus><br><br><input name="name" placeholder="Library name, e.g. Mike's laptop" maxlength="60" required><button>Pair this laptop</button></form>
</main></body></html>'''.encode('utf-8')


class HubHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'  # one request per connection; bodies end when the connection closes
    registry = None

    def log_message(self, *args):
        pass

    expected_host = ''  # '<address>:<port>' the hub is reached by, lower case

    def _cookie_device(self):
        for part in (self.headers.get('Cookie') or '').split(';'):
            name, _, value = part.strip().partition('=')
            if name == COOKIE and value:
                return self.registry.device_for(value)
        return None

    def _send(self, status, body, content_type='application/json', headers=()):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _drain(self, limit=300 * 1024 * 1024):
        """Read an unanswered request body: closing a Windows socket with unread data resets the
        connection, and the browser would see a network error instead of AXIOM's answer."""
        remaining = min(self._length() or 0, limit)
        while remaining > 0:
            chunk = self.rfile.read(min(remaining, 1024 * 1024))
            if not chunk:
                break
            remaining -= len(chunk)

    def _length(self):
        """The Content-Length as a number, or None when it is not a plain non-negative integer."""
        value = (self.headers.get('Content-Length') or '0').strip()
        return int(value) if value.isascii() and value.isdigit() else None

    def _refuse(self, status, message):
        self._drain()
        self._send(status, json.dumps({'success': False, 'error': message}).encode('utf-8'))

    def _handle(self):
        if self._length() is None:  # the body cannot be read safely: answer and close
            self.close_connection = True
            return self._send(400, json.dumps({'success': False, 'error': 'That request is not valid.'}).encode('utf-8'))
        if (self.headers.get('Host') or '').lower() != self.expected_host:  # also stops DNS rebinding
            return self._refuse(403, 'Open AXIOM by the address shown on the AXIOM PC.')
        if not is_home_address(self.client_address[0]):
            return self._refuse(403, 'AXIOM only serves laptops on your home network.')
        if not plain_target(self.path):
            return self._refuse(400, 'That address is not valid.')
        hub_origin = f'http://{self.expected_host}'
        origin = self.headers.get('Origin')
        if origin and origin.rstrip('/').lower() != hub_origin:
            return self._refuse(403, 'Cross-site request refused.')
        if self.path.split('?', 1)[0] == '/__axiom/device' and self.command == 'POST':
            return self._choose_device()
        device = self._cookie_device()
        if device is None:
            if self.path.startswith('/api/'):
                return self._refuse(401, 'Open AXIOM in the browser and choose this laptop\'s library first.')
            self._drain()
            return self._send(200, setup_page(), 'text/html; charset=utf-8')
        if blocked(self.path):
            return self._refuse(403, 'This works only on the AXIOM PC itself. Your library here is unchanged.')
        try:
            port = self.registry.backend(device)
        except (RuntimeError, KeyError, OSError) as exc:
            self._drain()
            return self._send(503, setup_page(str(exc)), 'text/html; charset=utf-8')
        self._forward(port, origin, hub_origin)

    def _choose_device(self):
        length = self._length()
        if length > 64 * 1024:
            return self._refuse(413, 'That form is too large.')
        form = parse_qs(self.rfile.read(length).decode('utf-8', 'replace'))
        page = lambda status, message: self._send(status, setup_page(message), 'text/html; charset=utf-8')
        try:
            name = self.registry.clean_name((form.get('name') or [''])[0])  # before the code is spent
        except ValueError as exc:
            return page(400, str(exc))
        ok, reason = self.registry.pairing.check(self.client_address[0], (form.get('code') or [''])[0].strip())
        if not ok:
            return page(403, reason)
        _, token = self.registry.pair(name)
        cookie = f'{COOKIE}={token}; Path=/; Max-Age=315360000; HttpOnly; SameSite=Strict'
        self._send(303, b'', 'text/plain', headers=(('Location', '/'), ('Set-Cookie', cookie)))

    def _forward(self, port, origin, hub_origin):
        backend_origin = f'http://127.0.0.1:{port}'
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=900)
        try:
            connection.putrequest(self.command, self.path, skip_host=True, skip_accept_encoding=True)
            connection.putheader('Host', f'127.0.0.1:{port}')
            connection.putheader(TOKEN_HEADER, self.registry.token)
            for name, value in self.headers.items():
                lower = name.lower()
                if lower in HOP_HEADERS or lower == TOKEN_HEADER.lower():  # never pass a client's own copy
                    continue
                if lower == 'cookie':  # the engine's own cookies pass; the hub's library cookie does not
                    value = '; '.join(p.strip() for p in value.split(';') if p.strip() and not p.strip().startswith(COOKIE + '='))
                    if not value:
                        continue
                if lower in ('origin', 'referer'):
                    value = value.replace(hub_origin, backend_origin, 1)
                connection.putheader(name, value)
            length = self._length()
            if length:
                connection.putheader('Content-Length', str(length))
            connection.endheaders()
            remaining = length
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 1024 * 1024))
                if not chunk:
                    break
                connection.send(chunk)
                remaining -= len(chunk)
            response = connection.getresponse()
            self.send_response(response.status, response.reason)
            for name, value in response.getheaders():
                lower = name.lower()
                if lower in HOP_HEADERS and lower != 'content-length':
                    continue
                if lower == 'location':
                    value = value.replace(backend_origin, hub_origin, 1)
                self.send_header(name, value)
            self.end_headers()
            while self.command != 'HEAD':
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except (OSError, http.client.HTTPException):
            self.close_connection = True
        finally:
            connection.close()

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_HEAD = _handle


def create_info_blueprint():
    """/api/windows/remote/whoami: on a laptop's engine, its library name; on this PC, the hub address and libraries.
    /api/windows/remote/pairing: on this PC only, the code a laptop enters to pair."""
    from flask import Blueprint, jsonify, request
    bp = Blueprint('windows_remote_info', __name__)

    @bp.get('/api/windows/remote/whoami')
    def whoami():
        if os.environ.get('AXIOM_DEVICE_ID'):
            return jsonify(success=True, remote=True, name=os.environ.get('AXIOM_DEVICE_NAME', ''))
        registry = ACTIVE.get('registry')
        if registry:
            with registry.lock:
                names = sorted(d['name'] for d in registry.devices.values())
        else:
            names = []
        return jsonify(success=True, remote=False, hub_url=ACTIVE.get('url', ''), libraries=names)

    @bp.get('/api/windows/remote/pairing')
    def pairing():
        registry = ACTIVE.get('registry')
        if os.environ.get('AXIOM_DEVICE_ID') or registry is None or request.remote_addr not in ('127.0.0.1', '::1'):
            return jsonify(success=False, error='Laptop pairing is not available here.'), 404
        code, seconds = registry.pairing.current()
        return jsonify(success=True, code=code, expires_in=seconds, hub_url=ACTIVE.get('url', ''))
    return bp


def start_hub(root, port, address=None, registry=None, log=None):
    """(server, registry, url) serving laptops on the home network, or None when there is no home network.
    log(message) receives each new pairing code."""
    address = address or home_address()
    if not address:
        return None
    registry = registry or DeviceRegistry(root)
    handler = type('AxiomHub', (HubHandler,), {'registry': registry, 'expected_host': f'{address}:{port}'.lower()})
    server = ThreadingHTTPServer((address, port), handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, name='axiom-hub', daemon=True).start()
    url = f'http://{address}:{port}/'
    ACTIVE.update(registry=registry, url=url)
    registry.pairing.on_new = log
    registry.pairing.current()  # first code, logged
    return server, registry, url
