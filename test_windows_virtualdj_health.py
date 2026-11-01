"""Health Accelerator for VirtualDJ: preview then fill missing BPM/key/year in AXIOM by exact path from a
COPY of the user's VirtualDJ database; existing AXIOM values are never overwritten; VirtualDJ untouched."""
import os,sys,pathlib,json,uuid,shutil,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 import windows_virtualdj_health as V
 from windows_virtualdj_database import read_database
 folder=workspace/'fixtures'/'vdj-health'/uuid.uuid4().hex;folder.mkdir(parents=True)
 db=workspace/'fixtures'/'vdj-copy'/'home'/'database.xml';stamp=db.stat().st_mtime_ns
 from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 songs=[t for t in read_database(db)['tracks'] if t.get('bpm') and t.get('key')][:3]
 assert len(songs)==3
 a,b,c=songs
 tracks=[{'path':a['path'],'title':'A'},  # missing everything: filled
         {'path':b['path'],'title':'B','bpm':140.0,'camelot':'1A','year':1900},  # conflicting: kept
         {'path':c['path'].upper(),'title':'C','bpm':c['bpm']},  # same file, different case: matched, BPM equal
         {'path':'Z:/not/in/vdj.mp3','title':'D'}]
 app.CACHE_PATH=str(folder/'library_cache.json');pathlib.Path(app.CACHE_PATH).write_text(json.dumps({'tracks':tracks}),encoding='utf-8')
 bp=V.create_health_blueprint(app,lambda n:None,databases=lambda:[db])
 import flask;f=flask.Flask('t');f.register_blueprint(bp);client=f.test_client()
 p=client.post('/api/windows/virtualdj/health_pull',json={}).get_json()
 assert p['success'] and p['apply'] is False and p['summary']['matched']==3 and p['summary']['bpm']==1 and p['summary']['conflicts']>=1,p['summary']
 assert json.loads(pathlib.Path(app.CACHE_PATH).read_text(encoding='utf-8'))['tracks']==tracks  # preview writes nothing
 r=client.post('/api/windows/virtualdj/health_pull',json={'apply':True}).get_json()
 after={t['title']:t for t in json.loads(pathlib.Path(app.CACHE_PATH).read_text(encoding='utf-8'))['tracks']}
 assert after['A']['bpm']==app.coerce_bpm_value(a['bpm']) and after['A']['camelot']==app.get_camelot(a['key']) and after['A']['bpm_source']=='virtualdj_database'
 assert (after['B']['bpm'],after['B']['camelot'],after['B']['year'])==(140.0,'1A',1900)  # never overwritten
 assert after['D']=={'path':'Z:/not/in/vdj.mp3','title':'D'} and db.stat().st_mtime_ns==stamp
 print('PASS: VirtualDJ fills missing BPM/key/year by exact path after a preview; conflicts kept; VirtualDJ untouched',r['summary'])
except BaseException:
 traceback.print_exc();sys.exit(1)
