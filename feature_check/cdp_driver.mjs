// Drives one Edge/Chrome tab over the DevTools protocol (node's built-in WebSocket; no packages).
//
//   node cdp_driver.mjs <debugPort> --serve              one JSON request per stdin line, one JSON reply per stdout line
//   node cdp_driver.mjs <debugPort> <job.json|-> [out]   one job {base, steps:[...]} from a file or stdin; reply to out or stdout
//
// A request is {"id":1,"base":"http://127.0.0.1:8080/","steps":[{"op":"navigate","url":"/"}, ...]}.
// Steps (all optional fields in brackets; "as" stores the step's value under vars[as]):
//   navigate {url, [settle=1500 ms], [timeout=60]}      load a page and wait for the load event
//   eval {expr, [as]}                                    Runtime.evaluate (awaits promises); value is the result
//   until {expr, [timeout=10], [as]}                     poll until the expression is truthy; ok=false on timeout; seconds = time taken
//   click_text {text, [within], [exact=true], [tags], [timeout=5], [force], [allow_disabled]}
//                                                       real mouse click on the visible button/link with that text
//   click {selector, [index=0], [text], [timeout=5], [force], [allow_disabled]}
//   type {selector, text, [clear], [keys=true], [mutation_selector], [settle_ms=300]}
//                                                       keystrokes; with mutation_selector it measures first/last DOM change
//   press {key}                                          Escape, Enter, Tab ...
//   sleep {seconds}
//   screenshot {path}
//   stub_dialogs {}                                      prompt/alert/confirm are recorded, never block (prompt -> null, confirm -> false)
//   collect_network {[clear], [filter]}                  value = responses seen since the last clear (status, url, ms); turns recording on
//   collect_errors {[clear]}                             value = uncaught exceptions + console errors; turns recording on
//   longtasks {seconds, [as]}                            main-thread tasks > 50 ms seen for N seconds
//   region_colors {box:[l,t,r,b]}                        the colours really drawn in that box (biggest first, with their share)
//   probe_click {selector|text..., [wait_ms=2000], [recover=true]}
//                                                       click, then report whether anything changed (DOM, network, dialog, URL)
// Reply: {id, ok, steps:[{op, ok, seconds, value?, error?}], vars, network, errors, dialogs, shots}
// network/errors/dialogs are what arrived during this request, once recording was switched on.
import fs from 'node:fs';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const [debug, mode, outArg] = process.argv.slice(2);
if (!debug) { console.error('usage: node cdp_driver.mjs <debugPort> --serve | <job.json> [out.json]'); process.exit(2); }

