"""Experimental VirtualDJ 2024+ ordered XML list interchange.

See https://virtualdj.com/wiki/Lists.html. This is not wired to a real library.
"""
import ntpath,os,stat,tempfile,xml.etree.ElementTree as ET
from pathlib import Path
from defusedxml import ElementTree as SafeET

MAX_LIST_BYTES=16*1024*1024
MAX_TRACKS=50000
class VirtualDJListError(RuntimeError):pass

def read_list(path):
 file=Path(path)
 if not file.is_absolute() or not file.is_file() or file.is_symlink():raise VirtualDJListError('List must be a local regular file')
 with file.open('rb') as f:
  before=os.fstat(f.fileno());data=f.read(MAX_LIST_BYTES+1);after=os.fstat(f.fileno())
 if len(data)>MAX_LIST_BYTES:raise VirtualDJListError('VirtualDJ list exceeds the size limit')
 if (before.st_size,before.st_mtime_ns,before.st_ino)!=(after.st_size,after.st_mtime_ns,after.st_ino):raise VirtualDJListError('List changed while reading')
 try:root=SafeET.fromstring(data,forbid_dtd=True,forbid_entities=True,forbid_external=True)
 except Exception as e:raise VirtualDJListError('VirtualDJ list is invalid or unsupported') from e
 if root.tag!='VirtualFolder':raise VirtualDJListError('Not a VirtualDJ XML list')
 songs=[]
 for node in root:
  if node.tag!='song':raise VirtualDJListError('Unrecognized list content; no changes made')
  if not node.get('path'):raise VirtualDJListError('A song has no path')
  songs.append(dict(node.attrib))
  if len(songs)>MAX_TRACKS:raise VirtualDJListError('VirtualDJ list has too many songs')
 return {'attributes':dict(root.attrib),'songs':songs}

