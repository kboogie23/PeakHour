"""VirtualDJ beat grid check: AXIOM's Beatgrid Doctor engine audits VirtualDJ's stored grids against the
audio, read-only, through the Windows endpoints. Uses COPIES of the user's VirtualDJ databases."""
import os,sys,pathlib,json,time,uuid,math,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 import windows_virtualdj_grids as G
 # Grid parsing: seconds-per-beat from Scan, first beat from the beatgrid Poi, negative start shifted by whole beats
 song={'path':'C:/x.mp3','source_sections':{'Scan':[{'attributes':{'Bpm':'0.5'}}],'Poi':[{'attributes':{'Type':'beatgrid','Pos':'-0.2'}},{'attributes':{'Type':'cue','Pos':'3'}}]}}
 points,spb=G.stored_grid(song);a=G.beat_anchors(points,spb,10.0)
 assert spb==0.5 and a[0]=={'beat':0,'seconds':0.3} and a[-1]=={'beat':19,'seconds':9.8},a
 assert G.stored_grid({'source_sections':{'Scan':[{'attributes':{'Bpm':'0.5'}}]}}) is None  # no beatgrid Poi
 two={'source_sections':{'Scan':[{'attributes':{'Bpm':'0.5'}}],'Poi':[{'attributes':{'Type':'beatgrid','Pos':'1'}},{'attributes':{'Type':'beatgrid','Pos':'5','Bpm':'0.4'}}]}}
 p,sp=G.stored_grid(two);assert G.beat_anchors(p,sp,9.0)==[{'beat':0,'seconds':1.0},{'beat':8,'seconds':5.0},{'beat':18,'seconds':9.0}]
 folder=workspace/'fixtures'/'vdj-grids'/uuid.uuid4().hex;folder.mkdir(parents=True)
 from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder,virtualdj_allowed_path=lambda p:True)
 copies=[workspace/'fixtures'/'vdj-copy'/'home'/'database.xml']
 app.WINDOWS_VIRTUALDJ_GRIDS=checker=G.VirtualDJGridCheck(app,folder/'virtualdj_grid_check.json',databases=lambda:copies)

 # route the endpoints at this test's checker
 import flask
 bp_app=flask.Flask('t');bp_app.register_blueprint(G.create_grid_blueprint(checker,lambda name:None,lambda prompt:('',True)))
 c=bp_app.test_client()
 before={p:p.stat().st_mtime_ns for p in copies}
 r=c.post('/api/windows/virtualdj/grids/start',json={'scope':'test'}).get_json();assert r['success'] and r['total']==10,r
 assert c.post('/api/windows/virtualdj/grids/start',json={'scope':'test'}).status_code==400  # one at a time
 t0=time.time()
 while True:
  st=c.get('/api/windows/virtualdj/grids/status').get_json()
  if st['status']!='running':break
  assert time.time()-t0<300;time.sleep(0.5)
 st=c.get('/api/windows/virtualdj/grids/status?results=1').get_json()
 assert st['status']=='complete' and st['done']==10 and sum(st['counts'].values())==10,st['counts']
 assert all(r['status'] in ('clean','review','repair','error') for r in st['results'])
 assert st['counts'].get('clean',0)>=5,st['counts']  # VirtualDJ grids on dance tracks are mostly good
 assert all(isinstance(r['issue_text'],list) for r in st['results'])
 assert {p:p.stat().st_mtime_ns for p in copies}==before  # read-only
 assert c.post('/api/windows/virtualdj/grids/start',json={'scope':'folder'}).get_json()=={'success':False,'cancelled':True}
 saved=json.loads((folder/'virtualdj_grid_check.json').read_text(encoding='utf-8'));assert saved['done']==10
 print('PASS: VirtualDJ grids checked by AXIOM\'s engine',st['counts'],'in %.0fs; database copies untouched'%(time.time()-t0))
except BaseException:
 traceback.print_exc();sys.exit(1)
