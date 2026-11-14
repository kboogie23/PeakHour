"""Library > Type (windows_filetypes.py): the Library list and its search show only audio, only video or one file
type when the page asks; without it nothing changes; the counts endpoint reports each type; other requests that
use AXIOM's era check are not affected."""
import os,sys,pathlib,uuid,json,shutil,subprocess,traceback
workspace=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(workspace/'axiom-win-probe'))
try:
 import windows_filetypes as F
 assert F.matches_type({'path':'C:/a/Song.MP3'},'audio') and F.matches_type({'path':'C:/a/v.VOB'},'video') and F.matches_type({'path':'C:/a/v.vob'},'vob')
 assert not F.matches_type({'path':'C:/a/v.mp4'},'audio') and not F.matches_type({'path':'C:/a/s.mp3'},'mp4')
 base=workspace/'fixtures'/'filetypes'/uuid.uuid4().hex;data=base/'data';(data/'data').mkdir(parents=True);music=base/'Music';music.mkdir()
 names=['one.mp3','two.mp3','three.m4a','four.wav','clip.mp4','old.vob','show.avi']
 seed=workspace/'fixtures'/'stress'/'seed.mp3'
 for n in names:shutil.copyfile(seed,music/n)
 tracks=[{'path':str(music/n),'filename':n,'title':f'Love {n}','artist':'A','bpm':95,'camelot':'8A','year':2001,'era':'2k Era','energy':'Mid','duration_sec':200} for n in names]
 (data/'data'/'library_cache.json').write_text(json.dumps({'tracks':tracks,'total_tracks':len(tracks),'folder_structure':{str(music):{}}}),encoding='utf-8')
 script=f'''
import os,sys,json,pathlib
os.environ['AXIOM_RUNTIME_DIR']={str(data)!r}
sys.path.insert(0,{str(workspace/'axiom-win-probe')!r})
import axiom_windows_launcher as L
L.data_root=lambda:pathlib.Path({str(data)!r})
axiom=L.build_app(8096);c=axiom.app.test_client();b='http://127.0.0.1:8096';out={{}}
def names(u):
    d=c.get(u,base_url=b).get_json();return sorted(os.path.basename(t['path']) for t in (d.get('tracks') or d.get('results') or []))
for ft in ('','audio','video','mp3','vob','avi','m4a','flac'):
    q='&filetype='+ft if ft else ''
    out['list_'+ft]=names('/get-tracks?era=All&preparation=all&sort=default&limit=40&offset=0'+q)
    out['search_'+ft]=names('/api/library/search?q=love&era=All&limit=40'+q)
out['types']=c.get('/api/windows/library/types',base_url=b).get_json()
out['types_again']=c.get('/api/windows/library/types',base_url=b).get_json()  # answered from the kept counts while the library file is unchanged
out['era_check_outside']=axiom._load_library_search_snapshot()[0]['tracks'].__len__()==7
cache_file=pathlib.Path(axiom.CACHE_PATH);saved=json.loads(cache_file.read_text(encoding='utf-8'))
saved['tracks'].append(dict(saved['tracks'][0],path=saved['tracks'][0]['path'].rsplit('.',1)[0]+'-new.mp4'));cache_file.write_text(json.dumps(saved),encoding='utf-8')
out['types_edited']=c.get('/api/windows/library/types',base_url=b).get_json()['video']
print(json.dumps(out))
'''
 run=subprocess.run([sys.executable,'-c',script],capture_output=True,text=True,timeout=300,cwd=str(workspace))
 assert run.returncode==0,run.stderr[-3000:]
 out=json.loads(run.stdout.strip().splitlines()[-1])
 allnames=sorted(names)
 assert out['list_']==allnames and out['search_']==allnames,out['list_']
 assert out['list_audio']==sorted(['one.mp3','two.mp3','three.m4a','four.wav'])==out['search_audio']
 assert out['list_video']==sorted(['clip.mp4','old.vob','show.avi'])==out['search_video']
 assert out['list_mp3']==['one.mp3','two.mp3'] and out['list_vob']==['old.vob'] and out['list_avi']==['show.avi'] and out['list_m4a']==['three.m4a'] and out['list_flac']==[]
 t=out['types'];assert t['audio']==4 and t['video']==3 and {x['type']:x['count'] for x in t['types']}=={'mp3':2,'m4a':1,'wav':1,'mp4':1,'vob':1,'avi':1}
 assert out['types_again']==t and out['types_edited']==4  # kept counts match; a changed library file is counted again
 assert out['era_check_outside'] is True
 shutil.rmtree(base,ignore_errors=True)
 print('PASS: Library Type filter narrows the list and search to audio, video or one file type; counts per type')
except BaseException:
 traceback.print_exc();sys.exit(1)
