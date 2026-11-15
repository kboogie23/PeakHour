// Window data snapshot (Windows only). Studio drafts live in this browser profile's IndexedDB and settings in localStorage, and
// a new window / profile / port (= another origin) would not see them. This script saves them through the app itself
// (windows_window_snapshot.py: <data>\window-data-snapshot) and fills a fresh, empty profile from the latest complete snapshot.
//
//   EXPORT  runs by itself in the background: a while after start when the page is idle, and again 60 s after the last draft
//           save (the 'axiom-drafts-changed' event from draft-storage.js) or when the 5-minute look finds other counts. Never
//           while playing, recording or exporting audio. Invisible: no toasts, small batches, yields between records, hashing
//           of big blobs in a Worker. Unchanged records are not uploaded again.
//   IMPORT  PeakHourWindowSnapshot.importIfEmpty(): only in a profile whose IndexedDB stores are all empty and that has never
//           backed up or imported; never overwrites; re-reads and reports to the server; one guarded reload so the app's own
//           code reads the imported drafts and settings. PeakHourWindowSnapshot.ready is that decision (the export waits for it).
//
// Record file (what the server stores, named by its SHA-256): 'PHR1' + uint32 BE header length + header JSON + binary parts.
// Header: {v:1, db, store, key:<tagged key>, value:<tagged value>, parts:[byte sizes]}. Tagged values keep undefined, NaN, -0,
// bigint, Date, Map, Set, RegExp, Blob/File (type, name, lastModified), ArrayBuffer and typed arrays apart from plain JSON.
// Not kept: cycles and shared references (a record with one is skipped and counted), array holes (become undefined).
(function () {
  'use strict';
  if (window.PeakHourWindowSnapshot) return;
  const API = '/api/windows/window-snapshot/';
  const KNOWN = ['axiom-daw-projects', 'axiom-daw-audio-v1'];
  const OWN = 'peakhour.windowSnapshot.';
  const SEEN = OWN + 'seen', IMPORTED = OWN + 'imported', RELOADED = OWN + 'reloaded', NOTICE = OWN + 'notice', TIMING = OWN + 'timing';
  const LARGE = 1 << 20;          // a record with this many blob bytes is recognised by its header + sizes, not re-read
  const BATCH = 8;
  const MAGIC = [0x50, 0x48, 0x52, 0x31];
  let timing = { start: 20000, debounce: 60000, retry: 30000, poll: 300000, failed: 300000 };
  // Test hooks (timings, noauto, noReload) are off on port 8080, where the real app runs; tests use the sandbox on other ports.
  const testHooks = location.port !== '8080';
  if (testHooks) try { Object.assign(timing, JSON.parse(sessionStorage.getItem(TIMING) || '{}')); } catch (e) { /* defaults */ }

  const state = { running: false, last: null, lastError: null, import: null, nextAt: null, exports: 0, longTasks: [] };
  let timer = null, pollTimer = null, ready = null, dirty = false, signature = '';

  // ------------------------------------------------------------------ small helpers
  const idle = () => new Promise(resolve => (window.requestIdleCallback ? window.requestIdleCallback(() => resolve(), { timeout: 250 }) : setTimeout(resolve, 0)));
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const hex = buffer => Array.from(new Uint8Array(buffer), v => v.toString(16).padStart(2, '0')).join('');
  const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  const utf8 = text => new TextEncoder().encode(text);
  const identityOf = (db, store, key) => JSON.stringify([db, store, key]);
  const wrap = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });

  async function api(path, options) {
    const response = await fetch(API + path, options);
    let data = null;
    try { data = await response.json(); } catch (e) { /* not JSON */ }
    if (!response.ok || !data || data.success === false) {
      const error = new Error((data && data.error) || ('The backup service answered ' + response.status));
      error.code = data && data.code; error.status = response.status;
      throw error;
    }
    return data;
  }
  const post = (path, body, extra) => api(path, Object.assign({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, extra));

  // ------------------------------------------------------------------ SHA-256 (Web Crypto for small data, a Worker for big blobs)
  const WORKER = `
const K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const H=new Uint32Array(8),W=new Uint32Array(64);
function reset(){H.set([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);}
function block(m,o){
  for(let i=0;i<16;i++)W[i]=(m[o+4*i]<<24)|(m[o+4*i+1]<<16)|(m[o+4*i+2]<<8)|m[o+4*i+3];
  for(let i=16;i<64;i++){const x=W[i-15],y=W[i-2];W[i]=(W[i-16]+(((x>>>7)|(x<<25))^((x>>>18)|(x<<14))^(x>>>3))+W[i-7]+(((y>>>17)|(y<<15))^((y>>>19)|(y<<13))^(y>>>10)))|0;}
  let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
  for(let i=0;i<64;i++){
    const t1=(h+(((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)))+((e&f)^(~e&g))+K[i]+W[i])|0;
    const t2=((((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)))+((a&b)^(a&c)^(b&c)))|0;
    h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
  }
  H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
}
async function sha(blob){
  reset();
  const tail=new Uint8Array(128);let have=0,total=0;
  for(let offset=0;offset<blob.size;offset+=4194304){
    const chunk=new Uint8Array(await blob.slice(offset,Math.min(blob.size,offset+4194304)).arrayBuffer());
    total+=chunk.length;let at=0;
    if(have){const take=Math.min(64-have,chunk.length);tail.set(chunk.subarray(0,take),have);have+=take;at=take;if(have===64){block(tail,0);have=0;}}
    for(;at+64<=chunk.length;at+=64)block(chunk,at);
    if(at<chunk.length){tail.set(chunk.subarray(at),0);have=chunk.length-at;}
  }
  tail[have]=0x80;tail.fill(0,have+1);
  const end=have<56?64:128,bits=total*8;
  const view=new DataView(tail.buffer);view.setUint32(end-8,Math.floor(bits/4294967296));view.setUint32(end-4,bits>>>0);
  block(tail,0);if(end===128)block(tail,64);
  return Array.from(H,v=>(v>>>0).toString(16).padStart(8,'0')).join('');
}
onmessage=async e=>{try{postMessage({id:e.data.id,sha:await sha(e.data.blob)});}catch(err){postMessage({id:e.data.id,error:String(err)});}};`;
  let worker = null, workerFailed = false, workerId = 0;
  const waiting = new Map();
  function getWorker() {
    if (worker || workerFailed) return worker;
    try {
      worker = new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' })));
      worker.onmessage = event => { const w = waiting.get(event.data.id); if (w) { waiting.delete(event.data.id); event.data.error ? w.reject(new Error(event.data.error)) : w.resolve(event.data.sha); } };
      worker.onerror = () => { workerFailed = true; worker = null; for (const w of waiting.values()) w.reject(new Error('hash worker failed')); waiting.clear(); };
    } catch (e) { workerFailed = true; worker = null; }
    return worker;
  }
  async function sha256(blob, forceWorker) {
    if (forceWorker || blob.size > 8 << 20) {
      const w = getWorker();
      if (w) {
        try { return await new Promise((resolve, reject) => { const id = ++workerId; waiting.set(id, { resolve, reject }); w.postMessage({ id, blob }); }); } catch (e) { /* fall through */ }
      }
    }
    return hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  }

  // ------------------------------------------------------------------ keys and values <-> tagged JSON
  function encKey(key) {
    if (typeof key === 'string') return { t: 's', v: key };
    if (typeof key === 'number') return { t: 'n', v: Number.isFinite(key) ? key : String(key) };
    if (key instanceof Date) return { t: 'd', v: key.getTime() };
    if (Array.isArray(key)) return { t: 'a', v: key.map(encKey) };
    if (key instanceof ArrayBuffer) return { t: 'b', v: b64(new Uint8Array(key)) };
    if (ArrayBuffer.isView(key)) return { t: 'b', v: b64(new Uint8Array(key.buffer, key.byteOffset, key.byteLength)) };
    throw new Error('unsupported key type');
  }
  function decKey(e) {
    switch (e.t) {
      case 's': return e.v;
      case 'n': return typeof e.v === 'string' ? Number(e.v) : e.v;
      case 'd': return new Date(e.v);
      case 'a': return e.v.map(decKey);
      case 'b': return unb64(e.v).buffer;
    }
    throw new Error('unsupported key type');
  }
  const TYPED = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'DataView'];

  function encode(value, parts, path) {
    const seen = path || new Set();
    if (value === null) return null;
    switch (typeof value) {
      case 'undefined': return { $: 'u' };
      case 'boolean': case 'string': return value;
      case 'number': return Number.isFinite(value) && !Object.is(value, -0) ? value : { $: 'n', v: Object.is(value, -0) ? '-0' : String(value) };
      case 'bigint': return { $: 'bi', v: value.toString() };
      case 'function': case 'symbol': throw new Error('unsupported value');
    }
    if (seen.has(value)) throw new Error('cyclic value');
    seen.add(value);
    try {
      if (value instanceof File) { parts.push(value); return { $: 'file', i: parts.length - 1, size: value.size, type: value.type, name: value.name, lastModified: value.lastModified }; }
      if (value instanceof Blob) { parts.push(value); return { $: 'blob', i: parts.length - 1, size: value.size, type: value.type }; }
      if (value instanceof ArrayBuffer) { parts.push(new Blob([value])); return { $: 'ab', i: parts.length - 1, size: value.byteLength }; }
      if (ArrayBuffer.isView(value)) {
        const kind = value.constructor.name;
        if (!TYPED.includes(kind)) throw new Error('unsupported view');
        parts.push(new Blob([new Uint8Array(value.buffer, value.byteOffset, value.byteLength)]));
        return { $: 'ta', kind, i: parts.length - 1, size: value.byteLength };
      }
      if (value instanceof Date) return { $: 'd', v: Number.isNaN(value.getTime()) ? 'invalid' : value.getTime() };
      if (value instanceof RegExp) return { $: 're', source: value.source, flags: value.flags, lastIndex: value.lastIndex };
      if (value instanceof Map) return { $: 'm', v: Array.from(value, ([k, v]) => [encode(k, parts, seen), encode(v, parts, seen)]) };
      if (value instanceof Set) return { $: 'set', v: Array.from(value, v => encode(v, parts, seen)) };
      if (Array.isArray(value)) { const out = new Array(value.length); for (let i = 0; i < value.length; i++) out[i] = encode(value[i], parts, seen); return out; }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new Error('unsupported object');
      const out = {};
      for (const key of Object.keys(value).sort()) Object.defineProperty(out, key, { value: encode(value[key], parts, seen), enumerable: true, writable: true, configurable: true });
      return Object.prototype.hasOwnProperty.call(out, '$') ? { $: 'o', v: out } : out;
    } finally { seen.delete(value); }
  }

  async function decode(e, part) {
    if (e === null || typeof e !== 'object') return e;
    if (Array.isArray(e)) { const out = []; for (const item of e) out.push(await decode(item, part)); return out; }
    const plain = async source => {
      const out = {};
      for (const key of Object.keys(source)) Object.defineProperty(out, key, { value: await decode(source[key], part), enumerable: true, writable: true, configurable: true });
      return out;
    };
    switch (e.$) {
      case undefined: return plain(e);
      case 'o': return plain(e.v);
      case 'u': return undefined;
      case 'n': return e.v === '-0' ? -0 : Number(e.v);
      case 'bi': return BigInt(e.v);
      case 'd': return new Date(e.v === 'invalid' ? NaN : e.v);
      case 're': { const r = new RegExp(e.source, e.flags); r.lastIndex = e.lastIndex || 0; return r; }
      case 'm': { const m = new Map(); for (const [k, v] of e.v) m.set(await decode(k, part), await decode(v, part)); return m; }
      case 'set': { const s = new Set(); for (const v of e.v) s.add(await decode(v, part)); return s; }
      case 'blob': return part(e.i, e.type);
      case 'file': return new File([part(e.i)], e.name, { type: e.type, lastModified: e.lastModified });
      case 'ab': return part(e.i).arrayBuffer();
      case 'ta': {
        if (!TYPED.includes(e.kind)) throw new Error('unsupported view');
        const buffer = await part(e.i).arrayBuffer();
        return e.kind === 'DataView' ? new DataView(buffer) : new window[e.kind](buffer);
      }
    }
    throw new Error('unknown encoding ' + e.$);
  }

  // The record file for one record, plus what the incremental check needs.
  function recordFile(db, store, key, value) {
    const parts = [];
    const tagged = encode(value, parts);
    const keyText = encKey(key);
    const header = utf8(JSON.stringify({ v: 1, db, store, key: keyText, value: tagged, parts: parts.map(p => p.size) }));
    const prefix = new Uint8Array(8);
    prefix.set(MAGIC, 0);
    new DataView(prefix.buffer).setUint32(4, header.length);
    const blobBytes = parts.reduce((n, p) => n + p.size, 0);
    return { blob: new Blob([prefix, header, ...parts]), header, blobBytes, key: keyText };
  }

  async function parseRecord(blob) {
    const head = new DataView(await blob.slice(0, 8).arrayBuffer());
    if (head.getUint8(0) !== MAGIC[0] || head.getUint8(1) !== MAGIC[1] || head.getUint8(2) !== MAGIC[2] || head.getUint8(3) !== MAGIC[3]) throw new Error('not a record file');
    const length = head.getUint32(4);
    const header = JSON.parse(await blob.slice(8, 8 + length).text());
    const offsets = []; let at = 8 + length;
    for (const size of header.parts) { offsets.push([at, size]); at += size; }
    if (at !== blob.size) throw new Error('record size does not match its header');
    const part = (i, type) => blob.slice(offsets[i][0], offsets[i][0] + offsets[i][1], type || '');
    return { header, part };
  }

  // ------------------------------------------------------------------ reading this profile
  async function listDatabases() {
    if (indexedDB.databases) {
      try { return (await indexedDB.databases()).filter(d => d.name).map(d => ({ name: d.name, version: d.version })); } catch (e) { /* use the fallback */ }
    }
    const found = [];
    for (const name of KNOWN) {   // opening a missing database creates it: abort its first upgrade, which removes it again
      await new Promise(resolve => {
        const request = indexedDB.open(name); let existed = true;
        request.onupgradeneeded = () => { existed = false; request.transaction.abort(); };
        request.onsuccess = () => { if (existed) found.push({ name, version: request.result.version }); request.result.close(); resolve(); };
        request.onerror = () => resolve();
      });
    }
    return found;
  }
  function openDatabase(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('database ' + name + ' does not exist')); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('database ' + name + ' is busy'));
    });
  }
  function schemaOf(db) {
    const stores = [];
    if (!db.objectStoreNames.length) return { name: db.name, version: db.version, stores };
    const tx = db.transaction(Array.from(db.objectStoreNames), 'readonly');
    for (const name of db.objectStoreNames) {
      const store = tx.objectStore(name);
      stores.push({ name, keyPath: store.keyPath, autoIncrement: store.autoIncrement,
        indexes: Array.from(store.indexNames, i => { const x = store.index(i); return { name: x.name, keyPath: x.keyPath, unique: x.unique, multiEntry: x.multiEntry }; }) });
    }
    return { name: db.name, version: db.version, stores };
  }
  async function eachBatch(db, storeName, visit) {
    let after = null;
    for (;;) {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const range = after === null ? undefined : IDBKeyRange.lowerBound(after, true);
      const [keys, values] = await Promise.all([wrap(store.getAllKeys(range, BATCH)), wrap(store.getAll(range, BATCH))]);
      for (let i = 0; i < keys.length; i++) await visit(keys[i], values[i]);
      if (keys.length < BATCH) return;
      after = keys[keys.length - 1];
    }
  }
  async function isEmpty() {
    for (const info of await listDatabases()) {
      const db = await openDatabase(info.name);
      try {
        for (const name of db.objectStoreNames) if (await wrap(db.transaction(name).objectStore(name).count()) > 0) return false;
      } finally { db.close(); }
    }
    return true;
  }
  function readLocalStorage() {
    const items = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== null && !k.startsWith(OWN)) items[k] = localStorage.getItem(k); }
    const sorted = {};
    for (const k of Object.keys(items).sort()) Object.defineProperty(sorted, k, { value: items[k], enumerable: true, writable: true, configurable: true });
    return sorted;
  }

  // ------------------------------------------------------------------ busy
  function busy() {
    const a = window.AxiomArrangement;
    if (a && (a.playing || a.loading || a.rendering)) return 'The Studio is playing or exporting.';
    if (window.AxiomAutomationRecorder && window.AxiomAutomationRecorder.recording) return 'Automation is being recorded.';
    if (window.AxiomDawTimelineRecording && window.AxiomDawTimelineRecording.active) return 'A take is being recorded.';
    const player = document.getElementById('audio-player');
    if (player && player.dataset.transportState === 'playing') return 'The Studio is playing.';
    return '';
  }

  // ------------------------------------------------------------------ export
  async function doExport(options) {
    const started = performance.now();
    const origin = location.origin;
    if (!options.force) { const why = busy(); if (why) return { skipped: 'busy', reason: why }; }
    const info = await listDatabases();
    let estimate = 0;
    try { estimate = (await navigator.storage.estimate()).usage || 0; } catch (e) { /* unknown */ }
    const begun = await post('begin', { origin, estimate });
    const id = begun.snapshot_id;
    const previous = new Map();
    for (const r of (begun.previous && begun.previous.records) || []) previous.set(identityOf(r.db, r.store, r.key), r);
    const listed = [], schemas = [], stats = { records: 0, uploaded: 0, reused: 0, skipped: 0, bytes: 0, uploadedBytes: 0 };
    const abort = () => post('abort/' + id, {}).catch(() => {});
    try {
      for (const entry of info) {
        const db = await openDatabase(entry.name).catch(() => null);
        if (!db) continue;
        try {
          schemas.push(schemaOf(db));
          for (const storeName of Array.from(db.objectStoreNames)) {
            await eachBatch(db, storeName, async (key, value) => {
              if (!options.force) { const why = busy(); if (why) { const e = new Error(why); e.busy = true; throw e; } }
              await tick();
              let file;
              try { file = recordFile(entry.name, storeName, key, value); } catch (e) { stats.skipped++; return; }
              const ident = identityOf(entry.name, storeName, file.key);
              const fp = file.blobBytes >= LARGE ? 'h' + hex(await crypto.subtle.digest('SHA-256', file.header)) + ':' + file.blobBytes : null;
              const old = previous.get(ident);
              let sha = null;
              if (old && !options.full && fp && old.fp === fp) sha = old.sha256;
              else { sha = await sha256(file.blob); }
              stats.records++; stats.bytes += file.blob.size;
              if (old && old.sha256 === sha) { stats.reused++; }
              else {
                const meta = utf8(JSON.stringify({ db: entry.name, store: storeName, key: file.key, sha256: sha, fp }));
                if (meta.length > 8000) { stats.skipped++; stats.records--; stats.bytes -= file.blob.size; return; }
                await api('record/' + id, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-PH-Meta': b64(meta).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }, body: file.blob });
                stats.uploaded++; stats.uploadedBytes += file.blob.size;
              }
              listed.push({ db: entry.name, store: storeName, key: file.key, sha256: sha, size: file.blob.size, fp });
              await idle();
            });
          }
        } finally { db.close(); }
      }
      if (!stats.records && begun.previous && begun.previous.records.length) { await abort(); return { skipped: 'empty', reason: 'This profile has no saved data; the earlier backup was kept.' }; }
      const items = readLocalStorage();
      const lsText = JSON.stringify({ v: 1, items });
      await api('part/' + id + '/localstorage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: lsText });
      await api('part/' + id + '/schema', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, databases: schemas }) });
      const committed = await post('commit/' + id, { records: listed, local_storage_keys: Object.keys(items).length,
        databases: schemas.map(d => ({ name: d.name, version: d.version, stores: d.stores.map(s => s.name) })) });
      localStorage.setItem(SEEN, '1');
      return Object.assign({ ok: true, ms: Math.round(performance.now() - started), snapshot: committed.snapshot }, stats);
    } catch (error) {
      await abort();
      if (error.busy) return { skipped: 'busy', reason: error.message, partial: stats };
      throw error;
    }
  }

  let running = null;
  function exportNow(options) {
    if (running) return running;
    state.running = true;
    running = (async () => {
      try {
        await ready;
        dirty = false;
        const result = await doExport(options || {});
        if (result.skipped === 'busy') { state.last = Object.assign({ at: Date.now() }, result); schedule(timing.retry); return result; }
        state.lastError = null; state.exports++;
        state.last = Object.assign({ at: Date.now() }, result);
        return result;
      } catch (error) {
        state.lastError = { at: Date.now(), message: error.message, code: error.code };
        schedule(timing.failed);
        throw error;
      } finally { state.running = false; running = null; if (dirty && !state.nextAt) schedule(timing.debounce); }
    })();
    return running;
  }

  function schedule(delay) {
    clearTimeout(timer);
    state.nextAt = Date.now() + delay;
    timer = setTimeout(() => { state.nextAt = null; exportNow().catch(() => {}); }, delay);
  }
  async function currentSignature() {
    const parts = [];
    for (const info of await listDatabases()) {
      const db = await openDatabase(info.name).catch(() => null);
      if (!db) continue;
      try { for (const name of db.objectStoreNames) parts.push(info.name + '/' + name + '=' + await wrap(db.transaction(name).objectStore(name).count())); } finally { db.close(); }
    }
    const items = readLocalStorage();
    let h = 2166136261, n = 0;
    for (const k of Object.keys(items)) { for (const c of k + '\u0000' + items[k]) { h = Math.imul(h ^ c.charCodeAt(0), 16777619); } n++; }
    parts.push('ls=' + n + ':' + (h >>> 0));
    return parts.join('|');
  }
  function startAuto() {
    window.addEventListener('axiom-drafts-changed', () => { dirty = true; if (!running) schedule(timing.debounce); });
    pollTimer = setInterval(async () => {
      if (running || state.nextAt) return;
      try { const now = await currentSignature(); if (now !== signature) { signature = now; schedule(timing.debounce); } } catch (e) { /* try again later */ }
    }, timing.poll);
    const first = () => setTimeout(async () => { await idle(); try { signature = await currentSignature(); } catch (e) { /* ignore */ } schedule(0); }, timing.start);
    if (document.readyState === 'complete') first(); else window.addEventListener('load', first, { once: true });
  }

  // ------------------------------------------------------------------ import
  async function createMissing(schema) {
    // Let the app create what it knows how to (its draft storage); only then fill gaps from the saved schema.
    try { if (window.AxiomDraftStorage && window.AxiomDraftStorage.ready) await window.AxiomDraftStorage.ready(); } catch (e) { /* created below */ }
    const existing = new Set((await listDatabases()).map(d => d.name));
    for (const entry of schema.databases || []) {
      if (existing.has(entry.name)) continue;
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(entry.name, entry.version || 1);
        request.onupgradeneeded = () => {
          for (const s of entry.stores) {
            const options = { autoIncrement: !!s.autoIncrement }; if (s.keyPath !== null && s.keyPath !== undefined) options.keyPath = s.keyPath;
            const store = request.result.createObjectStore(s.name, options);
            for (const ix of s.indexes || []) store.createIndex(ix.name, ix.keyPath, { unique: !!ix.unique, multiEntry: !!ix.multiEntry });
          }
        };
        request.onsuccess = () => { request.result.close(); resolve(); };
        request.onerror = () => reject(request.error);
      });
    }
  }
  async function putRecord(db, storeName, key, value) {
    return new Promise(resolve => {
      let tx;
      try { tx = db.transaction(storeName, 'readwrite'); } catch (e) { resolve('missing-store'); return; }
      const store = tx.objectStore(storeName);
      let result = 'added';
      let request;
      try { request = store.keyPath === null ? store.add(value, key) : store.add(value); } catch (e) { resolve('failed'); return; }
      request.onerror = event => { event.preventDefault(); event.stopPropagation(); result = request.error && request.error.name === 'ConstraintError' ? 'exists' : 'failed'; };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => resolve(result === 'added' ? 'failed' : result);
    });
  }
  const noticeText = missing => 'Some of your Studio drafts could not be fully restored from the backup (' + missing + ' item' + (missing === 1 ? '' : 's') + ' missing). What was restored has been kept.';

  async function doImport() {
    const outcome = { imported: false, reason: null, records: 0, skipped: 0, missing: 0, localStorage: 0, timings: [] };
    const t0 = performance.now(), mark = name => outcome.timings.push([name, Math.round(performance.now() - t0)]);
    if (localStorage.getItem(SEEN) || localStorage.getItem(IMPORTED)) { outcome.reason = 'profile-in-use'; return outcome; }
    if (!(await isEmpty())) { localStorage.setItem(SEEN, '1'); outcome.reason = 'not-empty'; return outcome; }
    const status = await api('status');
    if (!status.complete || !status.snapshot) { outcome.reason = 'no-snapshot'; return outcome; }
    const snapshot = status.snapshot;
    mark('empty-and-status');
    localStorage.setItem(IMPORTED, snapshot.id);       // set before any work: whatever happens, this profile never imports twice
    const manifest = await (await fetch(API + 'snapshot/' + snapshot.id + '/manifest')).json();
    const schema = await (await fetch(API + 'snapshot/' + snapshot.id + '/part/schema')).json();
    await createMissing(schema);
    mark('manifest-and-schema');
    const dbs = new Map();
    const open = async name => { if (!dbs.has(name)) dbs.set(name, await openDatabase(name).catch(() => null)); return dbs.get(name); };
    const imported = [];       // {db, store, key, sha}
    try {
      for (const record of manifest.records) {
        const db = await open(record.db);
        let verdict = 'failed';
        if (db) {
          try {
            const response = await fetch(API + 'snapshot/' + snapshot.id + '/record/' + record.sha256);
            if (!response.ok) throw new Error('record unavailable');
            const blob = await response.blob();
            if (record.size > LARGE) mark('fetched');
            if (blob.size === record.size && await sha256(blob) === record.sha256) {
              if (record.size > LARGE) mark('hashed');
              const parsed = await parseRecord(blob);
              verdict = await putRecord(db, record.store, decKey(parsed.header.key), await decode(parsed.header.value, parsed.part));
            } else (outcome.errors = outcome.errors || []).push('damaged ' + record.sha256.slice(0, 12));
          } catch (e) { verdict = 'failed'; (outcome.errors = outcome.errors || []).push(String(e && e.message).slice(0, 120)); }
        }
        if (verdict === 'added') outcome.records++;
        if (verdict === 'exists') outcome.skipped++;
        imported.push({ record, verdict });
        if (record.size > LARGE) mark('record ' + record.store + ' ' + Math.round(record.size / 1e6) + 'MB ' + verdict);
        await idle();
      }
      const lsPart = await (await fetch(API + 'snapshot/' + snapshot.id + '/part/localstorage')).json();
      for (const [k, v] of Object.entries(lsPart.items || {})) {
        if (k.startsWith(OWN) || localStorage.getItem(k) !== null) continue;
        try { localStorage.setItem(k, v); outcome.localStorage++; } catch (e) { /* full or blocked */ }
      }
      mark('records-added');
      // Read everything back, work out the SHA-256 of what is in the stores now and tell the server.
      const found = [];
      for (const { record, verdict } of imported) {
        if (verdict !== 'added' && verdict !== 'exists') continue;
        const db = await open(record.db);
        try {
          const parsed = await (async () => {
            const store = db.transaction(record.store).objectStore(record.store);
            const key = decKey(record.key);
            const value = await wrap(store.get(key));
            return value === undefined ? null : recordFile(record.db, record.store, key, value);
          })();
          if (parsed && await sha256(parsed.blob) === record.sha256) found.push(record.sha256);
        } catch (e) { /* counted as missing */ }
        await tick();
      }
      let lsMissing = 0;
      for (const k of Object.keys(lsPart.items || {})) if (!k.startsWith(OWN) && localStorage.getItem(k) === null) lsMissing++;
      const counts = {};
      for (const { record } of imported) { const n = record.db + '/' + record.store; counts[n] = (counts[n] || 0) + 1; }
      mark('read-back');
      const report = await post('verify/' + snapshot.id, { hashes: found, counts, origin: location.origin, imported: true, local_storage_missing: lsMissing });
      outcome.imported = true;
      outcome.missing = (report.missing || 0) + lsMissing;
      outcome.verify = report;
      if (!report.ok) { outcome.reason = 'verify-failed'; sessionStorage.setItem(NOTICE, noticeText(outcome.missing || 1)); }
    } finally { for (const db of dbs.values()) if (db) db.close(); }
    return outcome;
  }

  function importIfEmpty() {
    return doImport().then(outcome => {
      state.import = outcome;
      if (outcome.reason !== 'profile-in-use' && outcome.reason !== 'not-empty') try { const { verify, ...brief } = outcome; sessionStorage.setItem(OWN + 'lastImport', JSON.stringify(Object.assign(brief, { verify: verify && { ok: verify.ok, missing: verify.missing, found: verify.found_records, expected: verify.expected_records } }))); } catch (e) { /* ignore */ }
      if (outcome.imported && (outcome.records || outcome.localStorage) && !sessionStorage.getItem(RELOADED)) {
        sessionStorage.setItem(RELOADED, '1');   // one reload, so the app's own code reads the restored drafts and settings; never a loop
        if (!options.noReload) location.reload();
      }
      return outcome;
    }, error => { state.import = { imported: false, reason: 'error', error: error.message }; try { sessionStorage.setItem(OWN + 'lastImport', JSON.stringify(state.import)); } catch (e) { /* ignore */ } return state.import; });
  }
  const options = { noReload: false };

  // A profile with nothing at all in localStorage is brand new. The app writes its own defaults while its scripts load, and an
  // import that comes later never overwrites them, so the settings of the snapshot are filled in here, before any other script
  // runs (one small synchronous request, only in such a profile). The drafts follow asynchronously in importIfEmpty().
  function earlySettings() {
    try {
      if (localStorage.length !== 0) return;
      const get = path => { const x = new XMLHttpRequest(); x.open('GET', API + path, false); x.send(); return x.status === 200 ? JSON.parse(x.responseText) : null; };
      const found = get('status');
      if (!found || !found.complete || !found.snapshot) return;
      const part = get('snapshot/' + found.snapshot.id + '/part/localstorage');
      for (const [k, v] of Object.entries((part && part.items) || {})) if (!k.startsWith(OWN) && localStorage.getItem(k) === null) localStorage.setItem(k, v);
      sessionStorage.setItem(OWN + 'earlySettings', found.snapshot.id);
    } catch (e) { /* the app starts without them */ }
  }

  function showNotice() {
    const text = sessionStorage.getItem(NOTICE);
    if (!text) return;
    sessionStorage.removeItem(NOTICE);
    let tries = 0;
    const show = () => { if (window.showToast) { window.showToast(text, true); sessionStorage.setItem(OWN + 'lastNotice', text); } else if (++tries < 40) setTimeout(show, 500); };
    show();
  }

  async function status() {
    let server = null;
    try { server = await api('status'); } catch (e) { server = { error: e.message }; }
    return { running: state.running, busy: busy(), last: state.last, lastError: state.lastError, nextAt: state.nextAt, exports: state.exports,
      import: state.import, server, timing };
  }

  // Long-task log for measuring what the export costs the page.
  try {
    new PerformanceObserver(list => { for (const e of list.getEntries()) state.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] });
  } catch (e) { /* not supported */ }

  const api2 = { exportNow, importIfEmpty, status, busy, sha256, encode, decode, encKey, decKey, recordFile, parseRecord, readLocalStorage, listDatabases,
    get state() { return state; }, set noReload(v) { options.noReload = testHooks && !!v; }, get ready() { return ready; } };
  window.PeakHourWindowSnapshot = api2;

  earlySettings();
  ready = (async () => {
    try { await importIfEmpty(); } catch (e) { /* the app works without it */ }
    try { if (!localStorage.getItem(SEEN) && !localStorage.getItem(IMPORTED) && await isEmpty() === false) localStorage.setItem(SEEN, '1'); } catch (e) { /* ignore */ }
  })();
  document.addEventListener('DOMContentLoaded', showNotice, { once: true });
  if (!(testHooks && sessionStorage.getItem(OWN + 'noauto'))) startAuto();
})();
