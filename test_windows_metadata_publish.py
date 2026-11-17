r"""DJ Metadata Publish works on Windows and says what went wrong in plain words.

Before: the publishers called os.fsync on a file opened read-only, which Windows refuses ([Errno 9] Bad file descriptor), so
"DJ Metadata Publish" failed for every file. Now they get the windows_posix os stand-in, and the answers of the apply routes
never carry "[Errno n]" to the page (windows_apply_wording).

1. friendly(): every row of the wording table, and text with no error code is returned unchanged.
2. The after_request hook, on a small Flask app with the same route names: a matching answer is reworded and keeps the
   original under technical_detail; every other answer (no error code, other route, other key, not JSON) is byte-identical.
3. End to end on the real app (temp folder, free port, copies of a generated tone): Title/Artist cleanup, DJ publish preview,
   apply with the typed confirmation, poll until it ends; the files' TIT2/TPE1 hold the cleaned values and no
   ".axiom-title-artist-*" temp files are left. (Year publish / health publish end to end are not driven here; their fsync
   fix is asserted at module level in test_windows_posix.py.)

Run (PowerShell): .\axiom-win-env\Scripts\python.exe test_windows_metadata_publish.py
Nothing of the owner's is touched (never port 8080)."""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import types
import urllib.error
import urllib.request
from pathlib import Path

workspace = Path(__file__).resolve().parent
APP_DIR = Path(os.environ.get('PH_TEST_APP_DIR') or workspace / 'axiom-win-probe')
sys.path.insert(0, str(workspace))
sys.path.insert(0, str(APP_DIR))
from feature_check import synthetic_library as sl

SERVER = r'''
import sys, pathlib
sb = pathlib.Path(sys.argv[1]); port = int(sys.argv[2]); sys.path.insert(0, sys.argv[3])
import axiom_windows_launcher as L
L.data_root = lambda: sb / 'runtime'
backend = L.build_app(port)
from werkzeug.serving import make_server
make_server('127.0.0.1', port, backend.app, threaded=True).serve_forever()
'''
CONFIRM = 'PUBLISH CLEAN TITLES AND ARTISTS'
failures = []


def check(cond, message):
    if not cond:
        failures.append(message)
        print('  FAIL: ' + message)


# ---------------------------------------------------------------------------------------------------- 1. friendly()
def wording():
    from windows_apply_wording import friendly
    table = [
        ('[WinError 32] The process cannot access the file because it is being used by another process', 'This file is open in another program. Close your DJ software and try again.'),
        ('something being used by another process', 'This file is open in another program. Close your DJ software and try again.'),
        ('[Errno 13] Permission denied: x.mp3', 'This file is read-only or protected.'),
        ('[WinError 5] Access is denied', 'This file is read-only or protected.'),
        ('Permission denied', 'This file is read-only or protected.'),
        ('Access is denied', 'This file is read-only or protected.'),
        ('[Errno 2] No such file or directory', 'This file could not be found. Check that its drive is connected.'),
        ('[WinError 2] The system cannot find the file specified', 'This file could not be found. Check that its drive is connected.'),
        ('[WinError 3] The system cannot find the path specified', 'This file could not be found. Check that its drive is connected.'),
        ('No such file', 'This file could not be found. Check that its drive is connected.'),
        ('[Errno 28] No space left on device', 'The drive is full. Free some space and try again.'),
        ('[WinError 112] There is not enough space on the disk', 'The drive is full. Free some space and try again.'),
        ('No space left', 'The drive is full. Free some space and try again.'),
        ('[WinError 206] The filename or extension is too long', "This file's folder path is too long for Windows."),
        ('[Errno 36] File name too long', "This file's folder path is too long for Windows."),
        ('[Errno 9] Bad file descriptor', 'Windows did not let PEAK HOUR finish saving this file.'),
        ('Bad file descriptor', 'Windows did not let PEAK HOUR finish saving this file.'),
        ('[Errno 22] Invalid argument', 'This file could not be changed.'),
        ('[WinError 1234] Something unusual', 'This file could not be changed.'),
        ('[Errno -2] Name or service not known', 'This file could not be changed.'),
    ]
    for text, want in table:
        got = friendly(text)
        check(got == want, f'friendly({text!r}) = {got!r}, wanted {want!r}')
    for plain in ('Source file changed after preview', 'Already matches', '', 'Errno without brackets'):
        check(friendly(plain) == plain, f'friendly({plain!r}) must return the text unchanged, got {friendly(plain)!r}')
    check(friendly(None) is None and friendly(7) == 7, 'friendly() must pass non-strings through')
    # first match wins: a message carrying two codes takes the earlier row of the table
    check(friendly('[Errno 13] Permission denied after [Errno 9] Bad file descriptor') == 'This file is read-only or protected.', 'first matching row must win')


