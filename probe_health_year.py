import os,sys,pathlib,shutil,json,uuid
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
snap=sys.argv[1]
folder=workspace/'fixtures'/'health-year'/('run-'+uuid.uuid4().hex[:6]);folder.mkdir()
from windows_bootstrap import build_backend
app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
app.CACHE_PATH=str(folder/'library_cache.json');shutil.copy(workspace/'fixtures'/'health-year'/snap,app.CACHE_PATH)
c=app.app.test_client();h={'Host':'127.0.0.1','Origin':'http://127.0.0.1'}
for q in sys.argv[2:]:
  r=c.get(q,headers=h);d=r.get_json(silent=True)
  if isinstance(d,dict):
    d.pop('era_options',None)
    print(q,r.status_code,json.dumps(d)[:900])
  else: print(q,r.status_code,r.data[:300])
