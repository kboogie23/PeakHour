"""VirtualDJ file-size sync (windows_virtualdj_filesize) on a SYNTHETIC database.xml built from real <Song> elements.

The <Song> text comes from the owner's discovery copy of VirtualDJ's database (read only); every write goes to a temp folder.
"""
import json, os, pathlib, re, shutil, sys, tempfile, time, traceback
here = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(here / 'axiom-win-probe'))
SOURCE = pathlib.Path(r'C:\Users\gatli\AppData\Local\Temp\claude\f4654d8614da80ab\3659b411-6843-41fd-a174-ae16523e1f95\scratchpad'
                      r'\discovery\after\vdj-db\home-database.xml')
FALLBACK = ''.join(f' <Song FilePath="{p}" FileSize="{s}" Flag="16">\r\n  <Tags Author="A" Title="T{i}" />\r\n  <Infos SongLength="10.00" />\r\n </Song>\r\n'
                   for i, (p, s) in enumerate((('/Volumes/X/a.mp4', 111), ('/Volumes/X/b &amp; c.mp4', 222), ('/Volumes/X/d.mp3', 333))))
try:
    import windows_virtualdj_filesize as F
    from windows_dj_write_queue import DJWriteQueue
    work = pathlib.Path(tempfile.mkdtemp(prefix='peakhour-vdj-size-'))

    def check_raises(code, call):
        try:
            call()
        except F.VirtualDJSizeError as exc:
            assert exc.code == code, (code, exc.code, str(exc))
            return exc
        raise AssertionError('expected ' + code)

    # three real <Song> elements (with a FileSize) from the discovery copy, re-pathed to Windows paths
    songs = re.findall(r'<Song FilePath="[^"]*" FileSize="\d+"[^>]*>.*?</Song>\r?\n', SOURCE.read_text(encoding='utf-8')[:400000], re.S)[:3] \
        if SOURCE.is_file() else []
    if len(songs) < 3:
        songs = re.findall(r' <Song .*?</Song>\r\n', FALLBACK, re.S)
    songs = [re.sub(r'FilePath="[^"]*"', lambda m, i=i: f'FilePath="D:\\Music\\Song {i} &amp; more.mp3"', s, count=1) for i, s in enumerate(songs)]
    sizes = [int(re.search(r'FileSize="(\d+)"', s).group(1)) for s in songs]
    head = '<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualDJ_Database Version="2023">\r\n'
    other = ' <Song FilePath="netsearch://bs451373" Flag="256">\r\n  <Tags Author="x" />\r\n </Song>\r\n'
    home_text = head + other + ''.join(songs) + '</VirtualDJ_Database>\r\n'
    drive_text = head + songs[0] + '</VirtualDJ_Database>\r\n'  # the drive's own database holds the first song too
    home, drive = work / 'home' / 'database.xml', work / 'D' / 'database.xml'
    for path, text in ((home, home_text), (drive, drive_text)):
        path.parent.mkdir()
        path.write_bytes(text.encode('utf-8'))
    open_now = {'value': False}
    F.configure(root=work / 'receipts', databases=lambda: [home, drive],
                ensure_closed=lambda: (_ for _ in ()).throw(RuntimeError('Quit VirtualDJ, then try again.')) if open_now['value'] else None)
    wanted = {'songs': [{'path': 'D:\\Music\\Song 0 & more.mp3', 'old_size': sizes[0], 'new_size': sizes[0] + 1500},
                        {'path': 'd:\\music\\SONG 1 & MORE.mp3', 'old_size': sizes[1] + 1, 'new_size': sizes[1] + 7},  # wrong old size
                        {'path': 'D:\\Music\\not in vdj.mp3', 'old_size': 5, 'new_size': 6}]}

    # preview and digest write nothing
    before = {p: p.read_bytes() for p in (home, drive)}
    plan = F.preview(wanted)
    assert [d['songs'] for d in plan['databases']] == [1, 1] and len(plan['skipped']) == 2, plan
    reasons = {s['path']: s['reason'] for s in plan['skipped']}
    assert 'left alone' in reasons['d:\\music\\SONG 1 & MORE.mp3'] and "not in VirtualDJ's database" in reasons['D:\\Music\\not in vdj.mp3']
    assert {p: p.read_bytes() for p in (home, drive)} == before and not (work / 'receipts').exists()
    assert F.digest(wanted) == F.digest(json.loads(json.dumps(wanted))) != F.digest({'songs': wanted['songs'][:1]})

    # VirtualDJ open: refused (and the queue holds the job until it closes)
    open_now['value'] = True
    check_raises('virtualdj_open', lambda: F.apply(wanted))
    assert {p: p.read_bytes() for p in (home, drive)} == before
    queue = DJWriteQueue(work / 'queue.json', snapshot=lambda: [(1, 'VirtualDJ.exe')] if open_now['value'] else [(1, 'explorer.exe')],
                         settles={}, closed_seconds=0)
    F.register_with_queue(queue)
    assert ('virtualdj', 'filesize_sync') in queue.appliers
    waiting = queue.submit('virtualdj', 'filesize_sync', wanted)
    assert waiting.get('queued') and {p: p.read_bytes() for p in (home, drive)} == before, waiting
    open_now['value'] = False
    queue.tick()
    queue.tick()
    job = [j for j in queue.list() if j['id'] == waiting['id']][0]
    assert job['status'] == 'done', job

    # only the FileSize digits of the matching song changed, in both databases; everything else is byte identical
    new_size = sizes[0] + 1500
    expect_home = home_text.replace(songs[0], re.sub(r'FileSize="\d+"', f'FileSize="{new_size}"', songs[0], count=1))
    expect_drive = drive_text.replace(songs[0], re.sub(r'FileSize="\d+"', f'FileSize="{new_size}"', songs[0], count=1))
    assert home.read_bytes() == expect_home.encode('utf-8') and drive.read_bytes() == expect_drive.encode('utf-8')
    assert len(home.read_bytes()) - len(before[home]) == len(str(new_size)) - len(str(sizes[0]))

    # a second run finds the old size gone: nothing changes
    again = F.apply(wanted)
    assert again['written'] == 0 and again['skipped'] and home.read_bytes() == expect_home.encode('utf-8')

    # undo is exact, and refused once VirtualDJ has changed the file
    receipts = sorted((work / 'receipts').iterdir())
    assert len(receipts) == 1
    rid = receipts[0].name
    changed = expect_home.replace('Title="T', 'Title="U', 1) if 'Title="T' in expect_home else expect_home + ' '
    home.write_bytes(changed.encode('utf-8'))
    check_raises('changed', lambda: F.undo(rid))
    home.write_bytes(expect_home.encode('utf-8'))
    open_now['value'] = True
    check_raises('virtualdj_open', lambda: F.undo(rid))
    open_now['value'] = False
    assert F.undo(rid)['success'] and {p: p.read_bytes() for p in (home, drive)} == before, 'undo is not exact'
    check_raises('bad_request', lambda: F.undo(rid))
    check_raises('bad_request', lambda: F.apply({'songs': []}))
    check_raises('bad_request', lambda: F.apply({'songs': [{'path': 'D:\\x.mp3', 'old_size': 'big', 'new_size': 1}]}))
    assert not list(work.rglob('*.tmp')) or all(p.name == 'queue.json.tmp' for p in work.rglob('*.tmp'))

    # numeric XML entities in a path (&#39; &#x41;), and an unreadable database is reported, not silently ignored
    ent = work / 'ent' / 'database.xml'
    ent.parent.mkdir()
    ent_text = head + ' <Song FilePath="D:\\Music\\It&#39;s &#x41; &amp; mix.mp3" FileSize="1000" Flag="0">\r\n  <Tags Author="x" />\r\n </Song>\r\n</VirtualDJ_Database>\r\n'
    ent.write_bytes(ent_text.encode('utf-8'))
    bad = work / 'bad' / 'database.xml'
    bad.parent.mkdir()
    bad.write_bytes(b'<?xml version="1.0"?>\xff\xfe not utf-8')
    F.configure(databases=lambda: [ent, bad])
    res = F.apply({'songs': [{'path': "D:\\Music\\It's A & mix.mp3", 'old_size': 1000, 'new_size': 1234}]})
    assert res['written'] == 1 and [d['database'] for d in res['databases_skipped']] == [str(bad)], res
    assert ent.read_bytes() == ent_text.replace('FileSize="1000"', 'FileSize="1234"').encode('utf-8')

    # backups: only the newest 5 per database are kept
    F.configure(databases=lambda: [ent], root=work / 'receipts2')
    size = 1234
    for _ in range(7):
        F.apply({'songs': [{'path': "D:\\Music\\It's A & mix.mp3", 'old_size': size, 'new_size': size + 1}]})
        size += 1
        time.sleep(0.01)
    kept = [p for p in (work / 'receipts2').rglob('*-database.xml')]
    assert len(kept) == F.KEEP_BACKUPS, len(kept)

    # a big database (about 60 MB) is planned, checked and written quickly, and everything but the digits is untouched
    count = 150000
    body = ''.join(f' <Song FilePath="D:\\Big\\song {i} &amp; more.mp3" FileSize="{5000000 + i}" Flag="0">\r\n'
                   f'  <Tags Author="Artist {i}" Title="Title {i}" Genre="Hip Hop" />\r\n'
                   f'  <Infos SongLength="200.0" LastModified="1700000000" FirstSeen="1700000000" Bitrate="320" />\r\n'
                   f'  <Scan Version="801" Bpm="0.5" AltBpm="0.25" Volume="0.9" Key="Am" Flag="32" />\r\n </Song>\r\n' for i in range(count))
    big = work / 'big' / 'database.xml'
    big.parent.mkdir()
    big_text = head + body + '</VirtualDJ_Database>\r\n'
    big.write_bytes(big_text.encode('utf-8'))
    ids = [10, 5000, 75000, 149999]
    F.configure(databases=lambda: [big], root=work / 'receipts3')
    started = time.time()
    res = F.apply({'songs': [{'path': f'D:\\Big\\song {i} & more.mp3', 'old_size': 5000000 + i, 'new_size': 5000000 + i + 2048} for i in ids]})
    seconds = time.time() - started
    assert res['written'] == 4 and not res['skipped'], res
    expected = big_text
    for i in ids:
        expected = expected.replace(f'FileSize="{5000000 + i}"', f'FileSize="{5000000 + i + 2048}"', 1)
    assert big.read_bytes() == expected.encode('utf-8')
    assert seconds < 30, f'a {len(big_text) // 2**20} MB database took {seconds:.1f} s'
    print(f'note: {len(big_text) // 2**20} MB database, 4 edits: {seconds:.1f} s')

    print('PASS: VirtualDJ file-size sync changes only FileSize of matching songs (byte-identical elsewhere), skips mismatches, '
          'waits in the queue while VirtualDJ is open, and undoes exactly')
    shutil.rmtree(work, ignore_errors=True)
except BaseException:
    traceback.print_exc()
    sys.exit(1)
