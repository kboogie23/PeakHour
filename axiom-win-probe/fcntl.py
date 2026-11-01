"""Windows implementation of the flock operations AXIOM uses.

Locks the entire file with LockFileEx. This adapter is experimental until the
application's safe-write and recovery workflows have been verified on Windows.
"""
import ctypes
import errno
import msvcrt
from ctypes import wintypes

LOCK_SH, LOCK_EX, LOCK_NB, LOCK_UN = 1, 2, 4, 8
_FAIL_IMMEDIATELY = 1
_EXCLUSIVE = 2
_ERROR_LOCK_VIOLATION = 33
_ERROR_SHARING_VIOLATION = 32

class _OVERLAPPED(ctypes.Structure):
    _fields_ = [('Internal', ctypes.c_size_t), ('InternalHigh', ctypes.c_size_t),
                ('Offset', wintypes.DWORD), ('OffsetHigh', wintypes.DWORD),
                ('hEvent', wintypes.HANDLE)]

_kernel = ctypes.WinDLL('kernel32', use_last_error=True)
_lock = _kernel.LockFileEx
_lock.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD,
                  wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(_OVERLAPPED)]
_lock.restype = wintypes.BOOL
_unlock = _kernel.UnlockFileEx
_unlock.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD,
                    wintypes.DWORD, ctypes.POINTER(_OVERLAPPED)]
_unlock.restype = wintypes.BOOL

def flock(fd, operation):
    if hasattr(fd, 'fileno'):
        fd = fd.fileno()
    handle = msvcrt.get_osfhandle(fd)
    overlapped = _OVERLAPPED()
    if operation == LOCK_UN:
        ok = _unlock(handle, 0, 0xffffffff, 0xffffffff, ctypes.byref(overlapped))
    else:
        kind = operation & (LOCK_SH | LOCK_EX)
        if kind not in (LOCK_SH, LOCK_EX) or operation & ~(LOCK_SH | LOCK_EX | LOCK_NB):
            raise ValueError('Unsupported flock operation')
        flags = (_EXCLUSIVE if kind == LOCK_EX else 0) | (_FAIL_IMMEDIATELY if operation & LOCK_NB else 0)
        ok = _lock(handle, flags, 0, 0xffffffff, 0xffffffff, ctypes.byref(overlapped))
    if not ok:
        code = ctypes.get_last_error()
        if code in (_ERROR_LOCK_VIOLATION, _ERROR_SHARING_VIOLATION):
            raise BlockingIOError(errno.EAGAIN, 'File lock is held by another process')
        raise ctypes.WinError(code)
