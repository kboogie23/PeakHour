"""Experimental FFmpeg-only process adapter for Windows DAW tests.

The helper starts suspended and joins its job before resuming. This is not a
sandbox or production-ready replacement.
"""
import os
import subprocess
from pathlib import Path
from windows_job import Job, resume_primary_thread

DEVNULL = subprocess.DEVNULL
STDOUT = subprocess.STDOUT
PIPE = subprocess.PIPE
TimeoutExpired = subprocess.TimeoutExpired

def ffmpeg_popen_factory(executable):
    executable = Path(executable).resolve(strict=True)
    if not executable.is_file():
        raise ValueError('FFmpeg executable is unavailable')
    class WindowsFFmpegProcess:
        def __init__(self, args, *, stdin=None, stdout=None, stderr=None, env=None,
                     cwd=None, start_new_session=False, read_files=None):
            if not isinstance(args, (list, tuple)) or not args:
                raise ValueError('An argument list is required')
            argv = [os.fspath(a) for a in args]
            if Path(argv[0]).resolve(strict=True) != executable:
                raise ValueError('Only the configured FFmpeg executable is allowed')
            if read_files:
                raise NotImplementedError('Descriptor-based sandbox access is not implemented on Windows')
            flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0) | 0x00000004 # CREATE_SUSPENDED
            if start_new_session: flags |= getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)
            self._job = Job()
            try:
                self._proc = subprocess.Popen(argv, stdin=stdin, stdout=stdout, stderr=stderr,
                                              env=env, cwd=cwd, shell=False, close_fds=True,
                                              executable=str(executable), creationflags=flags)
                try:
                    self._job.assign(self._proc._handle)
                    resume_primary_thread(self._proc.pid)
                except BaseException:
                    if self._proc.poll() is None:
                        self._proc.kill()
                    self._proc.wait()
                    raise
            except BaseException:
                self._job.close()
                raise
            self.args = self._proc.args
            self.pid = self._proc.pid
            self.stdin, self.stdout, self.stderr = self._proc.stdin, self._proc.stdout, self._proc.stderr
        @property
        def returncode(self): return self._proc.returncode
        def poll(self):
            result = self._proc.poll()
            if result is not None: self._job.close()
            return result
        def wait(self, timeout=None):
            result = self._proc.wait(timeout=timeout)
            self._job.close()
            return result
        def kill(self):
            if self._proc.poll() is None: self._job.terminate()
        def terminate(self): self.kill()
        def __enter__(self): return self
        def __exit__(self, *exc):
            if self.poll() is None: self.kill()
            self.wait()
    return WindowsFFmpegProcess
