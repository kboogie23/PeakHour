"""AXIOM for other laptops on the home network: one separate library per laptop.

The AXIOM PC keeps serving its own library on 127.0.0.1. This hub listens on
the PC's home-network address (same port) and gives every laptop its own AXIOM
engine: a separate backend process (windows_device_server.py) with its own
AXIOM_RUNTIME_DIR under %LOCALAPPDATA%\\AXIOM DJ\\devices\\<id>, so each
library, its playlists, sets, settings and Health data stay apart. A laptop
names its library on first visit; a cookie brings it back to that library.
A laptop loads its own songs by uploading its DJ database (VirtualDJ
database.xml, Serato database V2 or rekordbox XML; windows_remote_library).

Safety (the owner chose home Wi-Fi without a PIN):
- only private home-network and loopback addresses are served;
- requests that would act on this PC are refused for laptops: native file
  dialogs, reading or writing this PC's Serato / djay / VirtualDJ, exports and
  recordings saved to this PC, reopening apps, folder scans of this PC, and
  streaming or previewing this PC's music files;
- a request whose Origin is not the hub itself is refused (cross-site).
"""
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
ALLOWED = ('/api/library/connect_dj_source', '/api/windows/remote/whoami')
BLOCKED = re.compile(r'choose|serato|djay|virtualdj|/export|export_|publish|recording|reveal|open_|dj_transfer|'
                     r'beatgrid_doctor|/stems|/plugins|mix-export|refresh_audio|coreaudio|add_folder|rescan|'
                     r'^/api/library/scan|ban_folder|/api/windows/|/api/library/stream|/api/video|waveform', re.I)


def is_home_address(address):
    try:
        ip = ipaddress.ip_address(address.split('%')[0])
    except ValueError:
        return False
    return ip.is_loopback or (ip.is_private and not ip.is_multicast) or ip.is_link_local