# ---------------------------------------------------------------------------------------------------- 2. the hook
def hook():
    from flask import Flask, jsonify, Response
    import windows_apply_wording
    flask_app = Flask('hook-test')
    original = '[Errno 9] Bad file descriptor'

    @flask_app.route('/api/library/metadata_publish/status')
    def status():
        return jsonify({'status': 'complete', 'summary': {'failed': 2}, 'results': [
            {'path': 'C:/a [Errno 9].mp3', 'status': 'failed', 'reason': original, 'artist': 'A', 'title': 'T'},
            {'path': 'b.mp3', 'status': 'published', 'reason': ''}], 'error': ''})

    @flask_app.route('/api/library/metadata_publish/fine')
    def fine():
        return Response('{"status": "complete",  "results": [{"reason": "Already matches"}]}', mimetype='application/json')

    @flask_app.route('/api/library/year_publish/x')
    def year():
        return jsonify({'error': '[WinError 32] The process cannot access the file because it is being used by another process'})

    @flask_app.route('/api/library/utility_metadata_cleanup')
    def cleanup():
        return jsonify({'success': False, 'message': '[Errno 13] Permission denied', 'count': 0, 'detail': 'plain'})

    @flask_app.route('/api/library/other')
    def other():  # not one of the apply routes: untouched even with an error code in it
        return Response(json.dumps({'error': original}), mimetype='application/json')

    @flask_app.route('/api/library/metadata_publish/text')
    def text():
        return Response('error: ' + original, mimetype='text/plain')

    @flask_app.route('/api/library/metadata_publish/otherkey')
    def otherkey():  # the code is under a key the hook does not reword
        return Response(json.dumps({'path': 'C:/x [Errno 9].mp3', 'note': original}), mimetype='application/json')

    two_keys = '{"error": "[Errno 9] Bad file descriptor", "message": "[WinError 32] The process cannot access the file because it is being used by another process", "detail": "plain"}'

    @flask_app.route('/api/library/metadata_publish/twokeys')
    def twokeys():  # two reworded keys in one object
        return Response(two_keys, mimetype='application/json')

    @flask_app.route('/api/library/metadata_publish/nocode')
    def nocode():  # a phrase from the table without a code marker, while another field in the same object has a code
        return Response('{"reason": "Permission denied: x.mp3", "message": "[Errno 9] Bad file descriptor", "detail": "No such file"}', mimetype='application/json')

    @flask_app.route('/api/library/metadata_publish/phrases')
    def phrases():  # only phrases, no code anywhere: byte-identical
        return Response('{"reason": "Permission denied: x.mp3", "error": "Access is denied", "detail": "No space left on device"}', mimetype='application/json')

    @flask_app.route('/api/library/metadata_publish/kept')
    def kept():  # the server already sent a technical_detail: the first one stays, the original still goes under its own key
        return Response('{"technical_detail": "from the server", "error": "[Errno 9] Bad file descriptor"}', mimetype='application/json')

    @flask_app.route('/api/library/metadata_publish/nested')
    def nested():  # each object keeps its own first original
        return Response(json.dumps({'results': [{'reason': '[Errno 13] Permission denied', 'error': '[Errno 28] No space left'},
                                                {'reason': 'Permission denied', 'error': '[Errno 2] No such file'}]}), mimetype='application/json')

    windows_apply_wording.install(types.SimpleNamespace(app=flask_app))
    windows_apply_wording.install(types.SimpleNamespace(app=flask_app))  # twice: still one hook
    check(len(flask_app.after_request_funcs.get(None, [])) == 1, 'install() must be idempotent')
    client = flask_app.test_client()

    r = client.get('/api/library/metadata_publish/status')
    data = r.get_json()
    row = data['results'][0]
    check(row['reason'] == 'Windows did not let PEAK HOUR finish saving this file.', f'reason not reworded: {row}')
    check(row.get('technical_detail') == original, f'technical_detail should hold the original, got {row.get("technical_detail")!r}')
    check(row['path'] == 'C:/a [Errno 9].mp3' and row['artist'] == 'A' and row['status'] == 'failed', 'other keys of the row must not change')
    check('technical_detail' not in data['results'][1] and data['results'][1]['reason'] == '', 'a row without an error must not change')
    check('Errno' not in json.dumps({k: v for k, v in data['results'][0].items() if k != 'technical_detail'}.get('reason')), 'reason still carries the code')
    check(r.headers.get('Content-Length') == str(len(r.get_data())), 'Content-Length must match the rewritten body')
    check(data['summary'] == {'failed': 2} and data['status'] == 'complete', 'summary/status must not change')

    r = client.get('/api/library/year_publish/x')
    check(r.get_json().get('error') == 'This file is open in another program. Close your DJ software and try again.'
          and 'WinError 32' in r.get_json().get('technical_detail', ''), f'year_publish answer not reworded: {r.get_json()}')
    r = client.get('/api/library/utility_metadata_cleanup')
    body = r.get_json()
    check(body['message'] == 'This file is read-only or protected.' and body['technical_detail'] == '[Errno 13] Permission denied'
          and body['detail'] == 'plain' and body['count'] == 0, f'cleanup answer wrong: {body}')

    body = client.get('/api/library/metadata_publish/twokeys').get_json()
    check(body['error'] == 'Windows did not let PEAK HOUR finish saving this file.' and body['message'] == 'This file is open in another program. Close your DJ software and try again.'
          and body['detail'] == 'plain', f'two reworded keys in one object: {body}')
    check(body.get('technical_detail') == '[Errno 9] Bad file descriptor', f'technical_detail keeps the FIRST original in the object: {body.get("technical_detail")!r}')
    check(body.get('technical_detail_error') == '[Errno 9] Bad file descriptor' and body.get('technical_detail_message', '').startswith('[WinError 32]')
          and 'technical_detail_detail' not in body, f'each original is also stored under technical_detail_<key>: {body}')
    body = client.get('/api/library/metadata_publish/nocode').get_json()
    check(body['reason'] == 'Permission denied: x.mp3' and body['detail'] == 'No such file', f'a phrase without a code marker is left untouched even when another field has a code: {body}')
    check(body['message'] == 'Windows did not let PEAK HOUR finish saving this file.' and body.get('technical_detail') == '[Errno 9] Bad file descriptor'
          and body.get('technical_detail_message') == '[Errno 9] Bad file descriptor' and 'technical_detail_reason' not in body and 'technical_detail_detail' not in body, f'only the value with the code is reworded and kept: {body}')
    body = client.get('/api/library/metadata_publish/kept').get_json()
    check(body['technical_detail'] == 'from the server' and body['technical_detail_error'] == '[Errno 9] Bad file descriptor'
          and body['error'] == 'Windows did not let PEAK HOUR finish saving this file.', f'an existing technical_detail is not overwritten: {body}')
    rows = client.get('/api/library/metadata_publish/nested').get_json()['results']
    check(rows[0]['technical_detail'] == '[Errno 13] Permission denied' and rows[0]['technical_detail_error'] == '[Errno 28] No space left' and rows[0]['technical_detail_reason'] == '[Errno 13] Permission denied'
          and rows[0]['reason'] == 'This file is read-only or protected.' and rows[0]['error'] == 'The drive is full. Free some space and try again.', f'nested object 1: {rows[0]}')
    check(rows[1]['reason'] == 'Permission denied' and rows[1]['error'] == 'This file could not be found. Check that its drive is connected.' and rows[1]['technical_detail'] == '[Errno 2] No such file'
          and 'technical_detail_reason' not in rows[1], f'nested object 2 keeps its own first original: {rows[1]}')
    check(windows_apply_wording.rewrite({'a': [{'reason': '[Errno 9] x', 'error': '[Errno 9] y'}, {'message': 'Permission denied'}]}) == 2, 'rewrite() should count the strings it replaced (a phrase with no code is not one)')
    for path, want in (('/api/library/metadata_publish/phrases', b'{"reason": "Permission denied: x.mp3", "error": "Access is denied", "detail": "No space left on device"}'),
                       ('/api/library/metadata_publish/fine', b'{"status": "complete",  "results": [{"reason": "Already matches"}]}'),
                       ('/api/library/other', json.dumps({'error': original}).encode()),
                       ('/api/library/metadata_publish/text', ('error: ' + original).encode()),
                       ('/api/library/metadata_publish/otherkey', json.dumps({'path': 'C:/x [Errno 9].mp3', 'note': original}).encode())):
        got = client.get(path).get_data()
        check(got == want, f'{path} must be byte-identical, got {got!r}')


