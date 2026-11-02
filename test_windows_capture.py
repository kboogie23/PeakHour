import pathlib,sys,tempfile,wave
import numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
import threading,time
import sounddevice as sd
OVERFLOW=sd.CallbackFlags();OVERFLOW.input_overflow=True  # what PortAudio really passes
import windows_capture
from windows_capture import WindowsInputCapture,CaptureError
class FakeStream:
 def __init__(self,**kw): self.callback=kw['callback'];self.active=False
 def start(self): self.active=True
 def stop(self): self.active=False
 def close(self): pass
with tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).resolve().parent) as d:
 p=pathlib.Path(d)/'take.wav'; capture=WindowsInputCapture(stream_factory=FakeStream)
 capture.start(p,device=0,samplerate=8000,channels=(2,3),input_channels=4)
 samples=np.zeros((80,4),dtype=np.float32);samples[:,2]=.5;samples[:,3]=-.25
 capture._stream.callback(samples,80,None,None)
 assert capture.stop()==str(p)
 with wave.open(str(p),'rb') as f:
  assert f.getnchannels()==2 and f.getframerate()==8000 and f.getnframes()==80
  pcm=np.frombuffer(f.readframes(80),dtype='<i2').reshape(-1,2)
  assert (pcm[:,0]==16383).all() and (pcm[:,1]==-8191).all()
 try: capture.start(p,device=0)
 except FileExistsError: pass
 else: raise AssertionError('existing file overwritten')
 q=pathlib.Path(d)/'bad.wav';capture.start(q,device=0,samplerate=8000)
 capture._stream.callback(np.zeros((4,2),dtype=np.float32),4,None,OVERFLOW)
 capture._stream.callback(np.zeros((4,2),dtype=np.float32),4,None,None)
 assert capture.status()['dropouts']==1 and capture.status()['error'] is None  # one overflow is a dropout, not a failure
 assert capture.stop()==str(q) and q.exists() and not q.with_name(q.name+'.partial').exists()  # the take is still finalised and renamed
 with wave.open(str(q),'rb') as f: assert f.getnframes()==8
 r=pathlib.Path(d)/'lost.wav';capture.start(r,device=0,samplerate=8000)
 capture._stream.callback(np.zeros((4,2),dtype=np.float32),4,None,None);capture._stream.active=False
 assert capture.stop()==str(r)  # a real device failure is still reported, but what was recorded is finalised
 assert 'unexpectedly' in capture.status()['error'] and r.exists() and not r.with_name(r.name+'.partial').exists()
 with wave.open(str(r),'rb') as f: assert f.getnframes()==4
 # A writer that falls behind: blocks that do not fit in the queue are dropped and replaced by silence, the take survives
 s=pathlib.Path(d)/'slow.wav';capture=WindowsInputCapture(stream_factory=FakeStream,queue_seconds=0.03)  # 240 frames at 8 kHz
 gate=threading.Event();write=capture._write;capture._write=lambda f:(gate.wait(10),write(f))  # the writer is stalled until released
 capture.start(s,device=0,samplerate=8000)
 loud=np.full((100,2),.5,dtype=np.float32)
 for _ in range(4):capture._stream.callback(loud,100,None,None)  # two fit; the others are dropped as one dropout
 assert capture.status()['dropouts']==1 and capture.status()['dropped_frames']==200
 gate.set()
 deadline=time.monotonic()+10
 while capture._queued_frames and time.monotonic()<deadline:time.sleep(.01)
 capture._stream.callback(loud,100,None,None)
 assert capture.stop()==str(s) and capture.status()['dropouts']==1 and capture.status()['error'] is None
 with wave.open(str(s),'rb') as f:
  assert f.getnframes()==500  # 200 recorded, 200 of silence in place of the dropped blocks, 100 after
  pcm=np.frombuffer(f.readframes(500),dtype='<i2').reshape(-1,2)
  assert (pcm[:200]==16383).all() and (pcm[200:400]==0).all() and (pcm[400:]==16383).all()
 # The default queue holds about 30 seconds of audio whatever the block size
 capture=WindowsInputCapture(stream_factory=FakeStream);t=pathlib.Path(d)/'q.wav';capture.start(t,device=0,samplerate=48000)
 assert capture._queue_limit==48000*30
 capture._stream.callback(np.zeros((64,2),dtype=np.float32),64,None,None);capture.stop()
 # A take that reaches the WAV size limit stops writing, is flagged, and is still a valid file
 old=windows_capture.MAX_WAV_DATA_BYTES;windows_capture.MAX_WAV_DATA_BYTES=4*150
 try:
  capture=WindowsInputCapture(stream_factory=FakeStream);u=pathlib.Path(d)/'full.wav';capture.start(u,device=0,samplerate=8000)
  for _ in range(3):capture._stream.callback(loud,100,None,None)
  deadline=time.monotonic()+10
  while not capture.status()['limit_reached'] and time.monotonic()<deadline:time.sleep(.01)
  assert capture.status()['limit_reached'] and 'size limit' in capture.status()['warning']
  assert capture.stop()==str(u)
 finally:windows_capture.MAX_WAV_DATA_BYTES=old
 with wave.open(str(u),'rb') as f: assert f.getnframes()==100
 # A stream that cannot continue reports its reason as text (ProcessLoopbackStream): a failure with that message; the take is still saved
 v=pathlib.Path(d)/'ended.wav';capture=WindowsInputCapture(stream_factory=FakeStream);capture.start(v,device=0,samplerate=8000)
 capture._stream.callback(loud,100,None,None)
 capture._stream.callback(np.zeros((0,2),dtype=np.float32),0,None,'The application audio stream ended (the program may have closed).')
 assert capture.status()['dropouts']==0 and 'program may have closed' in capture.status()['error']
 assert capture.stop()==str(v) and 'program may have closed' in capture.status()['error'] and v.exists()
 with wave.open(str(v),'rb') as f: assert f.getnframes()==100
 # A long pause delivered as one silent block (or as add_gap) is silence in the file, not a dropout
 w=pathlib.Path(d)/'pause.wav';capture=WindowsInputCapture(stream_factory=FakeStream,queue_seconds=0.03);capture.start(w,device=0,samplerate=8000)
 capture._stream.callback(np.zeros((300,2),dtype=np.float32),300,None,None)  # longer than the 240-frame queue
 capture.add_gap(50);capture._stream.callback(loud,100,None,None)
 assert capture.stop()==str(w) and capture.status()['dropouts']==0
 with wave.open(str(w),'rb') as f: assert f.getnframes()==450
 # The loopback stream finds add_gap through the callback's owner (no giant silent array)
 assert getattr(getattr(capture._callback,'__self__',None),'add_gap',None) is not None
 print('PASS: synthetic channel capture, no overwrite, overflow and queue-full dropouts, device-loss and size-limit finalising, stream-ended message, long pauses')
