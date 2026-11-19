"""Which window PEAK HOUR opens in (windows_window_mode.choose_window): every branch, with fake probes.

PEAKHOUR_WINDOW unset (or anything unknown) is today's Edge/Chrome app window; native / auto need all four probes to pass and
otherwise fall back to today's window with the failed probe named. Probes never raise; a probe that does counts as failed."""
import os,sys,pathlib,traceback
workspace=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(workspace/'axiom-win-probe'))
import windows_window_mode as wm
OK={'pywebview':lambda:True,'pythonnet':lambda:True,'webview2':lambda:True,'dotnet48':lambda:True}
def boom():raise RuntimeError('probe blew up')
def run():
 # unset / unknown / empty -> today's window, and the probes are not even asked
 asked=[]
 spy={n:(lambda n=n:asked.append(n) or True) for n in wm.PROBE_ORDER}
 for env in ({},{'PEAKHOUR_WINDOW':''},{'PEAKHOUR_WINDOW':'banana'},{'PEAKHOUR_WINDOW':'  '},{'OTHER':'native'}):
  r=wm.choose_window(env,spy);assert r['mode']=='edge' and r['reason'],(env,r)
 assert asked==[],asked
 # explicit browser choices, any case
 for text,mode in (('edge','edge'),('EDGE','edge'),('Chrome','chrome'),('chrome','chrome')):
  r=wm.choose_window({'PEAKHOUR_WINDOW':text},spy);assert r['mode']==mode,(text,r)
 assert asked==[],asked
 # native and auto: all probes pass -> native (case-insensitive, whitespace ignored)
 for text in ('native','NATIVE','Native','auto','AUTO',' native '):
  r=wm.choose_window({'PEAKHOUR_WINDOW':text},OK);assert r['mode']=='native' and r['reason'],(text,r)
 # one probe fails -> today's window, reason names it
 words={'pywebview':'pywebview','pythonnet':'pythonnet','webview2':'WebView2','dotnet48':'.NET Framework'}
 for name in wm.PROBE_ORDER:
  for how in (lambda:False,boom,lambda:None,lambda:0):
   for text in ('native','auto'):
    probes=dict(OK);probes[name]=how
    r=wm.choose_window({'PEAKHOUR_WINDOW':text},probes)
    assert r['mode']=='edge' and words[name] in r['reason'],(name,text,r)
    assert all(words[o] not in r['reason'] for o in wm.PROBE_ORDER if o!=name),(name,r)
 # several failures are all named; a missing probe counts as failed; plain booleans work as probes
 r=wm.choose_window({'PEAKHOUR_WINDOW':'native'},{'pywebview':False,'pythonnet':False,'webview2':True,'dotnet48':False})
 assert r['mode']=='edge' and 'pywebview' in r['reason'] and 'pythonnet' in r['reason'] and '.NET' in r['reason'] and 'WebView2' not in r['reason'],r
 r=wm.choose_window({'PEAKHOUR_WINDOW':'native'},{'pywebview':True});assert r['mode']=='edge' and 'WebView2' in r['reason'],r
 r=wm.choose_window({'PEAKHOUR_WINDOW':'native'},{n:True for n in wm.PROBE_ORDER});assert r['mode']=='native',r
 # a broken env cannot stop PEAK HOUR opening
 class Bad(dict):
  def get(self,*a):raise RuntimeError('env blew up')
 r=wm.choose_window(Bad(),OK);assert r['mode']=='edge' and r['reason'],r
 # the real probes: read-only, return booleans, never raise (the answers depend on this PC, so only the type is checked)
 for name,fn in wm.DEFAULT_PROBES.items():
  assert isinstance(fn(),bool),name
 assert isinstance(wm.webview2_version(),str) and isinstance(wm.dotnet_release(),int)
 r=wm.choose_window({'PEAKHOUR_WINDOW':'native','LOCALAPPDATA':os.environ.get('TEMP','.')});assert r['mode'] in ('native','edge') and r['reason'],r
 # the per-user file window-mode.txt: used only when PEAKHOUR_WINDOW is unset; first line, trimmed, any case; anything else ignored
 import tempfile,shutil
 d=pathlib.Path(tempfile.mkdtemp(prefix='wm'));(d/'AXIOM DJ').mkdir()
 try:
  def file_says(text,env_value=None):
   (d/'AXIOM DJ'/'window-mode.txt').write_bytes(text if isinstance(text,bytes) else text.encode('utf-8'))
   env={'LOCALAPPDATA':str(d)}
   if env_value is not None:env['PEAKHOUR_WINDOW']=env_value
   return wm.choose_window(env,OK)
  for text in ('native','NATIVE\n','  Native  \r\nsecond line','auto','﻿native\n'):
   r=file_says(text);assert r['mode']=='native' and r['source']=='file',(text,r)
  for text,mode in (('edge','edge'),('Chrome\n','chrome')):
   r=file_says(text);assert r['mode']==mode and r['source']=='file',(text,r)
  for text in ('','\n','native please','banana','\nnative',b'\xff\xfe\x00',' ','nativeX'):
   r=file_says(text);assert r['mode']=='edge' and r['source']=='default',(text,r)  # ignored: today's window
  r=file_says('native','edge');assert r['mode']=='edge' and r['source']=='env',r  # the variable wins when it is set
  r=file_says('native','banana');assert r['mode']=='edge' and r['source']=='default',r  # set to nonsense: not the file either
  r=file_says('edge','native');assert r['mode']=='native' and r['source']=='env',r
  (d/'AXIOM DJ'/'window-mode.txt').unlink()
  assert wm.choose_window({'LOCALAPPDATA':str(d)},OK)['source']=='default'  # no file
  r=file_says('native');bad=dict(OK);bad['webview2']=lambda:False
  assert wm.choose_window({'LOCALAPPDATA':str(d)},bad)['mode']=='edge'  # the file still needs the probes
  assert wm.choose_window({},OK)['source']=='default'  # no LOCALAPPDATA in env: the file is never guessed
 finally:shutil.rmtree(d,ignore_errors=True)
 # the registry readers reject 0.0.0.0 and short .NET releases
 import winreg
 real=winreg.OpenKey;calls=[]
 class Key:
  def __init__(s,v):s.v=v
  def __enter__(s):return s
  def __exit__(s,*a):return False
 def fake_open(version,release):
  def f(hive,path,*a):
   calls.append(path)
   if 'EdgeUpdate' in path and version is not None:return Key(('pv',version))
   if 'NDP' in path and release is not None:return Key(('Release',release))
   raise FileNotFoundError(path)
  return f
 real_query=winreg.QueryValueEx
 winreg.QueryValueEx=lambda key,name:(key.v[1],1)
 try:
  for version,want in (('0.0.0.0',''),('',''),('garbage',''),('157.0.4341.46','157.0.4341.46')):
   winreg.OpenKey=fake_open(version,None);assert wm.webview2_version()==want,(version,wm.webview2_version())
  winreg.OpenKey=fake_open(None,None);assert wm.webview2_version()=='' and not wm.probe_webview2()
  for release,want in ((528039,False),(528040,True),(533320,True),(None,False)):
   winreg.OpenKey=fake_open(None,release);assert wm.probe_dotnet48() is want,(release,)
 finally:
  winreg.OpenKey=real;winreg.QueryValueEx=real_query
 assert any('WOW6432Node' in c and wm.WEBVIEW2_CLIENT in c for c in calls) and any(c.endswith(r'NDP\v4\Full') for c in calls),calls
