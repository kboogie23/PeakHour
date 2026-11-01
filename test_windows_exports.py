"""rekordbox XML export and library rescan on Windows, on generated files only."""
import os,sys,pathlib,uuid,json,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 import windows_exports as X
 body=b'<TRACK Location="file://localhost/C:%5CMusic%5Ca%20b.mp3"/><TRACK Location="file://localhost/E:%5cSets%5cx.mp4"/>'
 assert X.rekordbox_locations(body)==b'<TRACK Location="file://localhost/C:/Music/a%20b.mp3"/><TRACK Location="file://localhost/E:/Sets/x.mp4"/>'
 assert X.fill_missing({'playlist':[{'key':None,'bpm':120}]})=={'playlist':[{'key':'','bpm':120}]}
 folder=workspace/'fixtures'/'exports'/uuid.uuid4().hex;folder.mkdir(parents=True)
 from windows_bootstrap import build_backend
 import windows_video_scan
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 windows_video_scan.install_rescan(app)
 tracks=[]
 for name,size in (('a.mp3',5000),('b.mp4',5000),('c.vob',5000),('tiny.avi',10),('d.txt',5000)):
  p=folder/name;p.write_bytes(b'\0'*size);tracks.append({'path':str(p)})
 tracks.append({'path':str(folder/'gone.mp3')})
 app.CACHE_PATH=str(folder/'library.json');pathlib.Path(app.CACHE_PATH).write_text(json.dumps({'tracks':tracks}),encoding='utf-8')
 client=app.app.test_client()
 r=client.post('/api/library/rescan',json={},headers={'Host':'127.0.0.1','Origin':'http://127.0.0.1'})
 data=r.get_json();kept=[pathlib.Path(t['path']).name for t in json.loads(pathlib.Path(app.CACHE_PATH).read_text(encoding='utf-8'))['tracks']]
 assert r.status_code==200 and kept==['a.mp3','b.mp4','c.vob'],(r.status_code,data,kept)
 assert sorted(b['error'] for b in data['broken_tracks'])==['File not found','File too small (possibly corrupt)','Unsupported format']
 print('PASS: rekordbox Locations use C:/ paths, missing values export as empty; rescan keeps MP3/MP4/VOB and drops only missing, tiny or unsupported files')
except BaseException:
 traceback.print_exc();sys.exit(1)
