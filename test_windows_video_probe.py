import hashlib,pathlib,subprocess,sys,tempfile,wave
import imageio_ffmpeg
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_media_probe import probe_media,MediaProbeError
from windows_audio import WindowsAudioDeck
ff=imageio_ffmpeg.get_ffmpeg_exe()
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);cache=d/'cache';cache.mkdir();deck=WindowsAudioDeck(ffmpeg=ff,cache_root=str(cache))
 specs=[('sample.mp4',['-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac']),('sample.avi',['-c:v','mpeg4','-c:a','libmp3lame']),('sample.vob',['-c:v','mpeg2video','-c:a','ac3','-f','vob'])]
 for name,options in specs:
  file=d/name
  subprocess.run([ff,'-v','error','-f','lavfi','-i','color=black:s=160x120:r=25','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1',*options,str(file)],check=True,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
  before=hashlib.sha256(file.read_bytes()).hexdigest();info=probe_media(str(file),scratch_dir=d)
  assert {s['type'] for s in info['streams']}=={'audio','video'}
  video=next(s for s in info['streams'] if s['type']=='video');assert video['width']==160 and video['height']==120
  assert info['duration_seconds'] is not None and info['duration_seconds']>0
  state=deck.play(str(file));assert state['playing'] and state['duration']>0
  deck.stop();assert not list(cache.iterdir())
  assert hashlib.sha256(file.read_bytes()).hexdigest()==before
 broken=d/'bad.avi';broken.write_bytes(b'not media')
 try:probe_media(str(broken),scratch_dir=d)
 except MediaProbeError:pass
 else:raise AssertionError('invalid media accepted')
 print('PASS: AVI, MP4 and VOB metadata and audio-preview decoding; source files unchanged')
