"""Progress for "Adding your music" (windows_intake.py): the music files are counted from the directory
listing alone (supported types, sidecars and the recycle bin left out, excluded folders skipped); the count
becomes the job's total so the window shows a percentage; step 2 is timed from when the library is ready;
files per second and time left; the endpoint reports the latest job. A real import in a fixture data folder
(AXIOM's own add-folder job, with the count running beside it) ends with total = the songs indexed."""
import os,sys,pathlib,uuid,json,time,shutil,traceback,threading,urllib.request,subprocess
workspace=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(workspace/'axiom-win-probe'))
try:
 import windows_intake as I
 base=workspace/'fixtures'/'intake'/uuid.uuid4().hex
 music=base/'Music';(music/'A'/'B').mkdir(parents=True);(music/'$RECYCLE.BIN').mkdir();(music/'Skip').mkdir()
 for name in ('one.mp3','two.FLAC','A/three.wav','A/B/four.mp4','A/B/cover.jpg','A/._five.mp3','$RECYCLE.BIN/gone.mp3','Skip/six.mp3','notes.txt'):
  (music/name).write_bytes(b'\0')
 extensions={'.mp3','.flac','.wav','.mp4'}
 sidecar=lambda name:name.startswith('._')
 reports=[]
 found,complete=I.count_music(str(music),extensions,sidecar,excluded=[str(music/'Skip')],report=reports.append,every=2)
 assert (found,complete)==(4,True) and reports==[2,4],(found,reports)
 assert I.count_music(str(music),extensions,stop=lambda:True)==(0,False)
 assert I.count_music(str(base/'missing'),extensions)==(0,True)
 # Progress maths: step 1 from the job start, step 2 from when the library became ready
 now=1000.0
 p=I.progress({'status':'running','processed':300,'total':1200,'started_at':now-10,'folder_path':'D:\\Videos\\MP4\\'},now)
 assert p['step']==1 and p['percent']==25 and p['files_per_second']==30.0 and p['seconds_left']==30 and p['folder']=='MP4' and p['active']
 p=I.progress({'status':'running','processed':50,'total':1200,'started_at':now-100,'step_started_at':now-5,'library_ready':True},now)
 assert p['step']==2 and p['percent']==4 and p['files_per_second']==10.0 and p['seconds_left']==115
 p=I.progress({'status':'running','processed':20,'counting':True,'files_found':900,'started_at':now-1},now)
 assert p['percent'] is None and p['seconds_left'] is None and p['files_per_second']==0.0 and p['counting'] and p['files_found']==900
 p=I.progress({'status':'running','processed':1300,'total':1200,'started_at':now-10},now)
 assert p['percent']==100 and p['processed']==1200 and p['seconds_left'] is None
 assert I.progress({'status':'complete','processed':5,'total':5},now)['active'] is False
 assert I.progress({'status':'failed','error':'Drive gone'},now)['error']=='Drive gone'
 # Quick realpath during an import: same answers as Windows' realpath without opening each file
 import ntpath
 opened=[];orig=ntpath.realpath
 def counting(path,*a,**k):opened.append(path);return orig(path,*a,**k)
 fast=I.FastRealpath(counting)
 (music/'Real Name.MP3').write_bytes(bytes(1));(music/'Linked').mkdir()
 subprocess.run(['cmd','/c','mklink','/J',str(music/'Junction'),str(music/'Linked')],capture_output=True,check=True)
 (music/'Linked'/'inside.mp3').write_bytes(bytes(1))
 inputs=[str(music/'one.mp3'),str(music/'real name.mp3'),str(music/'A'/'three.wav'),str(music/'A'/'..'/'two.FLAC'),
         str(music/'missing.mp3'),str(music),str(music/'Junction'),str(music/'Junction'/'inside.mp3'),str(music/'A')+'/B/four.mp4']
 expect=[orig(x) for x in inputs]
 assert expect[1].endswith('Real Name.MP3') and expect[7].endswith(os.path.join('Linked','inside.mp3')),expect
 with fast.active():
  got=[fast(x) for x in inputs]
  assert got==expect,list(zip(got,expect))
  opened.clear();[fast(str(music/n)) for n in ('one.mp3','two.FLAC','notes.txt')]
  assert opened==[]  # folders already resolved, files answered from the listing
  other=[];t=threading.Thread(target=lambda:other.append(fast(str(music/'one.mp3'))));t.start();t.join()
  assert opened==[str(music/'one.mp3')] and other==[expect[0]]  # other threads use Windows' realpath
 opened.clear();assert fast(str(music/'one.mp3'))==expect[0] and opened  # outside an import: Windows' realpath
 with fast.active():assert fast(bytes(str(music/'one.mp3'),'utf-8'))==orig(bytes(str(music/'one.mp3'),'utf-8'))  # bytes: Windows' realpath
 # Real import through AXIOM's own add-folder job, in a fixture data folder
 data=base/'data';data.mkdir()
 script=f'''
import os,sys,json,time,pathlib
os.environ['AXIOM_RUNTIME_DIR']={str(data)!r}
sys.path.insert(0,{str(workspace/'axiom-win-probe')!r})
import axiom_windows_launcher as L
L.data_root=lambda:pathlib.Path({str(data)!r})
axiom=L.build_app(8097)
c=axiom.app.test_client();base='http://127.0.0.1:8097'
r=c.post('/api/library/add_folder',base_url=base,json={{'folder_path':{str(workspace/'fixtures'/'stress'/'mp3-5000')!r},'async':True,'confirmed_music_preflight':True}}).get_json()
seen=[]
for _ in range(600):
 p=c.get('/api/windows/import-progress',base_url=base).get_json();seen.append(p)
 if not p.get('active'):break
 time.sleep(0.1)
print(json.dumps({{'start':r,'last':seen[-1],'steps':sorted({{s.get('step') for s in seen if s.get('active')}}),'totals':sorted({{s.get('total') for s in seen if s.get('total')}})}}))
'''
 out=subprocess.run([sys.executable,'-c',script],capture_output=True,text=True,timeout=300,cwd=str(workspace))
 assert out.returncode==0,out.stderr[-3000:]
 result=json.loads(out.stdout.strip().splitlines()[-1])
 last=result['last']
 assert result['start']['success'] and last['status']=='complete' and last['total']==5000 and last['processed']==5000 and last['percent']==100,last
 assert result['totals']==[5000] and set(result['steps'])<={1,2},result
 shutil.rmtree(base,ignore_errors=True)
 print('PASS: import progress counts music files from the listing, gives the job a total, percentage and time left for both steps')
except BaseException:
 traceback.print_exc();sys.exit(1)
