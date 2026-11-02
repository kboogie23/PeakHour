"""PEAK HOUR names on downloaded files: only the file name in Content-Disposition changes."""
import os,sys,pathlib,traceback,types,urllib.parse,shutil,tempfile,subprocess,json
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
try:
 import flask
 import windows_brand as B
 # the rules, the same as the browser side
 for old,new in (('AXIOM_EXPORT.csv','PEAK_HOUR_EXPORT.csv'),('AXIOM_REKORDBOX.xml','PEAK_HOUR_REKORDBOX.xml'),('AXIOM_SET_2026.m3u8','PEAK_HOUR_SET_2026.m3u8'),
   ('AXIOM_MISSING_KEYS_2026.m3u8','PEAK_HOUR_MISSING_KEYS_2026.m3u8'),('AXIOM_INTELLIGENCE_PACK_2026.zip','PEAK_HOUR_INTELLIGENCE_PACK_2026.zip'),
   ('AXIOM-Beatgrid-Doctor-1.zip','PEAK-HOUR-Beatgrid-Doctor-1.zip'),('axiom-backup.zip','peak-hour-backup.zip'),('AXIOM Project.axiom.zip','PEAK HOUR Project.peakhour.zip'),('AXIOM Project 2.axiom.zip','PEAK HOUR Project 2.peakhour.zip'),
   ('mix.axiom.zip','mix.peakhour.zip'),('mix.axiom.json','mix.peakhour.json')):
  assert B.filename(old)==new,(old,B.filename(old))
 for same in ('AXIOM Set 2026.wav','AXIOM Night.json','AXIOM Projects.zip','My AXIOM_set.csv','set_AXIOM_.csv','AXIOM.csv','AXIOMS.csv','Axiom_Set.csv','a.axiom.txt','x.axiom.zip.bak','','playlist.m3u8'):
  assert B.filename(same)==same,(same,B.filename(same))
 body=b'AXIOM_EXPORT,"filename=AXIOM_x"\n'
 flask_app=flask.Flask(__name__)
 @flask_app.route('/send',endpoint='api_export_csv')  # an allowlisted export endpoint name
 def send():
  response=flask.Response(body,mimetype='text/csv');response.headers['Content-Disposition']=flask.request.args['d'];response.headers['X-AXIOM-Track-Count']='3';return response
 @flask_app.route('/stream',endpoint='api_stream')  # serves a user's own file
 def stream(): return flask.Response(body,headers={'Content-Disposition':flask.request.args['d']})
 @flask_app.route('/plain')
 def plain(): return flask.Response(body,headers={'X-AXIOM-Source':'AXIOM_keep'})
 B.install(types.SimpleNamespace(app=flask_app))
 client=flask_app.test_client()
 def disposition(value):
  r=client.get('/send',query_string={'d':value})
  assert r.data==body and r.headers['X-AXIOM-Track-Count']=='3' and r.mimetype=='text/csv'
  return r.headers['Content-Disposition']
 for core,new in (('AXIOM_MISSING_KEYS_20260101.m3u8','PEAK_HOUR_MISSING_KEYS_20260101.m3u8'),('AXIOM_INTELLIGENCE_PACK_20260101.zip','PEAK_HOUR_INTELLIGENCE_PACK_20260101.zip'),
   ('AXIOM_EXPORT.csv','PEAK_HOUR_EXPORT.csv'),('AXIOM_REKORDBOX.xml','PEAK_HOUR_REKORDBOX.xml'),('AXIOM_SET.m3u8','PEAK_HOUR_SET.m3u8'),('AXIOM-Beatgrid-Doctor-1.zip','PEAK-HOUR-Beatgrid-Doctor-1.zip')):
  assert disposition(f'attachment; filename="{core}"')==f'attachment; filename="{new}"'  # quoted
  assert disposition(f'attachment; filename={core}')==f'attachment; filename={new}'  # unquoted
  assert disposition(f"attachment; filename*=UTF-8''{core}")==f"attachment; filename*=UTF-8''{new}"  # RFC 5987
 assert disposition("attachment; filename*=UTF-8''AXIOM%20Project.axiom.zip")=="attachment; filename*=UTF-8''PEAK%20HOUR%20Project.peakhour.zip"
 assert disposition("attachment; filename*=UTF-8''AXIOM%5FSET.m3u8")=="attachment; filename*=UTF-8''PEAK_HOUR_SET.m3u8"
 assert disposition('attachment; filename="AXIOM Set 1.wav"')=='attachment; filename="AXIOM Set 1.wav"'  # user-typed names stay
 assert disposition('attachment; filename="AXIOM Project.axiom.zip"')=='attachment; filename="PEAK HOUR Project.peakhour.zip"'
 assert disposition('attachment; filename="AXIOM_x')=='attachment; filename="AXIOM_x'  # unterminated quote: untouched, no char dropped
 both='attachment; filename="AXIOM_EXPORT.csv"; filename*=UTF-8\'\'AXIOM_EXPORT.csv'
 assert disposition(both)=='attachment; filename="PEAK_HOUR_EXPORT.csv"; filename*=UTF-8\'\'PEAK_HOUR_EXPORT.csv'
 assert disposition('attachment; filename="mix.axiom.zip"')=='attachment; filename="mix.peakhour.zip"'
 for same in ('attachment; filename="notes.csv"','attachment; filename="My AXIOM_set.csv"','attachment; filename=Set_AXIOM_.csv',"attachment; filename*=UTF-8''My%20AXIOM%20set.csv",'attachment','inline; filename="Axiom_Set.csv"'):
  assert disposition(same)==same,(same,disposition(same))

 eps=flask.Flask('eps');B.install(types.SimpleNamespace(app=eps))  # a fresh app: routes must exist before the first request
 for ep in ('api_health_beatgrid_doctor_library','health_metadata_batch.report','api_export_intelligence_pack','api_library_export_key_analysis_batch','api_export_xml','api_export','api_export_serato_safe','api_health_beatgrid_doctor_mirror_preparation','studio_bundles.download_project'):
  eps.add_url_rule('/ep/'+ep,endpoint=ep,view_func=lambda: flask.Response(body,headers={'Content-Disposition':flask.request.args['d']}))
 for ep,core,new in (('api_export_intelligence_pack','AXIOM_INTELLIGENCE_PACK_1.zip','PEAK_HOUR_INTELLIGENCE_PACK_1.zip'),('api_library_export_key_analysis_batch','AXIOM_MISSING_KEYS_1.m3u8','PEAK_HOUR_MISSING_KEYS_1.m3u8'),
   ('api_export_xml','AXIOM_REKORDBOX.xml','PEAK_HOUR_REKORDBOX.xml'),('api_export','AXIOM_SET.m3u8','PEAK_HOUR_SET.m3u8'),('api_export_serato_safe','AXIOM_Set.crate','PEAK_HOUR_Set.crate'),
   ('api_health_beatgrid_doctor_library','AXIOM-Beatgrid-Doctor-1-receipt.json','PEAK-HOUR-Beatgrid-Doctor-1-receipt.json'),('health_metadata_batch.report','AXIOM-health-1.csv','PEAK-HOUR-health-1.csv'),
   ('api_health_beatgrid_doctor_mirror_preparation','AXIOM-Beatgrid-Doctor-1.zip','PEAK-HOUR-Beatgrid-Doctor-1.zip'),('studio_bundles.download_project','AXIOM Project.axiom.zip','PEAK HOUR Project.peakhour.zip')):
  assert eps.test_client().get('/ep/'+ep,query_string={'d':f'attachment; filename="{core}"'}).headers['Content-Disposition']==f'attachment; filename="{new}"',ep
 # user files served by non-export endpoints keep their names, whatever the disposition
 for mine in ('AXIOM_Mix.mp3','axiom-demo.mp3','AXIOM Project Mix.mp3','AXIOM Project.axiom.zip'):
  for d in (f'inline; filename={mine}',f'inline; filename="{mine}"',f'attachment; filename="{mine}"',f"inline; filename*=UTF-8''{urllib.parse.quote(mine)}"):
   assert client.get('/stream',query_string={'d':d}).headers['Content-Disposition']==d,d
 assert client.get('/send',query_string={'d':'inline; filename=AXIOM_EXPORT.csv'}).headers['Content-Disposition']=='inline; filename=PEAK_HOUR_EXPORT.csv'  # allowlisted stays renamed
 original=B.disposition  # safety net: a bug in the renamer leaves the download as it was
 B.disposition=lambda value: 1/0
 try: assert disposition('attachment; filename="AXIOM_EXPORT.csv"')=='attachment; filename="AXIOM_EXPORT.csv"'
 finally: B.disposition=original
 r=client.get('/plain')  # no Content-Disposition: nothing is added or changed
 assert 'Content-Disposition' not in r.headers and r.data==body and r.headers['X-AXIOM-Source']=='AXIOM_keep'

 # The real app in a sandbox: a user's AXIOM_Mix.mp3 streams under its own name, the CSV export is still renamed
 short=pathlib.Path(tempfile.mkdtemp(prefix='pkb'));(short/'m').mkdir()
 env={'USERPROFILE':str(short),'HOME':str(short),'APPDATA':str(short/'r'),'LOCALAPPDATA':str(short/'l'),'AXIOM_RUNTIME_DIR':str(short/'rt'),'NO_PROXY':'*'}
 (short/'m'/'AXIOM_Mix.mp3').write_bytes(b'ID3'+bytes(2010))
 script=f"""
import sys,json,pathlib
sys.path.insert(0,{str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe')!r})
import axiom_windows_launcher as L
L.data_root=lambda:pathlib.Path({str(short/'rt')!r})
a=L.build_app(8097);c=a.app.test_client();b='http://127.0.0.1:8097';m={str(short/'m')!r}
add=c.post('/api/library/add_folder',base_url=b,headers={{'Origin':b}},json={{'folder_path':m,'confirmed_music_preflight':True}})
s=c.get('/api/library/stream',base_url=b,query_string={{'path':m+'/AXIOM_Mix.mp3'}})
e=c.post('/api/studio/export_csv',base_url=b,headers={{'Origin':b}},json={{'playlist':[{{'path':m+'/AXIOM_Mix.mp3','title':'x','artist':'y'}}]}})
print(json.dumps([add.status_code,s.status_code,s.headers.get('Content-Disposition'),e.status_code,e.headers.get('Content-Disposition')]))
"""
 try:
  out=subprocess.run([sys.executable,'-c',script],capture_output=True,text=True,timeout=300,env={**os.environ,**env})
  assert out.returncode==0,out.stderr[-2000:]
  add,sc,sd,ec,ed=json.loads(out.stdout.strip().splitlines()[-1])
  assert add==200 and sc in (200,206) and sd=='inline; filename=AXIOM_Mix.mp3',(add,sc,sd)
  assert ec==200 and ed=='attachment; filename=PEAK_HOUR_EXPORT.csv',(ec,ed)
 finally: shutil.rmtree(short,ignore_errors=True)
 print('PASS: Content-Disposition file names (quoted, unquoted, filename*) get PEAK HOUR prefixes on export routes only; user files, other names, middles, other headers and bodies are untouched')
except BaseException:
 traceback.print_exc();sys.exit(1)
