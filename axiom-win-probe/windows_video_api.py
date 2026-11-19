"""Experimental loopback-only video-preview API; not enabled by default."""
import re,tempfile,threading,time,uuid
from pathlib import Path
from flask import Blueprint,request,jsonify,send_file
from windows_video_preview import create_video_preview,preview_plan,VideoPreviewError,DIRECT_CONTAINERS,DIRECT_AUDIO
from windows_media_probe import MediaProbeError,probe_media

class VideoPreviewStore:
 MAX_ITEMS=4
 MAX_PROBES=256
 def __init__(self,root,allowed_path,ffmpeg,idle_seconds=7200,clock=time.monotonic):
  self._probes={}
  self.root=Path(root).resolve(strict=True);self.allowed_path=allowed_path;self.ffmpeg=ffmpeg
  self.idle_seconds=idle_seconds;self._clock=clock
  # _lock only guards these tables and is never held while probing, converting or deleting files
  self._lock=threading.RLock();self._items={};self._preparing=0;self._trash=[];self._trash_tried=None
 def _probe(self,source):
  # Inspecting a file starts a helper process (0.7 s warm, 5 s on the first run, much longer on a busy PC or a drive
  # that is waking up): remember the answer for a file that has not changed so the second click is instant.
  stat=source.stat();key=(str(source),stat.st_size,stat.st_mtime_ns)
  with self._lock:
   if key in self._probes:return self._probes[key]
  info=probe_media(str(source),scratch_dir=self.root)
  with self._lock:
   self._probes[key]=info
   while len(self._probes)>self.MAX_PROBES:self._probes.pop(next(iter(self._probes)))
  return info
 def plan(self,key):
  """What a quickly published direct preview really needs: 'direct', 'copy' or 'convert' (inspects the file now)."""
  source=Path(self.get(key)).resolve(strict=True)
  info=self._probe(source)
  codec=next((s['codec'] for s in info['streams'] if s['type']=='audio'),None)
  # audio_ok: Edge can decode the sound as it is. A picture Edge cannot decode errors out by itself (and is converted
  # then); sound it cannot decode would play silently, so the page must swap on that one.
  return {'plan':preview_plan(info,source.suffix),'duration_seconds':info.get('duration_seconds'),'audio':codec is not None,'audio_ok':codec in DIRECT_AUDIO}
 def prepare(self,path,convert=False,fast=False):
  source=Path(path).resolve(strict=True)
  if not source.is_file() or not self.allowed_path(source):raise ValueError('Video path is not permitted')
  self._sweep()
  evicted=[]
  with self._lock:  # reserve a slot now; the slow work below runs unlocked so get()/remove() keep working
   while len(self._items)+self._preparing>=self.MAX_ITEMS and self._items:  # full: the least recently used preview makes room
    evicted.append(self._items.pop(min(self._items,key=lambda k:self._items[k][2]))[0])
   if len(self._items)+self._preparing>=self.MAX_ITEMS:
    for directory in evicted:self._discard(directory)
    raise ValueError('Close an existing video preview first')
   self._preparing+=1
  for directory in evicted:self._discard(directory)
  try:
   if fast and not convert and source.suffix.lower() in DIRECT_CONTAINERS:
    # Music videos are nearly always H.264 + AAC, which Edge plays as they are: start the picture now and let the
    # page ask plan() in the background (and switch to a copy/conversion if the file turns out to need one).
    return {'id':self._publish(None,source),'duration_seconds':None,'audio':None,'mode':'direct','verified':False}
   info=self._probe(source)
   plan='convert' if convert else preview_plan(info,source.suffix)
   audio=any(s['type']=='audio' for s in info['streams'])
   if plan=='direct':  # played from the library file itself; nothing is copied or written
    key=self._publish(None,source)
    return {'id':key,'duration_seconds':info.get('duration_seconds'),'audio':audio,'mode':'direct'}
   directory=tempfile.TemporaryDirectory(prefix='preview-',dir=self.root)
   try:
    output=Path(directory.name)/'video.mp4'
    result=create_video_preview(source,output,scratch_dir=self.root,ffmpeg=self.ffmpeg,mode=plan)
    key=self._publish(directory,output)
    return {'id':key,'duration_seconds':result['duration_seconds'],'audio':result['audio'],'mode':plan}
   except BaseException:
    self._discard(directory);raise
  finally:
   with self._lock:self._preparing-=1
 def _publish(self,directory,path):
  key=uuid.uuid4().hex
  with self._lock:self._items[key]=[directory,path,self._clock()]
  return key
 def _discard(self,directory):
  # Edge may still hold the file open (Windows refuses the delete): forget the preview anyway and retry later
  if directory is None:return
  try:directory.cleanup()
  except OSError:
   with self._lock:self._trash.append(directory)
 def _retry_trash(self,force=False):
  now=self._clock()  # Edge may hold a folder for minutes: do not retry the delete on every range request
  with self._lock:
   if not self._trash or (not force and self._trash_tried is not None and now-self._trash_tried<30):return
   trash,self._trash,self._trash_tried=self._trash,[],now
  for directory in trash:self._discard(directory)
 def _sweep(self):
  now=self._clock()
  with self._lock:
   expired=[k for k,item in self._items.items() if now-item[2]>self.idle_seconds]
   dropped=[self._items.pop(k)[0] for k in expired]
  for directory in dropped:self._discard(directory)
  self._retry_trash()
 def get(self,key):
  if not re.fullmatch(r'[0-9a-f]{32}',key):raise KeyError(key)
  self._sweep()
  with self._lock:
   if key not in self._items:raise KeyError(key)
   item=self._items[key];item[2]=self._clock()
   return item[1]
 def remove(self,key):
  with self._lock:
   if key not in self._items:raise KeyError(key)
   directory=self._items.pop(key)[0]
  self._discard(directory);self._retry_trash()
 def close(self):
  with self._lock:keys=list(self._items)
  for key in keys:
   try:self.remove(key)
   except KeyError:pass
  self._retry_trash(force=True)

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
  try:return jsonify(success=True,**store.prepare(data['path'],convert=data.get('convert') is True,fast=data.get('fast') is True))
  except (ValueError,OSError,VideoPreviewError,MediaProbeError) as exc:return jsonify(success=False,error=str(exc)),400
 @bp.get('/api/windows/video/<key>/plan')
 def plan(key):
  try:return jsonify(success=True,**store.plan(key))
  except KeyError:return jsonify(error='Preview not found'),404
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
