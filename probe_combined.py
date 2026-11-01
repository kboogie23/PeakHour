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
 import uuid, wave, hashlib
 from unittest.mock import patch,MagicMock
 import numpy as np
 from windows_capture import WindowsInputCapture
 from windows_bootstrap import build_backend
 import windows_dialogs
 class FakeStream:
  def __init__(self,**kw): self.callback=kw['callback']; self.active=False
  def start(self): self.active=True
  def stop(self): self.active=False
  def close(self): pass
 folder=workspace/'fixtures'/'combined'/uuid.uuid4().hex; folder.mkdir(parents=True)
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder,
  capture_factory=lambda:WindowsInputCapture(stream_factory=FakeStream),
  device_query=lambda:[dict(name='Fixture mixer',hostapi=0,max_input_channels=2,default_samplerate=8000)],
  host_query=lambda:[dict(name='Fixture API')])
 client=app.app.test_client(); assert client.get('/').status_code==200
 license_state=client.get('/api/license/status').json; assert license_state['access_tier']=='guest_preview'
 source=folder/'source.wav'
 with wave.open(str(source),'wb') as w:
  w.setparams((2,2,8000,0,'NONE','not compressed'));w.writeframes(bytes(8000*2*2))
 digest=hashlib.sha256(source.read_bytes()).hexdigest()
 import scanner
 scan=scanner.scan_library(str(folder),str(folder/'cache.json')); assert len(scan['tracks'])==1
 r=client.post('/api/audio/play',json={'path':str(source)}); assert r.status_code==200 and r.json['has_track']
 assert client.post('/api/audio/pause').json['playing']==False
 assert client.post('/api/audio/stop').json['has_track']==False
 fixture=folder/'database V2';fixture.write_bytes(b'')
 with patch.object(windows_dialogs.tk,'Tk',return_value=MagicMock()),patch.object(windows_dialogs.filedialog,'askopenfilename',return_value=str(fixture)):
  r=client.post('/api/library/choose_serato_database'); assert r.status_code==200 and r.json['database_path']==str(fixture)
 name=client.get('/api/performance/recording/sources?source_mode=device').json['devices'][0]['name']
 r=client.post('/api/performance/recording/start',json={'source_mode':'device','source_id':name}); assert r.status_code==200 and r.json['recording']
 app.SET_RECORDING_MANAGER._capture._stream.callback(np.full((80,2),.25,dtype=np.float32),80,None,None)
 r=client.post('/api/performance/recording/stop');assert r.status_code==200 and r.json['status']=='saved'
 with wave.open(r.json['saved_path'],'rb') as w: assert w.getnframes()==80
 assert hashlib.sha256(source.read_bytes()).hexdigest()==digest
 print('PASS: combined bootstrap, guest access, scan, preview, picker and simulated recording')
except BaseException:
 traceback.print_exc();sys.exit(1)
finally:
 if 'app' in globals(): app.NATIVE_AUDIO_DECK.stop()
