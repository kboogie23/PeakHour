"""Studio DAW pitch-preserving preparation on Windows: AXIOM's stretch job runs its Rubber Band
command through windows_rubberband (R3 WebAssembly under Node, FFmpeg filter fallback), on a
generated click track (no user music)."""
import os,sys,pathlib,uuid,time,traceback,wave
import numpy as np,soundfile as sf
workspace=pathlib.Path(__file__).resolve().parent
probe=workspace/'axiom-win-probe';home=workspace/'probe-home'
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(home/'AppData/Local'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime')})
sys.path.insert(0,str(probe));os.chdir(probe)
try:
 import imageio_ffmpeg;ff=imageio_ffmpeg.get_ffmpeg_exe()
 folder=workspace/'fixtures'/'stretch'/uuid.uuid4().hex;folder.mkdir(parents=True)
 R=48000;x=np.zeros((R*6,2),np.float32)
 for c in range(R//4,R*6-R//4,R//2): x[c:c+48]=np.hanning(48)[:,None]*0.9
 src=folder/'clicks.wav';sf.write(src,x,R,subtype='PCM_16')
 from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder,video_cache_root=folder,video_allowed_path=lambda p:True,video_ffmpeg=ff)
 import windows_studio
 from studio_daw import stretch
 assert windows_studio.node_executable(),'Node is required for the R3 path'
 client=app.app.test_client();h={'Host':'127.0.0.1','Origin':'http://127.0.0.1'}
 def prepare(pitch,anchors):
  body={'path':str(src),'start':0.0,'duration':6.0,'pitch':pitch,'mode':'preserve-pitch','anchors':anchors}
  r=client.post('/api/studio-daw/stretch',json=body,headers=h);job=r.get_json()
  assert r.status_code in (200,202),(r.status_code,job)
  deadline=time.time()+120
  while job.get('state') not in ('ready','failed','cancelled'):
   assert time.time()<deadline,job;time.sleep(0.2)
   job=client.get('/api/studio-daw/stretch/'+job['id'],headers=h).get_json()
  assert job['state']=='ready',job
  a=client.get('/api/studio-daw/stretch/'+job['id']+'/audio',headers=h)
  assert a.status_code==200,a.status_code
  out=folder/(job['id']+'.wav');out.write_bytes(a.data);a.close()
  return sf.read(out)
 y,sr=prepare(-3.0,[{'source':0,'target':0},{'source':6.0,'target':7.5}])  # negative pitch, 1.25x longer
 assert sr==R and abs(len(y)-R*7.5)<=2,(sr,len(y))
 errs=[]
 for c in range(R//4+R//2,R*6-R,R//2):
  e=int(c*1.25);w=np.abs(y[e-3000:e+3000,0]);errs.append((np.argmax(w>0.25*w.max())-3000)/48)
 assert max(map(abs,errs))<5,errs  # R3: clicks within 5 ms of their mapped time
 y2,_=prepare(2.0,[{'source':0,'target':0},{'source':3.0,'target':3.0},{'source':6.0,'target':9.0}])  # time map (-M)
 assert abs(len(y2)-R*9)<=2,len(y2)
 print('PASS: Studio pitch-preserving preparation runs Rubber Band R3 on Windows (exact length, clicks within %.1f ms, negative pitch, time map)'%max(map(abs,errs)))
except BaseException:
 traceback.print_exc();sys.exit(1)
