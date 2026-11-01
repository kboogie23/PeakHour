"""Per-application audio capture on Windows ("DJ Software Audio").

On macOS, AXIOM records the DJ program's own output with its ScreenCaptureKit
helper (axiom-system-audio-recorder). Windows 10 version 2004 and later offer
the equivalent: WASAPI process loopback, which captures what one process tree
plays, whatever output device it uses, and nothing from other programs. It is
reached through ActivateAudioInterfaceAsync on the virtual device
"VAD\\Process_Loopback" with AUDIOCLIENT_ACTIVATION_PARAMS naming the process.

ProcessLoopbackStream has the part of sounddevice.InputStream that AXIOM's
Windows capture uses (start/stop/close/active and a callback receiving float32
frames), so WindowsInputCapture and sample_peak record and meter it unchanged.
Packets carry their capture time; where the program played nothing and Windows
delivered no packets, the gap is filled with silence so a recording keeps real
time. running_applications lists DJ programs that are open, from the process
list (Toolhelp32), without starting anything.
"""
import ctypes
import os
import threading
import time
import uuid
from ctypes import wintypes

import numpy as np

_ole32 = ctypes.OleDLL('ole32')
_kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
HRESULT = ctypes.c_long
S_OK, E_NOINTERFACE = 0, -2147467262  # 0x80004002
VT_BLOB = 65
AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1
PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0
AUDCLNT_SHAREMODE_SHARED = 0
AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000
AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM = 0x80000000
AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY = 0x08000000
AUDCLNT_BUFFERFLAGS_SILENT = 0x2
WAVE_FORMAT_IEEE_FLOAT = 3
VIRTUAL_DEVICE = 'VAD\\Process_Loopback'
GAP_FRAMES = 480  # fill silences longer than 10 ms at 48 kHz

DJ_PROGRAMS = (  # (process name, display name, AXIOM provider)
    ('serato dj pro.exe', 'Serato DJ Pro', 'serato'), ('serato dj lite.exe', 'Serato DJ Lite', 'serato'),
    ('djay.exe', 'djay Pro', 'djay'), ('djay pro.exe', 'djay Pro', 'djay'),
    ('virtualdj.exe', 'VirtualDJ', 'virtualdj'), ('virtualdj8.exe', 'VirtualDJ', 'virtualdj'),
    ('rekordbox.exe', 'rekordbox', 'rekordbox'), ('traktor.exe', 'Traktor Pro', 'traktor'),
    ('engine dj.exe', 'Engine DJ', 'engine'),
)


class GUID(ctypes.Structure):
    _fields_ = [('Data1', wintypes.DWORD), ('Data2', wintypes.WORD), ('Data3', wintypes.WORD), ('Data4', ctypes.c_ubyte * 8)]

    @classmethod
    def of(cls, text):
        return cls.from_buffer_copy(uuid.UUID(text).bytes_le)

    def __eq__(self, other):
        return bytes(self) == bytes(other)


IID_IUnknown = GUID.of('00000000-0000-0000-C000-000000000046')
IID_IAgileObject = GUID.of('94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90')
IID_IActivateAudioInterfaceCompletionHandler = GUID.of('41D949AB-9862-444A-80F6-C261334DA5EB')
IID_IAudioClient = GUID.of('1CB9AD4C-DBFA-4c32-B178-C2F568A703B2')
IID_IAudioCaptureClient = GUID.of('C8ADBD64-E71E-48a0-A4DE-185C395CD317')


class WAVEFORMATEX(ctypes.Structure):
    _fields_ = [('wFormatTag', wintypes.WORD), ('nChannels', wintypes.WORD), ('nSamplesPerSec', wintypes.DWORD),
                ('nAvgBytesPerSec', wintypes.DWORD), ('nBlockAlign', wintypes.WORD), ('wBitsPerSample', wintypes.WORD),
                ('cbSize', wintypes.WORD)]


class PROCESS_LOOPBACK_PARAMS(ctypes.Structure):
    _fields_ = [('TargetProcessId', wintypes.DWORD), ('ProcessLoopbackMode', ctypes.c_int)]


class ACTIVATION_PARAMS(ctypes.Structure):
    _fields_ = [('ActivationType', ctypes.c_int), ('ProcessLoopbackParams', PROCESS_LOOPBACK_PARAMS)]


class BLOB(ctypes.Structure):
    _fields_ = [('cbSize', wintypes.ULONG), ('pBlobData', ctypes.c_void_p)]


class PROPVARIANT(ctypes.Structure):
    _fields_ = [('vt', wintypes.USHORT), ('r1', wintypes.USHORT), ('r2', wintypes.USHORT), ('r3', wintypes.USHORT),
                ('blob', BLOB)]


def _method(pointer, index, *argtypes):
    vtable = ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]
    return ctypes.WINFUNCTYPE(HRESULT, ctypes.c_void_p, *argtypes)(vtable[index])


