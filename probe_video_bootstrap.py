import os,sys,pathlib,traceback,json
root=pathlib.Path(__file__).resolve().parent;probe=root/'axiom-win-probe';home=root/'probe-home';home.mkdir(exist_ok=True)
fixture=(root/'fixtures/video-preview-test.avi').resolve(strict=True);cache=root/'fixtures/axiom-video-ui-cache';cache.mkdir(exist_ok=True)
recording=home/'recordings';recording.mkdir(exist_ok=True)
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(home/'AppData/Local'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime'),'NO_PROXY':'*'})
sys.path.insert(0,str(probe));os.chdir(probe)
import imageio_ffmpeg
ffmpeg=str(pathlib.Path(imageio_ffmpeg.get_ffmpeg_exe()).resolve());python=str(pathlib.Path(sys.executable).resolve())
def audit(event,args):
 if event in ('socket.connect','socket.connect_ex','os.system','os.startfile'):raise PermissionError('Test blocks '+event)
 if event=='subprocess.Popen' and str(pathlib.Path(args[0]).resolve()) not in (ffmpeg,python):raise PermissionError('Test blocks subprocess')
 if event=='open' and len(args)>1:
  path,mode=args[:2]
  if isinstance(path,(str,bytes,os.PathLike)) and isinstance(mode,str) and any(x in mode for x in 'wax+'):
   if not pathlib.Path(path).resolve().is_relative_to(root):raise PermissionError('Test blocks file write outside workspace')
sys.addaudithook(audit)
from windows_bootstrap import build_backend
import tempfile,hashlib,shutil
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);music=d/'music';music.mkdir();sample=music/'sample.avi';shutil.copy2(fixture,sample);digest=hashlib.sha256(sample.read_bytes()).hexdigest()
 video_cache=d/'cache';video_cache.mkdir();saved=d/'recordings';saved.mkdir()
 app=build_backend(recording_settings=d/'settings.json',recording_directory=saved,video_cache_root=video_cache,video_allowed_path=lambda p:p==sample,video_ffmpeg=ffmpeg)
 try:
  result=app.scan_library(str(music),str(d/'library.json'));assert len(result['tracks'])==1 and result['tracks'][0]['duration_sec']>0
  c=app.app.test_client();assert c.get('/api/windows/video/capabilities').json['video_preview']
  r=c.post('/api/windows/video/prepare',json={'path':str(sample)},headers={'Origin':'http://localhost'});assert r.status_code==200,r.get_data(as_text=True)
  key=r.json['id'];r=c.get('/api/windows/video/'+key,headers={'Range':'bytes=0-31'});assert r.status_code==206;r.close()
  assert c.delete('/api/windows/video/'+key,headers={'Origin':'http://localhost'}).status_code==200
  assert hashlib.sha256(sample.read_bytes()).hexdigest()==digest
 finally:app.WINDOWS_VIDEO_STORE.close();app.NATIVE_AUDIO_DECK.stop()
 print('PASS: opt-in AXIOM bootstrap indexes and prepares generated AVI with source unchanged')
