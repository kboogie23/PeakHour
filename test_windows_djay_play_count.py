import os,sys,pathlib,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 import uuid,hashlib,sqlite3,struct
 sys.path.insert(0,str(workspace))
 from djay_fixture import windows_library,user_data
 from windows_bootstrap import build_backend
 import windows_djay
 folder=workspace/'fixtures'/'djay'/uuid.uuid4().hex;folder.mkdir(parents=True)
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 import utils.djay_play_count_publish as counts
 from utils.djay_play_count_codec import replace_play_count as original_replace
 from utils.dj_track_colors import decode_djay_record as decode
 from utils.dj_transfer import read_djay_tracks
 # Codec: double counts stay doubles, only playCount changes, same length
 one=user_data('w1','Song',1.0);seven=counts.replace_play_count(one,7)
 assert decode(seven)['playCount']==7.0 and type(decode(seven)['playCount']) is float and len(seven)==len(one)
 changed=[i for i in range(len(one)) if one[i]!=seven[i]]
 value=seven.index(b'\x08playCount\x00')-8
 assert changed and all(value<=i<value+8 for i in changed),changed
 assert {k:v for k,v in decode(seven).items() if k!='playCount'}=={k:v for k,v in decode(one).items() if k!='playCount'}
 # Missing count is inserted as a double; integer counts (macOS layout) keep AXIOM's int64
 inserted=counts.replace_play_count(user_data('w1','Song'),3)
 assert decode(inserted)['playCount']==3.0 and type(decode(inserted)['playCount']) is float
 as_int=original_replace(user_data('w1','Song'),2)
 assert type(decode(counts.replace_play_count(as_int,4))['playCount']) is int
 for bad in (2.5,-1.0):
  try: counts.replace_play_count(user_data('w1','Song',bad),5);raise AssertionError(bad)
  except ValueError: pass
 # Guard: Windows process names, deduplicated; fails closed like the macOS original
 guard=windows_djay.make_running_dj_apps(windows_djay.PLAY_COUNT_GUARD_APPS,snapshot=lambda:[(1,'C:\\x\\djayApp.exe'),(2,'Serato DJ Pro.exe')])
 assert guard()==['djay Pro','Serato DJ Pro'],guard()
 assert windows_djay.make_running_dj_apps(windows_djay.PLAY_COUNT_GUARD_APPS,snapshot=lambda:[(1,'notepad.exe')])()==[]
 def broken():raise windows_djay.ProcessInspectionError('denied')
 try: windows_djay.make_running_dj_apps(('djay',),snapshot=broken)();raise AssertionError('guard passed')
 except RuntimeError as e: assert 'Could not verify' in str(e)
 # Durable-write helpers: fsync of a read-only handle, directory descriptor, write-through replace
 f=folder/'a.bin';f.write_bytes(b'a');g=folder/'b.bin';g.write_bytes(b'b')
 with open(f,'rb') as h: windows_djay.OS_PROXY.fsync(h.fileno())
 fd=windows_djay.OS_PROXY.open(str(folder),os.O_RDONLY);windows_djay.OS_PROXY.fsync(fd);windows_djay.OS_PROXY.close(fd)
 assert fd not in windows_djay._DIRECTORY_FDS
 windows_djay.OS_PROXY.replace(g,f);assert f.read_bytes()==b'b' and not g.exists()
 # Full publish_counts on a synthetic djay for Windows library
 track,db=windows_library(folder,'Win Track',1.0,windows_djay.quote)
 rows=[dict(t,serato_play_count=9,exact_path=True,match_source='exact_path',owner_confirmed_location=True) for t in read_djay_tracks([db])[0].values()]
 audio=hashlib.sha256(track.read_bytes()).hexdigest()
 backup=pathlib.Path(os.environ['AXIOM_RUNTIME_DIR'])/'djay-play-count-backups'/folder.name;backup.mkdir(parents=True)
 result=counts.publish_counts(str(db),rows,str(backup),confirmation=counts.CONFIRMATION,ensure_quit=lambda:None)
 assert result['success'] and result['updated']==1 and result['database_readback_verified'],result
 c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
 assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 stored=decode(bytes(c.execute("select data from database2 where collection='mediaItemUserData'").fetchone()[0]));c.close()
 assert stored['playCount']==9.0 and type(stored['playCount']) is float
 assert hashlib.sha256(track.read_bytes()).hexdigest()==audio and pathlib.Path(result['receipt_path']).is_file()
 # The real guard refuses while an app is "running"
 counts.running_dj_apps=lambda:['djay Pro']
 try: counts.assert_apps_quit();raise AssertionError('guard passed')
 except RuntimeError as e: assert 'Quit djay Pro' in str(e)
 print('PASS: djay play-count writes keep doubles, guard and fsync/replace adapters, end-to-end publish on a synthetic Windows library')
except BaseException:
 traceback.print_exc();sys.exit(1)
