"""PEAK HOUR's own window (windows_native_window.py: pywebview on WebView2), driven over the Chrome DevTools protocol.

A tiny local server (never port 8080) stands in for the app; the window is started minimised, with a throw-away data folder under
%TEMP%, and driven only through WebView2's remote-debugging port (no keyboard or mouse input). Checks: the page loads in a
WebView2 (user agent has Edg/); window.open to the same origin gives a real second window the opener can use; window.open to
another origin opens no window and goes to the (stubbed) system browser; microphone and MIDI are allowed for the app's origin
and the camera is refused; closing the window writes the size/position file and the process exits with code 0.
SKIP: when pywebview or WebView2 is not installed."""
import os,sys,json,time,uuid,socket,base64,struct,hashlib,pathlib,tempfile,threading,subprocess,traceback,ctypes,urllib.request
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
workspace=pathlib.Path(__file__).resolve().parent
STAGED=os.environ.get('NW_STAGED')  # a folder made by build_installer.stage(): run the child with ITS Python and ITS app files
probe=pathlib.Path(STAGED)/'app' if STAGED else workspace/'axiom-win-probe'
sys.path.insert(0,str(probe))
import windows_window_mode as wm
missing=wm.failed_probes()
if missing:
 print('SKIP: native window not available here (%s)'%', '.join(missing));sys.exit(0)
PY=pathlib.Path(STAGED)/'runtime'/'python.exe' if STAGED else workspace/'axiom-win-env'/'Scripts'/'python.exe'
if not PY.is_file():PY=pathlib.Path(sys.executable)

def free_port():
 while True:
  with socket.socket() as s:
   s.bind(('127.0.0.1',0));p=s.getsockname()[1]
  if p!=8080:return p  # the owner's PEAK HOUR may be running on 8080

MAIN=('<!doctype html><title>NW Test</title><body>main page<input id=t><script>window.wheels=[];'
      'addEventListener("wheel",e=>wheels.push([e.ctrlKey,e.deltaY,e.defaultPrevented]),{passive:true});</script></body>')
PAGES={'/':MAIN,'/pop':'<!doctype html><title>NW Popup</title><body>popup page</body>',
       '/live_assist_window':'<!doctype html><title>NW LiveAssist</title><body>live assist</body>',
       '/static/windows-live-assist-mini.html':'<!doctype html><title>NW Mini</title><body>mini</body>',
       '/static/manual/index.html':'<!doctype html><title>NW Manual</title><body>manual</body>'}
FILE=b'peak hour download test\n'*100
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  path=self.path.split('?')[0]
  if path=='/file':
   n=self.path.split('n=')[-1] if 'n=' in self.path else ''
   self.send_response(200);self.send_header('Content-Type','application/octet-stream');self.send_header('Content-Disposition','attachment; filename="nw-export%s.txt"'%n)
   self.send_header('Content-Length',str(len(FILE)));self.end_headers();self.wfile.write(FILE);return
  body=PAGES.get(path)
  if body is None:self.send_response(404);self.end_headers();return
  data=body.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def log_message(self,*a):pass

class WS:
 """Just enough WebSocket client for DevTools: one text request, read until its answer."""
 def __init__(self,url):
  hostport,path=url[len('ws://'):].split('/',1);host,port=hostport.split(':')
  self.s=socket.create_connection((host,int(port)),timeout=20);key=base64.b64encode(os.urandom(16)).decode()
  self.s.sendall(('GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n'%(path,hostport,key)).encode())
  head=b''
  while b'\r\n\r\n' not in head:head+=self.s.recv(1)
  assert b' 101 ' in head.split(b'\r\n')[0],head
  self.n=0;self.events=[]
 def _read(self,n):
  b=b''
  while len(b)<n:
   c=self.s.recv(n-len(b))
   if not c:raise EOFError
   b+=c
  return b
 def _frame(self):
  h=self._read(2);op=h[0]&15;n=h[1]&127
  if n==126:n=struct.unpack('>H',self._read(2))[0]
  elif n==127:n=struct.unpack('>Q',self._read(8))[0]
  return op,self._read(n)
 def call(self,method,params=None):
  self.n+=1;data=json.dumps({'id':self.n,'method':method,'params':params or {}}).encode();mask=os.urandom(4)
  n=len(data);head=bytes([0x81])+(bytes([0x80|n]) if n<126 else bytes([0x80|126])+struct.pack('>H',n) if n<65536 else bytes([0x80|127])+struct.pack('>Q',n))
  self.s.sendall(head+mask+bytes(b^mask[i%4] for i,b in enumerate(data)))
  while True:
   op,payload=self._frame()
   if op==1:
    m=json.loads(payload)
    if m.get('id')==self.n:return m
    self.events.append(m)
 def wait_event(self,name,seconds=15):
  self.s.settimeout(seconds);end=time.time()+seconds
  while time.time()<end:
   for m in self.events:
    if m.get('method')==name:return m
   try:op,payload=self._frame()
   except socket.timeout:break
   if op==1:self.events.append(json.loads(payload))
  return None
 def close(self):self.s.close()

