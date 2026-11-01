import json,pathlib,sys,tempfile,hashlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
from windows_recording import WindowsRecordingManager
with tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).resolve().parent) as d:
 root=pathlib.Path(d); saves=root/'saves';saves.mkdir();settings=root/'settings.json'
 m=WindowsRecordingManager(str(settings),str(saves));state=pathlib.Path(m.state_path)
 out=saves/'set.wav';partial=saves/'set.wav.partial';partial.write_bytes(b'RIFF unfinished audio bytes')
 before=hashlib.sha256(partial.read_bytes()).hexdigest()
 state.write_text(json.dumps({'status':'recording','recording':True,'output_path':str(out),'temp_wav_path':str(partial)}),encoding='utf8')
 restored=WindowsRecordingManager(str(settings),str(saves)).status()
 assert restored['status']=='failed' and not restored['recording'] and restored['recovery_path']==str(partial)
 assert not out.exists() and hashlib.sha256(partial.read_bytes()).hexdigest()==before
 outside=root/'outside.wav.partial';outside.write_bytes(b'do not touch');outside_hash=hashlib.sha256(outside.read_bytes()).hexdigest()
 state.write_text(json.dumps({'status':'recording','output_path':str(root/'outside.wav'),'temp_wav_path':str(outside)}),encoding='utf8')
 restored=WindowsRecordingManager(str(settings),str(saves)).status()
 assert restored['status']=='failed' and restored['recovery_path']==''
 assert hashlib.sha256(outside.read_bytes()).hexdigest()==outside_hash
 class BrokenStream:
  def __init__(self,**kwargs): self.active=False
  def start(self): raise OSError('input unavailable')
  def close(self): pass
 from windows_capture import WindowsInputCapture
 import uuid
 testroot=root/uuid.uuid4().hex;testroot.mkdir();settings2=testroot/'settings.json'
 manager=WindowsRecordingManager(str(settings2),str(saves),capture_factory=lambda:WindowsInputCapture(stream_factory=BrokenStream),
  device_query=lambda:[dict(name='Test',hostapi=0,max_input_channels=2,default_samplerate=8000)],
  host_query=lambda:[dict(name='Test API')])
 name=manager.devices()['devices'][0]['name']
 try:manager.start(source_mode='device',source_id=name)
 except RuntimeError:pass
 else:raise AssertionError('start failure not reported')
 failed=manager.status();assert failed['status']=='failed' and not failed['recording']
 assert pathlib.Path(failed['recovery_path']).is_file()
 print('PASS: interrupted recording and startup failure leave partial files untouched')
