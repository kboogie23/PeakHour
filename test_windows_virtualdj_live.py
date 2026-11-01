"""Live Assist from VirtualDJ: AXIOM's /api/performance/dj/live follows VirtualDJ's session history when
VirtualDJ (not Serato) is running. Processes and the VirtualDJ home are simulated; nothing is started."""
import os,sys,pathlib,json,uuid,time,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 folder=workspace/'fixtures'/'vdj-live'/uuid.uuid4().hex;(folder/'home'/'History'/'2026'/'10').mkdir(parents=True)
 song=folder/'Bee Gees - Night Fever.mp3';song.write_bytes(b'\0'*100)
 now=time.time()
 (folder/'home'/'History'/'2026'/'10'/'2026-10-30.m3u').write_text(
  f'#EXTVDJ:<time>21:35</time><lastplaytime>{int(now-300)}</lastplaytime><artist>Bananarama</artist><title>Cruel Summer</title><songlength>240.0</songlength>\n'
  r'C:\Music\Bananarama - Cruel Summer.mp3'+'\n'
  f'#EXTVDJ:<time>21:40</time><lastplaytime>{int(now-20)}</lastplaytime><artist>Bee Gees</artist><title>Night Fever</title><songlength>202.7</songlength>\n'
  f'{song}\n',encoding='utf-8')
 import windows_virtualdj_live as L
 entries=L.parse_history(next((folder/'home').rglob('*.m3u')))
 assert [e['title'] for e in entries]==['Cruel Summer','Night Fever'] and entries[1]['path']==str(song)
 import windows_djay
 running={'virtualdj.exe'}
 fake=lambda:[(1234,os.path.join(r'C:\Program Files\VirtualDJ',n)) for n in sorted(running)]
 from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 app.CACHE_PATH=str(folder/'library_cache.json');pathlib.Path(app.CACHE_PATH).write_text(json.dumps({'tracks':[{'path':str(song),'title':'Night Fever','artist':'Bee Gees','bpm':109.0,'energy':'Mid'}]}),encoding='utf-8')
 import windows_virtualdj_lists;windows_virtualdj_lists.virtualdj_home=lambda:folder/'home'
 assert app._mac_process_running is windows_djay.process_running  # the Serato write guards are not wrapped
 app._mac_process_snapshot=lambda *names:windows_djay.process_snapshot(*names,snapshot=fake)  # simulated processes
 app._windows_virtualdj_live_installed=False;L.install(app,home_finder=lambda:folder/'home')
 client=app.app.test_client();h={'Host':'127.0.0.1','Origin':'http://127.0.0.1'}
 d=client.get('/api/performance/dj/live',headers=h).get_json()
 assert d.get('success') and d.get('track',{}).get('title')=='Night Fever' and d['track']['bpm']==109.0,json.dumps(d)[:600]
 assert d.get('provider','virtualdj')=='virtualdj' and d.get('active_provider','virtualdj')=='virtualdj' and d['source_label']=='VirtualDJ',{k:d.get(k) for k in ('provider','active_provider','source_label')}
 assert [x['title'] for x in d['history']]==['Cruel Summer'],d['history']
 running.clear()
 d=client.get('/api/performance/dj/live',headers=h).get_json();assert not d.get('active') or not d.get('success'),d  # VirtualDJ closed: nothing followed
 assert app._mac_process_running is windows_djay.process_running  # still unwrapped after install
 print('PASS: Live Assist follows VirtualDJ history (now playing + history, AXIOM BPM) and labels it VirtualDJ; Serato guards unaffected')
except BaseException:
 traceback.print_exc();sys.exit(1)
