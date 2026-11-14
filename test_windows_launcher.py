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
  keep=('--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows')
  assert all(s in command for s in keep) and '--disable-features=msEdgeStartupBoost' in command  # a minimised window keeps following the DJ software
  import inspect;assert 'WINDOW_FLAGS' in inspect.getsource(L.open_live_assist) and set(keep)==set(L.KEEP_AWAKE)  # the Live Assist pop-up too
  assert 'WINDOW_FLAGS' in inspect.getsource(L.open_live_assist_mini) and 'WINDOW_FLAGS' in inspect.getsource(L.edge_command)  # and PEAK HOUR Mini: one flag list for every window
  quiet=('--disable-extensions','--disable-sync','--disable-background-networking','--disable-component-extensions-with-background-pages')
  assert all(s in command and s in L.WINDOW_FLAGS for s in quiet)  # no synced extensions, sync or background networking in the app window
  assert '--no-first-run' in command and '--no-default-browser-check' in command and command.count('--disable-features=msEdgeStartupBoost')==1  # a second --disable-features would replace the first
  assert not any(s.startswith(('--disable-web-security','--disable-popup','--disable-gpu','--disable-audio','--autoplay','--mute')) for s in L.WINDOW_FLAGS)  # media, downloads and pickers untouched
  # Existing installs: the extensions Edge already synced into the profile are removed once, only while the profile is not open
  profile=local/'AXIOM DJ'/'Window'
  for name in L.PROFILE_JUNK:(profile/'Default'/name/'sub').mkdir(parents=True);(profile/'Default'/name/'sub'/'f.bin').write_bytes(b'x')
  for name in ('Local Storage','IndexedDB','Sync Data'):(profile/'Default'/name).mkdir();(profile/'Default'/name/'keep.ldb').write_bytes(b'peakhour.setting')
  (profile/'Default'/'Preferences').write_text('{}');(profile/'Local State').write_text('{}')
  assert not L.profile_in_use(profile)
  default=profile/'Default';settings=('Local Storage','IndexedDB','Sync Data')
  def settings_intact():return all((default/n/'keep.ldb').read_bytes()==b'peakhour.setting' for n in settings) and (default/'Preferences').is_file() and (profile/'Local State').is_file()
  trash=lambda:[p for p in default.iterdir() if p.name.startswith(L.TRASH)]
  # a file held open in Cache (as a running program would): that folder cannot be moved, the others are; not marked, tried again
  held=open(default/'Cache'/'sub'/'f.bin','rb')
  try:
   moved=L.clean_window_profile(profile)
   assert sorted(moved)==sorted(n for n in L.PROFILE_JUNK if n!='Cache') and (default/'Cache').is_dir() and not (profile/L.PROFILE_CLEANED).exists()
   assert (profile/(L.PROFILE_CLEANED+'.tries')).read_text()=='1' and len(trash())==4
  finally:held.close()
  # renamed first, deleted afterwards in the background: the junk is already gone from its place before any deleting happens
  assert L.clean_window_profile(profile)==['Cache'] and not any((default/n).exists() for n in L.PROFILE_JUNK) and len(trash())==5
  assert (profile/L.PROFILE_CLEANED).exists() and settings_intact()
  # a delete that fails (file held in the trash) leaves the folder, says so, and the next start's sweep finishes it
  stuck=trash()[0];held=open(next(stuck.rglob('f.bin')),'rb')
  try:assert L.delete_trash(profile)==[stuck.name] and len(trash())==1
  finally:held.close()
  assert L.delete_trash(profile)==[] and trash()==[] and settings_intact()
  (default/'Extensions').mkdir();assert L.clean_window_profile(profile)==[] and (default/'Extensions').is_dir()  # once only: the marker stops a second run
  # prepare_window_profile (called before the Ctrl+F hotkey starts) renames, then deletes on a background thread
  (profile/L.PROFILE_CLEANED).unlink();(profile/(L.PROFILE_CLEANED+'.tries')).unlink();(default/'Extensions'/'x.bin').write_bytes(b'x')
  assert L.prepare_window_profile(profile)==['Extensions'] and not (default/'Extensions').exists()
  for _ in range(100):
   if not trash():break
   time.sleep(0.1)
  assert trash()==[] and settings_intact()
  (profile/L.PROFILE_CLEANED).unlink();real=L.profile_in_use;L.profile_in_use=lambda p:True
  (default/'Extensions').mkdir()
  try:assert L.clean_window_profile(profile)==[] and (default/'Extensions').is_dir() and not (profile/L.PROFILE_CLEANED).exists()  # a running Edge: nothing touched, no marker
  finally:L.profile_in_use=real
  # five starts that cannot move a folder: give up (marker), never loop forever
  held=open(default/'Extensions'/'h.bin','wb')
  try:
   for _ in range(L.PROFILE_TRIES):L.clean_window_profile(profile)
   assert (profile/L.PROFILE_CLEANED).read_text()=='gave up'
  finally:held.close()
  assert L.clean_window_profile(local/'AXIOM DJ'/'No such profile')==[]
  # a junction (or symlink) is never followed: Default itself, or one of the folders
  if os.name=='nt':
   elsewhere=local/'elsewhere';(elsewhere/'Extensions').mkdir(parents=True);(elsewhere/'Extensions'/'keep.txt').write_text('mine')
   linked=local/'AXIOM DJ'/'Linked';linked.mkdir()
   subprocess.run(['cmd','/c','mklink','/J',str(linked/'Default'),str(elsewhere)],check=True,capture_output=True)
   assert L._is_link(linked/'Default') and L.clean_window_profile(linked)==[] and (elsewhere/'Extensions'/'keep.txt').read_text()=='mine'
   (linked/'Default').rmdir()
   (linked/'Default').mkdir();subprocess.run(['cmd','/c','mklink','/J',str(linked/'Default'/'Extensions'),str(elsewhere/'Extensions')],check=True,capture_output=True)
   (linked/'Default'/'Cache').mkdir()
   assert L.clean_window_profile(linked)==['Cache'] and (elsewhere/'Extensions'/'keep.txt').read_text()=='mine' and not (linked/L.PROFILE_CLEANED).exists()
   L.delete_trash(linked);assert (elsewhere/'Extensions'/'keep.txt').read_text()=='mine'
  # the hotkey starts only after the profile has been prepared
  main_source=inspect.getsource(L.main);assert main_source.index('prepare_window_profile()')<main_source.index('LIVE_ASSIST_HOTKEY.start()')
  print('launcher flags: no extensions/sync/background networking in any PEAK HOUR window; profile clean-up removes only',', '.join(L.PROFILE_JUNK))
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
