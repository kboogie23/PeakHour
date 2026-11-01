import pathlib,sys,tempfile,wave
import numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
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
 capture._stream.callback(np.zeros((4,2),dtype=np.float32),4,None,'overflow')
 try:capture.stop()
 except CaptureError: pass
 else:raise AssertionError('overflow not reported')
 assert not q.exists() and q.with_name(q.name+'.partial').exists()
 r=pathlib.Path(d)/'lost.wav';capture.start(r,device=0,samplerate=8000)
 capture._stream.callback(np.zeros((4,2),dtype=np.float32),4,None,None);capture._stream.active=False
 try:capture.stop()
 except CaptureError as exc: assert 'unexpectedly' in str(exc)
 else:raise AssertionError('device loss not reported')
 assert not r.exists() and r.with_name(r.name+'.partial').exists()
 print('PASS: synthetic channel capture, no overwrite, overflow and device-loss recovery')
