"""Stress-test report (windows_stress_report.py): counts every file type in the library folders (imported or
not), long and non-English names, songs whose file has gone, missing BPM/key, key-scan speed; opens a sample
of each type with the real media checker and lists each failure; records slow and failed requests and logged
errors; saves one zip (report.txt, report.json, logs) without touching the music. All in a fixture folder."""
import os,sys,pathlib,uuid,json,time,shutil,traceback,zipfile,wave,logging
workspace=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(workspace/'axiom-win-probe'))
try:
 import windows_stress_report as R
 base=workspace/'fixtures'/'stress-report'/uuid.uuid4().hex
 music=base/'Music';(music/'Sub'/'Deeper').mkdir(parents=True);(music/'$RECYCLE.BIN').mkdir()
 def tone(path):
  with wave.open(str(path),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(44100);w.writeframes(b'\0\0'*2*4410)
 tone(music/'good.wav');tone(music/'Sub'/'also good.wav')
 (music/'broken.wav').write_bytes(b'not audio at all')
 (music/'Sub'/'Beyoncé - Halo.mp3').write_bytes(b'\0'*100)
 (music/'Sub'/'Deeper'/'clip.mkv').write_bytes(b'\0'*10)
 (music/'cover.jpg').write_bytes(b'\0')
 (music/'$RECYCLE.BIN'/'deleted.mp3').write_bytes(b'\0')  # never counted
 long_dir=music/('L'*120)/('M'*120);long_dir.mkdir(parents=True)
 long_file=long_dir/'long name song.flac'
 try:long_file.write_bytes(b'\0')
 except OSError:long_file=None  # long paths switched off in Windows: the test still counts the rest
 tracks=[{'path':str(music/'good.wav'),'filename':'good.wav','bpm':95,'camelot':'8A','artist':'A','duration_sec':120,'year':1994,
          'key_analysis_status':'fixed','key_analysis_attempted_at':'2026-10-31T00:00:00Z','root':str(music)},
         {'path':str(music/'Sub'/'also good.wav'),'filename':'also good.wav','bpm':0,'camelot':'','artist':'B','duration_sec':60,
          'key_analysis_status':'fixed','key_analysis_attempted_at':'2026-10-31T00:00:30Z'},
         {'path':str(music/'Sub'/'Deeper'/'later.mp3'),'filename':'later.mp3','key_analysis_status':'fixed','key_analysis_attempted_at':'2026-10-31T00:01:00Z'},
         {'path':str(music/'gone.mp3'),'filename':'gone.mp3','bpm':100,'key_analysis_attempted_at':'2026-10-30T10:00:00Z'}]
 cache=base/'library_cache.json';cache.write_text(json.dumps({'tracks':tracks,'folder_structure':{str(music):{},str(music/'Sub'):{}}}),encoding='utf-8')
 logs=base/'Logs';logs.mkdir();(logs/'launch.log').write_text('started\n',encoding='utf-8')
 before={p:(p.stat().st_size,p.stat().st_mtime_ns) for p in music.rglob('*') if p.is_file()}
 # Library summary: by type, missing fields, gone files, latest key-scan run only (the old one is 14 h earlier)
 lib=R.library_summary(tracks)
 assert lib['songs']==4 and lib['by_type']=={'.wav':2,'.mp3':2} and lib['files_gone']==2 and lib['files_check_complete']
 assert lib['missing']['bpm']==2 and lib['missing']['key']==3 and lib['missing']['year']==3
 assert lib['key_scan_speed']=={'songs':3,'minutes':1.0,'seconds_per_song':30.0},lib['key_scan_speed']
 # Folder walk: nested library folder counted once, recycle bin skipped, unsupported types flagged
 roots=R.library_roots(json.loads(cache.read_text(encoding='utf-8')));assert roots==[str(music)],roots
 supported={'.wav','.mp3','.flac','.mp4'}
 disk=R.walk_folders(roots,supported)
 types={r['type']:r for r in disk['by_type']}
 assert disk['complete'] and types['.wav']['files']==3 and types['.mp3']['files']==1 and types['.mkv']['imported_by_peak_hour'] is False
 assert types['.jpg']['files']==1 and disk['files']==6+(1 if long_file else 0),disk['files']
 assert disk['non_english_names']==1 and disk['long_paths']==(1 if long_file else 0)
 assert set(disk['samples'])=={'.wav','.mp3'}|({'.flac'} if long_file else set()) and len(disk['samples']['.wav'])==3
 # Limits: a time limit gives a partial count instead of hanging
 tick=iter(range(1000));partial=R.walk_folders(roots,supported,budget=0.5,clock=lambda:next(tick))
 assert partial['complete'] is False
 # Sample files opened with the real media checker: good WAVs open, the broken one is listed with its error
 report=R.StressReport(None,R.Activity(),cache_path=cache,log_folder=logs,version='test',output=lambda:base/'Desktop')
 opened=R.open_samples({'.wav':disk['samples']['.wav']},report._probe())
 row=opened['types']['.wav'];assert row['opened']==2 and len(row['failed'])==1 and 'broken.wav' in row['failed'][0]['file'],row
 assert row['codecs']=={'audio:pcm_s16le':2},row['codecs']
 # Activity: slow and failed requests, logged errors; the endpoints
 from flask import Flask
 web=Flask('t');clock=[0.0];act=R.Activity(clock=lambda:clock[0]).install(web);report.activity=act
 @web.get('/slow')
 def slow():clock[0]+=3;return 'ok'
 @web.get('/boom')
 def boom():return 'no',500
 web.register_blueprint(R.create_stress_report_blueprint(report,lambda p:revealed.append(p)));revealed=[]
 c=web.test_client();c.get('/slow');c.get('/boom')
 logging.getLogger('peak.test').error('Library load failed for X')
 snap=act.snapshot()
 assert [e['request'] for e in snap['slow']]==['GET /slow'] and snap['server_errors'][0]['status']==500
 assert any('Library load failed' in e['error'] for e in snap['logged_errors'])
 assert c.post('/api/windows/stress-report',environ_base={'REMOTE_ADDR':'192.168.0.9'}).status_code==403
 assert c.post('/api/windows/stress-report/reveal').status_code==404
 assert c.post('/api/windows/stress-report').get_json()['state']=='running'
 deadline=time.time()+120
 while report.snapshot()['state']=='running' and time.time()<deadline:time.sleep(0.2)
 state=report.snapshot();assert state['state']=='done' and state['percent']==100,state
 path=pathlib.Path(state['path']);assert path.parent==base/'Desktop' and path.suffix=='.zip' and not list(path.parent.glob('*.part'))
 with zipfile.ZipFile(path) as z:
  assert set(z.namelist())=={'report.txt','report.json','logs/launch.log'},z.namelist()
  data=json.loads(z.read('report.json'));text=z.read('report.txt').decode('utf-8')
 assert data['library']['songs']==4 and data['folders']['files']==disk['files'] and data['system']['peak_hour']=='test'
 assert data['opened']['types']['.wav']['opened']==2 and '.mkv' not in data['opened']['types']
 assert 'NOT imported by PEAK HOUR' in text and 'FAILED' in text and 'GET /slow' in text and 'Library load failed' in text
 assert c.post('/api/windows/stress-report/reveal').get_json()['success'] and revealed==[str(path)]
 # Nothing in the music folder changed
 assert before=={p:(p.stat().st_size,p.stat().st_mtime_ns) for p in music.rglob('*') if p.is_file()}
 # Real Windows calls answer: Desktop folder and system details
 assert R.desktop_folder().name and R.system_info([str(music)],'x')['logical_cpus']
 shutil.rmtree(base,ignore_errors=True)
 print('PASS: stress-test report counts every file type, opens samples, records slow requests and errors, saves one zip read-only')
except BaseException:
 traceback.print_exc();sys.exit(1)
