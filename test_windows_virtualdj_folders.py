import hashlib, os, pathlib, sys, tempfile

root = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(root / 'axiom-win-probe'))
import windows_virtualdj_folders as F
from windows_virtualdj_lists import VirtualDJListError

REFERENCE = pathlib.Path(os.environ.get('LOCALAPPDATA', ''), 'Temp', 'claude', 'f4654d8614da80ab', '3659b411-6843-41fd-a174-ae16523e1f95',
                         'scratchpad', 'discovery', 'after', 'vdj-Playlists', 'PH test.m3u')
SONG = {'filesize': '7692836', 'artist': 'Notorious B.I.G', 'title': '#! You Tonight (Featuring R. Kelly)', 'songlength': '345.731',
        'path': 'D:\\2022\\#!_YOU_TONIGHT_(FEATURING_R._KELLY).MP3'}
OWNER_BYTES = (b'\xef\xbb\xbf#EXTVDJ:<filesize>7692836</filesize><artist>Notorious B.I.G</artist>'
               b'<title>#! You Tonight (Featuring R. Kelly)</title><songlength>345.731</songlength>\r\n'
               b'D:\\2022\\#!_YOU_TONIGHT_(FEATURING_R._KELLY).MP3\r\n')
ORDER = b'Serato\r\nList\r\nLatin\r\nLexicon\r\nReggaeton\r\n'


def tree(path):
    return sorted((str(p.relative_to(path)), p.read_bytes() if p.is_file() else None) for p in path.rglob('*'))


def expect(exc_type, code, fn):
    try:
        fn()
    except exc_type as exc:
        assert getattr(exc, 'code', None) == code, (code, getattr(exc, 'code', None), str(exc))
        return
    raise AssertionError('expected ' + str(code))


def running():
    raise VirtualDJListError('Quit VirtualDJ, then try again.')


# byte layout equals the owner's PH test.m3u
assert F.format_m3u([SONG]) == OWNER_BYTES
assert F.format_m3u([]) == b'\xef\xbb\xbf'
if REFERENCE.is_file():
    assert F.format_m3u([SONG]) == REFERENCE.read_bytes(), 'differs from the owner file'