def targets(port):
 return [t for t in json.loads(urllib.request.urlopen('http://127.0.0.1:%d/json'%port,timeout=5).read()) if t['type']=='page']
def evaluate(port,target,expr,await_promise=False):
 ws=WS(target['webSocketDebuggerUrl'])
 try:
  r=ws.call('Runtime.evaluate',{'expression':expr,'returnByValue':True,'awaitPromise':await_promise,'userGesture':True})
 finally:ws.close()
 assert 'exceptionDetails' not in r.get('result',{}),r
 return r['result']['result'].get('value')
def wait_for(what,test,seconds=25):
 end=time.time()+seconds;last=None
 while time.time()<end:
  try:
   last=test()
   if last:return last
  except Exception as e:last=e
  time.sleep(0.25)
 raise AssertionError('timed out waiting for %s (last: %r)'%(what,last))

import ctypes.wintypes
user32=ctypes.WinDLL('user32')
user32.SetProcessDPIAware()  # so window sizes read back in the same pixels the window was made in
SCALE=user32.GetDpiForSystem()/96
ENUM=ctypes.WINFUNCTYPE(ctypes.c_bool,ctypes.c_void_p,ctypes.c_void_p)
def window_rect(pids,title):
 """(width, height) in pixels of the top-level window titled `title` of one of these processes, or None."""
 found=[]
 def visit(hwnd,_):
  p=ctypes.c_ulong();user32.GetWindowThreadProcessId(ctypes.c_void_p(hwnd),ctypes.byref(p))
  buf=ctypes.create_unicode_buffer(256);user32.GetWindowTextW(ctypes.c_void_p(hwnd),buf,256)
  if p.value in pids and buf.value==title:
   r=ctypes.wintypes.RECT();user32.GetWindowRect(ctypes.c_void_p(hwnd),ctypes.byref(r));found.append((r.right-r.left,r.bottom-r.top))
  return True
 user32.EnumWindows(ENUM(visit),0)
 return found[0] if found else None
def close_window(pids,title):
 """Post WM_CLOSE (what the close button sends) to the top-level window titled `title` that belongs to one of these processes
 (the venv python.exe is a stub that starts the real interpreter, so the window is in a child of the process we started)."""
 found=[]
 def visit(hwnd,_):
  p=ctypes.c_ulong();user32.GetWindowThreadProcessId(ctypes.c_void_p(hwnd),ctypes.byref(p))
  buf=ctypes.create_unicode_buffer(256);user32.GetWindowTextW(ctypes.c_void_p(hwnd),buf,256)
  if p.value in pids and buf.value==title:found.append(hwnd)
  return True
 user32.EnumWindows(ENUM(visit),0)
 assert found,'no window titled %r for pids %r'%(title,pids)
 user32.PostMessageW(ctypes.c_void_p(found[0]),0x10,0,0)

def stray(temp):
 ps="Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:NW_TEMP) } | ForEach-Object { $_.ProcessId }"
 out=subprocess.run(['powershell','-NoProfile','-Command',ps],capture_output=True,text=True,env=dict(os.environ,NW_TEMP=str(temp))).stdout.split()
 return [int(x) for x in out if x.isdigit()]

