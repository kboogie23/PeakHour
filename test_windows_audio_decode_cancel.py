import pathlib,sys,tempfile,threading
from unittest.mock import patch
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
import windows_audio as wa
made=[]
class SlowSource:
 length=0;duration=0.0;samplerate=44100;channels=2
 def __init__(self,path,rate=None):self.release=threading.Event();self.closed=False;made.append(self);assert self.release.wait(5)
 def close(self):self.closed=True
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);audio=d/'input.m4a';audio.write_bytes(b'invalid fixture')
 deck=wa.WindowsAudioDeck();errors=[]
 def request():
  try:deck.play(str(audio))
  except Exception as e:errors.append(str(e))
 with patch.object(wa,'_StreamSource',new=SlowSource):
  t=threading.Thread(target=request);t.start()
  while not made and t.is_alive():threading.Event().wait(.01)
  deck.stop();made[0].release.set();t.join(5)
  assert not t.is_alive() and errors and 'cancelled' in errors[0] and made[0].closed
 assert audio.read_bytes()==b'invalid fixture' and not deck.status()['has_track']
print('PASS: stop cancels a pending M4A open and closes the decoder')
