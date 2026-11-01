"""Windows path admission for the experimental AXIOM compatibility probe.

This is an initial guard, not a substitute for race-resistant file access.
"""
import ctypes
import ntpath
import os
from pathlib import Path
from ctypes import wintypes

_kernel = ctypes.WinDLL('kernel32', use_last_error=True)
_drive_type = _kernel.GetDriveTypeW
_drive_type.argtypes = [wintypes.LPCWSTR]
_drive_type.restype = wintypes.UINT
_LOCAL_DRIVES = {2, 3}  # removable, fixed

def _within(path, parent):
    try:
        return os.path.commonpath((os.path.normcase(path), os.path.normcase(parent))) == os.path.normcase(parent)
    except ValueError:
        return False

def is_safe_location(value):
    if not isinstance(value, (str, os.PathLike)):
        return False
    value = os.fspath(value).strip()
    if not value or value.startswith(('\\\\', '\\\\?\\', '\\\\.\\')) or not ntpath.isabs(value):
        return False
    try:
        resolved = os.path.realpath(value, strict=True)
        drive, tail = ntpath.splitdrive(resolved)
        if len(drive) != 2 or drive[1] != ':' or tail in ('', '\\', '/'):
            return False
        if _drive_type(drive + '\\') not in _LOCAL_DRIVES:
            return False
        protected = [os.environ.get(k) for k in ('SystemRoot', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'APPDATA', 'LOCALAPPDATA')]
        protected += [ntpath.join(drive + '\\', '$Recycle.Bin'), ntpath.join(drive + '\\', 'System Volume Information')]
        if any(p and _within(resolved, os.path.realpath(p)) for p in protected):
            return False
        return Path(resolved).is_file() or Path(resolved).is_dir()
    except (OSError, ValueError, TypeError):
        return False
