import os,pathlib,shutil,subprocess,sys,tempfile,time
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_serato_processes import running_serato,require_serato_closed,ProcessInspectionError
python=root/'python'/'cpython-3.12.15-windows-x86_64-none'/'python.exe'
with tempfile.TemporaryDirectory(dir=root) as d:
 clone=pathlib.Path(d)/'Serato DJ Pro.exe';shutil.copy2(python,clone)
 env=os.environ.copy();env['PYTHONHOME']=str(python.parent);env['PATH']=str(python.parent)+os.pathsep+env.get('PATH','')
 p=subprocess.Popen([str(clone),'-c','import time; time.sleep(30)'],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
 try:
  deadline=time.monotonic()+5
  while 'Serato DJ Pro' not in running_serato() and time.monotonic()<deadline:
   if p.poll() is not None:raise RuntimeError('fixture exited: '+p.stderr.read().decode(errors='replace'))
   time.sleep(.05)
  assert 'Serato DJ Pro' in running_serato()
  try:require_serato_closed()
  except ProcessInspectionError:pass
  else:raise AssertionError('live fixture not detected')
 finally:
  if p.poll() is None:p.terminate()
  p.wait(timeout=10)
print('PASS: live disposable process with documented Serato executable name detected and blocked')
