"""DJ write queue: a crate/playlist/cue write aimed at VirtualDJ, Serato or djay while that program is open waits,
and is applied by a background watcher once the program has been closed for a while and its files have settled.
If the program is not running the write is applied at once.

The writers registered here already back up, re-check that the program is closed, verify and offer undo; the queue
only decides WHEN they run. Before a queued job runs, its preview is rebuilt: if it no longer matches what the owner
approved the job becomes 'needs_review' and nothing is written. The queue never opens a DJ program's files while the
program is running (the settle check only stats files after it has closed) and never creates a window: processes are
listed with the Toolhelp snapshot of windows_serato_processes (no tasklist/powershell).
"""
import contextlib
import json
import ntpath
import os
import threading
import time
import uuid
from pathlib import Path

PROGRAMS = ('virtualdj', 'serato', 'djay')
STATUSES = ('queued', 'applying', 'done', 'failed', 'needs_review', 'cancelled')
EXECUTABLES = {  # lower-case names, as in windows_virtualdj_lists / windows_serato_processes / windows_djay
    'virtualdj': ('virtualdj.exe',),
    'serato': ('serato dj pro.exe', 'serato dj lite.exe', 'serato studio.exe'),
    'djay': ('djayapp.exe', 'djay pro.exe'),
}
CLOSED_SECONDS = 15  # a program must have been closed this long before its jobs run
POLL_SECONDS = 5
MAX_FAILURES = 5  # a file in use (sharing violation) is retried this many times, then the job is 'failed'
RETRY_BACKOFF_SECONDS = 30  # extra wait per retry, on top of the closed period
KEEP_FINISHED = 200
LIST_LIMIT = 50


class QueueError(Exception):
    pass


def default_snapshot():
    from windows_serato_processes import snapshot_processes
    return snapshot_processes()


class FileSettle:
    """True once the files under `paths_fn()` have the same (name, size, mtime) on two consecutive calls and no
    non-empty -wal/-journal sits next to a database. Only stats files, never opens them."""

    def __init__(self, paths_fn):
        self.paths_fn = paths_fn
        self.last = None

    def reset(self):
        self.last = None

    def signature(self):
        sig = []
        for item in self.paths_fn():
            path = Path(item)
            files = [path] if path.is_file() else sorted(p for p in path.iterdir() if p.is_file()) if path.is_dir() else []
            for file in files:
                try:
                    stat = file.stat()
                except OSError:
                    return None
                if file.name.lower().endswith(('-wal', '-journal')) and stat.st_size > 0:
                    return None
                sig.append((str(file), stat.st_size, stat.st_mtime_ns))
        return tuple(sig)

    def __call__(self):
        try:
            current = self.signature()
        except OSError:
            current = None
        stable = current is not None and current == self.last
        self.last = current
        return stable


def _drive_roots():
    try:
        from windows_serato_paths import local_drive_roots
        return list(local_drive_roots())
    except Exception:
        return []


