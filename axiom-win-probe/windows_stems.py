"""Studio DAW stem separation on Windows.

The Mac app bundles a Python stem runtime (PyTorch, Demucs) and the pinned
htdemucs checkpoint inside AXIOM PRO.app and starts AXIOM's stem worker with
it. On Windows those live in PEAK HOUR's data folder (AXIOM_RUNTIME_DIR, else
%LOCALAPPDATA%\\AXIOM DJ; a runtime that already exists in the older
%LOCALAPPDATA%\\AXIOM folder is still used):

    <data>\\stem-runtime   Python 3.12 + PyTorch (CUDA or CPU) + Demucs 4.0.1
    <data>\\stem-models    955717e8-8726e21a.th (checksum-verified by the worker)

They are not part of the installer: windows_stem_installer.py downloads them
on first use (Studio shows "Install stem engine"). studio_daw.stems is pointed
at them and at windows_stem_worker.py (AXIOM's worker with CUDA in place of
MPS). The worker environment keeps AXIOM's rules (no inherited PYTHON*
variables, explicit FFmpeg and model paths) with a Windows system PATH instead
of /usr/bin. The progress reader also names CUDA when the worker separates on
the GPU.
"""
import os
import re
import threading
from pathlib import Path

import windows_keep_awake as keep_awake
import windows_stem_installer as installer

MODEL_FILE = installer.MODEL_FILE
WORKER = Path(__file__).with_name('windows_stem_worker.py')


def runtime_root():
    return installer.active_runtime()


def stem_python():
    return installer.python_in(runtime_root())


def resolve_stem_models(*args, **kwargs):
    folder = installer.active_models()
    return str(folder) if installer.model_ok(folder) else None


def make_worker_environment(original):
    def stem_worker_environment(*args, **kwargs):
        env = original(*args, **kwargs)
        root = os.environ.get('SystemRoot', r'C:\Windows')
        env['PATH'] = os.pathsep.join([str(runtime_root() / 'Scripts'), os.path.join(root, 'System32'), root])
        for name in ('SystemRoot', 'SystemDrive', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE',
                     'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'):
            if name in os.environ:
                env.setdefault(name, os.environ[name])
        return env
    return stem_worker_environment


def make_worker_status(original):
    def worker_status(log_path, *args, **kwargs):
        status = original(log_path, *args, **kwargs)
        try:
            with open(log_path, 'rb') as stream:
                stream.seek(max(0, os.path.getsize(log_path) - 16384))
                text = stream.read().decode('utf-8', 'replace')
        except OSError:
            return status
        modes = re.findall(r'^Separation device:\s*(\w+)\s*$', text, re.M | re.I)
        if modes and modes[-1].lower() == 'cuda' and isinstance(status, dict) and status.get('phase') == 'separating':
            status['processing_mode'] = 'GPU/CUDA'
            status['status_detail'] = 'Separating vocals, melody, bass and drums with GPU/CUDA mode.'
        return status
    return worker_status


def make_awake_popen(base):
    """base (studio_daw's own Popen, already Windows-ready) as a class that keeps the PC awake while the child lives."""
    class AwakePopen(base):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            token = keep_awake.hold('Splitting stems')
            threading.Thread(target=self._release_when_done, args=(token,), name='peak-hour-stems-awake', daemon=True).start()

        def _release_when_done(self, token):
            try:
                self.wait()
            except Exception:
                pass
            finally:
                keep_awake.release(token)
    return AwakePopen


class AwakeSubprocess:
    """What studio_daw.stems calls subprocess (its audio_process): the same module, with Popen keeping the PC awake."""

    def __init__(self, original):
        self._original = original
        self.Popen = make_awake_popen(original.Popen)

    def __getattr__(self, name):
        return getattr(self._original, name)


def install():
    import importlib
    stems = importlib.import_module('studio_daw.stems')
    if getattr(stems, '_windows_stems_installed', False):
        return
    stems.subprocess = AwakeSubprocess(stems.subprocess)  # wraps audio_process, so windows_studio.install() must run first
    stems.PYTHON = stem_python()
    stems.WORKER = WORKER
    stems.resolve_stem_models = resolve_stem_models
    stems.stem_worker_environment = make_worker_environment(stems.stem_worker_environment)
    stems.worker_status = make_worker_status(stems.worker_status)
    stems._windows_stems_installed = True
