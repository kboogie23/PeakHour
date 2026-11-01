"""Times AXIOM's Health "missing_key" scan (unified_health) on the 30 copied songs in a sandbox library.
Runs the real endpoint and polls it; prints per-song throughput and where analysis time goes."""
import os,sys,pathlib,json,time,uuid,cProfile,pstats,io,threading
import imageio_ffmpeg;ff=imageio_ffmpeg.get_ffmpeg_exe()
workspace=pathlib.Path(__file__).resolve().parent;probe=workspace/'axiom-win-probe';home=workspace/'probe-home'
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(home/'AppData/Local'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime'),'NO_PROXY':'*'})
sys.path.insert(0,str(probe));os.chdir(probe)
blocked=[]
def audit(event,args):  # FFmpeg only; no network; no writes outside the workspace
 if event=='subprocess.Popen' and not os.path.normcase(str(args[1])).lstrip('"').startswith(os.path.normcase(ff)):blocked.append(str(args[1])[:120]);raise PermissionError('Probe blocks '+str(args[1])[:80])
 if event in ('socket.connect','socket.connect_ex'):raise PermissionError('Probe blocks network')
 if event=='open' and len(args)>1 and isinstance(args[0],(str,os.PathLike)) and isinstance(args[1],str) and any(x in args[1] for x in 'wax+'):
  if not pathlib.Path(args[0]).resolve().is_relative_to(workspace):raise PermissionError('Probe blocks file write outside workspace')
sys.addaudithook(audit)
folder=workspace/'fixtures'/'scan-speed'/('keys-'+uuid.uuid4().hex[:6]);folder.mkdir()
from windows_bootstrap import build_backend
app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
app.CACHE_PATH=str(folder/'library_cache.json');pathlib.Path(app.CACHE_PATH).write_text(json.dumps({'tracks':[]}),encoding='utf-8')
app.is_safe_location=lambda p:True
import scanner,threading as _t
if os.environ.get('PROBE_WORKERS'):
  n=int(os.environ['PROBE_WORKERS']);scanner.DEEP_AUDIO_ANALYSIS_WORKERS=n;scanner.DEEP_AUDIO_ANALYSIS_SLOTS=_t.BoundedSemaphore(n)
print('workers',scanner.DEEP_AUDIO_ANALYSIS_WORKERS)
app._scan_and_merge_folder(str(workspace/'fixtures'/'scan-speed'/'music'))
count=int(sys.argv[1]) if len(sys.argv)>1 else 30
cache=json.loads(pathlib.Path(app.CACHE_PATH).read_text(encoding='utf-8'));cache['tracks']=cache['tracks'][:count]
for t in cache['tracks']:
  for k in ('camelot','key_raw','key_source'):t.pop(k,None)
pathlib.Path(app.CACHE_PATH).write_text(json.dumps(cache),encoding='utf-8')
client=app.app.test_client();h={'Host':'127.0.0.1','Origin':'http://127.0.0.1'}
prof=cProfile.Profile();prof.enable();t0=time.time()
r=client.post('/api/library/unified_health/start',json={'lanes':['missing_key'],'counts':{'missing_bpm':0,'missing_key':count,'missing_year':0},'paths':[],'scope':'full_library','preparation_filter':'','flow':'library'},headers=h)
print('start',r.status_code,str(r.get_json())[:300])
while True:
  st=client.get('/api/library/unified_health/status',headers=h).get_json() or {}
  job=st.get('job') or {}
  if job.get('status') in ('complete','no_work','needs_review','stopped','failed','error'):break
  if time.time()-t0>int(os.environ.get('PROBE_LIMIT','300')):print('timeout',st);break
  time.sleep(1)
  if int(time.time()-t0)%30==0:print('...',{k:(st.get('job') or {}).get(k) for k in ('status','processed_steps','total_steps','totals')},flush=True)
prof.disable();total=time.time()-t0
tracks=json.loads(pathlib.Path(app.CACHE_PATH).read_text(encoding='utf-8'))['tracks']
print('blocked',blocked[:3]);print('status',(st.get('job') or {}).get('status'),'total %.1fs'%total,'per song %.2fs'%(total/max(1,count)),'keys found',sum(1 for t in tracks if t.get('camelot')),'of',len(tracks))
out=io.StringIO();pstats.Stats(prof,stream=out).sort_stats('tottime').print_stats(18);print(out.getvalue()[:4500])