def serato_folders(env=os.environ):
    """Every Serato library folder found: the home ones and a _Serato_ folder on each local drive."""
    local = Path(env.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local')
    home = Path(env.get('USERPROFILE') or Path.home())
    found = [local / 'Serato' / 'Library', home / 'Music' / '_Serato_']
    found += [Path(root, '_Serato_') for root in _drive_roots()]
    return [path for path in found if path.is_dir()]


def djay_folders(env=os.environ):
    """djay's library folders: 'djay Media Library' and any *.djayMediaLibrary under Music\\djay."""
    home = Path(env.get('USERPROFILE') or Path.home())
    try:
        return [p for p in sorted((home / 'Music' / 'djay').iterdir())
                if p.is_dir() and (p.name == 'djay Media Library' or p.name.endswith('.djayMediaLibrary'))]
    except OSError:
        return []


def default_settles(env=os.environ):
    """Per-program settle checks over the libraries actually found (stat only)."""
    local = Path(env.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local')
    home = Path(env.get('USERPROFILE') or Path.home())
    return {
        'virtualdj': FileSettle(lambda: [local / 'VirtualDJ', home / 'Documents' / 'VirtualDJ']),
        'serato': FileSettle(lambda: serato_folders(env)),
        'djay': FileSettle(lambda: djay_folders(env)),
    }


@contextlib.contextmanager
def background_io():
    """Run the block at background I/O and CPU priority (Windows THREAD_MODE_BACKGROUND), so a write never competes
    with a live set. Silently does nothing where it is not available."""
    end = None
    try:
        import ctypes
        kernel = ctypes.WinDLL('kernel32')
        kernel.GetCurrentThread.restype = ctypes.c_void_p
        kernel.SetThreadPriority.argtypes = [ctypes.c_void_p, ctypes.c_int]
        thread = kernel.GetCurrentThread()
        if kernel.SetThreadPriority(thread, 0x00010000):  # THREAD_MODE_BACKGROUND_BEGIN
            end = lambda: kernel.SetThreadPriority(thread, 0x00020000)  # THREAD_MODE_BACKGROUND_END
    except Exception:
        pass
    try:
        yield
    finally:
        if end:
            end()


class DJWriteQueue:
    def __init__(self, path, snapshot=default_snapshot, clock=time.monotonic, wall=time.time, settles=None,
                 closed_seconds=CLOSED_SECONDS, poll_seconds=POLL_SECONDS):
        self.path = Path(path)
        self.snapshot = snapshot
        self.clock = clock
        self.wall = wall
        self.settles = settles if settles is not None else default_settles()
        self.closed_seconds = closed_seconds
        self.poll_seconds = poll_seconds
        self.appliers = {}
        self.lock = threading.RLock()
        self.program_locks = {}
        self.closed_since = {}
        self.stop_event = threading.Event()
        self.thread = None
        self.jobs = self._load()

    # ---------------------------------------------------------------- storage
    def _load(self):
        try:
            data = json.loads(self.path.read_text(encoding='utf-8'))
            jobs = [j for j in data['jobs'] if isinstance(j, dict) and j.get('program') in PROGRAMS]
        except FileNotFoundError:
            return []
        except (OSError, ValueError, KeyError, TypeError):
            try:  # unreadable: keep it for inspection, start empty
                os.replace(self.path, self.path.with_name(self.path.name + '.corrupt'))
            except OSError:
                pass
            return []
        changed = False
        for job in jobs:
            if job.get('status') == 'applying':  # a crash mid-apply: the writers are transactional/verified
                job['status'] = 'queued'
                job['message'] = 'Re-queued after PEAK HOUR restarted.'
                changed = True
        if changed:
            self.jobs = jobs
            self._save()
        return jobs

    def _save(self):
        finished = [j for j in self.jobs if j['status'] not in ('queued', 'applying')]
        if len(finished) > KEEP_FINISHED:
            drop = {id(j) for j in finished[:len(finished) - KEEP_FINISHED]}
            self.jobs = [j for j in self.jobs if id(j) not in drop]
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_name(f'{self.path.name}.{os.getpid()}.tmp')
        with open(temp, 'w', encoding='utf-8') as handle:
            json.dump({'version': 1, 'jobs': self.jobs}, handle, indent=1)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, self.path)

    # ---------------------------------------------------------------- api
    def register(self, program, kind, apply_fn, preview_fn=None):
        if program not in PROGRAMS:
            raise ValueError(f'Unknown program {program!r}')
        self.appliers[(program, kind)] = (apply_fn, preview_fn)

    def program_lock(self, program):
        """One lock per program: a direct write and the watcher's write for the same program never run together."""
        with self.lock:
            return self.program_locks.setdefault(program, threading.RLock())

    def running_programs(self):
        """The set of DJ programs that are open (one process listing). Fails closed: if processes cannot be listed
        every program counts as open."""
        try:
            names = {ntpath.basename(exe).casefold() for _, exe in self.snapshot()}
        except Exception:
            return set(PROGRAMS)
        return {program for program in PROGRAMS if names & set(EXECUTABLES[program])}

    def is_running(self, program):
        """True if the program is open."""
        return program in self.running_programs()

    def submit(self, program, kind, payload):
        if (program, kind) not in self.appliers:
            raise QueueError(f'No writer is registered for {program} {kind}.')
        apply_fn, preview_fn = self.appliers[(program, kind)]
        with self.program_lock(program):
            if not self.is_running(program):
                return {'queued': False, 'applied': True, 'result': apply_fn(payload)}
        digest = preview_fn(payload) if preview_fn else None
        job = {'id': uuid.uuid4().hex[:12], 'program': program, 'kind': kind, 'payload': payload,
               'preview_digest': digest, 'created_at': self.wall(), 'status': 'queued',
               'message': 'Waiting for the program to close.'}
        with self.lock:
            self.jobs.append(job)
            self._save()
        return {'queued': True, 'id': job['id']}

    def enqueue(self, program, kind, payload):
        """Add a job WITHOUT applying it now: the watcher runs it once no DJ program is open. Takes no program lock, so a caller
        that could not write right now can hand its job over without any risk of waiting on a lock it already holds."""
        if (program, kind) not in self.appliers:
            raise QueueError(f'No writer is registered for {program} {kind}.')
        preview_fn = self.appliers[(program, kind)][1]
        job = {'id': uuid.uuid4().hex[:12], 'program': program, 'kind': kind, 'payload': payload,
               'preview_digest': preview_fn(payload) if preview_fn else None, 'created_at': self.wall(), 'status': 'queued',
               'message': 'Waiting for the program to close.'}
        with self.lock:
            self.jobs.append(job)
            self._save()
        return {'queued': True, 'id': job['id']}

    def list(self, limit=LIST_LIMIT):
        with self.lock:
            return [dict(j) for j in reversed(self.jobs)][:limit]

    def public_list(self, limit=LIST_LIMIT):
        """What the page needs to show a job: no payloads (they can hold thousands of paths)."""
        rows = []
        for job in self.list(limit):
            payload = job.get('payload')
            tracks = payload.get('tracks') if isinstance(payload, dict) else None
            rows.append({'id': job['id'], 'program': job['program'], 'kind': job['kind'], 'status': job['status'],
                         'message': job.get('message', ''), 'created_at': job.get('created_at'),
                         'tracks': len(tracks) if isinstance(tracks, list) else tracks})
        return rows

    def cancel(self, job_id):
        with self.lock:
            for job in self.jobs:
                if job['id'] == job_id:
                    if job['status'] != 'queued':
                        return False
                    job['status'] = 'cancelled'
                    job['message'] = 'Cancelled.'
                    self._save()
                    return True
        return False

    # ---------------------------------------------------------------- watcher
    def tick(self):
        """One poll. With nothing queued this touches neither the disk nor the process list."""
        with self.lock:
            programs = {j['program'] for j in self.jobs if j['status'] == 'queued'}
        if not programs:
            self.closed_since.clear()
            return
        now = self.clock()
        if self.running_programs():  # nothing may stall a live set: no write runs while ANY DJ program is open
            for program in PROGRAMS:
                self.closed_since.pop(program, None)
                getattr(self.settles.get(program), 'reset', lambda: None)()
            return
        for program in PROGRAMS:
            if program not in programs:
                self.closed_since.pop(program, None)
                continue
            since = self.closed_since.setdefault(program, now)
            if now - since < self.closed_seconds:
                continue
            settle = self.settles.get(program)
            if settle is not None and not settle():
                continue
            self._apply_program(program)

    def _apply_program(self, program):
        with self.lock:
            todo = [j for j in self.jobs if j['program'] == program and j['status'] == 'queued']
        for job in todo:
            if self.running_programs():  # any program reopened while applying earlier jobs: stop and wait again
                self.closed_since.clear()
                return
            with self.program_lock(program):
                with self.lock:
                    if job['status'] != 'queued':
                        continue
                    pair = self.appliers.get((program, job['kind']))
                    if pair is None:
                        continue  # the writer is not registered yet; stays queued
                    job['status'] = 'applying'
                    job['message'] = 'Applying.'
                    self._save()
                apply_fn, preview_fn = pair
                try:
                    with background_io():
                        stale = preview_fn is not None and job.get('preview_digest') != preview_fn(job['payload'])
                        if stale:
                            status, message = 'needs_review', 'The library changed while waiting; review and send it again.'
                        else:
                            result = apply_fn(job['payload'])
                            status = 'done'
                            message = result.get('message') if isinstance(result, dict) and result.get('message') else 'Applied.'
                except Exception as exc:
                    message = str(exc) or exc.__class__.__name__
                    if str(getattr(exc, 'code', '')).endswith('_open'):  # the program was opened again: wait for it
                        status, message = 'queued', 'Waiting for the program to close.'
                        self.closed_since.pop(program, None)
                    elif str(getattr(exc, 'code', '')) in ('stale', 'changed'):  # what was approved is no longer true
                        status, message = 'needs_review', message + ' Review it and send it again.'
                    elif isinstance(exc, OSError) and getattr(exc, 'winerror', None) in (32, 33):  # file in use: transient
                        job['failures'] = job.get('failures', 0) + 1
                        if job['failures'] < MAX_FAILURES:
                            status = 'queued'
                            message = f'A file is in use; will try again ({job["failures"]} of {MAX_FAILURES}): {message}'
                            self.closed_since.pop(program, None)
                            self.closed_since[program] = self.clock() + RETRY_BACKOFF_SECONDS * job['failures']  # waits longer each time
                        else:
                            status = 'failed'
                    else:  # verify_failed, write_failed, ...: never retried blindly; the message is shown as it is
                        status = 'failed'
                with self.lock:
                    job['status'] = status
                    job['message'] = message
                    self._save()
            if status == 'queued':
                return  # stop this round; the next one waits out the closed period again

    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive():
                return self
            self.stop_event.clear()
            self.thread = threading.Thread(target=self._run, name='dj-write-queue', daemon=True)
            self.thread.start()
        return self

    def stop(self):
        self.stop_event.set()

    def _run(self):
        while not self.stop_event.wait(self.poll_seconds):
            try:
                self.tick()
            except Exception:
                pass  # the next poll tries again


QUEUE = None


def get_queue(path=None, **kwargs):
    """The process-wide queue (created on first call with a path)."""
    global QUEUE
    if QUEUE is None:
        if path is None:
            raise QueueError('The DJ write queue has not been created.')
        QUEUE = DJWriteQueue(path, **kwargs)
    return QUEUE


def register(program, kind, apply_fn, preview_fn=None):
    return get_queue().register(program, kind, apply_fn, preview_fn)


def submit(program, kind, payload):
    return get_queue().submit(program, kind, payload)


@contextlib.contextmanager
def program_locked(program):
    """Hold the shared lock for `program` (undo routes use this so an undo never runs during a write)."""
    queue = QUEUE
    if queue is None:
        yield
    else:
        with queue.program_lock(program):
            yield


def queue_if_open(program, kind, payload, label, direct=None):
    """For an apply route: if `program` is open and a writer is registered, queue the write and return
    (body, 202); if it closed meanwhile and the queue applied it, (body, 200). When it is closed, `direct()` (the
    route's own write) runs under the program's lock, so it never overlaps the watcher's write, and (body, 200) is
    returned. None means: write directly yourself (no `direct` given, or no queue in this process)."""
    queue = QUEUE
    if queue is None or (program, kind) not in queue.appliers:
        return None if direct is None else (direct(), 200)
    with queue.program_lock(program):
        if queue.is_running(program):
            outcome = queue.submit(program, kind, payload)
            if outcome.get('queued'):
                return {'success': True, 'queued': True, 'id': outcome['id'],
                        'message': f'{label} is open \u2014 PEAK HOUR will write this after you close it.'}, 202
            return dict(outcome['result'], queued=False), 200
        return None if direct is None else (direct(), 200)


def installed_programs(env=os.environ):
    """Which DJ programs have a library on this PC (folder checks only; nothing is opened)."""
    local = Path(env.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local')
    home = Path(env.get('USERPROFILE') or Path.home())

    def serato():
        if (local / 'Serato' / 'Library').is_dir() or (home / 'Music' / '_Serato_').is_dir():
            return True
        return any(os.path.isdir(os.path.join(root, '_Serato_')) for root in _drive_roots())
    return {
        'virtualdj': any((base / 'VirtualDJ' / 'settings.xml').is_file() for base in (local, home / 'Documents')),
        'serato': serato(),
        'djay': (home / 'Music' / 'djay' / 'djay Media Library').is_dir(),
    }


def create_blueprint(queue, installed=installed_programs):
    from flask import Blueprint, jsonify, request
    bp = Blueprint('windows_dj_write_queue', __name__)

    @bp.get('/api/windows/dj-queue/programs')
    def dj_queue_programs():
        found = installed()
        return jsonify({'programs': [{'id': name, 'installed': bool(found.get(name)), 'running': queue.is_running(name)}
                                     for name in PROGRAMS]})

    @bp.get('/api/windows/dj-queue/list')
    def dj_queue_list():
        return jsonify({'jobs': queue.public_list()})

    @bp.post('/api/windows/dj-queue/cancel')
    def dj_queue_cancel():
        body = request.get_json(silent=True)
        job_id = body.get('id') if isinstance(body, dict) else None
        if not isinstance(job_id, str) or not queue.cancel(job_id):
            return jsonify({'ok': False, 'error': 'Only a waiting job can be cancelled.'}), 409
        return jsonify({'ok': True})
    return bp
