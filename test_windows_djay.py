import os,sys,pathlib,traceback
workspace=pathlib.Path(__file__).resolve().parent
probe=workspace/'axiom-win-probe'; home=workspace/'probe-home'; home.mkdir(exist_ok=True)
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(home/'AppData/Local'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime'),'NO_PROXY':'*','PIP_DISABLE_PIP_VERSION_CHECK':'1'})
sys.path.insert(0,str(probe)); os.chdir(probe)
def audit(event,args):
 if event in ('socket.connect','socket.connect_ex','subprocess.Popen','os.system','os.startfile'):
  raise PermissionError('Probe blocks '+event)
 if event=='open' and len(args)>1:
  path,mode=args[:2]
  if isinstance(path,(str,bytes,os.PathLike)) and isinstance(mode,str) and any(x in mode for x in 'wax+'):
   resolved=pathlib.Path(path).resolve()
   if not resolved.is_relative_to(workspace): raise PermissionError('Probe blocks file write outside workspace')
sys.addaudithook(audit)
try:
 import sqlite3,uuid,shutil,subprocess,time,hashlib
 from pathlib import Path as P
 from windows_bootstrap import build_backend
 import windows_djay
 folder=workspace/'fixtures'/'djay'/uuid.uuid4().hex;folder.mkdir(parents=True)
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 from utils.dj_transfer import read_djay_tracks
 # URL conversion in both directions
 # djay 5.6 for Windows writes file:///C:%5CUsers%5C...%20... (observed in a real library)
 assert windows_djay.quote('C:\\Music\\Caf\u00e9 One.mp3',safe='/&():')=='/C:%5CMusic%5CCaf%C3%A9%20One.mp3'
 assert 'file://'+windows_djay.quote(r'D:/x y.mp4',safe='/')=='file:///D:%5Cx%20y.mp4'
 assert app.os.path.normpath(__import__('urllib.parse').parse.unquote('/C:%5CMusic%5Ca.mp3'))=='C:\\Music\\a.mp3'
 assert windows_djay.quote('/already/posix')=='/already/posix'
 assert app.os.path.normpath('/C:/Music/a.mp3')=='C:\\Music\\a.mp3' and app.os.path.normpath('a/../b')=='b'
 # Synthetic djay library through AXIOM's own reader
 track=folder/'Caf\u00e9 One.mp3';track.write_bytes(b'fixture');digest=hashlib.sha256(track.read_bytes()).hexdigest()
 url=P(track).as_uri().encode()
 E=app._DjayFastCodingEncoder();E.coded_object('ADCMediaItemUserData',[('manualBPM','string','124')]);user=bytes(E.finish())
 M=app._DjayFastCodingEncoder();M.coded_object('ADCMediaItem',[('title','string','Cafe One')]);media=bytes(M.finish())
 db=folder/'MediaLibrary.db';c=sqlite3.connect(db)
 c.execute('create table database2(rowid integer primary key,collection text,key text,data blob,metadata blob)')
 c.executemany('insert into database2(collection,key,data) values(?,?,?)',[('localMediaItemLocations','k1',b'\x00'+url+b'\x00'),('mediaItemUserData','k1',user),('mediaItems','k1',media)])
 c.commit();c.close();dbsum=hashlib.sha256(db.read_bytes()).hexdigest()
 tracks,errors=read_djay_tracks([db])
 assert not errors and list(tracks)==[str(track)],tracks
 assert tracks[str(track)]['title']=='Cafe One' and tracks[str(track)]['djay_bpm']=='124'
 assert P(next(iter(tracks))).exists()
 assert hashlib.sha256(db.read_bytes()).hexdigest()==dbsum and hashlib.sha256(track.read_bytes()).hexdigest()==digest
 # djay for Windows layout: float numbers, no mediaItems, title/BPM in TitleIDs/AnalyzedData
 sys.path.insert(0,str(workspace));from djay_fixture import windows_library as make_library
 windows_library=lambda name,count:make_library(folder,name,count,windows_djay.quote)
 wtrack,wdb=windows_library('Win Track',3.0);wsum=hashlib.sha256(wdb.read_bytes()).hexdigest()
 tracks,errors=read_djay_tracks([wdb])
 assert not errors and list(tracks)==[str(wtrack)],(tracks,errors)
 w=tracks[str(wtrack)]
 assert (w['title'],w['artist'],w['djay_play_count'],w['djay_bpm'])==('Win Track','Fixture Artist',3,105.5),w
 assert type(w['djay_play_count']) is int and hashlib.sha256(wdb.read_bytes()).hexdigest()==wsum
 tracks,errors=read_djay_tracks([wdb],include_preparation=True,include_transfer_preparation=True)
 assert not errors and tracks[str(wtrack)]['transfer_play_count']==3
 _,bad=windows_library('Bad Count',2.5)
 tracks,errors=read_djay_tracks([bad])
 assert not tracks and errors==['Unreadable djay track record: w1'],(tracks,errors)
 # Default locations are under the Windows Music folder, using djay 5.6's folder name
 assert app._djay_database_candidates(None)[-1].endswith('djay\\djay Media Library\\MediaLibrary.db')
 # Safety guard: was always False off macOS; now detects djay and fails closed
 assert app._running_dj_publish_apps()==[] or 'djay Pro' in app._running_dj_publish_apps()
 assert windows_djay.process_snapshot('djay Pro',snapshot=lambda:[(9,'djayApp.exe')])['running']
 assert not windows_djay.process_snapshot('djay Pro',snapshot=lambda:[(9,'other.exe')])['running']
 def broken():raise windows_djay.ProcessInspectionError('denied')
 assert windows_djay.process_snapshot('djay Pro',snapshot=broken)['running']
 print("PASS: djay Windows paths and djay 5.6 Windows layout through original reader, URL encoding, default locations, djay process mapping and fail-closed snapshot")
except BaseException:
 traceback.print_exc();sys.exit(1)