def run(temp):
 app_port,debug_port=free_port(),free_port()
 token=uuid.uuid4().hex;downloads=temp/'dl';downloads.mkdir()
 assert app_port!=8080 and debug_port!=8080
 server=ThreadingHTTPServer(('127.0.0.1',app_port),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
 base='http://127.0.0.1:%d'%app_port;data=temp/'AXIOM DJ';profile=data/'NativeWindow';browser_log=temp/'browser.txt'
 env={k:v for k,v in os.environ.items() if not k.upper().startswith(('WEBVIEW2','PEAKHOUR','PYTHON'))}
 env.update(LOCALAPPDATA=str(temp),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=%d'%debug_port,PEAKHOUR_TEST='1',PEAKHOUR_TEST_BROWSER_LOG=str(browser_log),
            PEAKHOUR_NATIVE_CONTROL=token,PEAKHOUR_TEST_DOWNLOAD_DIR=str(downloads))
 child=subprocess.Popen([str(PY),str(probe/'windows_native_window.py'),'--url',base+'/','--title','PEAK HOUR','--profile',str(profile),'--minimized','--nofocus'],
                        env=env,cwd=str(temp),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  # the control socket listens (and says where) before the window is up; a command sent that early waits for the page
  cfile=data/'native-control.json'
  info=wait_for('the control file',lambda:json.loads(cfile.read_text()),20);control_port=info['port']
  assert info['token']==token and info['pid'] in set(stray(temp)) and control_port not in (0,8080) and not info.get('loaded') in (None,),info
  import axiom_windows_launcher as L
  early=L.send_native_command('focus',control_port,token,5);assert early is True
  main=wait_for('the main page',lambda:[t for t in targets(debug_port) if t['title']=='NW Test'],40)[0]
  assert wait_for('loaded in the control file',lambda:json.loads(cfile.read_text()).get('loaded') is True)  # the launcher's "window is up"
  assert all(type(json.loads(cfile.read_text())[k]) is t for k,t in (('pid',int),('port',int),('token',str)))
  assert evaluate(debug_port,main,'location.origin')==base
  ua=evaluate(debug_port,main,'navigator.userAgent');assert 'Edg/' in ua,ua  # WebView2, not the old IE engine
  assert evaluate(debug_port,main,'document.body.innerText')=='main page'
  assert len(targets(debug_port))==1,targets(debug_port)
  # window.open to another origin: nothing opens in the window, the address goes to the system browser (stubbed here)
  r=evaluate(debug_port,main,"String(window.open('http://example.test/page','_blank'))")
  time.sleep(1.5);assert len(targets(debug_port))==1,('an other-origin page opened in a window',targets(debug_port))
  assert wait_for('the stubbed browser call',lambda:browser_log.read_text().strip()=='http://example.test/page'),browser_log.read_text() if browser_log.exists() else None
  # runtime-foundation.js openAxiomExternalUrl: window.open(noopener) returns null, so the page also does location.assign: the window
  # must stay on PEAK HOUR, and the address opens in the browser once
  assert evaluate(debug_port,main,"(()=>{const p=window.open('http://example.test/update','_blank','noopener,noreferrer');if(!p)window.location.assign('http://example.test/update');return p===null})()") is True
  time.sleep(2);assert evaluate(debug_port,main,'location.origin')==base and len(targets(debug_port))==1
  assert browser_log.read_text().split().count('http://example.test/update')==1,browser_log.read_text()
  # window.open to the same origin: a real second window, and the opener gets a usable window object
  assert evaluate(debug_port,main,"(()=>{window.__pop=window.open('/pop','nwpop','width=420,height=320');return !!window.__pop})()") is True,'window.open returned null for the same origin'
  pop=wait_for('the second window',lambda:[t for t in targets(debug_port) if t['title']=='NW Popup'])[0]
  size=wait_for('the popup size',lambda:evaluate(debug_port,pop,'[innerWidth,innerHeight]'))  # the page area is what window.open asked for
  assert abs(size[0]-420)<=3 and abs(size[1]-320)<=3,size
  assert evaluate(debug_port,main,'window.__pop.location.origin')==base
  assert evaluate(debug_port,main,'window.__pop.document.title')=='NW Popup'
  assert evaluate(debug_port,pop,'window.opener!==null')is True
  assert len(targets(debug_port))==2
  assert not browser_log.read_text().count('127.0.0.1'),'a same-origin popup went to the system browser'
  evaluate(debug_port,main,'window.__pop.close()')
  wait_for('the second window to close',lambda:len(targets(debug_port))==1)
  # B3: no size asked -> 900x700 page area
  assert evaluate(debug_port,main,"(()=>{window.__pop=window.open('/pop','nwpop2');return !!window.__pop})()") is True
  pop=wait_for('the second window',lambda:[t for t in targets(debug_port) if t['title']=='NW Popup'])[0]
  size=wait_for('the popup size',lambda:evaluate(debug_port,pop,'[innerWidth,innerHeight]'));assert abs(size[0]-900)<=3 and abs(size[1]-700)<=3,size
  evaluate(debug_port,main,'window.__pop.close()')
  wait_for('the second window to close',lambda:len(targets(debug_port))==1)
  # B4: in-page input over CDP. Key events injected over CDP never pass the browser's accelerator layer, so the F5 / Ctrl+R below
  # only show that the page survives them; the accelerator setting itself is checked from what WebView2 reports back (the log).
  evaluate(debug_port,main,'window.__alive=42;document.getElementById("t").focus();1')
  ws=WS(main['webSocketDebuggerUrl'])
  try:
   for key,code,vk,mods in (('F5','F5',116,0),('r','KeyR',82,2)):
    for kind in ('rawKeyDown','keyUp'):ws.call('Input.dispatchKeyEvent',{'type':kind,'key':key,'code':code,'windowsVirtualKeyCode':vk,'modifiers':mods})
   ws.call('Input.insertText',{'text':'hello'})  # typing works in a text field
   ws.call('Input.dispatchKeyEvent',{'type':'rawKeyDown','key':'a','code':'KeyA','windowsVirtualKeyCode':65,'modifiers':2,'commands':['selectAll']})
   ws.call('Input.dispatchKeyEvent',{'type':'keyUp','key':'a','code':'KeyA','windowsVirtualKeyCode':65,'modifiers':2})
   time.sleep(0.5)
   field="(()=>{const t=document.getElementById('t');return [window.__alive,t.value,t.value.substring(t.selectionStart,t.selectionEnd)]})()"
   assert evaluate(debug_port,main,field)==[42,'hello','hello']  # not reloaded; text typed; select-all worked
   # ctrl+wheel reaches the page's own listener and does not zoom the page (IsZoomControlEnabled=False)
   before=evaluate(debug_port,main,'[devicePixelRatio,visualViewport.scale,innerWidth]')
   for _ in range(4):ws.call('Input.dispatchMouseEvent',{'type':'mouseWheel','x':200,'y':200,'deltaX':0,'deltaY':-120,'modifiers':2})
   time.sleep(0.8)
   got=evaluate(debug_port,main,'wheels')
   assert len(got)>=1 and all(w[0] is True for w in got),got
   assert evaluate(debug_port,main,'[devicePixelRatio,visualViewport.scale,innerWidth]')==before,'the page zoomed'
  finally:ws.close()
  # B5: a Content-Disposition: attachment response starts a download (saved into a temp folder here, never the real Downloads)
  bws=WS(json.loads(urllib.request.urlopen('http://127.0.0.1:%d/json/version'%debug_port,timeout=5).read())['webSocketDebuggerUrl'])
  try:
   # events only: 'default' leaves the saving to WebView2's DownloadStarting (the host handler puts the file in the temp folder here)
   bws.call('Browser.setDownloadBehavior',{'behavior':'default','eventsEnabled':True})
   # two downloads back to back (a second export right after the first): both must start
   evaluate(debug_port,main,"(()=>{for(const n of ['1','2']){const a=document.createElement('a');a.href='/file?n='+n;a.download='';document.body.appendChild(a);a.click()}return 1})()")
   began=bws.wait_event('Browser.downloadWillBegin',15)
   time.sleep(2);bws.wait_event('Browser.downloadWillBegin',1)
   began_count=len([m for m in bws.events if m.get('method')=='Browser.downloadWillBegin'])
  finally:bws.close()
  for n in ('1','2'):
   wait_for('the downloaded file '+n,lambda:(downloads/('nw-export%s.txt'%n)).is_file() and (downloads/('nw-export%s.txt'%n)).stat().st_size==len(FILE))
   assert (downloads/('nw-export%s.txt'%n)).read_bytes()==FILE
  print('download: CDP downloadWillBegin events %d'%began_count)
  assert began_count>=1  # (CDP reports the first; both files above and both log lines below prove the second one started too)
  assert (data/'native-window.log').read_text().count('download started')>=2
  # permissions for the app's own origin: microphone and MIDI (with sysex) allowed, camera refused
  mic=evaluate(debug_port,main,"navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return 'granted'},e=>e.name)",True)
  assert mic!='NotAllowedError',mic  # 'granted', or NotFoundError on a PC with no microphone: the permission itself was given
  cam=evaluate(debug_port,main,"navigator.mediaDevices.getUserMedia({video:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return 'granted'},e=>e.name)",True)
  assert cam=='NotAllowedError',cam
  for sysex in ('false','true'):  # each is its own permission request; both must resolve
   midi=evaluate(debug_port,main,"navigator.requestMIDIAccess({sysex:%s}).then(a=>'granted',e=>e.name)"%sysex,True)
   assert midi=='granted',(sysex,midi)
  midi_kinds=[l.split(' from ')[0].split('permission ')[1] for l in (data/'native-window.log').read_text().splitlines() if 'permission Midi' in l]
  print('midi permission kinds WebView2 raised: %s'%midi_kinds)
  assert midi_kinds,midi_kinds
  # A: the launcher's control channel opens Live Assist, Mini and the manual in this process (one each), with the Edge window sizes
  assert L.send_native_command('live_assist',control_port,token,5) is True
  la=wait_for('Live Assist',lambda:[t for t in targets(debug_port) if t['title']=='NW LiveAssist'])[0]
  assert evaluate(debug_port,la,'location.pathname')=='/live_assist_window' and evaluate(debug_port,la,'location.search').startswith('?popup=1&open=')
  assert L.send_native_command('mini',control_port,token,5) is True and L.send_native_command('manual',control_port,token,5) is True
  wait_for('Mini and the manual',lambda:{'NW Mini','NW Manual'}<={t['title'] for t in targets(debug_port)})
  assert L.send_native_command('live_assist',control_port,token,5) is True  # again: brought forward, not a second window
  time.sleep(1);assert [t['title'] for t in targets(debug_port)].count('NW LiveAssist')==1,targets(debug_port)
  pids=set(stray(temp))
  assert window_rect(pids,'NW LiveAssist')==(round(438*SCALE),round(690*SCALE)),window_rect(pids,'NW LiveAssist')
  assert window_rect(pids,'NW Mini')==(round(380*SCALE),round(560*SCALE)),window_rect(pids,'NW Mini')
  assert L.send_native_command('focus',control_port,token,5) is True
  # nothing else can drive it: wrong token, unknown command, an HTTP request, and a page in the window itself
  assert L.send_native_command('mini',control_port,'x'*32,2) is False
  def raw(data):
   with socket.create_connection(('127.0.0.1',control_port),timeout=3) as c:
    c.sendall(data)
    try:return c.recv(100)
    except OSError:return b''
  assert raw((json.dumps({'token':token,'command':'open_url','url':'http://example.test/'})+'\n').encode())==b'{"ok": false}\n'
  assert raw(b'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n')==b''
  assert raw(b'POST / HTTP/1.1\r\nContent-Length: 2\r\n\r\n{}')==b''
  assert not [t for t in targets(debug_port) if 'example.test' in t['url']]
  # close like the close button (Live Assist, Mini and the manual are still open: the process must end anyway), then: exit code 0 and the window state file
  close_window(set(stray(temp)),'NW Test')
  code=child.wait(timeout=30);assert code==0,'exit code %r'%code
  state=json.loads((data/'native-window.json').read_text());assert all(type(state[k]) is int for k in ('x','y','width','height')) and state['maximized'] in (True,False),state
  assert not list(data.glob('native-window.json.tmp'))
  log=(data/'native-window.log').read_text()
  assert 'settings applied: zoom=False accelerator_keys=False devtools=False status_bar=False' in log,log  # read back from WebView2
  assert 'download started' in log
  assert not cfile.exists(),'the control file is removed when the window closes'
  user=os.environ.get('USERNAME','');assert not user or user not in log,'the log holds the user name'  # (the temp folder is under it)
  assert os.environ.get('USERPROFILE','?') not in log
  for want in ('engine edgechromium','control channel ready','permission Microphone from %s: allow'%base,'permission MidiSystemExclusiveMessages from %s: allow'%base,'permission Camera from %s: deny'%base):
   assert want in log,(want,log)
  assert 'crashed' not in log
  assert not (data/'Window').exists()  # the Edge profile folder is never created or touched
  assert (profile/'EBWebView').is_dir()
 finally:
  if child.poll() is None:child.kill()
  server.shutdown()

temp=pathlib.Path(tempfile.mkdtemp(prefix='nw'))
try:
 run(temp)
except Exception:
 traceback.print_exc();print('FAIL native window');ok=False
else:ok=True
time.sleep(1)
for pid in stray(temp):subprocess.run(['taskkill','/F','/PID',str(pid)],capture_output=True)
time.sleep(1)
if ok or not os.environ.get('NW_KEEP_TEMP'):
 import shutil;shutil.rmtree(temp,ignore_errors=True)
else:print('kept',temp)
if ok:print('PASS native window: WebView2 page, popups are real windows of the asked size, other origins go to the browser, Live Assist/Mini/manual open through the control channel, mic and MIDI allowed, camera refused, ctrl+wheel not zoomed, download starts, state saved, exit 0')
sys.exit(0 if ok else 1)
