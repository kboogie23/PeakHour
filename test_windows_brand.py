"""PEAK HOUR names on downloaded files: only the file name in Content-Disposition changes."""
import sys,pathlib,traceback,types,urllib.parse
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
 @flask_app.route('/send')
 def send():
  response=flask.Response(body,mimetype='text/csv');response.headers['Content-Disposition']=flask.request.args['d'];response.headers['X-AXIOM-Track-Count']='3';return response
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
 original=B.disposition  # safety net: a bug in the renamer leaves the download as it was
 B.disposition=lambda value: 1/0
 try: assert disposition('attachment; filename="AXIOM_EXPORT.csv"')=='attachment; filename="AXIOM_EXPORT.csv"'
 finally: B.disposition=original
 r=client.get('/plain')  # no Content-Disposition: nothing is added or changed
 assert 'Content-Disposition' not in r.headers and r.data==body and r.headers['X-AXIOM-Source']=='AXIOM_keep'
 print('PASS: Content-Disposition file names (quoted, unquoted, filename*) get PEAK HOUR prefixes; other names, middles, other headers and bodies are untouched')
except BaseException:
 traceback.print_exc();sys.exit(1)
