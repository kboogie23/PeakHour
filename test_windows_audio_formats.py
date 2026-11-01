import hashlib,pathlib,subprocess,sys,tempfile,wave
import imageio_ffmpeg
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_audio import WindowsAudioDeck
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);cache=d/'cache';cache.mkdir();source=d/'source.wav'
 with wave.open(str(source),'wb') as w:w.setparams((2,2,44100,0,'NONE','not compressed'));w.writeframes(bytes(44100*4))
 deck=WindowsAudioDeck(ffmpeg=ffmpeg,cache_root=str(cache))
 try:
  for ext,codec in [('mp3','libmp3lame'),('m4a','aac'),('aac','aac'),('flac','flac'),('ogg','libvorbis'),('aiff','pcm_s16be')]:
   f=d/('silent.'+ext)
   subprocess.run([ffmpeg,'-v','error','-i',str(source),'-c:a',codec,str(f)],check=True,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
   before=hashlib.sha256(f.read_bytes()).hexdigest();state=deck.play(str(f));assert state['playing'] and state['duration']>0
   deck.pause();deck.seek(.5);deck.stop()
   assert hashlib.sha256(f.read_bytes()).hexdigest()==before and not list(cache.iterdir())
  bad=d/'invalid.m4a';bad.write_bytes(b'not audio')
  try:deck.play(str(bad))
  except RuntimeError:pass
  else:raise AssertionError('invalid M4A accepted')
  assert not list(cache.iterdir()) and bad.read_bytes()==b'not audio'
 finally:deck.stop()
print('PASS: silent MP3, M4A, AAC, FLAC, AIFF and Ogg preview, source preservation and cache cleanup')
