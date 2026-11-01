"""Experimental offline browser-preview conversion for local DJ video files.

Creates a separate file; it is not yet exposed by the AXIOM UI. The helper is
not a decoder sandbox and must not be used as a real-library write operation.
"""
import math,os,tempfile
from pathlib import Path
from windows_audio_process import ffmpeg_popen_factory,DEVNULL,TimeoutExpired
from windows_media_probe import probe_media

VIDEO_EXTENSIONS={'.mp4','.m4v','.mov','.avi','.vob','.mpg','.mpeg'}
class VideoPreviewError(RuntimeError):pass

# Edge plays H.264 (8-bit 4:2:0) with AAC or MP3 sound in MP4/M4V/MOV as it is: such files stream straight from
# the library (no copy, no wait). H.264 in another container or with other sound keeps its picture and converts
# only the sound ('copy': seconds); anything else is converted in full ('convert': about a minute for a 4-minute
# music video). The page falls back to a full conversion if Edge cannot play a direct file after all.
DIRECT_CONTAINERS={'.mp4','.m4v','.mov'}
DIRECT_AUDIO={'aac','mp3',None}
DIRECT_PIXELS={'yuv420p','yuvj420p',None}

def preview_plan(info,suffix):
 video=next((s for s in info['streams'] if s['type']=='video'),None)
 if video is None:raise VideoPreviewError('No video stream found')
 audio=next((s['codec'] for s in info['streams'] if s['type']=='audio'),None)
 if video['codec']=='h264' and video.get('pix_fmt') in DIRECT_PIXELS:
  return 'direct' if audio in DIRECT_AUDIO and suffix.lower() in DIRECT_CONTAINERS else 'copy'
 return 'convert'

def create_video_preview(source,destination,*,scratch_dir,ffmpeg,timeout=180,max_bytes=512*1024*1024,mode='convert'):
 source=Path(source);destination=Path(destination)
 if not source.is_absolute() or source.suffix.lower() not in VIDEO_EXTENSIONS:
  raise VideoPreviewError('Choose a supported local video file')
 if not destination.is_absolute() or destination.suffix.lower()!='.mp4' or not destination.parent.is_dir():
  raise VideoPreviewError('Choose an MP4 preview destination in an existing folder')
 if os.path.lexists(destination):raise FileExistsError(destination)
 source=source.resolve(strict=True)
 before=source.stat()
 info=probe_media(str(source),scratch_dir=scratch_dir,timeout=min(timeout,20))
 if not any(s['type']=='video' for s in info['streams']):raise VideoPreviewError('No video stream found')
 duration=info.get('duration_seconds')
 if duration is None or not math.isfinite(duration) or duration<=0:
  raise VideoPreviewError('Video duration is unavailable')
 if not isinstance(max_bytes,int) or max_bytes<2*1024*1024:
  raise ValueError('Preview size limit is invalid')
 runner=ffmpeg_popen_factory(ffmpeg)
 with tempfile.TemporaryDirectory(prefix='axiom-video-',dir=destination.parent) as directory:
  stage=Path(directory)/'preview.mp4'
  args=[ffmpeg,'-nostdin','-v','error','-n','-protocol_whitelist','file','-i',str(source),
        '-map','0:v:0','-map','0:a:0?','-sn','-dn','-map_metadata','-1',
        *(['-c:v','copy'] if mode=='copy' else ['-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p']),
        '-c:a','aac','-movflags','+faststart',
        '-fs',str(max_bytes),str(stage)]
  process=runner(args,stdin=DEVNULL,stdout=DEVNULL,stderr=DEVNULL)
  try:
   try:code=process.wait(timeout=timeout)
   except TimeoutExpired:raise VideoPreviewError('Video preparation timed out') from None
  finally:
   if process.poll() is None:process.kill();process.wait()
  if code or not stage.is_file():raise VideoPreviewError('Video could not be prepared')
  if stage.stat().st_size>=max_bytes-1024*1024:raise VideoPreviewError('Video is too large for the preview cache')
  after=source.stat()
  if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):
   raise VideoPreviewError('Video changed during preparation')
  result=probe_media(str(stage),scratch_dir=scratch_dir,timeout=min(timeout,20))
  out_duration=result.get('duration_seconds')
  if not any(s['type']=='video' and s['codec']=='h264' for s in result['streams']):
   raise VideoPreviewError('Prepared video could not be verified')
  if out_duration is None or abs(out_duration-duration)>max(.5,duration*.02):
   raise VideoPreviewError('Prepared video duration differs from the source')
  source_audio=any(s['type']=='audio' for s in info['streams'])
  if source_audio and not any(s['type']=='audio' and s['codec']=='aac' for s in result['streams']):
   raise VideoPreviewError('Prepared audio could not be verified')
  os.link(stage,destination) # no overwrite; requires hard-link support
 return {'path':str(destination),'duration_seconds':out_duration,'audio':source_audio}
