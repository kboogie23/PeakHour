"""VirtualDJ lists for AXIOM's Serato-only exports (year fixes, no cue points), written to a TEMPORARY
VirtualDJ home with the real list writer; selection matches AXIOM's Serato year handoff."""
import os,sys,pathlib,json,uuid,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 import windows_virtualdj_exports as X
 from windows_virtualdj_lists import read_list
 folder=workspace/'fixtures'/'vdj-exports'/uuid.uuid4().hex;(folder/'home'/'MyLists').mkdir(parents=True)
 files=[]
 for n in 'abcde':
  p=folder/f'{n}.mp3';p.write_bytes(b'\xff\xfb'+b'\0'*4000);files.append(str(p))
 db=folder/'home'/'database.xml'
 db.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<VirtualDJ_Database Version="2024">\n'
  f'<Song FilePath="{files[0]}" FileSize="4002"><Tags Author="A" Title="One"/><Poi Pos="1.0" Type="cue" Num="1"/></Song>\n'
  f'<Song FilePath="{files[1]}" FileSize="4002"><Tags Author="B" Title="Two"/><Poi Pos="0.5" Type="beatgrid"/></Song>\n'
  '</VirtualDJ_Database>\n',encoding='utf-8')
 from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 tracks=[{'path':files[0],'artist':'Zed','title':'One','year':1999,'year_source':'apple_music'},
         {'path':files[1],'artist':'Amy','title':'Two','year':1999,'year_updated_at':'2026-10-30T00:00:00Z'},
         {'path':files[2],'artist':'Bob','title':'Three','year':1985},  # year but not set by AXIOM
         {'path':files[3],'artist':'Cal','title':'Four'},               # no year
         {'path':files[4]+'.missing','artist':'Dee','title':'Gone','year':1970,'year_source':'x'}]
 app.CACHE_PATH=str(folder/'library_cache.json');pathlib.Path(app.CACHE_PATH).write_text(json.dumps({'tracks':tracks}),encoding='utf-8')
 picked,total=X.year_fix_tracks(app)
 assert [t['title'] for t in picked]==['Gone','Two','One'] and total==3,[t['title'] for t in picked]  # by year, then artist
 assert [t['title'] for t in X.year_fix_tracks(app,include_all=True)[0]]==['Gone','Three','Two','One']
 assert [t['title'] for t in X.no_cue_tracks(app,databases=lambda:[db])]==['Two','Three','Four']  # One has a VirtualDJ cue; Gone is offline
 closed=[];writer={'home':lambda:folder/'home','ensure_closed':lambda:closed.append(1)}
 import flask;f=flask.Flask('t');f.register_blueprint(X.create_exports_blueprint(app,lambda p:True,lambda n:None,databases=lambda:[db],**writer));c=f.test_client()
 r=c.post('/api/windows/virtualdj/export/year_fixes',json={'name':'Years'}).get_json()
 assert r['success'] and r['tracks']==2 and r['total_year_fix_candidates']==3,r  # the offline song is skipped
 assert [pathlib.Path(x['path']).name for x in read_list(folder/'home'/'MyLists'/'Years.vdjfolder')['songs']]==['b.mp3','a.mp3']
 r=c.post('/api/windows/virtualdj/export/no_cue',json={'name':'Needs Cues'}).get_json();assert r['success'] and r['tracks']==3,r
 assert c.post('/api/windows/virtualdj/export/no_cue',json={'name':'Needs Cues'}).status_code==409  # never overwritten
 assert c.post('/api/windows/virtualdj/export/no_cue',json={'name':'bad/name'}).status_code==400
 assert closed  # VirtualDJ-closed check ran before writing
 print('PASS: VirtualDJ year-fix and no-cue lists match AXIOM\'s Serato selection, skip offline songs, never overwrite')
except BaseException:
 traceback.print_exc();sys.exit(1)
