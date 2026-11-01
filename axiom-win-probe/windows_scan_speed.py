"""Parallel audio analysis for AXIOM's key/BPM scans on Windows.

scanner._deep_audio_worker_capacity sizes the thread pool that analyses
songs (Health "Scan Keys"/BPM): 2 workers below 12 logical CPUs, otherwise up
to 4 when macOS reports at least 16 GB of memory (hw.memsize). On Windows the
memory probe is unavailable, so every PC gets 2. Measured on a 4-core/8-thread
i7-7700K with 24 GB, 20 songs: 2 workers 3.83 s/song, 4 workers 3.03 s/song,
6 workers 2.78 s/song. Windows uses the logical CPU count minus two (keeping
two for playback and the interface), at most 6, and at most 2 below 8 GB of
memory or 4 below 16 GB (memory from GlobalMemoryStatusEx).
"""
import ctypes
import os
import threading
from ctypes import wintypes

MAX_WORKERS = 6


class _MemoryStatus(ctypes.Structure):
    _fields_ = [('dwLength', wintypes.DWORD), ('dwMemoryLoad', wintypes.DWORD), ('ullTotalPhys', ctypes.c_ulonglong),
                ('ullAvailPhys', ctypes.c_ulonglong), ('ullTotalPageFile', ctypes.c_ulonglong),
                ('ullAvailPageFile', ctypes.c_ulonglong), ('ullTotalVirtual', ctypes.c_ulonglong),
                ('ullAvailVirtual', ctypes.c_ulonglong), ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]


def memory_bytes():
    status = _MemoryStatus(dwLength=ctypes.sizeof(_MemoryStatus))
    try:
        return status.ullTotalPhys if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)) else 0
    except (AttributeError, OSError):
        return 0


def worker_capacity(cpus=None, memory=None):
    cpus = (os.cpu_count() or 2) if cpus is None else cpus
    memory = memory_bytes() if memory is None else memory
    workers = max(2, min(MAX_WORKERS, cpus - 2))
    if memory < 8 * 1024 ** 3:
        return 2
    if memory < 16 * 1024 ** 3:
        return min(workers, 4)
    return workers


def install():
    import scanner
    if getattr(scanner, '_windows_scan_speed_installed', False):
        return
    workers = worker_capacity()
    scanner._deep_audio_worker_capacity = worker_capacity
    scanner.DEEP_AUDIO_ANALYSIS_WORKERS = workers
    scanner.DEEP_AUDIO_ANALYSIS_SLOTS = threading.BoundedSemaphore(workers)
    scanner._windows_scan_speed_installed = True
