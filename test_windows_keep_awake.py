"""Keep-awake: holds are counted, expire, and drive SetThreadExecutionState from one owner thread; the core's
macOS activity calls and the long jobs are replaced on the real app; recordings and stem workers hold the PC."""
import ctypes
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

workspace = Path(__file__).resolve().parent
sys.path.insert(0, str(workspace / 'axiom-win-probe'))
import windows_keep_awake as K

CONT, SYS = K.ES_CONTINUOUS, K.ES_SYSTEM_REQUIRED
assert CONT == 0x80000000 and SYS == 1

# 1. Counting with an injected setter: nothing real changes
calls = []
clock = [1000.0]
keeper = K.KeepAwake(setter=lambda flags: calls.append(flags) or 1, max_age=100, clock=lambda: clock[0])
assert keeper.status()['count'] == 0 and not keeper.status()['awake']
a = keeper.hold('recording')
b = keeper.hold('stems')
assert keeper.flush() and calls == [CONT | SYS], calls
assert keeper.status()['count'] == 2 and keeper.status()['reasons'] == ['recording', 'stems']
keeper.release(a)
keeper.release(a)  # twice: no-op
keeper.release('nonsense')
keeper.release(10 ** 6)
keeper.release(None)
assert keeper.flush() and calls == [CONT | SYS] and keeper.status()['count'] == 1
b.release()
assert keeper.flush() and calls == [CONT | SYS, CONT], calls
assert keeper.status()['count'] == 0 and keeper.status()['applied'] == CONT
with keeper.hold('with block'):
    assert keeper.flush() and keeper.status()['count'] == 1 and calls[-1] == CONT | SYS
assert keeper.flush() and calls[-1] == CONT and keeper.status()['count'] == 0

# 2. A hold nobody releases expires; a longer one outlives it
n = len(calls)
keeper.hold('forgotten')
long_one = keeper.hold('long', max_age=1000)
assert keeper.flush() and keeper.status()['count'] == 2
clock[0] += 150
assert keeper.status()['count'] == 1 and keeper.status()['reasons'] == ['long']
assert keeper.flush() and calls[-1] == CONT | SYS
clock[0] += 2000
assert keeper.status()['count'] == 0
assert keeper.flush() and calls[-1] == CONT, calls[n:]
keeper.release(long_one)  # already expired: no-op
assert keeper.flush() and keeper.status()['count'] == 0

# 3. Many threads: the count comes back to zero and the owner thread is the only caller
seen = set()
many = K.KeepAwake(setter=lambda flags: seen.add(threading.get_ident()) or 1)

def worker():
    for _ in range(200):
        with many.hold('t'):
            pass

threads = [threading.Thread(target=worker) for _ in range(8)]
[t.start() for t in threads]
[t.join() for t in threads]
assert many.flush() and many.status()['count'] == 0 and many.status()['applied'] == CONT
assert len(seen) == 1 and threading.get_ident() not in seen, seen

# 4. A failing setter is reported, not raised
K._RETRY = 0.05
attempts = []
bad = K.KeepAwake(setter=lambda flags: attempts.append(flags) or (0 if len(attempts) < 3 else 1))
bad.hold('x')
assert bad.flush() and len(attempts) == 3 and bad.status()['error'] == '' and bad.status()['applied'] == CONT | SYS, attempts
failing = K.KeepAwake(setter=lambda flags: 0)
failing.hold('x')
time.sleep(0.3)
assert failing.status()['error'] and failing.status()['applied'] is None and failing.status()['calls'] >= 2

# 5. The real call on this PC: non-zero, and reset afterwards
if sys.platform == 'win32':
    real = K.KeepAwake()
    token = real.hold('test')
    assert real.flush() and real.status()['applied'] == CONT | SYS and real.status()['error'] == '', real.status()
    real.release(token)
    assert real.flush() and real.status()['applied'] == CONT and real.status()['error'] == '', real.status()
    kernel = ctypes.WinDLL('kernel32')
    kernel.SetThreadExecutionState.restype = ctypes.c_uint32
    kernel.SetThreadExecutionState.argtypes = [ctypes.c_uint32]
    assert kernel.SetThreadExecutionState(CONT) != 0  # this thread's own state: also accepted, and left cleared
    print('real SetThreadExecutionState: ok')

# 6. Recording holds from start to the end of stop, and on a failed stop
import windows_recording as R
from windows_capture import CaptureError


class FakeCapture:
    def __init__(self, fail_stop=False):
        self.fail_stop, self.feed = fail_stop, None

    def start(self, output, **options):
        self.output = output

    def status(self):
        return dict(peak=0.1, seconds=3, error='', dropouts=0, partial_path=self.output + '.partial')

    def stop(self):
        if self.fail_stop:
            raise CaptureError('disk full')
        return self.output


def sampler(*args, **kwargs):
    return 0.0