def launcher():
 # The launcher hook, against fake processes and a fake native window: unset -> nothing is started or asked; the native window
 # that cannot start, never loads or dies at any time -> Edge once; a second launch never starts a native window.
 import axiom_windows_launcher as L
 import tempfile,shutil,socket,threading,json
 names=('subprocess.Popen','open_window','log','window_browser','kill_process_tree','native_is_ready','native_pid_alive','NATIVE_CONTROL')
 saved={n:(getattr(L.subprocess,'Popen') if n=='subprocess.Popen' else getattr(L,n)) for n in names}
 saved_time=(L.time.monotonic,L.time.sleep);saved_env={k:os.environ.get(k) for k in ('PEAKHOUR_WINDOW','LOCALAPPDATA','PEAKHOUR_TEST','PEAKHOUR_TEST_BROWSER_LOG','PEAKHOUR_TEST_DOWNLOAD_DIR')}
 home=tempfile.mkdtemp(prefix='wml');os.environ['LOCALAPPDATA']=home  # (never read or write the owner's AXIOM DJ folder)
 started=[];envs=[];edge=[];killed=[];now=[100.0]
 class Proc:
  pid=4242
  def __init__(s,code,exits_at):s.code,s.exits_at=code,exits_at   # exits_at: time (on the fake clock) it exits; None: never
  def poll(s):return s.code if s.exits_at is not None and now[0]>=s.exits_at else None
  def wait(s,timeout=None):
   assert s.exits_at is not None,'waited for a process that never exits'
   now[0]=max(now[0],s.exits_at);return s.code
 def fake_popen(code=0,exits_at=1e9):
  def popen(cmd,**kw):started.append(cmd);envs.append(kw.get('env'));return Proc(code,exits_at)
  return popen
 try:
  L.subprocess.Popen=fake_popen()
  L.open_window=lambda url:edge.append(url) or 'edge-process'
  L.time.monotonic=lambda:now[0];L.time.sleep=lambda s:now.__setitem__(0,now[0]+s)
  L.log=lambda message:None  # (never write the owner's launch.log)
  L.kill_process_tree=lambda p:killed.append(p)
  def reset():
   started.clear();envs.clear();edge.clear();killed.clear();now[0]=100.0;L.NATIVE_CONTROL=None;L.forget_control_file()
  url='http://127.0.0.1:1/'
  # --- nothing asks for the native window: HEAD's behaviour
  os.environ.pop('PEAKHOUR_WINDOW',None);reset()
  assert L.start_native_window(url) is None and started==[]
  os.environ['PEAKHOUR_WINDOW']='edge';assert L.start_native_window(url) is None and started==[]
  os.environ['PEAKHOUR_WINDOW']='native'
  real=wm.DEFAULT_PROBES.copy()
  wm.DEFAULT_PROBES.update({n:(lambda:False) for n in wm.PROBE_ORDER})
  assert L.start_native_window(url) is None and started==[]  # this PC cannot: Edge
  wm.DEFAULT_PROBES.update({n:(lambda:True) for n in wm.PROBE_ORDER})
  # --- starting it: the command, the environment (token yes, test switches no), no stale control file
  os.environ.update(PEAKHOUR_TEST='1',PEAKHOUR_TEST_BROWSER_LOG='x',PEAKHOUR_TEST_DOWNLOAD_DIR='y')
  L.control_file().parent.mkdir(parents=True,exist_ok=True);L.control_file().write_text('{"stale": true}')
  native=L.start_native_window(url);assert native is not None and len(started)==1 and not L.control_file().exists()
  cmd=started[0];assert cmd[0]==sys.executable and cmd[1].endswith('windows_native_window.py') and cmd[cmd.index('--url')+1]==url
  assert cmd[cmd.index('--profile')+1].endswith(os.path.join('AXIOM DJ','NativeWindow')) and cmd[cmd.index('--title')+1]=='PEAK HOUR'
  token=envs[0]['PEAKHOUR_NATIVE_CONTROL'];assert len(token)>=32 and token==L.NATIVE_CONTROL['token'] and L.NATIVE_CONTROL['port'] is None
  assert token not in ' '.join(cmd) and 'PEAKHOUR_NATIVE_CONTROL' not in os.environ
  assert not [k for k in envs[0] if k.upper().startswith('PEAKHOUR_TEST')],'test switches reached the window'
  for k in ('PEAKHOUR_TEST','PEAKHOUR_TEST_BROWSER_LOG','PEAKHOUR_TEST_DOWNLOAD_DIR'):os.environ.pop(k)
  # --- waiting for it: (exit code, exits at, ready at) -> Edge opened?
  cases=((0,500,1,False),(0,1,None,False),(3,1,None,True),(3,500,1,True),(1,2,None,True),(6,300,1,True),(-1073741819,200,1,True),(1,39,None,True))
  for code,exits,ready,falls_back in cases:
   reset();proc=Proc(code,100+exits);L.NATIVE_CONTROL={'process':proc,'token':'t'*32,'port':None}
   L.native_is_ready=lambda tok,ready=ready:ready is not None and now[0]>=100+ready
   L.control_file().parent.mkdir(parents=True,exist_ok=True);L.control_file().write_text('{}')
   result=L.wait_native_window((proc,now[0]),url)
   assert (edge==[url] and result=='edge-process')==falls_back,(code,exits,ready,edge,result)
   assert falls_back or result is proc
   assert (not L.control_file().exists())==falls_back,'the control file of a dead window is removed'
   assert killed==[],killed
  # never reports ready, never exits (a hang): after NATIVE_READY_SECONDS only that process is killed and Edge opens
  reset();proc=Proc(0,None);L.NATIVE_CONTROL={'process':proc,'token':'t'*32,'port':None};L.native_is_ready=lambda tok:False
  result=L.wait_native_window((proc,now[0]),url)
  assert killed==[proc] and edge==[url] and result=='edge-process' and L.NATIVE_READY_SECONDS<=now[0]-100<L.NATIVE_READY_SECONDS+1,(killed,edge,now[0])
  # --- the control channel: client against a fake native window
  L.time.monotonic,L.time.sleep=saved_time
  tok='t'*32;seen=[];replies=[None]
  server=socket.socket();server.bind(('127.0.0.1',0));server.listen(8);cport=server.getsockname()[1]
  def serve(server=server):
   while True:
    try:conn,_=server.accept()
    except OSError:return
    with conn:
     try:m=json.loads(conn.makefile('rb').readline())
     except ValueError:continue
     seen.append(m)
     if m['token']!=tok:continue  # no answer
     conn.sendall(replies[0] if replies[0] is not None else (b'{"ok": true}\n' if m['command'] in L.NATIVE_COMMANDS else b'{"ok": false}\n'))
  threading.Thread(target=serve,daemon=True).start()
  assert L.send_native_command('mini',cport,tok,2) is True and seen[-1]=={'token':tok,'command':'mini'}
  assert L.send_native_command('mini',cport,'wrong',2) is False and L.send_native_command('bogus',cport,tok,2) is False
  for junk in (b'[]\n',b'"ok"\n',b'null\n',b'{"ok": "true"}\n',b'{"ok": 1}\n',b'\xff\xfe\n',b'{"ok": false}\n',b'not json\n',b'7\n'):
   replies[0]=junk;assert L.send_native_command('focus',cport,tok,2) is False,junk  # a junk answer never crashes the launcher
  replies[0]=None
  dead=socket.socket();dead.bind(('127.0.0.1',0));deadport=dead.getsockname()[1];dead.close()  # nothing listens
  assert L.send_native_command('mini',deadport,tok,0.3) is False
  # --- commands from this launcher's window (port found in the control file, token must match)
  reset();proc=Proc(0,None);L.NATIVE_CONTROL={'process':proc,'token':tok,'port':None}
  assert L.native_window_command('mini') is False  # no control file yet: not ready
  def write_info(**kw):
   info={'pid':os.getpid(),'port':cport,'token':tok,'loaded':True};info.update(kw)
   L.control_file().parent.mkdir(parents=True,exist_ok=True);L.control_file().write_text(json.dumps(info))
  write_info(token='z'*32);assert L.native_window_command('mini') is False and L.NATIVE_CONTROL['port'] is None  # someone else's file
  write_info();assert L.native_window_command('live_assist') is True and L.NATIVE_CONTROL['port']==cport
  class Dead(Proc):
   def poll(s):return 1
  L.NATIVE_CONTROL={'process':Dead(0,0),'token':tok,'port':cport};n=len(seen);assert L.native_window_command('mini') is False and len(seen)==n  # window gone: not asked
  L.NATIVE_CONTROL=None;assert L.native_window_command('mini') is False
  # open_live_assist / open_live_assist_mini: native when it answers; otherwise exactly the Edge path
  calls=[];opened=[]
  L.window_browser=lambda:calls.append('browser') or None;real_start=os.startfile;os.startfile=lambda t:opened.append(t)
  try:
   L.NATIVE_CONTROL={'process':proc,'token':tok,'port':cport}
   L.open_live_assist(url);L.open_live_assist_mini(url);assert calls==[] and opened==[] and [m['command'] for m in seen[-2:]]==['live_assist','mini']
   L.NATIVE_CONTROL=None;L.open_live_assist(url);L.open_live_assist_mini(url)
   assert calls==['browser','browser'] and opened[0].startswith(url+'live_assist_window?popup=1') and opened[1]==url+'static/windows-live-assist-mini.html',opened
   L.NATIVE_CONTROL={'process':proc,'token':tok,'port':deadport};opened.clear();real_default=L.send_native_command.__defaults__
   L.send_native_command.__defaults__=(0.3,);L.open_live_assist(url);L.send_native_command.__defaults__=real_default;assert len(opened)==1  # no answer: Edge path
  finally:os.startfile=real_start
  # --- a second launch NEVER starts a native window; it focuses a live one, otherwise today's Edge window
  L.time.monotonic=lambda:now[0];L.time.sleep=lambda s:now.__setitem__(0,now[0]+s)
  def second(alive=True):
   reset();L.native_pid_alive=lambda pid:alive;L.open_in_running_instance(url)
   assert started==[],'a second launch started a window'
  second();assert edge==[url]  # no control file
  for junk in ('not json','[]','{}','{"pid":"1","port":5,"token":"t"}','{"pid":1,"port":0,"token":"t"}','{"pid":1,"port":70000,"token":"t"}','{"pid":1,"port":5,"token":7}'):
   reset();L.control_file().parent.mkdir(parents=True,exist_ok=True);L.control_file().write_text(junk);L.native_pid_alive=lambda pid:True;L.open_in_running_instance(url)
   assert edge==[url] and started==[],junk
  reset();write_info();n=len(seen);L.native_pid_alive=lambda pid:False;L.open_in_running_instance(url)
  assert edge==[url] and len(seen)==n and started==[]  # the process in the file is gone: stale, not asked
  reset();write_info();n=len(seen);L.native_pid_alive=lambda pid:True;L.open_in_running_instance(url)
  assert edge==[] and started==[] and seen[n:]==[{'token':tok,'command':'focus'}]  # live window: focused, nothing else
  reset();write_info();replies[0]=b'{"ok": false}\n';L.native_pid_alive=lambda pid:True;L.open_in_running_instance(url)
  assert edge==[url] and started==[] and 30<=now[0]-100<=40,(edge,now[0])  # keeps asking up to NATIVE_FOCUS_SECONDS, then Edge
  replies[0]=None
  reset();write_info(port=deadport);L.native_pid_alive=lambda pid:True;L.open_in_running_instance(url);assert edge==[url] and started==[]
  server.close()
 finally:
  for n,v in saved.items():
   if n=='subprocess.Popen':L.subprocess.Popen=v
   else:setattr(L,n,v)
  L.time.monotonic,L.time.sleep=saved_time
  for k,v in saved_env.items():
   if v is None:os.environ.pop(k,None)
   else:os.environ[k]=v
  wm.DEFAULT_PROBES.update(real)
  shutil.rmtree(home,ignore_errors=True)