// ------------------------------------------------------------------ connection
async function findTab() {
  for (let i = 0; i < 100; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${debug}/json`)).json();
      const tab = tabs.find(t => t.type === 'page');
      if (tab) return tab;
    } catch (e) { /* browser still starting */ }
    await sleep(200);
  }
  throw new Error('no browser tab on debug port ' + debug);
}
const tab = await findTab();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket failed')); });
let nextId = 0;
const pending = new Map();
const listeners = [];
let closed = false;
ws.onclose = () => { closed = true; for (const [, p] of pending) p({ error: { message: 'browser closed' } }); pending.clear(); };
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method) for (const l of listeners) l(m);
};
const send = (method, params = {}) => new Promise(resolve => {
  if (closed) return resolve({ error: { message: 'browser closed' } });
  const id = ++nextId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const waitEvent = (name, ms) => new Promise(res => {
  const t = setTimeout(() => { remove(); res(false); }, ms);
  const fn = m => { if (m.method === name) { clearTimeout(t); remove(); res(true); } };
  const remove = () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  listeners.push(fn);
});

// ------------------------------------------------------------------ recorders (live for the whole session)
const rec = { network: [], errors: [], dialogs: [], netOn: false, errOn: false, dlgOn: false, netCount: 0, dlgCount: 0 };
const reqs = new Map();
listeners.push(m => {
  const p = m.params || {};
  if (m.method === 'Network.requestWillBeSent') reqs.set(p.requestId, { url: p.request.url, method: p.request.method, t: p.timestamp });
  else if (m.method === 'Network.responseReceived') {
    const r = reqs.get(p.requestId) || { url: p.response.url, t: p.timestamp };
    r.status = p.response.status; r.type = p.type; r.mime = p.response.mimeType; r.respT = p.timestamp;
    reqs.set(p.requestId, r);
  } else if (m.method === 'Network.loadingFinished') {
    const r = reqs.get(p.requestId);
    if (r && r.status !== undefined) {
      if (!r.url.startsWith('data:')) { rec.network.push({ url: r.url, method: r.method, status: r.status, type: r.type, ms: Math.round((p.timestamp - r.t) * 1000), at: Date.now() }); rec.netCount++; }
      reqs.delete(p.requestId);
    }
  } else if (m.method === 'Network.loadingFailed') {
    const r = reqs.get(p.requestId);
    if (r && !p.canceled) { rec.network.push({ url: r.url, method: r.method, status: 0, type: r.type, error: p.errorText, ms: Math.round((p.timestamp - r.t) * 1000), at: Date.now() }); rec.netCount++; }
    reqs.delete(p.requestId);
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = p.exceptionDetails || {};
    rec.errors.push({ kind: 'exception', text: (d.exception && (d.exception.description || d.exception.value)) || d.text, url: d.url, line: d.lineNumber, at: Date.now() });
  } else if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
    rec.errors.push({ kind: 'console', text: (p.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 500), at: Date.now() });
  } else if (m.method === 'Log.entryAdded' && p.entry.level === 'error') {
    rec.errors.push({ kind: 'resource', text: String(p.entry.text).slice(0, 300), url: p.entry.url, at: Date.now() });
  } else if (m.method === 'Runtime.bindingCalled' && p.name === 'fcDialog') {
    try { rec.dialogs.push({ ...JSON.parse(p.payload), at: Date.now() }); rec.dlgCount++; } catch (e) { /* ignore */ }
  } else if (m.method === 'Page.javascriptDialogOpening') {
    rec.dialogs.push({ kind: p.type, text: p.message, native: true, at: Date.now() }); rec.dlgCount++;
    send('Page.handleJavaScriptDialog', { accept: false });
  }
});

const DIALOG_STUB = `(()=>{if(window.__fcDialogsStubbed)return;window.__fcDialogsStubbed=true;
const note=(kind,args)=>{try{window.fcDialog(JSON.stringify({kind,text:String(args[0]==null?'':args[0]).slice(0,600),stack:(new Error().stack||'').split('\\n').slice(2,5).join(' | ')}))}catch(e){}};
window.alert=(...a)=>{note('alert',a)};window.confirm=(...a)=>{note('confirm',a);return false};window.prompt=(...a)=>{note('prompt',a);return null};})();`;

// The page helpers: one object per document, rebuilt after every navigation by ensureHelpers().
const HELPERS = `(()=>{if(window.__fc)return true;const fc=window.__fc={};
fc.visible=el=>{if(!el||!el.getClientRects().length)return false;const s=getComputedStyle(el);if(s.visibility==='hidden'||s.display==='none')return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0;};
fc.label=el=>((el.innerText||el.textContent||el.value||el.getAttribute('aria-label')||el.title||'')+'').replace(/\\s+/g,' ').trim();
fc.describe=el=>el?(el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\\s+/).slice(0,3).join('.'):'')+' "'+fc.label(el).slice(0,40)+'"'):'nothing';
fc.opacity=el=>{let o=1;for(let e=el;e&&e.nodeType===1;e=e.parentElement)o*=+getComputedStyle(e).opacity;return o;};
fc.disabled=el=>el.disabled===true||el.getAttribute('aria-disabled')==='true'||!!el.closest('fieldset:disabled');
fc.find=spec=>{
 let root=document;if(spec.within){root=document.querySelector(spec.within);if(!root)return null;}
 let list;
 if(spec.text!==undefined&&!spec.selector){list=[...root.querySelectorAll(spec.tags||'button,a,[role=button],[role=menuitem],[role=tab],summary,input[type=button],input[type=submit]')];}
 else list=[...root.querySelectorAll(spec.selector)];
 if(spec.text!==undefined){const want=String(spec.text).trim().toLowerCase();const exact=spec.exact!==false;
  list=list.filter(el=>{const t=fc.label(el).toLowerCase();return exact?t===want:t.includes(want);});}
 list=list.filter(fc.visible);
 return list[spec.index||0]||null;};
fc.aim=spec=>{const el=fc.find(spec);if(!el)return {found:false};window.__fcEl=el;
 el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
 for(let p=el.parentElement;p;p=p.parentElement){const oy=getComputedStyle(p).overflowY;if((oy==='auto'||oy==='scroll')&&p.scrollHeight>p.clientHeight){const pr=p.getBoundingClientRect(),er=el.getBoundingClientRect();
  if(er.top<pr.top||er.bottom>pr.bottom)p.scrollTop+=(er.top+er.height/2)-(pr.top+pr.height/2);}}
 const r=el.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;
 const top=document.elementFromPoint(x,y);const covered=!(top&&(top===el||el.contains(top)||top.contains(el)));
 return {found:true,x,y,covered,coveredBy:covered?fc.describe(top):'',opacity:fc.opacity(el),disabled:fc.disabled(el),label:fc.label(el).slice(0,80),tag:el.tagName.toLowerCase()};};
fc.mut={count:0,noise:new WeakSet(),learning:false,fresh:0};
new MutationObserver(list=>{for(const m of list){const el=m.target.nodeType===1?m.target:m.target.parentElement;fc.mut.count++;
 if(fc.mut.learning){if(el)fc.mut.noise.add(el);}else if(!el||!fc.mut.noise.has(el))fc.mut.fresh++;}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
fc.long=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries())fc.long.push({start:Math.round(e.startTime),ms:Math.round(e.duration)})}).observe({type:'longtask',buffered:true});}catch(e){}
return true;})()`;

async function ev(expression, { timeout = 60000 } = {}) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
    sleep(timeout).then(() => ({ error: { message: 'evaluate timed out' } })),
  ]);
  if (r.error) return { error: r.error.message };
  if (r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    return { error: ((d.exception && d.exception.description) || d.text || 'exception').toString().split('\n')[0].slice(0, 300) };
  }
  return { value: r.result.result.value };
}
async function ensureHelpers() { await ev(HELPERS); }
const J = x => JSON.stringify(x);

// ------------------------------------------------------------------ input
async function mouseClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
const KEYS = { Escape: { code: 'Escape', vk: 27 }, Enter: { code: 'Enter', vk: 13, text: '\r' }, Tab: { code: 'Tab', vk: 9 }, Backspace: { code: 'Backspace', vk: 8 }, ArrowDown: { code: 'ArrowDown', vk: 40 } };
async function pressKey(key) {
  const k = KEYS[key] || { code: key, vk: 0 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: k.code, windowsVirtualKeyCode: k.vk, text: k.text });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: k.code, windowsVirtualKeyCode: k.vk });
}

// Find the element, wait for it to show up, hit-test it (is something on top?), then click it with the mouse.
async function aimAt(spec) {
  const t0 = Date.now(), end = t0 + (spec.timeout ?? 5) * 1000;
  let a = { found: false };
  while (Date.now() < end) {
    await ensureHelpers();
    const r = await ev(`__fc.aim(${J(spec)})`);
    a = r.value || { found: false, error: r.error };
    // content that fades in when scrolled into view: wait for it, as a person would
    if (a.found && a.opacity < 0.3 && Date.now() < Math.min(end, t0 + 3000)) { await sleep(150); continue; }
    if (a.found && a.covered && !spec.force && Date.now() < end) { await sleep(150); continue; }   // an opening panel or a fading overlay
    if (a.found && !a.disabled) break;
    if (a.found && a.disabled && spec.allow_disabled) break;
    await sleep(150);
  }
  return a;
}
async function clickStep(spec) {
  const a = await aimAt(spec);
  const what = spec.text !== undefined ? `"${spec.text}"` : spec.selector;
  if (!a.found) return { ok: false, error: `not found or not visible: ${what}${a.error ? ' (' + a.error + ')' : ''}` };
  if (a.disabled && !spec.allow_disabled) return { ok: false, error: `disabled: ${what}`, label: a.label };
  if (a.covered && !spec.force) return { ok: false, error: `covered by ${a.coveredBy}: ${what}`, label: a.label, covered: true };
  if (a.covered && spec.force) { await ev('window.__fcEl.click()'); return { ok: true, label: a.label, forced: true }; }
  await mouseClick(a.x, a.y);
  return { ok: true, label: a.label };
}

// ------------------------------------------------------------------ steps
const PATTERNS = '/Volumes|Finder|⌘|Mac App Store|macOS';
async function runStep(step, base) {
  const t0 = Date.now();
  const out = { op: step.op, ok: true };
  try {
    switch (step.op) {
      case 'navigate': {
        const url = /^https?:|^about:/.test(step.url) ? step.url : new URL(step.url, base).href;
        await send('Page.enable');
        const loaded = waitEvent('Page.loadEventFired', (step.timeout ?? 60) * 1000);
        const r = await send('Page.navigate', { url });
        if (r.error || (r.result && r.result.errorText)) { out.ok = false; out.error = (r.error && r.error.message) || r.result.errorText; break; }
        if (!(await loaded)) { out.ok = false; out.error = 'load event timed out'; }
        await sleep(step.settle ?? 1500);
        await ensureHelpers();
        break;
      }
      case 'eval': {
        const r = await ev(step.expr, { timeout: (step.timeout ?? 60) * 1000 });
        if (r.error) { out.ok = false; out.error = r.error; } else out.value = r.value;
        break;
      }
      case 'until': {
        const end = Date.now() + (step.timeout ?? 10) * 1000;
        let last;
        out.ok = false;
        while (Date.now() < end) {
          last = await ev(step.expr);
          if (last.value) { out.ok = true; out.value = last.value; break; }
          await sleep(step.interval ?? 200);
        }
        if (!out.ok) out.error = `not true within ${step.timeout ?? 10}s` + (last && last.error ? ` (${last.error})` : '');
        break;
      }
      case 'click_text': Object.assign(out, await clickStep(step)); break;
      case 'click': Object.assign(out, await clickStep(step)); break;
      case 'press': await pressKey(step.key); break;
      case 'sleep': await sleep((step.seconds ?? 1) * 1000); break;
      case 'type': {
        const a = await aimAt({ selector: step.selector, timeout: step.timeout });
        if (!a.found) { out.ok = false; out.error = 'not found: ' + step.selector; break; }
        await ev(`(()=>{const el=window.__fcEl;el.focus();${step.clear ? "const set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set;set.call(el,'');el.dispatchEvent(new Event('input',{bubbles:true}));" : ''}
          window.__fcMutT=[];if(${J(step.mutation_selector || '')}){const t=document.querySelector(${J(step.mutation_selector || 'body')});if(t){window.__fcMutObs&&window.__fcMutObs.disconnect();
          window.__fcMutObs=new MutationObserver(()=>window.__fcMutT.push(performance.now()));window.__fcMutObs.observe(t,{subtree:true,childList:true,characterData:true,attributes:true});}}
          window.__fcLongStart=__fc.long.length;window.__fcTypeStart=performance.now();})()`);
        const start = Date.now();
        for (const ch of String(step.text)) {
          if (step.keys === false) { await send('Input.insertText', { text: ch }); continue; }
          await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
          await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
        }
        out.typing_ms = Date.now() - start;
        if (step.mutation_selector) {
          const quiet = step.settle_ms ?? 300, limit = Date.now() + (step.timeout_ms ?? 8000);
          let m;
          while (Date.now() < limit) {
            await sleep(100);
            m = (await ev('({t:window.__fcMutT||[],now:performance.now(),s:window.__fcTypeStart})')).value;
            if (m && m.t.length && m.now - m.t[m.t.length - 1] > quiet) break;
          }
          out.first_mutation_ms = m && m.t.length ? Math.round(m.t[0] - m.s) : null;
          out.last_mutation_ms = m && m.t.length ? Math.round(m.t[m.t.length - 1] - m.s) : null;
          out.mutations = m ? m.t.length : 0;
          const lt = (await ev('__fc.long.slice(window.__fcLongStart||0)')).value || [];
          out.longtask_ms = lt.reduce((mx, x) => Math.max(mx, x.ms), 0);
        }
        break;
      }
      case 'screenshot': {
        const r = await send('Page.captureScreenshot', { format: 'png' });
        if (r.error || !r.result) { out.ok = false; out.error = (r.error && r.error.message) || 'no image'; break; }
        fs.mkdirSync(path.dirname(step.path), { recursive: true });
        fs.writeFileSync(step.path, Buffer.from(r.result.data, 'base64'));
        out.value = step.path; shots.push(step.path);
        break;
      }
      case 'downloads': {   // a download goes to this folder (never the user's Downloads)
        fs.mkdirSync(step.path, { recursive: true });
        const r = await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: step.path });
        if (r.error) { out.ok = false; out.error = r.error.message; }
        // the whole browser too (popups and new tabs): the browser target has its own websocket
        try {
          const version = await (await fetch(`http://127.0.0.1:${debug}/json/version`)).json();
          const bws = new WebSocket(version.webSocketDebuggerUrl);
          await new Promise((res, rej) => { bws.onopen = res; bws.onerror = () => rej(new Error('browser socket')); });
          const answer = new Promise(res => { bws.onmessage = e => res(JSON.parse(e.data)); });
          bws.send(JSON.stringify({ id: 1, method: 'Browser.setDownloadBehavior', params: { behavior: 'allow', downloadPath: step.path } }));
          out.browser_level = !(await answer).error;
          bws.close();
        } catch (e) { out.browser_level = false; }
        break;
      }
      case 'stub_dialogs': {
        await send('Page.enable'); await send('Runtime.enable');
        await send('Runtime.addBinding', { name: 'fcDialog' });
        await send('Page.addScriptToEvaluateOnNewDocument', { source: DIALOG_STUB });
        await ev(DIALOG_STUB);
        rec.dlgOn = true;
        break;
      }
      case 'collect_network': {
        if (!rec.netOn) { await send('Network.enable'); rec.netOn = true; }
        const re = step.filter ? new RegExp(step.filter) : null;
        out.value = rec.network.filter(n => !re || re.test(n.url));
        if (step.clear) rec.network = [];
        break;
      }
      case 'collect_errors': {
        await send('Runtime.enable'); await send('Log.enable'); rec.errOn = true;
        out.value = rec.errors.slice();
        if (step.clear) rec.errors = [];
        break;
      }
      case 'longtasks': {
        await ensureHelpers();
        const from = (await ev('__fc.long.length')).value || 0;
        await sleep((step.seconds ?? 5) * 1000);
        const list = (await ev(`__fc.long.slice(${from})`)).value || [];
        out.value = list; out.max_ms = list.reduce((mx, x) => Math.max(mx, x.ms), 0);
        break;
      }
      case 'region_colors': {   // the colours really drawn in a box [left, top, right, bottom]: {color:[r,g,b], share}
        const [l, t, r, b] = step.box;
        const shotReply = await send('Page.captureScreenshot', { format: 'png', clip: { x: l, y: t, width: Math.max(1, r - l), height: Math.max(1, b - t), scale: 1 } });
        if (shotReply.error || !shotReply.result) { out.ok = false; out.error = (shotReply.error && shotReply.error.message) || 'no image'; break; }
        const url = 'data:image/png;base64,' + shotReply.result.data;
        const res = await ev(`(async()=>{const img=new Image();img.src=${J(url)};await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
          const g=c.getContext('2d');g.drawImage(img,0,0);const d=g.getImageData(0,0,c.width,c.height).data;const h=new Map();const n=d.length/4;
          for(let i=0;i<d.length;i+=4){const k=(d[i]>>3)+','+(d[i+1]>>3)+','+(d[i+2]>>3);const e=h.get(k)||{n:0,r:0,g:0,b:0};e.n++;e.r+=d[i];e.g+=d[i+1];e.b+=d[i+2];h.set(k,e);}
          return [...h.values()].sort((a,b)=>b.n-a.n).slice(0,4).map(e=>({color:[Math.round(e.r/e.n),Math.round(e.g/e.n),Math.round(e.b/e.n)],share:Math.round(e.n/n*100)/100}));})()`);
        if (res.error) { out.ok = false; out.error = res.error; } else out.value = res.value;
        break;
      }
      case 'probe_click': {
        out.ok = true;
        await ensureHelpers();
        // learn which parts of the page change on their own (clocks, meters, polls)
        await ev('(()=>{const m=__fc.mut;m.noise=new WeakSet();m.learning=true;})()');
        await sleep(step.noise_ms ?? 400);
        const before = (await ev(`({url:location.href,mods:document.querySelectorAll('dialog[open],[role=dialog]').length})`)).value || {};
        await ev('(()=>{const m=__fc.mut;m.learning=false;m.fresh=0;})()');
        const n0 = rec.netCount, d0 = rec.dlgCount, e0 = rec.errors.length, dStart = rec.dialogs.length;
        const c = await clickStep(step);
        Object.assign(out, c);
        if (!c.ok) break;
        const end = Date.now() + (step.wait_ms ?? 2000);
        let changed = false, fresh = 0;
        while (Date.now() < end) {
          await sleep(100);
          fresh = (await ev('__fc.mut.fresh')).value || 0;
          const now = (await ev('({url:location.href,mods:document.querySelectorAll("dialog[open],[role=dialog]").length})')).value || {};
          if (fresh > 0 || rec.netCount > n0 || rec.dlgCount > d0 || now.url !== before.url || now.mods !== before.mods) { changed = true; break; }
        }
        await sleep(step.after_ms ?? 400);
        out.changed = changed;
        out.dialogs = rec.dialogs.slice(dStart);
        out.new_errors = rec.errors.slice(e0).filter(e => e.kind !== 'resource');
        out.hits = (await ev(`(()=>{const re=new RegExp(${J(step.patterns || PATTERNS)},'g');const t=document.body.innerText||'';const out=[];let m;
          while((m=re.exec(t))&&out.length<6){out.push({match:m[0],context:t.slice(Math.max(0,m.index-50),m.index+60).replace(/\\s+/g,' ')});}return out;})()`)).value || [];
        if (step.recover !== false) {
          out.recovered = [];
          if ((await ev('location.href')).value !== before.url) { await send('Page.navigate', { url: before.url }); await sleep(2500); out.recovered.push('navigated back'); }
          for (let i = 0; i < 3; i++) {
            const open = (await ev('[...document.querySelectorAll("dialog[open],[role=dialog]")].filter(__fc.visible).length')).value;
            if (!open || open <= (before.mods || 0)) break;
            await pressKey('Escape'); await sleep(250);
            const still = (await ev('[...document.querySelectorAll("dialog[open],[role=dialog]")].filter(__fc.visible).length')).value;
            if (!still || still <= (before.mods || 0)) { out.recovered.push('escape'); break; }
            const closer = await ev(`(()=>{const d=[...document.querySelectorAll("dialog[open],[role=dialog]")].filter(__fc.visible).pop();if(!d)return null;
              const b=[...d.querySelectorAll('button,a,[role=button]')].filter(__fc.visible).find(x=>/^(close|cancel|done|got it|not now|dismiss|no thanks|x|\\u00d7|ok|back)$/i.test(__fc.label(x)));
              if(!b)return null;b.click();return __fc.label(b);})()`);
            if (closer.value) out.recovered.push('closed with ' + closer.value);
            await sleep(250);
          }
        }
        break;
      }
      default: out.ok = false; out.error = 'unknown op ' + step.op;
    }
  } catch (e) { out.ok = false; out.error = String(e && e.message || e); }
  out.seconds = Math.round((Date.now() - t0)) / 1000;
  return out;
}

