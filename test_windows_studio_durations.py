"""Magic Set rows show real song lengths (windows_studio_durations): the Studio answers that omit duration_sec get it from the
library record of each track path, and nothing else in the answer changes.

Checks, on a stand-in server (the compiled routes' answers are canned; the real routes are proven in test_windows_magic_set.py):
  * the five routes (generate_from_curve, build_around_tracks, autofill, generate_from_anchor, optimize) get duration_sec on every
    listed track the library knows, by exact path and by another spelling of the path (case, slashes);
  * a track that already has a positive duration_sec, a track the library does not know, and a library record without
    duration_sec are left exactly as they were; every other key of the answer is identical;
  * other routes, GET requests, error answers and non-JSON answers are passed through byte for byte;
  * a library that cannot be read, or a broken index, passes the answer through byte for byte;
  * 60 songs on a 50,000-song library: the library is read once (a dict), a 60-song answer is filled in well under 50 ms, and a
    changed library file is picked up on the next answer."""
import json
import os
import shutil
import sys
import tempfile
import time
import traceback
from pathlib import Path

workspace = Path(__file__).resolve().parent
sys.path.insert(0, str(workspace / 'axiom-win-probe'))
import windows_studio_durations as D  # noqa: E402
from flask import Flask, Response, jsonify  # noqa: E402

base = Path(tempfile.mkdtemp(prefix='phdur'))


class Stub:
    """The little of AXIOM's app module the hook uses."""
    def __init__(self, cache_path):
        self.CACHE_PATH = str(cache_path)
        self.app = Flask('durations')
        self.reads = 0

    def load_cache(self, path):
        self.reads += 1
        return json.loads(Path(path).read_text('utf-8'))

    def _all_library_cache_tracks(self, cache):
        return cache.get('tracks') or []


def write_library(path, tracks):
    Path(path).write_text(json.dumps({'tracks': tracks, 'total_tracks': len(tracks)}), 'utf-8')


def track(i, **extra):
    return dict({'path': 'C:\\Music\\Set\\song-%05d.mp3' % i, 'title': 'Song %d' % i, 'bpm': 120 + i % 10, 'camelot': '8A', 'energy': 'Mid'}, **extra)


