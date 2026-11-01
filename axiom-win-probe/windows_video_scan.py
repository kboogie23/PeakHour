"""Opt-in video discovery adapter for AXIOM's packaged scanner.

Experimental: probes each otherwise-unreadable video synchronously and is not
intended for production-scale libraries or untrusted media.
"""
import math,os
from pathlib import Path
from types import SimpleNamespace
from windows_media_probe import probe_media,MediaProbeError

VIDEO_FORMATS=('.mp4','.m4v','.mov','.avi','.vob','.mpg','.mpeg')
class _VideoMetadata(dict):
 def __init__(self,duration):
  super().__init__();self.info=SimpleNamespace(length=duration)

def install_video_scanning(scratch_dir):
 import scanner
 root=Path(scratch_dir).resolve(strict=True)
 if not root.is_dir():raise ValueError('Video probe scratch directory is unavailable')
 if getattr(scanner,'_windows_video_adapter_installed',False):
  raise RuntimeError('Video scanning adapter is already installed')
 original=scanner.MutagenFile
 def metadata(path,*args,**kwargs):
  if Path(os.fspath(path)).suffix.lower() not in VIDEO_FORMATS:
   return original(path,*args,**kwargs)
  try:
   result=original(path,*args,**kwargs)
   length=getattr(getattr(result,'info',None),'length',None)
   if length is not None and math.isfinite(float(length)) and float(length)>0:return result
  except Exception:
   pass
  try:
   info=probe_media(str(Path(path).absolute()),scratch_dir=root)
   length=info.get('duration_seconds')
   if length is not None and math.isfinite(float(length)) and float(length)>0:
    return _VideoMetadata(float(length))
  except (MediaProbeError,OSError,ValueError):
   pass
  return None
 for ext in VIDEO_FORMATS:
  if ext not in scanner.SUPPORTED_FORMATS:scanner.SUPPORTED_FORMATS.append(ext)
 scanner.MutagenFile=metadata
 scanner._windows_video_adapter_installed=True

RESCAN_AUDIO=('.mp3','.wav','.aif','.aiff','.flac','.m4a')  # app.api_rescan's own list

def install_rescan(app):
 """Replace AXIOM's /api/library/rescan view, whose fixed audio-only list
 removed every video track as "Unsupported format". Same steps and response,
 with the video formats this Windows build indexes."""
 import json
 from flask import jsonify
 allowed=frozenset(RESCAN_AUDIO+VIDEO_FORMATS)
 def api_rescan():
  cache=app.load_cache(app.CACHE_PATH);clean,broken=[],[]
  for track in cache.get('tracks',[]):
   path=track.get('path','')
   if not path:broken.append({'path':path,'error':'Missing path'});continue
   if not os.path.exists(path):broken.append({'path':path,'error':'File not found'});continue
   if os.path.splitext(path)[1].lower() not in allowed:broken.append({'path':path,'error':'Unsupported format'});continue
   try:
    if os.path.getsize(path)<4096:broken.append({'path':path,'error':'File too small (possibly corrupt)'});continue
   except OSError as e:
    broken.append({'path':path,'error':str(e)});continue
   clean.append(track)
  cache['tracks']=clean;cache['total_tracks']=len(clean)
  try:app.safe_write_json(app.CACHE_PATH,cache)
  except Exception:
   with open(app.CACHE_PATH,'w',encoding='utf-8') as f:json.dump(cache,f,indent=2)
  return jsonify(removed_count=len(broken),total_tracks=len(clean),broken_tracks=broken)
 app.app.view_functions['api_rescan']=api_rescan
