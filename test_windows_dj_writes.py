"""Recent writes: GET /api/windows/dj-writes/recent lists the newest completed PEAK HOUR writes from the writers' receipt
folders (newest first, at most 20, undone ones marked, unfinished ones left out) and the file-size undo route answers
like the other undo routes."""
import json
import sys
import tempfile
from pathlib import Path

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parent / 'axiom-win-probe'))
import windows_dj_writes as W

failures = []


def check(name, condition):
    print(('PASS ' if condition else 'FAIL ') + name)
    if not condition:
        failures.append(name)


def receipt(root, folder, name, **fields):
    path = Path(root) / folder / name
    path.mkdir(parents=True)
    (path / 'receipt.json').write_text(json.dumps(dict({'id': name}, **fields)), encoding='utf-8')


with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    receipt(root, 'virtualdj-list-writes', '20261113-100000-aaaaaaa1', created_at=100.0, path=['PH Test', 'PH Send'],
            list_path='X/PH Send.m3u', created_files=[{'path': 'x'}], undone=False)
    receipt(root, 'virtualdj-list-writes', '20261113-100001-aaaaaaa2', created_at=101.0, path=['Failed'], created_files=[], replaced=[])
    receipt(root, 'djay-folder-writes', '20261113-100002-bbbbbbb1', created_at=200.0, status='written', path=['Sets', 'Friday'], songs=57)
    receipt(root, 'djay-cue-writes', '20261113-100003-bbbbbbb2', created_at=300.0, status='undone', songs=[{'path': 'a'}, {'path': 'b'}, {'path': 'c'}])
    receipt(root, 'djay-cue-writes', '20261113-100004-bbbbbbb3', created_at=301.0, status='rolled_back', songs=[])
    receipt(root, 'serato-crate-writes', '20261113-100005-ccccccc1', created_at=400.0, status='written', crate='Sets%%Friday')
    receipt(root, 'serato-cue-writes', '20261113-100006-ccccccc2', created_at=500.0, status='written', files=[{'path': 'a'}] * 4)
    receipt(root, 'virtualdj-size-writes', '20261113-100007-ddddddd1', created_at=600.0, status='written',
            databases=[{'songs': 2}, {'songs': 5}])
    (root / 'serato-cue-writes' / 'broken').mkdir()
    (root / 'serato-cue-writes' / 'broken' / 'receipt.json').write_text('{not json')

    rows = W.recent(root)
    names = [(r['program'], r['label'], r['what'], r['undone']) for r in rows]
    check('lists completed writes, newest first', [r['id'][-8:] for r in rows] ==
          ['ddddddd1', 'ccccccc2', 'ccccccc1', 'bbbbbbb2', 'bbbbbbb1', 'aaaaaaa1'])
    check('describes each write', ('virtualdj', 'VirtualDJ file sizes', '7 songs', False) in names
          and ('serato', 'Serato cue points', '4 songs', False) in names
          and ('serato', 'Serato crate', 'Sets / Friday', False) in names
          and ('djay', 'djay playlist', 'Sets / Friday, 57 songs', False) in names
          and ('virtualdj', 'VirtualDJ playlist', 'PH Test / PH Send', False) in names)
    check('already-undone receipts are marked', [r['undone'] for r in rows if r['label'] == 'djay cue points'] == [True])
    check('unfinished writes and broken receipts are left out', len(rows) == 6)
    check('each row names its undo route', {r['label']: r['undo_url'] for r in rows}['Serato crate'] == '/api/windows/serato/folders/undo'
          and {r['label']: r['undo_url'] for r in rows}['VirtualDJ file sizes'] == '/api/windows/dj-writes/undo-size')
    for number in range(30):
        receipt(root, 'djay-folder-writes', f'20261113-2000{number:02d}-eeeeeeee', created_at=1000.0 + number, status='written', path=['N'], songs=1)
    check('at most 20', len(W.recent(root)) == 20 and W.recent(root)[0]['created_at'] == 1029.0)

    app = Flask(__name__)
    app.register_blueprint(W.create_blueprint(root))
    client = app.test_client()
    check('route', len(client.get('/api/windows/dj-writes/recent').get_json()['writes']) == 20)
    check('size undo needs a same-origin request', client.post('/api/windows/dj-writes/undo-size', json={'backup_id': 'x'}).status_code == 403)
    refused = client.post('/api/windows/dj-writes/undo-size', json={'backup_id': 'nope'}, headers={'Origin': 'http://localhost'},
                          base_url='http://localhost')
    check('size undo refusal carries the writer\'s message', refused.status_code == 400 and refused.get_json()['success'] is False
          and refused.get_json()['error'])

print('FAILED: ' + ', '.join(failures) if failures else 'ALL PASS')
sys.exit(1 if failures else 0)