try:
    cache = base / 'library_cache.json'
    library = [track(i, duration_sec=180 + i % 100) for i in range(50000)]
    library[10] = track(10)                                   # a record without duration_sec
    library[11] = track(11, duration_sec=0)                   # a record with a useless one
    library[12] = dict(track(12), duration=300)               # only the old key: the page ignores it, so does the fill
    write_library(cache, library)
    stub = Stub(cache)
    D.install(stub)
    assert stub.app._windows_studio_durations and stub.WINDOWS_DURATION_INDEX
    D.install(stub)  # twice is harmless
    assert len(stub.app.after_request_funcs[None]) == 1

    answers = {}
    wanted = [track(i) for i in (3, 500, 49999)]

    def make_route(path, key, extra):
        def route():
            body = dict(extra)
            body[key] = json.loads(json.dumps(answers.get(path, wanted)))
            return jsonify(body)
        stub.app.add_url_rule(path, path, route, methods=['GET', 'POST'])
    for path, key in D.ROUTES.items():
        make_route(path, key[0], {'access_tier': 'pro', 'count': 3, 'track_limit': None, 'message': 'Kept 3 tracks', 'nested': {'tracks': [{'path': library[3]['path']}]}})
    stub.app.add_url_rule('/api/studio/audit', 'audit', lambda: jsonify(tracks=[track(3)]), methods=['POST'])
    stub.app.add_url_rule('/api/other', 'other', lambda: Response('{"tracks": [{"path": "' + library[3]['path'].replace('\\', '\\\\') + '"}]}', mimetype='application/json'), methods=['POST'])
    stub.app.add_url_rule('/api/studio/autofill-text', 'text', lambda: Response('plain', mimetype='text/plain'), methods=['POST'])
    stub.app.add_url_rule('/api/studio/generate_from_anchor-err', 'err', lambda: (jsonify(error='nope', tracks=[track(3)]), 400), methods=['POST'])
    stub.app.add_url_rule('/api/studio/broken-json', 'brk', lambda: Response('{"tracks": [oops', mimetype='application/json'), methods=['POST'])
    stub.app.add_url_rule('/api/studio/plain', 'plain60', lambda: jsonify(playlist=[track(i * 700) for i in range(60)]), methods=['POST'])
    streamed_body = '{"tracks": [{"path": "' + library[3]['path'].replace('\\', '\\\\') + '"}]}'
    stub.app.add_url_rule('/api/studio/streamed', 'streamed', lambda: Response((part for part in (streamed_body[:10], streamed_body[10:])),
                                                                             mimetype='application/json'), methods=['POST'])
    client = stub.app.test_client()

    # 1. every route fills duration_sec; the rest of the answer is untouched
    for path, (key,) in D.ROUTES.items():
        got = client.post(path).get_json()
        expected = json.loads(json.dumps({'access_tier': 'pro', 'count': 3, 'track_limit': None, 'message': 'Kept 3 tracks',
                                          'nested': {'tracks': [{'path': library[3]['path']}]}, key: wanted}))
        for item, i in zip(expected[key], (3, 500, 49999)):
            item['duration_sec'] = library[i]['duration_sec']
        assert got == expected, (path, got)
    assert stub.reads == 1, stub.reads  # the library is read once for all five answers
    assert stub.app.test_client().get('/api/studio/autofill').status_code == 200

    # 2. what must not change
    answers['/api/studio/generate_from_curve'] = [track(3, duration_sec=99), track(10), track(11, duration_sec=0), track(12), track(7, duration_sec='bad'),
                                                  {'path': 'C:\\Elsewhere\\unknown.mp3', 'title': 'Not in the library'}, {'title': 'no path'}, 'not a track',
                                                  track(5, duration_sec=0, duration_min=4), track(6, duration_sec=-5)]
    got = client.post('/api/studio/generate_from_curve').get_json()['tracks']
    assert got[0]['duration_sec'] == 99, 'an existing positive duration_sec must be kept'
    assert 'duration_sec' not in got[1] and got[2]['duration_sec'] == 0 and 'duration_sec' not in got[3], got[1:4]  # library has none: nothing invented
    assert got[3]['path'] == library[12]['path'] and 'duration' not in got[3], got[3]
    assert got[4]['duration_sec'] == library[7]['duration_sec'], got[4]  # a useless value is replaced by the library's
    assert got[5] == {'path': 'C:\\Elsewhere\\unknown.mp3', 'title': 'Not in the library'} and got[6] == {'title': 'no path'} and got[7] == 'not a track'
    assert got[8]['duration_sec'] == library[5]['duration_sec'] and got[8]['duration_min'] == 4 and got[9]['duration_sec'] == library[6]['duration_sec'], got[8:]
    # another spelling of the same path (case, slashes) finds the record
    answers['/api/studio/autofill'] = [{'path': 'c:/music/SET/Song-00042.MP3'}]
    assert client.post('/api/studio/autofill').get_json()['tracks'][0]['duration_sec'] == library[42]['duration_sec']

    # 3. passed through byte for byte
    answers.pop('/api/studio/generate_from_curve'), answers.pop('/api/studio/autofill')
    for method, path in (('post', '/api/studio/audit'), ('post', '/api/other'), ('post', '/api/studio/autofill-text'), ('get', '/api/studio/optimize')):
        answer = getattr(client, method)(path)
        assert b'duration_sec' not in answer.get_data(), (path, answer.get_data()[:100])
    plain = client.post('/api/studio/autofill-text').get_data()
    assert plain == b'plain'
    # a streamed JSON answer (generator body) on a listed route is passed through untouched, never buffered or rewritten
    D.ROUTES['/api/studio/streamed'] = ('tracks',)
    try:
        streamed = client.post('/api/studio/streamed')
        assert streamed.is_streamed, 'the stand-in answer should be a streamed response'
        assert streamed.get_data() == streamed_body.encode() and b'duration_sec' not in streamed.get_data(), streamed.get_data()[:100]
    finally:
        del D.ROUTES['/api/studio/streamed']
    D.ROUTES['/api/studio/generate_from_anchor-err'] = ('tracks',)
    try:
        refused = client.post('/api/studio/generate_from_anchor-err')
        assert refused.status_code == 400 and 'duration_sec' not in refused.get_json()['tracks'][0]
    finally:
        del D.ROUTES['/api/studio/generate_from_anchor-err']
    D.ROUTES['/api/studio/broken-json'] = ('tracks',)
    try:
        assert client.post('/api/studio/broken-json').get_data() == b'{"tracks": [oops'
    finally:
        del D.ROUTES['/api/studio/broken-json']

    # 4. a library that cannot be read passes the answer through exactly as the server made it
    stub2 = Stub(base / 'missing.json')
    D.install(stub2)
    stub2.app.add_url_rule('/api/studio/autofill', 'a', lambda: Response('{"tracks": [{"path": "C:\\\\Music\\\\Set\\\\song-00003.mp3"}]}', mimetype='application/json'), methods=['POST'])
    plain_answer = stub2.app.test_client().post('/api/studio/autofill')
    assert plain_answer.get_data() == b'{"tracks": [{"path": "C:\\\\Music\\\\Set\\\\song-00003.mp3"}]}', plain_answer.get_data()
    bad = base / 'bad.json'
    bad.write_text('{"tracks": [', 'utf-8')
    stub3 = Stub(bad)
    D.install(stub3)
    stub3.app.add_url_rule('/api/studio/autofill', 'a', lambda: Response('{"tracks": [{"path": "x"}]}', mimetype='application/json'), methods=['POST'])
    assert stub3.app.test_client().post('/api/studio/autofill').get_data() == b'{"tracks": [{"path": "x"}]}'

    # 5. speed: 60 songs on the 50,000-song library are dict lookups; a changed library file is picked up
    answers['/api/studio/build_around_tracks'] = [track(i * 700) for i in range(60)]
    started = time.perf_counter()
    got = client.post('/api/studio/build_around_tracks').get_json()['playlist']
    warm = time.perf_counter() - started
    assert all(t['duration_sec'] == library[i * 700]['duration_sec'] for i, t in zip(range(60), got)), 'a 60-song set was not filled'
    runs = []
    for _ in range(5):
        started = time.perf_counter()
        client.post('/api/studio/build_around_tracks')
        runs.append(time.perf_counter() - started)
    baseline = []
    for _ in range(5):
        started = time.perf_counter()
        client.post('/api/studio/plain')
        baseline.append(time.perf_counter() - started)
    cost = min(runs) - min(baseline)
    print('  60 songs on 50,000: first answer (reads the library once) %.0f ms; later answers %.1f ms vs %.1f ms without the fill; index builds %d'
          % (warm * 1000, min(runs) * 1000, min(baseline) * 1000, stub.WINDOWS_DURATION_INDEX.builds))
    assert cost < 0.05, 'the fill costs %.0f ms per answer' % (cost * 1000)
    assert stub.WINDOWS_DURATION_INDEX.builds == 1 and stub.reads == 1, (stub.WINDOWS_DURATION_INDEX.builds, stub.reads)
    started = time.perf_counter()
    D.DurationIndex(stub).refresh()
    print('  building the index of 50,000 songs: %.0f ms' % ((time.perf_counter() - started) * 1000))
    library[0] = track(0, duration_sec=777)
    time.sleep(0.05)
    write_library(cache, library)
    os.utime(cache, ns=(time.time_ns(), time.time_ns() + 10 ** 9))
    answers['/api/studio/autofill'] = [track(0)]
    assert client.post('/api/studio/autofill').get_json()['tracks'][0]['duration_sec'] == 777, 'a changed library file was not picked up'
    assert stub.WINDOWS_DURATION_INDEX.builds == 2

    # 6. wired into the app next to its neighbours
    boot = (workspace / 'axiom-win-probe' / 'windows_bootstrap.py').read_text('utf-8')
    assert 'from windows_studio_durations import install as install_studio_durations' in boot and 'install_studio_durations(app)' in boot
    print('PASS: Magic Set / Build Around / Autofill / From-anchor / Suggest Order answers get duration_sec from the library, nothing else changes, errors pass through, 50,000 songs stay fast')
except BaseException:
    traceback.print_exc()
    sys.exit(1)
finally:
    shutil.rmtree(base, ignore_errors=True)
