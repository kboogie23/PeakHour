"""Experimental Windows Job Object ownership for audio helper processes.

Used with a suspended process and resume_primary_thread; process ownership is
cleanup, not a security sandbox.
"""
import ctypes
from ctypes import wintypes

_kernel=ctypes.WinDLL('kernel32',use_last_error=True)
class _BASIC_LIMIT(ctypes.Structure):
    _fields_=[('PerProcessUserTimeLimit',ctypes.c_int64),('PerJobUserTimeLimit',ctypes.c_int64),
              ('LimitFlags',wintypes.DWORD),('MinimumWorkingSetSize',ctypes.c_size_t),
              ('MaximumWorkingSetSize',ctypes.c_size_t),('ActiveProcessLimit',wintypes.DWORD),
              ('Affinity',ctypes.c_size_t),('PriorityClass',wintypes.DWORD),('SchedulingClass',wintypes.DWORD)]
class _IO_COUNTERS(ctypes.Structure):
    _fields_=[(n,ctypes.c_uint64) for n in ('ReadOperationCount','WriteOperationCount','OtherOperationCount','ReadTransferCount','WriteTransferCount','OtherTransferCount')]
class _EXTENDED_LIMIT(ctypes.Structure):
    _fields_=[('BasicLimitInformation',_BASIC_LIMIT),('IoInfo',_IO_COUNTERS),
              ('ProcessMemoryLimit',ctypes.c_size_t),('JobMemoryLimit',ctypes.c_size_t),
              ('PeakProcessMemoryUsed',ctypes.c_size_t),('PeakJobMemoryUsed',ctypes.c_size_t)]
_kernel.CreateJobObjectW.argtypes=[ctypes.c_void_p,wintypes.LPCWSTR];_kernel.CreateJobObjectW.restype=wintypes.HANDLE
_kernel.SetInformationJobObject.argtypes=[wintypes.HANDLE,ctypes.c_int,ctypes.c_void_p,wintypes.DWORD];_kernel.SetInformationJobObject.restype=wintypes.BOOL
_kernel.AssignProcessToJobObject.argtypes=[wintypes.HANDLE,wintypes.HANDLE];_kernel.AssignProcessToJobObject.restype=wintypes.BOOL
_kernel.TerminateJobObject.argtypes=[wintypes.HANDLE,wintypes.UINT];_kernel.TerminateJobObject.restype=wintypes.BOOL
_kernel.CloseHandle.argtypes=[wintypes.HANDLE];_kernel.CloseHandle.restype=wintypes.BOOL

class _THREAD_ENTRY(ctypes.Structure):
    _fields_=[('dwSize',wintypes.DWORD),('cntUsage',wintypes.DWORD),
              ('th32ThreadID',wintypes.DWORD),('th32OwnerProcessID',wintypes.DWORD),
              ('tpBasePri',wintypes.LONG),('tpDeltaPri',wintypes.LONG),('dwFlags',wintypes.DWORD)]
_kernel.CreateToolhelp32Snapshot.argtypes=[wintypes.DWORD,wintypes.DWORD];_kernel.CreateToolhelp32Snapshot.restype=wintypes.HANDLE
_kernel.Thread32First.argtypes=[wintypes.HANDLE,ctypes.POINTER(_THREAD_ENTRY)];_kernel.Thread32First.restype=wintypes.BOOL
_kernel.Thread32Next.argtypes=[wintypes.HANDLE,ctypes.POINTER(_THREAD_ENTRY)];_kernel.Thread32Next.restype=wintypes.BOOL
_kernel.OpenThread.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];_kernel.OpenThread.restype=wintypes.HANDLE
_kernel.GetProcessIdOfThread.argtypes=[wintypes.HANDLE];_kernel.GetProcessIdOfThread.restype=wintypes.DWORD
_kernel.ResumeThread.argtypes=[wintypes.HANDLE];_kernel.ResumeThread.restype=wintypes.DWORD

def resume_primary_thread(pid):
    snapshot = _kernel.CreateToolhelp32Snapshot(0x4, 0)
    if snapshot == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        entry = _THREAD_ENTRY(); entry.dwSize = ctypes.sizeof(entry)
        threads=[]
        ok=_kernel.Thread32First(snapshot,ctypes.byref(entry))
        while ok:
            if entry.dwSize < ctypes.sizeof(entry):
                raise RuntimeError('Incomplete Windows thread snapshot')
            if entry.th32OwnerProcessID == pid:
                threads.append(entry.th32ThreadID)
            entry.dwSize=ctypes.sizeof(entry)
            ok=_kernel.Thread32Next(snapshot,ctypes.byref(entry))
        if ctypes.get_last_error() != 18: # ERROR_NO_MORE_FILES
            raise ctypes.WinError(ctypes.get_last_error())
        if len(threads) != 1:
            raise RuntimeError('Suspended helper does not have exactly one initial thread')
        thread=_kernel.OpenThread(0x0002 | 0x0800,False,threads[0]) # suspend/resume + query limited
        if not thread: raise ctypes.WinError(ctypes.get_last_error())
        try:
            if _kernel.GetProcessIdOfThread(thread) != pid:
                raise RuntimeError('Helper thread identity changed before resume')
            prior=_kernel.ResumeThread(thread)
            if prior == 0xffffffff: raise ctypes.WinError(ctypes.get_last_error())
            if prior != 1: raise RuntimeError('Unexpected helper thread suspend count')
        finally:
            _kernel.CloseHandle(thread)
    finally:
        _kernel.CloseHandle(snapshot)

class Job:
    def __init__(self):
        self._handle=_kernel.CreateJobObjectW(None,None)
        if not self._handle:raise ctypes.WinError(ctypes.get_last_error())
        info=_EXTENDED_LIMIT();info.BasicLimitInformation.LimitFlags=0x2000 # KILL_ON_JOB_CLOSE
        if not _kernel.SetInformationJobObject(self._handle,9,ctypes.byref(info),ctypes.sizeof(info)):
            error=ctypes.get_last_error();self.close();raise ctypes.WinError(error)
    def assign(self, process_handle):
        if not _kernel.AssignProcessToJobObject(self._handle,int(process_handle)):
            raise ctypes.WinError(ctypes.get_last_error())
    def terminate(self):
        if self._handle and not _kernel.TerminateJobObject(self._handle,1):
            raise ctypes.WinError(ctypes.get_last_error())
    def close(self):
        if self._handle:
            handle,self._handle=self._handle,None
            _kernel.CloseHandle(handle)
    def __del__(self):
        self.close()
