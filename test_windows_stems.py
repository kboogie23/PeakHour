"""Studio DAW stem separation on Windows: AXIOM's stems endpoint runs its own worker (Demucs htdemucs,
pinned checkpoint) in the dedicated stem runtime on the NVIDIA GPU, on a generated clip (no user music)."""
import os,sys,pathlib,uuid,time,traceback
import numpy as np,soundfile as sf
workspace=pathlib.Path(__file__).resolve().parent
probe=workspace/'axiom-win-probe';home=workspace/'probe-home'
real_local=os.environ['LOCALAPPDATA']  # the stem runtime and model live in AXIOM's real data folder
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime')})
sys.path.insert(0,str(probe));os.chdir(probe)
try:
 import imageio_ffmpeg;ff=imageio_ffmpeg.get_ffmpeg_exe()
 folder=workspace/'fixtures'/'stems'/uuid.uuid4().hex;folder.mkdir(parents=True)
 R=44100;t=np.arange(R*20)/R;x=np.zeros((len(t),2),np.float32)
 for b in np.arange(0,20,0.5):i=int(b*R);x[i:i+2000]+=(np.exp(-np.arange(2000)/300)*np.sin(2*np.pi*60*np.arange(2000)/R))[:,None]*0.6  # kick
 x+=(0.15*np.sin(2*np.pi*55*t)*(np.sin(2*np.pi*0.5*t)>0))[:,None]  # bass
 x+=(0.1*np.sin(2*np.pi*660*t)*np.sin(2*np.pi*2*t)**2)[:,None]  # melody
 src=folder/'clip.wav';sf.write(src,x,R,subtype='PCM_16')
 from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder,video_cache_root=folder,video_allowed_path=lambda p:True,video_ffmpeg=ff)
 from studio_daw import stems;import windows_stems
 assert str(stems.PYTHON).startswith(real_local) and stems.PYTHON.is_file() and stems.resolve_stem_models(),stems.PYTHON
 client=app.app.test_client();h={'Host':'127.0.0.1','Origin':'http://127.0.0.1'}
 d=client.get('/api/studio-daw/stems/diagnostics',headers=h).get_json();print('diagnostics',{k:v for k,v in d.items() if k!='identity'} if isinstance(d,dict) else d)
 r=client.post('/api/studio-daw/stems',json={'path':str(src),'start':0.0,'duration':20.0},headers=h);job=r.get_json()
 assert r.status_code in (200,202),(r.status_code,job)
 t0=time.time();seen=set()
 while job.get('state') not in ('ready','failed','cancelled'):
  assert time.time()-t0<600,job;time.sleep(1)
  job=client.get('/api/studio-daw/stems/'+job['id'],headers=h).get_json();seen.add((job.get('state'),job.get('processing_mode'),job.get('status_detail')))
 assert job['state']=='ready',(job,sorted(map(str,seen)))
 out={}
 for name in ('vocals','other','bass','drums'):
  a=client.get(f'/api/studio-daw/stems/{job["id"]}/{name}',headers=h);assert a.status_code==200,(name,a.status_code)
  p=folder/f'{name}.wav';p.write_bytes(a.data);a.close();y,sr=sf.read(p);out[name]=y;assert sr==R and abs(len(y)-len(x))<=2,(name,sr,len(y))
 rms={k:float(np.sqrt(np.mean(v**2))) for k,v in out.items()}
 assert rms['drums']>0.02 and rms['bass']>0.02,rms
 log=next((stems.ROOT).rglob('worker.log'),None)
 print('modes seen',sorted({m for _,m,_ in seen if m}),'rms',{k:round(v,4) for k,v in rms.items()},'%.1fs'%(time.time()-t0))
 print('PASS: Studio stems separate on Windows (htdemucs, 4 stems at 44.1 kHz, drums and bass recovered)')
except BaseException:
 traceback.print_exc();sys.exit(1)
