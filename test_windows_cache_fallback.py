"""Studio DAW cache folders this PC cannot use are replaced by PEAK HOUR's own (windows_cache_fallback).

Case A: the stretch cache path is a FILE (so mkdir fails), the audio-unit cache raises PermissionError on open (what
the owner's folder did), the stems cache is fine. The stretch job still prepares a clip, from the fallback folder;
the unusable path is left exactly as it was. Case B (subprocess): usable folders -> nothing is redirected."""
import os,sys,pathlib,uuid,time,traceback,subprocess,json
workspace=pathlib.Path(__file__).resolve().parent
probe=workspace/'axiom-win-probe'
def sandbox(name):
 root=workspace/'fixtures'/'cache_fallback'/(name+uuid.uuid4().hex[:8]);home=root/'home';(home/'.cache').mkdir(parents=True)
 os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(home/'AppData/Local'),'AXIOM_RUNTIME_DIR':str(root/'runtime')})
 sys.path.insert(0,str(probe));os.chdir(probe);return root,home
if len(sys.argv)>1 and sys.argv[1]=='usable':
 try:
  root,home=sandbox('ok')
  import windows_cache_fallback as wcf
  lines=[];moved=wcf.install(log=lines.append)
  assert moved=={} and lines==[],(moved,lines)
  from studio_daw import stretch,prepared_cache,stems,audio_units
  assert prepared_cache.STRETCH_ROOT==home/'.cache'/'axiom-stretch-managed-v1' and stems.ROOT==home/'.cache'/'axiom-stems'
  assert not (root/'runtime').exists()
  print('usable-ok');sys.stdout.flush();os._exit(0)
 except BaseException:
  traceback.print_exc();sys.exit(1)
try:
 import numpy as np,soundfile as sf,imageio_ffmpeg;ff=imageio_ffmpeg.get_ffmpeg_exe()
 r=subprocess.run([sys.executable,__file__,'usable'],capture_output=True,text=True,timeout=300)
 assert r.returncode==0 and 'usable-ok' in r.stdout,(r.stdout,r.stderr)
 root,home=sandbox('bad')
 blocked=home/'.cache'/'axiom-stretch-managed-v1';blocked.write_bytes(b'not a folder')  # unusable: a file, not a folder
 units=home/'.cache'/'axiom-audio-units'
 import windows_cache_fallback as wcf
 real_open=os.open
 def deny(path,*a,**k):
  if str(path).startswith(str(units)):raise PermissionError(13,'Permission denied',str(path))
  return real_open(path,*a,**k)
 lines=[];os.open=deny
 try:moved=wcf.install(log=lines.append)
 finally:os.open=real_open
 base=root/'runtime'/'cache'
 assert set(moved)=={'axiom-stretch-managed-v1','axiom-audio-units'},moved
 assert moved['axiom-stretch-managed-v1']==base/'axiom-stretch-managed-v1',moved
 assert len(lines)==2 and all(l.startswith('PEAK HOUR: audio cache') and 'AXIOM' not in l.replace('axiom-','') for l in lines),lines
 from studio_daw import stretch,prepared_cache,stems,audio_units
 assert prepared_cache.STRETCH_ROOT==stretch.STRETCH_ROOT==audio_units.STRETCH_ROOT==base/'axiom-stretch-managed-v1'
 assert audio_units.ROOT==base/'axiom-audio-units' and stems.ROOT==home/'.cache'/'axiom-stems'
 real_probe=wcf.probe;seen=[]  # one stray failure on the stems folder (antivirus) is retried, not acted on
 def flaky(folder,locks=()):
  if str(folder)==str(stems.ROOT) and not seen:seen.append(1);return PermissionError(13,'Permission denied',str(folder))
  return real_probe(folder,locks)
 wcf.probe=flaky;n=len(lines)
 try:assert wcf.install(log=lines.append)=={} and seen and len(lines)==n and stems.ROOT==home/'.cache'/'axiom-stems'
 finally:wcf.probe=real_probe
 assert wcf.install(log=lines.append)=={}  # second call: nothing more to do
 assert blocked.read_bytes()==b'not a folder' and blocked.is_file() and not [p for p in units.rglob('*') if p.is_file()]  # old paths untouched
 folder=root/'work';folder.mkdir()
 R=48000;x=np.zeros((R*3,2),np.float32)
 for c in range(R//4,R*3-R//4,R//2):x[c:c+48]=np.hanning(48)[:,None]*0.9
 src=folder/'clicks.wav';sf.write(src,x,R,subtype='PCM_16')
 from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder,video_cache_root=folder,video_allowed_path=lambda p:True,video_ffmpeg=ff)
 client=app.app.test_client();h={'Host':'127.0.0.1','Origin':'http://127.0.0.1'}
 body={'path':str(src),'start':0.0,'duration':3.0,'pitch':-2.0,'mode':'preserve-pitch','anchors':[{'source':0,'target':0},{'source':3.0,'target':3.75}]}
 res=client.post('/api/studio-daw/stretch',json=body,headers=h);job=res.get_json()
 assert res.status_code in (200,202),(res.status_code,job)
 end=time.time()+120
 while job.get('state') not in ('ready','failed','cancelled'):
  assert time.time()<end,job;time.sleep(0.2);job=client.get('/api/studio-daw/stretch/'+job['id'],headers=h).get_json()
 assert job['state']=='ready',job
 a=client.get('/api/studio-daw/stretch/'+job['id']+'/audio',headers=h);assert a.status_code==200;out=folder/'out.wav';out.write_bytes(a.data);a.close()
 y,sr=sf.read(out);assert sr==R and abs(len(y)-R*3.75)<=2,(sr,len(y))
 assert (base/'axiom-stretch-managed-v1'/'.lock').exists(),'the lock was taken in the fallback folder'
 assert blocked.read_bytes()==b'not a folder'
 print('PASS: unusable Studio cache folders move to PEAK HOUR\'s cache (stretch prepared %.2f s from the fallback), usable ones stay'%(len(y)/sr))
except BaseException:
 traceback.print_exc();sys.exit(1)
