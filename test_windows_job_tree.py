import ctypes,pathlib,sys,tempfile,time,subprocess
from ctypes import wintypes
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_audio_process import ffmpeg_popen_factory
kernel=ctypes.WinDLL('kernel32',use_last_error=True)
kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD];kernel.WaitForSingleObject.restype=wintypes.DWORD
kernel.CloseHandle.argtypes=[wintypes.HANDLE];kernel.CloseHandle.restype=wintypes.BOOL
runner=ffmpeg_popen_factory(sys.executable)
with tempfile.TemporaryDirectory(dir=root) as d:
 marker=pathlib.Path(d)/'child.pid';p=runner([sys.executable,str(root/'job_tree_fixture.py'),str(marker)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 child=None
 try:
  deadline=time.monotonic()+10
  while not (marker.exists() and marker.read_text().strip()) and time.monotonic()<deadline:  # file appears before its PID is written
   assert p.poll() is None;time.sleep(.02)
  assert marker.exists();pid=int(marker.read_text());child=kernel.OpenProcess(0x100000,False,pid);assert child
  assert kernel.WaitForSingleObject(child,0)==258
  p.kill();p.wait(timeout=10)
  assert kernel.WaitForSingleObject(child,10000)==0,'child process survived job termination'
 finally:
  if p.poll() is None:p.kill();p.wait(timeout=10)
  if child:kernel.CloseHandle(child)
print('PASS: job termination stops both owned parent and child process')
