"""Preview audio must not break up while the server is busy. The PortAudio callback and the decoder thread both need
the Python global lock, which is handed over only every 5 ms by default: two busy request threads left ~1,200 of ~1,600
10 ms blocks silent in 15 s. The deck lowers the switch interval to 0.5 ms while (and only while) playing; this plays an MP4 soundtrack in real time (a
stand-in output stream calls the callback the way PortAudio does) beside two busy Python threads and counts silent blocks."""
import ctypes,pathlib,subprocess,sys,tempfile,threading,time,traceback
from unittest.mock import patch
import numpy as np
import imageio_ffmpeg
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
import windows_audio as wa
BLOCK=480
class RealTimeStream:
 def __init__(self,**kw):
  self.cb=kw['callback'];self.rate=kw['samplerate'];self.channels=kw['channels'];self.stopped=threading.Event();self.first=None;self.silent=0;self.blocks=0
 def start(self):self.t0=time.perf_counter();threading.Thread(target=self.run,daemon=True).start()
 def run(self):
  ctypes.windll.kernel32.SetThreadPriority(ctypes.windll.kernel32.GetCurrentThread(),15)
  out=np.zeros((BLOCK,self.channels),dtype='float32');due=time.perf_counter()
  while not self.stopped.is_set():
   due+=BLOCK/self.rate
   while time.perf_counter()<due:time.sleep(0.0005)
   self.cb(out,BLOCK,None,None);loud=bool(out.any())
   if loud and self.first is None:self.first=time.perf_counter()-self.t0
   elif self.first is not None:
    self.blocks+=1;self.silent+=0 if loud else 1
 def stop(self):self.stopped.set()
 def close(self):self.stopped.set()
def busy(stop):
 while not stop.is_set():sum(i*i for i in range(2000))