tmp = Path(tempfile.mkdtemp(prefix='phawake'))
try:
    desktop = tmp / 'desk'
    desktop.mkdir()
    devices = lambda: [dict(name='In', max_input_channels=2, default_samplerate=48000.0, hostapi=0)]
    hosts = lambda: [dict(name='WASAPI')]
    for fail in (False, True):
        captures = [FakeCapture(fail)]
        manager = R.WindowsRecordingManager(str(tmp / 'settings.json'), str(desktop), capture_factory=lambda: captures[0],
                                            device_query=devices, host_query=hosts)
        before = K.status()['count']
        manager._capture = captures[0]
        manager._keep_awake()
        manager._keep_awake()  # a second call never stacks a second hold
        assert K.status()['count'] == before + 1 and 'Recording a set' in K.status()['reasons']
        manager._state.update(status='recording', recording=True, format='wav', output_path='x', temp_wav_path='x.partial')
        captures[0].output = str(desktop / 'a.wav')
        try:
            manager.stop()
            assert not fail
        except RuntimeError:
            assert fail
        assert K.status()['count'] == before, K.status()
        assert 'Recording a set' not in K.status()['reasons']
    print('recording hold: ok')
finally:
    shutil.rmtree(tmp, ignore_errors=True)

# 7. Stem workers hold the PC for as long as the process lives
import windows_stems as S
import windows_studio as W
import types
launched = []
real_init = subprocess.Popen.__init__

def spy(self, *args, **kwargs):
    launched.append(kwargs.get('creationflags'))
    return real_init(self, *args, **kwargs)

subprocess.Popen.__init__ = spy
try:
    # studio_daw.stems calls its audio_process "subprocess": wrapping it keeps windows_studio's Windows Popen
    wrapped = S.AwakeSubprocess(types.SimpleNamespace(Popen=W.Popen, PIPE=subprocess.PIPE))
    assert issubclass(wrapped.Popen, W.Popen) and wrapped.PIPE == subprocess.PIPE
    child = wrapped.Popen([sys.executable, '-c', 'import time; time.sleep(1.5)'], start_new_session=True)
finally:
    subprocess.Popen.__init__ = real_init
assert launched and launched[0] & W.CREATE_NO_WINDOW and launched[0] & subprocess.CREATE_NEW_PROCESS_GROUP, launched
time.sleep(0.3)
assert 'Splitting stems' in K.status()['reasons'], K.status()
child.wait()
for _ in range(50):
    if 'Splitting stems' not in K.status()['reasons']:
        break
    time.sleep(0.1)
assert 'Splitting stems' not in K.status()['reasons'], K.status()
try:  # relative args are still refused by windows_studio's own validation
    wrapped.Popen(['python'])
    raise SystemExit('relative engine path was accepted')
except ValueError:
    pass
print('stem hold: ok')

# 8. On the real app: the core's macOS activity calls and long jobs are replaced (sandboxed data)
SERVER = r'''
import sys, pathlib, json
sb = pathlib.Path(sys.argv[1]); sys.path.insert(0, sys.argv[2])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'data'
backend = L.build_app(8099)
import windows_keep_awake as K
begin, end = backend._begin_unified_macos_activity, backend._end_unified_macos_activity
import windows_studio, studio_daw.stems as stems
stems_ok = hasattr(stems.subprocess, '_original') and issubclass(stems.subprocess.Popen, windows_studio.Popen)
token = begin()
during = K.status()['count']
end(token); end(None)
after = K.status()['count']
out = dict(stems_ok=stems_ok, begin=begin.__module__, end=end.__module__, token=token is not None, during=during, after=after,
           jobs={n: bool(getattr(getattr(backend, n, None), '_keeps_awake', False)) for n in K.CORE_JOBS},
           present={n: hasattr(backend, n) for n in K.CORE_JOBS})
print('RESULT' + json.dumps(out))
'''
base = Path(tempfile.mkdtemp(prefix='phawake'))
try:
    (base / 'local').mkdir()
    (base / 'home').mkdir()
    env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'),
           'AXIOM_RUNTIME_DIR': str(base / 'data'), 'AXIOM_LICENSE_REQUIRED': '0'}
    done = subprocess.run([sys.executable, '-c', SERVER, str(base), str(workspace / 'axiom-win-probe')], env=env,
                          cwd=str(workspace), capture_output=True, text=True, timeout=240)
    line = next((l for l in done.stdout.splitlines() if l.startswith('RESULT')), '')
    assert line, (done.stdout[-2000:], done.stderr[-2000:])
    result = json.loads(line[6:])
    assert result['begin'] == 'windows_keep_awake' and result['end'] == 'windows_keep_awake', result
    assert result['stems_ok'] is True, result  # the real app's stem Popen still derives from windows_studio.Popen
    assert result['token'] and result['during'] == 1 and result['after'] == 0, result
    assert all(result['present'][n] <= result['jobs'][n] for n in result['jobs']), result
    print('core replaced:', result['jobs'])
finally:
    shutil.rmtree(base, ignore_errors=True)

print('PASS')
