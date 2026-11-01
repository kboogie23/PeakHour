import hashlib,pathlib,sys,tempfile,threading,wave
import imageio_ffmpeg
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
from windows_audio_process import ffmpeg_popen_factory
from studio_daw import waveforms
with tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).resolve().parent) as d:
 d=pathlib.Path(d);source=d/'input.wav';output=d/'prepared.wav'
 with wave.open(str(source),'wb') as w:
  w.setparams((1,2,44100,0,'NONE','not compressed'));w.writeframes(bytes(44100*2))
 sha=hashlib.sha256(source.read_bytes()).hexdigest();ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
 old=waveforms.subprocess.Popen;waveforms.subprocess.Popen=ffmpeg_popen_factory(ffmpeg)
 try:
  result=waveforms.decode(source,output,ffmpeg,threading.Event())
  assert result==sha and hashlib.sha256(source.read_bytes()).hexdigest()==sha
  with wave.open(str(output),'rb') as w: assert w.getnframes()>0 and w.getnchannels()==2
  cancelled=threading.Event();cancelled.set()
  try:waveforms.decode(source,d/'cancel.wav',ffmpeg,cancelled)
  except (InterruptedError,RuntimeError):pass
  else:raise AssertionError('pre-cancelled decoding not rejected')
 finally:waveforms.subprocess.Popen=old
 print('PASS: original waveform preparation with Windows FFmpeg; source intact and cancellation respected')
