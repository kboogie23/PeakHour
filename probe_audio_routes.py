import os,sys,pathlib,traceback
workspace=pathlib.Path(__file__).resolve().parent
probe=workspace/'axiom-win-probe'; home=workspace/'probe-home'; home.mkdir(exist_ok=True)
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(home/'AppData/Local'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime'),'NO_PROXY':'*','PIP_DISABLE_PIP_VERSION_CHECK':'1'})
sys.path.insert(0,str(probe)); os.chdir(probe)
def audit(event,args):
 if event in ('socket.connect','socket.connect_ex','subprocess.Popen','os.system','os.startfile'):
  raise PermissionError('Probe blocks '+event)
 if event=='open' and len(args)>1:
  path,mode=args[:2]
  if isinstance(path,(str,bytes,os.PathLike)) and isinstance(mode,str) and any(x in mode for x in 'wax+'):
   resolved=pathlib.Path(path).resolve()
   if not resolved.is_relative_to(workspace): raise PermissionError('Probe blocks file write outside workspace')
sys.addaudithook(audit)
try:
 import app
 from windows_audio import WindowsAudioDeck
 app.NATIVE_AUDIO_DECK=WindowsAudioDeck()
 client=app.app.test_client(); path=str(workspace/'fixtures'/'silent.wav')
 try:
  r=client.post('/api/audio/play',json={'path':path,'title':'Silent route test'}); print('play',r.status_code,r.json); assert r.status_code==200 and r.json['playing']
  r=client.post('/api/audio/pause',json={}); print('pause',r.status_code,r.json); assert r.status_code==200 and not r.json['playing']
  r=client.post('/api/audio/seek',json={'seconds':1}); print('seek',r.status_code,r.json); assert r.status_code==200 and abs(r.json['current_time']-1)<.02
  r=client.post('/api/audio/resume',json={}); assert r.status_code==200 and r.json['playing']
  r=client.post('/api/audio/stop',json={}); assert r.status_code==200 and not r.json['has_track']
  print('PASS: original Flask audio routes drive Windows adapter')
 finally: app.NATIVE_AUDIO_DECK.stop()
except BaseException:
 traceback.print_exc(); sys.exit(1)
