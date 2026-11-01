"""Health release-year repairs: titles with dropped apostrophes reach the catalogs as "I'm"/"Don't", and
Fix Eras' Smart view lists songs with no year (or only a file-date estimate) as Manual rows. Runs on copies
of the user's 56-track library taken before (2 missing years) and after (2 file-date estimates)."""
import os,sys,pathlib,shutil,json,uuid,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 import windows_year_fixes as Y
 calls=[]
 def provider(artist,title):
  calls.append(title);return {'year':1972,'source':'test'} if "i'm" in title else None
 wrapped=Y.with_contractions(provider)
 assert wrapped('al green','im still in love with you')['year']==1972 and calls==["i'm still in love with you"]
 calls.clear();assert wrapped('x','imagine') is None and calls==['imagine']  # untouched titles are asked once
 calls.clear();assert Y.with_contractions(lambda a,t:calls.append(t))('x','dont go') is None and calls==["don't go",'dont go']
 assert Y.restore_contractions('Its My Life') is None and Y.restore_contractions('Ill Be There') is None
 folder=workspace/'fixtures'/'health-year'/('run-'+uuid.uuid4().hex[:6]);folder.mkdir()
 from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 client=app.app.test_client();h={'Host':'127.0.0.1','Origin':'http://127.0.0.1'}
 def audit(snapshot,url):
  app.CACHE_PATH=str(folder/'library_cache.json');shutil.copy(workspace/'fixtures'/'health-year'/snapshot,app.CACHE_PATH)
  r=client.get(url,headers=h);assert r.status_code==200,r.status_code;return r.get_json()
 before=audit('library_before.json','/api/library/era_audit?mode=smart&q=&page=0')
 rows=[(r['artist'],r['current_year'],r['confidence']) for r in before['rows']]
 assert rows==[('Al Green',None,'manual')]*2 and before['summary']['review']==2 and before['summary']['checked']==56,(rows,before['summary'])
 assert all('No release year' in r['reason'] for r in before['rows'])
 now=audit('library_now.json','/api/library/era_audit?mode=smart&q=&page=0')
 assert [(r['artist'],r['current_year']) for r in now['rows']]==[('Al Green',2021)]*2 and now['summary']['review']==2,now['summary']
 assert all('estimate from the file date' in r['reason'] for r in now['rows'])
 search=audit('library_before.json','/api/library/era_audit?mode=search&q=al%20green&page=0')
 assert len(search['rows'])==2  # a named search is unchanged: only its own matches
 assert json.loads((workspace/'fixtures'/'health-year'/'library_before.json').read_text(encoding='utf-8'))['tracks'][0]  # snapshot untouched
 print('PASS: dropped apostrophes restored for catalog lookups; Fix Eras lists the 2 missing (or file-date) years as Manual rows; Scan details counts them')
except BaseException:
 traceback.print_exc();sys.exit(1)
