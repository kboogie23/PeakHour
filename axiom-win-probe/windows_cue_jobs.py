"""Background jobs for the cue-point previews and writes (Serato and djay).

A preview or write over a whole library takes minutes, so it must never run on a request thread and never look frozen. A job
runs on its own worker thread in Windows background mode (low CPU and I/O priority), reports progress, can be cancelled, and
keeps its result for the page to fetch:

    job = start_job(lambda: preview(payload))     # returns at once
    snapshot(job_id) -> {'job_id', 'state': 'running'|'done'|'cancelled'|'failed', 'phase', 'done', 'total',
                         'current_title', 'result', 'error', 'code'}
    cancel(job_id)

Code that does the long work calls progress(done, total, title, phase) between songs; it yields the processor
(time.sleep(0)) and raises JobCancelled if the job was cancelled. Called outside a job it does nothing.
"""
import threading
import time
import uuid
from collections import OrderedDict

SYNC_LIMIT = 50  # a request for more songs than this (or for "all") runs as a background job
KEEP = 20  # finished jobs kept for the page to read
_ctx = threading.local()
_lock = threading.Lock()
_jobs = OrderedDict()


class JobCancelled(Exception):
    pass


class Job:
    def __init__(self, kind):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind
        self.state = 'running'
        self.phase = ''
        self.done = 0
        self.total = 0
        self.current_title = ''
        self.result = None
        self.error = ''
        self.code = ''
        self.cancel = threading.Event()
        self.created = time.time()


def is_big(payload):
    """True when this request is for the whole library or for more than SYNC_LIMIT songs."""
    tracks = payload.get('tracks', 'all') if isinstance(payload, dict) else payload
    return tracks is None or tracks == 'all' or (isinstance(tracks, list) and len(tracks) > SYNC_LIMIT)


def progress(done, total, title='', phase='', raise_on_cancel=True):
    """Report progress from inside a job (no-op elsewhere); lets other threads run; honours cancellation."""
    job = getattr(_ctx, 'job', None)
    if job is None:
        return
    job.done, job.total, job.current_title = done, total, str(title or '')
    if phase:
        job.phase = phase
    time.sleep(0)
    if raise_on_cancel and job.cancel.is_set():
        raise JobCancelled()


def cancelled():
    job = getattr(_ctx, 'job', None)
    return bool(job and job.cancel.is_set())


def _background_io():
    from windows_dj_write_queue import background_io
    return background_io()


def _run(job, work):
    _ctx.job = job
    try:
        with _background_io():
            job.result = work()
        job.state = 'cancelled' if job.cancel.is_set() and isinstance(job.result, dict) and job.result.get('cancelled') else 'done'
    except JobCancelled:
        job.state = 'cancelled'
    except Exception as exc:  # the page shows the message
        job.state, job.error, job.code = 'failed', str(exc) or exc.__class__.__name__, str(getattr(exc, 'code', 'error'))
    finally:
        _ctx.job = None


def start_job(kind, work):
    """Run work() on a worker thread; returns the job id. If a job of the same kind is already running, that one is returned."""
    with _lock:
        for job in _jobs.values():
            if job.kind == kind and job.state == 'running':
                return job.id
        job = Job(kind)
        _jobs[job.id] = job
        while len([j for j in _jobs.values() if j.state != 'running']) > KEEP:
            for old_id, old in list(_jobs.items()):
                if old.state != 'running':
                    del _jobs[old_id]
                    break
    threading.Thread(target=_run, args=(job, work), daemon=True, name=f'cue-job-{kind}').start()
    return job.id


def snapshot(job_id):
    job = _jobs.get(job_id)
    if job is None:
        return None
    return {'job_id': job.id, 'kind': job.kind, 'state': job.state, 'phase': job.phase, 'done': job.done, 'total': job.total,
            'current_title': job.current_title, 'result': job.result if job.state in ('done', 'cancelled') else None,
            'error': job.error, 'code': job.code}


def cancel(job_id):
    job = _jobs.get(job_id)
    if job is None or job.state != 'running':
        return False
    job.cancel.set()
    return True


def add_routes(bp, prefix, kind):
    """GET <prefix>/job/<id> and POST <prefix>/job/<id>/cancel on a blueprint."""
    from flask import jsonify

    @bp.get(f'{prefix}/job/<job_id>', endpoint=f'{kind}_job')
    def job_route(job_id):
        state = snapshot(job_id)
        if state is None or not state['kind'].startswith(kind):
            return jsonify(success=False, error='There is no such job.', code='bad_request'), 404
        return jsonify(success=True, **state)

    @bp.post(f'{prefix}/job/<job_id>/cancel', endpoint=f'{kind}_job_cancel')
    def cancel_route(job_id):
        state = snapshot(job_id)
        if state is None or not state['kind'].startswith(kind):
            return jsonify(success=False, error='There is no such job.', code='bad_request'), 404
        return jsonify(success=cancel(job_id), state=state['state'])
