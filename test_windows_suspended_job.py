import pathlib,sys,tempfile,time
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
import windows_audio_process as wap
with tempfile.TemporaryDirectory(dir=root) as d:
 marker=pathlib.Path(d)/'marker'; script='import pathlib,sys;pathlib.Path(sys.argv[1]).write_text("ran")'
 real_job=wap.Job;real_resume=wap.resume_primary_thread
 class CheckedJob(real_job):
  def assign(self,handle):
   assert not marker.exists(),'helper ran before job assignment'
   super().assign(handle)
 wap.Job=CheckedJob
 try:
  p=wap.ffmpeg_popen_factory(sys.executable)([sys.executable,'-c',script,str(marker)])
  assert p.wait(timeout=10)==0 and marker.read_text()=='ran'
  marker.unlink()
  class FailedJob(real_job):
   def assign(self,handle):raise RuntimeError('simulated assignment failure')
  wap.Job=FailedJob
  try:wap.ffmpeg_popen_factory(sys.executable)([sys.executable,'-c',script,str(marker)])
  except RuntimeError:pass
  else:raise AssertionError('assignment failure accepted')
  assert not marker.exists()
  wap.Job=real_job
  def fail_resume(pid):raise RuntimeError('simulated resume failure')
  wap.resume_primary_thread=fail_resume
  try:wap.ffmpeg_popen_factory(sys.executable)([sys.executable,'-c',script,str(marker)])
  except RuntimeError:pass
  else:raise AssertionError('resume failure accepted')
  assert not marker.exists()
 finally:wap.Job=real_job;wap.resume_primary_thread=real_resume
print('PASS: helper remains suspended until assignment; assignment and resume failures prevent execution')
