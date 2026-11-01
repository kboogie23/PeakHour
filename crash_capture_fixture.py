import os,pathlib,sys,time
import numpy as np
root=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_capture import WindowsInputCapture
class Fake:
 def __init__(self,**kw):self.callback=kw['callback'];self.active=False
 def start(self):self.active=True
 def stop(self):self.active=False
 def close(self):pass
capture=WindowsInputCapture(stream_factory=Fake)
capture.start(sys.argv[1],device=0,samplerate=8000,channels=(0,1))
for i in range(50):capture._stream.callback(np.full((1024,2),0.25,dtype=np.float32),1024,None,None)
deadline=time.monotonic()+10
while capture.status()['frames'] < 50*1024 and time.monotonic()<deadline:time.sleep(.01)
if capture.status()['frames'] != 50*1024:os._exit(2)
os._exit(0)
