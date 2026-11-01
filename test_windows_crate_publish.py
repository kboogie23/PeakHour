import hashlib,pathlib,sys,tempfile,wave
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_crate_publish import publish_new_crate,CratePublicationError
from windows_serato_processes import ProcessInspectionError
from windows_serato_paths import crate_relative_path
from serato_tools.crate import Crate
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);lib=d/'_Serato_';crates=lib/'Subcrates';crates.mkdir(parents=True);music=d/'Music';music.mkdir();tracks=[]
 for name in ['A.wav','B.wav']:
  p=music/name
  with wave.open(str(p),'wb') as w:w.setparams((1,2,8000,0,'NONE','not compressed'));w.writeframes(bytes(1600))
  tracks.append(str(p))
 before=[hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for p in tracks]
 r=publish_new_crate(lib,'Test',tracks,snapshot=lambda:[]);target=pathlib.Path(r['path'])
 assert Crate(str(target)).get_track_paths()==[crate_relative_path(p,str(lib)) for p in tracks]
 assert r['sha256']==hashlib.sha256(target.read_bytes()).hexdigest()
 old=target.read_bytes()
 try:publish_new_crate(lib,'Test',tracks,snapshot=lambda:[])
 except FileExistsError:pass
 else:raise AssertionError('existing crate overwritten')
 assert target.read_bytes()==old
 try:publish_new_crate(lib,'Blocked',tracks,snapshot=lambda:[(1,'Serato DJ Pro.exe')])
 except ProcessInspectionError:pass
 else:raise AssertionError('running Serato not rejected')
 assert not (crates/'Blocked.crate').exists()
 try:publish_new_crate(lib,'Duplicate',[tracks[0],tracks[0]],snapshot=lambda:[])
 except CratePublicationError:pass
 else:raise AssertionError('duplicate accepted')
 calls=0;race=crates/'Race.crate'
 def raced_snapshot():
  global calls
  calls+=1
  if calls==2:race.write_bytes(b'concurrent existing crate')
  return []
 try:publish_new_crate(lib,'Race',tracks,snapshot=raced_snapshot)
 except FileExistsError:pass
 else:raise AssertionError('concurrent destination overwritten')
 assert race.read_bytes()==b'concurrent existing crate'
 assert [hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for p in tracks]==before
 changing=music/'changing.wav';changing.write_bytes(b'initial');change_calls=0
 def changed_snapshot():
  global change_calls
  change_calls+=1
  if change_calls==2:changing.write_bytes(b'changed longer')
  return []
 try:publish_new_crate(lib,'Changed',[str(changing)],snapshot=changed_snapshot)
 except CratePublicationError:pass
 else:raise AssertionError('source change accepted')
 assert not (crates/'Changed.crate').exists()

 print('PASS: verified new crate, source hashes, existing/racing destination protection and Serato preflight')
