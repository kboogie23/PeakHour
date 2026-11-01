"""Runs AXIOM's own year lookup on the two Al Green tracks from the 17:44 library snapshot and logs
every MusicBrainz request and reply. Reads the network; writes nothing outside fixtures/health-year."""
import os,sys,pathlib,json,traceback
workspace=pathlib.Path(__file__).resolve().parent;probe=workspace/'axiom-win-probe';home=workspace/'probe-home'
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(home/'AppData/Local'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime')})
sys.path.insert(0,str(probe));os.chdir(probe)
import requests
_get=requests.get
def spy(url,*a,**k):
  r=_get(url,*a,**k)
  print('REQ',url,k.get('params'),k.get('headers'),'->',r.status_code,r.headers.get('Retry-After'),r.text[:160].replace('\n',' '))
  return r
requests.get=spy
from windows_bootstrap import build_backend
folder=workspace/'fixtures'/'health-year';app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
tracks=json.load(open(folder/'library_before.json',encoding='utf-8'))['tracks']
for t in [x for x in tracks if x.get('artist')=='Al Green'][:1]:
  try: print('result',json.dumps(app._unified_catalog_result(t,{},None,None),default=str)[:700])
  except Exception as e: print('ERROR',type(e).__name__,e)