def state():
 # The native window's saved size/position: corrupt files are ignored, writes are atomic, rectangles are pulled onto the desktop.
 import tempfile,json,shutil
 import windows_native_window as nw
 assert nw.clamp_rect(5000,3000,1440,900,0,0,1920,1080)==(480,180,1440,900)  # off to the bottom right: pulled back in
 assert nw.clamp_rect(-900,-50,1440,900,0,0,1920,1080)==(0,0,1440,900)
 assert nw.clamp_rect(100,100,3000,2000,0,0,1920,1080)==(0,0,1920,1080)  # too big for the desktop: shrunk
 assert nw.clamp_rect(-1700,10,800,600,-1920,0,3840,1080)==(-1700,10,800,600)  # a second monitor to the left is fine
 d=pathlib.Path(tempfile.mkdtemp(prefix='nws'))
 try:
  assert nw.load_state(d) is None
  for bad in ('{not json','[]','null','{"x":1}','{"x":1,"y":2,"width":"9","height":9}','{"x":1,"y":2,"width":50,"height":50}','{"x":1.5,"y":2,"width":900,"height":700}',''):
   nw.state_path(d).write_text(bad,encoding='utf-8');assert nw.load_state(d) is None,bad
  nw.save_state(d,{'x':10,'y':20,'width':1300,'height':800,'maximized':True})
  assert nw.load_state(d)=={'x':10,'y':20,'width':1300,'height':800,'maximized':True} and not list(d.glob('*.tmp'))
  w,h,x,y,maximized=nw.start_geometry(nw.load_state(d),1.0);assert maximized and (x,y)==(10,20) and w>=400 and h>=300
  w,h,x,y,maximized=nw.start_geometry(None,1.0);assert (x,y,maximized)==(None,None,False) and w<=1440 and h<=900
  nw.save_state(d,{'x':90000,'y':90000,'width':1300,'height':800,'maximized':False})  # a monitor that is gone: no position, still a window
  w,h,x,y,maximized=nw.start_geometry(nw.load_state(d),1.0);vx,vy,vw,vh=nw.virtual_desktop();assert x is None or (vx<=x<vx+vw and vy<=y<vy+vh),(x,y)
  # the log is cut back at 200 KB
  args=nw.parse(['--url','http://127.0.0.1:1/','--profile',str(d/'NativeWindow')]);host=nw.Host(args)
  host.log_path.write_bytes(b'x'*(nw.LOG_LIMIT+10));host.note('hello');assert host.log_path.stat().st_size<1000 and 'hello' in host.log_path.read_text()
  # origins: only the app's own origin may be allowed anything; MIDI/mic/clipboard yes, camera and the rest no
  assert host.same_origin('http://127.0.0.1:1/x?y') and host.same_origin('http://127.0.0.1:1') and host.same_origin('about:blank')
  assert not any(host.same_origin(u) for u in ('http://127.0.0.1:11/','http://127.0.0.1:1.evil.test/','http://localhost:1/','https://127.0.0.1:1/','http://127.0.0.1:1@evil.test/'))
  ok=['Microphone','MidiSystemExclusiveMessages','Midi','ClipboardRead','MultipleAutomaticDownloads','Autoplay']
  assert all(host.allowed('http://127.0.0.1:1/',k) for k in ok) and not any(host.allowed('http://127.0.0.1:1/',k) for k in ('Camera','Geolocation','Notifications','FileReadWrite','LocalFonts','WindowManagement','OtherSensors'))
  # scrub: the profile folders and the user's name never reach the log
  os.environ['USERPROFILE']=r'C:\Users\Someone';os.environ['LOCALAPPDATA']=r'C:\Users\Someone\AppData\Local';os.environ['USERNAME']='Someone'
  out=nw.scrub(r'failed in C:\Users\Someone\AppData\Local\AXIOM DJ\NativeWindow\x for Someone (c:/users/someone/appdata/local/y)')
  assert 'Someone' not in out and '%LOCALAPPDATA%' in out,out
  assert 'Someone' not in nw.describe(OSError(r'C:\Users\Someone\secret.txt')) and nw.describe(OSError('x')).startswith('OSError: ')
  # external opens are limited: 5 per 10 s, then dropped (a count in the log, never the address)
  host.testing=False;opened=[]
  nw.webbrowser.open=lambda u:opened.append(u)
  for i in range(8):host.open_external('http://example.test/%d'%i)
  assert len(opened)==5 and host.dropped_external==3 and 'example.test' not in host.log_path.read_text()
  assert host.allowed('http://127.0.0.1:1/','Camera') is False
  assert not any(host.allowed(u,k) for u in ('http://evil.test/','about:blank','http://localhost:1/') for k in ok)
  assert nw.main(['--url','http://127.0.0.1:1/','--profile',str(d/'Window')])==nw.EXIT_BAD_ARGS  # never the Edge profile folder
  import contextlib,io
  with contextlib.redirect_stderr(io.StringIO()):assert nw.main(['--bogus'])==nw.EXIT_BAD_ARGS
 finally:shutil.rmtree(d,ignore_errors=True)
try:
 run();launcher();state()
except Exception:
 traceback.print_exc();print('FAIL window mode');sys.exit(1)
print('PASS window mode: unset keeps today\'s window; native/auto need pywebview, pythonnet, WebView2 and .NET 4.8; probes never raise')
