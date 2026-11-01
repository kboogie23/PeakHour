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
 import scanner, wave, math, struct, hashlib, json
 folder=workspace/'fixtures'/'music'; folder.mkdir(parents=True,exist_ok=True); audio=folder/'Probe Tone.wav'; cache=workspace/'fixtures'/'cache'/'library.json'
 with wave.open(str(audio),'wb') as w:
  w.setparams((1,2,44100,0,'NONE','not compressed'))
  w.writeframes(b''.join(struct.pack('<h',int(10000*math.sin(2*math.pi*440*i/44100))) for i in range(44100)))
 before=hashlib.sha256(audio.read_bytes()).hexdigest()
 result=scanner.scan_library(str(folder),str(cache),metadata_mode='full')
 print('RESULT TYPE',type(result).__name__,'SUMMARY',str(result)[:2500])
 reloaded=scanner.load_cache(str(cache))
 matches=scanner.search_tracks(reloaded,'Probe Tone')
 second=scanner.scan_library(str(folder),str(cache),metadata_mode='full')
 assert len(result['tracks'])==1 and len(matches)==1
 assert result['tracks'][0]['axiom_track_id']==second['tracks'][0]['axiom_track_id']
 assert before==hashlib.sha256(audio.read_bytes()).hexdigest()
 print('PASS: scan, cache reload, search, rescan identity, source unchanged')
except BaseException:
 traceback.print_exc(); sys.exit(1)
