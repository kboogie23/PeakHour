"""AXIOM for other laptops: the hub needs a pairing code, gives each laptop its own library engine, refuses actions on
this PC (also when the path is disguised), checks Host and Origin, forwards bodies intact; a real laptop engine answers
only the hub, has no access to this PC's files and loads an uploaded VirtualDJ database into that laptop's library only.
The hub listens on 127.0.0.1 here (no network port, no firewall prompt); everything runs in a sandbox folder."""
import os, sys, pathlib, json, uuid, time, hashlib, http.client, urllib.parse, socket, traceback
root = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(root / 'axiom-win-probe'))
ECHO = '''
import argparse, hashlib, json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
parser = argparse.ArgumentParser(); parser.add_argument('--root'); parser.add_argument('--port', type=int); args = parser.parse_args()
class Echo(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def handle_any(self):
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        data = json.dumps({'path': self.path, 'host': self.headers.get('Host'), 'cookie': self.headers.get('Cookie'),
                           'origin': self.headers.get('Origin'), 'length': len(body), 'sha256': hashlib.sha256(body).hexdigest(),
                           'root': args.root, 'token': self.headers.get('X-Axiom-Hub-Token')}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data)))
        self.send_header('Set-Cookie', 'engine=1'); self.end_headers(); self.wfile.write(data)
    do_GET = do_POST = handle_any
ThreadingHTTPServer(('127.0.0.1', args.port), Echo).serve_forever()
'''
try:
    import windows_remote_hub as H
    assert H.is_home_address('192.168.1.20') and H.is_home_address('10.0.0.5') and H.is_home_address('127.0.0.1')
    assert not H.is_home_address('8.8.8.8') and not H.is_home_address('not an ip')
    for path in ('/api/library/choose_folder', '/api/windows/virtualdj/lists', '/api/library/export_year_fixes_serato',
                 '/api/performance/recording/start', '/api/library/rescan', '/api/library/stream?path=C:/x.mp3',
                 '/api/studio-daw/stems', '/api/cues/publish/apply', '/api/library/add_folder'):
        assert H.blocked(path), path
    for path in ('/', '/static/js/app.js', '/api/library/connect_dj_source', '/api/windows/remote/whoami',
                 '/api/library/era_audit?mode=smart', '/api/favorites', '/api/playlists'):
        assert not H.blocked(path), path
    for path in ('/api/library/fix_track', '/api/library/batch_fix_track', '/api/library/unified_health/status', '/api/library/health/audio_sources'):
        assert H.blocked(path), path
    for path in ('/api/library/track', '/api/library/update_year', '/api/library/search', '/api/library/health'):
        assert not H.blocked(path), path
    for path in ('/api/audio/play', '/api/audio/stop', '/api/audio/volume', '/api/audio/seek', '/api/audio/status', '/api/library/artwork?path=C:/x.mp3',
                 '/api/studio-daw/import', '/api/studio-daw/project/unbundle', '/api/studio-daw/project/bundle/x', '/api/studio-daw/stretch/k/audio',
                 '/api/intelligence/import', '/api/app/lite_migration/import', '/api/library/import_release_years_csv',
                 '/api/studio/upload_csv_path', '/api/library/dupes/trash', '/api/library/dupes/software'):
        assert H.blocked(path), path
    routes = json.loads((root / 'bytecode_inventory' / 'registered_routes.json').read_text(encoding='utf-8'))
    assert all(H.blocked(r) for r, _ in routes if r.startswith(('/api/audio/', '/api/studio-daw/', '/api/intelligence/')) and r != '/api/intelligence/export' or r in ('/api/library/artwork', '/api/studio/upload_csv_path'))
    assert not H.blocked('/api/library/playlist/parse') and not H.blocked('/api/favorites')  # text/cache only
    assert H.blocked('/api/windows/remote/pairing') and H.blocked('/api/library/connect_dj_source/export')  # exact match only
    for target in ('/', '/api/favorites?x=1', '/api/library/stream?path=C://x.mp3&y=%41', '/static/js/a-b.js'):
        assert H.plain_target(target), target
    for target in ('/api/%77indows/x', '/api/library/%73tream', '//api/windows/x', 'http://x/api/favorites', 'api/x', '*', '',
                   '/api//windows/x', '/api/library/../windows/x', '/api/./x', '/api\\windows', '/a b', '/a\r\nb', '/%2e%2e/x'):
        assert not H.plain_target(target), target

    # Pairing code: six digits, one use, expires, limited guesses
    codes = []
    pairing = H.Pairing(ttl=600, attempts=3, on_new=codes.append)
    code, left = pairing.current()
    assert len(code) == 6 and code.isdigit() and 590 < left <= 600 and len(codes) == 1 and code in codes[0]
    assert pairing.check('10.0.0.2', '000000' if code != '000000' else '111111')[0] is False
    assert pairing.check('10.0.0.2', code) == (True, '') and pairing.code != code
    assert not pairing.check('10.0.0.2', code)[0]  # the spent code is dead
    code2 = pairing.code
    assert len(codes) == 2 and pairing.check('10.0.0.3', code2)[0] and pairing.code != code2  # single use, then renewed
    for _ in range(3):
        pairing.check('10.0.0.4', 'abcdef')
    assert not pairing.check('10.0.0.4', pairing.code)[0]  # guesses used up for that address
    assert pairing.check('10.0.0.5', pairing.code)[0]  # others are not affected
    pairing.expires = time.monotonic() - 1
    assert not pairing.check('10.0.0.6', pairing.code)[0]  # expired
    assert pairing.current()[1] > 590
    old_code, n = pairing.code, len(codes)
    pairing.expires = time.monotonic() - 1
    assert 'expired' in pairing.check('10.0.0.7', old_code)[1]  # not a wrong guess: it makes and logs a new code
    assert len(codes) == n + 1 and pairing.code != old_code and pairing.failures.get('10.0.0.7') is None
    assert pairing.check('10.0.0.7', pairing.code)[0]
    # the engine guard runs before the core's own hooks
    from flask import Flask
    probe = Flask('probe'); probe.before_request(lambda: None); H.install_device_guard(probe, 'secret')
    assert probe.before_request_funcs[None][0].__name__ == 'hub_only'

    def free():
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); return s.getsockname()[1]

    def request(port, method, path, body=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=120)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse(); data = r.read(); c.close()
        return r.status, dict(r.getheaders()), data

    FORM = {'Content-Type': 'application/x-www-form-urlencoded'}

    def pair(port, registry, name, code=None, base=None, **extra):
        form = {'name': name, 'code': registry.pairing.current()[0] if code is None else code}
        form.update(extra)
        return request(port, 'POST', '/__axiom/device', urllib.parse.urlencode(form), dict(base, **FORM))

    # 1. Routing with a stand-in engine
    folder = root / 'fixtures' / 'hub' / uuid.uuid4().hex; folder.mkdir(parents=True)
    echo = folder / 'hub_echo_backend.py'; echo.write_text(ECHO, encoding='utf-8')
    registry = H.DeviceRegistry(folder, python=sys.executable, server=echo)
    logged = []
    port = free(); server, registry, url = H.start_hub(folder, port, address='127.0.0.1', registry=registry, log=logged.append)
    assert logged and registry.pairing.code in logged[0]  # the code is written to the launch log
    base = {'Host': f'127.0.0.1:{port}'}
    status, _, page = request(port, 'GET', '/', headers=base)
    assert status == 200 and b'Pair this laptop' in page and b'Create my library' not in page
    assert request(port, 'GET', '/api/favorites', headers=base)[0] == 401  # not paired yet
    # Host must be the hub's own address (DNS rebinding)
    for host in ('evil.example', f'evil.example:{port}', '127.0.0.1', f'127.0.0.1:{port + 1}', f'localhost:{port}', ''):
        assert request(port, 'GET', '/', headers={'Host': host})[0] == 403, host
    assert request(port, 'GET', '/', headers={'Host': f'127.0.0.1:{port}'.upper()})[0] == 200  # case-insensitive
    # Pairing needs the code, once
    assert pair(port, registry, "Mike's laptop", code='', base=base)[0] == 403
    assert pair(port, registry, "Mike's laptop", code='123', base=base)[0] == 403
    assert pair(port, registry, '', base=base)[0] == 400 and registry.devices == {}  # no name: the code is not spent
    first_code = registry.pairing.code
    status, hdr, page = pair(port, registry, "Mike's laptop", base=base)
    assert status == 303 and hdr['Location'] == '/' and registry.pairing.code != first_code
    cookie_header = hdr['Set-Cookie']
    for flag in ('axiom_device=', 'HttpOnly', 'SameSite=Strict', 'Path=/'):
        assert flag in cookie_header, cookie_header
    mike = cookie_header.split(';')[0]
    (device_id, device), = registry.devices.items()
    token = mike.split('=', 1)[1]
    assert device_id not in cookie_header and len(token) >= 40 and token != device_id
    stored = (folder / 'devices.json').read_text(encoding='utf-8')
    assert token not in stored and hashlib.sha256(token.encode()).hexdigest() in stored  # only the hash is kept
    assert pair(port, registry, 'Other', code=first_code, base=base)[0] == 403  # the used code is dead
    page = request(port, 'GET', '/', headers=base)[2]
    assert device_id.encode() not in page and token.encode() not in page  # nothing leaked in HTML
    assert request(port, 'GET', '/api/favorites', headers=dict(base, Cookie=f'axiom_device={device_id}'))[0] == 401  # the ID is not a key
    assert request(port, 'GET', '/api/favorites', headers=dict(base, Cookie='axiom_device=' + 'A' * 43))[0] == 401
    # the same name with a fresh code is the same library, new session
    status, hdr, _ = pair(port, registry, "MIKE'S LAPTOP", base=base)
    assert status == 303 and len(registry.devices) == 1 and len(registry.devices[device_id]['sessions']) == 2
    assert hdr['Set-Cookie'].split(';')[0] != mike
    # a wrong code is refused and limited
    for _ in range(5):
        assert pair(port, registry, 'Sneaky', code='999999' if registry.pairing.code != '999999' else '888888', base=base)[0] == 403
    status, _, page = pair(port, registry, 'Sneaky', base=base)  # even the right code, after too many wrong ones
    assert status == 403 and b'Too many' in page and len(registry.devices) == 1
    registry.pairing.failures.clear()
    # disguised and non-plain targets are refused before anything else
    for target in ('/api/%77indows/virtualdj/lists', '/api/library/%73tream?path=C:/x.mp3', '//api/windows/virtualdj/lists',
                   'http://x/api/windows/virtualdj/lists', 'http://127.0.0.1/api/favorites', '/api/library/../windows/x',
                   '/api//library/rescan', '/%61pi/favorites', '/static/%2e%2e/x'):
        want = (400, 403) if target.startswith('//') else (400,)  # Python's own server folds a leading // first: then the block list applies
        assert request(port, 'GET', target, headers=dict(base, Cookie=mike))[0] in want, target
        assert request(port, 'POST', target, b'{}', dict(base, Cookie=mike))[0] in want, target
    for target in ('/api/audio/play', '/api/library/artwork?path=C:/x.mp3', '/api/studio-daw/import', '/api/intelligence/import'):
        assert request(port, 'POST', target, b'{}', dict(base, Cookie=mike, Origin=f'http://127.0.0.1:{port}'))[0] == 403, target
    for length in ('-1', 'abc', '1e3', '+5', ' '):  # a bad Content-Length is refused, never read to the end of the stream
        with socket.create_connection(('127.0.0.1', port), timeout=10) as raw:
            raw.sendall(f'POST /__axiom/device HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nContent-Length: {length}\r\n\r\ncode=1'.encode())
            answer = b''
            while chunk := raw.recv(4096):
                answer += chunk
        assert answer.startswith(b'HTTP/1.0 400') or answer.startswith(b'HTTP/1.1 400'), (length, answer[:40])
    status, hdr, data = request(port, 'GET', '/api/favorites?x=1', headers=dict(base, Cookie=mike + '; session=abc'))
    echo = json.loads(data)
    assert status == 200 and echo['path'] == '/api/favorites?x=1' and echo['host'].startswith('127.0.0.1:') and echo['host'] != f'127.0.0.1:{port}'
    assert echo['cookie'] == 'session=abc' and 'engine=1' in hdr.get('Set-Cookie', '')  # hub cookie hidden; engine cookies pass
    assert echo['token'] == registry.token and len(registry.token) == 64  # the engine gets this run's secret ...
    echo = json.loads(request(port, 'GET', '/api/x', headers=dict(base, Cookie=mike, **{'X-Axiom-Hub-Token': 'guess'}))[2])
    assert echo['token'] == registry.token  # ... and a client's own copy is dropped
    body = os.urandom(5 * 1024 * 1024)
    status, _, data = request(port, 'POST', '/api/library/connect_dj_source', body,
                              dict(base, Cookie=mike, Origin=f'http://127.0.0.1:{port}', **{'Content-Type': 'application/octet-stream'}))
    echo = json.loads(data)
    assert status == 200 and echo['length'] == len(body) and echo['sha256'] == hashlib.sha256(body).hexdigest()
    assert echo['origin'] == 'http://' + echo['host']  # Origin rewritten to the engine's own
    for origin in ('http://evil.example', f'http://127.0.0.1:{port + 1}', f'http://localhost:{port}', 'null', f'https://127.0.0.1:{port}'):
        assert request(port, 'POST', '/api/favorites', b'{}', dict(base, Cookie=mike, Origin=origin))[0] == 403, origin
    assert request(port, 'POST', '/api/favorites', b'{}', dict(base, Cookie=mike, Origin=f'http://127.0.0.1:{port}/'))[0] == 200
    status, _, data = request(port, 'POST', '/api/windows/virtualdj/lists', b'{}', dict(base, Cookie=mike))
    assert status == 403 and b'only on the AXIOM PC' in data
    assert request(port, 'GET', '/api/windows/remote/pairing', headers=dict(base, Cookie=mike))[0] == 403  # not for laptops
    for _ in range(5):  # a refused large upload still gets AXIOM's answer, not a reset connection
        status, _, data = request(port, 'POST', '/api/library/rescan', body, dict(base, Cookie=mike))
        assert status == 403 and json.loads(data)['success'] is False
        status, _, data = request(port, 'POST', '/api/favorites', body, dict(base, Origin='http://evil.example'))
        assert status == 403
    status, hdr, _ = pair(port, registry, 'Sara', base=base)
    sara = hdr['Set-Cookie'].split(';')[0]
    r1 = json.loads(request(port, 'GET', '/api/x', headers=dict(base, Cookie=mike))[2])
    r2 = json.loads(request(port, 'GET', '/api/x', headers=dict(base, Cookie=sara))[2])
    assert r1['host'] != r2['host'] and r1['root'] != r2['root'] and pathlib.Path(r1['root']).parent == folder / 'devices'
    registry.stop_all(); server.shutdown()
    assert json.loads((folder / 'devices.json').read_text(encoding='utf-8')) and not (folder / 'hub.json').exists()

    # 2. A real laptop engine (AXIOM itself) answers only the hub, and loads an uploaded VirtualDJ database into its own library
    real = root / 'fixtures' / 'hub' / ('real-' + uuid.uuid4().hex[:6]); real.mkdir(parents=True)
    os.environ['AXIOM_LICENSE_REQUIRED'] = '0'
    registry = H.DeviceRegistry(real, python=str(root / 'axiom-win-env' / 'Scripts' / 'python.exe'))
    port = free(); server, registry, _ = H.start_hub(real, port, address='127.0.0.1', registry=registry)
    base = {'Host': f'127.0.0.1:{port}'}
    cookies = [pair(port, registry, name, base=base)[1]['Set-Cookie'].split(';')[0] for name in ('Laptop A', 'Laptop B')]
    t0 = time.time()
    status, _, page = request(port, 'GET', '/', headers=dict(base, Cookie=cookies[0]))
    assert status == 200 and b'<html' in page.lower(), page[:200]
    who = json.loads(request(port, 'GET', '/api/windows/remote/whoami', headers=dict(base, Cookie=cookies[0]))[2])
    assert who == {'success': True, 'remote': True, 'name': 'Laptop A'}, who
    # the engine itself: no secret header, no answer; with it, the hub's refusals still apply to the decoded path
    engine = registry.processes[next(i for i, d in registry.devices.items() if d['name'] == 'Laptop A')][1]
    ehost = {'Host': f'127.0.0.1:{engine}'}
    secret = {'X-Axiom-Hub-Token': registry.token}
    assert request(engine, 'GET', '/', headers=ehost)[0] == 403
    assert request(engine, 'GET', '/api/windows/remote/whoami', headers=ehost)[0] == 403
    assert request(engine, 'GET', '/api/windows/remote/whoami', headers=dict(ehost, **{'X-Axiom-Hub-Token': 'x' * 64}))[0] == 403
    assert request(engine, 'GET', '/api/windows/remote/whoami', headers=dict(ehost, **secret))[0] == 200
    assert request(engine, 'GET', '/api/windows/remote/pairing', headers=dict(ehost, **secret))[0] == 403
    for method, target in (('POST', '/api/audio/play'), ('POST', '/api/audio/stop'), ('GET', '/api/library/artwork?path=C:/x.mp3'),
                           ('POST', '/api/studio-daw/import'), ('POST', '/api/studio/upload_csv_path'), ('POST', '/api/library/dupes/trash')):
        assert request(engine, method, target, b'{}' if method == 'POST' else None, dict(ehost, Origin=f'http://127.0.0.1:{engine}', **secret))[0] == 403, target
    for target in ('/api/windows/virtualdj/lists', '/api/%77indows/virtualdj/lists', '//api/windows/virtualdj/lists',
                   '/api/library/%73tream?path=C:/x.mp3', '/api/library/stream?path=C:/x.mp3', '/api/library/choose_folder'):
        assert request(engine, 'GET', target, headers=dict(ehost, **secret))[0] == 403, target
    pc_file = real / 'pc-secret.mp3'; pc_file.write_bytes(b'ID3 not a laptop file')  # a real file on this PC that the database names
    database = ('<?xml version="1.0" encoding="UTF-8"?>\n<VirtualDJ_Database Version="2023">'
                + ''.join(f'<Song FilePath="C:\\Users\\Laptop\\Music\\Song {n}.mp3" FileSize="1"><Tags Author="Band" Title="Song {n}" Genre="Funk" Year="1983"/>'
                          f'<Infos SongLength="201.0"/><Scan Bpm="0.5" Key="F#m"/><Poi Pos="1.0" Type="cue" Num="1"/></Song>' for n in range(12))
                + f'<Song FilePath="{pc_file}" FileSize="1"><Tags Author="Band" Title="Planted"/><Scan Bpm="0.5" Key="F#m"/></Song>'
                + '</VirtualDJ_Database>').encode('utf-8')
    boundary = 'axiomboundary' + uuid.uuid4().hex
    form = (f'--{boundary}\r\nContent-Disposition: form-data; name="source"\r\n\r\nvirtualdj\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="database.xml"\r\nContent-Type: text/xml\r\n\r\n').encode() + database + f'\r\n--{boundary}--\r\n'.encode()
    status, _, data = request(port, 'POST', '/api/library/connect_dj_source', form,
                              dict(base, Cookie=cookies[0], Origin=f'http://127.0.0.1:{port}', **{'Content-Type': f'multipart/form-data; boundary={boundary}'}))
    result = json.loads(data)
    assert status == 200 and result['success'] and result['scanned_count'] == 13 and result['total_tracks'] == result['added_count'] == 13, (status, result)
    ids = {d['name']: i for i, d in registry.devices.items()}
    lib_a = json.loads((real / 'devices' / ids['Laptop A'] / 'data' / 'library_cache.json').read_text(encoding='utf-8'))
    assert len(lib_a['tracks']) == result['total_tracks'] and all(t.get('connected_from') == 'virtualdj' for t in lib_a['tracks'])
    planted = [t for t in lib_a['tracks'] if t.get('title') == 'Planted'][0]
    assert planted['path'] == 'laptop:' + str(pc_file) and planted['needs_relink'] is True  # stored where no PC file can be named
    assert all(t['path'].startswith('laptop:') and t['needs_relink'] is True for t in lib_a['tracks'])
    assert not os.path.exists(planted['path']) and not os.path.isfile(planted['path'])
    query = urllib.parse.quote(str(pc_file), safe='')
    for target in (f'/api/library/track?path={query}', f'/api/library/track?path={urllib.parse.quote(planted["path"], safe="")}'):
        answer = request(engine, 'GET', target, headers=dict(ehost, **secret))[2]
        assert b'"size"' not in answer and b'ID3' not in answer
    for target in ('/api/library/fix_track', '/api/library/batch_fix_track', '/api/library/unified_health/start'):
        body = json.dumps({'path': str(pc_file), 'paths': [str(pc_file)]}).encode()
        assert request(engine, 'POST', target, body, dict(ehost, Origin=f'http://127.0.0.1:{engine}', **secret))[0] == 403, target
        assert request(port, 'POST', target, body, dict(base, Cookie=cookies[0], Origin=f'http://127.0.0.1:{port}'))[0] == 403, target
    assert request(port, 'GET', '/api/library/health/audio_sources', headers=dict(base, Cookie=cookies[0]))[0] == 403
    request(port, 'GET', '/', headers=dict(base, Cookie=cookies[1]))  # start Laptop B's engine
    cache_b = real / 'devices' / ids['Laptop B'] / 'data' / 'library_cache.json'
    tracks_b = json.loads(cache_b.read_text(encoding='utf-8')).get('tracks', []) if cache_b.exists() else []
    assert tracks_b == [], len(tracks_b)  # Laptop B's library is separate and empty
    engine_ports = [port for _, port in registry.processes.values()]
    registry.stop_all(); server.shutdown()
    time.sleep(1)
    for engine_port in engine_ports:  # the real interpreters behind the venv launcher are gone too
        with socket.socket() as probe:
            probe.settimeout(0.5)
            assert probe.connect_ex(('127.0.0.1', engine_port)) != 0, f'engine on {engine_port} still running'

    # 3. A laptop's engine is built with deny-all file policies (in this process, in a sandbox)
    sandbox = root / 'fixtures' / 'hub' / ('device-' + uuid.uuid4().hex[:6]); (sandbox / 'local').mkdir(parents=True)
    for key, value in (('LOCALAPPDATA', sandbox / 'local'), ('USERPROFILE', sandbox), ('AXIOM_RUNTIME_DIR', sandbox / 'local' / 'rt')):
        os.environ[key] = str(value)
    import axiom_windows_launcher as L
    L.data_root = lambda: sandbox / 'local' / 'rt'
    music = sandbox / 'song.mp3'; music.write_bytes(b'x')
    import windows_paths
    assert windows_paths.is_safe_location(music)  # this file would be allowed for the PC itself
    axiom = L.build_app(free(), device=True)
    assert not axiom.is_safe_location(music) and not axiom.WINDOWS_VIDEO_STORE.allowed_path(music)
    try:
        axiom.NATIVE_AUDIO_DECK.play(str(music)); raise AssertionError('a laptop engine played audio')
    except PermissionError:
        pass
    import utils.path_ops
    assert not utils.path_ops.is_safe_location(music)
    names = [rule.endpoint for rule in axiom.app.url_map.iter_rules() if 'virtualdj' in rule.rule]
    assert names, 'VirtualDJ routes are registered (their policy is deny-all)'
    print(f"PASS: pairing code is one-time and limited; Host, Origin and disguised paths refused; sessions are hashed random tokens; "
          f"engine answers only the hub and has no file access; a real laptop engine loaded {result['added_count']} VirtualDJ songs "
          f"into its own library only ({time.time() - t0:.0f}s)")
except BaseException:
    traceback.print_exc(); sys.exit(1)