# ---------------------------------------------------------------------------------------------------- 3. end to end
def end_to_end():
    from mutagen.id3 import ID3
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    if port == 8080:
        raise SystemExit('refusing port 8080')
    url = f'http://127.0.0.1:{port}'
    base = Path(tempfile.mkdtemp(prefix='phmeta'))
    runtime = base / 'runtime'
    env = {**os.environ, 'LOCALAPPDATA': str(base / 'local'), 'USERPROFILE': str(base / 'home'), 'APPDATA': str(base / 'roaming'),
           'AXIOM_RUNTIME_DIR': str(runtime), 'AXIOM_LICENSE_REQUIRED': '0', 'AXIOM_NO_OPEN': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
    for name in ('local', 'home', 'roaming', 'runtime'):
        (base / name).mkdir()
    server = None

    def call(path, body=None):
        headers = {'Content-Type': 'application/json', 'Origin': url, 'Referer': url + '/', 'Sec-Fetch-Site': 'same-origin'}
        req = urllib.request.Request(url + path, data=None if body is None else json.dumps(body).encode(), headers=headers,
                                     method='GET' if body is None else 'POST')
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, {'raw': raw[:300].decode('utf-8', 'replace')}

    try:
        count = 5
        paths = sl.make_real_files(base, count, [f'trk-{i:04d}.mp3' for i in range(count)])
        stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        tracks = [{'path': path, 'filename': Path(path).name, 'folder': 'Music', 'title': f'Signal Fire {i:02d} (Music Junkie Slam Edit)',
                   'artist': f'Artist {i}', 'album': 'A', 'genre': 'House', 'comments': '', 'label': '', 'bpm': 120.0, 'camelot': '8A',
                   'key_raw': '8A', 'energy': 'Mid', 'year': 2010 + i, 'era': 'Unknown', 'playlist_names': [], 'cue_count': 1,
                   'beatgrid_locked': False, 'source': 'virtualdj_database', 'connected_from': 'virtualdj', 'needs_relink': False,
                   'duration_sec': 200, 'axiom_first_seen_at': stamp, 'file_size': 4000000 + i} for i, path in enumerate(paths)]
        sl.write_library(runtime, tracks)
        server = subprocess.Popen([sys.executable, '-c', SERVER, str(base), str(port), str(APP_DIR)], env=env, cwd=str(workspace),
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(240):
            try:
                urllib.request.urlopen(url + '/api/library/stats', timeout=2).read()
                break
            except OSError:
                time.sleep(0.5)
        else:
            raise AssertionError('the app did not start')

        code, plan = call('/api/library/utility_metadata_preview', {'category': 'title_cleanup', 'excluded_paths': [], 'expected_values': []})
        check(code == 200 and plan.get('success') is True and plan.get('count') == count, f'cleanup preview: {code} {str(plan)[:300]}')
        want = {t['path']: t['cleanup_preview'] for t in plan.get('tracks', [])}
        check(len(want) == count and all(v.get('title_changed') for v in want.values()), 'every seeded song should have a title fix')
        code, done = call('/api/library/utility_metadata_cleanup', {
            'category': 'title_cleanup', 'paths': paths, 'apply': True, 'scope': 'sample', 'excluded_paths': [], 'custom_overrides': [],
            'expected_values': plan['expected_values'], 'review_rules_signature': plan['review_rules_signature']})
        check(code == 200 and done.get('success') is True and done.get('count') == count, f'cleanup apply: {code} {str(done)[:400]}')
        check('Errno' not in json.dumps(done) and 'WinError' not in json.dumps(done), 'cleanup answer carries an operating-system error code')

        code, pre = call('/api/library/metadata_publish/preview', {'paths': paths})
        check(code in (200, 202) and pre.get('success') is True, f'publish preview: {code} {str(pre)[:300]}')
        state = pre
        for _ in range(120):
            code, state = call('/api/library/metadata_publish/status')
            if state.get('status') not in ('previewing',):
                break
            time.sleep(0.5)
        check(state.get('status') == 'ready', f'preview did not reach ready: {str(state)[:400]}')
        code, bad = call('/api/library/metadata_publish/apply', {'confirmation': 'wrong', 'include_conflicts': True})
        check(code >= 400 and bad.get('success') is False, f'apply with a wrong confirmation must be refused: {code} {str(bad)[:200]}')
        code, started = call('/api/library/metadata_publish/apply', {'confirmation': CONFIRM, 'include_conflicts': True})
        check(code in (200, 202) and started.get('success') is True, f'publish apply: {code} {str(started)[:300]}')
        state, seen = {}, set()
        for _ in range(240):
            code, state = call('/api/library/metadata_publish/status')
            seen.add(state.get('status'))
            if state.get('status') not in ('publishing', 'ready', 'previewing'):
                break
            time.sleep(0.25)
        print('  publish status:', state.get('status'), state.get('summary'))
        check(state.get('status') == 'complete', f'status should be complete, got {state.get("status")}: {str(state)[:600]}')
        summary = state.get('summary') or {}
        check(summary.get('published') == count, f'summary.published should be {count}: {summary}')
        check(not summary.get('failed'), f'no file should fail: {summary} {[r for r in state.get("results", []) if r.get("status") == "failed"][:3]}')
        text = json.dumps(state)
        check('Errno' not in text and 'WinError' not in text, 'the publish answer carries an operating-system error code')
        for path in paths:
            tags = ID3(path)
            title = str(tags.get('TIT2') or '')
            artist = str(tags.get('TPE1') or '')
            check(title == want[path]['title'], f'{Path(path).name}: TIT2 {title!r}, wanted {want[path]["title"]!r}')
            check(artist == want[path]['artist'], f'{Path(path).name}: TPE1 {artist!r}, wanted {want[path]["artist"]!r}')
        leftovers = [p.name for p in Path(paths[0]).parent.parent.rglob('*') if p.is_file() and '.axiom-title-artist-' in p.name]
        check(not leftovers, f'temp files left beside the music: {leftovers}')
    finally:
        if server is not None:
            subprocess.run(['taskkill', '/T', '/F', '/PID', str(server.pid)], capture_output=True)
            time.sleep(1)
        shutil.rmtree(base, ignore_errors=True)


try:
    wording()
    hook()
    end_to_end()
except BaseException:
    import traceback
    traceback.print_exc()
    failures.append('the test itself crashed')
print('PASS: publish errors are worded plainly (table, hook, technical_detail kept, other answers untouched) and DJ Metadata Publish writes the cleaned title and artist into every file with no temp files left'
      if not failures else 'FAIL: ' + '; '.join(failures))
sys.exit(1 if failures else 0)