def _call(pointer, index, argtypes, *args):
    hr = _method(pointer, index, *argtypes)(pointer, *args)
    if hr < 0:
        raise OSError(f'Windows audio call failed (HRESULT 0x{hr & 0xFFFFFFFF:08X})')
    return hr


def _release(pointer):
    if pointer:
        _method(pointer, 2)(pointer)


_QI = ctypes.WINFUNCTYPE(HRESULT, ctypes.c_void_p, ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p))
_REF = ctypes.WINFUNCTYPE(wintypes.ULONG, ctypes.c_void_p)
_DONE = ctypes.WINFUNCTYPE(HRESULT, ctypes.c_void_p, ctypes.c_void_p)


class _HandlerVtbl(ctypes.Structure):
    _fields_ = [('QueryInterface', _QI), ('AddRef', _REF), ('Release', _REF), ('ActivateCompleted', _DONE)]


class _Handler(ctypes.Structure):
    _fields_ = [('lpVtbl', ctypes.POINTER(_HandlerVtbl))]


class CompletionHandler:
    """IActivateAudioInterfaceCompletionHandler; agile (IAgileObject), owned by this Python object."""

    def __init__(self):
        self.done = threading.Event()

        def query(this, riid, out):
            if riid.contents in (IID_IUnknown, IID_IAgileObject, IID_IActivateAudioInterfaceCompletionHandler):
                out[0] = this
                return S_OK
            out[0] = None
            return E_NOINTERFACE

        def completed(this, operation):
            self.done.set()
            return S_OK

        self._vtbl = _HandlerVtbl(_QI(query), _REF(lambda this: 1), _REF(lambda this: 1), _DONE(completed))
        self._object = _Handler(ctypes.pointer(self._vtbl))

    @property
    def pointer(self):
        return ctypes.cast(ctypes.byref(self._object), ctypes.c_void_p)


def ensure_com():
    try:
        _ole32.CoInitializeEx(None, 0)
    except OSError:
        pass


def activate_process_loopback(pid, timeout=5.0):
    """IAudioClient capturing one process tree."""
    mmdevapi = ctypes.WinDLL('Mmdevapi')
    activate = mmdevapi.ActivateAudioInterfaceAsync
    activate.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(GUID), ctypes.POINTER(PROPVARIANT), ctypes.c_void_p,
                         ctypes.POINTER(ctypes.c_void_p)]
    activate.restype = HRESULT
    params = ACTIVATION_PARAMS(AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
                               PROCESS_LOOPBACK_PARAMS(int(pid), PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE))
    variant = PROPVARIANT(vt=VT_BLOB, blob=BLOB(ctypes.sizeof(params), ctypes.cast(ctypes.byref(params), ctypes.c_void_p)))
    handler, operation = CompletionHandler(), ctypes.c_void_p()
    hr = activate(VIRTUAL_DEVICE, ctypes.byref(IID_IAudioClient), ctypes.byref(variant), handler.pointer,
                  ctypes.byref(operation))
    if hr < 0:
        raise OSError(f'Application audio capture is unavailable (HRESULT 0x{hr & 0xFFFFFFFF:08X}). '
                      'It requires Windows 10 version 2004 or later.')
    try:
        if not handler.done.wait(timeout):
            raise OSError('Windows did not open the application audio capture.')
        result, client = HRESULT(), ctypes.c_void_p()
        _call(operation, 3, [ctypes.POINTER(HRESULT), ctypes.POINTER(ctypes.c_void_p)],
              ctypes.byref(result), ctypes.byref(client))
        if result.value < 0:
            raise OSError(f'Windows refused application audio capture (HRESULT 0x{result.value & 0xFFFFFFFF:08X}).')
        return client
    finally:
        _release(operation)


