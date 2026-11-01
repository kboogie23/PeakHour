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

 import app, uuid, wave, hashlib

 from serato_tools.crate import Crate

 from windows_serato_paths import serato_track_path,crate_relative_path
 from windows_serato_processes import guarded_serato_write,ProcessInspectionError

 folder=workspace/'fixtures'/'serato_crate'/uuid.uuid4().hex;root=folder/'_Serato_';crates=root/'Subcrates';crates.mkdir(parents=True)

 music=folder/'Music';music.mkdir();tracks=[];hashes=[]

 for name in ['One.wav','Café Two.wav']:

  path=music/name

  with wave.open(str(path),'wb') as w:w.setparams((1,2,8000,0,'NONE','not compressed'));w.writeframes(bytes(800))

  tracks.append(str(path));hashes.append(hashlib.sha256(path.read_bytes()).hexdigest())

 target=crates/'Test.crate'

 try:guarded_serato_write(app._save_serato_crate_file,Crate,tracks,str(target),snapshot=lambda:[(1,'Serato DJ Pro.exe')])
 except ProcessInspectionError:pass
 else:raise AssertionError('open Serato was not blocked')
 assert not target.exists()
 result=guarded_serato_write(app._save_serato_crate_file,Crate,tracks,str(target),snapshot=lambda:[])

 actual=Crate(str(target)).get_track_paths()

 assert len(actual)==len(tracks) and actual==[crate_relative_path(p,str(root)) for p in tracks]

 assert [serato_track_path(p,str(root)) for p in actual]==tracks

 assert all(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==h for p,h in zip(tracks,hashes))

 print('PASS: original crate writer and parser preserve synthetic track order, paths and source hashes',result)

except BaseException:

 traceback.print_exc();sys.exit(1)


