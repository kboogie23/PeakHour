import hashlib,pathlib,subprocess,sys,tempfile
import imageio_ffmpeg
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_video_preview import create_video_preview,VideoPreviewError
from windows_media_probe import probe_media
ff=imageio_ffmpeg.get_ffmpeg_exe()
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d)
 specs=[('sample.mp4',['-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac']),('sample.avi',['-c:v','mpeg4','-c:a','libmp3lame']),('sample.vob',['-c:v','mpeg2video','-c:a','ac3','-f','vob'])]
 for index,(name,options) in enumerate(specs):
  source=d/name;destination=d/f'preview-{index}.mp4'
  subprocess.run([ff,'-v','error','-f','lavfi','-i','color=black:s=160x120:r=25','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1',*options,str(source)],check=True,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
  before=hashlib.sha256(source.read_bytes()).hexdigest()
  r=create_video_preview(source,destination,scratch_dir=d,ffmpeg=ff);assert r['audio'] and r['duration_seconds']>0
  result=probe_media(destination,scratch_dir=d);assert any(s['type']=='video' and s['codec']=='h264' for s in result['streams'])
  assert any(s['type']=='audio' and s['codec']=='aac' for s in result['streams'])
  assert hashlib.sha256(source.read_bytes()).hexdigest()==before
  try:create_video_preview(source,destination,scratch_dir=d,ffmpeg=ff)
  except FileExistsError:pass
  else:raise AssertionError('existing preview overwritten')
 print('PASS: generated AVI, MP4 and VOB converted to verified browser video with unchanged source')
