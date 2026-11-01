"""AXIOM for other laptops: the hub gives each laptop its own library engine, refuses actions on this PC,
checks origins, forwards bodies intact; a real laptop engine loads an uploaded VirtualDJ database into that
laptop's library only. The hub listens on 127.0.0.1 here (no network port, no firewall prompt)."""
import os, sys, pathlib, json, uuid, time, hashlib, http.client, urllib.parse, socket, traceback
root = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(root / 'axiom-win-probe'))
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

    def free():
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); return s.getsockname()[1]

    def request(port, method, path, body=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=120)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse(); data = r.read(); c.close()
        return r.status, dict(r.getheaders()), data

    # 1. Routing with a stand-in engine
    folder = root / 'fixtures' / 'hub' / uuid.uuid4().hex; folder.mkdir(parents=True)
    registry = H.DeviceRegistry(folder, python=sys.executable, server=root / 'fixtures' / 'hub_echo_backend.py')
    port = free(); server, registry, url = H.start_hub(folder, port, address='127.0.0.1', registry=registry)
    base = {'Host': f'127.0.0.1:{port}'}
    status, _, page = request(port, 'GET', '/', headers=base)
    assert status == 200 and b'Create my library' in page
    assert request(port, 'GET', '/api/favorites', headers=base)[0] == 401  # no library chosen yet
    status, hdr, _ = request(port, 'POST', '/__axiom/device', urllib.parse.urlencode({'name': "Mike's laptop"}),
                             dict(base, **{'Content-Type': 'application/x-www-form-urlencoded'}))
    assert status == 303 and hdr['Location'] == '/' and 'axiom_device=' in hdr['Set-Cookie'] and 'HttpOnly' in hdr['Set-Cookie']
    mike = hdr['Set-Cookie'].split(';')[0]
    assert request(port, 'POST', '/__axiom/device', urllib.parse.urlencode({'name': "MIKE'S LAPTOP"}),
                   dict(base, **{'Content-Type': 'application/x-www-form-urlencoded'}))[0] == 400  # duplicate name
    status, hdr, data = request(port, 'GET', '/api/favorites?x=1', headers=dict(base, Cookie=mike + '; session=abc'))
    echo = json.loads(data)
    assert status == 200 and echo['path'] == '/api/favorites?x=1' and echo['host'].startswith('127.0.0.1:') and echo['host'] != f'127.0.0.1:{port}'
    assert echo['cookie'] == 'session=abc' and 'engine=1' in hdr.get('Set-Cookie', '')  # hub cookie hidden; engine cookies pass
    body = os.urandom(5 * 1024 * 1024)
    status, _, data = request(port, 'POST', '/api/library/connect_dj_source', body,
                              dict(base, Cookie=mike, Origin=f'http://127.0.0.1:{port}', **{'Content-Type': 'application/octet-stream'}))
    echo = json.loads(data)
    assert status == 200 and echo['length'] == len(body) and echo['sha256'] == hashlib.sha256(body).hexdigest()
    assert echo['origin'] == 'http://' + echo['host']  # Origin rewritten to the engine's own
    assert request(port, 'POST', '/api/favorites', b'{}', dict(base, Cookie=mike, Origin='http://evil.example'))[0] == 403
    status, _, data = request(port, 'POST', '/api/windows/virtualdj/lists', b'{}', dict(base, Cookie=mike))
    assert status == 403 and b'only on the AXIOM PC' in data
    for _ in range(5):  # a refused large upload still gets AXIOM's answer, not a reset connection
        status, _, data = request(port, 'POST', '/api/library/rescan', body, dict(base, Cookie=mike))
        assert status == 403 and json.loads(data)['success'] is False
        status, _, data = request(port, 'POST', '/api/favorites', body, dict(base, Origin='http://evil.example'))
        assert status == 403
    status, hdr, _ = request(port, 'POST', '/__axiom/device', urllib.parse.urlencode({'name': 'Sara'}),
                             dict(base, **{'Content-Type': 'application/x-www-form-urlencoded'}))
    sara = hdr['Set-Cookie'].split(';')[0]
    r1 = json.loads(request(port, 'GET', '/api/x', headers=dict(base, Cookie=mike))[2])
    r2 = json.loads(request(port, 'GET', '/api/x', headers=dict(base, Cookie=sara))[2])
    assert r1['host'] != r2['host'] and r1['root'] != r2['root'] and pathlib.Path(r1['root']).parent == folder / 'devices'
    registry.stop_all(); server.shutdown()
    assert json.loads((folder / 'devices.json').read_text(encoding='utf-8')) and json.loads((folder / 'hub.json').read_text())['url'] == url

    # 2. A real laptop engine (AXIOM itself) loads an uploaded VirtualDJ database into its own library
    real = root / 'fixtures' / 'hub' / ('real-' + uuid.uuid4().hex[:6]); real.mkdir(parents=True)
    os.environ['AXIOM_LICENSE_REQUIRED'] = '0'
    registry = H.DeviceRegistry(real, python=str(root / 'axiom-win-env' / 'Scripts' / 'python.exe'))
    port = free(); server, registry, _ = H.start_hub(real, port, address='127.0.0.1', registry=registry)
    base = {'Host': f'127.0.0.1:{port}'}
    cookies = []
    for name in ('Laptop A', 'Laptop B'):
        hdr = request(port, 'POST', '/__axiom/device', urllib.parse.urlencode({'name': name}),
                      dict(base, **{'Content-Type': 'application/x-www-form-urlencoded'}))[1]
        cookies.append(hdr['Set-Cookie'].split(';')[0])
    t0 = time.time()
    status, _, page = request(port, 'GET', '/', headers=dict(base, Cookie=cookies[0]))
    assert status == 200 and b'<html' in page.lower(), page[:200]
    who = json.loads(request(port, 'GET', '/api/windows/remote/whoami', headers=dict(base, Cookie=cookies[0]))[2])
    assert who == {'success': True, 'remote': True, 'name': 'Laptop A'}, who
    database = (root / 'fixtures' / 'vdj-copy' / 'home' / 'database.xml').read_bytes()
    boundary = 'axiomboundary' + uuid.uuid4().hex
    form = (f'--{boundary}\r\nContent-Disposition: form-data; name="source"\r\n\r\nvirtualdj\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="database.xml"\r\nContent-Type: text/xml\r\n\r\n').encode() + database + f'\r\n--{boundary}--\r\n'.encode()
    status, _, data = request(port, 'POST', '/api/library/connect_dj_source', form,
                              dict(base, Cookie=cookies[0], Origin=f'http://127.0.0.1:{port}', **{'Content-Type': f'multipart/form-data; boundary={boundary}'}))
    result = json.loads(data)
    assert status == 200 and result['success'] and result['scanned_count'] > 400 and result['total_tracks'] == result['added_count'] > 200, (status, result)
    ids = {d['name']: i for i, d in registry.devices.items()}
    lib_a = json.loads((real / 'devices' / ids['Laptop A'] / 'data' / 'library_cache.json').read_text(encoding='utf-8'))
    assert len(lib_a['tracks']) == result['total_tracks'] and all(t.get('connected_from') == 'virtualdj' for t in lib_a['tracks'])
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
    print(f"PASS: hub routes each laptop to its own engine, blocks PC-side actions, checks origins, forwards 5 MB intact; "
          f"a real laptop engine loaded {result['added_count']} VirtualDJ songs into its own library only ({time.time() - t0:.0f}s)")
except BaseException:
    traceback.print_exc(); sys.exit(1)
