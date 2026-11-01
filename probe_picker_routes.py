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
 from unittest.mock import patch,MagicMock
 import utils.path_ops, windows_paths, windows_dialogs
 utils.path_ops.is_safe_location=windows_paths.is_safe_location
 import app
 app.choose_folder_dialog=windows_dialogs.choose_folder_dialog
 app.choose_serato_database_dialog=windows_dialogs.choose_serato_database_dialog
 fixture=workspace/'fixtures'/'database V2';fixture.write_bytes(b'')
 client=app.app.test_client(); root=MagicMock()
 with patch.object(windows_dialogs.tk,'Tk',return_value=root), patch.object(windows_dialogs.filedialog,'askopenfilename',return_value=str(fixture)):
  r=client.post('/api/library/choose_serato_database',json={})
  print('PICKER',r.status_code,r.json); assert r.status_code==200 and r.json['success'] and r.json['database_path']==str(fixture)
 with patch.object(windows_dialogs.tk,'Tk',return_value=MagicMock()), patch.object(windows_dialogs.filedialog,'askopenfilename',return_value=''):
  r=client.post('/api/library/choose_serato_database',json={}); assert r.status_code==200 and r.json['cancelled']
 print('PASS: original Serato picker route uses Windows picker and path validation')
except BaseException:
 traceback.print_exc(); sys.exit(1)
