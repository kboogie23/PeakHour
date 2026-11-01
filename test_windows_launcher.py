import os,pathlib,socket,subprocess,sys,tempfile,time,urllib.request,urllib.error
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
import axiom_windows_launcher as L
def free():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def get(port,host=None):
 request=urllib.request.Request(f'http://127.0.0.1:{port}/',headers={'Host':host or f'127.0.0.1:{port}'})
 try:
  with urllib.request.urlopen(request,timeout=10) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,b''
def post(port,**headers):
 # POST to a route that does not exist: 403 means the launcher refused it, 404 means it let it through
 request=urllib.request.Request(f'http://127.0.0.1:{port}/api/no-such-route',data=b'{}',method='POST',headers=headers)
 try:
  with urllib.request.urlopen(request,timeout=10) as r:return r.status
 except urllib.error.HTTPError as e:return e.code
with tempfile.TemporaryDirectory(dir=root) as d:
 local=pathlib.Path(d)/'AppData'/'Local';local.mkdir(parents=True)
 old=os.environ.get('LOCALAPPDATA');os.environ['LOCALAPPDATA']=str(local)
 try:
  # Port choice never takes over a busy port
  with socket.socket() as busy:
   busy.bind(('127.0.0.1',0));busy.listen();taken=busy.getsockname()[1]
   assert not L.port_is_free(taken) and L.free_port()!=taken
  # Single instance lock and published port
  first,second=L.SingleInstance(),L.SingleInstance()
  assert first.acquire() and not second.acquire()
  first.publish(4321);assert second.running_port()==4321
  first.release();assert second.acquire() and second.running_port() is None;second.release()
  # VirtualDJ policy: safe locations plus VirtualDJ's own home only
  vdj=local/'VirtualDJ';vdj.mkdir();db=vdj/'database.xml';db.write_text('<x/>');other=local/'Other.xml';other.write_text('<x/>')
  policy=L.virtualdj_policy(lambda p:False)
  assert policy(db) and not policy(other) and not policy(vdj/'missing.xml')
  assert L.data_root()==local/'AXIOM DJ'
  # Logs rotate: 5 MB x 3 files; the log() helper, the logging handler and the pythonw stderr all write the current launch.log
  assert L.LOG_LIMIT==5*1024*1024 and L.LOG_FILES==3
  logs=L.log_file().parent;logs.mkdir(parents=True,exist_ok=True)
  for n in range(5):
   L.log_file().write_bytes(bytes([65+n])*(L.LOG_LIMIT+1));L.rotate_log(L.log_file())
  assert sorted(f.name for f in logs.iterdir())==['launch.1.log','launch.2.log'] and (logs/'launch.1.log').read_bytes()[:1]==b'E' and (logs/'launch.2.log').read_bytes()[:1]==b'D'
  L.log('after rotation');assert L.log_file().read_text(encoding='utf-8').endswith('after rotation\n') and L.log_file().stat().st_size<200
  L.log_file().write_bytes(b'small');L.rotate_log(L.log_file());assert L.log_file().read_bytes()==b'small'
  # A log another program holds open is left alone: nothing is shifted and the older logs survive
  for name,mark in (('launch.1.log',b'one'),('launch.2.log',b'two')):(logs/name).write_bytes(mark)
  L.log_file().write_bytes(b'L'*(L.LOG_LIMIT+1))
  with open(L.log_file(),'ab'):
   L.rotate_log(L.log_file())
   assert (logs/'launch.1.log').read_bytes()==b'one' and (logs/'launch.2.log').read_bytes()==b'two' and L.log_file().stat().st_size==L.LOG_LIMIT+1
   assert not list(logs.glob('*.rotating'))
  L.rotate_log(L.log_file());assert (logs/'launch.2.log').read_bytes()==b'one' and (logs/'launch.1.log').stat().st_size==L.LOG_LIMIT+1 and not L.log_file().exists()
  for f in logs.iterdir():f.unlink()
  # The pythonw stderr stand-in looks like a text stream and keeps concurrent writes whole
  import io,threading
  stream=L.LogStream();assert stream.encoding=='utf-8' and stream.errors=='replace' and not stream.isatty()
  try:stream.fileno();raise AssertionError('fileno should not exist')
  except io.UnsupportedOperation:pass
  def spray(n):
   for i in range(200):stream.write(f'thread {n} line {i} '+'y'*300+'\n')
  workers=[threading.Thread(target=spray,args=(n,)) for n in range(6)];[w.start() for w in workers];[w.join() for w in workers]
  rows=L.log_file().read_text(encoding='utf-8').splitlines();assert len(rows)==1200 and all(r.endswith('y'*300) and r.startswith('thread ') for r in rows)
  L.log_file().unlink()
  import logging,io
  L.LOG_LIMIT=4000;handlers=list(logging.getLogger().handlers);level=logging.getLogger().level;stderr=sys.stderr
  try:
   for f in logs.iterdir():f.unlink()
   sys.stderr=None;L.log_server_errors();assert isinstance(sys.stderr,L.LogStream)
   for n in range(60):logging.getLogger('axiom.test').warning('warning line %d %s',n,'x'*100)
   sys.stderr.write('stderr line\n');L.log('helper line')
   text=L.log_file().read_text(encoding='utf-8')
   assert (logs/'launch.1.log').is_file() and 'helper line' in text and 'stderr line' in text and (logs/'launch.log').stat().st_size<=L.LOG_LIMIT+300
   print('launcher log rotation: launch.log kept under the limit, files',sorted((f.name,f.stat().st_size) for f in logs.iterdir()))
  finally:
   for h in list(logging.getLogger().handlers):
    if h not in handlers:logging.getLogger().removeHandler(h);h.close()
   logging.getLogger().setLevel(level);sys.stderr=stderr;L.LOG_LIMIT=5*1024*1024
   for f in logs.iterdir():f.unlink()
  command=L.edge_command('msedge.exe','http://127.0.0.1:8080/',local/'AXIOM DJ'/'Window')
  assert '--app=http://127.0.0.1:8080/' in command and '--start-maximized' in command and f'--user-data-dir={local/"AXIOM DJ"/"Window"}' in command
 finally:
  if old is None:os.environ.pop('LOCALAPPDATA',None)
  else:os.environ['LOCALAPPDATA']=old
 # The launcher itself, headless, with isolated app data
 port=free();env=dict(os.environ,LOCALAPPDATA=str(local),USERPROFILE=d,AXIOM_PORT=str(port),AXIOM_NO_OPEN='1');env.pop('AXIOM_HUB',None)  # the home-network hub is off unless AXIOM_HUB=1
 python=root/'axiom-win-env'/'Scripts'/'python.exe';script=root/'axiom-win-probe'/'axiom_windows_launcher.py'
 server=subprocess.Popen([str(python),str(script)],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  deadline=time.monotonic()+90
  while time.monotonic()<deadline:
   try:
    status,body=get(port)
    if status==200:break
   except OSError:pass
   time.sleep(0.3)
  assert status==200 and b'AXIOM' in body,status
  import json
  with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/license/status',timeout=10) as r:licence=json.loads(r.read())
  assert licence['status']=='dev_unlocked' and licence['usable'] and not licence['required']  # activation off for now
  assert get(port,f'localhost:{port}')[0]==200 and get(port,f'evil.example:{port}')[0]==403
  assert (local/'AXIOM DJ'/'launcher.port').read_text()==str(port)
  # A page of another origin cannot change anything; AXIOM's own pages can
  for headers in ({'Origin':'http://evil.example'},{'Origin':'null'},{'Origin':f'http://127.0.0.1:{port+1}'},{'Origin':f'https://127.0.0.1:{port}'},
                  {},{'Sec-Fetch-Site':'cross-site'},{'Sec-Fetch-Site':'same-site'},{'Origin':'http://evil.example','Sec-Fetch-Site':'same-origin'},
                  {'Origin':'null','Sec-Fetch-Site':'same-origin'}):
   assert post(port,**headers)==403,headers
  for headers in ({'Origin':f'http://127.0.0.1:{port}'},{'Origin':f'http://localhost:{port}','Host':f'localhost:{port}'},{'Origin':f'http://127.0.0.1:{port}/'},
                  {'Sec-Fetch-Site':'same-origin'},{'Sec-Fetch-Site':'none'}):
   assert post(port,**headers)==404,headers
  assert get(port)[0]==200  # reading needs no Origin
  # A second launch reuses the running AXIOM and exits
  again=subprocess.run([str(python),str(script)],env=env,timeout=60)
  assert again.returncode==0 and server.poll() is None
  log=(local/'AXIOM DJ'/'Logs'/'launch.log').read_text(encoding='utf-8')
  assert f'PEAK HOUR server running at http://127.0.0.1:{port}/' in log and 'Another PEAK HOUR launcher is running' in log
  assert 'Other laptops' not in log and 'No home network' not in log and 'Pairing code' not in log and not (local/'AXIOM DJ'/'hub.json').exists()  # hub off by default
  assert (local/'AXIOM DJ'/'Video Cache').is_dir() and (pathlib.Path(d)/'Music'/'AXIOM DJ'/'Recordings').is_dir()
 finally:
  # The venv python.exe is a redirector that runs the real interpreter as a child: end the tree
  subprocess.run(['taskkill','/F','/T','/PID',str(server.pid)],capture_output=True);server.wait(timeout=20)
  os.environ['LOCALAPPDATA']=str(local);lock=L.SingleInstance();deadline=time.monotonic()+20
  try:
   while not lock.acquire() and time.monotonic()<deadline:time.sleep(0.2)
   assert time.monotonic()<deadline,'launcher still holds its lock after exit'
   lock.release()
  finally:
   if old is None:os.environ.pop('LOCALAPPDATA',None)
   else:os.environ['LOCALAPPDATA']=old
print('PASS: Windows launcher starts AXIOM on loopback, rejects foreign hosts and cross-origin changes, keeps the hub off by default, keeps one instance, never takes a busy port')
