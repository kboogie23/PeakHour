import pathlib,sys,tempfile,threading,subprocess
from unittest.mock import patch
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
import windows_audio as wa
import windows_audio_process as process_module
class SlowProcess:
 def __init__(self):self.started=threading.Event();self.killed=False
 def wait(self,timeout=None):
  self.started.set()
  if self.killed:return 1
  raise subprocess.TimeoutExpired('synthetic-ffmpeg',timeout)
 def poll(self):return 1 if self.killed else None
 def kill(self):self.killed=True
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);cache=d/'cache';cache.mkdir();audio=d/'input.m4a';audio.write_bytes(b'invalid fixture');p=SlowProcess()
 deck=wa.WindowsAudioDeck(ffmpeg='unused',cache_root=str(cache));errors=[]
 def request():
  try:deck.play(str(audio))
  except Exception as e:errors.append(str(e))
 with patch.object(process_module,'ffmpeg_popen_factory',return_value=lambda *a,**k:p):
  t=threading.Thread(target=request);t.start();assert p.started.wait(5);deck.stop();t.join(5)
  assert not t.is_alive() and p.killed and errors and 'cancelled' in errors[0]
 assert not list(cache.iterdir()) and audio.read_bytes()==b'invalid fixture'
print('PASS: stop cancels pending FFmpeg decode and removes its temporary cache')
