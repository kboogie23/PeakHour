"""Profiles AXIOM's "Add Folder" scan (_scan_and_merge_folder) on 30 copied songs in a sandbox library.
Usage: python probe_scan_profile.py [metadata_mode]"""
import os,sys,pathlib,json,time,uuid,shutil,cProfile,pstats,io
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
folder=workspace/'fixtures'/'scan-speed'/('run-'+uuid.uuid4().hex[:6]);folder.mkdir()
from windows_bootstrap import build_backend
app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
app.CACHE_PATH=str(folder/'library_cache.json');pathlib.Path(app.CACHE_PATH).write_text(json.dumps({'tracks':[]}),encoding='utf-8')
app.is_safe_location=lambda p:True
music=str(workspace/'fixtures'/'scan-speed'/'music')
mode=sys.argv[1] if len(sys.argv)>1 else None
events=[]
prof=cProfile.Profile();t0=time.time();prof.enable()
kwargs={'metadata_mode':mode} if mode else {}
result=app._scan_and_merge_folder(music,progress_callback=lambda *a,**k:events.append(time.time()-t0),**kwargs)
prof.disable();total=time.time()-t0
tracks=json.loads(pathlib.Path(app.CACHE_PATH).read_text(encoding='utf-8'))['tracks']
print('mode',mode,'total %.1fs'%total,'tracks',len(tracks),'with bpm',sum(1 for t in tracks if t.get('bpm')),'with key',sum(1 for t in tracks if t.get('camelot')),str(result)[:300])
out=io.StringIO();pstats.Stats(prof,stream=out).sort_stats('cumulative').print_stats(30);print(out.getvalue()[:6000])
