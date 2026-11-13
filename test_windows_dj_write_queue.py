"""DJ write queue: apply at once when the program is closed; queue while open; apply after 15 s closed and settled;
stale previews need review; crash recovery; cancel; atomic storage; routes; idle watcher does no I/O."""
import builtins
import json
import os
import sys
import tempfile
from pathlib import Path

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parent / 'axiom-win-probe'))
import windows_dj_write_queue as Q
from windows_remote_hub import blocked

failures = []


def check(name, condition):
    print(('PASS ' if condition else 'FAIL ') + name)
    if not condition:
        failures.append(name)


class World:
    def __init__(self):
        self.now = 0.0
        self.running = set()
        self.polls = 0
        self.settled = True

    def snapshot(self):
        self.polls += 1
        return [(1, 'explorer.exe')] + [(2, {'virtualdj': 'C:\\VirtualDJ\\VirtualDJ.exe', 'serato': 'Serato DJ Pro.exe',
                                              'djay': 'djayapp.exe'}[p]) for p in self.running]

    def clock(self):
        return self.now

    def advance(self, queue, seconds, step=5):
        for _ in range(int(seconds // step)):
            self.now += step
            queue.tick()


def make(tmp, world, name='q.json'):
    applied, digest = [], {'value': 'd1'}
    queue = Q.DJWriteQueue(Path(tmp) / name, snapshot=world.snapshot, clock=world.clock, wall=lambda: 1000.0,
                           settles={'virtualdj': lambda: world.settled})

    def apply_fn(payload):
        applied.append(payload)
        return {'message': 'Wrote ' + payload['name']}
    queue.register('virtualdj', 'crate', apply_fn, lambda payload: digest['value'])
    return queue, applied, digest


with tempfile.TemporaryDirectory() as tmp:
    # (a) closed: applies at once
    w = World()
    q, applied, digest = make(tmp, w, 'a.json')
    result = q.submit('virtualdj', 'crate', {'name': 'A'})
    check('a: applied at once', result['queued'] is False and applied == [{'name': 'A'}] and q.list() == [])

    # (b) open -> queued -> closes -> 15 s -> applied
    w = World(); w.running = {'virtualdj'}
    q, applied, digest = make(tmp, w, 'b.json')
    result = q.submit('virtualdj', 'crate', {'name': 'B'})
    check('b: queued', result['queued'] is True and not applied and q.list()[0]['status'] == 'queued')
    w.advance(q, 30)
    check('b: not applied while open', not applied)
    w.running = set()
    w.advance(q, 10)
    check('b: not applied before 15 s closed', not applied)
    w.advance(q, 15)
    job = q.list()[0]
    check('b: applied after settle, status done', applied == [{'name': 'B'}] and job['status'] == 'done' and 'Wrote B' in job['message'])

    # (c) reopens during settle
    w = World(); w.running = {'virtualdj'}
    q, applied, digest = make(tmp, w, 'c.json')
    q.submit('virtualdj', 'crate', {'name': 'C'})
    w.running = set(); w.settled = False
    w.advance(q, 30)
    w.running = {'virtualdj'}
    w.advance(q, 20)
    w.running = set(); w.settled = True
    w.advance(q, 10)
    check('c: not applied right after the program closes again', not applied)
    w.advance(q, 15)
    check('c: applied once closed again', applied == [{'name': 'C'}])

    # (d) stale preview
    w = World(); w.running = {'virtualdj'}
    q, applied, digest = make(tmp, w, 'd.json')
    q.submit('virtualdj', 'crate', {'name': 'D'})
    digest['value'] = 'changed'
    w.running = set()
    w.advance(q, 40)
    check('d: needs_review, apply not called', not applied and q.list()[0]['status'] == 'needs_review')

    # (e) crash mid-apply
    w = World(); w.running = {'virtualdj'}
    q, applied, digest = make(tmp, w, 'e.json')
    q.submit('virtualdj', 'crate', {'name': 'E'})
    data = json.loads((Path(tmp) / 'e.json').read_text())
    data['jobs'][0]['status'] = 'applying'
    (Path(tmp) / 'e.json').write_text(json.dumps(data))
    w.running = set()
    q2, applied2, _ = make(tmp, w, 'e.json')
    check('e: re-queued on restart', q2.list()[0]['status'] == 'queued')
    w.advance(q2, 60)
    check('e: applied exactly once', applied2 == [{'name': 'E'}] and q2.list()[0]['status'] == 'done')

    # (f) cancel
    w = World(); w.running = {'virtualdj'}
    q, applied, digest = make(tmp, w, 'f.json')
    job_id = q.submit('virtualdj', 'crate', {'name': 'F'})['id']
    check('f: cancel queued', q.cancel(job_id) is True and q.list()[0]['status'] == 'cancelled')
    check('f: cancel again refused', q.cancel(job_id) is False and q.cancel('nope') is False)
    w.running = set()
    w.advance(q, 60)
    check('f: cancelled job never applied', not applied)

    # (g) atomic file, reloads
    w = World(); w.running = {'virtualdj'}
    q, applied, digest = make(tmp, w, 'g.json')
    q.submit('virtualdj', 'crate', {'name': 'G'})
    leftovers = [p.name for p in Path(tmp).glob('g.json*') if p.name != 'g.json']
    reloaded = Q.DJWriteQueue(Path(tmp) / 'g.json', snapshot=w.snapshot, clock=w.clock)
    check('g: valid JSON, no temp left, reloads', not leftovers and reloaded.list()[0]['payload'] == {'name': 'G'}
          and json.loads((Path(tmp) / 'g.json').read_text())['jobs'][0]['status'] == 'queued')

    # (h) routes
    w = World(); w.running = {'virtualdj'}
    q, applied, digest = make(tmp, w, 'h.json')
    job_id = q.submit('virtualdj', 'crate', {'name': 'H'})['id']
    app = Flask(__name__)
    app.register_blueprint(Q.create_blueprint(q))
    client = app.test_client()
    listed = client.get('/api/windows/dj-queue/list').get_json()['jobs']
    check('h: list', len(listed) == 1 and listed[0]['id'] == job_id)
    check('h: cancel bad id', client.post('/api/windows/dj-queue/cancel', json={'id': 'x'}).status_code == 409)
    check('h: cancel', client.post('/api/windows/dj-queue/cancel', json={'id': job_id}).get_json() == {'ok': True})
    check('h: laptops blocked', blocked('/api/windows/dj-queue/list') and blocked('/api/windows/dj-queue/cancel'))

    # (i) idle watcher: no file I/O, no process listing
    w = World()
    q, applied, digest = make(tmp, w, 'i.json')
    opened = []
    real_open = builtins.open
    real_replace = os.replace
    builtins.open = lambda *a, **k: (opened.append(a), real_open(*a, **k))[1]
    os.replace = lambda *a, **k: (opened.append(a), real_replace(*a, **k))[1]
    try:
        for _ in range(1000):
            w.now += 5
            q.tick()
    finally:
        builtins.open = real_open
        os.replace = real_replace
    check('i: 1000 idle polls do no file I/O or process listing', not opened and w.polls == 0)

    # (j) nothing may stall a live set: a job waits while ANY DJ program is open, not just its own
    w = World(); w.running = {'virtualdj'}
    q, applied, digest = make(tmp, w, 'j.json')
    q.submit('virtualdj', 'crate', {'name': 'J'})
    w.running = {'serato'}
    w.advance(q, 120)
    check('j: not applied while another DJ program plays', not applied and q.list()[0]['status'] == 'queued')
    w.running = set()
    w.advance(q, 10)
    check('j: still waits the closed period after it ends', not applied)
    w.advance(q, 15)
    check('j: applied once every program is closed', applied == [{'name': 'J'}])
    unlistable = World()
    unlistable.snapshot = lambda: (_ for _ in ()).throw(OSError('no list'))
    q3 = Q.DJWriteQueue(Path(tmp) / 'j2.json', snapshot=unlistable.snapshot, clock=w.clock)
    check('j: an unreadable process list counts every program as open', q3.running_programs() == set(Q.PROGRAMS))

    # (k) a writer that says the program is open puts the job back; other failures are retried 5 times
    w = World(); w.running = {'virtualdj'}
    calls = []

    class Open(Exception):
        code = 'virtualdj_open'

    def flaky(payload):
        calls.append(1)
        if len(calls) == 1:
            raise Open('Quit VirtualDJ first.')
        return {'message': 'Wrote it'}
    q = Q.DJWriteQueue(Path(tmp) / 'k.json', snapshot=w.snapshot, clock=w.clock, wall=lambda: 1000.0,
                       settles={'virtualdj': lambda: True})
    q.register('virtualdj', 'crate', flaky, lambda payload: 'd')
    q.submit('virtualdj', 'crate', {'name': 'K'})
    w.running = set()
    w.advance(q, 20)
    check('k: *_open puts the job back to queued', len(calls) == 1 and q.list()[0]['status'] == 'queued'
          and 'close' in q.list()[0]['message'] and 'failures' not in q.list()[0])
    w.advance(q, 40)
    check('k: and it is applied after the next closed period', len(calls) == 2 and q.list()[0]['status'] == 'done')
    def run_failing(name, make_error):
        calls_ = []

        def fail(payload):
            calls_.append(1)
            raise make_error()
        w_ = World(); w_.running = {'virtualdj'}
        q_ = Q.DJWriteQueue(Path(tmp) / (name + '.json'), snapshot=w_.snapshot, clock=w_.clock, wall=lambda: 1000.0,
                            settles={'virtualdj': lambda: True})
        q_.register('virtualdj', 'crate', fail, None)
        q_.submit('virtualdj', 'crate', {'name': name})
        w_.running = set()
        w_.advance(q_, 1500)
        return len(calls_), q_.list()[0]

    class Coded(Exception):
        def __init__(self, code, text):
            super().__init__(text)
            self.code = code
    n, job = run_failing('k-verify', lambda: Coded('verify_failed', 'The cues did not read back as written.'))
    check('k: verify_failed -> failed at once, no retry, message kept', n == 1 and job['status'] == 'failed'
          and job['message'] == 'The cues did not read back as written.')
    n, job = run_failing('k-write', lambda: Coded('write_failed', 'could not put the library back'))
    check('k: write_failed -> failed at once', n == 1 and job['status'] == 'failed')
    n, job = run_failing('k-plain', lambda: RuntimeError('disk full'))
    check('k: an unknown error -> failed at once', n == 1 and job['status'] == 'failed' and 'disk full' in job['message'])
    n, job = run_failing('k-stale', lambda: Coded('stale', 'changed since the preview'))
    check('k: stale -> needs_review, not retried', n == 1 and job['status'] == 'needs_review')
    n, job = run_failing('k-changed', lambda: Coded('changed', 'djay changed its library'))
    check('k: changed -> needs_review, not retried', n == 1 and job['status'] == 'needs_review')

    def sharing():
        error = PermissionError(13, 'The process cannot access the file')
        error.winerror = 32
        return error
    n, job = run_failing('k-share', sharing)
    check('k: a file in use is retried with backoff, 5 times, then failed', n == Q.MAX_FAILURES and job['status'] == 'failed')

    # (l) one lock per program: a direct write and the watcher's write never overlap
    import threading
    import time as _time
    w = World(); w.running = {'virtualdj'}
    state = {'active': 0, 'most': 0}
    release = threading.Event()

    def slow(payload):
        state['active'] += 1
        state['most'] = max(state['most'], state['active'])
        release.wait(5)
        state['active'] -= 1
        return {'message': 'Wrote ' + payload['name']}
    q = Q.DJWriteQueue(Path(tmp) / 'l.json', snapshot=w.snapshot, clock=w.clock, wall=lambda: 1000.0, settles={})
    q.register('virtualdj', 'crate', slow, lambda payload: 'd')
    q.submit('virtualdj', 'crate', {'name': 'queued'})
    w.running = set()
    w.now = 100.0
    q.closed_since['virtualdj'] = 0.0
    direct = threading.Thread(target=lambda: q.submit('virtualdj', 'crate', {'name': 'direct'}))
    direct.start()
    _time.sleep(0.3)
    watcher = threading.Thread(target=q.tick)
    watcher.start()
    _time.sleep(0.5)
    check('l: watcher waits while a direct write holds the program lock', state['active'] == 1 and state['most'] == 1)
    release.set()
    direct.join(5)
    watcher.join(5)
    check('l: both writes ran, one at a time', state['most'] == 1 and q.list()[0]['status'] == 'done')
    Q.QUEUE = q
    outcome = Q.queue_if_open('virtualdj', 'crate', {'name': 'Z'}, 'VirtualDJ', lambda: {'direct': True})
    check('l: queue_if_open runs the route write under the lock when the program is closed',
          outcome == ({'direct': True}, 200))
    w.running = {'virtualdj'}
    body, status = Q.queue_if_open('virtualdj', 'crate', {'name': 'Z'}, 'VirtualDJ', lambda: {'direct': True})
    check('l: queue_if_open queues (202) when it is open', status == 202 and body['queued'] and 'open \u2014 PEAK HOUR' in body['message'])
    Q.QUEUE = None

    # (m) the list the page polls carries no payloads
    w = World(); w.running = {'virtualdj'}
    q, applied, digest = make(tmp, w, 'm.json')
    q.submit('virtualdj', 'crate', {'name': 'M', 'tracks': ['C:\\a.mp3'] * 3})
    app = Flask(__name__)
    app.register_blueprint(Q.create_blueprint(q))
    row = app.test_client().get('/api/windows/dj-queue/list').get_json()['jobs'][0]
    check('m: list has no payload, only id/program/kind/status/message/created/track count',
          'payload' not in row and row['tracks'] == 3 and set(row) == {'id', 'program', 'kind', 'status', 'message', 'created_at', 'tracks'})
    check('m: settle folders come from the libraries found', callable(Q.serato_folders) and callable(Q.djay_folders))

print('FAILED: ' + ', '.join(failures) if failures else 'ALL PASS')
sys.exit(1 if failures else 0)
