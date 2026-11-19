"""AI Assist recovery (windows_ai.py), self-contained: a run or an apply saved as 'running' when PEAK HOUR closed
comes back 'interrupted' (and no longer blocks start/apply); apply is refused while a run is live; concurrent saves
never corrupt the run file; a bad limit/count is a 400, not a 500. Sandbox under fixtures; no keys, no API calls."""
import os,sys,pathlib,uuid,json,time,shutil,traceback,threading
workspace=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(workspace/'axiom-win-probe'))
try:
 import windows_ai as A
 from flask import Flask
 base=workspace/'fixtures'/'ai-recovery'/uuid.uuid4().hex;base.mkdir(parents=True)
 class FakeApp:
  CACHE_PATH='x'
  def __init__(self,tracks):self.tracks=tracks
  def load_cache(self,p):return {'tracks':self.tracks}
  def _all_library_cache_tracks(self,c):return c['tracks']
 lib=[{'path':f'C:/m/{i}.mp3','title':f'Song {i}','artist':'Nas','genre':'Pop','bpm':90,'year':2000} for i in range(30)]
 gate=threading.Event()
 class Slow:
  def ask(self,system,text,schema):
   gate.wait(10);return {'items':[]}
 def make(name):
  a=A.AIAssist(FakeApp(lib),base/name);a.client=lambda provider=None:Slow();return a
 def plant(name,**job):  # a run file as an earlier PEAK HOUR session left it
  runs=base/name/'runs';runs.mkdir(parents=True,exist_ok=True)
  job={'id':uuid.uuid4().hex[:12],'task':'genre','scope':'all','provider':'claude','model':'m','state':'running','done':3,'total':30,
       'started':time.time(),'error':None,'items':[{'id':'a1','path':'C:/m/1.mp3','status':'pending','suggested':'Rap','confidence':'high'}],**job}
  (runs/f"{job['id']}.json").write_text(json.dumps(job),encoding='utf-8');return job
 # 1. closed mid-run: status() says interrupted (and saves it), start() works
 planted=plant('one');a=make('one')
 st=a.status();assert st['job']['state']=='interrupted' and st['job']['id']==planted['id'],st['job']
 assert json.loads((base/'one'/'runs'/f"{planted['id']}.json").read_text())['state']=='interrupted'
 assert a.suggestions()['job']['state']=='interrupted' and len(a.suggestions()['items'])==1
 started=a.start('genre','all',5)['job'];assert started['state']=='running' and started['id']!=planted['id']
 # 2. apply is refused while that run is live, and start is refused too
 try:a.apply(['a1']);raise AssertionError('apply accepted during a run')
 except A.AIError as e:assert 'still checking' in str(e)
 try:a.start('genre','all',5);raise AssertionError('second run accepted')
 except A.AIError as e:assert 'already working' in str(e)
 gate.set()
 for _ in range(100):
  if a.job['state']!='running':break
  time.sleep(0.05)
 assert a.job['state']=='done'
 # 3. apply closed mid-save: applying 'running' -> 'interrupted'; skip works afterwards
 plant('two',state='done',applying={'state':'running','done':1,'total':2,'applied':1,'failed':0})
 b=make('two');job=b.suggestions()['job'];assert job['state']=='done' and job['applying']['state']=='interrupted'
 assert b.apply(['a1'],skip=True)['skipped']==1 and b.suggestions()['items'][0]['status']=='skipped'
 # 4. a normal done run is left alone; a broken file is ignored
 plant('three',state='done');assert make('three').suggestions()['job']['state']=='done'
 (base/'four'/'runs').mkdir(parents=True);(base/'four'/'runs'/'x.json').write_text('{oops');assert make('four').suggestions()=={'job':None,'items':[]}
 # 5. concurrent saves of one job (run thread + apply thread) leave one valid file and no .part
 c=make('five');big={'id':'race','items':[{'id':str(i),'status':'pending'} for i in range(300)]};stop=[]
 def writer():
  while not stop:c._save(big)
 def mutator():
  n=0
  while not stop:big['items'][n%300]['error%d'%(n%50)]='x';n+=1
 threads=[threading.Thread(target=f) for f in (writer,writer,mutator)];[t.start() for t in threads];time.sleep(1.0);stop.append(1);[t.join() for t in threads]
 c._save(big);assert json.loads((base/'five'/'runs'/'race.json').read_text())['id']=='race' and not list((base/'five'/'runs').glob('*.part'))
 # 6. bad numbers are a clear 400
 d=make('six');app=Flask(__name__);app.register_blueprint(A.create_ai_blueprint(d));cl=app.test_client()
 for route,body in (('/api/windows/ai/run',{'task':'genre','limit':'abc'}),('/api/windows/ai/run',{'task':'genre','limit':[1]}),
                    ('/api/windows/ai/playlist',{'brief':'warm up set','count':'many'}),('/api/windows/ai/playlist',{'brief':'warm up set','count':float('inf')})):
  r=cl.post(route,json=body,environ_base={'REMOTE_ADDR':'127.0.0.1'});assert r.status_code==400 and 'whole number' in r.get_json()['error'],(route,body,r.status_code,r.get_data())
 shutil.rmtree(base)
 print('PASS: AI Assist interrupted runs recover, apply waits for a run, saves are serialised, bad numbers give 400')
except BaseException:
 traceback.print_exc();sys.exit(1)
