import os,sys,pathlib,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
# Tables and columns of a Serato DJ Pro 5 location.sqlite that AXIOM's crate writer uses
SCHEMA='''
CREATE TABLE serato(database_name TEXT DEFAULT '',time_created INTEGER NOT NULL,time_last_connected INTEGER,last_master_uuid BLOB,revision INT DEFAULT 0);
CREATE TABLE space(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,revision INT DEFAULT 0);
CREATE TABLE container(id INTEGER PRIMARY KEY AUTOINCREMENT,revision INT,parent_id INT,name TEXT,type INT,list_order INT,space_id INT,time_added INT,expanded INT,portable_id TEXT,color INT);
CREATE TABLE asset(id INTEGER PRIMARY KEY AUTOINCREMENT,revision INT,portable_id TEXT,file_name TEXT,file_size INT,file_bit_rate REAL,file_sample_rate REAL,type TEXT,format TEXT,artist TEXT,color INT,comments TEXT,comment_language TEXT,comment_descriptor TEXT,grouping TEXT,remixer TEXT,name TEXT,album TEXT,composer TEXT,year TEXT,genre TEXT,key TEXT,label TEXT,bpm REAL,length_sec INT,length_ms INT,time_added INT,time_modified INT,part_of_set TEXT,track_number TEXT,video_portable_id TEXT,is_corrupt INT,corrupt_description TEXT,is_missing INT,is_readonly INT,is_beatgrid_locked INT,third_party_type INT,is_stale INT,is_whitelabel INT,is_karaoke INT,dj_play_count INT,dj_recently_played INT,analysis_flags INT,architectures INT,stems_analyze_state INT,type_specific_data BLOB,rating INT,emoji TEXT,import_id BLOB,explicit INT,pending_tempo_map_analysis INT);
CREATE TABLE space_asset(id INTEGER PRIMARY KEY AUTOINCREMENT,asset_id INT REFERENCES asset(id),space_id INT REFERENCES space(id),revision INT);
CREATE TABLE container_asset(id INTEGER PRIMARY KEY AUTOINCREMENT,revision INT,container_id INT REFERENCES container(id),space_asset_id INT REFERENCES space_asset(id),list_order INT,time_added INT);
CREATE TABLE dj_asset_metadata(asset_id INTEGER PRIMARY KEY,revision INT,has_read_tags INT);
CREATE TABLE dj_container_metadata(container_id INTEGER PRIMARY KEY,revision INT,export_state INT,filename TEXT);
INSERT INTO serato(time_created,revision) VALUES(1,10);
INSERT INTO space(id,name,revision) VALUES(1,'Serato Library',10);
INSERT INTO container(id,revision,parent_id,name,type,list_order,space_id,expanded,portable_id) VALUES(0,1,NULL,'root',0,0,NULL,0,''),(1,1,0,'Serato Library root',0,1,1,0,'');
'''
try:
 import uuid,sqlite3
 from windows_bootstrap import build_backend
 import windows_serato_library as W
 folder=workspace/'fixtures'/'serato-lib'/uuid.uuid4().hex;folder.mkdir(parents=True)
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 # Drive-relative portable ids, per-drive databases, refusals
 assert W.portable_id(r'E:\Samples\a b.mp3')=='Samples/a b.mp3' and app._serato_modern_portable_id(r'D:\x\y.wav')=='x/y.wav'
 assert str(W.location_database('e:'))==r'E:\_Serato_\Library\location.sqlite'
 assert W.location_database(W.system_drive()).name=='root.sqlite' and app.SERATO_MODERN_LIBRARY_DB.endswith(r'Serato\Library\root.sqlite')
 assert [pathlib.Path(p).name for p in app._serato_modern_library_candidates()]==['root.sqlite','master.sqlite']
 for bad in ([{'path':W.system_drive()+r'\Music\a.mp3'}],[{'path':r'E:\a.mp3'},{'path':r'D:\b.mp3'}],[{'path':'relative.mp3'}]):
  try:W.database_for_tracks(bad);raise AssertionError(bad)
  except W.SeratoLibraryError:pass
 # A crate written by AXIOM's own writer keeps Serato's existing track data (title with spaces, empty artist, key, BPM, year, size)
 music=folder/'Music';music.mkdir()
 a,b,c=music/'Loop.wav',music/"I'm So Into You.mp3",music/'New.mp3'
 for f,n in ((a,100),(b,200),(c,300)):f.write_bytes(b'x'*n)
 db=folder/'location.sqlite';con=sqlite3.connect(db);con.executescript(SCHEMA)
 for f,name,artist,key,size in ((a,'Track 01      ','','G#m',99),(b,"I'm So Into You",'Peabo Bryson','E',201)):
  con.execute("INSERT INTO asset(revision,portable_id,file_name,file_size,type,format,artist,name,year,key,bpm,is_missing) VALUES(10,?,?,?,'audio','mp3',?,?,'2009',?,113.96,0)",(W.portable_id(f),f.name,size,artist,name,key))
 con.commit();con.close()
 before={r[0]:r[1:] for r in sqlite3.connect(db).execute('select portable_id,name,artist,key,bpm,year,file_size from asset')}
 axiom_tracks=[{'path':str(a),'title':'Track 01','artist':'Unknown Artist'},{'path':str(b),'title':'So Into You','artist':'Peabo','bpm':114},{'path':str(c),'title':'New One','artist':'Someone','key':'8A','bpm':120,'year':'2024'}]
 result=app._write_serato_modern_crate_to_database(str(db),axiom_tracks,'AXIOM Test')
 assert result['success'] and result['verified_tracks']==3,result
 con=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
 after={r[0]:r[1:] for r in con.execute('select portable_id,name,artist,key,bpm,year,file_size from asset')}
 for pid,values in before.items():assert after[pid]==values,(pid,values,after[pid])
 assert after[W.portable_id(c)][:3]==('New One','Someone','8A')  # new tracks still get AXIOM's details
 order=[r[0] for r in con.execute("select a.portable_id from container_asset ca join space_asset sa on sa.id=ca.space_asset_id join asset a on a.id=sa.asset_id join container k on k.id=ca.container_id where k.name='AXIOM Test' order by ca.list_order")]
 assert order==[W.portable_id(p) for p in (a,b,c)] and con.execute('pragma integrity_check').fetchone()[0]=='ok'
 assert con.execute('select count(*) from asset').fetchone()[0]==3 and W._KNOWN_ASSETS.get() is None
 print('PASS: Serato DJ Pro 5 drive databases and portable ids; crate export keeps Serato track data; refusals for system drive and mixed drives')
except BaseException:
 traceback.print_exc();sys.exit(1)
