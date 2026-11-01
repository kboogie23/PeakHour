"""Experimental loopback-only video-preview API; not enabled by default."""
import re,tempfile,threading,uuid
from pathlib import Path
from flask import Blueprint,request,jsonify,send_file
from windows_video_preview import create_video_preview,preview_plan,VideoPreviewError
from windows_media_probe import MediaProbeError,probe_media

class VideoPreviewStore:
 def __init__(self,root,allowed_path,ffmpeg):
  self.root=Path(root).resolve(strict=True);self.allowed_path=allowed_path;self.ffmpeg=ffmpeg
  self._lock=threading.RLock();self._items={}
 def prepare(self,path,convert=False):
  source=Path(path).resolve(strict=True)
  if not source.is_file() or not self.allowed_path(source):raise ValueError('Video path is not permitted')
  with self._lock:
   if len(self._items)>=4:raise ValueError('Close an existing video preview first')
   info=probe_media(str(source),scratch_dir=self.root)
   plan='convert' if convert else preview_plan(info,source.suffix)
   audio=any(s['type']=='audio' for s in info['streams'])
   if plan=='direct':  # played from the library file itself; nothing is copied or written
    key=uuid.uuid4().hex;self._items[key]=(None,source)
    return {'id':key,'duration_seconds':info.get('duration_seconds'),'audio':audio,'mode':'direct'}
   directory=tempfile.TemporaryDirectory(prefix='preview-',dir=self.root)
   try:
    output=Path(directory.name)/'video.mp4'
    result=create_video_preview(source,output,scratch_dir=self.root,ffmpeg=self.ffmpeg,mode=plan)
    key=uuid.uuid4().hex;self._items[key]=(directory,output)
    return {'id':key,'duration_seconds':result['duration_seconds'],'audio':result['audio'],'mode':plan}
   except BaseException:
    directory.cleanup();raise
 def get(self,key):
  if not re.fullmatch(r'[0-9a-f]{32}',key):raise KeyError(key)
  with self._lock:
   if key not in self._items:raise KeyError(key)
   return self._items[key][1]
 def remove(self,key):
  with self._lock:
   if key not in self._items:raise KeyError(key)
   directory,_=self._items[key]
   if directory is not None:directory.cleanup()
   del self._items[key]
 def close(self):
  with self._lock:
   for key in list(self._items):self.remove(key)

def create_video_blueprint(store):
 bp=Blueprint('windows_video_preview',__name__)
 @bp.before_request
 def local_only():
  if request.remote_addr not in ('127.0.0.1','::1') or request.host.split(':')[0] not in ('localhost','127.0.0.1'):
   return jsonify(error='Video preview requires a local connection'),403
  origin=request.headers.get('Origin')
  if origin and origin.rstrip('/')!=request.host_url.rstrip('/'):
   return jsonify(error='Video preview requires a same-origin connection'),403
  if request.method in ('POST','DELETE') and not origin:
   return jsonify(error='Video preview changes require a same-origin request'),403
 @bp.get('/api/windows/video/capabilities')
 def capabilities():return jsonify(video_preview=True)
 @bp.post('/api/windows/video/prepare')
 def prepare():
  if request.content_length is not None and request.content_length>16384:return jsonify(error='Video request is too large'),413
  data=request.get_json(silent=True)
  if not isinstance(data,dict) or not isinstance(data.get('path'),str):return jsonify(error='Video path is required'),400
  try:return jsonify(success=True,**store.prepare(data['path'],convert=data.get('convert') is True))
  except (ValueError,OSError,VideoPreviewError,MediaProbeError) as exc:return jsonify(success=False,error=str(exc)),400
 @bp.get('/api/windows/video/<key>')
 def stream(key):
  try:path=store.get(key)
  except KeyError:return jsonify(error='Preview not found'),404
  response=send_file(path,mimetype='video/mp4',conditional=True,max_age=0)
  response.headers['Cache-Control']='no-store'
  return response
 @bp.delete('/api/windows/video/<key>')
 def remove(key):
  try:store.remove(key)
  except KeyError:return jsonify(error='Preview not found'),404
  except OSError:return jsonify(error='Preview is still in use'),409
  return jsonify(success=True)
 return bp
