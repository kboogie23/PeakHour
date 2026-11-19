"""Window data snapshot (Studio drafts in IndexedDB + settings in localStorage, saved through the app itself), in a real
(headless) Edge against the real app and its real server routes.

Checks: real Studio drafts (clips, automation, pan) plus synthetic records of every value type and a 50 MB blob are exported;
the manifest on disk (counts, per-record SHA-256 and size, total bytes) is verified against the files; the Worker SHA-256 equals
Web Crypto at the block boundaries; a second browser with a fresh empty profile (same server, then a server on another port =
another origin) imports it, the drafts appear in the app's own "Open saved" list and open with the same clips, automation points
and mixer pan, blobs are byte-identical, localStorage keys match and nothing existing is overwritten; a profile that is not
empty refuses; an upload cut in the middle leaves the previous complete snapshot usable; a damaged record file is found by the
verify route and by the import (one message, no loop); path traversal and cross-origin POSTs are refused; an unchanged export
uploads nothing and a changed record uploads only itself; nothing is exported while the Studio plays; the automatic export runs
by itself after start and after a draft save; and the main-thread cost of an export is measured with 200 MB of blobs.

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\\Users\\gatli\\Documents\\PeakHour; & .\\axiom-win-env\\Scripts\\python.exe test_windows_window_snapshot.py"
Everything runs in a temp folder (PH_SNAPSHOT_SCRATCH if set) on free ports with throw-away browser profiles; nothing of the owner's
(port 8080, %LOCALAPPDATA%\\AXIOM DJ) is touched."""
import base64
import errno
import hashlib
import io
import json
import math
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

workspace = Path(__file__).resolve().parent
sys.path.insert(0, str(workspace))
sys.path.insert(0, str(workspace / 'axiom-win-probe'))
from feature_check import browser as fb
import windows_window_snapshot as ws

SERVER = r'''
import sys, pathlib
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'data'
backend = L.build_app(port)
from werkzeug.serving import make_server
make_server('127.0.0.1', port, backend.app, threaded=True).serve_forever()
'''

SCRATCH = os.environ.get('PH_SNAPSHOT_SCRATCH')
FAST = {'start': 1500, 'debounce': 1500, 'retry': 1000, 'poll': 2000, 'failed': 3000}
OWN = 'peakhour.windowSnapshot.'

ok, why = fb.available()
if not ok:
    print('SKIPPED page check: ' + why)
    sys.exit(0)


def free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


if SCRATCH:
    Path(SCRATCH).mkdir(parents=True, exist_ok=True)
base = Path(tempfile.mkdtemp(prefix='phsnap', dir=SCRATCH or None))
(base / 'local').mkdir()
(base / 'home').mkdir()
servers, browsers, failures = [], [], []


def server_env(root):
    return {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'), 'AXIOM_RUNTIME_DIR': str(root), 'AXIOM_LICENSE_REQUIRED': '0'}


def start(port, root):
    root = Path(root)
    (root / 'data').mkdir(parents=True, exist_ok=True)
    env = server_env(root / 'data')
    process = subprocess.Popen([sys.executable, '-c', SERVER, str(root), str(port), str(workspace / 'axiom-win-probe')],
                               env=env, cwd=str(workspace), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    servers.append(process)
    url = f'http://127.0.0.1:{port}'
    for _ in range(240):
        try:
            urllib.request.urlopen(url + '/api/library/stats', timeout=2).read()
            return url
        except OSError:
            time.sleep(0.5)
    raise AssertionError('the app did not start')


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)
    return cond


def new_browser(name, url, **kwargs):
    b = fb.Browser(sandbox=base / name, base_url=url, extra_args=['--autoplay-policy=no-user-gesture-required'], **kwargs)
    browsers.append(b)
    return b


def until(function, seconds, every=1.0):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            last = function()
            if last:
                return last
        except fb.BrowserError:
            pass
        time.sleep(every)
    return last


def tone(path, seconds=6, sr=22050, hz=330):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b''.join(struct.pack('<hh', *(int(8000 * math.sin(2 * math.pi * hz * i / sr)),) * 2) for i in range(seconds * sr)))


def sha_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def request(url, path, method='GET', body=None, headers=None, origin=True, raw=False):
    """HTTP to the snapshot routes the way the page does (same Origin) unless told otherwise."""
    h = dict(headers or {})
    if origin is True and method == 'POST':
        h['Origin'] = url
    elif origin and origin is not True:
        h['Origin'] = origin
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    if isinstance(body, dict):
        h.setdefault('Content-Type', 'application/json')
    req = urllib.request.Request(url + '/api/windows/window-snapshot/' + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload = r.read()
            return r.status, (payload if raw else json.loads(payload or b'{}'))
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload)
        except ValueError:
            return e.code, payload


def LP(path):
    """Extended-length path: the sandbox sits deep in the scratch folder, and the snapshot files go past 260 characters."""
    return ws.long_path(path)


def snapshot_folders(root):
    folder = LP(Path(root) / 'data' / 'window-data-snapshot')
    return sorted(p for p in folder.glob('snap-*') if p.is_dir()), sorted(p for p in folder.glob('building-*') if p.is_dir())


# ---------------------------------------------------------------- page snippets
SYNTHETIC = r'''
(async () => {
  const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('ph-test-db', 3);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('plain', {keyPath: 'id'});
      const a = d.createObjectStore('auto', {keyPath: 'n', autoIncrement: true});
      a.createIndex('by_name', 'name', {unique: false});
      a.createIndex('by_tags', 'tags', {multiEntry: true, unique: false});
      a.createIndex('by_code', 'code', {unique: true});
      d.createObjectStore('loose');
      d.createObjectStore('big');
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const put = (store, value, key) => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key);
    tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error);
  });
  const buf = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer;
  await put('plain', {id: 'types', u: undefined, n: null, nan: NaN, neg0: -0, inf: Infinity, ninf: -Infinity, big: 12345678901234567890n,
    d: new Date(1700000000123), badDate: new Date(NaN), m: new Map([[1, {a: 1}], ['x', [1, 2]]]), s: new Set([1, 'two', null]),
    re: /ab+c/gi, nested: {a: [1, {b: [2, {c: undefined}]}], $: 'dollar'}, str: 'ünï€𝄞 \u0000 end', emptyArr: [], f: false, zero: 0,
    ab: new Uint8Array([1, 2, 3, 250]).buffer, u8: new Uint8Array(buf, 2, 5), f64: new Float64Array([1.5, -2.25, NaN]),
    i16: new Int16Array([-1, 2, 300]), dv: new DataView(buf, 1, 4), bi64: new BigInt64Array([-5n, 7n])});
  await put('plain', {id: 7, blob: new Blob(['hello blob'], {type: 'text/plain'}), file: new File(['file data'], 'a.txt', {type: 'text/plain', lastModified: 1600000000000}),
    emptyBlob: new Blob([], {type: ''})});
  await put('auto', {name: 'x', tags: ['a', 'b'], code: 1});
  await put('auto', {name: 'y', tags: ['b'], code: 2});
  await put('loose', {kind: 'string key'}, 'k1');
  await put('loose', {kind: 'number key'}, 42.5);
  await put('loose', {kind: 'date key'}, new Date(1700000000000));
  await put('loose', {kind: 'array key'}, ['a', 1, new Date(5)]);
  await put('loose', {kind: 'binary key'}, new Uint8Array([9, 8, 7]));
  await put('loose', 'plain string value', 'k2');
  await put('loose', null, 'k3');
  const parts = []; let s = 123456789;
  for (let c = 0; c < 50; c++) { const a = new Uint32Array(262144); for (let i = 0; i < a.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; a[i] = s >>> 0; } parts.push(a); }
  const blob = new Blob(parts, {type: 'application/octet-stream'});
  await put('big', {blob, tag: 'fifty'}, 'fifty');
  db.close();
  localStorage.setItem('peakhour.test.alpha', '1');
  localStorage.setItem('axiomStudioWorkingSet.v1', JSON.stringify({tracks: ['a', 'b'], n: 3}));
  localStorage.setItem('peakhour.test.unicode', '日本語 🎛️ \u0000x');
  return blob.size;
})()
'''

