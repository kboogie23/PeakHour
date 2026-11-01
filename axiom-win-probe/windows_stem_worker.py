"""AXIOM's stem worker on Windows, with NVIDIA CUDA in place of Apple MPS.

studio_daw/stem_worker is AXIOM's own separation worker (Demucs htdemucs, the
pinned 955717e8 checkpoint, the same normalisation, chunking and checks). It
selects Apple's MPS GPU or the CPU and imports the Unix-only `resource`
module. This runs that same worker with:
- `resource.getrusage` answered from the process's peak working set;
- device selection that uses CUDA when PyTorch reports a usable NVIDIA GPU
  (AXIOM_STEM_DEVICE auto/cuda/cpu), else the CPU;
- GPU failures retried once on the CPU, as the Mac worker does for MPS;
- GPU kernels primed during warm-up, as the Mac worker does for MPS.

It is started by studio_daw.stems as `python -I -B windows_stem_worker.py ...`
with the dedicated stem runtime (PyTorch, Demucs), never with AXIOM's own.
"""
import ctypes
import sys
import types
from ctypes import wintypes
from pathlib import Path


class _Counters(ctypes.Structure):
    _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD), ('PeakWorkingSetSize', ctypes.c_size_t),
                ('WorkingSetSize', ctypes.c_size_t), ('QuotaPeakPagedPoolUsage', ctypes.c_size_t),
                ('QuotaPagedPoolUsage', ctypes.c_size_t), ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t),
                ('QuotaNonPagedPoolUsage', ctypes.c_size_t), ('PagefileUsage', ctypes.c_size_t),
                ('PeakPagefileUsage', ctypes.c_size_t)]


def _getrusage(who):
    counters = _Counters(cb=ctypes.sizeof(_Counters))
    process = ctypes.windll.kernel32.GetCurrentProcess()
    ctypes.windll.psapi.GetProcessMemoryInfo(process, ctypes.byref(counters), counters.cb)
    return types.SimpleNamespace(ru_maxrss=counters.PeakWorkingSetSize // 1024)  # kilobytes, as on Linux


def _load_worker():
    """AXIOM's compiled worker by its exact path (studio_daw is not put on sys.path, so its
    other modules cannot shadow anything PyTorch or Demucs import)."""
    import importlib.machinery
    import importlib.util
    path = str(Path(__file__).with_name('studio_daw') / 'stem_worker.pyc')
    loader = importlib.machinery.SourcelessFileLoader('stem_worker', path)
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader('stem_worker', loader))
    sys.modules['stem_worker'] = module
    loader.exec_module(module)
    return module


sys.modules.setdefault('resource', types.SimpleNamespace(getrusage=_getrusage, RUSAGE_SELF=0))
stem_worker = _load_worker()

_mac_separate = stem_worker.separate_audio


def select_device(torch, requested='auto', mac_version=None):
    if requested not in ('auto', 'cpu', 'cuda'):
        raise ValueError('Stem device must be auto, cpu or cuda.')
    if requested == 'cpu':
        return 'cpu'
    available = torch.cuda.is_available()
    if requested == 'cuda' and not available:
        raise RuntimeError('Accelerated stems require an NVIDIA GPU with a working CUDA driver.')
    return 'cuda' if available else 'cpu'


def separate_audio(model, audio, torch, apply_model, device, allow_fallback):
    if device != 'cuda':
        return _mac_separate(model, audio, torch, apply_model, device, allow_fallback)

    def run(selected):
        with torch.inference_mode():
            result = apply_model(model, audio, device=selected, shifts=0,
                                 split=True, segment=7, overlap=.25, progress=True)[0]
        return result.cpu()
    try:
        return run('cuda'), 'cuda', None
    except (RuntimeError, NotImplementedError) as error:
        if not allow_fallback:
            raise
        reason = str(error)
    model.cpu()
    torch.cuda.empty_cache()
    print('GPU separation unavailable; retrying the same model on CPU: ' + reason, flush=True)
    return run('cpu'), 'cpu', reason


def warm_engine():
    engine, timings, reused = stem_worker.load_engine()
    torch, sf, apply_model, np, device, requested, model = engine
    if not reused and device == 'cuda':
        try:
            separate_audio(model, torch.zeros((1, 2, 7 * 44100)), torch, apply_model, device, False)
        except (RuntimeError, NotImplementedError) as error:
            if requested != 'auto':
                raise
            model.cpu()
            torch.cuda.empty_cache()
            device = 'cpu'
            print('GPU warm-up unavailable; using CPU for this worker: ' + str(error), flush=True)
        stem_worker._engine = (torch, sf, apply_model, np, device, requested, model)
    print('Stem engine ready: ' + device, flush=True)


stem_worker.select_device = select_device
stem_worker.separate_audio = separate_audio
stem_worker.warm_engine = warm_engine

if __name__ == '__main__':
    # The Mac worker runs at nice 10; the Windows equivalent is BELOW_NORMAL_PRIORITY_CLASS.
    ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)
    stem_worker.main()
