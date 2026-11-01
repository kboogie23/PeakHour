"""POSIX-only os functions some AXIOM modules call, for Windows.

- os.uname: scanner._axiom_key_analyzer_paths picks the macOS key-analyzer
  helper by CPU (os.uname().machine). On Windows the call raised and stopped
  the whole Unified Health job; with uname available the helper is simply not
  found and AXIOM continues without it, as designed.
- os.getuid: audio_core.cleanup_audio_core_results and
  scanner._shared_rust_sections accept only files whose st_uid equals the
  current uid. Windows reports st_uid 0 for every file, so 0 keeps that check
  meaning "a file in this user's own folders".
- os.O_NOFOLLOW / os.O_NONBLOCK: AXIOM's lock, journal and cache files are
  opened with os.open(path, ... | os.O_NOFOLLOW), which raised AttributeError
  on Windows (beat-grid batches, playlist files, Serato review, Studio DAW
  cache). Here they are flags this module removes before the real os.open:
  O_NOFOLLOW refuses a symbolic link or junction (ELOOP, as on macOS) and
  O_NONBLOCK has no meaning for the regular files these modules open.
- os.open always adds O_BINARY (POSIX has no text mode; without it Windows
  would turn every "\\n" AXIOM writes through a descriptor into "\\r\\n").
  Directory descriptors, fsync and replace come from windows_djay, which
  makes AXIOM's "fsync the parent directory" step work on Windows.
- os.utime accepts a descriptor from this os.open (prepared_cache marks cache
  entries as used that way; Windows' utime takes only paths).
- os.set_blocking is a no-op: the modules that call it wait on the pipe with
  windows_studio's selector first, so their reads never block.
Only the listed modules see these; the real os module is not modified.
"""
import errno
import os
import platform
import types

MODULES = ('scanner', 'audio_core', 'studio_daw.pcm', 'studio_daw.prepared_cache', 'studio_daw.source_probe',
           'studio_daw.drum_analysis_process', 'utils.lite_preview', 'utils.beatgrid_batch',
           'utils.beatgrid_feature_store', 'utils.beatgrid_library', 'utils.beatgrid_mirror',
           'utils.beatgrid_plan_rows', 'utils.djay_grid_batch', 'utils.native_playlist_files',
           'utils.serato_combined_stage', 'utils.serato_recovery_rows', 'utils.serato_review_collection')

O_NOFOLLOW = 0x10000000  # bits the Windows C runtime does not use; removed before os.open
O_NONBLOCK = 0x20000000
_FD_PATHS = {}  # descriptors from open_fd -> their paths, for utime


def uname():
    return types.SimpleNamespace(sysname=platform.system(), nodename=platform.node(), release=platform.release(),
                                 version=platform.version(), machine=platform.machine().lower())


def getuid():
    return 0


def is_link(path):
    return os.path.islink(path) or os.path.isjunction(path)


def open_fd(path, flags, mode=0o777, *, dir_fd=None):
    from windows_djay import _open as open_directory_aware
    if flags & O_NOFOLLOW and dir_fd is None and is_link(path):
        raise OSError(errno.ELOOP, 'Too many levels of symbolic links', os.fspath(path))
    flags &= ~(O_NOFOLLOW | O_NONBLOCK)
    if flags == os.O_RDONLY and dir_fd is None and os.path.isdir(path):
        return open_directory_aware(path, flags, mode)
    if not flags & os.O_TEXT:
        flags |= os.O_BINARY
    fd = os.open(path, flags, mode, dir_fd=dir_fd)
    if dir_fd is None:
        _FD_PATHS[fd] = os.fspath(path)
    return fd


def close_fd(fd):
    from windows_djay import _close
    _FD_PATHS.pop(fd, None)
    _close(fd)


def utime(path, *args, **kwargs):
    if isinstance(path, int):
        known = _FD_PATHS.get(path)  # a descriptor closed through fdopen() may have been reused: confirm the file
        if known is None or not os.path.samestat(os.fstat(path), os.stat(known)):
            raise OSError(errno.EBADF, 'utime needs a path on Windows', path)
        path = known
    return os.utime(path, *args, **kwargs)


def set_blocking(fd, blocking):
    return None


class _OS(types.ModuleType):
    def __init__(self, target):
        super().__init__(target.__name__)
        object.__setattr__(self, '_target', target)

    def __getattr__(self, name):
        return getattr(self._target, name)


def os_for(module_os):
    from windows_djay import _fsync, _replace
    proxy = _OS(module_os)
    for name, value in (('uname', uname), ('getuid', getuid), ('O_NOFOLLOW', O_NOFOLLOW), ('O_NONBLOCK', O_NONBLOCK),
                        ('open', open_fd), ('close', close_fd), ('utime', utime), ('fsync', _fsync), ('replace', _replace),
                        ('set_blocking', set_blocking)):
        object.__setattr__(proxy, name, value)
    return proxy


def install():
    import importlib
    for name in MODULES:
        module = importlib.import_module(name)
        if getattr(module, 'os', None) is os:
            module.os = os_for(os)
