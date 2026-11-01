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
from flask import request,abort,Response
app=build_backend(recording_settings=home/'recording-settings.json',recording_directory=recording,
 video_cache_root=cache,video_allowed_path=lambda p:p==fixture,video_ffmpeg=ffmpeg)
@app.app.before_request
def guard():
 if request.remote_addr not in ('127.0.0.1','::1'):abort(403)
 if request.method not in ('GET','HEAD','OPTIONS') and not (request.path.startswith('/api/windows/video/') or request.path=='/api/audio/stop'):abort(403)
@app.app.get('/test-video-fixture.js')
def fixture_script():
 return Response('''addEventListener('load',()=>{let b=document.createElement('button');b.textContent='Preview test AVI';b.id='test-video-fixture';b.style.cssText='position:fixed;z-index:9999;bottom:12px;left:12px;padding:12px;background:#fff;color:#000';b.onclick=()=>playAudioFile('''+json.dumps(str(fixture))+''','Synthetic AVI','',0,'','',null,'');document.body.append(b)});''',mimetype='application/javascript')
@app.app.after_request
def inject(response):
 if request.path=='/' and response.status_code==200:
  html=response.get_data(as_text=True).replace('</body>','<script src="/test-video-fixture.js"></script></body>')
  response.set_data(html)
 response.headers['Content-Security-Policy']="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:"
 return response
if __name__=='__main__':
 try:app.app.run(host='127.0.0.1',port=48767,debug=False,use_reloader=False,threaded=True)
 finally:app.WINDOWS_VIDEO_STORE.close();app.NATIVE_AUDIO_DECK.stop()
