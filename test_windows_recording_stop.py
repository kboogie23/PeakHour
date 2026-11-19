import os,pathlib,sys,tempfile,threading,time,wave
import numpy as np
import sounddevice as sd
OVERFLOW=sd.CallbackFlags();OVERFLOW.input_overflow=True
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
import axiom_windows_launcher as L
from windows_capture import WindowsInputCapture
from windows_recording import WindowsRecordingManager
class FakeStream:
 def __init__(self,**kw): self.callback=kw['callback'];self.active=False
 def start(self): self.active=True
 def stop(self): self.active=False
 def close(self): pass
class FakeAxiom: pass
class SlowStream(FakeStream):
 entered,gate=threading.Event(),threading.Event()
 def stop(self): SlowStream.entered.set();SlowStream.gate.wait(20);self.active=False
def make(saves,settings,streams,cls=FakeStream):
 def factory():
  capture=WindowsInputCapture(stream_factory=lambda **kw:streams.append(cls(**kw)) or streams[-1]);return capture
 return WindowsRecordingManager(str(settings),str(saves),capture_factory=factory,
  device_query=lambda:[dict(name='Test',hostapi=0,max_input_channels=2,default_samplerate=8000)],host_query=lambda:[dict(name='Test API')])
with tempfile.TemporaryDirectory(dir=root) as d:
 base=pathlib.Path(d);local=base/'Local';local.mkdir();saves=base/'saves';saves.mkdir()
 old=os.environ.get('LOCALAPPDATA');os.environ['LOCALAPPDATA']=str(local)  # the launcher log goes to the sandbox
 try:
  # Closing the window during a recording stops it cleanly: the WAV is finalised and renamed
  streams=[];manager=make(saves,base/'s1.json',streams);axiom=FakeAxiom();axiom.SET_RECORDING_MANAGER=manager
  calls=[];real_stop=manager.stop;manager.stop=lambda:calls.append('stop') or real_stop()
  name=manager.devices()['devices'][0]['name'];started=manager.start(source_mode='device',source_id=name)
  output=pathlib.Path(started['output_path']);partial=output.with_name(output.name+'.partial')
  streams[0].callback(np.full((80,2),.5,dtype=np.float32),80,None,OVERFLOW)
  L.finish_recording(axiom)
  assert calls==['stop'] and not manager._capture
  assert output.is_file() and not partial.exists()
  with wave.open(str(output),'rb') as f: assert f.getnframes()==80 and f.getframerate()==8000
  state=manager.status();assert state['status']=='saved' and state['saved_path']==str(output) and state['dropouts']==1
  assert 'dropout' in state['message']
  log=L.log_file().read_text(encoding='utf-8');assert 'stopped and saved it' in log and '1 short dropouts' in log
  calls.clear();L.finish_recording(axiom);assert calls==[]  # nothing recording: nothing to stop
  L.finish_recording(object())  # a backend without a recording manager is fine
  # A restart after the clean stop sees a finished recording, not an interrupted one
  assert WindowsRecordingManager(str(base/'s1.json'),str(saves)).status()['status']=='saved'
  # If the clean stop raises, it is logged and the partial file stays recoverable
  streams.clear();manager=make(saves,base/'s2.json',streams);axiom.SET_RECORDING_MANAGER=manager
  started=manager.start(source_mode='device',source_id=name);output=pathlib.Path(started['output_path']);partial=output.with_name(output.name+'.partial')
  streams[0].callback(np.full((80,2),.5,dtype=np.float32),80,None,None)
  def boom(): raise RuntimeError('simulated stop failure')
  manager.stop_if_recording=boom;L.finish_recording(axiom)
  assert 'could not be stopped cleanly' in L.log_file().read_text(encoding='utf-8') and partial.is_file()
  del manager.stop_if_recording;manager.stop()  # tidy up the fake take
  # A real device error: the take is still finalised and the problem is reported
  streams.clear();manager=make(saves,base/'s3.json',streams);started=manager.start(source_mode='device',source_id=name)
  streams[0].callback(np.full((80,2),.5,dtype=np.float32),80,None,None);streams[0].active=False
  result=manager.stop_if_recording();output=pathlib.Path(started['output_path'])
  assert result['status']=='saved' and 'unexpectedly' in result['error'] and output.is_file()
  # An MP3 encode does not hold the lock: status() answers while it runs, and a new take waits
  streams.clear();manager=make(saves,base/'s4.json',streams);ffmpeg=base/'ffmpeg.exe';ffmpeg.write_bytes(b'x');manager._ffmpeg=str(ffmpeg)
  manager.load_settings=lambda:{'format':'mp3','source_mode':'device'}
  inside,release=threading.Event(),threading.Event()
  def encode(wav): inside.set();release.wait(20);return str(pathlib.Path(wav).with_suffix('.mp3'))
  manager._encode_mp3=encode
  manager.start(source_mode='device',source_id=name);streams[0].callback(np.full((80,2),.5,dtype=np.float32),80,None,None)
  worker=threading.Thread(target=manager.stop);worker.start()
  assert inside.wait(20)
  began=time.monotonic();busy=manager.status();assert time.monotonic()-began<2 and busy['status']=='stopping'
  import json  # the finished WAV is already on record, so a crash during the encode is not "interrupted"
  saved=json.loads(pathlib.Path(manager.state_path).read_text(encoding='utf8'))
  assert saved['status']=='saved' and saved['format']=='wav' and pathlib.Path(saved['saved_path']).is_file() and saved['message']=='Encoding MP3'
  assert WindowsRecordingManager(str(base/'s4.json'),str(saves)).status()['status']=='saved'
  try:manager.start(source_mode='device',source_id=name)
  except RuntimeError as exc:assert 'still being saved' in str(exc)
  else:raise AssertionError('a new take started during the encode')
  release.set();worker.join(20);assert manager.status()['status']=='saved' and manager.status()['format']=='mp3'
  # Stop (MP3) clicked and the window closed at once: the launcher waits for the stop that is already running
  streams.clear();manager=make(saves,base/'s5.json',streams,SlowStream);manager._ffmpeg=str(ffmpeg)
  manager.load_settings=lambda:{'format':'mp3','source_mode':'device'}
  inside2,release2=threading.Event(),threading.Event()
  def encode2(wav): inside2.set();release2.wait(20);return str(pathlib.Path(wav).with_suffix('.mp3'))
  manager._encode_mp3=encode2
  manager.start(source_mode='device',source_id=name);streams[0].callback(np.full((80,2),.5,dtype=np.float32),80,None,None)
  http=threading.Thread(target=manager.stop);http.start();assert SlowStream.entered.wait(20)  # the HTTP stop holds the lock inside stream.stop()
  outcome=[];closer=threading.Thread(target=lambda:outcome.append(manager.stop_if_recording()));closer.start()
  time.sleep(.5);SlowStream.gate.set()
  assert inside2.wait(20);time.sleep(.6);assert closer.is_alive() and not outcome  # still waiting while the encode runs
  release2.set();closer.join(20);http.join(20)
  assert outcome==[None] and manager.status()['status']=='saved' and manager.status()['format']=='mp3'
  # A stop that hangs does not hold the launcher: it gives up after the limit, tells a second launch, and logs it
  class Hung:
   def __init__(self): self.stuck=threading.Event()
   def status(self): return {'format':'wav'}
   def stop_if_recording(self): self.stuck.wait(20)
  class Instance:
   published=[]
   def publish(self,port): Instance.published.append(port)
  hung=Hung();axiom.SET_RECORDING_MANAGER=hung;began=time.monotonic()
  L.finish_recording(axiom,Instance(),wav_seconds=.5)
  assert time.monotonic()-began<5 and Instance.published==[0]
  assert 'took longer than 0.5 s' in L.log_file().read_text(encoding='utf-8');hung.stuck.set()
 finally:
  if old is None:os.environ.pop('LOCALAPPDATA',None)
  else:os.environ['LOCALAPPDATA']=old
print('PASS: closing the window finishes the recording; a failed stop leaves the partial; MP3 encoding does not block status')
