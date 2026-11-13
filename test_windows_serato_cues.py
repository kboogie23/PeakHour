"""Cue points sent to Serato: tags written to MP3 / MP4 / M4A files generated with ffmpeg in a temp folder.

No real song or Serato folder is touched. The Serato tag layout is checked against the bytes Serato DJ Pro 5 wrote for
one song (investigation.md, 2026-11-13); that reference is embedded below, and the real file is only compared if present.
"""
import os, sys, pathlib, shutil, subprocess, tempfile, traceback, hashlib, base64
here = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(here / 'axiom-win-probe'))
try:
    import imageio_ffmpeg
    import windows_serato_cues as C
    from mutagen.id3 import ID3
    from mutagen.mp4 import MP4
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
    work = pathlib.Path(tempfile.mkdtemp(prefix='peakhour-serato-cues-'))

    def check_raises(kind, call, code=None):
        try:
            call()
        except kind as exc:
            assert code is None or getattr(exc, 'code', None) == code, (code, exc)
            return exc
        raise AssertionError('expected ' + kind.__name__)

    def ffmpeg(*args):
        done = subprocess.run([FFMPEG, '-y', '-loglevel', 'error', *args], capture_output=True)
        assert done.returncode == 0, done.stderr.decode(errors='replace')

    def sha(path):
        return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()

    # ---------------------------------------------------------------- the byte layout Serato DJ Pro 5 wrote
    REAL_INNER = bytes.fromhex('0101434f4c4f5200000000040000ffff435545000000001500000000005d00cc00000000456e6572677920340042504d4c4f434b000000000100')
    REAL_V1 = bytes.fromhex(
        '02050000000e0000005dffffffff00ffffffff00cc00000100ffffffffffffffff00ffffffff000000000000ffffffffffff'
        'ffff00ffffffff000000000000ffffffffffffffff00ffffffff000000000000ffffffffffffffff00ffffffff0000000000'
        '00ffffffffffffffff00ffffffff000000000300ffffffffffffffff00ffffffff000000000300ffffffffffffffff00ffff'
        'ffff000000000300ffffffffffffffff00ffffffff000000000300ffffffffffffffff00ffffffff000000000300ffffffff'
        'ffffffff00ffffffff000000000300ffffffffffffffff00ffffffff000000000300ffffffffffffffff00ffffffff000000'
        '000300ffffffffffffffff00ffffffff0000000003000000ffff')
    real_cue = {'index': 0, 'ms': 93, 'color': 'CC0000', 'name': 'Energy 4'}
    wrapped = b'\n'.join(base64.b64encode(REAL_INNER)[i:i + 72] for i in range(0, len(base64.b64encode(REAL_INNER)), 72))
    real_raw = (b'\x01\x01' + wrapped).ljust(470, b'\x00')
    entries = C.parse_markers2(real_raw)
    assert [n for n, _ in entries] == ['COLOR', 'CUE', 'BPMLOCK'] and C.parse_cue_entry(entries[1][1]) == (0, 93, 'CC0000', 'Energy 4')
    assert C.encode_markers2([real_cue], [('COLOR', b'\x00\x00\xff\xff'), ('BPMLOCK', b'\x00')]) == real_raw, 'Markers2 layout differs from Serato'
    assert C.encode_markers2([real_cue], [], b'\x00\xff\xff')[:2] == b'\x01\x01' and len(C.encode_markers2([real_cue])) == 470
    assert C.encode_markers_v1([real_cue], b'\x00\x00\xff\xff') == REAL_V1, 'Markers_ layout differs from Serato'
    assert C.parse_markers_v1(REAL_V1) == (1, b'\x00\x00\xff\xff') and C.parse_markers_v1(C.encode_markers_v1([], b'\x00\xff\xff\xff'))[0] == 0
    real_song = pathlib.Path(r'D:\VIDEO\MP4\Nick Cannon - Dance Floor (Quick Hit Clean).mp4')
    if real_song.is_file():  # read only
        tags = MP4(str(real_song)).tags
        assert bytes(tags[C.ATOM_V2][0]) == C._atom_value(C.HEAD_V2, real_raw) and bytes(tags[C.ATOM_V1][0]) == C._atom_value(C.HEAD_V1, REAL_V1)
        print('note: the encoder reproduces the real MP4 atoms byte for byte')

    # ---------------------------------------------------------------- generated songs
    def make(name, kind, pad=True, extra=()):
        path = work / name
        if kind == 'mp3':
            ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libmp3lame', '-id3v2_version', '3', '-write_id3v1', '1',
                   '-metadata', 'title=Test Song', '-metadata', 'artist=Test Artist', str(path))
        elif kind == 'm4a':
            ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', '-metadata', 'title=Test Song', str(path))
        else:
            ffmpeg('-f', 'lavfi', '-i', 'testsrc=duration=2:size=64x64:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
                   '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', '-metadata', 'title=Test Video', *extra, str(path))
        assert path.is_file() and path.stat().st_size > 1000
        if pad:
            if kind == 'mp3':
                tags = ID3(str(path))
                tags.save(str(path), padding=lambda info: 4096)
            else:
                tags = MP4(str(path))
                tags.save(padding=lambda info: 4096)
        return str(path)

    mp3, mp3b, mp3c, m4a, mp4, mp4b = (make('one.mp3', 'mp3'), make('two.mp3', 'mp3'), make('three.mp3', 'mp3'),
                                       make('four.m4a', 'm4a'), make('five.mp4', 'mp4'), make('six.mp4', 'mp4'))
    CUES = [{'index': 0, 'time_ms': 1500, 'label': 'Intro', 'color': '#CC0000'}, {'index': 1, 'time_ms': 30500.4, 'label': 'Cue 2', 'color': '#A3FF00'},
            {'index': 7, 'time_ms': 90250, 'label': 'Drop', 'color': None}, {'index': 9, 'time_ms': 5, 'label': 'bad slot'}]
    WANT = [(0, 1500, 'CC0000', 'Intro'), (1, 30500, 'CC8800', ''), (7, 90250, '8800CC', 'Drop')]
    root = work / 'backups'
    state = {'open': False}
    seen_paths = []
    C.configure(root=root, running=lambda: state['open'], libraries=lambda: [], programs=lambda: set(),
                readers={'peakhour': lambda p: CUES if os.path.basename(p) in ('one.mp3', 'two.mp3', 'four.m4a', 'five.mp4', 'six.mp4') else [],
                         'virtualdj': lambda p: [{'index': 2, 'time_ms': 2000, 'label': 'VDJ', 'color': '#0000CC'}] if os.path.basename(p) == 'three.mp3' else [],
                         'djay': lambda p: seen_paths.append(p) or []})
    before = {p: sha(p) for p in (mp3, mp3b, mp3c, m4a, mp4, mp4b)}
    ident = {p: C._stat(p) for p in before}
    audio = {p: C.audio_fingerprint(p) for p in before}
    info_before = {p: C.inspect(p) for p in before}
    assert all(not i['cues'] and not i['has_v2'] for i in info_before.values())
    assert open(mp3, 'rb').read()[-128:-125] == b'TAG', 'the generated MP3 should carry an ID3v1 tag'
    v1_before = open(mp3, 'rb').read()[-128:]
    length_before = {p: MP4(p).info.length for p in (m4a, mp4)}
    everything = lambda: sorted(str(p.relative_to(work)) for p in work.rglob('*'))

    # ---------------------------------------------------------------- preview writes nothing; the first source with cues wins
    listing = everything()
    plan = C.preview({'tracks': [mp3, mp3c, m4a, mp4, str(work / 'missing.mp3'), str(work / 'notes.txt')]})
    rows = {os.path.basename(r['path']): r for r in plan['songs']}
    assert plan['counts'] == {'songs_to_write': 4, 'cues_to_write': 3 * 3 + 1, 'skipped': 2, 'songs_growing': 0, 'bytes_added': 0}, plan['counts']
    assert rows['one.mp3']['source'] == 'peakhour' and rows['three.mp3']['source'] == 'virtualdj'
    assert [(c['index'], c['ms'], c['color'], c['name']) for c in rows['one.mp3']['cues']] == WANT, rows['one.mp3']['cues']
    assert rows['missing.mp3']['skip_reason'] == 'The file is not there' and 'Only MP3' in rows['notes.txt']['skip_reason']
    assert everything() == listing and {p: sha(p) for p in before} == before and not root.exists(), 'preview wrote something'
    assert C.digest({'tracks': [mp3]}) == C.digest({'tracks': [mp3]}) and C.digest({'tracks': [mp3]}) != C.digest({'tracks': [mp3c]})

    # ---------------------------------------------------------------- Serato open: nothing is written
    state['open'] = True
    err = check_raises(C.SeratoCueError, lambda: C.apply({'tracks': [mp3, mp4]}), 'serato_open')
    assert 'Nothing was written' in str(err) and {p: sha(p) for p in before} == before and not root.exists()
    check_raises(C.SeratoCueError, lambda: C.undo('20260101-000000-abcdef12'), 'bad_request')
    state['open'] = False
    # ...and Serato opening just before a song is replaced
    calls = []
    C.configure(running=lambda: calls.append(1) or len(calls) >= 2)  # closed at the start of apply, open right before the first replace
    check_raises(C.SeratoCueError, lambda: C.apply({'tracks': [mp3]}), 'serato_open')
    assert sha(mp3) == before[mp3] and not [p for p in work.rglob('*.tmp')], 'a song or temp file was left behind'
    C.configure(running=lambda: state['open'])

    # ---------------------------------------------------------------- MP3 with a legacy "Serato Markers_" tag that has no cues: it stays as it is
    from mutagen.id3 import GEOB
    legacy = C.encode_markers_v1([], b'\x00\xff\xff\xff')
    tags = ID3(mp3c)
    tags.add(GEOB(encoding=0, mime='application/octet-stream', desc='Serato Markers_', data=legacy))
    tags.save(mp3c, v1=1, padding=lambda info: 4096)
    before[mp3c] = sha(mp3c)
    audio[mp3c] = C.audio_fingerprint(mp3c)
    ident[mp3c] = C._stat(mp3c)

    # ---------------------------------------------------------------- a song that already has Serato cues is skipped and not touched
    tags = ID3(mp3b)
    tags.add(GEOB(encoding=0, mime='application/octet-stream', desc='Serato Markers2', data=C.encode_markers2([{'index': 0, 'ms': 777, 'color': 'CC0000', 'name': 'Mine'}])))
    tags.save(mp3b, v1=1, padding=lambda info: 4096)
    before[mp3b] = sha(mp3b)
    audio[mp3b] = C.audio_fingerprint(mp3b)
    # an MP4 whose Markers2 holds a track colour but no cues: filled, and the colour is kept
    mp4tags = MP4(mp4b)
    from mutagen.mp4 import MP4FreeForm
    mp4tags.tags[C.ATOM_V2] = [MP4FreeForm(C._atom_value(C.HEAD_V2, C.encode_markers2([], [('COLOR', b'\x00\x12\x34\x56')])), dataformat=1)]
    mp4tags.save(padding=lambda info: 4096)
    before[mp4b] = sha(mp4b)
    audio[mp4b] = C.audio_fingerprint(mp4b)
    ident[mp4b] = C._stat(mp4b)
    paths = [mp3, mp3b, mp3c, m4a, mp4, mp4b]
    plan = C.preview({'tracks': paths})
    rows = {os.path.basename(r['path']): r for r in plan['songs']}
    assert not rows['two.mp3']['will_write'] and 'already has 1 cue' in rows['two.mp3']['skip_reason'], rows['two.mp3']
    assert all(rows[n]['will_write'] for n in ('one.mp3', 'three.mp3', 'four.m4a', 'five.mp4', 'six.mp4')), plan['counts']
    digest = plan['digest']
    check_raises(C.SeratoCueError, lambda: C.apply({'tracks': paths, 'digest': 'not-the-digest'}), 'stale')
    assert {p: sha(p) for p in paths} == before

    # ---------------------------------------------------------------- apply
    done = C.apply({'tracks': paths, 'digest': digest})
    assert done['written'] == 5 and done['failed'] == [] and done['backup_id'], done
    assert sha(mp3b) == before[mp3b], 'a song with cues was changed'
    for path in (mp3, mp3c, m4a, mp4, mp4b):
        now = C.inspect(path)
        assert sorted(now['cues']) == sorted(WANT if path != mp3c else [(2, 2000, '0000CC', 'VDJ')]), (path, now['cues'])
        assert C.audio_fingerprint(path) == audio[path], 'audio stream changed: ' + path
        assert all(C._stat(path)[k] == ident[path][k] for k in ('size', 'ino', 'mtime_ns', 'created')), ('identity changed', path)
        assert os.path.getsize(path) == ident[path]['size']
        assert sha(path) != before[path]
    assert [n for n, _ in C.inspect(mp3)['entries']] == ['COLOR', 'CUE', 'CUE', 'CUE', 'BPMLOCK']
    # the MP3: other tags and the ID3v1 tag are as they were; a legacy Markers_ tag is the same bytes
    tags = ID3(mp3)
    assert str(tags['TIT2']) == 'Test Song' and str(tags['TPE1']) == 'Test Artist' and open(mp3, 'rb').read()[-128:] == v1_before
    assert bytes(ID3(mp3c)['GEOB:Serato Markers_'].data) == legacy and 'GEOB:Serato Markers2' in ID3(mp3c)
    # MP4 / M4A: both atoms are written (the legacy one only when it was missing), tags and length are as they were
    for path in (m4a, mp4):
        atoms = MP4(path).tags
        assert C.ATOM_V2 in atoms and C.ATOM_V1 in atoms and str(atoms['\xa9nam'][0]).startswith('Test'), path
        assert abs(MP4(path).info.length - length_before[path]) < 0.001
    assert C.inspect(mp4)['v1_cues'] == 2 and C.inspect(mp4)['has_v1']
    assert ('COLOR', b'\x00\x12\x34\x56') in C.inspect(mp4b)['entries'], 'the track colour was lost'
    assert not [p for p in work.rglob('*.tmp')], 'a temp file was left'
    # nothing is offered twice
    after = C.preview({'tracks': paths})
    assert after['counts']['songs_to_write'] == 0 and all(r['existing_cues'] for r in after['songs']), after['counts']
    assert C.apply({'tracks': paths})['written'] == 0

    # ---------------------------------------------------------------- undo: byte-identical
    receipt = pathlib.Path(root / done['backup_id'] / 'receipt.json')
    assert receipt.is_file() and len(list((root / done['backup_id'] / 'files').iterdir())) == 5
    state['open'] = True
    check_raises(C.SeratoCueError, lambda: C.undo(done['backup_id']), 'serato_open')
    state['open'] = False
    assert sha(mp3) != before[mp3]
    undone = C.undo(done['backup_id'])
    assert undone['success'] and len(undone['restored']) == 5 and undone['skipped'] == [], undone
    assert {p: sha(p) for p in paths} == before, 'undo is not byte identical'
    check_raises(C.SeratoCueError, lambda: C.undo(done['backup_id']), 'bad_request')
    # a song changed after the write is not restored over
    again = C.apply({'tracks': [mp3]})
    with open(mp3, 'ab') as handle:
        handle.write(b'\x00')
    partial = C.undo(again['backup_id'])
    assert not partial['success'] and len(partial['skipped']) == 1 and partial['restored'] == []


    # ---------------------------------------------------------------- no room in the tag
    tight3, tight4 = make('tight.mp3', 'mp3', pad=False), make('tight.mp4', 'mp4', pad=False)
    fast4 = make('fast.mp4', 'mp4', pad=False, extra=('-movflags', '+faststart'))  # moov before mdat: every sample offset moves
    same = lambda p: (sha(p), {k: v for k, v in C._stat(p).items() if k != 'atime_ns'})  # reading may touch the access time
    tight_before = {p: same(p) for p in (tight3, tight4, fast4)}
    C.configure(readers={**C._state['readers'], 'peakhour': lambda p: CUES})
    # growing switched off: the song is skipped and not touched
    plan = C.preview({'tracks': [tight3, tight4, fast4], 'allow_grow': False})
    assert plan['counts']['songs_to_write'] == 0 and all('growing the file is switched off' in r['skip_reason'] for r in plan['songs']), plan['songs']
    off = C.apply({'tracks': [tight3, tight4, fast4], 'allow_grow': False})
    assert off['written'] == 0 and off['backup_id'] == '' and {p: same(p) for p in tight_before} == tight_before
    assert C.digest({'tracks': [tight3]}) != C.digest({'tracks': [tight3], 'allow_grow': False})
    # even if the preview were skipped, the writer itself does not grow a song it was not told to grow
    row = {'path': tight3, 'signature': [C._stat(tight3)['size'], C._stat(tight3)['mtime_ns']], 'cues': C._clean(CUES)}
    scratch = root / 'direct'
    (scratch / 'files').mkdir(parents=True)
    check_raises(C.SeratoCueError, lambda: C._write_one(row, scratch, 0, {'files': []}), 'no_space')
    assert {p: same(p) for p in tight_before} == tight_before, 'a tight song was changed'

    # ---------------------------------------------------------------- ...and by default it grows, keeping its identity, date and sound
    def pcm(path):  # an md5 of the whole decoded sound
        done = subprocess.run([FFMPEG, '-v', 'error', '-i', path, '-map', '0:a:0', '-vn', '-f', 'md5', '-'], capture_output=True)
        assert done.returncode == 0 and b'MD5=' in done.stdout, done.stderr
        return done.stdout
    import windows_dj_write_queue as Q
    import json
    import time as _time
    def wait_for(condition, seconds=10):
        end = _time.time() + seconds
        while _time.time() < end:
            if condition():
                return
            _time.sleep(0.05)
        raise AssertionError('timed out waiting')
    class FakeVdj:
        appliers = {('virtualdj', 'filesize_sync'): None}
        def __init__(self):
            self.jobs = []
        def submit(self, program, kind, payload):
            self.jobs.append((program, kind, payload))
            return {'queued': False, 'applied': True, 'result': {'written': len(payload['songs'])}}
    fake_vdj = FakeVdj()
    Q.QUEUE = fake_vdj
    songs3 = [tight3, tight4, fast4]
    sound = {p: pcm(p) for p in songs3}
    stat0 = {p: C._stat(p) for p in songs3}
    plan = C.preview({'tracks': songs3})
    assert plan['counts']['songs_to_write'] == 3 and plan['counts']['songs_growing'] == 3, plan['counts']
    grows = {r['path']: r['grows_by'] for r in plan['songs']}
    assert all(0 < n <= C.MAX_GROW for n in grows.values()) and all('file grows by' in r['mode'] for r in plan['songs']), plan['songs']
    grown = C.apply({'tracks': songs3})
    assert grown['written'] == 3 and grown['grown'] == 3 and not grown['failed'] and not grown['skipped_now'], grown
    for p in songs3:
        now = C._stat(p)
        assert now['size'] == stat0[p]['size'] + grows[p], (p, now['size'], stat0[p]['size'], grows[p])
        assert now['ino'] == stat0[p]['ino'] and now['created'] == stat0[p]['created'] and now['mtime_ns'] == stat0[p]['mtime_ns'], p
        assert pcm(p) == sound[p], 'the sound changed: ' + p
        assert C.inspect(p)['cues'] and C.audio_fingerprint(p)[0] == C.audio_fingerprint(p)[0]
    assert sorted(C.inspect(tight3)['cues']) == sorted(WANT)
    # the next edit finds room: a second song written later fits in place (the tag was grown with spare padding)
    assert C._tag_delta(tight3, C._clean(CUES), {**C.inspect(tight3), 'cues': [], 'entries': []}, 'mp3', b'\xff\xff\xff', False) == 0
    # VirtualDJ's file sizes follow: recorded as pending in the receipt, then handed to the queue by a background thread
    assert grown['virtualdj_sync']['state'] == 'pending'
    wait_for(lambda: fake_vdj.jobs)
    program, kind, payload = fake_vdj.jobs[-1]
    assert (program, kind) == ('virtualdj', 'filesize_sync')
    wait_for(lambda: json.loads((root / grown['backup_id'] / 'receipt.json').read_text(encoding='utf-8'))['virtualdj_sync']['state'] == 'done')
    assert sorted((s['path'], s['old_size'], s['new_size']) for s in payload['songs']) == \
        sorted((p, stat0[p]['size'], stat0[p]['size'] + grows[p]) for p in songs3), payload
    # undo is byte identical (size, identity, dates) and sends the reverse sizes
    fake_vdj.jobs.clear()
    back = C.undo(grown['backup_id'])
    assert back['success'] and len(back['restored']) == 3, back
    wait_for(lambda: fake_vdj.jobs)
    for p in songs3:
        assert same(p) == tight_before[p] and C._stat(p)['ino'] == stat0[p]['ino'] and C._stat(p)['created'] == stat0[p]['created'], p
        assert pcm(p) == sound[p]
    assert sorted((s['path'], s['old_size'], s['new_size']) for s in fake_vdj.jobs[-1][2]['songs']) == \
        sorted((p, stat0[p]['size'] + grows[p], stat0[p]['size']) for p in songs3)
    Q.QUEUE = None

    n1, n2 = make('n1.mp3', 'mp3'), make('n2.m4a', 'm4a')
    before.update({n1: sha(n1), n2: sha(n2)})
    ident.update({n1: C._stat(n1), n2: C._stat(n2)})
    # ---------------------------------------------------------------- per-song checks: a song that changed since the preview is skipped alone
    songs = [n1, n2]
    plan = C.preview({'tracks': songs})
    sigs = {r['path']: r['signature'] for r in plan['songs']}
    os.utime(n2, ns=(os.stat(n2).st_atime_ns, os.stat(n2).st_mtime_ns + 5_000_000_000))  # touched after the preview
    ident[n2] = C._stat(n2)
    result = C.apply({'tracks': songs, 'signatures': sigs, 'digest': C.digest({'tracks': songs})})
    assert result['written'] == 1 and [s['path'] for s in result['skipped_now']] == [n2] and not result['failed'], result
    assert C.digest({'tracks': songs}) == C.digest({'tracks': songs[::-1]}) != C.digest({'tracks': [n1]})
    assert C.digest({'tracks': 'all'}) == C.digest({'tracks': 'all'}) != C.digest({'tracks': songs})
    first = C.undo(result['backup_id'])
    assert first['success'] and {p: sha(p) for p in (n1,)}[n1] == before[n1] and C._stat(n1)['mtime_ns'] == ident[n1]['mtime_ns'] \
        and C._stat(n1)['ino'] == ident[n1]['ino'] and C._stat(n1)['size'] == ident[n1]['size'], first

    # ---------------------------------------------------------------- not enough free space for backups: refused, nothing written
    real_usage = C.shutil.disk_usage
    C.shutil.disk_usage = lambda p: C.shutil._ntuple_diskusage(10**12, 10**12 - 1000, 1000)
    try:
        err = check_raises(C.SeratoCueError, lambda: C.apply({'tracks': [n1]}), 'no_space')
    finally:
        C.shutil.disk_usage = real_usage
    assert 'free space' in str(err) and sha(n1) == before[n1] and C._stat(n1)['mtime_ns'] == ident[n1]['mtime_ns']

    # ---------------------------------------------------------------- an interrupted write: leftover temp removed, written songs undone
    crash = C.apply({'tracks': [n1]})
    assert crash['written'] == 1
    folder_ = root / crash['backup_id']
    leftover = folder_ / 'work' / '.one.mp3.peakhour-deadbeef.tmp'
    leftover.parent.mkdir(exist_ok=True)
    leftover.write_bytes(b'half a copy')
    import json as _json
    receipt_ = _json.loads((folder_ / 'receipt.json').read_text(encoding='utf-8'))
    receipt_.update(status='writing', pending_temp=str(leftover))
    (folder_ / 'receipt.json').write_text(_json.dumps(receipt_), encoding='utf-8')
    C.configure(root=root)  # "module start": unfinished receipts are cleaned up
    assert not leftover.exists(), 'the leftover temp file was not removed'
    redo = C.undo(crash['backup_id'])
    assert redo['success'] and len(redo['restored']) == 1 and sha(n1) == before[n1], redo
    assert C._stat(n1)['mtime_ns'] == ident[n1]['mtime_ns'] and C._stat(n1)['ino'] == ident[n1]['ino']
    assert not list(work.rglob('*.peakhour-*.tmp')), 'a temp file was left'


    # ---------------------------------------------------------------- a crash in the middle of the rewrite is put right (never guessed at)
    def settle():  # recovery runs on its own thread
        thread = C._state.get('recovery')
        if thread is not None:
            thread.join(20)
            assert not thread.is_alive(), 'recovery did not finish'

    def torn_write(name):
        """A song whose in-place rewrite was cut short (power loss): half the new bytes, no restore, receipt still 'writing'."""
        song = make(name, 'mp3', pad=False)
        original = (sha(song), C._stat(song))
        real_rewrite, real_restore = C._rewrite_in_place, C._restore_in_place
        def half(handle, source):
            data = open(source, 'rb').read()
            handle.seek(0)
            handle.write(data[:len(data) // 2])
            handle.flush()
            raise RuntimeError('power loss (test)')
        C._rewrite_in_place = half
        C._restore_in_place = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('power loss (test)'))
        try:
            result = C.apply({'tracks': [song]})
        finally:
            C._rewrite_in_place, C._restore_in_place = real_rewrite, real_restore
        assert result['written'] == 0 and sha(song) != original[0], 'the song should be torn'
        receipt_file = max((p for p in root.glob('*/receipt.json')), key=lambda p: p.stat().st_mtime)
        receipt = json.loads(receipt_file.read_text(encoding='utf-8'))
        assert [e['status'] for e in receipt['files']] == ['patching'], receipt['files']
        receipt['status'] = 'writing'
        receipt_file.write_text(json.dumps(receipt), encoding='utf-8')
        return song, original, receipt['id']
    crash_a, original_a, id_a = torn_write('crash-a.mp3')
    before_count = C._state['recovered']
    state['open'] = True
    C.configure(root=root)  # Serato open: nothing is touched
    settle()
    assert sha(crash_a) != original_a[0] and C._state['recovered'] == before_count
    state['open'] = False
    C.configure(programs=lambda: {'virtualdj'})
    C.configure(root=root)  # another DJ program open: nothing is touched either
    settle()
    assert sha(crash_a) != original_a[0] and C._state['recovered'] == before_count
    C.configure(programs=lambda: set())
    C.configure(root=root)  # "module start": the interrupted write is restored from its verified backup, on its own thread
    settle()
    assert sha(crash_a) == original_a[0] and C._state['recovered'] == before_count + 1, 'not recovered'
    assert C._stat(crash_a)['ino'] == original_a[1]['ino'] and C._stat(crash_a)['mtime_ns'] == original_a[1]['mtime_ns']
    assert list(root.glob(f'{id_a}/files/pre-restore-*')), 'the song as it was found was not kept'
    assert C.preview({'tracks': [crash_a]})['recovered_after_interrupt'] == before_count + 1

    # a song edited after the crash (later modified time) is NOT overwritten: it needs attention, a copy is kept
    crash_c, original_c, id_c = torn_write('crash-c.mp3')
    later = C._stat(crash_c)['mtime_ns'] + 3600 * 10 ** 9
    os.utime(crash_c, ns=(later, later))
    edited = sha(crash_c)
    C.configure(root=root)
    settle()
    assert sha(crash_c) == edited and C._state['recovered'] == before_count + 1, 'a later edit was overwritten'
    attention = C.attention_list(root)
    assert [a['song'] for a in attention] == [crash_c] and pathlib.Path(attention[0]['copy']).is_file(), attention
    assert sha(attention[0]['copy']) == edited and 'changed after' in attention[0]['reason']
    probe = __import__('flask').Flask(__name__)
    probe.register_blueprint(C.create_blueprint(None, root))
    status = probe.test_client().get('/api/windows/serato/cues/status').get_json()
    assert [a['song'] for a in status['needs_attention']] == [crash_c], status
    err = check_raises(C.SeratoCueError, lambda: C.undo(id_c), 'confirm_needed')  # undo asks first
    assert 'overwrites those changes' in str(err) and sha(crash_c) == edited
    assert C.undo(id_c, True)['success'] and sha(crash_c) == original_c[0]
    assert not C.attention_list(root)

    crash_b, original_b, id_b = torn_write('crash-b.mp3')
    undone = C.undo(id_b)  # a plain torn write is restored from the verified backup by undo as well
    assert undone['success'] and sha(crash_b) == original_b[0], undone

    # ---------------------------------------------------------------- the song is open in another program: skipped, not touched
    busy = make('busy.mp3', 'mp3', pad=False)
    busy_before = same(busy)
    holder = open(busy, 'rb')
    try:
        result = C.apply({'tracks': [busy]})
    finally:
        holder.close()
    assert result['written'] == 0 and any('open in another program' in s['reason'] for s in result['skipped_now']), result
    assert same(busy) == busy_before and not list(root.glob('*/files/*busy*')), 'a skipped song left a backup or changed'
    assert C.apply({'tracks': [busy]})['written'] == 1  # once it is closed it is written

    # ---------------------------------------------------------------- growing while a DJ program is open: nothing is written, the job is only appended
    import threading
    class QueueStub:
        def __init__(self):
            self.jobs, self.appliers = [], {('serato', 'cues'): (C.apply, C.digest)}
        def enqueue(self, program, kind, payload):
            self.jobs.append((program, kind, payload))
            return {'queued': True, 'id': 'job1'}
        def submit(self, *args):
            raise AssertionError('apply must never submit to the queue itself')
        def program_lock(self, program):
            return threading.RLock()
        def is_running(self, program):
            return False
    stub = QueueStub()
    Q.QUEUE = stub
    C.configure(programs=lambda: {'virtualdj'})
    waiting = make('waiting.mp3', 'mp3', pad=False)
    padded = make('padded.mp3', 'mp3')
    waiting_before = same(waiting)
    err = check_raises(C.SeratoNeedsQueue, lambda: C.apply({'tracks': [waiting], 'confirm': True}))
    assert err.code == 'dj_open' and 'confirm' not in err.payload and same(waiting) == waiting_before and not stub.jobs
    assert C.apply({'tracks': [padded]})['written'] == 1  # a song that fits is written in place, DJ program or not
    probe = __import__('flask').Flask(__name__)
    probe.register_blueprint(C.create_blueprint(None, root))
    reply = probe.test_client().post('/api/windows/serato/cues/apply', json={'tracks': [waiting], 'confirm': True}, headers={'Origin': 'http://localhost'})
    assert reply.status_code == 202 and reply.get_json()['queued'] and stub.jobs[-1][:2] == ('serato', 'cues'), (reply.status_code, reply.get_json())
    assert 'confirm' not in stub.jobs[-1][2] and same(waiting) == waiting_before
    assert ('virtualdj', 'serato_cues') not in stub.appliers and list(stub.appliers) == [('serato', 'cues')]
    C.configure(programs=lambda: set())
    Q.QUEUE = None

    # a queued job survives a restart (new queue object on the same file), and runs once no DJ program is open
    open_programs = {'virtualdj'}
    C.configure(programs=lambda: set(open_programs))
    queue_file = work / 'restart-queue.json'
    first = Q.DJWriteQueue(queue_file, snapshot=lambda: [(1, 'VirtualDJ.exe')], settles={}, closed_seconds=0)
    C.register_with_queue(first)
    assert sorted(first.appliers) == [('serato', 'cues')], sorted(first.appliers)
    Q.QUEUE = first
    survivor = make('survivor.mp3', 'mp3', pad=False)
    surv_before = C._stat(survivor)
    outcome = first.enqueue('serato', 'cues', {'tracks': [survivor]})
    assert outcome['queued']
    second = Q.DJWriteQueue(queue_file, snapshot=lambda: [(1, 'explorer.exe')], settles={}, closed_seconds=0)  # "restart"
    C.register_with_queue(second)
    Q.QUEUE = second
    assert [j['status'] for j in second.list()][:1] == ['queued']
    open_programs.clear()
    second.tick()
    second.tick()
    job = second.list()[0]
    assert job['status'] == 'done', job
    now = C._stat(survivor)
    assert now['size'] > surv_before['size'] and now['ino'] == surv_before['ino'] and C.inspect(survivor)['cues']
    Q.QUEUE = None

    # no deadlock when the program closes between the running check and the enqueue (the route holds no lock while enqueueing)
    calls = []
    def closes_in_between():
        calls.append(1)
        return {'virtualdj'} if len(calls) == 1 else set()
    C.configure(programs=closes_in_between)
    racer = make('racer.mp3', 'mp3', pad=False)
    live = Q.DJWriteQueue(work / 'race-queue.json', snapshot=lambda: [(1, 'explorer.exe')], settles={}, closed_seconds=0)
    C.register_with_queue(live)
    Q.QUEUE = live
    app_probe = __import__('flask').Flask(__name__)
    app_probe.register_blueprint(C.create_blueprint(None, root))
    answer = {}
    def post():
        answer['reply'] = app_probe.test_client().post('/api/windows/serato/cues/apply', json={'tracks': [racer], 'confirm': True},
                                                      headers={'Origin': 'http://localhost'})
    worker = threading.Thread(target=post, daemon=True)
    worker.start()
    worker.join(30)
    assert not worker.is_alive(), 'the apply route hung'
    assert answer['reply'].status_code == 202 and answer['reply'].get_json()['queued'], answer['reply'].get_json()
    live.tick()
    live.tick()
    assert live.list()[0]['status'] == 'done' and C.inspect(racer)['cues']
    C.configure(programs=lambda: set())
    Q.QUEUE = None

    # ---------------------------------------------------------------- the DJ write queue and the routes
    class FakeQueue:
        def __init__(self):
            self.registered = {}
        def register(self, program, kind, apply_fn, preview_fn=None):
            self.registered[(program, kind)] = (apply_fn, preview_fn)
    fake = FakeQueue()
    C.register_with_queue(fake)
    assert fake.registered[('serato', 'cues')] == (C.apply, C.digest)
    from windows_dj_write_queue import DJWriteQueue
    queue = DJWriteQueue(work / 'queue.json', snapshot=lambda: [(1, 'explorer.exe')], settles={})
    C.register_with_queue(queue)
    third = {'tracks': [m4a]}
    first = queue.submit('serato', 'cues', third)
    assert first['applied'] and first['result']['written'] == 1, first
    queue.snapshot = lambda: [(9, 'Serato DJ Pro.exe')]
    waiting = queue.submit('serato', 'cues', {'tracks': [mp4]})
    assert waiting['queued'] and queue.list()[0]['preview_digest'], waiting

    from flask import Flask
    flask_app = Flask(__name__)
    flask_app.register_blueprint(C.create_blueprint(None, root))
    client = flask_app.test_client()
    origin = {'Origin': 'http://localhost'}
    body = {'tracks': [mp3b]}  # has cues of its own: nothing to write
    assert client.post('/api/windows/serato/cues/preview', json=body, headers=origin).get_json()['counts']['songs_to_write'] == 0
    assert client.post('/api/windows/serato/cues/preview', json=body).status_code == 403, 'cross-site request accepted'
    assert client.post('/api/windows/serato/cues/apply', json=body, headers=origin).status_code == 400, 'apply without confirm'
    undo_first = client.post('/api/windows/serato/cues/undo', json={'backup_id': first['result']['backup_id']}, headers=origin)
    assert undo_first.status_code == 200 and undo_first.get_json()['success'], undo_first.get_json()
    state['open'] = True
    blocked = client.post('/api/windows/serato/cues/apply', json={'tracks': [m4a], 'confirm': True}, headers=origin)
    assert blocked.status_code == 409 and blocked.get_json()['code'] == 'serato_open', blocked.get_json()
    state['open'] = False
    ok = client.post('/api/windows/serato/cues/apply', json={'tracks': [m4a], 'confirm': True}, headers=origin)
    assert ok.status_code == 200 and ok.get_json()['written'] == 1, ok.get_json()

    print('PASS: Serato cues for MP3, MP4 and M4A (layout = Serato DJ Pro 5 bytes, only songs without cues, audio stream unchanged, '
          'undo byte-identical, serato_open, preview writes nothing, queue and routes)')
    shutil.rmtree(work, ignore_errors=True)
except BaseException:
    traceback.print_exc()
    sys.exit(1)
