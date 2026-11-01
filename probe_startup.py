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
 import app
 rules=sorted((str(r),','.join(sorted(r.methods-{'HEAD','OPTIONS'}))) for r in app.app.url_map.iter_rules())
 (workspace/'bytecode_inventory'/'registered_routes.json').write_text(__import__('json').dumps(rules,indent=2),encoding='utf8')
 print('IMPORT_OK routes',len(rules))
 client=app.app.test_client()
 for path in ['/','/api/app/version','/api/license/status','/api/account/status','/api/library/folders','/api/library/stats']:
  try:
   response=client.get(path); print('GET',path,response.status_code,response.content_type,'bytes',len(response.data)); print(response.get_data(as_text=True)[:300] if response.is_json else '')
  except Exception as exc: print('GET_ERROR',path,type(exc).__name__,str(exc))

except BaseException:
 traceback.print_exc(); sys.exit(1)
