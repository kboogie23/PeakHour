"""Serato crate folders (subcrates): database rows, legacy .crate files and neworder.pref, on a SANDBOX location.sqlite.

The sandbox is built from the schema of a real Serato DJ Pro 5 location.sqlite (test_serato_location_schema.sql) with the
rows Serato had after the owner's "PH Parent" > "PH child" session. Nothing outside fixtures/ is written.
"""
import os, sys, pathlib, uuid, sqlite3, hashlib, traceback
s = (pathlib.Path(__file__).resolve().parent / 'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
# The 468-byte "PH Parent%%PH child.crate" Serato DJ Pro 5 wrote for VIDEO/MP4/Nick Cannon - Dance Floor (Quick Hit Clean).mp4
REAL_CRATE = bytes.fromhex(
    '7672736e000000380031002e0030002f00530065007200610074006f00200053006300720061007400630068004c00690076006500200043'
    '00720061007400656f7663740000001e7476636e000000080073006f006e006774766377000000060032003500306f766374000000227476'
    '636e0000000c00610072007400690073007474766377000000060032003500306f7663740000001a7476636e0000000600620070006d7476'
    '637700000004003300306f7663740000001a7476636e00000006006b006500797476637700000004003300306f766374000000207476636e'
    '0000000a0061006c00620075006d74766377000000060032003500306f766374000000227476636e0000000c006c0065006e006700740068'
    '74766377000000060032003500306f766374000000247476636e0000000e0063006f006d006d0065006e0074747663770000000600320035'
    '00306f74726b0000007a7074726b000000720056004900440045004f002f004d00500034002f004e00690063006b002000430061006e006e'
    '006f006e0020002d002000440061006e0063006500200046006c006f006f0072002000280051007500690063006b00200048006900740020'
    '0043006c00650061006e0029002e006d00700034')
REAL_PATH = 'VIDEO/MP4/Nick Cannon - Dance Floor (Quick Hit Clean).mp4'
try:
    from windows_bootstrap import build_backend
    import windows_serato_library as S, windows_serato_export as X, windows_crate_publish as P
    folder = workspace / 'fixtures' / 'serato-folders' / uuid.uuid4().hex
    folder.mkdir(parents=True)
    app = build_backend(recording_settings=folder / 'settings.json', recording_directory=folder)

    def check_raises(kind, call, code=None):
        try:
            call()
        except kind as exc:
            assert code is None or getattr(exc, 'code', None) == code, (code, exc)
            return exc
        raise AssertionError('expected ' + kind.__name__)

    # The reference crate layout (decoded from Serato's own file) is reproduced byte for byte
    assert len(REAL_CRATE) == 468 and P.legacy_crate_bytes([REAL_PATH]) == REAL_CRATE
    assert P.legacy_crate_name(['PH Parent', 'PH child']) == 'PH Parent%%PH child.crate'

    def make_library(name):
        """A sandbox drive: _Serato_\\Library\\location.sqlite as Serato left it, Subcrates, neworder.pref, 4 songs."""
        root = folder / name
        library = root / '_Serato_' / 'Library'
        library.mkdir(parents=True)
        music = root / 'Music'
        music.mkdir()
        songs = []
        for n, title in enumerate(('One', 'Two', 'Three', 'Four')):
            song = music / (title + '.mp3')
            song.write_bytes(b'x' * (100 + n))
            songs.append(str(song))
        db = library / 'location.sqlite'
        con = sqlite3.connect(db)
        con.executescript((workspace / 'test_serato_location_schema.sql').read_text(encoding='utf-8'))
        con.execute("INSERT INTO serato(database_name, time_created, revision) VALUES ('', 1, 135)")
        con.execute("INSERT INTO space(id, name, revision) VALUES (1, 'Serato Library', 135)")
        for row in ((0, 0, None, 'root', 0, 0, None, 0), (1, 1, 0, 'Serato Library root', 0, 1, 1, 0),
                    (2, 1, 1, 'Lexicon', 1, 1, 1, 0), (3, 1, 2, 'HIPHOP Party', 1, 1, 1, 1), (4, 1, 2, '2000s HIPHOP', 1, 2, 1, 1)):
            con.execute('INSERT INTO container(id, revision, parent_id, name, type, list_order, space_id, expanded, time_added, portable_id) '
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '')", (row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7]))
        for crate_id, file in ((2, 'Lexicon.crate'), (3, 'Lexicon%%HIPHOP Party.crate'), (4, 'Lexicon%%2000s HIPHOP.crate')):
            con.execute('INSERT INTO dj_container_metadata(container_id, revision, export_state, filename) VALUES (?, 1, 0, ?)', (crate_id, file))
        for song in songs[:3]:  # Serato already knows three of the four songs (with its own titles)
            con.execute("INSERT INTO asset(revision, portable_id, file_name, file_size, type, format, artist, name, key, bpm, time_added, time_modified) "
                        "VALUES (10, ?, ?, 100, 'audio', 'mp3', 'Serato Artist', ?, '8A', 120.0, 5, 5)",
                        (S.portable_id(song), os.path.basename(song), 'Serato Title ' + os.path.basename(song)))
            asset_id = con.execute('SELECT last_insert_rowid()').fetchone()[0]
            con.execute('INSERT INTO space_asset(asset_id, space_id, revision) VALUES (?, 1, 10)', (asset_id,))
        con.execute("INSERT INTO container_asset(revision, container_id, space_asset_id, list_order, time_added) VALUES (1, 3, 1, 1, 1)")
        con.commit()
        con.close()
        (root / '_Serato_' / 'Subcrates').mkdir()
        (root / '_Serato_' / 'Subcrates' / 'Lexicon.crate').write_bytes(b'lexicon crate, never touched')
        order = '[begin record]\n[crate]Lexicon\n[crate]Lexicon%%HIPHOP Party\n[crate]Lexicon%%2000s HIPHOP\n[end record]\n'
        (root / '_Serato_' / 'neworder.pref').write_bytes(order.encode('utf-16-be'))
        return root, db, songs

    def rows(db, sql, *args):
        con = sqlite3.connect(db.as_uri() + '?mode=ro', uri=True)
        try:
            return con.execute(sql, args).fetchall()
        finally:
            con.close()

    def dump(db):
        con = sqlite3.connect(db.as_uri() + '?mode=ro', uri=True)
        try:
            return list(con.iterdump())
        finally:
            con.close()

    def tree(root):
        """Every file under _Serato_ except Library/location.sqlite -> bytes (to prove what was and was not touched)."""
        base = root / '_Serato_'
        return {str(p.relative_to(base)): p.read_bytes() for p in sorted(base.rglob('*')) if p.is_file() and not p.name.endswith(('.sqlite', '.sqlite-shm'))}

    def members(db, container_id):
        return [r[0] for r in rows(db, 'SELECT a.portable_id FROM container_asset ca JOIN space_asset sa ON sa.id = ca.space_asset_id '
                                       'JOIN asset a ON a.id = sa.asset_id WHERE ca.container_id = ? ORDER BY ca.list_order', container_id)]

    def crate(db, parent_id, name):
        found = rows(db, 'SELECT id, revision, list_order, expanded, space_id, type FROM container WHERE parent_id = ? AND name = ?', parent_id, name)
        assert len(found) == 1, (name, found)
        return found[0]

    S.configure_folders(snapshot=lambda: [(1, 'explorer.exe')], ledger=folder / 'ledger.json', backups=folder / 'backups')

    # ---------------------------------------------------------------- two levels, all songs already in Serato
    root, db, songs = make_library('drive-a')
    ids = [S.portable_id(p) for p in songs]
    before_assets = rows(db, 'SELECT COUNT(*) FROM asset')[0][0]
    before_old = rows(db, 'SELECT * FROM container WHERE id <= 4 ORDER BY id')
    old_files = tree(root)
    result = S.write_crate_folder(app, [{'path': p, 'title': 'Peak Hour Title'} for p in songs[:3]], ['PH Parent', 'PH child'], database_path=db)
    assert result['success'] and result['verified_tracks'] == 3 and not result['unchanged'] and result['new_assets'] == 0, result
    assert result['created_crates'] == ['PH Parent', 'PH Parent%%PH child'], result
    parent = crate(db, 1, 'PH Parent')
    child = crate(db, parent[0], 'PH child')
    assert parent[2] == 2 and parent[3] == 1 and parent[4] == 1 and parent[5] == 1, parent  # after Lexicon, expanded, space 1, type 1
    assert child[2] == 1 and child[3] == 0 and child[4] == 1 and child[5] == 1, child
    assert parent[1] == child[1] == 136, (parent, child)  # the next revision after Serato's 135
    assert rows(db, 'SELECT revision FROM serato') == [(136,)]
    assert members(db, child[0]) == ids[:3] and members(db, parent[0]) == [], 'the parent holds no tracks'
    assert rows(db, 'SELECT filename FROM dj_container_metadata WHERE container_id IN (?, ?) ORDER BY container_id', parent[0], child[0]) == \
        [('PH Parent.crate',), ('PH Parent%%PH child.crate',)]
    assert rows(db, 'SELECT export_state FROM dj_container_metadata WHERE container_id = ?', child[0]) == [(0,)]
    assert rows(db, 'SELECT COUNT(*) FROM asset')[0][0] == before_assets, 'asset counts changed'
    assert rows(db, 'SELECT name FROM asset WHERE portable_id = ?', ids[0]) == [('Serato Title One.mp3',)], "Serato's own track data was kept"
    assert rows(db, 'SELECT * FROM container WHERE id <= 4 ORDER BY id') == before_old, 'existing crates changed'
    assert rows(db, 'PRAGMA integrity_check') == [('ok',)] and rows(db, 'PRAGMA foreign_key_check') == []
    # legacy files: the child's crate only; no crate file for the empty parent; Lexicon's file untouched
    crate_file = root / '_Serato_' / 'Subcrates' / 'PH Parent%%PH child.crate'
    assert crate_file.read_bytes() == P.legacy_crate_bytes(ids[:3]) and not (root / '_Serato_' / 'Subcrates' / 'PH Parent.crate').exists()
    assert (root / '_Serato_' / 'Subcrates' / 'Lexicon.crate').read_bytes() == old_files['Subcrates\\Lexicon.crate']
    one = P.legacy_crate_bytes([REAL_PATH])
    assert one == REAL_CRATE and crate_file.read_bytes().startswith(REAL_CRATE[:REAL_CRATE.index(b'otrk')]), 'header layout differs from the real crate'
    order = (root / '_Serato_' / 'neworder.pref').read_bytes()
    assert order.decode('utf-16-be') == ('[begin record]\n[crate]Lexicon\n[crate]Lexicon%%HIPHOP Party\n[crate]Lexicon%%2000s HIPHOP\n'
                                         '[crate]PH Parent\n[crate]PH Parent%%PH child\n[end record]\n'), order.decode('utf-16-be')
    assert order[:2] != b'\xfe\xff' and not list((root / '_Serato_').rglob('*.peakhour-*')), 'a BOM or stray temp file was left'
    assert pathlib.Path(result['backup_path']).is_file()

    # ---------------------------------------------------------------- idempotent re-run
    snapshot_before, db_before, files_before = dump(db), db.read_bytes(), tree(root)
    again = S.write_crate_folder(app, [{'path': p} for p in songs[:3]], ['PH Parent', 'PH child'], database_path=db)
    assert again['unchanged'] and again['created_crates'] == [] and again['exported_tracks'] == 3, again
    assert dump(db) == snapshot_before and tree(root) == files_before, 'a second identical export changed something'
    assert rows(db, 'SELECT revision FROM serato') == [(136,)]
    assert rows(db, 'SELECT COUNT(*) FROM container WHERE name = ?', 'PH Parent') == [(1,)]

    # ---------------------------------------------------------------- a crate PEAK HOUR made may be replaced without asking
    replaced = S.write_crate_folder(app, [{'path': p} for p in (songs[2], songs[0])], ['PH Parent', 'PH child'], database_path=db)
    assert replaced['replaced_existing'] and members(db, child[0]) == [ids[2], ids[0]], replaced
    assert (root / '_Serato_' / 'Subcrates' / 'PH Parent%%PH child.crate').read_bytes() == P.legacy_crate_bytes([ids[2], ids[0]])
    assert crate(db, parent[0], 'PH child')[0] == child[0] and crate(db, 1, 'PH Parent')[0] == parent[0]

    # ---------------------------------------------------------------- three levels, an existing parent is reused, a new song is added
    parent_row = rows(db, 'SELECT * FROM container WHERE id = ?', parent[0])
    deep = S.write_crate_folder(app, [{'path': p, 'title': 'Brand New'} for p in (songs[3], songs[1])], ['ph parent', 'Sub', 'Leaf'], database_path=db)
    assert deep['created_crates'] == ['PH Parent%%Sub', 'PH Parent%%Sub%%Leaf'] and deep['path_parts'] == ['PH Parent', 'Sub', 'Leaf'], deep
    assert rows(db, 'SELECT COUNT(*) FROM container WHERE name = ? COLLATE NOCASE', 'PH Parent') == [(1,)], 'the parent was duplicated'
    assert rows(db, 'SELECT * FROM container WHERE id = ?', parent[0]) == parent_row, 'the existing parent was changed'
    sub = crate(db, parent[0], 'Sub')
    leaf = crate(db, sub[0], 'Leaf')
    assert sub[2] == 2 and sub[3] == 1 and leaf[2] == 1 and leaf[3] == 0, (sub, leaf)  # second child of PH Parent; first of Sub
    assert members(db, leaf[0]) == [ids[3], ids[1]] and deep['new_assets'] == 1
    assert rows(db, 'SELECT COUNT(*) FROM asset')[0][0] == before_assets + 1
    assert rows(db, 'SELECT name FROM asset WHERE portable_id = ?', ids[3]) == [('Brand New',)], 'new song uses PEAK HOUR data'
    assert members(db, child[0]) == [ids[2], ids[0]], 'a sibling crate changed'
    text = (root / '_Serato_' / 'neworder.pref').read_bytes().decode('utf-16-be')
    assert text.count('[crate]PH Parent\n') == 1 and text.endswith('[crate]PH Parent%%PH child\n[crate]PH Parent%%Sub\n[crate]PH Parent%%Sub%%Leaf\n[end record]\n'), text
    assert rows(db, 'PRAGMA integrity_check') == [('ok',)] and rows(db, 'PRAGMA foreign_key_check') == []
    assert (root / '_Serato_' / 'Subcrates' / 'PH Parent%%Sub%%Leaf.crate').is_file()
    assert not (root / '_Serato_' / 'Subcrates' / 'PH Parent%%Sub.crate').exists()

    # ---------------------------------------------------------------- a crate Serato (or the owner) made is not replaced unasked
    before_dump, before_files = dump(db), tree(root)
    check_raises(S.CrateExistsError, lambda: S.write_crate_folder(app, [{'path': songs[1]}], ['Lexicon', 'HIPHOP Party'], database_path=db), 'crate_exists')
    assert dump(db) == before_dump and tree(root) == before_files, 'a refused export changed something'
    forced = S.write_crate_folder(app, [{'path': songs[1]}, {'path': songs[2]}], ['lexicon', 'hiphop party'], overwrite=True, database_path=db)
    assert forced['replaced_existing'] and forced['path_parts'] == ['Lexicon', 'HIPHOP Party'] and members(db, 3) == [ids[1], ids[2]] and rows(db, 'SELECT COUNT(*) FROM container WHERE name = ?', 'Lexicon') == [(1,)]
    assert rows(db, 'SELECT id, name FROM container WHERE id IN (2, 4) ORDER BY id') == [(2, 'Lexicon'), (4, '2000s HIPHOP')]
    preview = S.preview_crate_folder(app, [{'path': songs[0]}], ['Lexicon', 'HIPHOP Party'], database_path=db)
    assert preview['needs_confirm'] and preview['will_replace'] and not preview['will_create'], preview

    # ---------------------------------------------------------------- Serato open: refused, nothing written
    root_b, db_b, songs_b = make_library('drive-b')
    open_before, open_files = dump(db_b), tree(root_b)
    S.configure_folders(snapshot=lambda: [(7, 'Serato DJ Pro.exe')])
    err = check_raises(S.SeratoOpenError, lambda: S.write_crate_folder(app, [{'path': songs_b[0]}], ['A', 'B'], database_path=db_b), 'serato_open')
    assert 'Nothing was written' in str(err) and dump(db_b) == open_before and tree(root_b) == open_files
    # ...and Serato opening between the database write and the commit leaves the database as it was
    calls = []
    def opens_late():
        calls.append(1)
        return [(7, 'Serato DJ Pro.exe')] if len(calls) >= 2 else []
    S.configure_folders(snapshot=opens_late)
    check_raises(S.SeratoOpenError, lambda: S.write_crate_folder(app, [{'path': songs_b[0]}], ['A', 'B'], database_path=db_b), 'serato_open')
    assert len(calls) == 2 and dump(db_b) == open_before and tree(root_b) == open_files
    S.configure_folders(snapshot=lambda: [(1, 'explorer.exe')])

    # ---------------------------------------------------------------- failures after the database commit restore everything
    real_neworder, real_verify = P.update_neworder, S._verify_folder
    def boom(*a, **k):
        raise IOError('disk full (test)')
    for target, attr in ((P, 'update_neworder'), (S, '_verify_folder')):
        original = getattr(target, attr)
        setattr(target, attr, boom)
        try:
            check_raises(IOError, lambda: S.write_crate_folder(app, [{'path': p} for p in songs_b[:2]], ['A', 'B'], database_path=db_b))
        finally:
            setattr(target, attr, original)
        assert dump(db_b) == open_before and tree(root_b) == open_files, attr + ': not restored'
        assert rows(db_b, 'PRAGMA integrity_check') == [('ok',)]
    # a half-written neworder.pref (not a Serato record) is refused and nothing else is kept
    (root_b / '_Serato_' / 'neworder.pref').write_bytes('garbage'.encode('utf-16-be'))
    garbage = tree(root_b)
    check_raises(P.CratePublicationError, lambda: S.write_crate_folder(app, [{'path': songs_b[0]}], ['A', 'B'], database_path=db_b))
    assert dump(db_b) == open_before and tree(root_b) == garbage

    # ---------------------------------------------------------------- refusals kept: system drive, mixed drives, bad names
    check_raises(S.SeratoLibraryError, lambda: S.write_crate_folder(app, [{'path': r'C:\Music\a.mp3'}], ['A', 'B']))
    check_raises(S.SeratoLibraryError, lambda: S.write_crate_folder(app, [{'path': r'E:\a.mp3'}, {'path': r'D:\b.mp3'}], ['A', 'B']))
    check_raises(S.SeratoLibraryError, lambda: S.write_crate_folder(app, [], ['A', 'B'], database_path=db_b))
    check_raises(S.SeratoLibraryError, lambda: S.write_crate_folder(app, [{'path': songs_b[0]}], ['A', '  '], database_path=db_b))
    assert S.clean_crate_part('A/B') == 'A - B' and S.clean_crate_part('x%%y.CRATE') == 'x - y' and S.clean_crate_part('a:b?') == 'ab'

    # ---------------------------------------------------------------- through the Export to Serato hook and the queue registration
    root_c, db_c, songs_c = make_library('drive-c')
    S.system_drive = lambda: 'Z:'
    S.location_database = lambda drive: db_c
    exporter = X.make_playlist_exporter(app)
    out = exporter(str(db_c), [{'path': p, 'title': 'T'} for p in songs_c[:3]], 'Child', str(folder), path_parts=['Set Folder', 'Child'])
    assert out['success'] and out['delivery_verified'] and out['serato_path_parts'] == ['Set Folder', 'Child'] and out['verified_crate_tracks'] == 3, out
    assert (root_c / '_Serato_' / 'Subcrates' / 'Set Folder%%Child.crate').is_file()
    flat = exporter(str(db_c), [{'path': p, 'title': 'T'} for p in songs_c[:2]], 'Flat Crate', str(folder))
    assert flat['success'] and flat['serato_path_parts'] == ['Flat Crate'] and crate(db_c, 1, 'Flat Crate'), 'flat export changed'
    flat_file = root_c / '_Serato_' / 'Subcrates' / 'Flat Crate.crate'
    assert flat_file.read_bytes() == P.legacy_crate_bytes([S.portable_id(p) for p in songs_c[:2]]), 'a flat crate also gets its legacy file'
    assert (root_c / '_Serato_' / 'neworder.pref').read_bytes().decode('utf-16-be').count('[crate]Flat Crate\n') == 1
    assert flat['backup_id'] and flat['legacy_crate_path'] == str(flat_file)

    class FakeQueue:
        def __init__(self):
            self.registered = {}
        def register(self, program, kind, apply_fn, preview_fn=None):
            self.registered[(program, kind)] = (apply_fn, preview_fn)
    queue = FakeQueue()
    X.register_with_queue(queue, app)
    apply_fn, preview_fn = queue.registered[('serato', 'crate_folder')]
    payload = {'path_parts': ['Queued', 'Set'], 'tracks': songs_c[:2]}
    digest_one = preview_fn(payload)
    assert digest_one == preview_fn(payload) and isinstance(digest_one, str)
    queued = apply_fn(payload)
    assert queued['success'] and queued['serato_path_parts'] == ['Queued', 'Set']
    assert preview_fn(payload) != digest_one, 'the digest should change once the crate exists'
    assert preview_fn(payload) == preview_fn(payload)
    check_raises(S.SeratoLibraryError, lambda: apply_fn({'path_parts': ['Only']}))
    assert rows(db_c, 'PRAGMA integrity_check') == [('ok',)]

    # ---------------------------------------------------------------- the legacy file keeps its own columns when a crate is replaced
    previous = (REAL_CRATE[:REAL_CRATE.index(b'otrk')].replace(b'\x002\x005\x000', b'\x009\x009\x009', 1)
                + P._tag('osrt', P._tag('tvcn', P._text('bpm')) + P._tag('brev', b'\x00'))
                + P._tag('otrk', P._tag('ptrk', P._text('a/one.mp3')) + P._tag('ttyp', P._text('kept'))))
    swapped = P.legacy_crate_bytes(['a/two.mp3', 'A/ONE.mp3'], previous)
    blocks = P._blocks(swapped)
    assert [n for n, _ in blocks] == ['vrsn'] + ['ovct'] * 7 + ['osrt', 'otrk', 'otrk'], [n for n, _ in blocks]
    assert swapped.startswith(previous[:previous.index(b'otrk')]) and b'\x009\x009\x009' in swapped and P._text('kept') in blocks[-1][1]
    assert P._blocks(blocks[-2][1])[0][1].decode('utf-16-be') == 'a/two.mp3'
    assert P.legacy_crate_bytes(['x/y.mp3'], b'not a crate') == P.legacy_crate_bytes(['x/y.mp3'])

    # ---------------------------------------------------------------- Serato's own export_state of an existing crate is not reset
    con = sqlite3.connect(db)
    con.execute('UPDATE dj_container_metadata SET export_state = 2 WHERE container_id = 3')
    con.commit()
    con.close()
    S.write_crate_folder(app, [{'path': songs[0]}], ['Lexicon', 'HIPHOP Party'], overwrite=True, database_path=db)
    assert rows(db, 'SELECT export_state FROM dj_container_metadata WHERE container_id = 3') == [(2,)], 'export_state was reset'

    # ---------------------------------------------------------------- undo of a crate write
    root_d, db_d, songs_d = make_library('drive-d')
    d_dump, d_tree = dump(db_d), tree(root_d)
    ledger_before = S._ledger_read()
    wrote = S.write_crate_folder(app, [{'path': p} for p in songs_d[:2]], ['U Parent', 'U Child'], database_path=db_d)
    assert wrote['backup_id'] and dump(db_d) != d_dump and tree(root_d) != d_tree
    assert S._ledger_key(db_d, 'U Parent%%U Child') in S._ledger_read()
    S.configure_folders(snapshot=lambda: [(7, 'Serato DJ Pro.exe')])
    err = check_raises(S.SeratoOpenError, lambda: S.undo_crate_write(wrote['backup_id']), 'serato_open')
    S.configure_folders(snapshot=lambda: [(1, 'explorer.exe')])
    assert dump(db_d) != d_dump
    undone = S.undo_crate_write(wrote['backup_id'])
    assert undone['success'] and dump(db_d) == d_dump and tree(root_d) == d_tree, 'undo did not restore the library and legacy files'
    assert S._ledger_read() == ledger_before
    check_raises(S.SeratoLibraryError, lambda: S.undo_crate_write(wrote['backup_id']))
    check_raises(S.SeratoLibraryError, lambda: S.undo_crate_write('no-such-id'))
    # Serato opens after a send and adds the new songs as assets (and changes other rows): undo still works and takes out only
    # what the send added
    def serato_touches(db_x, root_x, tag):
        """What Serato did to the library after a send: new assets, an edited crate, a revision bump, its own crate in neworder.pref."""
        con = sqlite3.connect(db_x)
        con.execute("INSERT INTO asset(revision, portable_id, file_name, type, format) VALUES (500, ?, ?, 'audio', 'mp3')", (f'serato/{tag}-added.mp3', f'{tag}-added.mp3'))
        asset_id = con.execute('SELECT last_insert_rowid()').fetchone()[0]
        con.execute('INSERT INTO space_asset(asset_id, space_id, revision) VALUES (?, 1, 500)', (asset_id,))
        con.execute("UPDATE container SET expanded = 1, revision = 501 WHERE name = 'Lexicon'")
        con.execute('UPDATE serato SET revision = revision + 7')
        con.commit()
        con.close()
        order = root_x / '_Serato_' / 'neworder.pref'
        text = order.read_bytes().decode('utf-16-be')
        order.write_bytes(text.replace('[end record]', f'[crate]{tag} Own Crate\n[end record]').encode('utf-16-be'))
    root_u, db_u, songs_u = make_library('drive-u')
    u_dump, u_tree = dump(db_u), tree(root_u)
    wrote = S.write_crate_folder(app, [{'path': songs_u[0]}, {'path': songs_u[1]}], ['TU Parent', 'TU Child'], database_path=db_u)
    assert (root_u / '_Serato_' / 'Subcrates' / 'TU Parent%%TU Child.crate').is_file()
    serato_touches(db_u, root_u, 'one')
    assets_now = rows(db_u, 'SELECT COUNT(*) FROM asset')[0][0]
    undone = S.undo_crate_write(wrote['backup_id'])
    assert undone['success'] and undone['mode'] == 'targeted' and undone['removed_crates'] == ['TU Parent%%TU Child', 'TU Parent'], undone
    assert rows(db_u, 'SELECT COUNT(*) FROM container WHERE name LIKE ?', 'TU %') == [(0,)], 'the crates are still there'
    assert rows(db_u, 'SELECT COUNT(*) FROM asset')[0][0] == assets_now, 'the assets Serato added were touched'
    assert rows(db_u, 'SELECT COUNT(*) FROM asset WHERE portable_id = ?', 'serato/one-added.mp3') == [(1,)]
    assert rows(db_u, 'SELECT expanded FROM container WHERE name = ?', 'Lexicon') == [(1,)], "Serato's own change was undone"
    assert rows(db_u, 'SELECT COUNT(*) FROM dj_container_metadata WHERE filename LIKE ?', 'TU %') == [(0,)]
    assert rows(db_u, 'PRAGMA integrity_check') == [('ok',)] and rows(db_u, 'PRAGMA foreign_key_check') == []
    assert not (root_u / '_Serato_' / 'Subcrates' / 'TU Parent%%TU Child.crate').exists()
    order_text = (root_u / '_Serato_' / 'neworder.pref').read_bytes().decode('utf-16-be')
    assert 'TU Parent' not in order_text and '[crate]one Own Crate' in order_text and '[crate]Lexicon%%HIPHOP Party' in order_text, order_text
    assert (root_u / '_Serato_' / 'Subcrates' / 'Lexicon.crate').read_bytes() == b'lexicon crate, never touched'
    check_raises(S.SeratoLibraryError, lambda: S.undo_crate_write(wrote['backup_id']))
    # a crate that is no longer what PEAK HOUR made stays; a parent that now holds another crate stays
    wrote = S.write_crate_folder(app, [{'path': songs_u[0]}], ['KP Parent', 'KP Child'], database_path=db_u)
    con = sqlite3.connect(db_u)
    parent_id = con.execute("SELECT id FROM container WHERE name = 'KP Parent'").fetchone()[0]
    con.execute("INSERT INTO container(revision, parent_id, name, type, list_order, space_id, time_added, expanded, portable_id) VALUES (600, ?, 'Own Sub', 1, 2, 1, 1, 0, '')", (parent_id,))
    con.commit()
    con.close()
    serato_touches(db_u, root_u, 'two')
    undone = S.undo_crate_write(wrote['backup_id'])
    assert undone['removed_crates'] == ['KP Parent%%KP Child'] and any('KP Parent' in k and 'other crates' in k for k in undone['kept']), undone
    assert rows(db_u, "SELECT COUNT(*) FROM container WHERE name IN ('KP Parent', 'Own Sub')") == [(2,)] and rows(db_u, "SELECT COUNT(*) FROM container WHERE name = 'KP Child'") == [(0,)]
    # a crate that was already there and got replaced has its old songs back
    members_before = rows(db_u, 'SELECT space_asset_id, list_order FROM container_asset WHERE container_id = 3 ORDER BY list_order')
    wrote = S.write_crate_folder(app, [{'path': songs_u[1]}, {'path': songs_u[2]}], ['Lexicon', 'HIPHOP Party'], overwrite=True, database_path=db_u)
    assert rows(db_u, 'SELECT COUNT(*) FROM container_asset WHERE container_id = 3') == [(2,)] and wrote['replaced_existing']
    serato_touches(db_u, root_u, 'three')
    undone = S.undo_crate_write(wrote['backup_id'])
    assert undone['success'] and undone['removed_crates'] == [], undone
    assert rows(db_u, 'SELECT space_asset_id, list_order FROM container_asset WHERE container_id = 3 ORDER BY list_order') == members_before
    assert rows(db_u, 'PRAGMA integrity_check') == [('ok',)] and rows(db_u, 'SELECT COUNT(*) FROM container WHERE name = ?', 'HIPHOP Party') == [(1,)]
    assert not (root_u / '_Serato_' / 'Subcrates' / 'Lexicon%%HIPHOP Party.crate').exists(), "PEAK HOUR's file for the old crate went"
    # the undo route
    from flask import Flask
    import windows_serato_cues as C
    flask_app = Flask(__name__)
    flask_app.register_blueprint(C.create_blueprint(None, folder / 'cue-writes'))
    wrote = S.write_crate_folder(app, [{'path': songs_u[0]}], ['RT Crate'], database_path=db_u)
    serato_touches(db_u, root_u, 'four')
    reply = flask_app.test_client().post('/api/windows/serato/folders/undo', json={'backup_id': wrote['backup_id']}, headers={'Origin': 'http://localhost'})
    assert reply.status_code == 200 and reply.get_json()['mode'] == 'targeted' and rows(db_u, "SELECT COUNT(*) FROM container WHERE name = 'RT Crate'") == [(0,)], (reply.status_code, reply.data[:300])
    # an old receipt without the targeted record keeps the careful refusal
    wrote = S.write_crate_folder(app, [{'path': songs_u[0]}], ['OLD Crate'], database_path=db_u)
    receipt_file = next((S._FOLDER_STATE['backups'] / wrote['backup_id']).glob('receipt.json'))
    import json as _json
    old_receipt = _json.loads(receipt_file.read_text(encoding='utf-8'))
    old_receipt.pop('targeted')
    receipt_file.write_text(_json.dumps(old_receipt), encoding='utf-8')
    serato_touches(db_u, root_u, 'five')
    check_raises(S.SeratoLibraryError, lambda: S.undo_crate_write(wrote['backup_id']), 'changed')

    # ---------------------------------------------------------------- a plain crate survives a legacy-file failure (with a warning)
    root_e, db_e, songs_e = make_library('drive-e')
    (root_e / '_Serato_' / 'neworder.pref').write_bytes('garbage'.encode('utf-16-be'))
    e_tree = tree(root_e)
    plain = S.write_crate_folder(app, [{'path': p} for p in songs_e[:2]], ['Plain Crate'], database_path=db_e)
    assert plain['success'] and plain['warnings'] and 'legacy crate file' in plain['warnings'][0], plain['warnings']
    assert crate(db_e, 1, 'Plain Crate') and tree(root_e) == e_tree, 'the failed legacy files were not put back'
    assert issubclass(P.CratePublicationError, S.SeratoLibraryError) and P.CratePublicationError.code == 'legacy_files'

    # ---------------------------------------------------------------- unsaved changes in a -wal file: refused, nothing touched
    root_f, db_f, songs_f = make_library('drive-f')
    f_dump, f_tree = dump(db_f), tree(root_f)
    wal = pathlib.Path(str(db_f) + '-wal')
    wal.write_bytes(b'pending pages')
    f_tree = tree(root_f)
    err = check_raises(S.SeratoLibraryError, lambda: S.write_crate_folder(app, [{'path': songs_f[0]}], ['W1'], database_path=db_f))
    assert '-wal' in str(err), str(err)
    assert dump(db_f) == f_dump, 'database changed'
    assert tree(root_f) == f_tree, [k for k in set(tree(root_f)) ^ set(f_tree)]
    wal.unlink()
    f_tree = tree(root_f)
    wrote_f = S.write_crate_folder(app, [{'path': songs_f[0]}], ['W1'], database_path=db_f)
    wal.write_bytes(b'pending pages')
    check_raises(S.SeratoLibraryError, lambda: S.undo_crate_write(wrote_f['backup_id']))
    assert crate(db_f, 1, 'W1')
    wal.unlink()
    assert S.undo_crate_write(wrote_f['backup_id'])['success'] and dump(db_f) == f_dump

    # ---------------------------------------------------------------- one send spanning two drives (D: and E:), with songs that cannot go
    root_m1, db_m1, songs_m1 = make_library('multi-d')
    root_m2, db_m2, songs_m2 = make_library('multi-e')
    libraries = {'D:': db_m1, 'E:': db_m2}
    S.system_drive = lambda: 'C:'
    S.location_database = lambda drive: libraries.get(drive.upper(), pathlib.Path('Z:\\no-serato-here\\Library\\location.sqlite'))
    real_is_file = os.path.isfile
    fakes = {}  # fake drive letter path -> the real sandbox file behind it
    def fake(real, drive):
        path = drive + real[2:]
        fakes[path.casefold()] = real
        return path
    S._is_file = lambda p: real_is_file(fakes.get(str(p).casefold(), str(p)))
    d_songs = [fake(p, 'D:') for p in songs_m1[:3]]
    e_songs = [fake(p, 'E:') for p in songs_m2[:2]]
    ids_d, ids_e = [S.portable_id(p) for p in d_songs], [S.portable_id(p) for p in e_songs]
    mixed_set = [{'path': d_songs[0], 'title': 'D one'}, {'path': e_songs[0], 'title': 'E one'}, {'path': d_songs[1]},
                 {'path': 'D:\\gone\\missing.mp3', 'title': 'Missing'}, {'path': e_songs[1]}, {'path': 'C:\\Users\\x\\system.mp3'},
                 {'path': d_songs[2]}, {'path': fake(songs_m1[3], 'F:'), 'title': 'No library'}]
    m_dump = {k: dump(v) for k, v in libraries.items()}
    m_tree = {'D:': tree(root_m1), 'E:': tree(root_m2)}
    parts_m = ['Night Mix', 'Set One']

    plan = S.preview_crate_folders(app, mixed_set, parts_m)
    assert [(d['drive'], d['songs_to_write']) for d in plan['drives']] == [('D:', 3), ('E:', 2)], plan['drives']
    assert plan['songs_to_write'] == 5 and plan['crate_path'] == parts_m and plan['will_create'] == ['Night Mix', 'Night Mix%%Set One']
    assert {s['code']: s['reason'] for s in plan['skipped']}['missing'] == 'file not found'
    assert sorted(s['code'] for s in plan['skipped']) == ['missing', 'no_library', 'system_drive'], plan['skipped']
    assert plan['skipped_counts'] == {'file not found': 1, 'on C:': 1, 'no Serato library': 1}, plan['skipped_counts']
    assert plan['summary'] == 'Serato: 3 songs on D:, 2 songs on E:; 3 skipped (1 file not found, 1 on C:, 1 no Serato library)', plan['summary']
    assert {k: dump(v) for k, v in libraries.items()} == m_dump, 'a preview wrote something'
    digest_one = S.digest_crate_folders(app, mixed_set, parts_m)
    assert digest_one == S.digest_crate_folders(app, mixed_set + [{'path': 'D:\\other\\gone.mp3'}], parts_m), 'a skipped song changes the digest'

    sent = S.write_crate_folders(app, mixed_set, parts_m)
    assert sent['success'] and sent['backup_id'] and sent['exported_tracks'] == 5 and len(sent['skipped']) == 3, sent
    assert [(d['drive'], d['songs_to_write']) for d in sent['drives']] == [('D:', 3), ('E:', 2)] and sent['summary'] == plan['summary']
    for db_x, root_x, ids_x, drive in ((db_m1, root_m1, ids_d, 'D:'), (db_m2, root_m2, ids_e, 'E:')):
        parent_x = crate(db_x, 1, 'Night Mix')
        child_x = crate(db_x, parent_x[0], 'Set One')
        assert members(db_x, child_x[0]) == ids_x, (drive, members(db_x, child_x[0]), ids_x)  # this drive's songs, in the set's order
        assert (root_x / '_Serato_' / 'Subcrates' / 'Night Mix%%Set One.crate').read_bytes() == P.legacy_crate_bytes(ids_x)
        assert '[crate]Night Mix%%Set One' in (root_x / '_Serato_' / 'neworder.pref').read_bytes().decode('utf-16-be')
        assert rows(db_x, 'PRAGMA integrity_check') == [('ok',)]
    again = S.write_crate_folders(app, mixed_set, parts_m)
    assert again['unchanged'] and again['backup_id'] == '', 'a second identical send changed something'
    # one undo reverts both drives
    assert S.undo_crate_write(sent['backup_id'])['success']
    assert {k: dump(v) for k, v in libraries.items()} == m_dump and {'D:': tree(root_m1), 'E:': tree(root_m2)} == m_tree, 'undo did not revert both drives'
    check_raises(S.SeratoLibraryError, lambda: S.undo_crate_write(sent['backup_id']))
    # nothing writable at all: refused, with the reasons
    err = check_raises(S.SeratoLibraryError, lambda: S.write_crate_folders(app, [{'path': 'C:\\a.mp3'}, {'path': 'D:\\gone\\b.mp3'}], parts_m))
    assert 'None of these songs' in str(err) and '1 file not found' in str(err) and {k: dump(v) for k, v in libraries.items()} == m_dump
    # a failure on the second drive rolls the first one back
    (root_m2 / '_Serato_' / 'neworder.pref').write_bytes('garbage'.encode('utf-16-be'))
    m_tree = {'D:': tree(root_m1), 'E:': tree(root_m2)}
    check_raises(S.SeratoLibraryError, lambda: S.write_crate_folders(app, mixed_set, parts_m))
    assert {k: dump(v) for k, v in libraries.items()} == m_dump and {'D:': tree(root_m1), 'E:': tree(root_m2)} == m_tree, 'drive 1 was not rolled back'
    S._is_file = os.path.isfile
    S.system_drive = lambda: 'Z:'

    # ---------------------------------------------------------------- undo of a send made by an older build: refused clearly, status stays honest
    import json as _json2
    import shutil
    import windows_dj_writes as DW
    root_o1, db_o1, songs_o1 = make_library('old-d')
    root_o2, db_o2, songs_o2 = make_library('old-e')
    libraries.update({'D:': db_o1, 'E:': db_o2})
    S.system_drive = lambda: 'C:'
    S._is_file = lambda p: real_is_file(fakes.get(str(p).casefold(), str(p)))
    set_tracks = [{'path': fake(songs_o1[0], 'D:')}, {'path': fake(songs_o2[0], 'E:')}]
    def old_build(sent, letters):
        """Make the receipt of this send look like an older build's: no record of what it created."""
        for letter in letters:
            sub = S._FOLDER_STATE['backups'] / sent['backup_id'] / f'drive-{letter}'
            file = next(sub.glob('*/receipt.json'))
            receipt = _json2.loads(file.read_text(encoding='utf-8'))
            receipt.pop('targeted')
            file.write_text(_json2.dumps(receipt), encoding='utf-8')
    def multi_receipt(sent):
        return _json2.loads((S._FOLDER_STATE['backups'] / sent['backup_id'] / 'receipt.json').read_text(encoding='utf-8'))
    # every drive refused: the message says why, nothing is undone, and the send is still a completed ("written") one
    sent = S.write_crate_folders(app, set_tracks, ['Old Set'])
    old_build(sent, 'DE')
    serato_touches(db_o1, root_o1, 'od')
    serato_touches(db_o2, root_o2, 'oe')
    err = check_raises(S.SeratoLibraryError, lambda: S.undo_crate_write(sent['backup_id']), 'changed')
    assert 'older PEAK HOUR' in str(err) and "Delete the crate in Serato instead" in str(err) and str(err).count('Not undone on') == 2, str(err)
    receipt = multi_receipt(sent)
    assert receipt['status'] == 'written' and receipt['undo_refused'] == str(err) and receipt['undo_permanent'] and not any(d.get('undone') for d in receipt['drives'])
    assert rows(db_o1, "SELECT COUNT(*) FROM container WHERE name = 'Old Set'") == [(1,)], 'a refused undo changed the library'
    # the Recent writes list: not undone, with the reason, and marked as not undoable
    dj_root = folder / 'dj-root'
    (dj_root / 'serato-crate-writes' / sent['backup_id']).mkdir(parents=True)
    def listing():
        shutil.copy2(S._FOLDER_STATE['backups'] / sent['backup_id'] / 'receipt.json', dj_root / 'serato-crate-writes' / sent['backup_id'] / 'receipt.json')
        return [r for r in DW.recent(dj_root) if r['id'] == sent['backup_id']][0]
    row = listing()
    assert not row['undone'] and not row['undoable'] and 'older PEAK HOUR' in row['note'], row
    # what the buggy build left behind: "partly undone" with nothing undone is shown (and treated) as a plain written send
    receipt['status'] = 'partly_undone'
    receipt.pop('undo_refused'), receipt.pop('undo_permanent')
    (S._FOLDER_STATE['backups'] / sent['backup_id'] / 'receipt.json').write_text(_json2.dumps(receipt), encoding='utf-8')
    row = listing()
    assert not row['undone'] and row['undoable'] and row['note'] == '', row
    check_raises(S.SeratoLibraryError, lambda: S.undo_crate_write(sent['backup_id']), 'changed')
    assert multi_receipt(sent)['status'] == 'written'
    # one drive can be undone and the other not: "partly undone", saying which and why
    root_o3, db_o3, songs_o3 = make_library('old-f')
    root_o4, db_o4, songs_o4 = make_library('old-g')
    libraries.update({'D:': db_o3, 'E:': db_o4})
    sent = S.write_crate_folders(app, [{'path': fake(songs_o3[0], 'D:')}, {'path': fake(songs_o4[0], 'E:')}], ['Mixed Build'])
    old_build(sent, 'E')
    serato_touches(db_o3, root_o3, 'og')
    serato_touches(db_o4, root_o4, 'oh')
    err = check_raises(S.SeratoLibraryError, lambda: S.undo_crate_write(sent['backup_id']), 'changed')
    receipt = multi_receipt(sent)
    assert str(err).startswith('Undone on D:.') and 'Not undone on E:' in str(err) and 'older PEAK HOUR' in str(err), str(err)
    assert receipt['status'] == 'partly_undone' and [d.get('undone', False) for d in receipt['drives']] == [True, False]
    assert rows(db_o3, "SELECT COUNT(*) FROM container WHERE name = 'Mixed Build'") == [(0,)] and rows(db_o4, "SELECT COUNT(*) FROM container WHERE name = 'Mixed Build'") == [(1,)]
    S._is_file = os.path.isfile
    S.system_drive = lambda: 'Z:'

    print('PASS: Serato crate folders (2 and 3 levels, parent reuse, idempotent, replace rules, Serato open, restore on failure, '
          'legacy .crate bytes = real Serato layout, neworder.pref UTF-16BE) on sandbox databases')
except BaseException:
    traceback.print_exc()
    sys.exit(1)
