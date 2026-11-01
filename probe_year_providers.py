"""Calls AXIOM's individual year providers for the Al Green track and prints what each returns."""
import os,sys,pathlib,json,time
workspace=pathlib.Path(__file__).resolve().parent;probe=workspace/'axiom-win-probe';home=workspace/'probe-home'
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(home/'AppData/Local'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime')})
sys.path.insert(0,str(probe));os.chdir(probe)
from windows_bootstrap import build_backend
folder=workspace/'fixtures'/'health-year';app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
for name in ('_musicbrainz_year_lookup','_apple_music_year_lookup','_spotify_year_lookup','_discogs_year_lookup','_lastfm_year_lookup'):
  fn=getattr(app,name,None)
  try: r=fn('al green','im still in love with you') if fn else 'missing'
  except Exception as e: r=f'{type(e).__name__}: {e}'
  print(name,'->',json.dumps(r,default=str)[:400]);time.sleep(1.5)
try: print('multisource ->',json.dumps(app.fetch_year_multisource('al green','im still in love with you'),default=str)[:900])
except Exception as e: print('multisource ->',type(e).__name__,e)
