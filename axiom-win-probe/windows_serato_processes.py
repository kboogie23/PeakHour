"""Preliminary Windows Serato process detection for isolated testing.

A snapshot is not a lock and cannot rule out a process starting immediately
thereafter; it must not be used as the sole protection for library writes.
"""
import ctypes
from ctypes import wintypes
import ntpath

class ProcessInspectionError(RuntimeError):
    pass

_kernel=ctypes.WinDLL('kernel32',use_last_error=True)
class _PROCESS_ENTRY(ctypes.Structure):
    _fields_=[('dwSize',wintypes.DWORD),('cntUsage',wintypes.DWORD),('th32ProcessID',wintypes.DWORD),
              ('th32DefaultHeapID',ctypes.c_size_t),('th32ModuleID',wintypes.DWORD),('cntThreads',wintypes.DWORD),
              ('th32ParentProcessID',wintypes.DWORD),('pcPriClassBase',wintypes.LONG),('dwFlags',wintypes.DWORD),
              ('szExeFile',wintypes.WCHAR*260)]
_kernel.CreateToolhelp32Snapshot.argtypes=[wintypes.DWORD,wintypes.DWORD];_kernel.CreateToolhelp32Snapshot.restype=wintypes.HANDLE
_kernel.Process32FirstW.argtypes=[wintypes.HANDLE,ctypes.POINTER(_PROCESS_ENTRY)];_kernel.Process32FirstW.restype=wintypes.BOOL
_kernel.Process32NextW.argtypes=[wintypes.HANDLE,ctypes.POINTER(_PROCESS_ENTRY)];_kernel.Process32NextW.restype=wintypes.BOOL
_kernel.CloseHandle.argtypes=[wintypes.HANDLE];_kernel.CloseHandle.restype=wintypes.BOOL

# Exact names documented by Serato; other versions/names remain unknown.
KNOWN_SERATO_NAMES={'serato dj pro.exe':'Serato DJ Pro','serato dj lite.exe':'Serato DJ Lite','serato studio.exe':'Serato Studio'}

def snapshot_processes():
    handle=_kernel.CreateToolhelp32Snapshot(0x2,0)
    if handle == ctypes.c_void_p(-1).value:
        raise ProcessInspectionError('Could not inspect running processes') from ctypes.WinError(ctypes.get_last_error())
    try:
        entry=_PROCESS_ENTRY();entry.dwSize=ctypes.sizeof(entry)
        result=[];ok=_kernel.Process32FirstW(handle,ctypes.byref(entry))
        while ok:
            if entry.dwSize < ctypes.sizeof(entry):
                raise ProcessInspectionError('Process snapshot was incomplete')
            result.append((int(entry.th32ProcessID),entry.szExeFile))
            entry.dwSize=ctypes.sizeof(entry);ok=_kernel.Process32NextW(handle,ctypes.byref(entry))
        if ctypes.get_last_error()!=18:
            raise ProcessInspectionError('Process snapshot could not be completed') from ctypes.WinError(ctypes.get_last_error())
        return result
    finally:
        _kernel.CloseHandle(handle)

def running_serato(snapshot=snapshot_processes):
    try:
        processes=snapshot()
        if not isinstance(processes,list):raise ValueError('Invalid process snapshot')
        matches=set()
        for item in processes:
            if not isinstance(item,tuple) or len(item)!=2 or not isinstance(item[1],str) or not item[1]:
                raise ValueError('Invalid process record')
            label=KNOWN_SERATO_NAMES.get(ntpath.basename(item[1]).casefold())
            if label:matches.add(label)
        return sorted(matches)
    except Exception as exc:
        if isinstance(exc,ProcessInspectionError):raise
        raise ProcessInspectionError('Could not reliably inspect Serato processes') from exc

def require_serato_closed(snapshot=snapshot_processes):
    running=running_serato(snapshot)
    if running:raise ProcessInspectionError('Close '+', '.join(running)+' before writing Serato data.')

def guarded_serato_write(writer, *args, snapshot=snapshot_processes, **kwargs):
    """Preflight only; this does not lock out a later Serato launch."""
    require_serato_closed(snapshot)
    return writer(*args, **kwargs)