def write_new_list(destination,tracks):
 target=Path(destination)
 if not target.is_absolute() or target.suffix.lower()!='.xml' or not target.parent.is_dir():raise VirtualDJListError('Choose a new XML list in an existing directory')
 if os.path.lexists(target):raise FileExistsError(target)
 if not isinstance(tracks,(list,tuple)) or not tracks or len(tracks)>MAX_TRACKS:raise VirtualDJListError('Provide a nonempty, bounded track list')
 root=ET.Element('VirtualFolder',{'noDuplicates':'no','singleDrive':'no','ordered':'yes'})
 identities=[]
 for index,value in enumerate(tracks):
  path=Path(value)
  if not path.is_absolute():raise VirtualDJListError('Track paths must be absolute')
  info=os.stat(path,follow_symlinks=False)
  if not stat.S_ISREG(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400:raise VirtualDJListError('Track must be a regular non-reparse file')
  identities.append((info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns))
  ET.SubElement(root,'song',{'path':str(path),'size':str(info.st_size),'idx':str(index)})
 payload=ET.tostring(root,encoding='utf-8',xml_declaration=True)
 if len(payload)>MAX_LIST_BYTES:raise VirtualDJListError('VirtualDJ list exceeds the size limit')
 fd,stage_name=tempfile.mkstemp(prefix='.axiom-vdj-',suffix='.xml',dir=target.parent);stage=Path(stage_name);identity=None
 try:
  with os.fdopen(fd,'wb') as f:
   f.write(payload);f.flush();os.fsync(f.fileno());identity=os.fstat(f.fileno())
  parsed=read_list(stage)
  if [x['path'] for x in parsed['songs']]!=[str(Path(x)) for x in tracks]:raise VirtualDJListError('List verification failed')
  for path,old in zip(tracks,identities):
   now=os.stat(path,follow_symlinks=False)
   if (now.st_dev,now.st_ino,now.st_size,now.st_mtime_ns)!=old:raise VirtualDJListError('A track changed during preparation')
  os.link(stage,target)
  return {'path':str(target),'tracks':len(tracks)}
 finally:
  try:
   now=os.stat(stage,follow_symlinks=False)
   if identity and (now.st_dev,now.st_ino)==(identity.st_dev,identity.st_ino):os.unlink(stage)
  except FileNotFoundError:pass

# ---- VirtualDJ 8.5 lists as the installed application writes them ----
# A list made in VirtualDJ 8.5 (2024 build) on Windows is MyLists\<name>.vdjfolder:
# CRLF lines, tab-indented <song .../> elements, XML entities including &apos;,
# attributes path, size, songlength (one decimal), artist, title, remix, idx in
# that order and only when known, and singleDrive="yes" when every song is on
# one drive (the documented default is no).
SONG_ATTRIBUTES=('path','size','songlength','artist','title','remix','idx')
_ENTITIES=(('&','&amp;'),('<','&lt;'),('>','&gt;'),('"','&quot;'),("'",'&apos;'))
_RESERVED=set('CON PRN AUX NUL COM1 COM2 COM3 COM4 COM5 COM6 COM7 COM8 COM9 LPT1 LPT2 LPT3 LPT4 LPT5 LPT6 LPT7 LPT8 LPT9'.split())

def _escape(value):
 text=str(value)
 if any(ord(c)<32 and c not in '\t' for c in text):raise VirtualDJListError('List values cannot contain control characters')
 for raw,entity in _ENTITIES:text=text.replace(raw,entity)
 return text

def format_vdjfolder(songs):
 """Bytes of a .vdjfolder list; songs are dicts with SONG_ATTRIBUTES keys (path required)."""
 if not isinstance(songs,(list,tuple)) or not songs or len(songs)>MAX_TRACKS:raise VirtualDJListError('Provide a nonempty, bounded track list')
 drives={ntpath.splitdrive(str(s.get('path','')))[0].lower() for s in songs}
 lines=['<?xml version="1.0" encoding="UTF-8"?>','<VirtualFolder ordered="yes"%s>'%(' singleDrive="yes"' if len(drives)==1 and '' not in drives else '')]
 for index,song in enumerate(songs):
  if not song.get('path'):raise VirtualDJListError('A song has no path')
  values=dict(song,idx=index)
  lines.append('\t<song %s />'%' '.join('%s="%s"'%(k,_escape(values[k])) for k in SONG_ATTRIBUTES if values.get(k) not in (None,'')))
 lines.append('</VirtualFolder>')
 payload=('\r\n'.join(lines)+'\r\n').encode('utf-8')
 if len(payload)>MAX_LIST_BYTES:raise VirtualDJListError('VirtualDJ list exceeds the size limit')
 return payload

VIRTUALDJ_EXECUTABLES=('virtualdj.exe',)  # VirtualDJ 8.5's installed program

def ensure_virtualdj_closed(snapshot=None):
 """Raise unless VirtualDJ is verifiably not running (fails closed)."""
 from windows_serato_processes import snapshot_processes,ProcessInspectionError
 try:names={ntpath.basename(exe).lower() for _,exe in (snapshot or snapshot_processes)()}
 except ProcessInspectionError as exc:raise VirtualDJListError('Could not verify that VirtualDJ is closed. Nothing was written.') from exc
 if names&set(VIRTUALDJ_EXECUTABLES):raise VirtualDJListError('Quit VirtualDJ, then try again.')

def database_paths(home,tracks):
 """VirtualDJ databases describing these tracks: the home database plus each
 other drive's <drive>:\\VirtualDJ\\database.xml (VirtualDJ keeps one per drive)."""
 paths=[Path(home)/'database.xml']
 home_drive=ntpath.splitdrive(str(home))[0].lower()
 for drive in sorted({ntpath.splitdrive(str(t))[0].upper() for t in tracks}):
  if len(drive)==2 and drive[1]==':' and drive.lower()!=home_drive:paths.append(Path(drive+'\\','VirtualDJ','database.xml'))
 return [p for p in paths if p.is_file()]

def virtualdj_home():
 """VirtualDJ's home folder: the one holding settings.xml, local app data first."""
 for base in (os.environ.get('LOCALAPPDATA'),os.path.join(os.environ.get('USERPROFILE',''),'Documents')):
  if base and os.path.isfile(os.path.join(base,'VirtualDJ','settings.xml')):return Path(base,'VirtualDJ')
 raise VirtualDJListError('VirtualDJ home folder not found. Open VirtualDJ once first.')

def list_name(name):
 text=str(name or '').strip()
 if not text or len(text)>120 or any(c in text for c in '<>:"/\\|?*') or any(ord(c)<32 for c in text) or text.endswith('.') or text.split('.')[0].upper() in _RESERVED:
  raise VirtualDJListError('Choose a list name without path characters')
 return text

def song_entry(path,database_track=None):
 """List attributes for one file, with metadata from a matching VirtualDJ database track."""
 entry={'path':str(path)}
 if database_track:
  tags=(database_track.get('source_sections',{}).get('Tags') or [{}])[0].get('attributes',{})
  length=database_track.get('duration_sec')
  entry.update(artist=tags.get('Author',''),title=tags.get('Title',''),remix=tags.get('Remix',''),
               songlength='%.1f'%length if length else '')
 return entry

def write_new_vdjfolder(lists_dir,name,tracks,database=None,ensure_closed=None):
 """Create MyLists\\<name>.vdjfolder for existing local files; never overwrites.

 tracks: absolute file paths, in order. database: read_database() results used
 for artist/title/remix/length. ensure_closed: callable raising if VirtualDJ runs.
 """
 if ensure_closed is None:raise VirtualDJListError('A VirtualDJ running check is required')
 folder=Path(lists_dir)
 if not folder.is_absolute() or not folder.is_dir() or folder.is_symlink():raise VirtualDJListError('VirtualDJ list folder not found')
 target=folder/(list_name(name)+'.vdjfolder')
 if os.path.lexists(target):raise FileExistsError(target)
 if not isinstance(tracks,(list,tuple)) or not tracks or len(tracks)>MAX_TRACKS:raise VirtualDJListError('Provide a nonempty, bounded track list')
 lookup={}
 for db in database or ():
  for track in db.get('tracks',()):
   key=ntpath.normcase(ntpath.normpath(track['path'])) if track.get('path_kind')=='windows_absolute' else None
   if key:lookup.setdefault(key,[]).append(track)
 songs,identities=[],[]
 for value in tracks:
  path=Path(value)
  if not path.is_absolute():raise VirtualDJListError('Track paths must be absolute')
  info=os.stat(path,follow_symlinks=False)
  if not stat.S_ISREG(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400:raise VirtualDJListError('Track must be a regular non-reparse file')
  identities.append((info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns))
  matches=lookup.get(ntpath.normcase(ntpath.normpath(str(path))),[])
  entry=song_entry(path,matches[0] if len(matches)==1 else None);entry['size']=str(info.st_size)
  songs.append(entry)
 payload=format_vdjfolder(songs)
 ensure_closed()
 fd,stage_name=tempfile.mkstemp(prefix='.axiom-vdj-',suffix='.tmp',dir=folder);stage=Path(stage_name);identity=None
 try:
  with os.fdopen(fd,'wb') as f:
   f.write(payload);f.flush();os.fsync(f.fileno());identity=os.fstat(f.fileno())
  parsed=read_list(stage)
  if [x['path'] for x in parsed['songs']]!=[s['path'] for s in songs] or stage.read_bytes()!=payload:raise VirtualDJListError('List verification failed')
  for path,old in zip(tracks,identities):
   now=os.stat(path,follow_symlinks=False)
   if (now.st_dev,now.st_ino,now.st_size,now.st_mtime_ns)!=old:raise VirtualDJListError('A track changed during preparation')
  ensure_closed()
  os.link(stage,target)
  return {'path':str(target),'tracks':len(songs),'with_metadata':sum(1 for s in songs if s.get('title'))}
 finally:
  try:
   now=os.stat(stage,follow_symlinks=False)
   if identity and (now.st_dev,now.st_ino)==(identity.st_dev,identity.st_ino):os.unlink(stage)
  except FileNotFoundError:pass
