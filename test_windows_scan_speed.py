"""Audio-analysis worker count on Windows: sized from CPUs and memory (AXIOM's macOS memory probe is unavailable)."""
import sys,pathlib,traceback
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
try:
 import windows_scan_speed as W
 GB=1024**3
 assert W.worker_capacity(cpus=8,memory=24*GB)==6      # this PC: 8 threads, 24 GB
 assert W.worker_capacity(cpus=4,memory=16*GB)==2      # small CPUs keep AXIOM's 2
 assert W.worker_capacity(cpus=16,memory=32*GB)==6     # capped
 assert W.worker_capacity(cpus=12,memory=12*GB)==4     # limited by memory
 assert W.worker_capacity(cpus=12,memory=6*GB)==2
 assert W.worker_capacity(cpus=None,memory=None)>=2 and W.memory_bytes()>0
 import windows_bootstrap  # noqa: F401  (install runs from build_backend)
 W.install();import scanner
 assert scanner.DEEP_AUDIO_ANALYSIS_WORKERS==W.worker_capacity() and scanner.DEEP_AUDIO_ANALYSIS_SLOTS._value==scanner.DEEP_AUDIO_ANALYSIS_WORKERS
 print('PASS: analysis workers',scanner.DEEP_AUDIO_ANALYSIS_WORKERS,'on this PC (was 2); sized by CPUs and memory')
except BaseException:
 traceback.print_exc();sys.exit(1)