DUMP = r'''
(async () => {
  const P = PeakHourWindowSnapshot, out = {};
  const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  for (const info of await P.listDatabases()) {
    const db = await new Promise((res, rej) => { const r = indexedDB.open(info.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    for (const name of Array.from(db.objectStoreNames)) {
      const keys = await wrap(db.transaction(name).objectStore(name).getAllKeys());
      for (const k of keys) {
        const v = await wrap(db.transaction(name).objectStore(name).get(k));
        const f = P.recordFile(info.name, name, k, v);
        out[JSON.stringify([info.name, name, f.key])] = await P.sha256(f.blob);
      }
    }
    db.close();
  }
  return out;
})()
'''

DRAFTS = r'''
(async () => {
  const out = [];
  for (const text of await AxiomDraftStorage.list()) {
    const r = JSON.parse(text), p = r.saved;
    if (!p) continue;
    out.push({title: p.title, clips: p.arrangementClips.length, points: p.automationLanes.reduce((n, l) => n + l.points.length, 0),
              pan: Object.fromEntries(Object.entries(p.rowMixer || {}).filter(([, m]) => m.pan !== undefined).map(([k, m]) => [k, m.pan]))});
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
})()
'''

ACTIVE = r'''(()=>{const p=AxiomStudioDaw.activeProject;return {title:p.title,clips:p.arrangementClips.length,
  points:p.automationLanes.reduce((n,l)=>n+l.points.length,0),
  pan:Object.fromEntries(Object.entries(p.rowMixer||{}).filter(([,m])=>m.pan!==undefined).map(([k,m])=>[k,m.pan]))}})()'''

CHECK_VALUES = r'''
(async () => {
  const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const db = await new Promise((res, rej) => { const r = indexedDB.open('ph-test-db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const get = (store, key) => wrap(db.transaction(store).objectStore(store).get(key));
  const bad = [], same = (name, cond) => { if (!cond) bad.push(name); };
  const t = await get('plain', 'types');
  same('u present and undefined', 'u' in t && t.u === undefined); same('null', t.n === null); same('NaN', Number.isNaN(t.nan)); same('-0', Object.is(t.neg0, -0));
  same('inf', t.inf === Infinity && t.ninf === -Infinity); same('bigint', t.big === 12345678901234567890n);
  same('date', t.d instanceof Date && t.d.getTime() === 1700000000123); same('invalid date', t.badDate instanceof Date && Number.isNaN(t.badDate.getTime()));
  same('map', t.m instanceof Map && t.m.size === 2 && t.m.get(1).a === 1 && t.m.get('x')[1] === 2); same('set', t.s instanceof Set && t.s.size === 3 && t.s.has('two') && t.s.has(null));
  same('regexp', t.re instanceof RegExp && t.re.source === 'ab+c' && t.re.flags === 'gi'); same('nested', t.nested.a[1].b[1].hasOwnProperty('c') && t.nested.a[1].b[1].c === undefined && t.nested.$ === 'dollar');
  same('string', t.str === 'ünï€𝄞 \u0000 end'); same('empty array', Array.isArray(t.emptyArr) && !t.emptyArr.length); same('false and zero', t.f === false && t.zero === 0);
  same('arraybuffer', t.ab instanceof ArrayBuffer && Array.from(new Uint8Array(t.ab)).join() === '1,2,3,250');
  same('u8 view', t.u8 instanceof Uint8Array && Array.from(t.u8).join() === '2,3,4,5,6'); same('f64', t.f64 instanceof Float64Array && t.f64[0] === 1.5 && t.f64[1] === -2.25 && Number.isNaN(t.f64[2]));
  same('i16', t.i16 instanceof Int16Array && Array.from(t.i16).join() === '-1,2,300'); same('dataview', t.dv instanceof DataView && t.dv.byteLength === 4 && t.dv.getUint8(0) === 1);
  same('bigint64', t.bi64 instanceof BigInt64Array && t.bi64[0] === -5n && t.bi64[1] === 7n);
  const f = await get('plain', 7);
  same('blob', f.blob instanceof Blob && !(f.blob instanceof File) && f.blob.type === 'text/plain' && await f.blob.text() === 'hello blob');
  same('file', f.file instanceof File && f.file.name === 'a.txt' && f.file.lastModified === 1600000000000 && f.file.type === 'text/plain' && await f.file.text() === 'file data');
  same('empty blob', f.emptyBlob instanceof Blob && f.emptyBlob.size === 0);
  const keys = await wrap(db.transaction('loose').objectStore('loose').getAllKeys());
  const kinds = keys.map(k => k instanceof Date ? 'date' : k instanceof ArrayBuffer ? 'binary' : Array.isArray(k) ? 'array' : typeof k).sort().join();
  same('key types ' + kinds, kinds === 'array,binary,date,number,string,string,string');
  const ak = keys.find(k => Array.isArray(k)); same('array key', ak && ak[0] === 'a' && ak[1] === 1 && ak[2] instanceof Date && ak[2].getTime() === 5);
  const bk = keys.find(k => k instanceof ArrayBuffer); same('binary key', Array.from(new Uint8Array(bk)).join() === '9,8,7');
  same('number key', (await get('loose', 42.5)).kind === 'number key'); same('null value', (await get('loose', 'k3')) === null); same('string value', (await get('loose', 'k2')) === 'plain string value');
  const tx = db.transaction('auto'); const auto = tx.objectStore('auto');
  same('autoincrement keys', (await wrap(auto.getAllKeys())).join() === '1,2');
  const big = await get('big', 'fifty'); same('big blob size', big.blob.size === 52428800 && big.tag === 'fifty');
  const info = db.version + '|' + Array.from(db.objectStoreNames).sort().join();
  const a = db.transaction('auto').objectStore('auto'), p = db.transaction('plain').objectStore('plain'), l = db.transaction('loose').objectStore('loose');
  const ix = Array.from(a.indexNames).sort().map(n => { const i = a.index(n); return [n, i.keyPath, i.unique, i.multiEntry].join(':'); }).join();
  const shape = [a.keyPath, a.autoIncrement, p.keyPath, p.autoIncrement, l.keyPath, l.autoIncrement].join('|');
  db.close();
  return {bad, info, ix, shape, bigSha: await PeakHourWindowSnapshot.sha256(big.blob, true), bigSubtle: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await big.blob.arrayBuffer())), v => v.toString(16).padStart(2, '0')).join('')};
})()
'''

