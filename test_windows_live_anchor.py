"""A song played in VirtualDJ must become the Playing Now anchor and reach the published Live Assist state (what
Live Assist and PEAK HOUR Mini read), on the Library tab and on the Performance tab, and a song that is already
playing when PEAK HOUR opens must be adopted. The real app runs in a sandbox with a fake VirtualDJ (home + History
m3u, running process simulated) and headless Edge over the DevTools protocol.  Set ANCHOR_DEBUG=1 for a trace."""
import os,sys,pathlib,json,time,socket,subprocess,tempfile,shutil,traceback,urllib.request
root=pathlib.Path(__file__).resolve().parent
python=root/'axiom-win-env'/'Scripts'/'python.exe'
EDGES=[r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',r'C:\Program Files\Microsoft\Edge\Application\msedge.exe']
DEBUG=bool(os.environ.get('ANCHOR_DEBUG'))
def free():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
SERVER='''
import os,sys,pathlib,json
root=pathlib.Path(sys.argv[1]);port=int(sys.argv[2]);library=json.loads(pathlib.Path(sys.argv[3]).read_text(encoding='utf-8'))
sys.path.insert(0,str(root/'axiom-win-probe'))
import axiom_windows_launcher as L
L.log_server_errors()
axiom=L.build_app(port)
pathlib.Path(axiom.CACHE_PATH).write_text(json.dumps({'tracks':library}),encoding='utf-8')
def snapshot(*names):
 if tuple(names)==('VirtualDJ',) or 'Serato DJ Pro' in names:
  return {'running':True,'token':('virtualdj:' if 'Serato DJ Pro' in names else '')+'4242','started_at':None,'pids':[4242]}
 return {'running':False,'token':'','started_at':None,'pids':[]}
axiom._mac_process_snapshot=snapshot
from werkzeug.serving import make_server
print('ready',port,flush=True)
make_server(L.HOST,port,axiom.app,threaded=True).serve_forever()
'''
CDP=r'''
const [debug,url,history,out,tabName,plan]=process.argv.slice(2);
const songs=JSON.parse(plan);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fs=await import('node:fs');
const base=new URL(url).origin;
let tab;for(let i=0;i<50&&!tab;i++){try{tab=(await (await fetch(`http://127.0.0.1:${debug}/json`)).json()).find(t=>t.type==='page');}catch(e){}if(!tab)await sleep(200);}
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const wait=new Map();let loaded=null;
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id);}if(m.method==='Page.loadEventFired'&&loaded)loaded();};
const send=(method,params={})=>new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)return {error:JSON.stringify(r.result.exceptionDetails).slice(0,300)};return r.result.result.value;};
const until=async(expr,seconds)=>{const end=Date.now()+seconds*1000;while(Date.now()<end){if(await ev(expr)===true)return true;await sleep(300);}return false;};
const published=async()=>{try{const s=await (await fetch(base+'/api/performance/live_assist/state')).json();return {anchor:s.anchor&&s.anchor.title,bpm:s.anchor&&s.anchor.bpm,n:(s.suggestions||[]).length,sug:(s.suggestions||[]).slice(0,3).map(x=>x.title+'@'+x.bpm)};}catch(e){return {error:String(e)};}};
const pageState="({auto:performanceSeratoEnabled,perfHidden:document.getElementById('tab-content-performance').classList.contains('hidden'),anchor:performanceAnchorTrack&&performanceAnchorTrack.title||null,last:performanceSeratoLastTrack&&performanceSeratoLastTrack.title||null,sugg:performanceSuggestions.length})";
const result={steps:[]};
await send('Page.enable');await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument',{source:`(function(){const f=window.fetch;window.__live=[];window.fetch=async function(u,o){const r=await f.apply(this,arguments);try{if(String(u).includes('/api/performance/dj/live')){const c=r.clone();c.json().then(d=>window.__live.push({t:Date.now(),fresh:d.fresh_event,ev:d.event_id,tok:d.dj_session_token,title:d.track&&d.track.title,prov:d.provider,ok:d.success}));}}catch(e){}return r;};})();`});
const done=new Promise(r=>loaded=r);await send('Page.navigate',{url});await done;await sleep(3500);
result.ready=await ev("typeof performancePollSeratoBridge==='function'&&typeof performanceSeratoEnabled==='boolean'");
await ev(`showTab(${JSON.stringify(tabName)})`);
result.autoOn=await until("performanceSeratoEnabled===true",8);
result.start=await ev(pageState);
result.startPublished=await published();
for(const song of songs){
 if(song.append){const when=Math.floor(Date.now()/1000)-(song.ago||0);fs.appendFileSync(history,`#EXTVDJ:<time>22:10</time><lastplaytime>${when}</lastplaytime><artist>${song.artist}</artist><title>${song.title}</title><songlength>202.7</songlength>\n${song.path}\n`);}
 if(song.steal)await fetch(base+'/api/performance/dj/live');  // another reader takes the one-shot fresh event first
 const t0=Date.now();
 const ok=await until(`!!performanceAnchorTrack&&performanceAnchorTrack.title===${JSON.stringify(song.title)}`,14);
 const okPub=ok&&await (async()=>{const end=Date.now()+10000;while(Date.now()<end){const p=await published();if(p.anchor===song.title&&p.n>0)return p;await sleep(400);}return false;})();
 result.steps.push({song:song.title,anchored:ok,secs:(Date.now()-t0)/1000,page:await ev(pageState),published:okPub||await published()});
}
result.live=await ev("window.__live.slice(-8)");
fs.writeFileSync(out,JSON.stringify(result));
ws.close();process.exit(0);
'''
def library(music):
 rows=[]
 for n,(artist,title,bpm) in enumerate([('Hugh Dub','Foe Life',91.0),('Tara Fox','Slow Burn',90.0),('Mike Ray','Easy Does It',93.0),('Lena Lane','Evening Glow',89.0),
                                        ('Dex Dove','Soft Landing',92.0),('Ivy Reed','Late Lights',94.0),('Ned Ash','Back Porch',88.0),('Jo Pike','Fast Car',128.0)]):
  path=music/f'{artist} - {title}.mp4';path.write_bytes((b'\xff\xfb\x90\x00'+bytes(413))*40)
  rows.append({'path':str(path),'filename':path.name,'title':title,'artist':artist,'album':'','bpm':bpm,'key':'8A','camelot':'8A','energy':'Mid','genre':'Hip Hop','year':1999,'duration':200.0,'bpm_source':'axiom'})
 return rows
def run(edge,tab,startup):
 """One sandbox, one page on `tab`. startup: a song already in history when the page opens."""
 base=root/'fixtures';base.mkdir(exist_ok=True)
 sandbox=pathlib.Path(tempfile.mkdtemp(dir=base,prefix='live-anchor-'))
 procs=[]
 try:
  local=sandbox/'AppData'/'Local';home=local/'VirtualDJ';(home/'History').mkdir(parents=True);(sandbox/'profile').mkdir();music=sandbox/'Music';music.mkdir()
  (home/'settings.xml').write_text('<?xml version="1.0"?><VirtualDJ_Settings/>',encoding='utf-8')
  rows=library(music);(sandbox/'library.json').write_text(json.dumps(rows),encoding='utf-8')
  history=home/'History'/(time.strftime('%Y-%m-%d')+'.m3u')
  def entry(row,seconds_ago):return f"#EXTVDJ:<time>22:00</time><lastplaytime>{int(time.time())-seconds_ago}</lastplaytime><artist>{row['artist']}</artist><title>{row['title']}</title><songlength>240.0</songlength>\n{row['path']}\n"
  history.write_text(entry(rows[7],900)+(entry(rows[0],30) if startup else ''),encoding='utf-8')
  plan=([{'title':rows[0]['title'],'append':False}] if startup else [])+[{'title':r['title'],'artist':r['artist'],'path':r['path'],'append':True} for r in (rows[1],rows[2])]+[{'title':rows[3]['title'],'artist':rows[3]['artist'],'path':rows[3]['path'],'append':True,'steal':True},
                                                                                                          {'title':rows[4]['title'],'artist':rows[4]['artist'],'path':rows[4]['path'],'append':True,'ago':90}]
  (sandbox/'server.py').write_text(SERVER,encoding='utf-8');(sandbox/'cdp.mjs').write_text(CDP,encoding='utf-8')
  port,debug=free(),free()
  env=dict(os.environ,LOCALAPPDATA=str(local),USERPROFILE=str(sandbox),AXIOM_RUNTIME_DIR=str(local/'AXIOM DJ'),AXIOM_NO_OPEN='1')
  env.pop('AXIOM_HUB',None)
  procs.append(subprocess.Popen([str(python),str(sandbox/'server.py'),str(root),str(port),str(sandbox/'library.json')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
  deadline=time.monotonic()+90
  while time.monotonic()<deadline:
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=3) as r:
     if r.status==200:break
   except OSError:time.sleep(0.4)
  else:raise AssertionError('server did not start')
  procs.append(subprocess.Popen([edge,'--headless=new',f'--remote-debugging-port={debug}',f'--user-data-dir={sandbox/"profile"}','--no-first-run','--no-default-browser-check','--window-size=1400,900','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
  out=sandbox/'result.json'
  node=subprocess.run(['node',str(sandbox/'cdp.mjs'),str(debug),f'http://127.0.0.1:{port}/',str(history),str(out),tab,json.dumps(plan)],capture_output=True,text=True,timeout=240)
  assert out.is_file(),('node failed',node.stdout[-800:],node.stderr[-800:])
  r=json.loads(out.read_text(encoding='utf-8'))
  if DEBUG:print(tab,'startup' if startup else '',json.dumps(r,indent=1))
  return r
 finally:
  for p in reversed(procs):p.terminate()
  for p in procs:
   try:p.wait(10)
   except Exception:p.kill()
  shutil.rmtree(sandbox,ignore_errors=True)
def check(tab,startup,r):
 where=f'{tab} tab{", song already playing" if startup else ""}'
 assert r['ready'] is True and r['autoOn'],(where,r)
 for step in r['steps']:
  assert step['anchored'],(where,'the song never became the Playing Now anchor',step,r['live'])
  assert step['published'] and step['published']['anchor']==step['song'],(where,'Live Assist state did not follow',step)
  assert step['published']['n']>0,(where,'no suggestions published',step)
  assert step['secs']<12,(where,'too slow',step)
def main():
 edge=next((e for e in EDGES if os.path.isfile(e)),None)
 assert edge,'Edge not installed'
 for tab,startup in [c for c in (('library',False),('performance',False),('library',True)) if not os.environ.get('ANCHOR_ONLY') or os.environ['ANCHOR_ONLY']==c[0]+str(c[1])]:
  check(tab,startup,run(edge,tab,startup));print('ok:',tab,'startup' if startup else 'new song')
 print('PASS: a new VirtualDJ song becomes the Playing Now anchor and the published Live Assist state, on Library and Performance, and a song already playing is adopted')
try:main()
except BaseException:
 traceback.print_exc();sys.exit(1)
