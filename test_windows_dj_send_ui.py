"""Send to DJ software: the real app (sandbox) answers every program's preview, queues a write for a program that is
open (202), keeps "send" apart from "replace", and the Send dialog renders and works in headless Edge.

Everything runs on sandbox libraries in a temp folder (fake VirtualDJ Playlists/MyLists, a djay fixture, a Serato
location.sqlite built from test_serato_location_schema.sql); the owner's DJ libraries are never touched."""
import json
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

workspace = Path(__file__).resolve().parent
PROBE = workspace / 'axiom-win-probe'
base = Path(tempfile.mkdtemp(prefix='phsend'))
for name in ('local', 'home', 'data'):
    (base / name).mkdir()
os.environ.update(LOCALAPPDATA=str(base / 'local'), USERPROFILE=str(base / 'home'), AXIOM_RUNTIME_DIR=str(base / 'data'),
                  AXIOM_LICENSE_REQUIRED='0', HOME=str(base / 'home'))
sys.path.insert(0, str(PROBE))
sys.path.insert(0, str(workspace))
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
server = queue = None
try:
    import axiom_windows_launcher as L
    L.data_root = lambda: base / 'data'
    import windows_djay
    import windows_djay_cues
    import windows_djay_folders
    import windows_serato_cues
    import windows_serato_library as S
    import windows_virtualdj_folders as VF
    from djay_fixture import djay_library

    # ---- sandbox libraries
    vdj = base / 'local' / 'VirtualDJ'
    (vdj / 'Playlists').mkdir(parents=True)
    (vdj / 'MyLists').mkdir()
    (vdj / 'settings.xml').write_text('<VirtualDJ_Settings/>', encoding='utf-8')
    songs_dir = base / 'home' / 'Music' / 'Songs'
    songs_dir.mkdir(parents=True)
    (base / 'home' / 'Music' / 'djay' / 'djay Media Library').mkdir(parents=True)
    paths, djay_db = djay_library(songs_dir, ['Song A', 'Song B'], windows_djay.quote)
    tracks = [paths['Song A'], paths['Song B']]
    serato_root = base / 'serato-drive'
    (serato_root / '_Serato_' / 'Library').mkdir(parents=True)
    (base / 'local' / 'Serato' / 'Library').mkdir(parents=True)
    serato_db = serato_root / '_Serato_' / 'Library' / 'location.sqlite'
    con = sqlite3.connect(serato_db)
    con.executescript((workspace / 'test_serato_location_schema.sql').read_text(encoding='utf-8'))
    con.execute("INSERT INTO serato(database_name, time_created, revision) VALUES ('', 1, 135)")
    con.execute("INSERT INTO space(id, name, revision) VALUES (1, 'Serato Library', 135)")
    for row in ((0, 0, None, 'root', 0, 0, None, 0), (1, 1, 0, 'Serato Library root', 0, 1, 1, 0)):
        con.execute('INSERT INTO container(id, revision, parent_id, name, type, list_order, space_id, expanded, time_added, portable_id) '
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '')", row)
    con.commit()
    con.close()
    S.system_drive = lambda: 'Z:'
    S.location_database = lambda drive: serato_db

    # ---- the real app
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    url = f'http://127.0.0.1:{port}'
    backend = L.build_app(port)
    queue = backend.DJ_WRITE_QUEUE
    open_programs = set()
    S.configure_folders(snapshot=lambda: [(1, 'explorer.exe')] + ([(2, 'Serato DJ Pro.exe')] if 'serato' in open_programs else []),
                        ledger=base / 'serato-ledger.json', backups=base / 'serato-backups')
    exe = {'virtualdj': 'VirtualDJ.exe', 'serato': 'Serato DJ Pro.exe', 'djay': 'djayApp.exe'}
    queue.snapshot = lambda: [(1, 'explorer.exe')] + [(10 + n, exe[p]) for n, p in enumerate(sorted(open_programs))]
    windows_djay_folders.configure(database=str(djay_db), running=lambda: 'djay' in open_programs)
    windows_djay_cues.configure(database=str(djay_db), running=lambda: 'djay' in open_programs)
    windows_serato_cues.configure(running=lambda: 'serato' in open_programs)

    def ensure_closed():
        if 'virtualdj' in open_programs:
            raise VF.VirtualDJListError('Quit VirtualDJ, then try again.')
    VF.ensure_virtualdj_closed = ensure_closed

    # a harness page served by the same app (same origin), added before the first request
    HARNESS = '''<!doctype html><meta charset="utf-8"><title>harness</title>
<script>window.showToast=(t,bad)=>{(window.toasts=window.toasts||[]).push([t,!!bad])};
window.ensureAxiomLicenseUsable=async()=>true;</script>
<link rel="stylesheet" href="/static/css/windows-virtualdj.css"><link rel="stylesheet" href="/static/css/windows-dj-send.css">
<script src="/static/js/shared/windows-dj-send.js?v=3"></script>
<pre id="out">waiting</pre>
<script>
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const text=()=>[...document.querySelectorAll('#axiom-dj-send-results .axiom-dj-send-row')].map(r=>r.dataset.program+'='+r.textContent);
(async()=>{
 const out={};
 try{
  const tracks=%s;const listName=%s;
  AxiomDJSend.open({name:'Harness Set',tracks});
  for(let i=0;i<50&&!document.querySelector('.axiom-dj-send-programs input');i++)await sleep(100);
  await sleep(300);
  const box=document.getElementById('axiom-dj-send');
  out.dialog=!!box&&box.open;
  out.programs=[...box.querySelectorAll('.axiom-dj-send-programs label')].map(l=>l.textContent.trim()+(l.querySelector('input').disabled?'|off':''));
  out.title=box.querySelector('h2').textContent;
  out.sendDisabledBeforePreview=document.getElementById('axiom-dj-send-go').disabled;
  document.getElementById('axiom-dj-send-folder').value='PH Page / Sub';
  document.getElementById('axiom-dj-send-name').value=listName;
  document.getElementById('axiom-dj-send-preview').click();
  for(let i=0;i<100&&text().length<3;i++)await sleep(100);
  out.preview=text();
  out.sendEnabledAfterPreview=!document.getElementById('axiom-dj-send-go').disabled;
  document.getElementById('axiom-dj-send-name').value='bad:name';
  document.getElementById('axiom-dj-send-preview').click();
  await sleep(500);
  out.badName=text();
  document.getElementById('axiom-dj-send-name').value=listName;
  document.getElementById('axiom-dj-send-preview').click();
  for(let i=0;i<100&&text().length<3;i++)await sleep(100);
  out.toggles=[...document.querySelectorAll('.axiom-dj-send-toggle')].map(b=>b.textContent);
  const firstToggle=document.querySelector('.axiom-dj-send-toggle');
  if(firstToggle){firstToggle.click();out.skippedShown=[...document.querySelectorAll('.axiom-dj-send-skipped:not([hidden]) li')].map(l=>l.textContent)}
  out.sendEnabledBeforeSend=!document.getElementById('axiom-dj-send-go').disabled;
  document.getElementById('axiom-dj-send-go').click();
  for(let i=0;i<100&&!text().some(t=>/Written|Queued|written/.test(t));i++)await sleep(100);
  await sleep(1500);
  out.sent=text();
  out.toasts=window.toasts||[];
 }catch(e){out.error=String(e&&e.stack||e)}
 document.getElementById('out').textContent='RESULT'+JSON.stringify(out)+'ENDRESULT';
})();
</script>'''
    unknown = songs_dir / 'Unknown Song.mp3'  # on disk, in no DJ library
    unknown.write_bytes(b'unknown')
    gone = songs_dir / 'Gone Song - Dirty.mp4'  # not on disk at all
    from flask import request as flask_request

    def harness():
        only = flask_request.args.get('only')
        chosen = [str(unknown)] if only == 'unknown' else tracks + [str(unknown)]
        name = 'Page List ' + (only or 'all')
        return HARNESS % (json.dumps([{'path': t} for t in chosen]), json.dumps(name)), 200, {'Content-Type': 'text/html'}
    backend.app.add_url_rule('/__dj_send_harness', 'dj_send_harness', harness)
    from werkzeug.serving import make_server
    http = make_server('127.0.0.1', port, backend.app, threaded=True)
    server = threading.Thread(target=http.serve_forever, daemon=True)
    server.start()

    def call(route, body=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(url + route, data=data, method='GET' if body is None else 'POST',
                                         headers={'Content-Type': 'application/json', 'Origin': url})
        try:
            with urllib.request.urlopen(request, timeout=60) as reply:
                return reply.status, json.loads(reply.read() or b'{}')
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or b'{}')

    # 1. which programs are there
    status, programs = call('/api/windows/dj-queue/programs')
    found = {p['id']: p for p in programs['programs']}
    assert status == 200 and all(found[n]['installed'] and not found[n]['running'] for n in ('virtualdj', 'serato', 'djay')), programs

    # 2. every program's preview answers, naming what it will create
    vdj_body = {'path': ['PH Folder', 'PH List'], 'tracks': tracks, 'style': 'm3u'}
    status, pv = call('/api/windows/virtualdj/folders/preview', vdj_body)
    assert status == 200 and pv['list_exists'] is False and len(pv['folders_to_create']) == 1 and pv['tracks'] == 2, pv
    status, pv = call('/api/windows/djay/folders/preview', {'path': ['PH Folder', 'PH List'], 'tracks': tracks})
    assert status == 200 and pv['playlist']['action'] == 'create' and pv['counts']['songs'] == 2, pv
    serato_body = {'path_parts': ['PH Folder', 'PH List'], 'tracks': tracks}
    status, pv = call('/api/windows/serato/folders/preview', serato_body)
    assert status == 200 and pv['list_exists'] is False and pv['will_create'] == ['PH Folder', 'PH Folder%%PH List'] and pv['serato_open'] is False, pv
    status, pv = call('/api/windows/djay/cues/preview', {'tracks': tracks})
    assert status == 200 and 'counts' in pv, pv
    status, pv = call('/api/windows/serato/cues/preview', {'tracks': tracks})
    assert status == 200 and 'counts' in pv, pv
    assert not list((vdj / 'Playlists').iterdir()), 'a preview wrote something'

    # 3. "send" never means "replace": confirm writes a new list; the second send of the same name is refused until replace:true
    assert call('/api/windows/virtualdj/folders/apply', vdj_body)[0] == 400  # no confirm
    status, wrote = call('/api/windows/virtualdj/folders/apply', dict(vdj_body, confirm=True))
    assert status == 200 and (vdj / 'Playlists' / 'PH Folder' / 'PH List.m3u').is_file(), wrote
    status, again = call('/api/windows/virtualdj/folders/apply', dict(vdj_body, confirm=True, tracks=tracks[:1]))
    assert status == 409 and again['code'] == 'exists', again
    status, swapped = call('/api/windows/virtualdj/folders/apply', dict(vdj_body, confirm=True, tracks=tracks[:1], replace=True))
    assert status == 200 and swapped['replaced'] is True, swapped
    status, pv = call('/api/windows/virtualdj/folders/preview', vdj_body)
    assert pv['list_exists'] is True and pv['needs_confirm'] is True

    # 4. a program that is open gets 202 queued (never an error), for every route; nothing is written
    before = sorted(str(p) for p in vdj.rglob('*'))
    open_programs.update(('virtualdj', 'serato', 'djay'))
    queued = {}
    for label, route, body in (
            ('VirtualDJ', '/api/windows/virtualdj/folders/apply', dict(vdj_body, path=['PH Folder', 'Queued List'], confirm=True)),
            ('djay', '/api/windows/djay/folders/apply', {'path': ['PH Folder', 'Queued List'], 'tracks': tracks, 'confirm': True}),
            ('djay', '/api/windows/djay/cues/apply', {'tracks': tracks, 'confirm': True}),
            ('Serato', '/api/windows/serato/cues/apply', {'tracks': tracks, 'confirm': True}),
            ('Serato', '/api/windows/serato/folders/apply', dict(serato_body, confirm=True))):
        status, reply = call(route, body)
        assert status == 202 and reply['queued'] is True and reply['id'], (route, status, reply)
        assert reply['message'] == f'{label} is open \u2014 PEAK HOUR will write this after you close it.', reply
        queued[route] = reply['id']
        status, refused = call(route, {k: v for k, v in body.items() if k != 'confirm'})
        assert status == 400, (route, status, refused)  # confirm is still required
    assert sorted(str(p) for p in vdj.rglob('*')) == before
    status, listing = call('/api/windows/dj-queue/list')
    assert sorted((j['program'], j['kind']) for j in listing['jobs'] if j['status'] == 'queued') == sorted(
        [('virtualdj', 'list_folder'), ('djay', 'playlist_folder'), ('djay', 'cues'), ('serato', 'cues'), ('serato', 'crate_folder')]), listing
    for job_id in queued.values():
        assert call('/api/windows/dj-queue/cancel', {'id': job_id}) == (200, {'ok': True})
    status, pv = call('/api/windows/serato/folders/preview', serato_body)
    assert pv['serato_open'] is True
    # an existing list is refused before queueing (otherwise the job would fail later)
    status, refused = call('/api/windows/virtualdj/folders/apply', dict(vdj_body, confirm=True))
    assert status == 409 and refused['code'] == 'exists', refused
    open_programs.clear()

    # 5. each program/kind is registered exactly once
    assert sorted(queue.appliers) == sorted([('virtualdj', 'list_folder'), ('djay', 'playlist_folder'), ('djay', 'cues'),
                                             ('serato', 'cues'), ('serato', 'crate_folder'),
                                             ('virtualdj', 'filesize_sync')]), sorted(queue.appliers)

    # 6. the real page loads the script, and the dialog works in headless Edge
    index = urllib.request.urlopen(url + '/', timeout=60).read().decode('utf-8')
    assert '/static/js/shared/windows-dj-send.js?v=3' in index and '/static/css/windows-dj-send.css?v=2' in index
    assert '/static/js/shared/windows-virtualdj-write.js?v=5' in index
    for asset in ('/static/js/shared/windows-dj-send.js', '/static/css/windows-dj-send.css'):
        assert urllib.request.urlopen(url + asset, timeout=30).status == 200
    if not os.path.exists(EDGE):
        print('SKIPPED page check: Edge is not installed')
    else:
        common = [EDGE, '--headless=new', '--disable-gpu', f'--user-data-dir={base / "edge"}', '--window-size=900,900',
                  '--virtual-time-budget=20000']
        import html

        def run_harness(query, tag):
            dom = ''
            for attempt in range(4):
                profile = [f'--user-data-dir={base / f"edge-{tag}{attempt}"}' if x.startswith('--user-data-dir=') else x for x in common]
                dom = subprocess.run([*profile, '--dump-dom', url + '/__dj_send_harness' + query], capture_output=True, timeout=180,
                                     encoding='utf-8', errors='replace').stdout
                if 'RESULT' in dom:
                    break
            match = re.search(r'RESULT(.*?)ENDRESULT', dom, re.S)
            assert match, dom[:1500]
            result = json.loads(html.unescape(match.group(1)))
            assert not result.get('error'), result
            return result
        out = run_harness('', 'a')
        assert out['dialog'] and out['title'] == 'Send to DJ software', out
        assert out['programs'] == ['VirtualDJ', 'Serato', 'djay'], out['programs']
        assert out['sendDisabledBeforePreview'] is True and out['sendEnabledAfterPreview'] is True, out
        previews = {line.split('=', 1)[0]: line for line in out['preview']}
        assert set(previews) == {'virtualdj', 'serato', 'djay'}, out['preview']
        assert 'PEAK HOUR will create "Page List all" inside PH Page / Sub' in previews['virtualdj'], previews
        # one summary line per program, with the songs left out counted and listed on request
        assert 'VirtualDJ: 3 songs' in previews['virtualdj'] and 'Serato: 3 songs' in previews['serato'], previews
        assert 'djay: 2 songs; 1 not in djay yet' in previews['djay'], previews['djay']
        assert out['toggles'] == ['show skipped'] and len(out['skippedShown']) == 1 and 'Unknown Song' in out['skippedShown'][0]             and 'not in djay yet' in out['skippedShown'][0], out
        assert any('cannot contain' in line for line in out['badName']), out['badName']
        assert not any('NEEDS YOUR ATTENTION' in t[0] for t in out['toasts'] if t[1]), out['toasts']
        sent = ' '.join(out['sent'])
        assert (vdj / 'Playlists' / 'PH Page' / 'Sub' / 'Page List all.m3u').is_file(), out['sent']
        assert 'Written' in sent or 'written' in sent, out['sent']
        # a program with nothing to send (none of the songs are in djay) is left out; Send still works for the others
        only = run_harness('?only=unknown', 'b')
        rows = {line.split('=', 1)[0]: line for line in only['preview']}
        assert 'nothing to send' in rows['djay'] and 'leaves it out' in rows['djay'] and 'VirtualDJ: 1 song' in rows['virtualdj'], rows
        assert only['sendEnabledBeforeSend'] is True, only
        assert {line.split('=', 1)[0] for line in only['sent']} == {'virtualdj', 'serato'}, only['sent']
        assert (vdj / 'Playlists' / 'PH Page' / 'Sub' / 'Page List unknown.m3u').is_file()
        # the real page: the Export menu gets its "Send to DJ software" entry
        page = ''
        # a fresh Edge profile per try: re-using the harness run's profile makes headless Edge crash (exit 0x80000003, empty output)
        # on the big real page
        for attempt in range(3):
            fresh = [f'--user-data-dir={base / f"edge-page{attempt}"}' if a.startswith('--user-data-dir=') else a for a in common]
            page = subprocess.run([*fresh, '--dump-dom', url + '/'], capture_output=True, timeout=180,
                                  encoding='utf-8', errors='replace').stdout
            if 'sidebar-export-dj-send' in page:
                break
        assert 'id="sidebar-export-dj-send"' in page and 'Send to DJ software' in page, page[:500]
finally:
    if server is not None:
        queue.stop()
        http.shutdown()
    elif queue is not None:
        queue.stop()
    shutil.rmtree(base, ignore_errors=True)
print('PASS: Send to DJ software previews VirtualDJ, Serato and djay, keeps send apart from replace, queues writes (202) for an '
      'open program, and the dialog works in headless Edge')
