import os,sys,pathlib,traceback
workspace=pathlib.Path(__file__).resolve().parent
probe=workspace/'axiom-win-probe'; home=workspace/'probe-home'; home.mkdir(exist_ok=True)
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(home/'AppData/Local'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime'),'NO_PROXY':'*','PIP_DISABLE_PIP_VERSION_CHECK':'1'})
sys.path.insert(0,str(probe)); os.chdir(probe)
def audit(event,args):
 if event in ('socket.connect','socket.connect_ex','subprocess.Popen','os.system','os.startfile'):
  raise PermissionError('Probe blocks '+event)
 if event=='open' and len(args)>1:
  path,mode=args[:2]
  if isinstance(path,(str,bytes,os.PathLike)) and isinstance(mode,str) and any(x in mode for x in 'wax+'):
   resolved=pathlib.Path(path).resolve()
   if not resolved.is_relative_to(workspace): raise PermissionError('Probe blocks file write outside workspace')
sys.addaudithook(audit)
try:
 from windows_bootstrap import build_backend
 from flask import request, abort
 recording_dir=home/'recordings';recording_dir.mkdir(parents=True,exist_ok=True)
 app=build_backend(recording_settings=home/'recording-settings.json',recording_directory=recording_dir)
 @app.app.before_request
 def test_profile_guard():
  if request.remote_addr not in ('127.0.0.1','::1') or request.method not in ('GET','HEAD','OPTIONS'):
   abort(403)
 @app.app.after_request
 def offline_browser(response):
  response.headers['Content-Security-Policy']="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:"
  return response
 app.app.run(host='127.0.0.1',port=48765,debug=False,use_reloader=False,threaded=True)
except BaseException:
 traceback.print_exc(); sys.exit(1)