class ProcessLoopbackStream:
    """sounddevice.InputStream-shaped capture of one program's audio (48 kHz float32)."""

    def __init__(self, pid, *, samplerate=48000, channels=2, dtype='float32', callback=None, device=None,
                 activate=activate_process_loopback):
        if dtype != 'float32' or channels not in (1, 2) or not callable(callback):
            raise ValueError('Application capture delivers float32 mono or stereo frames to a callback.')
        self.pid, self.samplerate, self.channels, self.callback = int(pid), int(samplerate), channels, callback
        self._activate = activate
        self._client = self._capture = None
        self._thread = None
        self._stop = threading.Event()
        self.active = False

    def start(self):
        ensure_com()
        client = self._activate(self.pid)
        try:
            fmt = WAVEFORMATEX(WAVE_FORMAT_IEEE_FLOAT, 2, self.samplerate, self.samplerate * 8, 8, 32, 0)
            _call(client, 3, [ctypes.c_int, wintypes.DWORD, ctypes.c_longlong, ctypes.c_longlong,
                              ctypes.POINTER(WAVEFORMATEX), ctypes.c_void_p],
                  AUDCLNT_SHAREMODE_SHARED,
                  AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                  2_000_000, 0, ctypes.byref(fmt), None)  # 200 ms buffer
            capture = ctypes.c_void_p()
            _call(client, 14, [ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)],
                  ctypes.byref(IID_IAudioCaptureClient), ctypes.byref(capture))
            self._capture = capture
            _call(client, 10, [])  # Start
        except BaseException:
            _release(self._capture)
            _release(client)
            self._capture = None
            raise
        self._client = client
        self._stop.clear()
        self.active = True
        self._thread = threading.Thread(target=self._run, name='axiom-app-audio', daemon=True)
        self._thread.start()

    def _run(self):
        ensure_com()
        next_size = _method(self._capture, 5, ctypes.POINTER(wintypes.UINT))
        get = _method(self._capture, 3, ctypes.POINTER(ctypes.POINTER(ctypes.c_float)), ctypes.POINTER(wintypes.UINT),
                      ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(ctypes.c_ulonglong), ctypes.POINTER(ctypes.c_ulonglong))
        release = _method(self._capture, 4, wintypes.UINT)
        written, origin = 0, None
        size, frames, flags, position, qpc = wintypes.UINT(), wintypes.UINT(), wintypes.DWORD(), ctypes.c_ulonglong(), ctypes.c_ulonglong()
        data = ctypes.POINTER(ctypes.c_float)()
        try:
            while not self._stop.is_set():
                if next_size(self._capture, ctypes.byref(size)) < 0:
                    raise OSError('The application audio stream ended (the program may have closed).')
                if not size.value:
                    time.sleep(0.005)
                    continue
                if get(self._capture, ctypes.byref(data), ctypes.byref(frames), ctypes.byref(flags),
                       ctypes.byref(position), ctypes.byref(qpc)) < 0:
                    raise OSError('The application audio stream could not be read.')
                count = frames.value
                try:
                    if flags.value & AUDCLNT_BUFFERFLAGS_SILENT or not data:
                        block = np.zeros((count, 2), np.float32)
                    else:
                        block = np.ctypeslib.as_array(data, shape=(count * 2,)).reshape(count, 2).copy()
                finally:
                    release(self._capture, count)
                at = qpc.value  # 100 ns units
                if origin is None:
                    origin = at
                expected = int(round((at - origin) * self.samplerate / 10_000_000))
                if expected - written > GAP_FRAMES:
                    silence = np.zeros((expected - written, self.channels), np.float32)
                    self.callback(silence, len(silence), None, None)
                    written += len(silence)
                if self.channels == 1:
                    block = block.mean(axis=1, keepdims=True)
                self.callback(block, count, None, None)
                written += count
        except Exception as exc:
            try:
                self.callback(np.zeros((0, self.channels), np.float32), 0, None, str(exc))
            except Exception:
                pass
        finally:
            self.active = False

    def stop(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(2)
        if self._client:
            try:
                _call(self._client, 11, [])  # Stop
            except OSError:
                pass
        self.active = False

    def close(self):
        self.stop()
        _release(self._capture)
        _release(self._client)
        self._capture = self._client = None


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [('dwSize', wintypes.DWORD), ('cntUsage', wintypes.DWORD), ('th32ProcessID', wintypes.DWORD),
                ('th32DefaultHeapID', ctypes.c_void_p), ('th32ModuleID', wintypes.DWORD), ('cntThreads', wintypes.DWORD),
                ('th32ParentProcessID', wintypes.DWORD), ('pcPriClassBase', ctypes.c_long), ('dwFlags', wintypes.DWORD),
                ('szExeFile', ctypes.c_wchar * 260)]


def processes():
    """(pid, parent pid, executable name) for every running process."""
    _kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    snapshot = _kernel32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
    if snapshot in (None, wintypes.HANDLE(-1).value):
        raise OSError('The process list is unavailable.')
    try:
        entry = PROCESSENTRY32W(dwSize=ctypes.sizeof(PROCESSENTRY32W))
        found = []
        ok = _kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while ok:
            found.append((entry.th32ProcessID, entry.th32ParentProcessID, entry.szExeFile))
            ok = _kernel32.Process32NextW(snapshot, ctypes.byref(entry))
        return found
    finally:
        _kernel32.CloseHandle(snapshot)


def running_applications(process_list=processes):
    """Open DJ programs: [{'name', 'bundle_id' (process name), 'pid', 'provider'}], one per program."""
    names = {exe: (label, provider) for exe, label, provider in DJ_PROGRAMS}
    rows, pids = {}, {}
    entries = list(process_list())
    for pid, parent, exe in entries:
        pids[pid] = exe.casefold()
    for pid, parent, exe in sorted(entries):
        key = exe.casefold()
        if key not in names and key.startswith('djay') and key.endswith('.exe'):
            names[key] = ('djay Pro', 'djay')  # the Microsoft Store build's process name may vary
        if key in names and pids.get(parent) != key and key not in rows:  # the top process of the program
            label, provider = names[key]
            rows[key] = {'name': label, 'bundle_id': key, 'pid': pid, 'provider': provider}
    return list(rows.values())
