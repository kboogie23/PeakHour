"""Reconnect Music, second round (windows_reconnect.py, windows_dialogs.py, static/js/shared/windows-reconnect.js):
how a name with several matches is settled, what the window tells the user afterwards, and removing the old entries.

Backend, in a sandbox against AXIOM's real library code:
  - the real /choose route (job.chooser left empty, app.choose_folder_dialog = windows_dialogs.choose_folder_dialog) with the Tk
    window and the folder dialog patched: a folder, a cancel, an exception (a plain message, no traceback text);
  - /start accepts a folder in double quotes (Explorer's "Copy as path");
  - a file name that exists in several places, in this order: (a) file size; (b) the folder names the old path and a candidate share at
    the end, only when that is at least two in a row and only one candidate has it (a /Volumes/... Mac path too; one shared folder
    name is never enough, the review's Album A/B/C CD1 example stays ambiguous); (c) folder + length: among the candidates whose own
    folder has the old path's folder name, 1-8 of them, the one whose length (R.media_length, patched; duration_sec, duration_min or
    duration) is within 2.0 s (exactly 2.0 counts) when only one is. A length alone never decides, lengths are read only for those
    candidates, and ties, more than 8, rows without a length stay ambiguous;
  - a move that the save skips (the new file vanished, or another writer saved a row with that path) ends in 'ambiguous', so
    relinked + in_library + ambiguous + not_found == missing;
  - /result: counts, the entries of each kind, the cap (R.LIST_CAP) and what is left over ("more");
  - /stale: only old entries that still check out right now (new-location row gone, old file back, old row gone, new file gone
    each drop one); 409 while a Health job runs; 403 on a laptop engine;
  - POST /api/library/purge_missing with those paths removes exactly those rows, keeps them in the restore bin, and touches no
    audio file.
Front end: the real app and headless Edge (run through PowerShell): type a quoted folder while the folder window is still
pending, Start, the four result lists with their counts and the literal "Now at: {path}" line (wrapped by CSS) under each name of the
Reconnected and Already-in-your-library lists, "Keep them" removes nothing, a changed list (a second run finds more old entries) is
refused with its message and sends nothing, a /stale answer of 0 sends nothing, Remove -> confirm -> done, the singular wording for one
entry, Health's missing count drops, no script errors, no transitions on the new elements, song names are shown as text, never as HTML.

Run through PowerShell (headless Edge only starts that way):
  powershell.exe -NoProfile -Command "cd C:\\Users\\gatli\\Documents\\PeakHour; & .\\axiom-win-env\\Scripts\\python.exe test_windows_reconnect_results.py"
Everything runs in a temp folder on a free port (never 8080); nothing of the owner's is touched. The folder dialog is always patched."""
import os, sys, json, time, socket, shutil, tempfile, pathlib, subprocess, traceback, urllib.request
from unittest.mock import MagicMock, patch
root = pathlib.Path(__file__).resolve().parent
python = root / 'axiom-win-env' / 'Scripts' / 'python.exe'
EDGES = [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', r'C:\Program Files\Microsoft\Edge\Application\msedge.exe']
base = root / 'fixtures'
base.mkdir(exist_ok=True)
BS = chr(92)
XSS = '<img src=x onerror=window.__xss=1>'


def audio_snapshot(*folders):
    return {str(p): p.read_bytes() for folder in folders for p in pathlib.Path(folder).rglob('*') if p.is_file()}


def make_files(music):
    """The music tree; each file gets its own bytes so 'untouched' means byte-identical."""
    sizes = {'S1/sz.mp3': 11, 'S2/sz.mp3': 22}
    rels = ['House/dup.mp3', 'Techno/dup.mp3', 'x/uniq.mp3', 'Rock/2020/deep.mp3', 'Pop/2020/deep.mp3',
            'J1/Jazz/Live/win2.mp3', 'J2/Blues/Live/win2.mp3', 'Lib2/Pop/ft.mp3', 'Other/Pop/ft.mp3',
            'Album B/CD1/01 Intro.mp3', 'Album C/CD2/01 Intro.mp3',
            'Alpha/dur.mp3', 'Other/dur.mp3', 'Beta/dmin.mp3', 'Other/dmin.mp3', 'Gamma/edge.mp3', 'Other/edge.mp3',
            'Delta/edge_out.mp3', 'Other/edge_out.mp3', 'H/fd.mp3', 'K/fd.mp3', 'X1/Eps/two.mp3', 'X2/Eps/two.mp3',
            'A/amb.mp3', 'B/amb.mp3', 'T1/tie/t.mp3', 'T2/tie/t.mp3', 'Nl/nolen.mp3', 'Other/nolen.mp3',
            'N1/nopar.mp3', 'N2/nopar.mp3', 'Vn/vanish.mp3', 'Tk/taken.mp3',
            'Live/already.mp3', 'Live/already2.mp3', 'Live/already3.mp3']
    rels += ['E%d/Ei/eight.mp3' % n for n in range(1, 9)] + ['U%d/Ni/nine.mp3' % n for n in range(1, 10)] + ['M%d/many.mp3' % n for n in range(1, 10)]
    for number, rel in enumerate(rels):
        sizes.setdefault(rel, 100 + number)
    for rel, size in sizes.items():
        target = music / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(bytes([size % 251]) * size)


MUSIC_ROOT = [None]
LENGTHS = {'Alpha/dur.mp3': 101.0, 'Other/dur.mp3': 100.0,            # the song is 100 s; only the candidate in the old folder (Alpha) may be read
           'Beta/dmin.mp3': 119.0, 'Other/dmin.mp3': 120.0,           # duration_min=2.0 -> 120 s
           'Gamma/edge.mp3': 102.0, 'Other/edge.mp3': 100.0,          # exactly 2.0 s away still counts
           'Delta/edge_out.mp3': 102.5, 'Other/edge_out.mp3': 100.0,  # 2.5 s away does not
           'H/fd.mp3': 150.0, 'K/fd.mp3': 100.0,
           'X1/Eps/two.mp3': 100.0, 'X2/Eps/two.mp3': 101.0,          # two in the old folder within the tolerance
           'E5/Ei/eight.mp3': 100.5,                                   # eight in the old folder, one close
           'Lib2/Pop/ft.mp3': 150.0, 'Other/Pop/ft.mp3': 100.0}        # never read: the folder trail decides first


def lengths(path):
    """What the patched R.media_length answers (seconds) for each candidate file; anything not listed is far from 100 s."""
    return LENGTHS.get(pathlib.PurePath(path).relative_to(MUSIC_ROOT[0]).as_posix(), 200.0)


def backend(sandbox):
    local = sandbox / 'AppData' / 'Local'
    (sandbox / 'AppData' / 'Roaming').mkdir(parents=True)
    local.mkdir(parents=True)
    os.environ.update(LOCALAPPDATA=str(local), APPDATA=str(sandbox / 'AppData' / 'Roaming'), USERPROFILE=str(sandbox),
                      AXIOM_RUNTIME_DIR=str(local / 'AXIOM DJ'), AXIOM_LICENSE_REQUIRED='0')
    os.environ.pop('AXIOM_DEVICE_ID', None)
    sys.path.insert(0, str(root / 'axiom-win-probe'))
    os.chdir(root / 'axiom-win-probe')
    import app, windows_reconnect as R, windows_dialogs as wd
    from windows_paths import is_safe_location
    app.is_safe_location = is_safe_location
    assert not os.path.exists('Q:' + BS), 'the test needs drive Q: to be absent'
    music = sandbox / 'New Music'
    make_files(music)
    MUSIC_ROOT[0] = music
    gone_dir = sandbox / 'Gone'  # an old place on a drive that exists, so the old file can "come back"

    def song(path, key, **extra):
        return dict({'path': path, 'filename': path.replace('/', BS).rsplit(BS, 1)[-1], 'folder': 'f', 'title': key, 'artist': 'Art', 'bpm': 120.0,
                     'needs_relink': True}, **extra)
    live = music / 'Live'
    tracks = [
        # one shared folder name is not enough (the review's example 'intro' is the same shape); no length on these rows
        song('Q:\\Music\\House\\dup.mp3', 'dup_house'), song('/Volumes/M/Techno/dup.mp3', 'dup_techno'),
        song('Q:\\Rips\\Album A\\CD1\\01 Intro.mp3', 'intro'),
        song('Q:\\z\\uniq.mp3', 'uniq'),                                      # the only file with that name
        song('/Volumes/M/Rock/2020/deep.mp3', 'deep'),                        # two folder names in a row (a Mac path)
        song('Q:\\Lib\\Jazz\\Live\\win2.mp3', 'win2'),                        # two folder names in a row (a Windows path)
        song('Q:\\S2\\sz.mp3', 'sz', file_size=11, duration_sec=100),         # the size wins over the folder name and the length
        song('Q:\\Lib2\\Pop\\ft.mp3', 'ft', duration_sec=100),                # the folder trail (2) is settled before any length is read
        # parent folder + length
        song('Q:\\Alpha\\dur.mp3', 'dur', duration_sec=100), song('Q:\\Beta\\dmin.mp3', 'dmin', duration_min=2.0),
        song('Q:\\Gamma\\edge.mp3', 'edge', duration=100), song('Q:\\Ei\\eight.mp3', 'eight', duration_sec=100),
        song('Q:\\Delta\\edge_out.mp3', 'edge_out', duration_sec=100), song('Q:\\H\\fd.mp3', 'fd', duration_sec=100),
        song('Q:\\Eps\\two.mp3', 'two', duration_sec=100), song('Q:\\Ni\\nine.mp3', 'nine', duration_sec=100),
        song('Q:\\z\\nopar.mp3', 'nopar', duration_sec=100), song('Q:\\z\\many.mp3', 'many', duration_sec=100),
        song('Q:\\Nl\\nolen.mp3', 'nolen'),
        song('Q:\\z\\amb.mp3', 'amb'), song('Q:\\tie\\t.mp3', 'tie'),
        song('Q:\\Vn\\vanish.mp3', 'vanish'), song('Q:\\Tk\\taken.mp3', 'taken'),  # chosen, then skipped when the save re-checks
        song('Q:\\Old\\already.mp3', 'already'), song('Q:\\Old\\already2.mp3', 'already2'), song(str(gone_dir / 'already3.mp3'), 'already3'),
        song('Q:\\Old\\gone.mp3', 'gone'),
        song(str(live / 'already.mp3'), 'live1', needs_relink=False), song(str(live / 'already2.mp3'), 'live2', needs_relink=False),
        song(str(live / 'already3.mp3'), 'live3', needs_relink=False)]
    old_already = ['Q:\\Old\\already.mp3', 'Q:\\Old\\already2.mp3', str(gone_dir / 'already3.mp3')]
    library = {'tracks': tracks, 'total_tracks': len(tracks), 'folder_structure': {}}
    text = json.dumps(library)
    cache = pathlib.Path(app.CACHE_PATH)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(text, encoding='utf-8')
    audio = audio_snapshot(music)

    job = R.install(app, chooser=None)
    job.chooser = None  # the route must use app.choose_folder_dialog
    app.choose_folder_dialog = wd.choose_folder_dialog
    client = app.app.test_client()
    origin = {'Origin': 'http://localhost', 'Referer': 'http://localhost/', 'Sec-Fetch-Site': 'same-origin'}

    def get(route):
        response = client.get('/api/windows/library/reconnect/' + route)
        return response.status_code, response.get_json()

    def post(route, **data):
        response = client.post('/api/windows/library/reconnect/' + route, json=data)
        return response.status_code, response.get_json()

    def wait(states=('done', 'failed'), seconds=60):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            status = get('status')[1]
            if status['state'] in states:
                return status
            time.sleep(0.05)
        raise AssertionError('timed out in state ' + status['state'])

    # nothing run yet
    code, body = get('result')
    assert code == 200 and body['state'] == 'idle' and body['counts'] == dict.fromkeys(('missing', 'relinked', 'in_library', 'ambiguous', 'not_found'), 0), body
    assert body['lists'] == {k: [] for k in ('relinked', 'in_library', 'ambiguous', 'not_found')} and set(body['more'].values()) == {0}, body
    assert get('stale')[1] == {'success': True, 'paths': [], 'count': 0}

    # the real /choose route, with Tk and the folder dialog patched (no window can open)
    def chooser(answer):
        root_window = MagicMock()
        outcome = {'side_effect': answer} if isinstance(answer, BaseException) else {'return_value': answer}
        return root_window, patch.object(wd.tk, 'Tk', return_value=root_window), patch.object(wd.filedialog, 'askdirectory', **outcome)
    with patch.object(wd, 'find_dialog_window', return_value=None), patch.object(wd, '_user32', MagicMock()):
        window, tk_patch, ask_patch = chooser(str(music))
        with tk_patch, ask_patch:
            assert post('choose') == (200, {'success': True, 'folder': os.path.normpath(str(music))})
        window.destroy.assert_called_once()
        window, tk_patch, ask_patch = chooser('')
        with tk_patch, ask_patch:
            assert post('choose') == (200, {'success': True, 'cancelled': True})
        window.destroy.assert_called_once()
        window, tk_patch, ask_patch = chooser(RuntimeError('boom C:\\secret\\place Traceback (most recent call last)'))
        with tk_patch, ask_patch, patch.object(R.LOG, 'exception'):
            response = client.post('/api/windows/library/reconnect/choose', json={})
        window.destroy.assert_called_once()
        raw = response.get_data(as_text=True)
        assert response.status_code == 500 and response.get_json() == {'success': False, 'error': 'The folder chooser could not open.'}, raw
        assert not any(word in raw for word in ('Traceback', 'RuntimeError', 'boom', 'secret', 'File "')), raw
        with patch.object(wd.tk, 'Tk', side_effect=wd.tk.TclError('no display')), patch.object(R.LOG, 'exception'):  # the window itself cannot be made
            response = client.post('/api/windows/library/reconnect/choose', json={})
        assert response.status_code == 500 and response.get_json()['error'] == 'The folder chooser could not open.' and 'TclError' not in response.get_data(as_text=True)
    assert get('status')[1]['state'] == 'idle'

    # a quoted folder is accepted; broken quoting is refused with a plain message
    for bad in ('"', '"' + str(music), '""', '"   "'):
        code, body = post('start', folder=bad)
        assert code == 400 and body['success'] is False and body['error'] and 'Traceback' not in body['error'], (bad, code, body)
    assert get('status')[1]['state'] == 'idle'

    calls = []

    def media_length(path):
        calls.append(path)
        return lengths(path)
    # Two moves are chosen and then dropped when the save re-checks: the new file vanishes, and another writer saves a row
    # with the new path first. The commit wrapper makes both happen between the work and the save (product code untouched).
    vanish_file = music / 'Vn' / 'vanish.mp3'
    original_commit = job.commit

    def commit_after_changes(moves):
        assert str(vanish_file) in moves.values() and str(music / 'Tk' / 'taken.mp3') in moves.values(), moves
        vanish_file.unlink()
        data = json.loads(cache.read_text(encoding='utf-8'))
        data['tracks'].append(song(str(music / 'Tk' / 'taken.mp3'), 'late', needs_relink=False))
        cache.write_text(json.dumps(data), encoding='utf-8')
        return original_commit(moves)
    real_length = R.media_length
    R.media_length = media_length
    job.commit = commit_after_changes
    try:
        code, body = post('start', folder='  "%s"  ' % music)
        assert code == 200 and body['folder'] == os.path.normpath(str(music)), (code, body)
        status = wait()
    finally:
        R.media_length = real_length
        job.commit = original_commit
    audio.pop(str(vanish_file))  # the one file the test itself removed
    assert status['state'] == 'done', status
    assert (status['missing'], status['relinked'], status['in_library'], status['ambiguous'], status['not_found']) == (27, 9, 3, 14, 1), status
    # relinked + in_library + ambiguous + not_found == missing, also with the two moves the save dropped
    assert status['relinked'] + status['in_library'] + status['ambiguous'] + status['not_found'] == status['missing'], status
    assert '14 could not be matched' in status['message'] and 'Reconnected 9 songs.' in status['message'], status['message']
    # A length is read only for a candidate whose own folder is named like the old path's folder, only for a row with a length,
    # only when the size and a 2-deep folder trail did not decide, and only when 1-8 candidates have that folder name.
    read = {pathlib.PurePath(p).relative_to(music).as_posix() for p in calls}
    assert read == {'Alpha/dur.mp3', 'Beta/dmin.mp3', 'Gamma/edge.mp3', 'Delta/edge_out.mp3', 'H/fd.mp3',
                    'X1/Eps/two.mp3', 'X2/Eps/two.mp3'} | {'E%d/Ei/eight.mp3' % n for n in range(1, 9)}, sorted(read)
    assert len(calls) == len(read), calls  # each file opened once
    names_read = {pathlib.PurePath(p).name for p in calls}
    assert not names_read & {'many.mp3', 'nine.mp3', 'nopar.mp3', 'nolen.mp3', 'sz.mp3', 'ft.mp3', 'win2.mp3', 'dup.mp3', 'deep.mp3',
                             'amb.mp3', 't.mp3', '01 Intro.mp3', 'uniq.mp3', 'vanish.mp3', 'taken.mp3'}, calls

    # the choices
    after = json.loads(cache.read_text(encoding='utf-8'))['tracks']
    by_title = {t['title']: t for t in after}
    expected = {'uniq': 'x/uniq.mp3',
                'deep': 'Rock/2020/deep.mp3',   # 2-deep trail with a /Volumes/... old path; Pop/2020 shares only one folder
                'win2': 'J1/Jazz/Live/win2.mp3',  # 2-deep trail with a Windows old path
                'sz': 'S1/sz.mp3',              # size wins over the folder name (S2) and the length (S2's would be close)
                'ft': 'Lib2/Pop/ft.mp3',        # the 2-deep trail wins; its length (150 s) is never looked at
                'dur': 'Alpha/dur.mp3',         # duration_sec, folder + length; Other/dur.mp3 is 100 s but is not in the old folder
                'dmin': 'Beta/dmin.mp3',        # duration_min
                'edge': 'Gamma/edge.mp3',       # duration; exactly 2.0 s away still counts
                'eight': 'E5/Ei/eight.mp3'}     # eight candidates in the old folder is the most that is tried
    for title, rel in expected.items():
        assert by_title[title]['path'] == str(music / pathlib.PurePath(rel)) and by_title[title]['needs_relink'] is False, (title, by_title[title])
    left_alone = ('dup_house', 'dup_techno', 'intro',   # one shared folder name is not enough
                  'edge_out',                           # 2.5 s away
                  'fd',                                 # in the old folder but 50 s away
                  'two',                                # two in the old folder within the tolerance
                  'nine',                               # nine in the old folder: too many to try
                  'nopar', 'many',                      # a length but no candidate in the old folder: a length alone never decides
                  'nolen',                              # in the old folder but the song has no length
                  'amb', 'tie',
                  'vanish', 'taken',                    # chosen, then dropped by the save
                  'already', 'already2', 'already3', 'gone')
    for title in left_alone:
        assert by_title[title] == next(t for t in tracks if t['title'] == title), title  # left alone
    assert len(after) == len(tracks) + 1 and [t['title'] for t in after].count('late') == 1  # the row the other writer saved is kept
    assert set(expected) | set(left_alone) == {t['title'] for t in tracks if t['needs_relink']}
    result = get('result')[1]
    assert result['success'] and result['state'] == 'done' and result['folder'] == os.path.normpath(str(music))
    assert result['counts'] == {'missing': 27, 'relinked': 9, 'in_library': 3, 'ambiguous': 14, 'not_found': 1}, result['counts']
    lists = result['lists']
    assert {k: len(v) for k, v in lists.items()} == {'relinked': 9, 'in_library': 3, 'ambiguous': 14, 'not_found': 1} and set(result['more'].values()) == {0}, result
    assert {i['name'] for i in lists['relinked']} == {'Art - ' + t for t in expected}, lists['relinked']
    for item in lists['relinked']:
        key = item['name'].split(' - ', 1)[1]
        assert item['now'] == str(music / pathlib.PurePath(expected[key])) and item['path'] == next(t['path'] for t in tracks if t['title'] == key), item
    ambiguous_titles = [t for t in left_alone if t not in ('already', 'already2', 'already3', 'gone')]
    assert {i['name'] for i in lists['ambiguous']} == {'Art - ' + t for t in ambiguous_titles}
    assert all(i['now'] is None and i['folders'] for i in lists['ambiguous'])
    skipped = {i['name'] for i in lists['ambiguous'] if i['name'] in ('Art - vanish', 'Art - taken')}
    assert skipped == {'Art - vanish', 'Art - taken'}, skipped  # a move the save dropped is listed as ambiguous, not lost
    many = next(i for i in lists['ambiguous'] if i['name'].endswith('many'))
    assert len(many['folders']) == R.FOLDERS_SHOWN == 3, many  # nine candidate folders, three shown
    assert sorted(next(i for i in lists['ambiguous'] if i['name'].endswith('amb'))['folders']) == sorted([str(music / 'A'), str(music / 'B')])
    intro = next(i for i in lists['ambiguous'] if i['name'].endswith('intro'))
    assert sorted(intro['folders']) == sorted([str(music / 'Album B' / 'CD1'), str(music / 'Album C' / 'CD2')]), intro
    assert [i['name'] for i in lists['not_found']] == ['Art - gone'] and lists['not_found'][0]['now'] is None and lists['not_found'][0]['folders'] == []
    assert {i['path'] for i in lists['in_library']} == set(old_already)
    assert {i['now'] for i in lists['in_library']} == {str(live / n) for n in ('already.mp3', 'already2.mp3', 'already3.mp3')}
    # the cap
    R.LIST_CAP = 2
    try:
        capped = get('result')[1]
    finally:
        R.LIST_CAP = 200
    assert {k: len(v) for k, v in capped['lists'].items()} == {'relinked': 2, 'in_library': 2, 'ambiguous': 2, 'not_found': 1}, capped['lists']
    assert capped['more'] == {'relinked': 7, 'in_library': 1, 'ambiguous': 12, 'not_found': 0}, capped['more']
    assert capped['counts'] == result['counts']  # the counts are never capped
    assert capped['lists']['relinked'] == lists['relinked'][:2]
    assert R.LIST_CAP == 200 and R.FOLDERS_SHOWN == 3 and R.DURATION_TOLERANCE == 2.0 and R.DURATION_MAX_CANDIDATES == 8

    # /stale: exactly the three old entries, each re-checked now
    after_run = cache.read_text(encoding='utf-8')
    code, body = get('stale')
    assert code == 200 and body['count'] == 3 and set(body['paths']) == set(old_already) and len(body['paths']) == 3, body

    def variant(label, change, expect_gone, restore):
        change()
        try:
            code, body = get('stale')
        finally:
            restore()
        assert code == 200 and set(body['paths']) == set(old_already) - {expect_gone} and body['count'] == 2, (label, body)

    def rows(drop):
        data = json.loads(after_run)
        data['tracks'] = [t for t in data['tracks'] if not drop(t)]
        cache.write_text(json.dumps(data), encoding='utf-8')
    restore_cache = lambda: cache.write_text(after_run, encoding='utf-8')
    variant('the row at the new place is gone', lambda: rows(lambda t: t['path'] == str(live / 'already2.mp3')), old_already[1], restore_cache)
    variant('the old row is gone', lambda: rows(lambda t: t['path'] == old_already[0]), old_already[0], restore_cache)

    def old_file_back():
        gone_dir.mkdir()
        (gone_dir / 'already3.mp3').write_bytes(b'back')

    def old_file_leaves():
        shutil.rmtree(gone_dir, ignore_errors=True)
    variant('the old file is back', old_file_back, old_already[2], old_file_leaves)
    moved = live / 'already.mp3.away'
    variant('the new file is gone', lambda: (live / 'already.mp3').rename(moved), old_already[0], lambda: moved.rename(live / 'already.mp3'))
    assert set(get('stale')[1]['paths']) == set(old_already) and cache.read_text(encoding='utf-8') == after_run
    app.UNIFIED_HEALTH_JOB['status'] = 'running'
    try:
        code, body = get('stale')
        assert code == 409 and body['success'] is False and 'Health' in body['error'], (code, body)
    finally:
        app.UNIFIED_HEALTH_JOB['status'] = 'idle'
    os.environ['AXIOM_DEVICE_ID'] = 'laptop'
    try:
        assert get('stale')[0] == 403
    finally:
        os.environ.pop('AXIOM_DEVICE_ID')

    # removing the old entries: exactly those rows, into the restore bin; no audio file changes
    stale = get('stale')[1]['paths']
    before_paths = [t['path'] for t in json.loads(cache.read_text(encoding='utf-8'))['tracks']]
    existing = client.post('/api/library/purge_missing', json={'paths': [str(live / 'already.mp3')]}, headers=origin)
    assert existing.status_code == 200 and existing.get_json().get('purged_count') == 0, existing.get_data(as_text=True)[:300]
    assert [t['path'] for t in json.loads(cache.read_text(encoding='utf-8'))['tracks']] == before_paths  # a path whose file exists is never removed
    purged = client.post('/api/library/purge_missing', json={'paths': stale}, headers=origin)
    body = purged.get_json()
    assert purged.status_code == 200 and body['success'] is True and body['purged_count'] == 3 and set(body['removed_paths']) == set(old_already), body
    rest = json.loads(cache.read_text(encoding='utf-8'))['tracks']
    assert [t['path'] for t in rest] == [p for p in before_paths if p not in old_already], 'only the three old rows may go'
    assert {t['title'] for t in rest} >= {'live1', 'live2', 'live3', 'gone', 'amb'} and not {'already', 'already2', 'already3'} & {t['title'] for t in rest}
    assert audio_snapshot(music) == audio and not gone_dir.exists(), 'audio files must be byte-identical'
    binned = client.get('/api/library/removed_from_axiom', headers=origin)
    assert binned.status_code == 200
    binned_text = binned.get_data(as_text=True)
    for old in old_already:
        assert json.dumps(old)[1:-1] in binned_text or old in binned_text, ('missing from the restore bin', old, binned_text[:400])
    assert get('stale')[1] == {'success': True, 'paths': [], 'count': 0}  # nothing left to remove
    print('PASS backend: real /choose route (folder, cancel, plain error), quoted folder, size > folder trail > length, ties ambiguous, '
          '/result counts + caps, /stale re-checks, purge removes exactly the old rows into the restore bin')


SERVER = '''
import os,sys,pathlib,time
from unittest.mock import MagicMock
root=pathlib.Path(sys.argv[1]);port=int(sys.argv[2]);music=sys.argv[3];gate=pathlib.Path(sys.argv[4])
sys.path.insert(0,str(root/'axiom-win-probe'))
import tkinter
from tkinter import filedialog
import windows_dialogs as wd
# the folder dialog is never real: no Tk window, and the "dialog" waits for a flag file
tkinter.Tk=lambda *a,**k:MagicMock()
def ask(**options):
    while not gate.exists(): time.sleep(0.1)
    return music
filedialog.askdirectory=ask
assert wd.filedialog.askdirectory is ask and wd.tk.Tk is not None and isinstance(wd.tk.Tk(),MagicMock)
import axiom_windows_launcher as L
L.log_server_errors()
axiom=L.build_app(port)
assert axiom.WINDOWS_RECONNECT.chooser is not None or getattr(axiom,'choose_folder_dialog',None) is not None
from werkzeug.serving import make_server
print('ready',port,flush=True)
make_server(L.HOST,port,axiom.app,threaded=True).serve_forever()
'''
CDP = r'''
const [debug,url,out,quoted,gate,emptyFolder,cachePath]=process.argv.slice(2);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fs=await import('node:fs');
const nodePath=await import('node:path');
let tab;for(let i=0;i<50&&!tab;i++){try{tab=(await (await fetch(`http://127.0.0.1:${debug}/json`)).json()).find(t=>t.type==='page');}catch(e){}if(!tab)await sleep(200);}
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const wait=new Map();let loaded=null;const R={errors:[]};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id);}
 if(m.method==='Page.loadEventFired'&&loaded)loaded();
 if(m.method==='Runtime.exceptionThrown')R.errors.push((m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text||'').slice(0,300));};
const send=(method,params={})=>new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)return {error:JSON.stringify(r.result.exceptionDetails).slice(0,400)};return r.result.result.value;};
const until=async(expr,seconds)=>{const end=Date.now()+seconds*1000;while(Date.now()<end){if(await ev(expr)===true)return true;await sleep(250);}return false;};
const D='dialog.axiom-reconnect';
const btn=t=>`[...document.querySelectorAll('${D} button')].find(b=>b.textContent===${JSON.stringify(t)})`;
const typePath=value=>ev(`(()=>{const i=document.getElementById('ph-reconnect-path');i.value=${JSON.stringify(value)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const blocks=()=>ev(`[...document.querySelectorAll('${D} .axiom-reconnect-block')].map(b=>({kind:b.dataset.kind,display:getComputedStyle(b).display,summary:b.querySelector('summary').textContent,items:[...b.querySelectorAll('li')].map(l=>l.textContent),names:[...b.querySelectorAll('li')].map(l=>l.firstChild?l.firstChild.textContent:''),nows:[...b.querySelectorAll('li small.axiom-reconnect-now')].map(s=>({parent:s.parentElement.firstChild.textContent,text:s.textContent,wrap:getComputedStyle(s).overflowWrap,tag:s.tagName,inLi:s.parentElement.tagName})),note:b.querySelector('.axiom-reconnect-note')?.textContent||''}))`);
// every element in the window: no transition, no animation
const motion=()=>ev(`[...document.querySelectorAll('${D}, ${D} *')].map(e=>{const s=getComputedStyle(e);const bad=s.transitionDuration.split(',').some(x=>parseFloat(x)>0)||s.animationName!=='none'&&s.animationName!=='';return bad?e.tagName.toLowerCase()+'.'+e.className+' '+s.transitionDuration+' '+s.animationName:null}).filter(Boolean)`);
const missing=()=>ev("(typeof currentHealthSummary!=='undefined'&&currentHealthSummary&&typeof currentHealthSummary.missing_file==='number')?currentHealthSummary.missing_file:null");
R.motion=[];
await send('Page.enable');await send('Runtime.enable');
const done=new Promise(r=>loaded=r);await send('Page.navigate',{url});await done;await sleep(3500);
R.xssBeforeOpen=await ev("typeof window.__xss");
await ev("window.__prompts=0;window.prompt=()=>{window.__prompts++;return null};window.confirm=()=>{window.__prompts++;return false};");
// every request the page makes is logged, so "nothing was sent" can be asserted
await ev("window.__fetches=[];(()=>{const original=window.fetch.bind(window);window.fetch=(u,o)=>{window.__fetches.push([String(u),((o&&o.method)||'GET')]);return original(u,o)}})()");
const purges=()=>ev("window.__fetches.filter(f=>f[0].includes('purge_missing')).length");
const cacheText=()=>fs.readFileSync(cachePath,'utf8');
const oldRow=(old,title)=>({path:old,filename:'already3.mp3',folder:'f',title,artist:'Art',bpm:120.0,camelot:'8A',needs_relink:true});
const liveRow=(title)=>({path:nodePath.join(quoted,'Live','already3.mp3'),filename:'already3.mp3',folder:'Live',title,artist:'Art',bpm:120.0,camelot:'8A',needs_relink:false});
const withRows=(text,add,dropTitles=[])=>{const d=JSON.parse(text);d.tracks=d.tracks.filter(t=>!dropTitles.includes(t.title)).concat(add);d.total_tracks=d.tracks.length;return JSON.stringify(d)};
const DONE=`(()=>{const r=document.querySelector('${D} .axiom-reconnect-result');return !!r&&!r.hidden&&r.textContent.startsWith('Reconnected')&&document.querySelectorAll('${D} .axiom-reconnect-block').length===4&&!document.querySelector('${D} .axiom-reconnect-breakdown').hidden})()`;
// "Search another folder" then Start again, through the page; retried while a Health check from the last removal is still finishing
const rerun=async()=>{await ev(btn('Search another folder')+".click()");
 for(let i=0;i<4;i++){await ev(btn('Start')+".click()");if(await until(DONE,25))return true;await sleep(2000);}return false};
const startViaApi=async()=>{for(let i=0;i<40;i++){const s=await ev("fetch('/api/windows/library/reconnect/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:"+JSON.stringify(quoted)+"})}).then(r=>r.status)");if(s===200)break;await sleep(500);}
 return until("fetch('/api/windows/library/reconnect/status').then(r=>r.json()).then(s=>s.state==='done')",40)};
const askAndConfirm=async()=>{await ev("document.getElementById('ph-reconnect-remove-stale').click()");
 await ev(`[...document.querySelectorAll('${D} .axiom-reconnect-confirm button')].find(b=>b.textContent.startsWith('Remove '))?.click()`);
 await until(`document.querySelector('${D} .axiom-reconnect-stale-status')?.hidden===false`,20);
 return ev(`document.querySelector('${D} .axiom-reconnect-stale-status').textContent`)};
await ev("relocateLibrary()");
R.opened=await until(`document.querySelector('${D}')?.open===true`,5);
R.field=await ev("(()=>{const i=document.getElementById('ph-reconnect-path');return i?{type:i.type,spell:i.spellcheck,label:i.closest('label').textContent}:null})()");
R.startInitiallyDisabled=await ev(btn('Start')+".disabled");
R.waitingInitiallyHidden=await ev("getComputedStyle(document.querySelector('.axiom-reconnect-waiting')).display==='none'");
// the folder window is pending (the server holds the answer back)
await ev(btn('Choose folder or drive')+".click()");
R.waitingShown=await until("getComputedStyle(document.querySelector('.axiom-reconnect-waiting')).display!=='none'",5);
R.waitingText=await ev("document.querySelector('.axiom-reconnect-waiting').textContent");
R.chooseDisabledWhileWaiting=await ev(btn('Choose folder or drive')+".disabled");
R.fieldEnabledWhileWaiting=await ev("document.getElementById('ph-reconnect-path').disabled===false");
R.startStillDisabledUntilTyped=await ev(btn('Start')+".disabled");
await typePath('"'+quoted+'"');
R.startEnabledWhileWaiting=await ev(btn('Start')+".disabled===false");
R.pathLabel=await ev("document.querySelector('.axiom-reconnect-chosen strong').textContent");
R.motion.push(await motion());
await ev(btn('Start')+".click()");
R.finished=await until(`(()=>{const r=document.querySelector('${D} .axiom-reconnect-result');return !!r&&!r.hidden&&r.textContent.startsWith('Reconnected')})()`,40);
R.summary=await ev(`document.querySelector('${D} .axiom-reconnect-result').textContent`);
R.breakdownReady=await until(`document.querySelectorAll('${D} .axiom-reconnect-block').length===4&&!document.querySelector('${D} .axiom-reconnect-breakdown').hidden`,10);
R.blocks=await blocks();
R.removeLabel=await ev("document.getElementById('ph-reconnect-remove-stale')?.textContent");
R.againVisible=await ev(btn('Search another folder')+"?.hidden===false");
R.missingAfterRun=null;R.missingAfterRunOk=await until("typeof currentHealthSummary!=='undefined'&&currentHealthSummary.missing_file===4",20);
R.missingAfterRun=await missing();
// the late answer of the folder window changes nothing, and the waiting line goes away
fs.writeFileSync(gate,'go');
R.waitingHiddenAfterAnswer=await until("getComputedStyle(document.querySelector('.axiom-reconnect-waiting')).display==='none'",10);
R.pathLabelAfterLate=await ev("document.querySelector('.axiom-reconnect-chosen strong').textContent");
R.inputAfterLate=await ev("document.getElementById('ph-reconnect-path').value");
R.chooseEnabledAfterAnswer=await ev(btn('Choose folder or drive')+".disabled===false");
// safe text
R.xss=await ev("typeof window.__xss");
R.imgsInDialog=await ev(`document.querySelectorAll('${D} img').length`);
R.liveHtml=await ev(`document.querySelector('${D} .axiom-reconnect-block[data-kind=in_library]').innerHTML.includes('&lt;img src=x onerror=window.__xss=1&gt;')`);
// Keep them removes nothing
await ev(`document.querySelector('${D} .axiom-reconnect-block[data-kind=in_library]').open=true`);
await ev("document.getElementById('ph-reconnect-remove-stale').click()");
R.confirmShown=await ev(`(()=>{const p=document.querySelector('${D} .axiom-reconnect-confirm');return getComputedStyle(p).display!=='none'&&p.textContent})()`);
R.confirmButtons=await ev(`[...document.querySelectorAll('${D} .axiom-reconnect-confirm button')].map(b=>b.textContent)`);
R.removeHiddenWhileAsking=await ev("getComputedStyle(document.getElementById('ph-reconnect-remove-stale')).display==='none'");
R.motion.push(await motion());
await ev(btn('Keep them')+".click()");
R.afterKeep=await ev(`getComputedStyle(document.querySelector('${D} .axiom-reconnect-confirm')).display==='none'&&getComputedStyle(document.getElementById('ph-reconnect-remove-stale')).display!=='none'`);
R.staleAfterKeep=await ev("fetch('/api/windows/library/reconnect/stale').then(r=>r.json()).then(d=>d.count)");
R.missingAfterKeep=await missing();
R.motion.push(await motion());
// The list changed since it was shown: a second run (through the API) finds one more old entry, so /stale returns 3 for the 2 confirmed
const base=cacheText();
await ev("document.getElementById('ph-reconnect-remove-stale').click()");
const grown=withRows(base,[oldRow('Q:\\Old\\already3.mp3','late_old'),liveRow('late_live')]);
fs.writeFileSync(cachePath,grown);
R.guardSecondRun=await startViaApi();
R.guardStaleCount=await ev("fetch('/api/windows/library/reconnect/stale').then(r=>r.json()).then(d=>d.count)");
const before=await purges();
await ev(`[...document.querySelectorAll('${D} .axiom-reconnect-confirm button')].find(b=>b.textContent.startsWith('Remove '))?.click()`);
R.guardShown=await until(`document.querySelector('${D} .axiom-reconnect-stale-status')?.hidden===false`,20);
R.guardText=await ev(`document.querySelector('${D} .axiom-reconnect-stale-status').textContent`);
R.guardStatus=await ev(`document.querySelector('${D} .axiom-reconnect-stale-status').dataset.status`);
R.guardPurges=(await purges())-before;
R.guardCacheUnchanged=cacheText()===grown;
R.guardConfirmHidden=await ev(`getComputedStyle(document.querySelector('${D} .axiom-reconnect-confirm')).display==='none'`);
// /stale returns nothing now (the rows at the new places are gone): nothing is sent either
fs.writeFileSync(cachePath,base);
R.rerunA=await rerun();
R.blocksA=await blocks();
const noNew=withRows(base,[],['live1','live2']);
fs.writeFileSync(cachePath,noNew);
R.zeroStale=await ev("fetch('/api/windows/library/reconnect/stale').then(r=>r.json()).then(d=>d.count)");
const before0=await purges();
R.zeroText=await askAndConfirm();
R.zeroPurges=(await purges())-before0;
R.zeroCacheUnchanged=cacheText()===noNew;
fs.writeFileSync(cachePath,base);
R.rerunB=await rerun();
R.blocksB=await blocks();
R.removeLabelB=await ev("document.getElementById('ph-reconnect-remove-stale')?.textContent");
R.motion.push(await motion());
// Remove it for real
await ev("document.getElementById('ph-reconnect-remove-stale').click()");
await ev(`[...document.querySelectorAll('${D} .axiom-reconnect-confirm button')].find(b=>b.textContent.startsWith('Remove '))?.click()`);
R.removed=await until(`document.querySelector('${D} .axiom-reconnect-stale-status')?.hidden===false`,20);
R.removedText=await ev(`document.querySelector('${D} .axiom-reconnect-stale-status').textContent`);
R.missingAfterRemove=null;R.missingAfterRemoveOk=await until("typeof currentHealthSummary!=='undefined'&&currentHealthSummary.missing_file===2",20);
R.missingAfterRemove=await missing();
R.staleAfterRemove=await ev("fetch('/api/windows/library/reconnect/stale').then(r=>r.json()).then(d=>d.count)");
R.motion.push(await motion());
// exactly one old entry: the singular wording; the page never sends more than the shown list
await sleep(3000);
fs.writeFileSync(cachePath,withRows(cacheText(),[oldRow('Q:\\Old\\already3.mp3','late_old'),liveRow('late_live')]));
R.rerunC=await rerun();
R.blocksC=await blocks();
R.removeLabelC=await ev("document.getElementById('ph-reconnect-remove-stale')?.textContent");
await ev("document.getElementById('ph-reconnect-remove-stale').click()");
R.confirmC=await ev(`document.querySelector('${D} .axiom-reconnect-confirm').textContent`);
R.confirmButtonsC=await ev(`[...document.querySelectorAll('${D} .axiom-reconnect-confirm button')].map(b=>b.textContent)`);
await ev(`[...document.querySelectorAll('${D} .axiom-reconnect-confirm button')].find(b=>b.textContent.startsWith('Remove '))?.click()`);
R.removedC=await until(`document.querySelector('${D} .axiom-reconnect-stale-status')?.hidden===false`,20);
R.removedTextC=await ev(`document.querySelector('${D} .axiom-reconnect-stale-status').textContent`);
R.purgeBodyOk=await ev("window.__fetches.filter(f=>f[0].includes('purge_missing')).length");
await sleep(3000);
// search another folder: an empty one hides the blocks that have nothing in them
await ev(btn('Search another folder')+".click()");
R.backToChoose=await ev(`getComputedStyle(document.getElementById('ph-reconnect-path')).display!=='none'&&document.querySelector('${D} .axiom-reconnect-result').hidden===true`);
await typePath(emptyFolder);
await ev(btn('Start')+".click()");
R.finished2=await until(`(()=>{const r=document.querySelector('${D} .axiom-reconnect-result');return !!r&&!r.hidden&&r.textContent.startsWith('Reconnected')})()`,40);
R.summary2=await ev(`document.querySelector('${D} .axiom-reconnect-result').textContent`);
R.breakdown2=await until(`document.querySelectorAll('${D} .axiom-reconnect-block').length===4&&!document.querySelector('${D} .axiom-reconnect-breakdown').hidden`,10);
R.blocks2=await blocks();
R.removeButtonGone=await ev("document.getElementById('ph-reconnect-remove-stale')===null");
R.prompts=await ev("window.__prompts");
fs.writeFileSync(out,JSON.stringify(R));
ws.close();process.exit(0);
'''


def frontend(sandbox):
    import unicodedata  # noqa: F401 (kept out of the way of the page code)
    edge = next((e for e in EDGES if os.path.isfile(e)), None)
    assert edge, 'Edge not installed'
    local = sandbox / 'AppData' / 'Local'
    (sandbox / 'profile').mkdir(parents=True)
    music = sandbox / 'New Music'
    make_files(music)
    empty = sandbox / 'Empty Folder'
    empty.mkdir()

    def song(path, key, **extra):
        return dict({'path': path, 'filename': path.replace('/', BS).rsplit(BS, 1)[-1], 'folder': 'f', 'title': key, 'artist': 'Art', 'bpm': 120.0,
                     'camelot': '8A', 'needs_relink': True}, **extra)
    live = music / 'Live'
    tracks = [song('/Volumes/M/Rock/2020/deep.mp3', 'deep'), song('Q:\\S2\\sz.mp3', 'sz', file_size=11), song('Q:\\z\\uniq.mp3', 'uniq'),
              song('Q:\\z\\amb.mp3', XSS), song('Q:\\z\\gone.mp3', 'gone'),
              song('Q:\\Old\\already.mp3', XSS), song('Q:\\Old\\already2.mp3', 'already2'),
              song(str(live / 'already.mp3'), 'live1', needs_relink=False), song(str(live / 'already2.mp3'), 'live2', needs_relink=False)]
    data = local / 'AXIOM DJ' / 'data'
    data.mkdir(parents=True)
    cache = data / 'library_cache.json'
    cache.write_text(json.dumps({'tracks': tracks, 'total_tracks': len(tracks), 'folder_structure': {}}), encoding='utf-8')
    audio = audio_snapshot(music)
    gate = sandbox / 'gate.flag'
    (sandbox / 'server.py').write_text(SERVER, encoding='utf-8')
    (sandbox / 'cdp.mjs').write_text(CDP, encoding='utf-8')
    with socket.socket() as a, socket.socket() as b:
        a.bind(('127.0.0.1', 0)); b.bind(('127.0.0.1', 0))
        port, debug = a.getsockname()[1], b.getsockname()[1]
    assert port != 8080
    env = dict(os.environ, LOCALAPPDATA=str(local), APPDATA=str(sandbox / 'AppData' / 'Roaming'), USERPROFILE=str(sandbox),
               AXIOM_RUNTIME_DIR=str(local / 'AXIOM DJ'), AXIOM_NO_OPEN='1', AXIOM_LICENSE_REQUIRED='0')
    env.pop('AXIOM_HUB', None); env.pop('AXIOM_DEVICE_ID', None)
    procs = []
    try:
        server = subprocess.Popen([str(python), str(sandbox / 'server.py'), str(root), str(port), str(music), str(gate)], env=env,
                                  stdout=subprocess.DEVNULL, stderr=(sandbox / 'server.log').open('wb'))
        procs.append(server)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=3) as r:
                    if r.status == 200:
                        break
            except OSError:
                time.sleep(0.4)
        else:
            raise AssertionError('server did not start: ' + (sandbox / 'server.log').read_text(errors='replace')[-1500:])
        browser = subprocess.Popen([edge, '--headless=new', f'--remote-debugging-port={debug}', f'--user-data-dir={sandbox / "profile"}', '--no-first-run',
                                    '--no-default-browser-check', '--window-size=1400,1000', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        procs.append(browser)
        out = sandbox / 'result.json'
        node = subprocess.run(['node', str(sandbox / 'cdp.mjs'), str(debug), f'http://127.0.0.1:{port}/', str(out), str(music), str(gate), str(empty), str(cache)],
                              capture_output=True, text=True, timeout=240)
        assert out.is_file(), ('node failed', node.stdout[-800:], node.stderr[-800:])
        r = json.loads(out.read_text(encoding='utf-8'))
        print(json.dumps(r, indent=1))
        assert r['opened'] and r['field'] and r['field']['type'] == 'text' and r['field']['spell'] is False and 'type or paste' in r['field']['label'], r
        assert r['startInitiallyDisabled'] is True and r['waitingInitiallyHidden'] is True, r
        # the folder window is pending: the line shows, only the choose button waits, the typed (quoted) path works
        assert r['waitingShown'] and 'folder window is open' in r['waitingText'] and 'type the folder above' in r['waitingText'], r
        assert r['chooseDisabledWhileWaiting'] is True and r['fieldEnabledWhileWaiting'] is True and r['startStillDisabledUntilTyped'] is True, r
        assert r['startEnabledWhileWaiting'] is True and r['pathLabel'] == str(music), r
        assert r['finished'] and r['summary'].startswith('Reconnected 3 songs.'), r
        assert '1 could not be matched' in r['summary'] and '2 are already in your library at the new location.' in r['summary'] and '1 is not in this folder.' in r['summary'], r['summary']
        # four lists with their counts
        assert r['breakdownReady'] and [b['kind'] for b in r['blocks']] == ['relinked', 'in_library', 'ambiguous', 'not_found'], r['blocks']
        assert [b['summary'] for b in r['blocks']] == ['Reconnected (3)', 'Already in your library (2)', 'Same name in more than one place (1)', 'Not found in this folder (1)'], r['blocks']
        assert all(b['display'] != 'none' for b in r['blocks'])
        by = {b['kind']: b for b in r['blocks']}
        assert sorted(by['relinked']['names']) == ['Art - deep', 'Art - sz', 'Art - uniq'], by['relinked']
        assert by['not_found']['items'] == ['Art - gone'] and 'Try another folder' in by['not_found']['note']
        assert len(by['ambiguous']['items']) == 1 and 'In: ' in by['ambiguous']['items'][0] and 'narrower folder' in by['ambiguous']['note'], by['ambiguous']
        assert r['removeLabel'] == 'Remove these 2 old entries' and r['againVisible'] is True, r
        # "Now at:" under each name of the Reconnected and Already-in-your-library lists: the literal new path, wrapped by CSS, not elsewhere
        live = music / 'Live'
        now_relinked = {'Art - deep': music / 'Rock' / '2020' / 'deep.mp3', 'Art - sz': music / 'S1' / 'sz.mp3', 'Art - uniq': music / 'x' / 'uniq.mp3'}
        assert {n['parent']: n['text'] for n in by['relinked']['nows']} == {k: 'Now at: ' + str(v) for k, v in now_relinked.items()}, by['relinked']['nows']
        assert sorted((n['parent'], n['text']) for n in by['in_library']['nows']) == sorted([('Art - ' + XSS, 'Now at: ' + str(live / 'already.mp3')), ('Art - already2', 'Now at: ' + str(live / 'already2.mp3'))]), by['in_library']['nows']
        assert all(n['wrap'] == 'anywhere' and n['tag'] == 'SMALL' and n['inLi'] == 'LI' for k in ('relinked', 'in_library') for n in by[k]['nows']), by
        assert by['ambiguous']['nows'] == [] and by['not_found']['nows'] == [], by
        # the list changed between the confirmation and the click: nothing is sent, nothing is removed, the user is told
        assert r['guardSecondRun'] and r['guardStaleCount'] == 3, (r['guardSecondRun'], r['guardStaleCount'])
        assert r['guardShown'] and r['guardText'] == 'The list has changed since you looked. Close this window and run Reconnect Music again.' and r['guardStatus'] == 'stopped', r['guardText']
        assert r['guardPurges'] == 0 and r['guardCacheUnchanged'] is True and r['guardConfirmHidden'] is True, r
        # /stale returns 0 entries: its message, nothing sent, nothing removed
        assert r['rerunA'] and r['rerunB'], r
        assert [b['summary'] for b in r['blocksA']][1] == 'Already in your library (2)' and [b['summary'] for b in r['blocksB']][1] == 'Already in your library (2)', (r['blocksA'], r['blocksB'])
        assert r['zeroStale'] == 0 and r['zeroText'] == 'Nothing to remove — these entries have already changed.', (r['zeroStale'], r['zeroText'])
        assert r['zeroPurges'] == 0 and r['zeroCacheUnchanged'] is True, r
        assert r['removeLabelB'] == 'Remove these 2 old entries', r['removeLabelB']
        assert r['missingAfterRunOk'] and r['missingAfterRun'] == 7 - 3, r['missingAfterRun']  # seven songs were missing; three were reconnected; Health was re-run
        # the late answer changes nothing
        assert r['waitingHiddenAfterAnswer'] and r['pathLabelAfterLate'] == str(music) and r['inputAfterLate'] == '"' + str(music) + '"', r
        # safe text
        assert r['xssBeforeOpen'] == 'undefined' and r['xss'] == 'undefined' and r['imgsInDialog'] == 0 and r['liveHtml'] is True, (r['xssBeforeOpen'], r['xss'], r['imgsInDialog'])
        assert any(XSS in item for b in r['blocks'] for item in b['items']), 'the title must show as literal text'
        # confirmation, Keep them, Remove
        assert 'Remove 2 old entries from PEAK HOUR?' in r['confirmShown'] and 'Restore Bin' in r['confirmShown'], r['confirmShown']
        assert r['confirmButtons'] == ['Remove 2 entries', 'Keep them'] and r['removeHiddenWhileAsking'] is True, r
        assert r['afterKeep'] is True and r['staleAfterKeep'] == 2 and r['missingAfterKeep'] == 4, r
        assert r['removed'] and r['removedText'] == 'Removed 2 old entries. You can bring them back from Health > Restore Bin.', r
        assert r['missingAfterRemoveOk'] and r['missingAfterRemove'] == 2 and r['missingAfterRun'] - r['missingAfterRemove'] == 2 and r['staleAfterRemove'] == 0, r
        # exactly one old entry: the real singular strings (the button label reads "Remove these 1 old entry")
        assert r['rerunC'] and [b['summary'] for b in r['blocksC']][1] == 'Already in your library (1)', r['blocksC']
        assert r['removeLabelC'] == 'Remove this 1 old entry', r['removeLabelC']
        assert r['confirmC'].startswith('Remove 1 old entry from PEAK HOUR?') and r['confirmButtonsC'] == ['Remove 1 entry', 'Keep them'], (r['confirmC'], r['confirmButtonsC'])
        assert r['removedC'] and r['removedTextC'] == 'Removed 1 old entry. You can bring it back from Health > Restore Bin.', r['removedTextC']
        assert r['purgeBodyOk'] == 2, r['purgeBodyOk']  # in the whole session: the removal of 2 and the removal of 1 sent a purge request; the changed list and the empty answer sent none
        # search another folder: nothing found, so only the "not found" list shows
        assert r['backToChoose'] is True and r['finished2'] and r['summary2'].startswith('Reconnected 0 songs.'), r
        assert r['breakdown2'] and {b['kind']: b['display'] == 'none' for b in r['blocks2']} == {'relinked': True, 'in_library': True, 'ambiguous': True, 'not_found': False}, r['blocks2']
        assert next(b for b in r['blocks2'] if b['kind'] == 'not_found')['summary'] == 'Not found in this folder (2)' and 'Art - gone' in next(b for b in r['blocks2'] if b['kind'] == 'not_found')['items']
        assert next(b for b in r['blocks2'] if b['kind'] == 'ambiguous')['summary'] == 'Same name in more than one place (0)'  # the empty folder holds no copy of it any more: not found, not ambiguous
        assert r['removeButtonGone'] is True and r['prompts'] == 0, r
        assert r['errors'] == [], r['errors']
        assert all(m == [] for m in r['motion']), r['motion']
        # the library: only the two old rows went; the files did not change
        saved = json.loads(cache.read_text(encoding='utf-8'))['tracks']
        titles = [t['title'] for t in saved]
        assert titles == ['deep', 'sz', 'uniq', XSS, 'gone', 'live1', 'live2', 'late_live'], titles  # 'already2', the XSS "already" row and 'late_old' went (the other XSS row is the ambiguous one); 'late_live' is the test's own row
        assert audio_snapshot(music) == audio, 'audio files must be byte-identical'
        print('PASS front end: typed quoted folder while the folder window is pending, four result lists, Keep them removes nothing, '
              'Remove -> done, Health count drops, hidden empty lists, no errors, no transitions, names shown as text')
    finally:
        for p in reversed(procs):
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(p.pid)], capture_output=True)
        for p in procs:
            try:
                p.wait(15)
            except Exception:
                p.kill()


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    sandbox = pathlib.Path(tempfile.mkdtemp(dir=base, prefix='reconnect-results-'))
    try:
        if which in ('all', 'backend'):
            sub = sandbox / 'backend'
            sub.mkdir()
            backend(sub)
        if which in ('all', 'frontend'):
            sub = sandbox / 'frontend'
            sub.mkdir()
            frontend(sub)
    finally:
        os.chdir(root)
        shutil.rmtree(sandbox, ignore_errors=True)


try:
    main()
    print('PASS: Reconnect Music results, choices, stale entries, removal and window text all behave')
except BaseException:
    traceback.print_exc()
    sys.exit(1)
