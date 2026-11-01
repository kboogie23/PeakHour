"""Create a VirtualDJ list through AXIOM's API in a STAND-IN VirtualDJ home.

Usage: python check_virtualdj_list_write.py <copied database.xml> [count]
Uses tracks from that database (and drive databases such as E:\\VirtualDJ) that
exist on disk. Tracks and drive databases are only read; the real VirtualDJ
folder is never written.
"""
import os,sys,pathlib,shutil,uuid,ntpath
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
database=pathlib.Path(sys.argv[1]).resolve();count=int(sys.argv[2]) if len(sys.argv)>2 else 12
real_home=pathlib.Path(os.environ['LOCALAPPDATA'],'VirtualDJ')
if database.is_relative_to(real_home):sys.exit('Pass a copy, not the live VirtualDJ database')
from flask import Flask
from windows_virtualdj_api import create_virtualdj_blueprint
from windows_virtualdj_database import read_database
from windows_virtualdj_lists import read_list,ensure_virtualdj_closed,database_paths
home=root/'fixtures'/'vdj'/uuid.uuid4().hex;(home/'MyLists').mkdir(parents=True);shutil.copy2(database,home/'database.xml')
media=('.mp3','.mp4','.wav','.m4a','.avi','.vob','.mov')
candidates=[t['path'] for t in read_database(home/'database.xml')['tracks'] if t['path'].lower().endswith(media) and os.path.isfile(t['path'])]
drive_db=pathlib.Path('E:\\VirtualDJ\\database.xml')
if drive_db.is_file():candidates+=[t['path'] for t in read_database(drive_db)['tracks'] if t['path'].lower().endswith(media) and os.path.isfile(t['path'])][:count//2]
paths=candidates[:count-count//2]+[p for p in candidates if p.upper().startswith('E:')][:count//2]
print('tracks chosen:',len(paths),'on E:',sum(p.upper().startswith('E:') for p in paths))
before={p:(os.stat(p).st_size,os.stat(p).st_mtime_ns) for p in paths}
app=Flask(__name__)
app.register_blueprint(create_virtualdj_blueprint(lambda p:True,lambda feature:None,home=lambda:home,ensure_closed=(lambda:None) if os.environ.get("AXIOM_CHECK_STANDIN_ONLY")=="1" else ensure_virtualdj_closed))  # stand-in home only
client=app.test_client();headers={'Origin':'http://localhost'}
response=client.post('/api/windows/virtualdj/lists',json={'name':'AXIOM Check','paths':paths},headers=headers)
print(response.status_code,response.json)
written=read_list(home/'MyLists'/'AXIOM Check.vdjfolder')
dbs={}
for p in database_paths(home,paths):
    for t in read_database(p)['tracks']:dbs[ntpath.normcase(t['path'])]=t
ok=True
for i,(song,path) in enumerate(zip(written['songs'],paths)):
    t=dbs.get(ntpath.normcase(path));tags=(t or {}).get('source_sections',{}).get('Tags',[{}])[0].get('attributes',{}) if t else {}
    want={'path':path,'size':str(before[path][0]),'idx':str(i)}
    for k,src in (('artist','Author'),('title','Title'),('remix','Remix')):
        if tags.get(src):want[k]=tags[src]
    if t and t.get('duration_sec'):want['songlength']='%.1f'%t['duration_sec']
    if song!=want:ok=False;print('MISMATCH',song,want)
print('order, sizes and database details correct:',ok and len(written['songs'])==len(paths),'| attributes:',written['attributes'])
again=client.post('/api/windows/virtualdj/lists',json={'name':'AXIOM Check','paths':paths},headers=headers)
print('second write refused:',again.status_code,again.json.get('error'))
print('tracks untouched:',all((os.stat(p).st_size,os.stat(p).st_mtime_ns)==v for p,v in before.items()))
print('stand-in home:',home)