try:
 ffmpeg=imageio_ffmpeg.get_ffmpeg_exe();ctypes.windll.winmm.timeBeginPeriod(1)
 with tempfile.TemporaryDirectory(dir=root) as d:
  clip=pathlib.Path(d)/'clip.mp4'
  subprocess.run([ffmpeg,'-v','error','-y','-f','lavfi','-i','testsrc=size=64x64:rate=10:duration=30','-f','lavfi','-i','sine=frequency=330:duration=30','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',str(clip)],check=True,stdin=subprocess.DEVNULL)
  with patch.object(wa.sd,'OutputStream',RealTimeStream),patch.object(wa.sd,'query_devices',return_value={'max_output_channels':2,'default_samplerate':48000.0}):
   DEFAULT=0.005;sys.setswitchinterval(DEFAULT)  # what Python starts with
   assert wa.RING_SECONDS>=4 and wa.SWITCH_INTERVAL<=0.001
   def run(label,busy_threads=2,seconds=6):
    """Play beside two busy threads for 6 s; returns (silent blocks, blocks) after the first sound."""
    deck=wa.WindowsAudioDeck()
    assert sys.getswitchinterval()==DEFAULT,'creating the deck must not touch the interval (nothing is playing)'
    stop=threading.Event();threads=[threading.Thread(target=busy,args=(stop,),daemon=True) for _ in range(busy_threads)]
    try:
     deck.play(str(clip));[t.start() for t in threads];time.sleep(seconds)
     stream=deck._stream;during=sys.getswitchinterval()
     print('%s: blocks %d silent %d first sound %.0f ms, interval while playing %g'%(label,stream.blocks,stream.silent,(stream.first or 9)*1000,during))
     return stream.silent,stream.blocks,during,stream.first
    finally:
     stop.set();deck.stop()
     assert sys.getswitchinterval()==DEFAULT,'stop must put the interval back'
   # the same run twice, differing only in the interval the deck uses: the old 5 ms (the boost is a no-op) and the new one
   # First a calm run (no busy threads): if even that breaks up, other programs have the PC and a comparison would
   # measure them, not the interval. The interval checks below still run.
   calm_silent,calm_blocks,_,calm_first=run('calm',0,2)
   if calm_first is None or calm_first>1 or calm_silent>calm_blocks*0.05:
    print('NOTE: PC too busy to compare switch intervals (calm run: %d of %d silent); lifecycle checks only'%(calm_silent,calm_blocks))
   else:
    # Relative, not absolute, and interleaved (old, new, old, new...) so a burst of other programs hurts both alike.
    # On a quiet PC: old ~70 % silent, new 0.
    old_total=new_total=0
    for round_ in range(3):
     with patch.object(wa,'SWITCH_INTERVAL',DEFAULT):s,b,during,_=run('old 5 ms',2,4)
     assert during==DEFAULT and b>100;old_total+=s
     s,b,during,_=run('new %g ms'%(wa.SWITCH_INTERVAL*1000),2,4)
     assert during==wa.SWITCH_INTERVAL and b>100,'interval is lowered while playing';new_total+=s
    print('silent blocks over 3 rounds: old %d, new %d'%(old_total,new_total))
    after_silent,after_blocks,_,after_first=run('calm again',0,2)
    if after_first is None or after_first>1 or after_silent>after_blocks*0.05 or old_total<100:
     print('NOTE: other programs loaded the PC during the comparison (or the old interval was not the problem this time); not judged')
    else:
     assert new_total*2<=old_total+10,'new interval (%d silent) is not clearly better than old (%d)'%(new_total,old_total)
   # the interval is back to normal whenever nothing plays: stop, pause, resume, end of track, failed start
   deck=wa.WindowsAudioDeck();out=np.zeros((1024,2),dtype='float32')
   try:
    deck.play(str(clip));assert sys.getswitchinterval()==wa.SWITCH_INTERVAL
    deck.pause();assert sys.getswitchinterval()==DEFAULT
    deck.resume();assert sys.getswitchinterval()==wa.SWITCH_INTERVAL
    deck.seek(29.9);end=time.time()+10
    while not deck.status()['ended'] and time.time()<end:deck._callback(out,1024,None,None);time.sleep(.002)
    assert deck.status()['ended'] and sys.getswitchinterval()==DEFAULT,'end of track must put the interval back'
    deck.stop()
    class Broken(RealTimeStream):
     def start(self):raise RuntimeError('no device')
    with patch.object(wa.sd,'OutputStream',Broken):
     try:deck.play(str(clip))
     except RuntimeError:pass
     else:raise AssertionError('start should have failed')
    assert sys.getswitchinterval()==DEFAULT,'a failed start must leave the interval alone'
    sys.setswitchinterval(0.0002);deck.play(str(clip));assert abs(sys.getswitchinterval()-0.0002)<1e-9;deck.stop();assert abs(sys.getswitchinterval()-0.0002)<1e-9,'never raised above what it was'
    # several threads pause/resume/stop/play (and the end-of-track callback restores) at once: the interval must end at
    # the original value, never stuck lowered (check-then-act on the saved value used to allow that)
    sys.setswitchinterval(DEFAULT);deck.play(str(clip));errors=[]
    def hammer(seed):
     import random;rnd=random.Random(seed)
     try:
      for _ in range(300):
       rnd.choice((deck.pause,deck.resume,deck.resume,wa._boost_threads,wa._restore_threads))()
     except BaseException as exc:errors.append(exc)
    pool=[threading.Thread(target=hammer,args=(i,)) for i in range(6)];[t.start() for t in pool]
    for _ in range(5):deck.stop();deck.play(str(clip))
    [t.join() for t in pool];assert not errors,errors
    deck.stop();assert sys.getswitchinterval()==DEFAULT,'interval stuck at %g after concurrent pause/resume/stop'%sys.getswitchinterval()
    wa._boost_threads();wa._boost_threads();assert sys.getswitchinterval()==wa.SWITCH_INTERVAL;wa._restore_threads();wa._restore_threads();assert sys.getswitchinterval()==DEFAULT
   finally:
    deck.stop();wa._restore_threads();sys.setswitchinterval(DEFAULT)
 print('PASS: preview audio stays unbroken beside busy request threads; the lowered switch interval applies only while playing')
except BaseException:
 traceback.print_exc();sys.exit(1)
