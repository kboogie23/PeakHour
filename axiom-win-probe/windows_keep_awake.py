"""Keep Windows awake while PEAK HOUR does long work (recording, stems, imports, Health jobs).

The Mac app does this with NSProcessInfo activities (_begin/_end_unified_macos_activity). On Windows the
equivalent is SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED): the PC stays awake, the screen
may still turn off, and Windows clears the request itself if the process ends.

    with keep_awake.hold('Recording a set'):
        ...
    token = keep_awake.hold('Stem separation'); ...; keep_awake.release(token)

Holds are counted. ES_CONTINUOUS is remembered per thread, so one small daemon thread makes every call.
A hold nobody releases expires after MAX_AGE seconds (6 hours) instead of keeping the PC awake forever.
Away mode (ES_AWAYMODE_REQUIRED) is not used: a recording needs the PC running, not pretending to sleep.
Off Windows every call is a no-op that still counts holds.
"""
import functools
import itertools
import sys
import threading
import time

ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
MAX_AGE = 6 * 3600.0
_RETRY = 5.0  # wait before trying again after a failed call
_POLL = 60.0 # longest sleep of the owner thread while holds exist


def _windows_setter():
    if sys.platform != 'win32':
        return None
    import ctypes
    from ctypes import wintypes
    function = ctypes.WinDLL('kernel32', use_last_error=True).SetThreadExecutionState
    function.argtypes = [wintypes.DWORD]
    function.restype = wintypes.DWORD
    return lambda flags: int(function(flags))


class Hold:
    """What hold() returns: pass it to release(), or use it in a with block."""

    def __init__(self, keeper, number, reason):
        self._keeper, self.number, self.reason = keeper, number, reason

    def release(self):
        self._keeper.release(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.release()
        return False


class KeepAwake:
    def __init__(self, setter='default', max_age=MAX_AGE, clock=time.monotonic):
        self._setter = _windows_setter() if setter == 'default' else setter
        self._max_age = max_age
        self._clock = clock
        self._cond = threading.Condition()
        self._holds = {}  # number -> (reason, expires)
        self._numbers = itertools.count(1)
        self._thread = None
        self._applied = None  # flags last handed to the setter by the owner thread
        self._calls = 0
        self._error = ''

    def hold(self, reason='', max_age=None):
        with self._cond:
            number = next(self._numbers)
            self._holds[number] = (str(reason), self._clock() + (self._max_age if max_age is None else max_age))
            self._start_locked()
            self._cond.notify_all()
            return Hold(self, number, str(reason))

    def release(self, token):
        number = getattr(token, 'number', token)
        with self._cond:
            if self._holds.pop(number, None) is not None:
                self._cond.notify_all()

    def _start_locked(self):
        if self._setter is not None and (self._thread is None or not self._thread.is_alive()):
            self._thread = threading.Thread(target=self._run, name='peak-hour-keep-awake', daemon=True)
            self._thread.start()

    def _purge_locked(self):
        now = self._clock()
        for number in [n for n, (_, expires) in self._holds.items() if expires <= now]:
            del self._holds[number]

    def _wanted_locked(self):
        self._purge_locked()
        return ES_CONTINUOUS | ES_SYSTEM_REQUIRED if self._holds else ES_CONTINUOUS

    def _run(self):
        with self._cond:
            while True:
                wanted = self._wanted_locked()
                if wanted != self._applied:
                    try:
                        result = self._setter(wanted)
                        self._error = '' if result else 'SetThreadExecutionState failed'
                    except Exception as exc:
                        result, self._error = 0, str(exc)
                    self._calls += 1
                    if result:
                        self._applied = wanted
                    self._cond.notify_all()
                    if not result:  # not applied: try again shortly instead of waiting for the next change
                        self._cond.wait(_RETRY)
                        continue
                self._cond.wait(_POLL if self._holds else None)

    def flush(self, timeout=5.0):
        """Wait until the owner thread has applied the current state (for tests); True when it has."""
        deadline = time.monotonic() + timeout
        with self._cond:
            self._cond.notify_all()
            while True:
                if self._setter is None or self._wanted_locked() == self._applied:
                    return True
                left = deadline - time.monotonic()
                if left <= 0:
                    return False
                self._cond.wait(min(left, 0.05))

    def status(self):
        with self._cond:
            self._purge_locked()
            return dict(count=len(self._holds), reasons=sorted(r for r, _ in self._holds.values()),
                        awake=bool(self._holds), applied=self._applied, calls=self._calls, error=self._error,
                        thread=bool(self._thread and self._thread.is_alive()))


DEFAULT = KeepAwake()


def hold(reason='', max_age=None):
    return DEFAULT.hold(reason, max_age)


def release(token):
    DEFAULT.release(token)


def status():
    return DEFAULT.status()


def holding(reason):
    """Decorator: the wrapped job keeps the PC awake while it runs."""
    def decorate(function):
        @functools.wraps(function)
        def wrapper(*args, **kwargs):
            with hold(reason):
                return function(*args, **kwargs)
        wrapper._keeps_awake = True
        return wrapper
    return decorate


# Core jobs that run for minutes: name -> what Windows shows as the reason.
CORE_JOBS = {'_run_add_folder_job': 'Importing music', '_run_health_scan_job': 'Health scan',
             '_run_year_research_job': 'Looking up release years', '_run_serato_connect_job': 'Reading the Serato library'}


def install(app):
    """Replace the core's macOS activity calls and hold the PC awake around its long library jobs."""
    if getattr(app, '_windows_keep_awake_installed', False):
        return
    app._begin_unified_macos_activity = lambda: hold('Library Health scan')  # core passes the result back to _end
    app._end_unified_macos_activity = lambda token=None: release(token) if token is not None else None
    for name, reason in CORE_JOBS.items():
        job = getattr(app, name, None)
        if callable(job) and not getattr(job, '_keeps_awake', False):
            setattr(app, name, holding(reason)(job))
    app._windows_keep_awake_installed = True
