"""Read-only VirtualDJ v8+ XML inventory for the Windows prototype.

Schema reference: https://virtualdj.com/wiki/VDJ_database.html
The reader never opens, changes, or resolves track paths and does not write a database.
"""
import math,ntpath,os,stat
from pathlib import Path
from defusedxml import ElementTree as SafeET

MAX_DATABASE_BYTES=256*1024*1024
MAX_TRACKS=500000
class VirtualDJDatabaseError(RuntimeError):pass

def _number(value):
 try:
  x=float(value)
  return x if math.isfinite(x) and x>0 else None
 except (TypeError,ValueError,OverflowError):return None

def _derive(song):
 attrs=dict(song.attrib);path=attrs.get('FilePath','')
 if not path:raise VirtualDJDatabaseError('A VirtualDJ song has no FilePath')
 sections={};extras=[]
 for child in song:
  if child.tag in ('Tags','Infos','Scan','Poi','Link','Comment','CustomMix'):
   sections.setdefault(child.tag,[]).append({'attributes':dict(child.attrib),'text':child.text or ''})
  else:extras.append({'tag':str(child.tag),'attributes':dict(child.attrib),'text':child.text or ''})
 tags=sections.get('Tags',[]);infos=sections.get('Infos',[]);scans=sections.get('Scan',[])
 tags=tags[0]['attributes'] if len(tags)==1 else {}
 infos=infos[0]['attributes'] if len(infos)==1 else {}
 scans=scans[0]['attributes'] if len(scans)==1 else {}
 interval=_number(scans.get('Bpm'));bpm=60.0/interval if interval else None
 if bpm is not None and not 1<=bpm<=400:bpm=None
 duration=_number(infos.get('SongLength'))
 drive,tail=ntpath.splitdrive(path)
 local=bool(drive and tail.startswith(('\\','/'))) or path.startswith('\\\\')
 return {'path':path,'path_kind':'windows_absolute' if local else 'unresolved',
         'title':tags.get('Title',''),'artist':tags.get('Author',''),'genre':tags.get('Genre',''),
         'bpm':round(bpm,3) if bpm is not None else None,'key':scans.get('Key') or tags.get('Key') or None,
         'duration_sec':duration,'source_attributes':attrs,'source_sections':sections,'unrecognized_sections':extras}

def read_database(path):
 file=Path(path)
 if not file.is_absolute() or file.is_symlink():raise VirtualDJDatabaseError('Choose a local database file')
 try:
  with file.open('rb') as source:
   before=os.fstat(source.fileno())
   if not stat.S_ISREG(before.st_mode) or getattr(before,'st_file_attributes',0)&0x400:
    raise VirtualDJDatabaseError('Database must be a regular non-reparse file')
   if before.st_size>MAX_DATABASE_BYTES:raise VirtualDJDatabaseError('Database exceeds the size limit')
   iterator=SafeET.iterparse(source,events=('start','end'),forbid_dtd=True,forbid_entities=True,forbid_external=True)
   root=None;tracks=[];depth=0
   for event,node in iterator:
    if event=='start':
     depth+=1
     if depth==1:
      root=node
      if root.tag!='VirtualDJ_Database':raise VirtualDJDatabaseError('Unsupported VirtualDJ database')
      version=root.get('Version','')
     if depth>32:raise VirtualDJDatabaseError('Database nesting is too deep')
    else:
     if depth==2:
      if node.tag!='Song':raise VirtualDJDatabaseError('Unrecognized database content')
      tracks.append(_derive(node));node.clear()
      if root is not None:root.clear()
      if len(tracks)>MAX_TRACKS:raise VirtualDJDatabaseError('Database contains too many tracks')
     depth-=1
   after=os.fstat(source.fileno())
   if root is None:raise VirtualDJDatabaseError('Database is empty')
   if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):
    raise VirtualDJDatabaseError('Database changed during reading')
 except VirtualDJDatabaseError:raise
 except Exception as exc:raise VirtualDJDatabaseError('Database could not be read safely') from exc
 return {'version':version,'tracks':tracks,'source_size':before.st_size}


def _windows_path_key(value):
 if not isinstance(value,str) or not value:return None
 drive,tail=ntpath.splitdrive(value)
 if not drive or not tail.startswith(('\\','/')):return None
 if not ((len(drive)==2 and drive[0].isalpha() and drive[1]==':') or drive.startswith('\\\\')):return None
 if any(part=='..' for part in tail.replace('/','\\').split('\\')):return None
 return ntpath.normcase(ntpath.normpath(value))

def match_list(database,list_data):
 """Join by normalized Windows path; preserve order and unresolved entries."""
 if not isinstance(database,dict) or not isinstance(database.get('tracks'),list):raise VirtualDJDatabaseError('Invalid database inventory')
 if not isinstance(list_data,dict) or not isinstance(list_data.get('songs'),list):raise VirtualDJDatabaseError('Invalid list inventory')
 lookup={}
 for track in database['tracks']:
  key=_windows_path_key(track.get('path')) if isinstance(track,dict) else None
  if key:lookup.setdefault(key,[]).append(track)
 items=[]
 for song in list_data['songs']:
  if not isinstance(song,dict):raise VirtualDJDatabaseError('Invalid list entry')
  key=_windows_path_key(song.get('path'));matches=lookup.get(key,[]) if key else []
  status='unresolved' if key is None else 'missing' if not matches else 'matched' if len(matches)==1 else 'ambiguous'
  items.append({'list_entry':dict(song),'status':status,'track':matches[0] if status=='matched' else None})
 return {'items':items,'matched':sum(x['status']=='matched' for x in items),
         'missing':sum(x['status']=='missing' for x in items),
         'ambiguous':sum(x['status']=='ambiguous' for x in items),
         'unresolved':sum(x['status']=='unresolved' for x in items)}
