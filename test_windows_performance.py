"""Big-library speed-ups (windows_performance.py, FastRealpath.stat in windows_intake.py) give exactly AXIOM's
answers: the recording classification on short and long tracks and overrides; one drive check per file per
GET request (always fresh for other requests); a Health-count stat from the folder listing with the same
existence, size and modified time, only inside that thread; the suffix pattern built once and rebuilt
when the list changes; the thread snapshot endpoint answers on this PC only."""
import os,sys,pathlib,uuid,shutil,traceback,threading,subprocess,re
workspace=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(workspace/'axiom-win-probe'))
try:
 import windows_performance as P, windows_intake as I, windows_stress_report as R
 import health_recordings as H
 # Recording classification: short tracks answered directly, the rest by AXIOM
 orig=H.recording_classification;quick=P.quick_classification(orig)
 cases=[None,{},{'duration_sec':120,'title':'DJ Mix'},{'duration_sec':899.99,'title':'Full Set'},{'duration_sec':900,'title':'Full Set'},
        {'duration':1250,'name':'Live at Wembley'},{'duration':1800,'title':'x'},{'duration_sec':'abc','duration':950,'title':'DJ mix'},
        {'duration_sec':float('nan'),'duration':300},{'duration_sec':-5,'duration':'1000','filename':'essential_mix.mp3'},
        {'duration':60,'health_recording_override':'dj_mix'},{'duration':3000,'health_recording_override':'music'},
        {'duration':60,'health_recording_override':'other'},{'duration_sec':float('inf'),'duration':10}]
 for case in cases:assert quick(case)==orig(case),case
 a=quick({'duration':60});a['type']='changed';assert quick({'duration':60})['type']=='music'  # a new dict each time
 try:quick({'health_recording_override':{}});raise AssertionError('no error')
 except TypeError:pass  # as AXIOM
 # One drive check per file per GET request
 from flask import Flask
 calls=[];check=P.once_per_request(lambda t:calls.append(t['path']) or True)
 web=Flask('t')
 with web.test_request_context('/get-tracks'):
  assert check({'path':'X:\\a.mp4'}) and check({'path':'X:\\a.mp4'}) and check({'path':'X:\\b.mp4'}) and calls==['X:\\a.mp4','X:\\b.mp4']
 calls.clear()
 with web.test_request_context('/api/delete',method='POST'):check({'path':'X:\\a.mp4'});check({'path':'X:\\a.mp4'})
 assert calls==['X:\\a.mp4','X:\\a.mp4']
 calls.clear();check({'path':'X:\\a.mp4'});check({'path':'X:\\a.mp4'});assert len(calls)==2  # no request: always asks
 # Health-count stat from the folder listing
 base=workspace/'fixtures'/'performance'/uuid.uuid4().hex;(base/'Linked').mkdir(parents=True);(base/'Sub').mkdir()
 (base/'song.mp3').write_bytes(bytes(1000));(base/'Linked'/'in.mp3').write_bytes(bytes(5))
 subprocess.run(['cmd','/c','mklink','/J',str(base/'Junction'),str(base/'Linked')],capture_output=True,check=True)
 real=os.stat;asked=[];fast=I.FastRealpath(stat=lambda p,*a,**k:asked.append(p) or real(p,*a,**k))
 paths=[str(base/'song.mp3'),str(base/'SONG.MP3'),str(base/'Junction'/'in.mp3'),str(base/'Sub'),str(base/'Junction')]
 with fast.active(stat=True):
  for p in paths:
   x,y=fast.stat(p),real(p);assert (x.st_size,x.st_mtime_ns)==(y.st_size,y.st_mtime_ns),p
  asked.clear();fast.stat(str(base/'song.mp3'));assert asked==[]  # from the listing
  try:fast.stat(str(base/'missing.mp3'));raise AssertionError('no error')
  except FileNotFoundError:pass
  asked.clear();fast.stat(str(base/'song.mp3'),follow_symlinks=False);assert asked  # other arguments: Windows' stat
  other=[];t=threading.Thread(target=lambda:other.append(fast.stat(str(base/'song.mp3'))));t.start();t.join()
  assert len(asked)==2  # other threads: Windows' stat
 with fast.active():asked.clear();fast.stat(str(base/'song.mp3'));assert asked  # the import never uses the listing
 # islink from the listing in any active thread (no file ID needed): same answers as Windows
 import ntpath
 links=[str(base/'song.mp3'),str(base/'Junction'),str(base/'Sub'),str(base/'missing.mp3'),str(base)]
 with fast.active():assert [fast.islink(p) for p in links]==[ntpath.islink(p) for p in links]
 asked.clear();fast.stat(str(base/'song.mp3'));assert asked
 # The Health count runs inside the listing context, and only it
 inside=[];job=P.faster_health_count(lambda *a:inside.append(getattr(I.FAST_REALPATH.local,'stat',False)))
 job(1,2,3);assert inside==[True] and not getattr(I.FAST_REALPATH.local,'stat',False)
 # Suffix stripping: AXIOM's construction, built once per list
 class App:pass
 app=App();app.TITLE_ARTIST_SUFFIXES=['clean','dirty','radio edit','extended mix','(intro)']
 def axiom_strip(value):
  pattern='|'.join(re.escape(s) for s in sorted(app.TITLE_ARTIST_SUFFIXES,key=len,reverse=True))
  value=re.sub(rf'\b(?:{pattern})\b\s*$',' ',value,flags=re.IGNORECASE)
  return re.sub(rf'\b(?:{pattern})\b',' ',value,flags=re.IGNORECASE)
 app._strip_suffixes=axiom_strip;strip=P.suffix_stripper(app)
 for v in ('Song Clean','Song (Radio Edit) Dirty','Extended Mixer','A Radio  Edit','', 'Ünï Clean'):assert strip(v)==axiom_strip(v),v
 app.TITLE_ARTIST_SUFFIXES.append('remix');assert strip('Song Remix')==axiom_strip('Song Remix')=='Song  '
 # Thread snapshot: this PC only
 class Report:
  def snapshot(self):return {'state':'idle'}
 web=Flask('s');web.register_blueprint(R.create_stress_report_blueprint(Report(),lambda p:None));c=web.test_client()
 data=c.get('/api/windows/threads?seconds=0.1').get_json();assert data['success'] and isinstance(data['threads'],list)
 assert c.get('/api/windows/threads',environ_base={'REMOTE_ADDR':'192.168.0.9'}).status_code==403
 shutil.rmtree(base,ignore_errors=True)
 print('PASS: big-library speed-ups give AXIOM\'s exact answers: recordings, drive checks, Health-count stat, suffixes')
except BaseException:
 traceback.print_exc();sys.exit(1)
