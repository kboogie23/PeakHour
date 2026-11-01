import ctypes,pathlib,subprocess,sys,tempfile,time
from ctypes import wintypes
root=pathlib.Path(__file__).resolve().parent
kernel=ctypes.WinDLL('kernel32',use_last_error=True)
kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD];kernel.WaitForSingleObject.restype=wintypes.DWORD
kernel.CloseHandle.argtypes=[wintypes.HANDLE];kernel.CloseHandle.restype=wintypes.BOOL
with tempfile.TemporaryDirectory(dir=root) as d:
 marker=pathlib.Path(d)/'pid';go=pathlib.Path(d)/'go'
 owner=subprocess.Popen([sys.executable,str(root/'job_owner_fixture.py'),str(marker),str(go)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 child=None
 try:
  deadline=time.monotonic()+10
  while not (marker.exists() and marker.read_text().strip()) and time.monotonic()<deadline:  # file appears before its PID is written
   assert owner.poll() is None;time.sleep(.02)
  assert marker.exists();child=kernel.OpenProcess(0x100000,False,int(marker.read_text()));assert child
  assert kernel.WaitForSingleObject(child,0)==258
  go.write_text('go');assert owner.wait(timeout=10)==0
  assert kernel.WaitForSingleObject(child,10000)==0,'owned child survived controller exit'
 finally:
  if owner.poll() is None:owner.kill();owner.wait(timeout=10)
  if child:kernel.CloseHandle(child)
print('PASS: owned helper terminates when the controlling process exits abruptly')
