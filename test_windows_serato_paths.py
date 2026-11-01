import pathlib,sys,tempfile,ntpath
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
from windows_serato_paths import serato_track_path,crate_relative_path
with tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).resolve().parent) as d:
 root=pathlib.Path(d)/'_Serato_';root.mkdir();music=pathlib.Path(d)/'Music';music.mkdir();track=music/'Café Track.wav';track.write_bytes(b'fixture')
 rel=crate_relative_path(str(track),str(root));assert serato_track_path(rel,str(root))==str(track)
 assert serato_track_path(str(track),str(root))==str(track)
 assert serato_track_path('D:/Music/test.wav',str(root))==r'D:\Music\test.wav'
 for bad in ['../escape.wav',r'C:relative.wav',r'\\server\share\song.wav','folder/file:stream']:
  try:serato_track_path(bad,str(root))
  except ValueError:pass
  else:raise AssertionError('accepted unsafe or ambiguous path '+bad)
 try:crate_relative_path(r'Z:\song.wav',str(root))
 except ValueError:pass
 else:raise AssertionError('cross-volume crate path accepted')
 try:serato_track_path('relative/song.wav')
 except ValueError:pass
 else:raise AssertionError('unbound path accepted')
# Replacement for AXIOM's _serato_relpath_to_absolute_path (macOS "/"+path semantics)
from windows_serato_paths import make_relpath_resolver
calls=[]
def axiom_original(value,serato_root=None):calls.append((value,serato_root));return '\\'+str(value).lstrip('\\/').replace('/','\\')
resolve=make_relpath_resolver(axiom_original)
assert resolve(r'Samples\a.mp3',r'E:\_Serato_')==r'E:\Samples\a.mp3' and resolve('Samples/a.mp3',r'E:\_Serato_')==r'E:\Samples\a.mp3'
assert resolve(r'Users\DJ\Music\a.mp3',r'C:\Users\DJ\Music\_Serato_')==r'C:\Users\DJ\Music\a.mp3'
assert resolve(r'E:\Samples\a.mp3')==r'E:\Samples\a.mp3' and not calls
assert resolve(r'Samples\a.mp3')==r'\Samples\a.mp3' and calls==[(r'Samples\a.mp3',None)]  # no library: AXIOM's own result
assert resolve('../x.mp3',r'E:\_Serato_')==axiom_original('../x.mp3',r'E:\_Serato_')  # unsafe input: AXIOM's own handling
# Drive libraries (<drive>\_Serato_\database V2) replace macOS /Volumes discovery
from windows_serato_paths import make_database_candidates,drive_library_databases,local_drive_roots
assert all(len(r)==3 and r.endswith(':\\') for r in local_drive_roots())
with tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).resolve().parent) as d:
 drive1=pathlib.Path(d)/'one';drive2=pathlib.Path(d)/'two';(drive1/'_Serato_').mkdir(parents=True);drive2.mkdir()
 (drive1/'_Serato_'/'database V2').write_bytes(b'vrsn')
 home=str(pathlib.Path(d)/'home'/'_Serato_'/'database V2')
 assert drive_library_databases([str(drive1),str(drive2)])==[str(drive1/'_Serato_'/'database V2')]
 candidates=make_database_candidates(lambda extra=None:[home]+list(extra or []),roots=[str(drive1),str(drive2)])
 assert candidates()==[home,str(drive1/'_Serato_'/'database V2')]
 assert candidates([str(drive1/'_Serato_'/'database V2')])==[home,str(drive1/'_Serato_'/'database V2')]  # no duplicates
print('PASS: Windows Serato paths preserve volume, Unicode and reject ambiguous/cross-volume paths; AXIOM resolver keeps drives; drive libraries found')
