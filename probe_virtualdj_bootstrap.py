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
 import uuid
 from windows_bootstrap import build_backend
 folder=workspace/'fixtures'/'virtualdj_bootstrap'/uuid.uuid4().hex;folder.mkdir(parents=True)
 db=folder/'database.xml';db.write_text('<VirtualDJ_Database Version="8.1"/>',encoding='utf8')
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder,virtualdj_allowed_path=lambda p:p==db)
 client=app.app.test_client();r=client.post('/api/windows/virtualdj/inspect',json={'database_path':str(db)},headers={'Origin':'http://localhost'})
 assert r.status_code==403 and r.json.get('license_required'),(r.status_code,r.json)
 print('PASS: VirtualDJ endpoint honors AXIOM original license gate')
except BaseException:
 traceback.print_exc();sys.exit(1)
