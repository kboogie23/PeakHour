"""Reconnect Music (windows_reconnect.py, static/js/shared/windows-reconnect.js).

Backend, in a sandbox (temp LOCALAPPDATA / USERPROFILE / AXIOM_RUNTIME_DIR) against AXIOM's real library code:
a library with songs pointing at a missing drive and a temp music tree where some names exist once (relinked),
some twice (ambiguous; one of them settled by file size), some not at all, one behind a junction (not followed),
one in the Recycle Bin folder (skipped) and one that is already a song in the library. start -> poll status -> done;
the counts, the changed fields, untouched songs, the backup (newest 3 kept), refusals (Health running, an import
running, a system folder, a bad folder, a second start), cancel, and a status route that reads no library.
Front end: the real app and headless Edge; clicking the Health button opens the new window (no prompt()),
choosing a folder and Start reconnect the songs and show the summary."""
import os, sys, json, time, socket, shutil, tempfile, pathlib, subprocess, threading, traceback, urllib.request, copy
root = pathlib.Path(__file__).resolve().parent
python = root / 'axiom-win-env' / 'Scripts' / 'python.exe'
EDGES = [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', r'C:\Program Files\Microsoft\Edge\Application\msedge.exe']
base = root / 'fixtures'
base.mkdir(exist_ok=True)


def make_media(sandbox):
    """The music tree and the library that points at the old (missing) locations."""
    music = sandbox / 'Music Now'
    for rel, size in (('A/one.mp3', 5), ('B/two.MP3', 6), ('C/dup.mp3', 7), ('D/dup.mp3', 8), ('C/sized.mp3', 11), ('D/sized.mp3', 22),
                      ('E/present.mp3', 9), ('$RECYCLE.BIN/ghost.mp3', 3), ('A/notes.txt', 2)):
        target = music / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(bytes(size))
    outside = sandbox / 'Elsewhere'
    outside.mkdir()
    (outside / 'viajunction.mp3').write_bytes(bytes(4))
    made = subprocess.run(['cmd', '/c', 'mklink', '/J', str(music / 'Link'), str(outside)], capture_output=True, text=True)
    assert made.returncode == 0, made.stderr
    other = sandbox / 'Other'
    other.mkdir()
    (other / 'keep.mp3').write_bytes(bytes(3))
    assert not os.path.exists('Q:\\'), 'the test needs drive Q: to be absent'

    def song(path, **extra):
        name = path.rsplit('\\', 1)[-1]
        return dict({'path': path, 'filename': name, 'folder': path.rsplit('\\', 2)[-2], 'title': name, 'artist': 'Artist', 'bpm': 120.0,
                     'camelot': '8A', 'cue_count': 3, 'needs_relink': True, 'source': 'virtualdj_database', 'connected_from': 'virtualdj'}, **extra)
    tracks = [song('Q:\\Old\\One\\one.mp3'), song('Q:\\Old\\two.mp3'), song('Q:\\x\\dup.mp3'), song('Q:\\x\\sized.mp3', file_size=22),
              song('Q:\\x\\ghost.mp3'), song('Q:\\x\\viajunction.mp3'), song('Q:\\x\\present.mp3'),
              song(str(music / 'E' / 'present.mp3'), needs_relink=False), song(str(other / 'keep.mp3'), needs_relink=False)]
    return music, other, {'tracks': tracks, 'total_tracks': len(tracks), 'folder_structure': {}}


def extra(sandbox, app, R, client, post, wait, job):
    import unicodedata
    BS = chr(92)
    FINE_OLD = 'Q:' + BS + 'a' + BS + 'fine.mp3'
    from contextlib import contextmanager
    music2 = sandbox / 'Music Two'
    music2.mkdir()
    cafe = unicodedata.normalize('NFC', 'Caf'+chr(0xe9)+' Del Mar.mp3')
    for name in (cafe, 'solo.mp3', 'fine.mp3', 'late.mp3'):
        (music2 / name).write_bytes(bytes(5))
    nfd = unicodedata.normalize('NFD', 'Caf'+chr(0xe9)+' Del Mar.mp3')
    assert nfd != cafe

    def row(path, **kw):
        return dict({'path': path, 'filename': path.rsplit(BS, 1)[-1], 'folder': 'x', 'title': 't', 'bpm': 99.0, 'needs_relink': True}, **kw)
    rows = [row('Q:'+BS+'m'+BS+nfd), row('Q:'+BS+'a'+BS+'solo.mp3'), row('Q:'+BS+'b'+BS+'solo.mp3'), row(FINE_OLD), row(str(music2 / 'late.mp3'), needs_relink=False)]
    text2 = json.dumps({'tracks': rows, 'total_tracks': len(rows), 'folder_structure': {}})
    cache = pathlib.Path(app.CACHE_PATH)
    cache.write_text(text2, encoding='utf-8')
    # NFD names match NFC files; two missing songs naming one file are both left alone
    assert post('start', folder=str(music2))[0] == 200
    status = wait(('done', 'failed'))
    assert (status['missing'], status['relinked'], status['ambiguous'], status['not_found']) == (4, 2, 2, 0), status
    saved = json.loads(cache.read_text(encoding='utf-8'))['tracks']
    assert saved[0]['path'] == str(music2 / cafe) and saved[0]['filename'] == cafe, saved[0]  # the real name on disk
    assert saved[3]['path'] == str(music2 / 'fine.mp3')
    assert saved[1] == rows[1] and saved[2] == rows[2] and saved[4] == rows[4]
    # a save by another writer between the first read and the re-read survives, and the locks wrap re-read + write
    cache.write_text(text2, encoding='utf-8')
    events, real_load, real_lock, real_write = [], app.load_cache, app.file_lock, app.safe_write_json
    loads = []

    def load(*a, **k):
        loads.append(1)
        if len(loads) == 2:  # the re-read inside commit: another writer saved just before it
            data = real_load(*a, **k)
            data['tracks'].append(row(str(music2 / 'solo.mp3'), title='added meanwhile', needs_relink=False))
            real_write(app.CACHE_PATH, data, make_backup=False)
        events.append('load%d' % len(loads))
        return real_load(*a, **k)

    @contextmanager
    def lock(path, *a, **k):
        events.append('+' + os.path.basename(path))
        with real_lock(path, *a, **k) as handle:
            yield handle
        events.append('-' + os.path.basename(path))
    app.load_cache = load
    app.file_lock = lock
    app.safe_write_json = lambda *a, **k: events.append('write') or real_write(*a, **k)
    try:
        assert post('start', folder=str(music2))[0] == 200
        status = wait(('done', 'failed'))
    finally:
        app.load_cache, app.file_lock, app.safe_write_json = real_load, real_lock, real_write
    assert status['state'] == 'done' and status['relinked'] == 2, status
    assert any(t.get('title') == 'added meanwhile' for t in json.loads(cache.read_text(encoding='utf-8'))['tracks'])  # not lost
    inside = events[events.index('+library_cache.json.edit'):events.index('-library_cache.json.edit')]
    assert 'load2' in inside and 'write' in inside and inside.index('load2') < inside.index('write'), events
    assert '+library_cache.json' in inside and '-library_cache.json' in inside and inside.index('-library_cache.json') < inside.index('write'), events  # backup copy under the cache lock, released before the write
    # at save time: a song whose old file came back, whose new file vanished, or whose new path is another row's is skipped
    cache.write_text(text2, encoding='utf-8')
    before = cache.read_bytes()
    here = str(music2 / 'late.mp3')
    for moves in ({here: str(music2 / 'fine.mp3')}, {FINE_OLD: str(music2 / 'vanished.mp3')}, {FINE_OLD: here}):
        assert job.commit(moves) == 0 and cache.read_bytes() == before, moves
    assert job.commit({FINE_OLD: str(music2 / 'fine.mp3')}) == 1
    # a drive root: a substituted drive letter whose root is the music folder
    letter = next((c for c in 'XYZWVU' if not os.path.exists(c + ':' + BS)), None)
    made = subprocess.run(['subst', letter + ':', str(music2)], capture_output=True, text=True) if letter else None
    if made is not None and made.returncode == 0:
        try:
            cache.write_text(text2, encoding='utf-8')
            assert R.folder_problem(app, letter + ':' + BS) is None
            assert post('start', folder=letter + ':' + BS)[0] == 200
            status = wait(('done', 'failed'))
            assert status['state'] == 'done' and status['relinked'] == 2 and status['folder'] == letter + ':' + BS, status
            assert json.loads(cache.read_text(encoding='utf-8'))['tracks'][3]['path'] == letter + ':' + BS + 'fine.mp3'
            print('drive-root run on', letter + ':' + BS, 'ok')
        finally:
            subprocess.run(['subst', letter + ':', '/d'], capture_output=True)
    else:
        print('SKIPPED drive-root run: subst unavailable')


def backend(sandbox):
    local = sandbox / 'AppData' / 'Local'
    (sandbox / 'AppData' / 'Roaming').mkdir(parents=True)
    local.mkdir(parents=True)
    runtime = local / 'AXIOM DJ'
    os.environ.update(LOCALAPPDATA=str(local), APPDATA=str(sandbox / 'AppData' / 'Roaming'), USERPROFILE=str(sandbox),
                      AXIOM_RUNTIME_DIR=str(runtime), AXIOM_LICENSE_REQUIRED='0')
    os.environ.pop('AXIOM_DEVICE_ID', None)
    sys.path.insert(0, str(root / 'axiom-win-probe'))
    os.chdir(root / 'axiom-win-probe')
    import app, windows_reconnect as R
    from windows_paths import is_safe_location
    app.is_safe_location = is_safe_location
    music, other, library = make_media(sandbox)
    chosen = {'value': (str(music), False)}
    job = R.install(app, chooser=lambda prompt: chosen['value'])
    client = app.app.test_client()
    text = json.dumps(library)

    def write_library():
        pathlib.Path(app.CACHE_PATH).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(app.CACHE_PATH).write_text(text, encoding='utf-8')

    def post(route, **data):
        response = client.post('/api/windows/library/reconnect/' + route, json=data)
        return response.status_code, response.get_json()

    def wait(states, seconds=60):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            status = client.get('/api/windows/library/reconnect/status').get_json()
            if status['state'] in states:
                return status
            time.sleep(0.05)
        raise AssertionError('timed out in state ' + status['state'])

    # choose: the folder, or cancelled
    assert post('choose') == (200, {'success': True, 'folder': str(music)})
    chosen['value'] = ('', True)
    assert post('choose')[1] == {'success': True, 'cancelled': True}
    chosen['value'] = (str(music), False)
    assert client.get('/api/windows/library/reconnect/status').get_json()['state'] == 'idle'

    # refusals
    write_library()
    for bad in ('', None, 5, str(sandbox / 'nope'), str(music / 'A' / 'one.mp3'), '\\\\server\\share', 'relative\\folder',
                os.environ['SystemRoot'], os.path.join(os.environ['SystemRoot'], 'System32'), os.environ['ProgramFiles'], os.environ['LOCALAPPDATA']):
        code, body = post('start', folder=bad)
        assert code == 400 and body['success'] is False and body['error'], (bad, code, body)
    app.UNIFIED_HEALTH_JOB['status'] = 'running'
    code, body = post('start', folder=str(music))
    assert code in (400, 409) and 'Health' in body['error'], body
    app.UNIFIED_HEALTH_JOB['status'] = 'idle'
    with app.ADD_FOLDER_JOBS_LOCK:
        app.ADD_FOLDER_JOBS['job1'] = {'status': 'running'}
    code, body = post('start', folder=str(music))
    assert code in (400, 409) and 'added' in body['error'], body
    with app.ADD_FOLDER_JOBS_LOCK:
        app.ADD_FOLDER_JOBS['job1'] = {'status': 'complete'}
    os.environ['AXIOM_DEVICE_ID'] = 'laptop'
    assert post('start', folder=str(music))[0] == 400 and post('choose')[0] == 403
    os.environ.pop('AXIOM_DEVICE_ID')
    assert pathlib.Path(app.CACHE_PATH).read_text(encoding='utf-8') == text and client.get('/api/windows/library/reconnect/status').get_json()['state'] == 'idle'

    # cancel (and a second start while one runs); the library file is not touched
    release, started = threading.Event(), threading.Event()
    real_index = R.index_folder

    def slow_index(folder, extensions, skip, cancelled, progress):
        started.set()
        while not release.is_set() and not cancelled():
            time.sleep(0.02)
        return real_index(folder, extensions, skip, cancelled, progress)
    R.index_folder = slow_index
    assert post('start', folder=str(music))[0] == 200 and started.wait(10)
    code, body = post('start', folder=str(music))
    assert code == 409 and 'already' in body['error'], body
    assert post('cancel')[1]['state'] == 'indexing'
    release.set()
    status = wait(('cancelled', 'done', 'failed'))
    assert status['state'] == 'cancelled' and 'not changed' in status['message'] and status['relinked'] == 0, status
    R.index_folder = real_index
    assert pathlib.Path(app.CACHE_PATH).read_text(encoding='utf-8') == text
    assert not list(pathlib.Path(app.CACHE_PATH).parent.glob('library_cache.reconnect_backup.*'))

    # a failure is reported and changes nothing
    real_load = app.load_cache
    app.load_cache = lambda *a, **k: (_ for _ in ()).throw(OSError('disk gone'))
    assert post('start', folder=str(music))[0] == 200
    status = wait(('failed', 'done'))
    assert status['state'] == 'failed' and 'not changed' in status['error'], status
    app.load_cache = real_load
    assert pathlib.Path(app.CACHE_PATH).read_text(encoding='utf-8') == text

    # the real run: status reads no library while it runs
    loads = []
    app.load_cache = lambda *a, **k: loads.append(1) or real_load(*a, **k)
    assert post('start', folder=str(music))[0] == 200
    seen = set()
    end = time.monotonic() + 60
    while time.monotonic() < end:
        before = len(loads)
        status = client.get('/api/windows/library/reconnect/status').get_json()
        assert len(loads) == before
        seen.add(status['state'])
        if status['state'] in ('done', 'failed'):
            break
        time.sleep(0.01)
    app.load_cache = real_load
    assert status['state'] == 'done', status
    assert status['folder'] == str(music) and status['files_indexed'] == 7, status  # one, two, 2x dup, 2x sized, present
    assert (status['missing'], status['relinked'], status['ambiguous'], status['not_found'], status['in_library']) == (7, 3, 1, 2, 1), status
    assert status['message'].startswith('Reconnected 3 songs. 1 could not be matched (same name in several places).'), status['message']
    assert '2 are not in this folder.' in status['message']
    new = json.loads(pathlib.Path(app.CACHE_PATH).read_text(encoding='utf-8'))
    old = json.loads(text)
    t = new['tracks']
    for index, (name, folder_name, file) in {0: ('one.mp3', 'A', music / 'A' / 'one.mp3'), 1: ('two.MP3', 'B', music / 'B' / 'two.MP3'),
                                             3: ('sized.mp3', 'D', music / 'D' / 'sized.mp3')}.items():
        assert t[index]['path'] == str(file) and t[index]['filename'] == name and t[index]['folder'] == folder_name and t[index]['needs_relink'] is False, t[index]
        before = {k: v for k, v in old['tracks'][index].items() if k not in ('path', 'filename', 'folder', 'needs_relink')}
        assert {k: v for k, v in t[index].items() if k not in ('path', 'filename', 'folder', 'needs_relink')} == before  # BPM, key, cues... kept
    for index in (2, 4, 5, 6, 7, 8):
        assert t[index] == old['tracks'][index], index  # ambiguous, not found, junction, in library, present: unchanged
    assert {k: v for k, v in new.items() if k != 'tracks'} == {k: v for k, v in old.items() if k != 'tracks'}
    backups = sorted(pathlib.Path(app.CACHE_PATH).parent.glob('library_cache.reconnect_backup.*.json'))
    assert len(backups) == 1 and backups[0].read_text(encoding='utf-8') == text, backups
    assert 'done' in seen
    # a second run finds nothing missing that it can fix: the relinked songs exist now
    assert post('start', folder=str(music))[0] == 200
    again = wait(('done', 'failed'))
    assert again['relinked'] == 0 and again['missing'] == 4 and again['in_library'] == 1 and again['ambiguous'] == 1 and again['not_found'] == 2, again
    assert len(list(pathlib.Path(app.CACHE_PATH).parent.glob('library_cache.reconnect_backup.*.json'))) == 1  # nothing to write: no new backup
    # backups: newest 3 kept; other files that look alike are left alone
    folder_data = pathlib.Path(app.CACHE_PATH).parent
    for name in ('library_cache.reset_backup.x.json', 'library_cache.json.bak.x', 'library_cache.relink_backup.x.json'):
        (folder_data / name).write_text('keep', encoding='utf-8')
    for _ in range(4):
        write_library()
        time.sleep(1.1)
        assert post('start', folder=str(music))[0] == 200
        assert wait(('done', 'failed'))['relinked'] == 3
    kept = sorted(pathlib.Path(app.CACHE_PATH).parent.glob('library_cache.reconnect_backup.*.json'))
    assert len(kept) == 3 and all(k.read_text(encoding='utf-8') == text for k in kept), kept
    assert all((folder_data / n).read_text(encoding='utf-8') == 'keep' for n in ('library_cache.reset_backup.x.json', 'library_cache.json.bak.x', 'library_cache.relink_backup.x.json'))
    extra(sandbox, app, R, client, post, wait, job)
    # a whole drive is accepted by the policy (not searched here)
    assert R.folder_problem(app, os.path.splitdrive(str(music))[0] + '\\') is None
    assert R.folder_problem(app, str(music)) is None and R.folder_problem(app, os.environ['SystemRoot'])
    # a Health job that starts while the work is under way stops the save
    write_library()
    started.clear(); release.clear()
    R.index_folder = slow_index
    assert post('start', folder=str(music))[0] == 200 and started.wait(10)
    app.UNIFIED_HEALTH_JOB['status'] = 'running'
    release.set()
    status = wait(('failed', 'done'))
    app.UNIFIED_HEALTH_JOB['status'] = 'idle'
    R.index_folder = real_index
    assert status['state'] == 'failed' and 'Health' in status['error'] and pathlib.Path(app.CACHE_PATH).read_text(encoding='utf-8') == text, status
    import windows_remote_hub as H
    assert H.blocked('/api/windows/library/reconnect/start') and H.blocked('/api/windows/library/reconnect/status')  # laptop engines
    for mount in list(music.glob('Link')):
        os.rmdir(mount)  # the junction itself, never its target
    assert (sandbox / 'Elsewhere' / 'viajunction.mp3').is_file()
    print('PASS backend: relinks by file name (3 of 7), ambiguous/not found/junction/Recycle Bin/in-library untouched, backups kept to 3, refusals, cancel, failure')


SERVER = '''
import os,sys,pathlib
root=pathlib.Path(sys.argv[1]);port=int(sys.argv[2]);music=sys.argv[3]
sys.path.insert(0,str(root/'axiom-win-probe'))
import axiom_windows_launcher as L
L.log_server_errors()
axiom=L.build_app(port)
axiom.WINDOWS_RECONNECT.chooser=lambda prompt:(music,False)
from werkzeug.serving import make_server
print('ready',port,flush=True)
make_server(L.HOST,port,axiom.app,threaded=True).serve_forever()
'''
CDP = r'''
const [debug,url,out]=process.argv.slice(2);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fs=await import('node:fs');
let tab;for(let i=0;i<50&&!tab;i++){try{tab=(await (await fetch(`http://127.0.0.1:${debug}/json`)).json()).find(t=>t.type==='page');}catch(e){}if(!tab)await sleep(200);}
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const wait=new Map();let loaded=null;
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id);}if(m.method==='Page.loadEventFired'&&loaded)loaded();};
const send=(method,params={})=>new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)return {error:JSON.stringify(r.result.exceptionDetails).slice(0,300)};return r.result.result.value;};
const until=async(expr,seconds)=>{const end=Date.now()+seconds*1000;while(Date.now()<end){if(await ev(expr)===true)return true;await sleep(300);}return false;};
const result={};
await send('Page.enable');await send('Runtime.enable');
const done=new Promise(r=>loaded=r);await send('Page.navigate',{url});await done;await sleep(3500);
result.replaced=await ev("typeof relocateLibrary==='function'&&relocateLibrary===window.AxiomWindowsReconnect.open&&!String(relocateLibrary).includes('prompt(')");
await ev("window.__prompts=0;window.prompt=()=>{window.__prompts++;return null};");
// the Health button with a zero missing-file count still opens the new window
await ev("window.healthApprovedCurrentTaskKey=()=>'missing_file';");
await ev("runHealthApprovedSelectedAction()");
result.opened=await until("document.querySelector('dialog.axiom-reconnect')?.open===true",5);
result.title=await ev("document.querySelector('dialog.axiom-reconnect h2')?.textContent");
result.intro=await ev("document.querySelector('dialog.axiom-reconnect').innerText");
await ev("[...document.querySelectorAll('dialog.axiom-reconnect button')].find(b=>b.textContent==='Choose folder or drive').click()");
result.chosen=await until("document.querySelector('.axiom-reconnect-chosen strong')?.textContent.length>0",8);
result.chosenPath=await ev("document.querySelector('.axiom-reconnect-chosen strong').textContent");
await ev("[...document.querySelectorAll('dialog.axiom-reconnect button')].find(b=>b.textContent==='Start').click()");
result.finished=await until("document.querySelector('.axiom-reconnect-result')?.hidden===false&&document.querySelector('.axiom-reconnect-result').textContent.startsWith('Reconnected')",30);
result.summary=await ev("document.querySelector('.axiom-reconnect-result').textContent");
result.prompts=await ev("window.__prompts");
result.status=await ev("fetch('/api/windows/library/reconnect/status').then(r=>r.json())");
await ev("[...document.querySelectorAll('dialog.axiom-reconnect button')].find(b=>b.textContent==='Close').click()");
result.closed=await ev("document.querySelector('dialog.axiom-reconnect').open===false");
// the other button goes there too, and the original handler is still used for other tasks
await ev("window.healthApprovedCurrentTaskKey=()=>'missing_bpm';window.__orig=0;");
result.otherTaskOpens=await ev("(()=>{try{runHealthApprovedSelectedAction()}catch(e){};return document.querySelector('dialog.axiom-reconnect').open})()");
await ev("relocateLibrary()");
result.openedAgain=await until("document.querySelector('dialog.axiom-reconnect')?.open===true",5);
fs.writeFileSync(out,JSON.stringify(result));
ws.close();process.exit(0);
'''


def frontend(sandbox):
    edge = next((e for e in EDGES if os.path.isfile(e)), None)
    assert edge, 'Edge not installed'
    local = sandbox / 'AppData' / 'Local'
    local.mkdir(parents=True)
    (sandbox / 'profile').mkdir()
    music, other, library = make_media(sandbox)
    data = local / 'AXIOM DJ' / 'data'
    data.mkdir(parents=True)
    (data / 'library_cache.json').write_text(json.dumps(library), encoding='utf-8')
    (sandbox / 'server.py').write_text(SERVER, encoding='utf-8')
    (sandbox / 'cdp.mjs').write_text(CDP, encoding='utf-8')
    with socket.socket() as a, socket.socket() as b:
        a.bind(('127.0.0.1', 0)); b.bind(('127.0.0.1', 0))
        port, debug = a.getsockname()[1], b.getsockname()[1]
    env = dict(os.environ, LOCALAPPDATA=str(local), USERPROFILE=str(sandbox), AXIOM_RUNTIME_DIR=str(local / 'AXIOM DJ'), AXIOM_NO_OPEN='1')
    env.pop('AXIOM_HUB', None); env.pop('AXIOM_DEVICE_ID', None)
    procs = []
    try:
        server = subprocess.Popen([str(python), str(sandbox / 'server.py'), str(root), str(port), str(music)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        procs.append(server)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=3) as r:
                    html = r.read().decode('utf-8', 'replace')
                    if r.status == 200:
                        break
            except OSError:
                time.sleep(0.4)
        else:
            raise AssertionError('server did not start')
        assert 'windows-reconnect.js?v=1' in html and html.index('windows-reconnect.js') > html.index('health-repairs.js') > 0 and html.index('windows-reconnect.js') > html.index('health-maintenance.js')
        browser = subprocess.Popen([edge, '--headless=new', f'--remote-debugging-port={debug}', f'--user-data-dir={sandbox / "profile"}', '--no-first-run',
                                    '--no-default-browser-check', '--window-size=1400,900', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        procs.append(browser)
        out = sandbox / 'result.json'
        node = subprocess.run(['node', str(sandbox / 'cdp.mjs'), str(debug), f'http://127.0.0.1:{port}/', str(out)], capture_output=True, text=True, timeout=150)
        assert out.is_file(), ('node failed', node.stdout[-800:], node.stderr[-800:])
        r = json.loads(out.read_text(encoding='utf-8'))
        print(json.dumps(r, indent=1))
        assert r['replaced'] is True and r['opened'] and r['title'] == 'Reconnect Music', r
        assert 'folder or drive where your music is now' in r['intro'] and 'PEAK HOUR' in r['intro'] and '/Volumes' not in r['intro'], r['intro']
        assert r['chosen'] and r['chosenPath'] == str(music), r
        assert r['finished'] and r['summary'].startswith('Reconnected 3 songs. 1 could not be matched (same name in several places).'), r
        assert r['prompts'] == 0 and r['closed'] is True and r['openedAgain'] and r['otherTaskOpens'] is False, r  # other tasks keep AXIOM's own handler
        saved = json.loads((data / 'library_cache.json').read_text(encoding='utf-8'))['tracks']
        assert [t['path'] for t in saved[:2]] == [str(music / 'A' / 'one.mp3'), str(music / 'B' / 'two.MP3')]
        assert list(data.glob('library_cache.reconnect_backup.*.json'))
        subprocess.run(['cmd', '/c', 'rmdir', str(music / 'Link')], capture_output=True)  # the junction, not its target
        print('PASS front end: Reconnect Music opens its own window (no prompt), chooses, starts and shows the summary')
    finally:
        for p in reversed(procs):
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(p.pid)], capture_output=True)
        for p in procs:
            try:
                p.wait(15)
            except Exception:
                p.kill()


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    sandbox = pathlib.Path(tempfile.mkdtemp(dir=base, prefix='reconnect-'))
    try:
        if which in ('all', 'backend'):
            sub = sandbox / 'backend'
            sub.mkdir()
            backend(sub)
        if which in ('all', 'frontend'):
            sub = sandbox / 'frontend'
            sub.mkdir()
            frontend(sub)
    finally:
        os.chdir(root)
        for junction in sandbox.rglob('Link'):
            subprocess.run(['cmd', '/c', 'rmdir', str(junction)], capture_output=True)
        shutil.rmtree(sandbox, ignore_errors=True)


try:
    main()
except BaseException:
    traceback.print_exc()
    sys.exit(1)