with tempfile.TemporaryDirectory() as d:
    d = pathlib.Path(d)
    home, backups = d / 'VirtualDJ', d / 'backups'
    (home / 'Playlists').mkdir(parents=True)
    (home / 'MyLists').mkdir()
    (home / 'MyLists' / 'order').write_bytes(ORDER)
    song = d / 'You Tonight.mp3'
    song.write_bytes(b'x' * 7692836)
    other = d / 'Other.mp3'
    other.write_bytes(b'y' * 10)
    db = [{'tracks': [{'path': str(song), 'path_kind': 'windows_absolute', 'duration_sec': 345.731,
                       'source_sections': {'Tags': [{'attributes': {'Author': 'Notorious B.I.G', 'Title': '#! You Tonight (Featuring R. Kelly)'}}]}}]}]
    kw = dict(home=home, root=backups, databases=db, ensure_closed=lambda: None)
    payload = {'path': ['PH Parent', 'PH test'], 'tracks': [str(song)], 'style': 'm3u'}

    # preview writes nothing
    before = tree(d)
    pre = F.preview(payload, **kw)
    assert tree(d) == before and pre['success'] and pre['folders_to_create'] and not pre['list_exists']
    assert F.digest(payload, home=home, databases=db) == pre['digest']
    assert tree(d) == before

    # m3u: nested folder, exact bytes (path line swapped for the temp song)
    result = F.apply(payload, **kw)
    target = home / 'Playlists' / 'PH Parent' / 'PH test.m3u'
    assert target.read_bytes() == OWNER_BYTES.replace(SONG['path'].encode(), str(song).encode()), target.read_bytes()
    assert (home / 'MyLists' / 'order').read_bytes() == ORDER  # m3u style leaves MyLists alone
    assert not list((home / 'Playlists' / 'PH Parent').glob('.peakhour*'))
    # existing list is not overwritten without confirm
    snapshot = tree(d)
    expect(F.FolderError, 'exists', lambda: F.apply(payload, **kw))
    assert tree(d) == snapshot
    # undo removes the file and the folder it created
    undone = F.undo(result['backup_id'], root=backups, ensure_closed=lambda: None)
    assert not (home / 'Playlists' / 'PH Parent').exists() and undone['success']
    expect(F.FolderError, 'bad_request', lambda: F.undo(result['backup_id'], root=backups, ensure_closed=lambda: None))

    # 3 levels in an existing folder, 2 lists side by side
    (home / 'Playlists' / 'Lexicon').mkdir()
    deep = {'path': ['Lexicon', 'A', 'B', 'Deep'], 'tracks': [str(song), str(other)]}
    r1 = F.apply(deep, **kw)
    deep_target = home / 'Playlists' / 'Lexicon' / 'A' / 'B' / 'Deep.m3u'
    lines = deep_target.read_bytes().split(b'\r\n')
    assert lines[0].startswith(b'\xef\xbb\xbf#EXTVDJ:<filesize>7692836</filesize>') and lines[2] == b'#EXTVDJ:<filesize>10</filesize>' and lines[-1] == b''
    assert len(r1['folders_created']) == 2
    # confirm replaces atomically, with a backup; undo restores exactly
    old = deep_target.read_bytes()
    new_payload = dict(deep, tracks=[str(other)])
    expect(F.FolderError, 'exists', lambda: F.apply(new_payload, **kw))
    r2 = F.apply(new_payload, replace=True, **kw)
    assert r2['replaced'] and deep_target.read_bytes() != old
    F.undo(r2['backup_id'], root=backups, ensure_closed=lambda: None)
    assert deep_target.read_bytes() == old
    F.undo(r1['backup_id'], root=backups, ensure_closed=lambda: None)
    assert not (home / 'Playlists' / 'Lexicon' / 'A').exists() and (home / 'Playlists' / 'Lexicon').is_dir()

    # mylists style: .subfolders layout, order updated once, existing lines untouched
    my = {'path': ['PH Parent', 'PH child', 'PH list'], 'tracks': [str(song)], 'style': 'mylists'}
    m1 = F.apply(my, **kw)
    mt = home / 'MyLists' / 'PH Parent.subfolders' / 'PH child.subfolders' / 'PH list.vdjfolder'
    assert mt.is_file() and b'<song path=' in mt.read_bytes() and mt.read_bytes().endswith(b'</VirtualFolder>\r\n')
    assert not (home / 'MyLists' / 'PH Parent.vdjfolder').exists()
    assert (home / 'MyLists' / 'order').read_bytes() == ORDER + b'PH Parent\r\n'
    m2 = F.apply(dict(my, path=['PH Parent', 'Second']), **kw)
    assert (home / 'MyLists' / 'order').read_bytes() == ORDER + b'PH Parent\r\n'  # not added twice
    assert m2['order_updated'] is False and m1['order_updated'] is True
    F.undo(m2['backup_id'], root=backups, ensure_closed=lambda: None)
    assert (home / 'MyLists' / 'order').read_bytes() == ORDER + b'PH Parent\r\n' and mt.is_file()
    F.undo(m1['backup_id'], root=backups, ensure_closed=lambda: None)
    assert (home / 'MyLists' / 'order').read_bytes() == ORDER and not (home / 'MyLists' / 'PH Parent.subfolders').exists()
    # order edited by someone else after the write: undo removes only our line
    m3 = F.apply(my, **kw)
    path = home / 'MyLists' / 'order'
    path.write_bytes(path.read_bytes() + b'Later\r\n')
    F.undo(m3['backup_id'], root=backups, ensure_closed=lambda: None)
    assert path.read_bytes() == ORDER + b'Later\r\n'
    path.write_bytes(ORDER)
    # missing order file is created and removed again
    path.unlink()
    m4 = F.apply(my, **kw)
    assert path.read_bytes() == b'PH Parent\r\n'
    F.undo(m4['backup_id'], root=backups, ensure_closed=lambda: None)
    assert not path.exists()
    path.write_bytes(ORDER)

    # refused names and shapes
    snapshot = tree(d)
    for bad in (['..', 'x'], ['a', '..\\..\\x'], ['a/b', 'c'], ['CON'], ['ok', 'NUL.txt'], ['C:', 'x'], ['a', 'b?'], [], 'text', ['a', 5], ['x'] * 9, ['a', ' ']):
        try:
            F.apply(dict(payload, path=bad), **kw)
        except VirtualDJListError:
            pass
        else:
            raise AssertionError('accepted %r' % (bad,))
    expect(F.FolderError, 'bad_request', lambda: F.apply(dict(payload, style='zip'), **kw))
    expect(F.FolderError, 'bad_request', lambda: F.apply(dict(payload, tracks=['relative.mp3']), **kw))
    assert tree(d) == snapshot

    # VirtualDJ running: virtualdj_open unless the live-add flag allows a new-files-only write
    live = dict(kw, ensure_closed=running)
    expect(F.FolderError, 'virtualdj_open', lambda: F.apply(payload, **live))
    assert tree(d) == snapshot
    assert F.preview(payload, **live)['virtualdj_open'] is True
    F.LIVE_ADD_ALLOWED = True
    try:
        r5 = F.apply(payload, **live)  # new files only
        assert target.is_file()
        expect(F.FolderError, 'virtualdj_open', lambda: F.apply(payload, replace=True, **live))  # replacing still waits
        expect(F.FolderError, 'virtualdj_open', lambda: F.undo(r5['backup_id'], root=backups, ensure_closed=running))
        expect(F.FolderError, 'virtualdj_open', lambda: F.apply(my, **live))  # existing order file would be rewritten
        assert (home / 'MyLists' / 'order').read_bytes() == ORDER and not (home / 'MyLists' / 'PH Parent.subfolders').exists()
        (home / 'MyLists' / 'order').unlink()
        F.apply(my, **live)  # no order file yet: only new files are created
        assert (home / 'MyLists' / 'order').read_bytes() == b'PH Parent\r\n'
    finally:
        F.LIVE_ADD_ALLOWED = False

    # a song that moved while the job waited is skipped by name; with none left the error is clear (no raw WinError)
    gone = d / 'Moved.mp3'
    gone.write_bytes(b'z')
    miss = {'path': ['Missing'], 'tracks': [str(other), str(gone)]}
    gone.unlink()
    pm = F.preview(miss, **kw)
    assert pm['tracks'] == 1 and [pathlib.Path(x['path']).name for x in pm['skipped']] == ['Moved.mp3'] and pm['skipped'][0]['reason'] == 'file not found' and pm['skipped'][0]['title'] == 'Moved'
    expect(F.FolderError, 'no_tracks', lambda: F.preview({'path': ['Missing'], 'tracks': [str(gone)]}, **kw))
    try:
        F.preview({'path': ['Missing'], 'tracks': [str(gone)]}, **kw)
    except F.FolderError as exc:
        assert 'Moved.mp3' in str(exc) and 'WinError' not in str(exc)
    # the job digest changes only when the target list itself changes, not when songs or MyLists\order do
    base_digest = F.digest({'path': ['Stable'], 'tracks': [str(other)]}, home=home, databases=db)
    (home / 'MyLists' / 'order').write_bytes(ORDER + b'Someone Else\r\n')
    other.write_bytes(b'yy')
    assert F.digest({'path': ['Stable'], 'tracks': [str(other)]}, home=home, databases=db) == base_digest
    (home / 'MyLists' / 'order').write_bytes(ORDER)
    other.write_bytes(b'y' * 10)

    # route: a missing file is skipped ("file not found"), the rest is previewed and written; nothing left -> nothing to send
    from flask import Flask as _Flask
    papp = _Flask(__name__)
    papp.register_blueprint(F.create_blueprint(lambda p: True, None, backups, home, lambda: None))
    pc = papp.test_client()
    purl, porigin = '/api/windows/virtualdj/folders/', {'Origin': 'http://localhost'}
    mixed = {'path': ['Partial'], 'tracks': [str(other), str(d / 'Nope - Dirty.mp4')]}
    pv = pc.post(purl + 'preview', json=mixed, headers=porigin, base_url='http://localhost').get_json()
    assert pv['songs_to_write'] == 1 and pv['skipped'] == [{'path': str(d / 'Nope - Dirty.mp4'), 'title': 'Nope - Dirty', 'reason': 'file not found'}], pv
    ap = pc.post(purl + 'apply', json=dict(mixed, confirm=True), headers=porigin, base_url='http://localhost')
    assert ap.status_code == 200 and ap.get_json()['songs_to_write'] == 1 and len(ap.get_json()['skipped']) == 1
    F.undo(ap.get_json()['backup_id'], root=backups, ensure_closed=lambda: None)
    none = pc.post(purl + 'preview', json={'path': ['None'], 'tracks': [str(d / 'x.mp4')]}, headers=porigin, base_url='http://localhost').get_json()
    assert none['nothing_to_send'] is True and none['songs_to_write'] == 0 and none['skipped'][0]['reason'] == 'file not found'
    assert pc.post(purl + 'apply', json={'path': ['None'], 'tracks': [str(d / 'x.mp4')], 'confirm': True}, headers=porigin,
                   base_url='http://localhost').status_code == 400

    # queue registration
    class Queue:
        calls = []

        def register(self, *args):
            self.calls.append(args)
    q = Queue()
    F.register_with_queue(q, root=backups, home=home, ensure_closed=lambda: None)
    program, kind, apply_fn, preview_fn = q.calls[0]
    assert (program, kind) == ('virtualdj', 'list_folder') and callable(apply_fn) and callable(preview_fn)

    # routes: same-origin only, apply needs confirm, errors carry a code
    from flask import Flask
    app = Flask(__name__)
    app.register_blueprint(F.create_blueprint(lambda p: True, None, backups, home, running))
    client = app.test_client()
    url = '/api/windows/virtualdj/folders/'
    origin = {'Origin': 'http://localhost'}
    body = {'path': ['Route', 'List'], 'tracks': [str(other)]}
    assert client.post(url + 'preview', json=body, base_url='http://localhost').status_code == 403
    pv = client.post(url + 'preview', json=body, headers=origin, base_url='http://localhost')
    assert pv.status_code == 200 and pv.get_json()['virtualdj_open'] is True
    assert client.post(url + 'apply', json=body, headers=origin, base_url='http://localhost').status_code == 400
    blocked = client.post(url + 'apply', json=dict(body, confirm=True), headers=origin, base_url='http://localhost')
    assert blocked.status_code == 409 and blocked.get_json()['code'] == 'virtualdj_open'
    assert not (home / 'Playlists' / 'Route').exists()
    app2 = Flask(__name__)
    app2.register_blueprint(F.create_blueprint(lambda p: True, None, backups, home, lambda: None))
    ok = app2.test_client().post(url + 'apply', json=dict(body, confirm=True), headers=origin, base_url='http://localhost')
    assert ok.status_code == 200 and (home / 'Playlists' / 'Route' / 'List.m3u').is_file()
    # confirm alone sends a NEW list but never overwrites one; replace:true is a separate, explicit flag
    again = app2.test_client().post(url + 'apply', json=dict(body, confirm=True), headers=origin, base_url='http://localhost')
    assert again.status_code == 409 and again.get_json()['code'] == 'exists'
    swapped = app2.test_client().post(url + 'apply', json=dict(body, confirm=True, replace=True), headers=origin, base_url='http://localhost')
    assert swapped.status_code == 200 and swapped.get_json()['replaced'] is True
    F.undo(swapped.get_json()['backup_id'], root=backups, ensure_closed=lambda: None)
    gone = app2.test_client().post(url + 'undo', json={'backup_id': ok.get_json()['backup_id']}, headers=origin, base_url='http://localhost')
    assert gone.status_code == 200 and not (home / 'Playlists' / 'Route').exists()

print('PASS:VirtualDJ folders write m3u and MyLists lists byte-exact, add the order line once, refuse bad names/overwrites/open VirtualDJ, and undo exactly')