def blocked(path):
    route = path.split('?', 1)[0]
    if route.startswith(ALLOWED) or not route.startswith('/api/'):
        return False
    return bool(BLOCKED.search(route))


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
        try:
            self.devices = json.loads(self.path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            self.devices = {}

    def save(self):
        self.root.mkdir(parents=True, exist_ok=True)
        stage = self.path.with_name('devices.json.tmp')
        stage.write_text(json.dumps(self.devices, indent=1), encoding='utf-8')
        os.replace(stage, self.path)

    def create(self, name):
        name = re.sub(r'[\x00-\x1f<>]', '', str(name or '')).strip()[:60]
        if not name:
            raise ValueError('Give this library a name, for example "DJ Mike laptop".')
        with self.lock:
            if any(d['name'].casefold() == name.casefold() for d in self.devices.values()):
                raise ValueError('A library with this name already exists. Choose it from the list instead.')
            device_id = secrets.token_hex(8)
            self.devices[device_id] = {'name': name, 'created': time.time()}
            self.save()
        return device_id

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
            log = open(folder / 'engine.log', 'ab')
            env = dict(os.environ, AXIOM_DEVICE_ID=device_id, AXIOM_DEVICE_NAME=self.devices[device_id]['name'])
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


def setup_page(registry, message=''):
    escape = lambda s: str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
    choices = ''.join(f'<button name="device" value="{escape(i)}">{escape(d["name"])}</button>'
                      for i, d in sorted(registry.devices.items(), key=lambda kv: kv[1]['name'].casefold()))
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AXIOM library</title><style>
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f0a;color:#eef5e9;font:16px system-ui,sans-serif}}
main{{width:min(440px,calc(100% - 32px));background:#141b12;border:1px solid #2d3a26;border-radius:14px;padding:28px}}
h1{{margin:0 0 6px;font-size:22px;letter-spacing:.08em}}p{{color:#b9c6b0;line-height:1.45}}
input{{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #3c4b33;background:#0b0f0a;color:inherit;font-size:16px}}
button{{margin-top:12px;width:100%;padding:12px;border:0;border-radius:8px;background:#b7f34a;color:#0b0f0a;font-weight:700;font-size:15px;cursor:pointer}}
.list button{{background:#22301c;color:#eef5e9;text-align:left}}.error{{color:#ff9a7a}}
</style></head><body><main><h1>AXIOM</h1>
<p>Each laptop keeps its own AXIOM library on this PC. Name this laptop's library to start, then upload its VirtualDJ, Serato or rekordbox database.</p>
{f'<p class="error">{escape(message)}</p>' if message else ''}
<form method="post" action="/__axiom/device"><input name="name" placeholder="Library name, e.g. Mike's laptop" maxlength="60" required autofocus><button>Create my library</button></form>
{f'<p>Or open an existing library:</p><form method="post" action="/__axiom/device" class="list">{choices}</form>' if choices else ''}
</main></body></html>'''.encode('utf-8')


class HubHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'  # one request per connection; bodies end when the connection closes
    registry = None

    def log_message(self, *args):
        pass

    def _cookie_device(self):
        for part in (self.headers.get('Cookie') or '').split(';'):
            name, _, value = part.strip().partition('=')
            if name == COOKIE and value in self.registry.devices:
                return value
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
        remaining = min(int(self.headers.get('Content-Length') or 0), limit)
        while remaining > 0:
            chunk = self.rfile.read(min(remaining, 1024 * 1024))
            if not chunk:
                break
            remaining -= len(chunk)

    def _refuse(self, status, message):
        self._drain()
        self._send(status, json.dumps({'success': False, 'error': message}).encode('utf-8'))

    def _handle(self):
        if not is_home_address(self.client_address[0]):
            return self._refuse(403, 'AXIOM only serves laptops on your home network.')
        hub_origin = f'http://{self.headers.get("Host", "")}'
        origin = self.headers.get('Origin')
        if origin and origin.rstrip('/') != hub_origin:
            return self._refuse(403, 'Cross-site request refused.')
        if self.path.split('?', 1)[0] == '/__axiom/device' and self.command == 'POST':
            return self._choose_device()
        device = self._cookie_device()
        if device is None:
            if self.path.startswith('/api/'):
                return self._refuse(401, 'Open AXIOM in the browser and choose this laptop\'s library first.')
            self._drain()
            return self._send(200, setup_page(self.registry), 'text/html; charset=utf-8')
        if blocked(self.path):
            return self._refuse(403, 'This works only on the AXIOM PC itself. Your library here is unchanged.')
        try:
            port = self.registry.backend(device)
        except (RuntimeError, KeyError, OSError) as exc:
            self._drain()
            return self._send(503, setup_page(self.registry, str(exc)), 'text/html; charset=utf-8')
        self._forward(port, origin, hub_origin)

    def _choose_device(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length > 64 * 1024:
            return self._refuse(413, 'That form is too large.')
        form = parse_qs(self.rfile.read(length).decode('utf-8', 'replace'))
        try:
            device = (form.get('device') or [''])[0]
            if device not in self.registry.devices:
                device = self.registry.create((form.get('name') or [''])[0])
        except ValueError as exc:
            return self._send(400, setup_page(self.registry, str(exc)), 'text/html; charset=utf-8')
        cookie = f'{COOKIE}={device}; Path=/; Max-Age=315360000; HttpOnly; SameSite=Lax'
        self._send(303, b'', 'text/plain', headers=(('Location', '/'), ('Set-Cookie', cookie)))

    def _forward(self, port, origin, hub_origin):
        backend_origin = f'http://127.0.0.1:{port}'
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=900)
        try:
            connection.putrequest(self.command, self.path, skip_host=True, skip_accept_encoding=True)
            connection.putheader('Host', f'127.0.0.1:{port}')
            for name, value in self.headers.items():
                lower = name.lower()
                if lower in HOP_HEADERS:
                    continue
                if lower == 'cookie':  # the engine's own cookies pass; the hub's library cookie does not
                    value = '; '.join(p.strip() for p in value.split(';') if p.strip() and not p.strip().startswith(COOKIE + '='))
                    if not value:
                        continue
                if lower in ('origin', 'referer'):
                    value = value.replace(hub_origin, backend_origin, 1)
                connection.putheader(name, value)
            length = int(self.headers.get('Content-Length') or 0)
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
    """/api/windows/remote/whoami: on a laptop's engine, its library name; on this PC, the hub address and libraries."""
    from flask import Blueprint, jsonify
    bp = Blueprint('windows_remote_info', __name__)

    @bp.get('/api/windows/remote/whoami')
    def whoami():
        if os.environ.get('AXIOM_DEVICE_ID'):
            return jsonify(success=True, remote=True, name=os.environ.get('AXIOM_DEVICE_NAME', ''))
        root = Path(os.environ.get('AXIOM_RUNTIME_DIR') or '.')
        try:
            url = json.loads((root / 'hub.json').read_text(encoding='utf-8')).get('url', '')
        except (OSError, ValueError):
            url = ''
        try:
            names = sorted(d['name'] for d in json.loads((root / 'devices.json').read_text(encoding='utf-8')).values())
        except (OSError, ValueError, KeyError, AttributeError):
            names = []
        return jsonify(success=True, remote=False, hub_url=url, libraries=names)
    return bp


def start_hub(root, port, address=None, registry=None):
    """(server, registry, url) serving laptops on the home network, or None when there is no home network."""
    address = address or home_address()
    if not address:
        return None
    registry = registry or DeviceRegistry(root)
    handler = type('AxiomHub', (HubHandler,), {'registry': registry})
    server = ThreadingHTTPServer((address, port), handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, name='axiom-hub', daemon=True).start()
    url = f'http://{address}:{port}/'
    (Path(root) / 'hub.json').write_text(json.dumps({'url': url}), encoding='utf-8')
    return server, registry, url
