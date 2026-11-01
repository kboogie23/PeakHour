import pathlib,sys,tempfile,threading,wave,time
from unittest.mock import patch
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
import windows_audio as wa
class FakeStream:
 def __init__(self,**kwargs):self.closed=False
 def start(self):pass
 def stop(self):pass
 def close(self):self.closed=True
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);slow=d/'slow.wav';fast=d/'fast.wav'
 for f in (slow,fast):
  with wave.open(str(f),'wb') as w:w.setparams((2,2,8000,0,'NONE','not compressed'));w.writeframes(bytes(3200))
 deck=wa.WindowsAudioDeck();original=deck._open_audio;entered=threading.Event();release=threading.Event();errors=[]
 def delayed(path,cancelled):
  if str(path)==str(slow):entered.set();assert release.wait(5)
  return original(path,cancelled)
 deck._open_audio=delayed
 def play_slow():
  try:deck.play(str(slow))
  except Exception as e:errors.append(str(e))
 with patch.object(wa.sd,'OutputStream',FakeStream),patch.object(wa.sd,'query_devices',return_value={'max_output_channels':2}):
  t=threading.Thread(target=play_slow);t.start();assert entered.wait(5)
  deck.stop();release.set();t.join(5);assert not t.is_alive() and errors and not deck.status()['has_track']
  errors.clear();entered.clear();release.clear();t=threading.Thread(target=play_slow);t.start();assert entered.wait(5)
  deck.play(str(fast));release.set();t.join(5);assert not t.is_alive() and errors and deck.status()['path']==str(fast)
  deck.stop()
print('PASS: stop and newer playback prevent delayed earlier requests from starting')
