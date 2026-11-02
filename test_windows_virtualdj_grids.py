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
 # Progress saving at scale (analysis stubbed): finished rows are appended, the full results are written once at the end
 import threading
 def fake_row(i):return {'path':'C:/m/%d.mp3'%i,'title':'Song %d'%i,'artist':'Artist %d'%(i%97),'bpm':120.0,'status':'clean' if i%7 else 'repair',
                         'issues':['audio_drift'] if i%7==0 else [],'issue_text':['The beats drift away from the audio later in the song.'] if i%7==0 else [],
                         'detail':'','suggestion':'','repair_grid':{'spb':0.5,'first':0.1,'bpm':120.0},'checked_grid':{'first':0.1,'spb':0.5}}
 class Stub(G.VirtualDJGridCheck):
  count=0;stop_at=None;gate=threading.Event()
  def songs(self,scope='full',folder=''):return [{'path':'C:/m/%d.mp3'%i} for i in range(self.count)],[]
  def check_one(self,track):
   i=int(track['path'].rsplit('/',1)[1].split('.')[0])
   if self.stop_at is not None and i==self.stop_at:self.gate.wait(30)
   return fake_row(i)
 def run_stub(path,n):
  ck=Stub(None,path);ck.count=n;t0=time.perf_counter();ck.start('full');ck._thread.join(300);return ck,time.perf_counter()-t0
 def old_style_seconds(path,n):  # the previous behaviour: the whole growing state rewritten every 25 songs
  state={'kind':'axiom_virtualdj_grid_check','status':'running','results':[],'total':n,'done':0};t0=time.perf_counter()
  for i in range(n):
   state['results'].append(fake_row(i));state['done']+=1
   if state['done']%25==0:path.write_text(json.dumps(state),encoding='utf-8')
  return time.perf_counter()-t0
 big=folder/'scale';big.mkdir()
 old_5k=old_style_seconds(big/'old.json',5000)
 ck5,new_5k=run_stub(big/'new5k.json',5000)
 ck,new_20k=run_stub(big/'virtualdj_grid_check.json',20000)
 st=json.loads((big/'virtualdj_grid_check.json').read_text(encoding='utf-8'))
 assert st['status']=='complete' and st['done']==20000 and len(st['results'])==20000 and not (big/'virtualdj_grid_check.json.rows').exists()
 assert ck.snapshot()['counts']=={'clean':20000-2858,'repair':2858},ck.snapshot()['counts']
 print('grid progress saving: 5,000 results old %.2fs vs new %.2fs; 20,000 results new %.2fs (result file %.1f MB)'%(old_5k,new_5k,new_20k,(big/'virtualdj_grid_check.json').stat().st_size/1e6))
 assert new_5k<old_5k/3,(new_5k,old_5k)
 # The app closes mid-check: the rows saved so far come back, marked interrupted, and a new check starts clean
 crash=big/'crash.json';ck=Stub(None,crash);ck.count=1000;ck.stop_at=520;ck.start('full')
 t0=time.time()
 while ck.snapshot()['done']<520 and time.time()-t0<30:time.sleep(0.02)
 mid=json.loads(crash.read_text(encoding='utf-8'));assert mid['status']=='running' and 'results' not in mid and mid['done']==500,mid.get('done')
 assert (crash.with_name('crash.json.rows')).is_file()
 with open(crash.with_name('crash.json.rows'),'a',encoding='utf-8') as h:h.write('{"path": "C:/cut')  # torn last line
 back=Stub(None,crash);snap=back.snapshot(include_results=True)
 assert snap['status']=='interrupted' and snap['done']==500 and len(snap['results'])==500 and snap['total']==1000,(snap['status'],snap['done'])
 ck.gate.set();ck._thread.join(30)
 back.count=30;back.start('full');back._thread.join(30);assert back.snapshot()['done']==30 and back.snapshot()['status']=='complete'
 print('grid check resumes after a mid-run close: 500 of 1000 results recovered, torn last line ignored')
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
