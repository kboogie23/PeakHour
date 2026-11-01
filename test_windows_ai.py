"""AI Assist (windows_ai.py) end to end against stand-in Claude and OpenAI servers (the real anthropic and openai
SDKs, pointed at a local fake that answers in each API's shape): keys stored with DPAPI and never returned;
what is sent (model, structured-output schema, Claude's refusal fallback, OpenAI strict schema, no storage);
the four checks pick the right tracks; suggestions only; approved ones saved through PEAK HOUR's own
endpoints into a fixture library (title/artist history, year, genre, energy); skipped ones untouched; music
files unchanged; refusals and bad keys reported; the endpoints answer this PC only."""
import os,sys,pathlib,uuid,json,time,shutil,traceback,threading,subprocess
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
workspace=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(workspace/'axiom-win-probe'))
try:
 import windows_ai as A
 base=workspace/'fixtures'/'ai'/uuid.uuid4().hex;base.mkdir(parents=True)
 # Keys: DPAPI round trip, nothing readable on disk
 store=A.KeyStore(base/'keys');secret='sk-ant-test-'+'x'*40
 store.set('claude',secret);assert store.get('claude')==secret and store.has('claude') and not store.has('openai')
 assert secret.encode() not in (base/'keys'/'keys.dat').read_bytes()
 store.set('claude','');assert not store.has('claude')
 # Stand-in servers
 seen=[];mode={'refuse':False,'deny':False,'status':None}
 def answer(kind,body):
  if kind=='claude':
   schema=body['output_config']['format']['schema'];payload=json.loads(body['messages'][0]['content'])
  else:
   schema=body['text']['format']['schema'];payload=json.loads(body['input'])
  if 'candidates' in payload:  # playlist: an unknown id and a repeat must be dropped; order reversed
   ids=[c['id'] for c in payload['candidates']][::-1]
   return json.dumps({'name':'Stand-in Set','notes':'warm-up into peak','tracks':[{'id':'c999999','why':'not in library'}]+[{'id':i,'why':'flows'} for i in ids]+[{'id':ids[0],'why':'repeat'}]})
  props=schema['properties']['items']['items']['properties']
  out=[]
  for t in payload['tracks']:
   item={'id':t['id'],'confidence':'high','reason':'stand-in'}
   if 'year' in props:item.update(year=1995 if 'shook' in t['title'].lower() else 2004,version_year=2004)
   if 'title' in props:item.update(title=t['title'].replace('_',' ').title().replace('(Official Video)','').strip(),artist=t['artist'] or 'Mobb Deep',changed=True)
   if 'genre' in props:item.update(genre='Hip Hop')
   if 'energy' in props:item.update(energy='High')
   out.append(item)
  return json.dumps({'items':out})
 class Fake(BaseHTTPRequestHandler):
  def log_message(self,*a):pass
  def do_POST(self):
   body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
   seen.append((self.path,dict(self.headers),body))
   if mode['status']:
    code,err=mode['status'];data=json.dumps(err).encode()
    self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('retry-after','0');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
   if mode['deny']:
    self.send_response(401);self.send_header('Content-Type','application/json');self.end_headers()
    self.wfile.write(json.dumps({'type':'error','error':{'type':'authentication_error','message':'invalid x-api-key'}}).encode());return
   if self.path.split('?')[0].endswith('/v1/messages'):
    reply={'id':'msg_1','type':'message','role':'assistant','model':body['model'],'stop_reason':'refusal' if mode['refuse'] else 'end_turn','stop_sequence':None,
           'content':[] if mode['refuse'] else [{'type':'text','text':answer('claude',body)}],'usage':{'input_tokens':10,'output_tokens':10}}
   else:
    reply={'id':'resp_1','object':'response','created_at':0,'model':body['model'],'status':'completed','parallel_tool_calls':True,'tool_choice':'auto','tools':[],
           'output':[{'type':'message','id':'m1','status':'completed','role':'assistant','content':[{'type':'output_text','text':answer('openai',body),'annotations':[]}]}]}
   data=json.dumps(reply).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 server=ThreadingHTTPServer(('127.0.0.1',0),Fake);threading.Thread(target=server.serve_forever,daemon=True).start()
 url=f'http://127.0.0.1:{server.server_port}'
 # Providers through the real SDKs
 schema=A.TASKS['year']['schema'];msg=json.dumps({'tracks':[{'id':'t1','artist':'Mobb Deep','title':'Shook Ones','file':''}]})
 got=A.ClaudeProvider('k'*30,'claude-opus-5-5',url).ask('sys',msg,schema)
 assert got['items'][0]['year']==1995
 path,headers,body=seen[-1]
 assert path.split('?')[0]=='/v1/messages' and body['model']=='claude-opus-5-5' and body['fallbacks']=='default' and 'server-side-fallback-2026-07-01' in headers.get('anthropic-beta','')
 assert body['output_config']['format']['type']=='json_schema' and body['system']=='sys' and 'temperature' not in body
 A.ClaudeProvider('k'*30,'claude-haiku-5-5',url).ask('sys',msg,schema);assert 'fallbacks' not in seen[-1][2]  # Haiku 5.5 has no fallback
 got=A.OpenAIProvider('k'*30,'gpt-5.5',url+'/v1').ask('sys',msg,schema)
 path,headers,body=seen[-1]
 assert path=='/v1/responses' and got['items'][0]['year']==1995 and body['store'] is False and body['text']['format']['strict'] is True and body['instructions']=='sys'
 mode['refuse']=True
 try:A.ClaudeProvider('k'*30,'claude-opus-5-5',url).ask('s',msg,schema);raise AssertionError('no refusal')
 except A.AIError as e:assert 'declined' in str(e)
 mode['refuse']=False;mode['deny']=True
 for P,u in ((A.ClaudeProvider,url),(A.OpenAIProvider,url+'/v1')):
  try:P('k'*30,'claude-opus-5-5' if P is A.ClaudeProvider else 'gpt-5.5',u).ask('s',msg,schema);raise AssertionError('no auth error')
  except A.AIError as e:assert 'API key' in str(e),e
 mode['deny']=False
 # Credit and rate limits are told apart (OpenAI error code; Claude credit message)
 for status,provider,expect in (((429,{'error':{'message':'You exceeded your current quota','type':'insufficient_quota','code':'insufficient_quota'}}),'openai','no credit left'),
                                ((429,{'error':{'message':'You have no credits remaining.','type':'insufficient_quota','param':None,'code':'credit_balance_exhausted'}}),'openai','no credit left'),
                                ((429,{'error':{'message':'Rate limit reached','type':'requests','code':'rate_limit_exceeded'}}),'openai','how fast'),
                                ((400,{'type':'error','error':{'type':'invalid_request_error','message':'Your credit balance is too low to access the Anthropic API.'}}),'claude','no credit left'),
                                ((429,{'type':'error','error':{'type':'rate_limit_error','message':'Number of request tokens has exceeded your per-minute rate limit'}}),'claude','how fast')):
  mode['status']=status
  try:
   (A.OpenAIProvider('k'*30,'gpt-5.5',url+'/v1') if provider=='openai' else A.ClaudeProvider('k'*30,'claude-opus-5-5',url)).ask('s',msg,schema)
   raise AssertionError('no error')
  except A.AIError as e:assert expect in str(e),(provider,str(e))
 mode['status']=None
 # Playlists: only library tracks, each once, in the AI's order; filters and the 600-candidate cap
 class FakeApp:
  CACHE_PATH='x'
  def __init__(self,tracks):self.tracks=tracks
  def load_cache(self,p):return {'tracks':self.tracks}
  def _all_library_cache_tracks(self,c):return c['tracks']
  def light_track(self,t):return {k:t[k] for k in ('path','title','artist','bpm','year') if k in t}
  def is_health_recording(self,t):return t.get('duration_sec',0)>=1800
 lib=[{'path':f'C:/m/{i}.mp3','title':f'Song {i}','artist':'Nas' if i<10 else 'Other','genre':'Hip Hop' if i%2 else 'Pop','bpm':90+i%20,'year':1990+i%30,'duration_sec':200} for i in range(700)]
 lib.append({'path':'C:/m/mix.mp3','title':'Nas DJ Mix','artist':'Nas','genre':'Hip Hop','bpm':95,'year':1995,'duration_sec':3600})
 pa=A.AIAssist(FakeApp(lib),base/'pl',providers={'claude':lambda k,m:A.ClaudeProvider(k,m,url)});pa.keys.set('claude','sk-ant-'+'p'*40)
 cands=pa._candidates('Nas hip hop warm-up',None,None,None,None)
 assert len(cands)==600 and all(c['artist']=='Nas' and c['genre']=='Hip Hop' for c in cands[:5]) and not any(c['path'].endswith('mix.mp3') for c in cands)  # best text matches first
 assert all(95<=c['bpm']<=100 and 1995<=c['year']<=2000 for c in pa._candidates('x set',95,100,1995,2000))
 try:pa.build_playlist('hip hop',20,200,210);raise AssertionError('no error')
 except A.AIError as e:assert 'Fewer than 5' in str(e)
 try:pa.build_playlist('',20);raise AssertionError('no error')
 except A.AIError as e:assert 'Describe' in str(e)
 r=pa.build_playlist('Nas warm-up',8,90,95,1990,1999)
 for _ in range(200):
  p=pa.playlist_status()['playlist']
  if p['state']!='running':break
  time.sleep(0.05)
 assert p['state']=='done',p
 paths=[t['path'] for t in p['tracks']];expected=[c['path'] for c in pa._candidates('Nas warm-up',90,95,1990,1999)][::-1][:8]
 assert paths==expected and len(set(paths))==8 and p['name']=='Stand-in Set' and p['minutes']==round(8*200/60) and all(t['ai_reason']=='flows' for t in p['tracks'])
 body=seen[-1][2];sent=json.loads(body['messages'][0]['content'])
 assert sent['tracks_wanted']==8 and sent['brief']=='Nas warm-up' and set(sent['candidates'][0])=={'id','artist','title','bpm','key','year','genre','energy','length'}
 # Full flow in PEAK HOUR with a fixture library
 music=base/'Music';music.mkdir();seed=workspace/'fixtures'/'stress'/'seed.mp3'
 names=['mobb_deep_shook_ones_(Official Video).mp3','Clean Song.mp3','No Genre.mp3']
 for n in names:shutil.copyfile(seed,music/n)
 before={n:(music/n).read_bytes() for n in names}
 data=base/'data';(data/'data').mkdir(parents=True)
 tracks=[{'path':str(music/names[0]),'filename':names[0],'title':'shook_ones_(Official Video)','artist':'','genre':'','year':'','bpm':94,'energy':'Low','duration_sec':330},
         {'path':str(music/names[1]),'filename':names[1],'title':'Clean Song','artist':'Somebody','genre':'Pop','year':2004,'bpm':120,'energy':'High','duration_sec':200},
         {'path':str(music/names[2]),'filename':names[2],'title':'No Genre','artist':'Somebody Else','genre':'','year':2010,'bpm':100,'energy':'Unknown','duration_sec':200}]
 (data/'data'/'library_cache.json').write_text(json.dumps({'tracks':tracks,'total_tracks':3,'folder_structure':{str(music):{}}}),encoding='utf-8')
 script=f'''
import os,sys,json,time,pathlib
os.environ['AXIOM_RUNTIME_DIR']={str(data)!r}
sys.path.insert(0,{str(workspace/'axiom-win-probe')!r})
import axiom_windows_launcher as L, windows_ai as A
L.data_root=lambda:pathlib.Path({str(data)!r})
axiom=L.build_app(8098)
url={url!r}
axiom.AI_ASSIST.providers={{'claude':lambda k,m:A.ClaudeProvider(k,m,url),'openai':lambda k,m:A.OpenAIProvider(k,m,url+'/v1')}}
c=axiom.app.test_client();b='http://127.0.0.1:8098';out={{}}
def get(p):return c.get(p,base_url=b).get_json()
def post(p,body,**kw):r=c.post(p,json=body,base_url=b,**kw);return r.status_code,r.get_json()
out['nokey']=post('/api/windows/ai/run',{{'task':'year'}})
out['badkey']=post('/api/windows/ai/key',{{'provider':'claude','key':'short'}})
out['remote']=post('/api/windows/ai/key',{{'provider':'claude','key':'k'*40}},environ_base={{'REMOTE_ADDR':'192.168.0.7'}})[0]
out['save']=post('/api/windows/ai/key',{{'provider':'claude','key':'sk-ant-'+'k'*40}})
out['save2']=post('/api/windows/ai/key',{{'provider':'openai','key':'sk-'+'o'*40}})
out['status_text']=json.dumps(get('/api/windows/ai/status'))
out['test']=post('/api/windows/ai/test',{{'provider':'claude'}})
out['playlist_small']=post('/api/windows/ai/playlist',{{'brief':'warm-up','count':10}})
out['previews']={{t:get(f'/api/windows/ai/preview?task={{t}}&scope=needs') for t in ('year','tidy','genre','energy')}}
results={{}}
for task,provider in (('year','claude'),('tidy','openai'),('genre','claude'),('energy','openai')):
    code,r=post('/api/windows/ai/run',{{'task':task,'scope':'needs','limit':50,'provider':provider}})
    assert code==200,r
    for _ in range(200):
        s=get('/api/windows/ai/status')
        if s['job']['state']!='running':break
        time.sleep(0.05)
    sug=get('/api/windows/ai/suggestions')
    results[task]={{'state':s['job']['state'],'error':s['job']['error'],'items':sug['items']}}
    ids=[i['id'] for i in sug['items']]
    if task=='genre' and len(ids)>1:
        post('/api/windows/ai/apply',{{'ids':ids[1:],'skip':True}});ids=ids[:1]
    code,first=post('/api/windows/ai/apply',{{'ids':ids}})
    again=post('/api/windows/ai/apply',{{'ids':ids}})  # a second click while saving is refused, not run twice
    for _ in range(400):
        job=get('/api/windows/ai/suggestions')['job']
        if (job.get('applying') or {{}}).get('state')!='running':break
        time.sleep(0.05)
    results[task]['apply']=(code,job['applying'])
    results[task]['again']=again[0]
out['results']=results
out['cache']=json.load(open(axiom.CACHE_PATH,encoding='utf-8'))['tracks']
print(json.dumps(out,default=str))
'''
 run=subprocess.run([sys.executable,'-c',script],capture_output=True,text=True,timeout=300,cwd=str(workspace))
 assert run.returncode==0,run.stderr[-4000:]
 out=json.loads(run.stdout.strip().splitlines()[-1])
 assert out['nokey'][0]==400 and 'API key' in out['nokey'][1]['error']
 assert out['badkey'][0]==400 and out['remote']==403 and out['save'][0]==200 and out['save2'][0]==200
 assert 'kkkkkkkk' not in out['status_text'] and 'oooooooo' not in out['status_text'] and '"key_set": true' in out['status_text']
 assert out['test'][0]==200 and out['test'][1]['year']==1995
 assert out['playlist_small'][0]==400 and 'Fewer than 5' in out['playlist_small'][1]['error']
 p=out['previews'];assert p['year']['matching']==1 and p['tidy']['matching']==1 and p['genre']['matching']==2 and p['energy']['matching']==1,p
 r=out['results']
 for task in r:assert r[task]['state']=='done' and not r[task]['error'],(task,r[task])
 assert [i['suggested'] for i in r['year']['items']]==[1995]
 assert r['tidy']['items'][0]['new_title']=='Shook Ones' and r['tidy']['items'][0]['new_artist']=='Mobb Deep'
 assert len(r['genre']['items'])==2 and r['genre']['apply'][1]['applied']==1 and r['genre']['apply'][1]['done']==1
 assert r['energy']['items'][0]['suggested']=='High' and r['energy']['apply'][1]['applied']==1
 for task in ('year','tidy'):assert r[task]['apply'][1]['applied']==1,(task,r[task]['apply'])
 cache={pathlib.Path(t['path']).name:t for t in out['cache']}
 shook,clean,nogenre=cache[names[0]],cache[names[1]],cache[names[2]]
 assert int(shook['year'])==1995 and shook['title']=='Shook Ones' and shook['artist']=='Mobb Deep' and shook['manual_metadata_history']
 assert shook['genre']=='Hip Hop' and nogenre.get('genre','')=='' and nogenre['energy']=='High' and nogenre['energy_source']=='ai_approved'
 assert clean['title']=='Clean Song' and int(clean['year'])==2004 and clean['genre']=='Pop'
 assert before=={n:(music/n).read_bytes() for n in names}  # music files untouched
 server.shutdown();shutil.rmtree(base,ignore_errors=True)
 print('PASS: AI Assist sends the right requests to Claude and OpenAI, keeps keys sealed, and saves only approved suggestions')
except BaseException:
 traceback.print_exc();sys.exit(1)
