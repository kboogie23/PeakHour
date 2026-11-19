"""PEAK HOUR follows the DJ software on its own (windows-live-watch.js): the real app runs in a sandbox with a fake
VirtualDJ (home + History m3u, running process simulated), headless Edge loads the page over the DevTools protocol
and stays on the Library tab. DJ Auto must switch itself on, a song added to VirtualDJ's history must reach the
page while Performance is hidden, and a user who switches DJ Auto off keeps it off after a reload."""
import os,sys,pathlib,json,time,socket,subprocess,tempfile,shutil,traceback,urllib.request
root=pathlib.Path(__file__).resolve().parent
python=root/'axiom-win-env'/'Scripts'/'python.exe'
EDGES=[r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',r'C:\Program Files\Microsoft\Edge\Application\msedge.exe']
def free():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
SERVER='''
import os,sys,pathlib
root=pathlib.Path(sys.argv[1]);port=int(sys.argv[2])
sys.path.insert(0,str(root/'axiom-win-probe'))
import axiom_windows_launcher as L
L.log_server_errors()
axiom=L.build_app(port)
def snapshot(*names):  # only VirtualDJ is running (it is served through the Serato slot, as on the real PC)
 if tuple(names)==('VirtualDJ',) or 'Serato DJ Pro' in names:
  return {'running':True,'token':('virtualdj:' if 'Serato DJ Pro' in names else '')+'4242','started_at':None,'pids':[4242]}
 return {'running':False,'token':'','started_at':None,'pids':[]}
axiom._mac_process_snapshot=snapshot
import windows_live_assist_mini
windows_live_assist_mini.TITLE='PEAK HOUR Mini (test, never matches a real window)'  # the owner's own Mini must not count
marker=pathlib.Path(sys.argv[3]);requests_file=pathlib.Path(sys.argv[4])
L.open_live_assist_mini=lambda url:marker.open('a').write(url+'\\n')  # never start a real window; record each time the opener runs
import flask
@axiom.app.before_request
def record_mini_requests():  # what the page SENT: one line per automatic open request, whether or not the opener then runs
 if flask.request.path=='/api/windows/live-assist-mini/open' and (flask.request.get_json(silent=True) or {}).get('auto'):requests_file.open('a').write('auto\\n')
from werkzeug.serving import make_server
print('ready',port,flush=True)
make_server(L.HOST,port,axiom.app,threaded=True).serve_forever()
'''
CDP=r'''
const [debug,url,history,out,marker,requestsFile]=process.argv.slice(2);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fs=await import('node:fs');
const count=f=>fs.existsSync(f)?fs.readFileSync(f,'utf8').split('\n').filter(Boolean).length:0;
const opens=()=>count(marker),requests=()=>count(requestsFile);  // opens: the opener ran (a window was started); requests: auto requests the page sent
let tab;for(let i=0;i<50&&!tab;i++){try{tab=(await (await fetch(`http://127.0.0.1:${debug}/json`)).json()).find(t=>t.type==='page');}catch(e){}if(!tab)await sleep(200);}
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const wait=new Map();let loaded=null;
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id);}if(m.method==='Page.loadEventFired'&&loaded)loaded();};
const send=(method,params={})=>new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)return {error:JSON.stringify(r.result.exceptionDetails).slice(0,300)};return r.result.result.value;};
const load=async()=>{const done=new Promise(r=>loaded=r);await send('Page.navigate',{url});await done;await sleep(3500);};
const until=async(expr,seconds)=>{const end=Date.now()+seconds*1000;while(Date.now()<end){if(await ev(expr)===true)return true;await sleep(300);}return false;};
const state="({auto:performanceSeratoEnabled,button:document.getElementById('performance-serato-toggle')?.textContent,perfHidden:document.getElementById('tab-content-performance').classList.contains('hidden'),docHidden:document.hidden,last:performanceSeratoLastTrack?.title||null,stored:localStorage.getItem('peakHourDjAutoUser')})";
const result={};
await send('Page.enable');await send('Runtime.enable');
await load();
result.ready=await ev("typeof performancePollSeratoBridge==='function'&&typeof performanceSeratoEnabled==='boolean'");
await ev("typeof showTab==='function'&&showTab('library')");
result.autoOn=await until("performanceSeratoEnabled===true",8);
result.first=await ev(state);
result.firstSeen=await until("performanceSeratoLastTrack?.title==='Cruel Summer'",10);
for(let i=0;i<25&&requests()<1;i++)await sleep(200);
result.requestsAfterFirst=requests();result.opensAfterFirst=opens();
const when=Math.floor(Date.now()/1000);
fs.appendFileSync(history,`#EXTVDJ:<time>22:10</time><lastplaytime>${when}</lastplaytime><artist>Bee Gees</artist><title>Night Fever</title><songlength>202.7</songlength>\nC:\\Music\\Bee Gees - Night Fever.mp3\n`);
result.followed=await until("performanceSeratoLastTrack?.title==='Night Fever'",10);
for(let i=0;i<25&&requests()<2;i++)await sleep(200);
result.requestsAfterSecond=requests();result.opensAfterSecond=opens();
result.after=await ev(state);
result.toast=await ev("document.body.innerText.includes('VirtualDJ live: Night Fever')");
// Automatic Live Assist switched off: a further new song sends no open request (the watcher stops polling while it is off)
await ev("localStorage.setItem('axiomPerformanceAutoLiveAssist.v1','off')");
fs.appendFileSync(history,`#EXTVDJ:<time>22:20</time><lastplaytime>${Math.floor(Date.now()/1000)}</lastplaytime><artist>ABBA</artist><title>Dancing Queen</title><songlength>230.0</songlength>\nC:\\Music\\ABBA - Dancing Queen.mp3\n`);
await sleep(8000);
result.requestsAfterThird=requests();result.opensAfterThird=opens();
// control: switched back on, the same song is still playing and is taken as new, so the page does send its request
await ev("localStorage.setItem('axiomPerformanceAutoLiveAssist.v1','on')");
for(let i=0;i<50&&requests()<3;i++)await sleep(200);
result.requestsAfterBackOn=requests();
// The user switches DJ Auto off; a reload keeps it off
await ev("document.getElementById('performance-serato-toggle').click()");
result.clickedOff=await ev(state);
await load();await sleep(2500);
result.reloaded=await ev(state);
fs.writeFileSync(out,JSON.stringify(result));
ws.close();process.exit(0);
'''
def main():
 edge=next((e for e in EDGES if os.path.isfile(e)),None)
 assert edge,'Edge not installed'
 base=root/'fixtures';base.mkdir(exist_ok=True)
 sandbox=pathlib.Path(tempfile.mkdtemp(dir=base,prefix='live-watch-'))
 procs=[]
 try:
  local=sandbox/'AppData'/'Local';home=local/'VirtualDJ';(home/'History').mkdir(parents=True);(sandbox/'profile').mkdir()
  (home/'settings.xml').write_text('<?xml version="1.0"?><VirtualDJ_Settings/>',encoding='utf-8')
  history=home/'History'/(time.strftime('%Y-%m-%d')+'.m3u')
  history.write_text(f'#EXTVDJ:<time>22:00</time><lastplaytime>{int(time.time())-60}</lastplaytime><artist>Bananarama</artist><title>Cruel Summer</title><songlength>240.0</songlength>\nC:\\Music\\Bananarama - Cruel Summer.mp3\n',encoding='utf-8')
  (sandbox/'server.py').write_text(SERVER,encoding='utf-8');(sandbox/'cdp.mjs').write_text(CDP,encoding='utf-8')
  port,debug=free(),free()
  env=dict(os.environ,LOCALAPPDATA=str(local),USERPROFILE=str(sandbox),AXIOM_RUNTIME_DIR=str(local/'AXIOM DJ'),AXIOM_NO_OPEN='1')
  env.pop('AXIOM_HUB',None)
  server=subprocess.Popen([str(python),str(sandbox/'server.py'),str(root),str(port),str(sandbox/'mini-opens.txt'),str(sandbox/'mini-requests.txt')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);procs.append(server)
  deadline=time.monotonic()+90
  while time.monotonic()<deadline:
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=3) as r:
     if r.status==200:html=r.read().decode('utf-8','replace');break
   except OSError:time.sleep(0.4)
  else:raise AssertionError('server did not start')
  assert 'windows-live-watch.js?v=3' in html
  live=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/api/performance/dj/live',timeout=10))
  assert live.get('provider')=='virtualdj' and live['track']['title']=='Cruel Summer',json.dumps(live)[:400]
  browser=subprocess.Popen([edge,'--headless=new',f'--remote-debugging-port={debug}',f'--user-data-dir={sandbox/"profile"}','--no-first-run','--no-default-browser-check','--window-size=1400,900','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);procs.append(browser)
  out=sandbox/'result.json'
  node=subprocess.run(['node',str(sandbox/'cdp.mjs'),str(debug),f'http://127.0.0.1:{port}/',str(history),str(out),str(sandbox/'mini-opens.txt'),str(sandbox/'mini-requests.txt')],capture_output=True,text=True,timeout=150)
  assert out.is_file(),('node failed',node.stdout[-800:],node.stderr[-800:])
  r=json.loads(out.read_text(encoding='utf-8'))
  print(json.dumps(r,indent=1))
  assert r['ready'] is True
  assert r['autoOn'] and r['first']['auto'] is True and r['first']['button']=='DJ Auto On',r['first']  # switched itself on
  assert r['first']['perfHidden'] is True and r['first']['stored'] is None  # on its own, not a user choice
  assert r['firstSeen'],r['first']  # the song already playing was picked up
  assert r['followed'] and r['after']['perfHidden'] is True and r['after']['last']=='Night Fever',r['after']  # new song, Performance still hidden
  assert r['requestsAfterFirst']==1 and r['requestsAfterSecond']==2,r  # REQUESTS the page sent: one automatic open request per new song
  assert r['opensAfterFirst']==1 and r['opensAfterSecond']==1,r  # OPENER runs: only once, the second request falls inside the 20 s grace while the Mini is starting
  assert r['requestsAfterThird']==2 and r['opensAfterThird']==1,r  # Automatic Live Assist off: a new song sends no request and opens nothing
  assert r['requestsAfterBackOn']==3,r  # control: back on, the page sends its request again (so the silence above was the switch)
  assert r['clickedOff']['auto'] is False and r['clickedOff']['stored']=='off',r['clickedOff']
  assert r['reloaded']['auto'] is False and r['reloaded']['stored']=='off',r['reloaded']  # the user's choice survives a reload
  print('PASS: DJ Auto switches itself on, follows VirtualDJ with Performance hidden, sends one Mini open request per new song (the opener runs once), and respects Automatic Live Assist and DJ Auto being turned off')
 finally:
  for p in reversed(procs):
   p.terminate()
  for p in procs:
   try:p.wait(10)
   except Exception:p.kill()
  shutil.rmtree(sandbox,ignore_errors=True)
try:main()
except BaseException:
 traceback.print_exc();sys.exit(1)
