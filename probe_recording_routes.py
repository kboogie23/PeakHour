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
 import app, pathlib, numpy as np, wave, uuid
 from windows_recording import WindowsRecordingManager
 from windows_capture import WindowsInputCapture
 class FakeStream:
  def __init__(self,**kw): self.callback=kw['callback']; self.active=False
  def start(self): self.active=True
  def stop(self): self.active=False
  def close(self): pass
 def fake_capture(): return WindowsInputCapture(stream_factory=FakeStream)
 def devices(): return [dict(name='Fixture mixer',hostapi=0,max_input_channels=4,default_samplerate=8000)]
 def hosts(): return [dict(name='Fixture API')]
 folder=workspace/'fixtures'/'recording_api'/uuid.uuid4().hex; folder.mkdir(parents=True,exist_ok=True)
 manager=WindowsRecordingManager(str(folder/'settings.json'),str(folder),capture_factory=fake_capture,device_query=devices,host_query=hosts)
 app.SET_RECORDING_MANAGER=manager
 client=app.app.test_client()
 r=client.get('/api/performance/recording/sources?source_mode=device'); print('sources',r.status_code,r.json); assert r.status_code==200 and r.json['devices']
 name=r.json['devices'][0]['name']
 r=client.post('/api/performance/recording/start',json={'source_mode':'application','source_id':'test'}); assert r.status_code==409
 r=client.post('/api/performance/recording/start',json={'source_mode':'device','source_id':name}); assert r.status_code==409
 manager.save_settings({'source_mode':'device','device_name':name,'device_capture_pair':{'device_key':'name:'+name.casefold(),'left_channel':2,'right_channel':3}})
 r=client.get('/api/performance/recording/sources?source_mode=device'); assert r.json['capture_profile']['left_channel']==2 and r.json['capture_profile']['confirmed']
 r=client.post('/api/performance/recording/start',json={'source_mode':'device','source_id':name}); print('start',r.status_code,r.json); assert r.status_code==200 and r.json['recording']
 samples=np.zeros((80,4),dtype=np.float32);samples[:,2]=0.25;samples[:,3]=-0.5
 manager._capture._stream.callback(samples,80,None,None)
 r=client.get('/api/performance/recording/status'); assert r.status_code==200 and r.json['signal_level']>0
 r=client.post('/api/performance/recording/stop'); print('stop',r.status_code,r.json); assert r.status_code==200 and r.json['status']=='saved'
 with wave.open(r.json['saved_path'],'rb') as f:
  assert f.getnframes()==80 and f.getnchannels()==2
  pcm=np.frombuffer(f.readframes(80),dtype='<i2').reshape(-1,2);assert (pcm[:,0]==8191).all() and (pcm[:,1]==-16383).all()
 r=client.post('/api/performance/recording/start',json={'source_mode':'device','source_id':name}); assert r.status_code==200
 manager._capture._stream.callback(samples,80,None,'overflow')
 r=client.post('/api/performance/recording/stop'); assert r.status_code != 200
 failed=client.get('/api/performance/recording/status').json
 assert failed['status']=='failed' and not failed['recording'] and not failed['saved_path']
 assert pathlib.Path(failed['recovery_path']).is_file()
 print('PASS: original recording routes with simulated Windows input and failure recovery')
except BaseException:
 traceback.print_exc();sys.exit(1)