BOUNDARY = r'''
(async () => {
  const bad = [];
  for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4194303, 4194304, 4194305, 9437197]) {
    const a = new Uint8Array(n); let s = n + 17; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; a[i] = s >>> 24; }
    const blob = new Blob([a]);
    const want = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', a)), v => v.toString(16).padStart(2, '0')).join('');
    if (await PeakHourWindowSnapshot.sha256(blob, true) !== want) bad.push(n);
  }
  return bad;
})()
'''

FIVE_FIFTY = r'''
(async () => {
  const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('ph-cost-db', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('blobs');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  let s = 987654321;
  for (let n = 0; n < 4; n++) {
    const parts = [];
    for (let c = 0; c < 50; c++) { const a = new Uint32Array(262144); for (let i = 0; i < a.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; a[i] = s >>> 0; } parts.push(a); }
    await new Promise((res, rej) => { const tx = db.transaction('blobs', 'readwrite'); tx.objectStore('blobs').put({blob: new Blob(parts, {type: 'audio/wav'}), n}, 'take-' + n); tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); });
  }
  db.close();
  return 4 * 50;
})()
'''

MEASURE = r'''
(async () => {
  const P = PeakHourWindowSnapshot;
  const lag = {max: 0, total: 0, ticks: 0}; let last = performance.now();
  const timer = setInterval(() => { const now = performance.now(), gap = now - last - 5; last = now; if (gap > lag.max) lag.max = gap; if (gap > 20) lag.total += gap; lag.ticks++; }, 5);
  const t0 = performance.now(), before = P.state.longTasks.length;
  const result = await P.exportNow({force: true, full: %s});
  const ms = performance.now() - t0;
  await new Promise(r => setTimeout(r, 300));
  clearInterval(timer);
  const tasks = P.state.longTasks.slice(before);
  return {ms: Math.round(ms), uploaded: result.uploaded, reused: result.reused, records: result.records, uploadedMB: Math.round((result.uploadedBytes || 0) / 1e6),
          longTasks: tasks.length, longTaskMs: tasks.reduce((n, t) => n + t[1], 0), longestTaskMs: tasks.reduce((n, t) => Math.max(n, t[1]), 0),
          lagMaxMs: Math.round(lag.max), lagOver20Ms: Math.round(lag.total), ticks: lag.ticks};
})()
'''

IDLE_LAG = r'''
(async () => {
  const lag = {max: 0, total: 0}; let last = performance.now();
  const timer = setInterval(() => { const now = performance.now(), gap = now - last - 5; last = now; if (gap > lag.max) lag.max = gap; if (gap > 20) lag.total += gap; }, 5);
  await new Promise(r => setTimeout(r, 3000)); clearInterval(timer);
  return {lagMaxMs: Math.round(lag.max), lagOver20Ms: Math.round(lag.total)};
})()
'''


def e(b, expr, timeout=170):
    return b.eval(expr, timeout=timeout)


def js(b, expr, timeout=170):
    return json.loads(e(b, '(async()=>JSON.stringify(await (%s)))()' % expr, timeout))


def settle(b, ms=400):
    b.eval('new Promise(r => setTimeout(r, %d))' % ms)


def home(b, noauto=True, timing=None):
    """Load the app's page; the automatic export is switched off (or sped up) before the snapshot script reads it."""
    b.run([{'op': 'navigate', 'url': '/', 'settle': 3500}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 3}])
    e(b, "(()=>{%s;return 1})()" % ("sessionStorage.setItem('%snoauto','1');sessionStorage.removeItem('%stiming')" % (OWN, OWN) if noauto else
                                      "sessionStorage.removeItem('%snoauto');sessionStorage.setItem('%stiming',%s)" % (OWN, OWN, json.dumps(json.dumps(timing or FAST)))))
    b.run([{'op': 'navigate', 'url': '/', 'settle': 3000}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 3}])
    check(until(lambda: e(b, "typeof PeakHourWindowSnapshot==='object'"), 20, 0.5), 'the snapshot script is not on the page')
    e(b, "PeakHourWindowSnapshot.ready.then(()=>1)")


def to_studio(b):
    e(b, "(()=>{showTab('studio');return 1})()")
    settle(b, 1200)


