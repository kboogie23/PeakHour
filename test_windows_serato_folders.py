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
    # a library Serato changed afterwards is not rolled back over
    wrote = S.write_crate_folder(app, [{'path': songs_d[0]}], ['U2'], database_path=db_d)
    con = sqlite3.connect(db_d)
    con.execute("UPDATE container SET expanded = 1 WHERE name = 'Lexicon'")
    con.commit()
    con.close()
    changed_dump, changed_tree = dump(db_d), tree(root_d)
    err = check_raises(S.SeratoLibraryError, lambda: S.undo_crate_write(wrote['backup_id']), 'changed')
    assert 'changed its library' in str(err) and dump(db_d) == changed_dump and tree(root_d) == changed_tree
    # the undo route
    from flask import Flask
    import windows_serato_cues as C
    flask_app = Flask(__name__)
    flask_app.register_blueprint(C.create_blueprint(None, folder / 'cue-writes'))
    reply = flask_app.test_client().post('/api/windows/serato/folders/undo', json={'backup_id': wrote['backup_id']}, headers={'Origin': 'http://localhost'})
    assert reply.status_code == 409 and reply.get_json()["code"] == "changed", (reply.status_code, reply.data[:300])

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

    print('PASS: Serato crate folders (2 and 3 levels, parent reuse, idempotent, replace rules, Serato open, restore on failure, '
          'legacy .crate bytes = real Serato layout, neworder.pref UTF-16BE) on sandbox databases')
except BaseException:
    traceback.print_exc()
    sys.exit(1)
