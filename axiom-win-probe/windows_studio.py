"""Windows audio jobs for AXIOM's Studio DAW and audio tools.

On macOS, studio_daw.audio_process starts every FFmpeg job through AXIOM's
private Rust sidecar (a macOS binary, reached over an AF_UNIX socket with
descriptor passing). None of that exists on Windows, so Studio DAW's audio
check reported every song as "The native full-source decoder is unavailable."
This module supplies:
- resolve_audio_tool: FFmpeg is the copy the launcher already uses for video
  previews; Rubber Band is rubberband.exe when installed, otherwise
  windows_rubberband.py: AXIOM's own R3 WebAssembly engine under Node, or
  FFmpeg's built-in Rubber Band filter when Node is missing or the clip is
  beyond that engine's limits.
- audio_process.Popen: the same call shape (keyword-only stdin/stdout/stderr,
  env, cwd, start_new_session, read_files) on a normal Windows child process,
  started without a console window. read_files only names inputs that are
  already in the argument list, so it needs no descriptor passing here.
- a selector for subprocess pipes (selectors.DefaultSelector on Windows
  accepts only sockets), used by source_probe and drum_analysis_process.
- shutil.rmtree for the prepared-audio cache: AXIOM requires
  rmtree.avoids_symlink_attacks. Python's Windows rmtree does not follow
  directory symlinks or junctions (it removes the link itself) but reports
  False because it is not descriptor-based; the cache lives in this user's
  own AppData folder, and AXIOM checks every entry with is_symlink first.
- signal.SIGKILL for studio_daw.stems, which compares exit codes with it.
- the native effect worker for studio_daw.audio_units: windows_vst3_worker.py
  (VST3 effects through pedalboard) in place of the Swift Audio Unit host.
"""
import ctypes
import msvcrt
import os
import selectors
import shutil
import signal
import subprocess
import sys
import time
import types
from ctypes import wintypes
from pathlib import Path

_kernel = ctypes.WinDLL('kernel32', use_last_error=True)
_kernel.PeekNamedPipe.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD, wintypes.LPDWORD,
                                  wintypes.LPDWORD, wintypes.LPDWORD]
_kernel.PeekNamedPipe.restype = wintypes.BOOL
CREATE_NO_WINDOW = 0x08000000
AUDIO_TOOL_USERS = ('studio_daw.runtime', 'studio_daw.source_probe', 'studio_daw.drum_patterns',
                    'studio_daw.mix_formats', 'studio_daw.steady_timing', 'studio_daw.stems', 'studio_daw.stretch',
                    'studio_daw.waveforms', 'utils.lite_preview', 'health_metadata_publisher')
SELECTOR_USERS = ('studio_daw.source_probe', 'studio_daw.drum_analysis_process')


RUBBERBAND_SHIM = Path(__file__).with_name('windows_rubberband.py')
VST3_WORKER = Path(__file__).with_name('windows_vst3_worker.py')
_SHIM_FFMPEG = None


def resolve_plugin_worker():
    """studio_daw.audio_units' native effect worker: VST3 through pedalboard, when installed."""
    import importlib.util
    return str(VST3_WORKER) if VST3_WORKER.is_file() and importlib.util.find_spec('pedalboard') else None


def installed_rubberband():
    """Breakfast Quay's rubberband.exe: on PATH, or unpacked into AXIOM's tools folder."""
    found = shutil.which('rubberband')
    if found:
        return found
    tools = Path(os.environ.get('LOCALAPPDATA', '')) / 'AXIOM' / 'tools'
    for candidate in sorted(tools.glob('rubberband*/rubberband.exe')) if tools.is_dir() else ():
        if candidate.is_file() and not candidate.is_symlink():
            return str(candidate)
    return None


def node_executable():
    """Node.js runs AXIOM's Rubber Band R3 WebAssembly engine (windows_rubberband.mjs)."""
    found = shutil.which('node')
    if found:
        return found
    default = Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'nodejs' / 'node.exe'
    return str(default) if default.is_file() else None


def make_audio_tool_resolver(ffmpeg):
    global _SHIM_FFMPEG
    _SHIM_FFMPEG = str(ffmpeg) if ffmpeg else None

    def resolve_audio_tool(name):
        if name not in ('ffmpeg', 'rubberband'):
            raise ValueError('Unsupported audio tool.')
        if not ffmpeg or not Path(ffmpeg).is_file():
            return None
        if name == 'ffmpeg':
            return str(ffmpeg)
        return installed_rubberband() or str(RUBBERBAND_SHIM)  # FFmpeg's built-in Rubber Band filter
    return resolve_audio_tool