try:
    music = base / 'music'
    music.mkdir()
    tracks = []
    for i, name in enumerate(('one.wav', 'two.wav')):
        tone(music / name, hz=330 + 110 * i)
        tracks.append({'path': str(music / name), 'title': name, 'artist': 'Test', 'bpm': 120, 'durationSec': 6, 'duration': 6, 'key': '8A', 'name': name})

    print('[server unit checks: disk full, limits, traversal in-process]')
    unit = Path(tempfile.mkdtemp(prefix='unit', dir=str(base)))
    store = ws.Snapshots(lambda: unit)
    try:
        store.begin('http://127.0.0.1:1', 10 ** 15)
        check(False, 'a snapshot bigger than the cap must be refused')
    except ws.SnapshotError as err:
        check(err.status == 413 and 'GB' in str(err), f'too big: {err.status} {err}')
    old_usage = shutil.disk_usage
    ws.shutil.disk_usage = lambda p: shutil._ntuple_diskusage(100, 99, 1)
    try:
        store.begin('http://127.0.0.1:1', 5000)
        check(False, 'a full disk must be refused at begin')
    except ws.SnapshotError as err:
        check(err.status == 507 and err.code == 'disk_full' and 'disk is full' in str(err), f'disk full at begin: {err.status} {err.code} {err}')
    ws.shutil.disk_usage = old_usage
    begun = store.begin('http://127.0.0.1:1', 0)

    class Full:
        def read(self, n):
            raise OSError(errno.ENOSPC, 'No space left on device')

    try:
        store.put_record(begun['snapshot_id'], {'db': 'd', 'store': 's', 'key': 1, 'sha256': '0' * 64}, Full(), 1000)
        check(False, 'a write that runs out of disk must be refused')
    except ws.SnapshotError as err:
        check(err.status == 507 and 'disk is full' in str(err), f'disk full while writing: {err.status} {err}')
    except OSError:
        check(False, 'a disk-full OSError escaped as a raw error')
    try:
        store.put_record(begun['snapshot_id'], {'db': 'd', 'store': 's', 'key': 1, 'sha256': '0' * 64}, io.BytesIO(b'x' * 10), ws.MAX_RECORD + 1)
        check(False, 'one record over the cap must be refused')
    except ws.SnapshotError as err:
        check(err.status == 413, f'record cap: {err.status}')
    check(not [p for p in unit.rglob('*') if p.name.startswith('up-')], 'a refused upload left a temp part file')
    for bad in ('../x', '..\\x', 'snap-0000000000000000-' + 'a' * 31, ''):
        try:
            store.snapshot_dir(bad)
            check(False, f'snapshot id {bad!r} must be refused')
        except ws.SnapshotError:
            pass
    shutil.rmtree(unit, ignore_errors=True)

    print('[pruning never drops the fullest snapshot]')
    prune_root = Path(tempfile.mkdtemp(prefix='prune', dir=str(base)))
    pruner = ws.Snapshots(lambda: prune_root)

    def commit_records(count, tag):
        job = pruner.begin('http://127.0.0.1:1', 0)['snapshot_id']
        listed = []
        for n in range(count):
            body = ('%s-%d' % (tag, n)).encode() * 4
            sha = hashlib.sha256(body).hexdigest()
            pruner.put_record(job, {'db': 'd', 'store': 's', 'key': n, 'sha256': sha}, io.BytesIO(body), len(body))
            listed.append({'sha256': sha})
        pruner.put_small(job, 'localstorage', b'{}')
        pruner.put_small(job, 'schema', b'{}')
        time.sleep(0.01)
        return pruner.commit(job, listed, [], 0)['id']
    large = commit_records(6, 'large')
    for i in range(4):
        commit_records(1, 'tiny%d' % i)
    left = [p.name for p in pruner.snapshots()]
    check(large in left, 'the one large snapshot was pruned by four tiny ones: %s' % left)
    check(len(left) == 1 + ws.KEEP_OLD + 1, 'expected newest %d plus the fullest, found %d' % (1 + ws.KEEP_OLD, len(left)))
    shutil.rmtree(prune_root, ignore_errors=True)

    port_a, port_b, port_c = free_port(), free_port(), free_port()
    url_a = start(port_a, base)
    url_b = start(port_b, base)       # a second server on another port over the SAME data: another origin
    data_dir = base / 'data'

    print('[Worker SHA-256 equals Web Crypto at block boundaries]')
    pa = new_browser('edge-a', url_a)
    home(pa)
    check(js(pa, BOUNDARY) == [], 'the Worker SHA-256 differs from Web Crypto')

    print('[real Studio drafts + synthetic records]')
    to_studio(pa)
    e(pa, "(async()=>{window.__T=%s;AxiomStudioDaw.showStudioDawProject(__T[0],'track');await new Promise(r=>setTimeout(r,1800));"
          "AxiomStudioDaw.addTrackToProject(__T[1]);await new Promise(r=>setTimeout(r,1800));return 1})()" % json.dumps(tracks))
    e(pa, """(async()=>{const p=AxiomStudioDaw.activeProject;p.title='Snapshot One';p.rowMixer||={};
      p.rowMixer['left-deck']||={volume:1,muted:false};p.rowMixer['left-deck'].pan=35;p.rowMixer['right-deck']||={volume:1,muted:false};p.rowMixer['right-deck'].pan=-60;
      const id=p.arrangementClips[0].id;
      const lanes=[{scope:'clip',targetId:id,parameter:'filterPosition',points:[{beat:0,value:0,curve:'linear'},{beat:8,value:-80,curve:'linear'},{beat:16,value:60,curve:'linear'}]},
                   {scope:'clip',targetId:id,parameter:'volume',points:[{beat:0,value:1,curve:'hold'},{beat:6,value:0.3,curve:'linear'}]}];
      if(AxiomDawAutomation.apply(p,lanes)!==true)throw new Error('automation not applied');
      if(await AxiomDawDrafts.checkpoint(true)!==true)throw new Error('save one failed');return 1})()""")
    settle(pa, 600)
    e(pa, "(async()=>{AxiomStudioDaw.showStudioDawProject(__T[1],'track');await new Promise(r=>setTimeout(r,1800));return 1})()")
    e(pa, """(async()=>{const p=AxiomStudioDaw.activeProject;p.title='Snapshot Two';p.rowMixer||={};
      p.rowMixer['right-deck']||={volume:1,muted:false};p.rowMixer['right-deck'].pan=20;
      const id=p.arrangementClips[0].id;
      if(AxiomDawAutomation.apply(p,[{scope:'clip',targetId:id,parameter:'volume',points:[{beat:0,value:1,curve:'linear'},{beat:4,value:0.5,curve:'linear'}]}])!==true)throw new Error('automation two');
      if(await AxiomDawDrafts.checkpoint(true)!==true)throw new Error('save two failed');return 1})()""")
    settle(pa, 800)
    drafts = js(pa, DRAFTS)
    print('  drafts in the first profile:', drafts)
    check(len(drafts) == 2 and drafts[0]['title'] == 'Snapshot One' and drafts[1]['title'] == 'Snapshot Two', f'expected two saved drafts ({drafts})')
    check(drafts and drafts[0]['clips'] == 2 and drafts[0]['points'] >= 5 and drafts[0]['pan'] == {'left-deck': 35, 'right-deck': -60}, f'draft one state {drafts[:1]}')
    check(len(drafts) > 1 and drafts[1]['clips'] == 1 and drafts[1]['points'] >= 2 and drafts[1]['pan'] == {'right-deck': 20}, f'draft two state {drafts[1:]}')
    print('  synthetic: big blob bytes =', e(pa, SYNTHETIC))

    print('[export: manifest, hashes and sizes on disk]')
    t0 = time.time()
    first = js(pa, "PeakHourWindowSnapshot.exportNow({force:true})")
    print('  export result:', {k: v for k, v in first.items() if k != 'snapshot'}, 'in %.1f s' % (time.time() - t0))
    check(first.get('ok') is True, f'export failed ({first})')
    complete, building = snapshot_folders(base)
    check(len(complete) == 1 and not building, f'one complete snapshot and no leftovers expected ({complete}, {building})')
    manifest = json.loads((complete[-1] / 'manifest.json').read_text(encoding='utf-8'))
    counts = manifest['counts']
    print('  per-store counts:', counts)
    check(counts.get('axiom-daw-projects/drafts') == 2, f'two draft records expected ({counts})')
    check(counts.get('ph-test-db/plain') == 2 and counts.get('ph-test-db/auto') == 2 and counts.get('ph-test-db/loose') == 7 and counts.get('ph-test-db/big') == 1, f'synthetic counts ({counts})')
    check(sum(counts.values()) == len(manifest['records']) == first['records'], 'manifest counts must add up to its records')
    check(manifest['origin'] == url_a and manifest['version'] == 1 and manifest.get('created_text'), f'manifest origin/version/time ({manifest["origin"]})')
    total = 0
    for r in manifest['records']:
        f = complete[-1] / 'records' / (r['sha256'] + '.rec')
        total += r['size']
        if not (f.is_file() and f.stat().st_size == r['size'] and sha_file(f) == r['sha256']):
            check(False, f'record {r["db"]}/{r["store"]} {r["sha256"][:12]} does not match its file')
            break
    for part in ('localstorage', 'schema'):
        entry = manifest['parts'][part]
        f = complete[-1] / (part + '.json')
        total += entry['size']
        check(f.is_file() and f.stat().st_size == entry['size'] and sha_file(f) == entry['sha256'], f'{part}.json does not match the manifest')
    check(total == manifest['total_bytes'], f'total_bytes {manifest["total_bytes"]} != sum {total}')
    check(manifest['local_storage_keys'] >= 3 and any(d['name'] == 'ph-test-db' and d['version'] == 3 for d in manifest['databases']), f'localStorage keys / databases in manifest ({manifest["local_storage_keys"]}, {manifest["databases"]})')
    ls = json.loads((complete[-1] / 'localstorage.json').read_text(encoding='utf-8'))['items']
    check(ls.get('peakhour.test.alpha') == '1' and ls.get('peakhour.test.unicode') == '日本語 🎛️ \x00x' and not any(k.startswith(OWN) for k in ls), 'localStorage map in the snapshot')
    st, status = request(url_a, 'status')
    check(st == 200 and status['complete'] and status['snapshot']['id'] == complete[-1].name and status['snapshot']['records'] == len(manifest['records']), f'status route ({st})')

    print('[incremental: unchanged uploads nothing, one change uploads one]')
    second = js(pa, "PeakHourWindowSnapshot.exportNow({force:true})")
    print('  unchanged:', {k: second.get(k) for k in ('records', 'uploaded', 'reused', 'uploadedBytes')})
    check(second.get('uploaded') == 0 and second.get('reused') == second.get('records') == first['records'], f'an unchanged export must upload nothing ({second})')
    e(pa, """(async()=>{const wrap=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
      const db=await new Promise((res,rej)=>{const r=indexedDB.open('ph-test-db');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
      await new Promise((res,rej)=>{const tx=db.transaction('loose','readwrite');tx.objectStore('loose').put({kind:'string key',changed:true},'k1');tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});db.close();return 1})()""")
    third = js(pa, "PeakHourWindowSnapshot.exportNow({force:true})")
    print('  one record changed:', {k: third.get(k) for k in ('records', 'uploaded', 'reused')})
    check(third.get('uploaded') == 1 and third.get('reused') == third['records'] - 1, f'one changed record must upload exactly one ({third})')
    complete, _ = snapshot_folders(base)
    check(len(complete) == 3, f'three snapshots kept after three exports ({len(complete)})')
    m3 = json.loads((complete[-1] / 'manifest.json').read_text(encoding='utf-8'))
    big_sha = [r['sha256'] for r in m3['records'] if r['store'] == 'big'][0]
    check(sha_file(complete[-1] / 'records' / (big_sha + '.rec')) == big_sha, 'the 50 MB record is intact in the newest snapshot')
    for _ in range(3):
        js(pa, "PeakHourWindowSnapshot.exportNow({force:true})")
    complete, _ = snapshot_folders(base)
    check(len(complete) == 3, f'the newest plus at most 2 old snapshots must be kept ({len(complete)})')

    print('[an upload cut in the middle leaves the previous snapshot usable]')
    before = request(url_a, 'status')[1]['snapshot']['id']
    st, begun = request(url_a, 'begin', 'POST', {'origin': url_a, 'estimate': 0})
    check(st == 200 and begun.get('snapshot_id'), 'begin for the raw upload')
    meta = base64.urlsafe_b64encode(json.dumps({'db': 'x', 'store': 'y', 'key': {'t': 's', 'v': 'k'}, 'sha256': 'a' * 64}).encode()).decode().rstrip('=')
    with socket.create_connection(('127.0.0.1', port_a), timeout=10) as sock:
        sock.sendall(('POST /api/windows/window-snapshot/record/%s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nOrigin: %s\r\nX-PH-Meta: %s\r\nContent-Type: application/octet-stream\r\n'
                      'Content-Length: 200000\r\n\r\n' % (begun['snapshot_id'], port_a, url_a, meta)).encode() + b'z' * 5000)
        time.sleep(0.3)
    time.sleep(0.5)
    # the page aborts a 50 MB upload part-way (the connection is cut), like a window closing during a backup
    e(pa, """(async()=>{const P=PeakHourWindowSnapshot;const r=await (await fetch('/api/windows/window-snapshot/begin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:location.origin,estimate:0})})).json();
      const parts=[];for(let i=0;i<50;i++)parts.push(new Uint8Array(1048576).fill(i));const blob=new Blob(parts);
      const meta=btoa(JSON.stringify({db:'x',store:'y',key:{t:'s',v:'k'},sha256:'b'.repeat(64)})).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
      const c=new AbortController();setTimeout(()=>c.abort(),15);
      try{await fetch('/api/windows/window-snapshot/record/'+r.snapshot_id,{method:'POST',headers:{'X-PH-Meta':meta,'Content-Type':'application/octet-stream'},body:blob,signal:c.signal})}catch(err){}
      return 1})()""")
    time.sleep(1)
    after = request(url_a, 'status')[1]
    check(after['complete'] and after['snapshot']['id'] == before, f'the previous complete snapshot must stay the latest ({before} -> {after["snapshot"] and after["snapshot"]["id"]})')
    complete, building = snapshot_folders(base)
    deep = request(url_a, 'verify/' + complete[-1].name, 'POST', {'deep': True})[1]
    check(deep.get('complete') is True and deep.get('ok') is True, f'previous snapshot must still verify deep ({deep})')
    st, wrong = request(url_a, 'record/' + begun['snapshot_id'], 'POST', b'tiny body!', {'X-PH-Meta': meta, 'Content-Type': 'application/octet-stream'})
    check(st == 422 and wrong.get('code') == 'hash_mismatch', f'a body whose SHA-256 differs must be refused ({st} {wrong})')
    stale_parts = [p for b_ in building for p in b_.glob('up-*')]
    check(not stale_parts, f'a refused or cut upload left part files ({stale_parts})')
    print('  building folders left (never counted as snapshots):', len(building))
    interrupted = e(pa, "PeakHourWindowSnapshot.exportNow({force:true}).then(r=>r.uploaded)")
    check(interrupted == 0, f'an export after the cut upload still works and finds everything reused ({interrupted})')

    print('[security: path traversal and cross-origin POSTs]')
    complete, _ = snapshot_folders(base)
    sid = complete[-1].name
    sha0 = [r['sha256'] for r in json.loads((complete[-1] / 'manifest.json').read_text(encoding='utf-8'))['records']][0]
    for path in ('snapshot/..%2f..%2fwindow-data-snapshot/manifest', 'snapshot/%2e%2e/manifest', 'snapshot/%s/record/..%%5c..%%5cmanifest.json' % sid,
                 'snapshot/%s/record/%s' % (sid, '../../manifest.json'), 'snapshot/%s/part/..%%2fmanifest' % sid, 'snapshot/snap-1/manifest',
                 'snapshot/%s/record/%s' % (sid, 'g' * 64)):
        st, body = request(url_a, path)
        check(st in (400, 404), f'GET {path} must be refused ({st})')
    for path in ('record/..%2f..%2fx', 'part/..%5c/schema', 'commit/%2e%2e', 'verify/%2e%2e%2f%2e%2e', 'abort/..'):
        st, body = request(url_a, path, 'POST', {'a': 1})
        check(st in (400, 404, 405) or (path.startswith('abort') and st == 200 and body.get('aborted') is False), f'POST {path} must be refused ({st} {body})')
    st, body = request(url_a, 'begin', 'POST', {'origin': 'http://127.0.0.1:1', 'estimate': 0}, origin='http://evil.example')
    check(st == 403, f'a cross-origin POST must be refused ({st})')
    st, body = request(url_a, 'begin', 'POST', {'origin': 'x', 'estimate': 0}, origin=False)
    check(st == 403, f'a POST with no Origin must be refused ({st})')
    st, body = request(url_a, 'begin', 'POST', {'origin': 'x', 'estimate': 0}, origin=False, headers={'Origin': 'null'})
    check(st == 403, f'a POST from an opaque origin must be refused ({st})')
    st, body = request(url_a, 'begin', 'POST', {'origin': 'x', 'estimate': 0}, headers={'Sec-Fetch-Site': 'cross-site'})
    check(st == 403, f'a cross-site POST must be refused ({st})')
    st, body = request(url_a, 'status', headers={'Sec-Fetch-Site': 'cross-site'})
    check(st == 403, f'a cross-site read must be refused ({st})')
    st, body = request(url_a, 'status', headers={'Host': 'evil.example'})
    check(st == 403, f'a request for another host name must be refused ({st})')
    st, body = request(url_a, 'begin', 'POST', {'origin': 'x'}, origin=url_b)
    check(st == 403, f'a POST from the other app origin to this one must be refused ({st})')
    check(not [p for p in LP(base).rglob('*') if p.name in ('evil', 'x') and p.parent.name == 'window-data-snapshot'], 'no stray file from a traversal attempt')

    print('[nothing is exported while the Studio plays]')
    n_before = len(snapshot_folders(base)[0])
    e(pa, "(()=>{AxiomArrangement.play(AxiomStudioDaw.activeProject);return 1})()")
    playing = until(lambda: e(pa, 'AxiomArrangement.playing'), 40, 0.5)
    if not playing:
        print('  (real playback did not start in headless Edge; the transport getter is stubbed instead)')
        e(pa, "(()=>{Object.defineProperty(AxiomArrangement,'playing',{get:()=>true,configurable:true});return 1})()")
    r = js(pa, "PeakHourWindowSnapshot.exportNow()")
    check(r.get('skipped') == 'busy', f'an export while playing must be skipped ({r})')
    check(js(pa, "PeakHourWindowSnapshot.busy()") != '', 'busy() must say why')
    check(len(snapshot_folders(base)[0]) == n_before, 'no snapshot may be written while playing')
    check(e(pa, "PeakHourWindowSnapshot.state.nextAt!==null"), 'a skipped export must be rescheduled')
    e(pa, "(()=>{AxiomArrangement.stop(true);return 1})()")
    if not playing:
        e(pa, "(()=>{Object.defineProperty(AxiomArrangement,'playing',{get:()=>false,configurable:true});return 1})()")
    settle(pa, 600)
    r = js(pa, "PeakHourWindowSnapshot.exportNow()")
    check(r.get('ok') is True, f'after stopping, the export runs ({r})')

    print('[automatic export: after start, and after a draft save]')
    e(pa, "(()=>{sessionStorage.removeItem('%snoauto');sessionStorage.setItem('%stiming',%s);return 1})()" % (OWN, OWN, json.dumps(json.dumps(FAST))))
    n0 = len(snapshot_folders(base)[0])
    pa.run([{'op': 'navigate', 'url': '/', 'settle': 3000}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 3}])
    auto = until(lambda: e(pa, "PeakHourWindowSnapshot.state.exports"), 40, 1)
    check(auto and int(auto) >= 1, f'the automatic export did not run by itself after start ({auto})')
    check(e(pa, "PeakHourWindowSnapshot.state.last&&PeakHourWindowSnapshot.state.last.ok===true"), 'the automatic export should have succeeded')
    to_studio(pa)
    e(pa, "(async()=>{window.__T=%s;AxiomStudioDaw.showStudioDawProject(__T[0],'track');await new Promise(r=>setTimeout(r,1800));return 1})()" % json.dumps(tracks))
    exports_before = int(e(pa, "PeakHourWindowSnapshot.state.exports"))
    e(pa, """(async()=>{const p=AxiomStudioDaw.activeProject;p.title='Snapshot Three';if(await AxiomDawDrafts.checkpoint(true)!==true)throw new Error('save three');return 1})()""")
    again = until(lambda: int(e(pa, "PeakHourWindowSnapshot.state.exports")) > exports_before, 40, 0.5)
    check(again, 'a draft save must trigger an export about debounce time later')
    last = js(pa, "PeakHourWindowSnapshot.state.last")
    check(last.get('uploaded') in (1, 2) and last.get('reused', 0) >= last.get('records', 1) - 2, f'the draft-triggered export is incremental ({last})')
    latest = request(url_a, 'status')[1]['snapshot']
    check(latest['stores'].get('axiom-daw-projects/drafts') == 3, f'the new draft is in the newest snapshot ({latest["stores"]})')
    print('  last automatic export:', {k: last.get(k) for k in ('records', 'uploaded', 'reused', 'ms')})
    # stop auto so the profile stays still for the import checks
    e(pa, "(()=>{sessionStorage.setItem('%snoauto','1');return 1})()" % OWN)
    home(pa)
    drafts = js(pa, DRAFTS)
    for _ in range(4):
        dump_a = js(pa, DUMP, 300)
        js(pa, "PeakHourWindowSnapshot.exportNow({force:true})", 300)
        if js(pa, DUMP, 300) == dump_a:
            break
    print('  records in the first profile:', len(dump_a), 'drafts:', [d['title'] for d in drafts])
    ls_a = js(pa, "Object.fromEntries(Object.entries(localStorage).filter(([k])=>!k.startsWith('%s')))" % OWN)
    snap_origin = request(url_a, 'status')[1]['snapshot']['origin']

    def import_into(name, url, pre=None):
        """A fresh browser profile: open the app (the snapshot script imports by itself and reloads once) and wait for the end."""
        b = new_browser(name, url)
        b.run([{'op': 'navigate', 'url': '/static/js/shared/windows-hide-mac.js', 'settle': 500}])
        e(b, "(()=>{sessionStorage.setItem('%snoauto','1');return 1})()" % OWN)   # no automatic export in the imported profile
        if pre:
            e(b, pre)
        b.run([{'op': 'navigate', 'url': '/', 'settle': 3000}])
        done = until(lambda: e(b, "!!localStorage.getItem('%simported')&&typeof PeakHourWindowSnapshot==='object'&&!!sessionStorage.getItem('%sreloaded')" % (OWN, OWN)), 240, 1.5)
        check(done, f'{name}: the import did not finish and reload')
        until(lambda: e(b, "document.readyState==='complete'"), 30, 0.5)
        settle(b, 2500)
        b.run([{'op': 'click_text', 'text': 'Skip Tour', 'timeout': 3}])
        return b

    print('[import into a fresh profile, same origin]')
    t0 = time.time()
    pb = import_into('edge-b', url_a)
    print('  import + reload took %.1f s' % (time.time() - t0))
    outcome = js(pb, "JSON.parse(sessionStorage.getItem('%slastImport')||'null')" % OWN)
    print('  outcome:', outcome)
    check(outcome and outcome.get('imported') is True and outcome.get('verify', {}).get('ok') is True and outcome['verify'].get('missing') == 0, f'import outcome ({outcome})')
    dump_b = js(pb, DUMP, 300)
    check(dump_b == dump_a, f'every record must be identical after import (missing {sorted(set(dump_a) - set(dump_b))[:3]}, extra {sorted(set(dump_b) - set(dump_a))[:3]}, differing {[k for k in dump_a if k in dump_b and dump_a[k] != dump_b[k]][:3]})')
    vals = js(pb, CHECK_VALUES, 300)
    check(not vals['bad'], f'imported values differ from the originals: {vals["bad"]}')
    check(vals['info'] == '3|auto,big,loose,plain', f'the database was recreated from the saved schema ({vals["info"]})')
    check(vals['ix'] == 'by_code:code:true:false,by_name:name:false:false,by_tags:tags:false:true', f'indexes recreated ({vals["ix"]})')
    check(vals['shape'] == 'n|true|id|false||false', f'store keyPath/autoIncrement recreated ({vals["shape"]})')
    check(vals['bigSha'] == vals['bigSubtle'], 'big blob: Worker hash and Web Crypto hash agree')
    ls_b = js(pb, "Object.fromEntries(Object.entries(localStorage).filter(([k])=>!k.startsWith('%s')))" % OWN)
    # keys the fresh app sets for itself before the import are never overwritten, so only the keys the app did not set must match
    absent = [k for k in ls_a if k not in ls_b]
    differ = [k for k, v in ls_a.items() if k in ls_b and ls_b[k] != v]
    check(not absent, f'every localStorage key of the original must exist after import ({absent})')
    check(all(ls_b.get(k) == ls_a[k] for k in ls_a if k.startswith('peakhour.test.') or k == 'axiomStudioWorkingSet.v1'), 'the settings keys must match the original')
    print('  localStorage keys:', len(ls_a), 'original;', len(differ), "kept the fresh profile's own value:", differ)
    verify = json.loads((snapshot_folders(base)[0][-1] / 'verify.json').read_text(encoding='utf-8'))
    check(verify.get('ok') is True and verify.get('imported_into') == url_a and verify.get('missing') == 0, f'the verify report on the server ({verify})')
    check(js(pb, "(()=>{const a=sessionStorage.getItem('%snotice');return a})()" % OWN) is None, 'a successful import shows no message')
    to_studio(pb)
    e(pb, "(()=>{AxiomDawDrafts.open();return 1})()")
    settle(pb, 1500)
    titles = js(pb, "[...document.querySelectorAll('#daw-draft-dialog select option')].map(o=>o.textContent)")
    print('  "Open saved" list:', titles)
    check(len(titles) == 3 and all(any(t.startswith(x) for t in titles) for x in ('Snapshot One', 'Snapshot Two', 'Snapshot Three')), f'the drafts must appear in the app\'s own Open saved list ({titles})')
    opened = {}
    for title in ('Snapshot One', 'Snapshot Two', 'Snapshot Three'):
        e(pb, "(()=>{AxiomDawDrafts.open();return 1})()")
        settle(pb, 1200)   # a draft opened by another window's owner is saved on as "(separate copy)": pick the original by its title
        e(pb, "(()=>{const s=document.querySelector('#daw-draft-dialog select');const i=[...s.options].findIndex(o=>o.textContent.startsWith(%s));s.value=String(i);return i})()" % json.dumps(title + ' - '))
        e(pb, "(()=>{[...document.querySelectorAll('#daw-draft-dialog button')].find(b=>b.textContent==='Open saved').click();return 1})()")
        settle(pb, 2500)
        got = js(pb, ACTIVE)
        opened[got['title']] = got
    print('  opened:', opened)
    for want in drafts:
        got = opened.get(want['title'])
        check(got is not None and got['clips'] == want['clips'] and got['points'] == want['points'] and got['pan'] == want['pan'], f'draft {want["title"]} must open with the same clips, automation points and pan ({got} vs {want})')
    check(len(opened) == 3, f'three drafts opened ({list(opened)})')

    print('[a profile that is not empty refuses, and nothing existing is overwritten]')
    e(pb, "(()=>{localStorage.removeItem('%sseen');localStorage.removeItem('%simported');localStorage.setItem('peakhour.test.alpha','mine');return 1})()" % (OWN, OWN))
    n_records = len(js(pb, DUMP, 300))
    refused = js(pb, "PeakHourWindowSnapshot.importIfEmpty()", 120)
    check(refused.get('imported') is False and refused.get('reason') == 'not-empty', f'a profile with data must refuse ({refused})')
    check(e(pb, "localStorage.getItem('peakhour.test.alpha')") == 'mine', 'an existing localStorage key must not be overwritten')
    check(len(js(pb, DUMP, 300)) == n_records, 'a refused import must not add records')
    check(js(pb, "PeakHourWindowSnapshot.importIfEmpty()")['reason'] == 'profile-in-use', 'a profile that already decided must not look again')
    pa_check = js(pa, "PeakHourWindowSnapshot.importIfEmpty()")
    check(pa_check.get('imported') is False, f'the exporting profile never imports ({pa_check})')

    print('[import with an existing settings key: not overwritten]')
    pd = import_into('edge-d', url_a, pre="(()=>{localStorage.setItem('peakhour.test.alpha','mine');return 1})()")
    check(e(pd, "localStorage.getItem('peakhour.test.alpha')") == 'mine', 'an existing key stays as it was')
    check(e(pd, "localStorage.getItem('peakhour.test.unicode')") == ls_a['peakhour.test.unicode'], 'other keys are imported')
    check(js(pd, DUMP, 300) == dump_a, 'the records are all imported into that profile too')

    print('[import into a fresh profile on another port (another origin)]')
    t0 = time.time()
    pc = import_into('edge-c', url_b)
    print('  import + reload took %.1f s' % (time.time() - t0))
    outcome = js(pc, "JSON.parse(sessionStorage.getItem('%slastImport')||'null')" % OWN)
    check(outcome and outcome.get('imported') is True and outcome['verify']['ok'] is True, f'other-origin import outcome ({outcome})')
    check(e(pc, 'location.origin') == url_b and snap_origin == url_a, 'the snapshot came from one origin and was imported into another')
    check(js(pc, DUMP, 300) == dump_a, 'every record must be identical after an import into another origin')
    check(not js(pc, CHECK_VALUES, 300)['bad'], 'other-origin values identical')
    to_studio(pc)
    e(pc, "(()=>{AxiomDawDrafts.open();return 1})()")
    settle(pc, 1500)
    check(js(pc, "document.querySelectorAll('#daw-draft-dialog select option').length") == 3, 'the drafts appear under the other origin too')
    verify = json.loads((snapshot_folders(base)[0][-1] / 'verify.json').read_text(encoding='utf-8'))
    check(verify.get('imported_into') == url_b, f'the server recorded the other origin ({verify.get("imported_into")})')
    # the reload never loops: another load of the page does not import again and does not reload
    reloads = e(pc, "sessionStorage.getItem('%sreloaded')" % OWN)
    pc.run([{'op': 'navigate', 'url': '/', 'settle': 3500}])
    check(e(pc, "sessionStorage.getItem('%sreloaded')" % OWN) == reloads and js(pc, DUMP, 300) == dump_a, 'a later load must not import again')

    print('[cost: main-thread time of an export with 200 MB of blobs]')
    url_c = start(port_c, base / 'cost')
    pm = new_browser('edge-m', url_c)
    home(pm)
    idle_lag = js(pm, IDLE_LAG)
    print('  idle page, 3 s:', idle_lag)
    print('  200 MB of blobs created:', e(pm, FIVE_FIFTY, 300), 'MB')
    cold = js(pm, MEASURE % 'false', 300)
    print('  COST first export (hash + upload 200 MB):', cold)
    unchanged = js(pm, MEASURE % 'false', 300)
    print('  COST unchanged export (nothing re-read):', unchanged)
    forced = js(pm, MEASURE % 'true', 300)
    print('  COST full re-hash of 200 MB, nothing uploaded:', forced)
    check(cold['uploaded'] == 4 and unchanged['uploaded'] == 0 and forced['uploaded'] == 0, f'cost run uploads ({cold["uploaded"]}, {unchanged["uploaded"]}, {forced["uploaded"]})')
    check(cold['longestTaskMs'] < 250 and cold['lagMaxMs'] < 400, f'an export must not block the page for long ({cold})')

    print('[a damaged record file is found; the import reports it once and does not loop]')
    complete, _ = snapshot_folders(base)
    newest = complete[-1]
    manifest = json.loads((newest / 'manifest.json').read_text(encoding='utf-8'))
    victim = [r for r in manifest['records'] if r['store'] == 'drafts'][0]
    path = newest / 'records' / (victim['sha256'] + '.rec')
    data = bytearray(path.read_bytes())
    data[len(data) // 2] ^= 0xFF
    path.write_bytes(bytes(data))   # same size, one byte changed
    st, shallow = request(url_a, 'status')
    check(shallow['complete'] is True, 'a shallow status check cannot see a flipped byte (size is the same)')
    st, deep = request(url_a, 'verify/' + newest.name, 'POST', {'deep': True})
    check(st == 200 and deep.get('complete') is False and victim['sha256'] in deep.get('corrupt', []) and deep.get('ok') is False, f'the deep verify must name the damaged file ({deep})')
    st, failure = request(url_a, 'status')
    check(failure.get('last_failure') and failure['last_failure']['missing'] >= 1, f'the failure must be recorded in the snapshot status ({failure.get("last_failure")})')
    pe = import_into('edge-e', url_a)
    outcome = js(pe, "JSON.parse(sessionStorage.getItem('%slastImport')||'null')" % OWN)
    print('  outcome:', outcome)
    check(outcome and outcome.get('imported') is True and outcome.get('reason') == 'verify-failed' and outcome['verify']['ok'] is False and outcome['verify']['missing'] >= 1,
          f'a damaged record must make the import report missing items ({outcome})')
    check(outcome and outcome.get('records', 0) >= len(manifest['records']) - 2, f'everything else must still be imported ({outcome})')
    rr = e(pe, "sessionStorage.getItem('%sreloaded')" % OWN)
    pe.run([{'op': 'navigate', 'url': '/', 'settle': 3500}])
    check(e(pe, "sessionStorage.getItem('%sreloaded')" % OWN) == rr and e(pe, "localStorage.getItem('%simported')" % OWN), 'after a failed import the page must not retry or loop')
    notice = e(pe, "sessionStorage.getItem('%slastNotice')" % OWN)
    print('  message shown on the page:', notice)
    check(notice and 'could not be fully restored' in notice and '1 item missing' in notice, f'one plain message with the count of missing items ({notice})')

except BaseException:
    import traceback
    traceback.print_exc()
    failures.append('the test itself crashed')
finally:
    for br in browsers:
        try:
            br.close()
        except Exception:
            pass
    try:
        fb._kill_profile_users(base)
    except Exception:
        pass
    for process in servers:
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(process.pid)], capture_output=True)
    time.sleep(2)
    left = subprocess.run(['powershell', '-NoProfile', '-Command',
                           "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($env:FC_BASE.ToLower()) } | Select-Object -ExpandProperty ProcessId"],
                          capture_output=True, text=True, env=dict(os.environ, FC_BASE=str(base))).stdout.split()
    print('leftover processes using the temp folder:', left or 'none')
    if left:
        failures.append(f'leftover processes: {left}')
        for pid in left:
            subprocess.run(['taskkill', '/T', '/F', '/PID', pid], capture_output=True)
    if not os.environ.get('PH_KEEP'):
        shutil.rmtree(LP(base), ignore_errors=True)
print('PASS: drafts and settings are saved through the app, imported into a fresh profile and another origin, verified, and every unsafe case is refused'
      if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
