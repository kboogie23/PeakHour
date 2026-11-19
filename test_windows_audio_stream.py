import ctypes,pathlib,subprocess,sys,tempfile,threading,time
from unittest.mock import patch
import numpy as np
import imageio_ffmpeg
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
import windows_audio as wa
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
class FakeStream:
 def __init__(self,**kwargs):self.closed=False
 def start(self):pass
 def stop(self):pass
 def close(self):self.closed=True
def run(*args):subprocess.run([ffmpeg,'-v','error','-y',*args],check=True,stdin=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
def handles():
 count=ctypes.c_ulong();ctypes.windll.kernel32.GetProcessHandleCount(ctypes.windll.kernel32.GetCurrentProcess(),ctypes.byref(count));return count.value
def pump(deck,seconds=5):
 """Call the audio callback the way PortAudio would until it produces sound; returns the elapsed time."""
 out=np.zeros((1024,2),dtype='float32');start=time.perf_counter()
 while time.perf_counter()-start<seconds:
  deck._callback(out,1024,None,None)
  if np.abs(out).max()>0:return time.perf_counter()-start
  time.sleep(.002)
 raise AssertionError('no audio produced')
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);m4a=d/'tone.m4a';mp4=d/'clip.mp4'
 run('-f','lavfi','-i','sine=frequency=440:duration=40','-c:a','aac',str(m4a))
 run('-f','lavfi','-i','testsrc=duration=4:size=64x64:rate=10','-f','lavfi','-i','sine=frequency=330:duration=4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',str(mp4))
 with patch.object(wa.sd,'OutputStream',FakeStream),patch.object(wa.sd,'query_devices',return_value={'max_output_channels':2}):
  deck=wa.WindowsAudioDeck()
  try:
   # playback starts right away and the long file is not converted first
   t=time.perf_counter();state=deck.play(str(m4a));first=pump(deck);total=time.perf_counter()-t
   print('m4a time to first audio: %.3f s'%total);assert total<1 and state['playing'] and abs(state['duration']-40)<.5
   # seek re-opens at the new position and plays from there
   assert abs(deck.seek(25)['current_time']-25)<.01;pump(deck);after=deck.status()['current_time'];assert 25<=after<26,after
   deck.pause();assert not deck.status()['playing'];deck.resume();deck.seek_relative(-5);pump(deck);assert 19.9<deck.status()['current_time']<21
   # the end of the file is reported
   deck.seek(39.9);out=np.zeros((1024,2),dtype='float32');end=time.time()+5
   while not deck.status()['ended'] and time.time()<end:deck._callback(out,1024,None,None);time.sleep(.002)
   assert deck.status()['ended'] and not deck.status()['playing'],deck.status()
   assert deck.play(str(mp4),start_time=1)['has_track'];pump(deck);assert deck.status()['current_time']>=1
   # status, seek and the callback never wait for a stalled reader or for the control lock
   gate=threading.Event();original=deck._open_audio
   def stalled(path,cancelled):
    source=original(path,cancelled);read=source.read
    def slow(frames):
     assert gate.wait(10);return read(frames)
    source.read=slow;return source
   deck._open_audio=stalled;deck.play(str(m4a));out=np.ones((1024,2),dtype='float32')
   begin=time.perf_counter();deck._callback(out,1024,None,None);deck.status();deck.set_volume(.5);deck.seek(3)
   assert time.perf_counter()-begin<.1 and not out.any(),'callback must output silence on underrun without waiting'
   done=threading.Event()
   def hold():
    with deck._lock:done.wait(5)
   holder=threading.Thread(target=hold);holder.start();time.sleep(.05);begin=time.perf_counter();deck._callback(out,1024,None,None)
   assert time.perf_counter()-begin<.05;done.set();holder.join()
   gate.set();deck._open_audio=original;pump(deck)
   deck.stop()
   # many play/stop cycles leave no reader threads or handles behind
   threads=threading.active_count();before=handles()
   for i in range(40):
    deck.play(str(m4a if i%2 else mp4));pump(deck);deck.stop()
   assert not [x for x in threading.enumerate() if x.name=='peakhour-audio-reader']
   assert threading.active_count()==threads and handles()-before<=3,(threading.active_count(),threads,handles(),before)
   (d/'tone.m4a').rename(d/'moved.m4a')  # the file is not held open after stop
  finally:deck.stop()
# streamed files are resampled to the output device's rate; unknown durations are not clamped
rates=[]
class RateStream(FakeStream):
 def __init__(self,**kwargs):super().__init__();rates.append(kwargs['samplerate'])
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);odd=d/'odd.m4a';run('-f','lavfi','-i','sine=frequency=440:duration=10','-ar','32000','-c:a','aac',str(odd))
 with patch.object(wa.sd,'OutputStream',RateStream),patch.object(wa.sd,'query_devices',return_value={'max_output_channels':2,'default_samplerate':48000.0}):
  deck=wa.WindowsAudioDeck()
  try:
   state=deck.play(str(odd),start_time=4);pump(deck);assert rates==[48000],rates
   assert abs(state['duration']-10)<.5 and 4<=deck.status()['current_time']<5,deck.status()
   deck.stop();original=deck._open_audio
   def unknown(path,cancelled):
    source=original(path,cancelled);source.length=0;source.duration=0.0;return source
   deck._open_audio=unknown;deck.play(str(odd),start_time=6);pump(deck);assert 6<=deck.status()['current_time']<7,deck.status()
  finally:deck.stop()
print('PASS: M4A/MP4 stream-decode starts within a second, seeks, never blocks the callback or status, and leaks nothing')
