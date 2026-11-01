"""Experimental opt-in VirtualDJ endpoints: read-only inspection and new-list creation."""
from pathlib import Path
from flask import Blueprint,request,jsonify
from windows_virtualdj_database import read_database,match_list,VirtualDJDatabaseError
from windows_virtualdj_lists import (read_list,VirtualDJListError,write_new_vdjfolder,ensure_virtualdj_closed,
                                     virtualdj_home,database_paths)

LIST_SUFFIXES=('.xml','.vdjfolder')

def create_virtualdj_blueprint(allowed_path, license_guard, chooser=None, home=None, ensure_closed=None, connect_library=None):
 """home: callable returning VirtualDJ's home folder; ensure_closed: VirtualDJ running check;
 connect_library: callable merging VirtualDJ's tracks into the AXIOM library (returns a dict)."""
 if not callable(allowed_path) or not callable(license_guard):raise ValueError('Path policy and license guard are required')
 home=home or virtualdj_home;ensure_closed=ensure_closed or ensure_virtualdj_closed
 bp=Blueprint('windows_virtualdj',__name__)
 @bp.before_request
 def local_only():
  if request.remote_addr not in ('127.0.0.1','::1') or request.host.split(':')[0] not in ('localhost','127.0.0.1'):
   return jsonify(error='VirtualDJ inspection requires a local connection'),403
  origin=request.headers.get('Origin')
  if (origin and origin.rstrip('/')!=request.host_url.rstrip('/')) or (request.method!='GET' and not origin):
   return jsonify(error='VirtualDJ inspection requires a same-origin request'),403
 def selected(value,suffixes=('.xml',)):
  if not isinstance(value,str):raise ValueError('A local XML path is required')
  path=Path(value)
  if not path.is_absolute() or path.is_symlink() or path.suffix.lower() not in suffixes:raise ValueError('A local XML file is required')
  path=path.resolve(strict=True)
  if not path.is_file() or not allowed_path(path):raise ValueError('The selected file is not permitted')
  return path
 @bp.get('/api/windows/virtualdj/capabilities')
 def capabilities():return jsonify(read_only=True,chooser=callable(chooser),create_lists=True,connect_library=callable(connect_library))
 @bp.post('/api/windows/virtualdj/connect_library')
 def connect():
  """Add VirtualDJ's tracks to the AXIOM library (VirtualDJ files are only read)."""
  gate=license_guard('connect your DJ library')
  if gate:return gate
  if not callable(connect_library):return jsonify(success=False,error='VirtualDJ library connection is unavailable'),503
  try:result=connect_library()
  except (OSError,ValueError,RuntimeError,VirtualDJDatabaseError) as exc:
   return jsonify(success=False,error='VirtualDJ connection paused: '+str(exc),source_audio_untouched=True),500
  return jsonify(result),(200 if result.get('success') else 400)
 @bp.post('/api/windows/virtualdj/choose')
 def choose():
  gate=license_guard('VirtualDJ library inspection')
  if gate:return gate
  data=request.get_json(silent=True)
  if not isinstance(data,dict) or data.get('kind') not in ('database','list'):return jsonify(error='Invalid selection'),400
  if not callable(chooser):return jsonify(error='File selection is unavailable'),503
  try:
   path,cancelled=chooser(data['kind'])
   if cancelled:return jsonify(success=False,cancelled=True)
   return jsonify(success=True,path=str(selected(path,LIST_SUFFIXES if data['kind']=='list' else ('.xml',))))
  except (OSError,ValueError,RuntimeError) as exc:return jsonify(success=False,error=str(exc)),400
 @bp.post('/api/windows/virtualdj/inspect')
 def inspect():
  gate=license_guard('VirtualDJ library inspection')
  if gate:return gate
  if request.content_length is not None and request.content_length>16384:return jsonify(error='Request is too large'),413
  data=request.get_json(silent=True)
  if not isinstance(data,dict):return jsonify(error='Invalid request'),400
  offset=data.get('offset',0);limit=data.get('limit',100)
  if type(offset) is not int or type(limit) is not int or offset<0 or not 1<=limit<=200:
   return jsonify(error='Invalid page'),400
  try:
   database=read_database(selected(data.get('database_path')))
   if data.get('list_path'):
    joined=match_list(database,read_list(selected(data['list_path'],LIST_SUFFIXES)))
    items=joined.pop('items');summary=joined
   else:
    items=database['tracks'];summary={'tracks':len(items)}
   response=jsonify(success=True,version=database['version'],summary=summary,total=len(items),
                    offset=offset,items=items[offset:offset+limit],next_offset=offset+limit if offset+limit<len(items) else None)
   response.headers['Cache-Control']='no-store'
   return response
  except (OSError,ValueError,VirtualDJDatabaseError,VirtualDJListError) as exc:
   return jsonify(success=False,error=str(exc)),400
 @bp.post('/api/windows/virtualdj/lists')
 def create_list():
  """Create MyLists\\<name>.vdjfolder from ordered local tracks; never overwrites."""
  gate=license_guard('VirtualDJ list export')
  if gate:return gate
  if request.content_length is not None and request.content_length>4*1024*1024:return jsonify(error='Request is too large'),413
  data=request.get_json(silent=True)
  if not isinstance(data,dict) or not isinstance(data.get('name'),str) or not isinstance(data.get('paths'),list):
   return jsonify(error='Provide a list name and track paths'),400
  try:
   tracks=[]
   for value in data['paths']:
    if not isinstance(value,str) or not Path(value).is_absolute():raise ValueError('Track paths must be absolute')
    path=Path(value)
    if path.is_symlink() or not path.is_file() or not allowed_path(path.resolve(strict=True)):raise ValueError('A track is not permitted: '+path.name)
    tracks.append(str(path))
   folder=Path(home())
   databases=[]
   for db in database_paths(folder,tracks):
    try:databases.append(read_database(db))
    except VirtualDJDatabaseError:pass  # metadata is optional; path and size are enough for VirtualDJ
   result=write_new_vdjfolder(folder/'MyLists',data['name'],tracks,databases,ensure_closed)
   return jsonify(success=True,databases_read=len(databases),**result)
  except FileExistsError:
   return jsonify(success=False,error='A VirtualDJ list with this name already exists. Nothing was overwritten.'),409
  except (OSError,ValueError,VirtualDJDatabaseError,VirtualDJListError) as exc:
   return jsonify(success=False,error=str(exc)),400
 return bp