class Popen(subprocess.Popen):
    """studio_daw.audio_process.Popen as a plain Windows child process."""
    error = None

    def __init__(self, args, *, stdin=None, stdout=None, stderr=None, env=None, cwd=None,
                 start_new_session=False, read_files=None):
        if not isinstance(args, (list, tuple)) or not args:
            raise ValueError('Audio jobs require an explicit argument vector.')
        args = [os.fspath(arg) for arg in args]
        if not Path(args[0]).is_absolute():
            raise ValueError('Audio jobs require an absolute engine path.')
        read_files = {} if read_files is None else read_files
        if not isinstance(read_files, dict) or len(read_files) > 8:
            raise ValueError('Audio jobs accept at most eight explicit read-only inputs.')
        for index, path in read_files.items():
            if type(index) is not int or not 0 < index < len(args) or args[index] != os.fspath(path):
                raise ValueError('Read-only input must identify its exact argument position.')
        if Path(args[0]) == VST3_WORKER:
            args = [sys.executable, '-I', str(VST3_WORKER), *args[1:]]
        elif Path(args[0]) == RUBBERBAND_SHIM:
            if not _SHIM_FFMPEG:
                raise ValueError('Rubber Band on FFmpeg requires the FFmpeg executable.')
            node = node_executable()
            args = [sys.executable, '-I', str(RUBBERBAND_SHIM), '--ffmpeg', _SHIM_FFMPEG,
                    *(['--node', node] if node else []), *args[1:]]
        flags = CREATE_NO_WINDOW | (subprocess.CREATE_NEW_PROCESS_GROUP if start_new_session else 0)
        super().__init__(args, stdin=stdin, stdout=stdout, stderr=stderr, env=env, cwd=cwd, creationflags=flags)


def source_input_options(index, path):
    return {}


def resource_usage():
    return {'running': False, 'childPeakRssBytes': 0}


def shutdown():
    return None


def pipe_ready(fd):
    """True when a read on this pipe will not block: data waiting, or the writer is gone (EOF)."""
    available = wintypes.DWORD()
    if not _kernel.PeekNamedPipe(msvcrt.get_osfhandle(fd), None, 0, None, ctypes.byref(available), None):
        return True
    return available.value > 0


class PipeSelector:
    """The part of selectors.DefaultSelector AXIOM uses, for subprocess pipes."""

    def __init__(self):
        self._keys = {}

    def register(self, fileobj, events, data=None):
        fd = fileobj if isinstance(fileobj, int) else fileobj.fileno()
        key = selectors.SelectorKey(fileobj, fd, events, data)
        self._keys[fd] = key
        return key

    def unregister(self, fileobj):
        fd = fileobj if isinstance(fileobj, int) else fileobj.fileno()
        return self._keys.pop(fd)

    def get_map(self):
        return dict(self._keys)

    def select(self, timeout=None):
        deadline = None if timeout is None else time.monotonic() + max(timeout, 0)
        while True:
            ready = [(key, selectors.EVENT_READ) for fd, key in list(self._keys.items())
                     if key.events & selectors.EVENT_READ and pipe_ready(fd)]
            if ready or (deadline is not None and time.monotonic() >= deadline):
                return ready
            time.sleep(0.005)

    def close(self):
        self._keys.clear()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class _Delegate(types.ModuleType):
    def __init__(self, target, **overrides):
        super().__init__(target.__name__)
        object.__setattr__(self, '_target', target)
        for name, value in overrides.items():
            object.__setattr__(self, name, value)

    def __getattr__(self, name):
        return getattr(self._target, name)


def _rmtree(path, *args, **kwargs):
    return shutil.rmtree(path, *args, **kwargs)
_rmtree.avoids_symlink_attacks = True

SELECTORS_PROXY = _Delegate(selectors, DefaultSelector=PipeSelector)
SHUTIL_PROXY = _Delegate(shutil, rmtree=_rmtree)
SIGNAL_PROXY = _Delegate(signal, SIGKILL=9)


def install(ffmpeg):
    import importlib
    audio_process = importlib.import_module('studio_daw.audio_process')
    if getattr(audio_process, '_windows_studio_installed', False):
        return
    runtime = importlib.import_module('studio_daw.runtime')
    original = runtime.resolve_audio_tool
    resolver = make_audio_tool_resolver(ffmpeg)
    for name in AUDIO_TOOL_USERS:
        module = importlib.import_module(name)
        if getattr(module, 'resolve_audio_tool', None) is original:
            module.resolve_audio_tool = resolver
    audio_process.Popen = Popen
    audio_process.source_input_options = source_input_options
    audio_process.resource_usage = resource_usage
    audio_process.shutdown = shutdown
    for name in SELECTOR_USERS:
        module = importlib.import_module(name)
        if getattr(module, 'selectors', None) is selectors:
            module.selectors = SELECTORS_PROXY
    cache = importlib.import_module('studio_daw.prepared_cache')
    if getattr(cache, 'shutil', None) is shutil:
        cache.shutil = SHUTIL_PROXY
    stems = importlib.import_module('studio_daw.stems')
    if getattr(stems, 'signal', None) is signal:
        stems.signal = SIGNAL_PROXY
    units = importlib.import_module('studio_daw.audio_units')
    defaults = units.create_audio_unit_blueprint.__defaults__
    if defaults and defaults[-1] is units.resolve_worker:  # app calls it with no arguments
        units.create_audio_unit_blueprint.__defaults__ = (*defaults[:-1], resolve_plugin_worker)
    units.resolve_worker = resolve_plugin_worker
    audio_process._windows_studio_installed = True