let shots = [];
async function handle(req) {
  const marks = { net: rec.network.length, err: rec.errors.length, dlg: rec.dialogs.length };
  shots = [];
  const steps = [], vars = {};
  let ok = true;
  for (const step of req.steps || []) {
    const r = await runStep(step, req.base || 'about:blank');
    if (step.as && r.value !== undefined) vars[step.as] = r.value;
    if (step.quiet && r.value !== undefined && step.op !== 'until') delete r.value;
    steps.push(r);
    if (!r.ok) { ok = false; if (step.required) break; }
  }
  // the buffers can be cleared inside the request by collect_*; slice only if still longer than the mark
  const tail = (list, from) => list.slice(Math.min(from, list.length));
  return { id: req.id, ok, steps, vars, network: tail(rec.network, marks.net), errors: tail(rec.errors, marks.err), dialogs: tail(rec.dialogs, marks.dlg), shots };
}

await send('Page.enable'); await send('Runtime.enable');
if (mode === '--serve') {
  process.stdin.setEncoding('utf8');
  let buf = '', chain = Promise.resolve();
  process.stdin.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      chain = chain.then(async () => {
        let reply;
        try { reply = await handle(JSON.parse(line)); } catch (e) { reply = { ok: false, error: String(e && e.message || e), steps: [] }; }
        process.stdout.write(JSON.stringify(reply) + '\n');
      });
    }
  });
  process.stdin.on('end', () => chain.then(() => process.exit(0)));
  ws.onclose = () => process.exit(0);
} else {
  const job = JSON.parse(mode === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(mode, 'utf8'));
  const reply = await handle(job);
  const text = JSON.stringify(reply, null, 1);
  if (outArg) fs.writeFileSync(outArg, text); else console.log(text);
  ws.close(); process.exit(reply.ok ? 0 : 1);
}
