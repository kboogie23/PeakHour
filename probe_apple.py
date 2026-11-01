import os,sys,pathlib,json
workspace=pathlib.Path(__file__).resolve().parent;probe=workspace/'axiom-win-probe';home=workspace/'probe-home'
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(home/'AppData/Local'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime')})
sys.path.insert(0,str(probe));os.chdir(probe)
import requests
_get=requests.get
def spy(url,*a,**k):
  r=_get(url,*a,**k)
  if 'itunes' in url:
    for x in r.json().get('results',[])[:10]: print('   ',x.get('artistName'),'|',x.get('trackName'),'|',x.get('releaseDate','')[:10])
  return r
requests.get=spy
from windows_bootstrap import build_backend
folder=workspace/'fixtures'/'health-year';app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
for t in ('im still in love with you',"i'm still in love with you"):
  print(t,'->',json.dumps(app._apple_music_year_lookup('al green',t),default=str)[:500])
