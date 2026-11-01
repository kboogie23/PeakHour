import os,pathlib,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
from windows_serato_processes import snapshot_processes,running_serato,require_serato_closed,ProcessInspectionError
assert any(pid==os.getpid() for pid,name in snapshot_processes())
assert running_serato(lambda:[(42,'SERATO DJ PRO.EXE'),(43,'Serato DJ Lite.exe'),(44,'other.exe')])==['Serato DJ Lite','Serato DJ Pro']
try:require_serato_closed(lambda:[(42,'Serato DJ Pro.exe')])
except ProcessInspectionError:pass
else:raise AssertionError('running Serato accepted')
for bad in [lambda:None,lambda:[(1,None)],lambda:(_ for _ in ()).throw(OSError('denied'))]:
 try:require_serato_closed(bad)
 except ProcessInspectionError:pass
 else:raise AssertionError('incomplete snapshot accepted')
require_serato_closed(lambda:[(10,'unrelated.exe')])
print('PASS: real Windows snapshot enumerates current process; known names and snapshot failures handled')
