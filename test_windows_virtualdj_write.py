"""Writing cues, grid repairs and play counts into a TEMPORARY VirtualDJ database (never the real one):
only the planned song lines change, VirtualDJ's CRLF/&apos; text is kept, existing cues are never replaced,
counts only rise, stale grids are refused, VirtualDJ must be closed, and undo restores the exact bytes."""
import os,sys,pathlib,json,uuid,hashlib,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 import windows_virtualdj_write as W
 from windows_virtualdj_database import read_database
 from windows_virtualdj_lists import VirtualDJListError
 folder=workspace/'fixtures'/'vdj-write'/uuid.uuid4().hex;(folder/'home').mkdir(parents=True)
 files={}
 for n in ('cue','full','count','grid','stale','plain'):
  p=folder/f'{n} it\'s.mp3';p.write_bytes(b'\xff\xfb'+b'\0'*4000);files[n]=str(p)
 esc=lambda v:v.replace('&','&amp;').replace("'",'&apos;')
 lines=['<?xml version="1.0" encoding="UTF-8"?>','<VirtualDJ_Database Version="2023">',
  f' <Song FilePath="{esc(files["cue"])}" FileSize="4002">','  <Tags Author="A &amp; B" Title="Cue&apos;s" Bpm="0.500000" />',
  '  <Infos SongLength="200.0" LastModified="1" />','  <Poi Pos="0.0160" Num="1" Color="4291559424" Type="cue" />',' </Song>',
  f' <Song FilePath="{esc(files["full"])}" FileSize="4002">','  <Tags Author="C" Title="Full" />',
  '  <Poi Pos="10.000" Num="1" Type="cue" />','  <Poi Pos="20.000" Num="2" Type="cue" />',' </Song>',
  f' <Song FilePath="{esc(files["count"])}" FileSize="4002" />',
  f' <Song FilePath="{esc(files["grid"])}" FileSize="4002">','  <Tags Author="D" Title="Grid" />',
  '  <Infos PlayCount="9" LastPlay="5" />',
  '  <Scan Version="801" Bpm="0.500000" Phase="0.100000" AltBpm="0.750000" Key="C" Flag="32768" />',
  '  <Poi Pos="0.100000" Type="beatgrid" />','  <Poi Pos="0.05" Type="automix" Point="realStart" />',' </Song>',
  f' <Song FilePath="{esc(files["stale"])}" FileSize="4002">',
  '  <Scan Version="801" Bpm="0.600000" Phase="0.200000" />','  <Poi Pos="0.200000" Type="beatgrid" />',' </Song>',
  f' <Song FilePath="{esc(files["plain"])}" FileSize="4002">','  <Tags Author="E" Title="Plain" />',' </Song>',
  '</VirtualDJ_Database>','']
 db=folder/'home'/'database.xml';original='\r\n'.join(lines).encode('utf-8');db.write_bytes(original)
 key=W._key
 cues={key(files['cue']):[{'label':'CUE 1','time_ms':16,'color':'#cc0000'},{'label':'Drop','time_ms':32500,'color':'#00ff00'}],
       key(files['full']):[{'label':'CUE 1','time_ms':5000,'index':0},{'label':'CUE 3','time_ms':30000,'index':2}],
       key(files['plain']):[{'label':'CUE 1','time_ms':1000,'color':'bad'}]}
 class App:
  def read_serato_cues(self,path):return cues.get(key(path),[])
  def _load_djay_cues_for_path(self,path):return []
  def read_cues(self,path):return []
  class WINDOWS_VIRTUALDJ_GRIDS:
   @staticmethod
   def snapshot(include_results=False):
    return {'results':[{'path':files['grid'],'status':'repair','repair_grid':{'spb':0.49,'first':0.12,'bpm':122.449},
                        'checked_grid':{'first':0.1,'spb':0.5}},
                       {'path':files['stale'],'status':'repair','repair_grid':{'spb':0.59,'first':0.21,'bpm':101.69},
                        'checked_grid':{'first':0.25,'spb':0.6}}]}
 closed=[]
 def ensure_closed():
  closed.append(1)
  if running:raise VirtualDJListError('Quit VirtualDJ, then try again.')
 running=False
 writer=W.VirtualDJWriter(App(),folder/'writes',databases=lambda:[db],ensure_closed=ensure_closed)
 writer._sources=lambda kinds:{'serato':{key(files['count']):3,key(files['grid']):4},'djay':{key(files['count']):5},
                               'grids':W._grid_repairs(writer.app) if 'grids' in kinds else {}}
 kinds=['cues','grids','play_counts']
 p=writer.preview(kinds)
 assert p['counts']=={'cues':3,'grids':1,'play_counts':1},p['counts']
 assert db.read_bytes()==original and not list((folder/'home').glob('*axiom*'))  # preview writes nothing near VirtualDJ
 reasons=[r for x in p['skipped'] for r in x['reasons']]
 assert any('already uses this slot' in r for r in reasons) and any('changed in VirtualDJ since' in r for r in reasons),reasons
 # Refusals: no confirmation, VirtualDJ running, stale token
 from flask import Flask
 web=Flask('t');web.register_blueprint(W.create_write_blueprint(writer,lambda action:None));c=web.test_client()
 h={'Origin':'http://localhost'}
 assert c.post('/api/windows/virtualdj/write/apply',json={'kinds':kinds,'preview_token':p['preview_token']},headers=h).status_code==400
 assert c.post('/api/windows/virtualdj/write/preview',json={'kinds':kinds}).status_code==403  # no Origin
 running=True
 r=c.post('/api/windows/virtualdj/write/apply',json={'kinds':kinds,'preview_token':p['preview_token'],'confirm':True},headers=h)
 assert r.status_code==400 and 'Quit VirtualDJ' in r.get_json()['error'] and db.read_bytes()==original
 running=False
 r=c.post('/api/windows/virtualdj/write/apply',json={'kinds':kinds,'preview_token':'x','confirm':True},headers=h)
 assert r.status_code==400 and 'Preview again' in r.get_json()['error'] and db.read_bytes()==original
 # Write
 r=c.post('/api/windows/virtualdj/write/apply',json={'kinds':kinds,'preview_token':p['preview_token'],'confirm':True},headers=h).get_json()
 assert r['success'] and r['written']==5 and r['undo']['available'],r
 after=db.read_bytes();text=after.decode('utf-8')
 assert b'\r\n' in after and b'\n' not in after.replace(b'\r\n',b'') and '&apos;' in text and '&amp;' in text
 old_songs=W.songs(original.decode());new_songs=W.songs(text)
 old_text=original.decode()
 changed=set()
 for (a,b,e),(c2,d,f) in zip(old_songs,new_songs):
  if old_text[a:b]!=text[c2:d]:changed.add(pathlib.Path(e.get('FilePath')).stem.split(' ')[0])
 assert changed=={'cue','full','count','grid','plain'},changed
 assert old_text[:old_songs[0][0]]==text[:new_songs[0][0]] and old_text[old_songs[-1][1]:]==text[new_songs[-1][1]:]
 tracks={pathlib.Path(t['path']).stem.split(' ')[0]:t for t in read_database(db)['tracks']}
 poi=lambda n:[x['attributes'] for x in tracks[n]['source_sections'].get('Poi',[])]
 assert poi('cue')==[{'Pos':'0.0160','Num':'1','Color':'4291559424','Type':'cue'},
                     {'Name':'Drop','Pos':'32.500','Num':'2','Color':str(0xFF00FF00),'Type':'cue'}],poi('cue')
 assert [x['Num'] for x in poi('full')]==['1','2','3'] and poi('full')[2]['Pos']=='30.000'  # slot 1 kept, 3 added
 assert poi('plain')==[{'Pos':'1.000','Num':'1','Type':'cue'}]  # unreadable colour: cue kept, colour left out
 assert tracks['count']['source_sections']['Infos'][0]['attributes']=={'PlayCount':'5'}  # higher of Serato 3 / djay 5
 assert tracks['grid']['source_sections']['Infos'][0]['attributes']=={'PlayCount':'9','LastPlay':'5'}  # 9 > Serato 4: never lowered
 scan=tracks['grid']['source_sections']['Scan'][0]['attributes']
 assert scan['Bpm']=='0.490000' and scan['Phase']=='0.120000' and scan['AltBpm']=='0.750000'
 assert [x for x in poi('grid') if x['Type']=='beatgrid']==[{'Pos':'0.120000','Type':'beatgrid'}] and poi('grid')[1]['Type']=='automix'
 assert tracks['stale']['source_sections']['Scan'][0]['attributes']['Bpm']=='0.600000'  # grid changed since the check: kept
 assert tracks['cue']['source_sections']['Tags'][0]['attributes']['Bpm']=='0.500000'  # no grid change for this song
 assert closed
 backup=pathlib.Path(r['backups'][0]);assert backup.read_bytes()==original and backup.parent.parent==folder/'writes'
 # A second preview finds nothing left to do
 again=writer.preview(kinds);assert again['counts']=={'cues':0,'grids':0,'play_counts':0},again['counts']
 # Undo restores the exact bytes; refused once VirtualDJ has changed the file
 r=c.post('/api/windows/virtualdj/write/undo',headers=h).get_json();assert r['success'] and db.read_bytes()==original,r
 assert not writer.undo_status()['available']
 p=writer.preview(['play_counts']);r=writer.apply(['play_counts'],p['preview_token']);assert r['written']==1
 db.write_bytes(db.read_bytes()+b'\r\n')  # VirtualDJ saved again
 st=writer.undo_status();assert not st['available'] and 'cannot be undone' in st['reason']
 r=c.post('/api/windows/virtualdj/write/undo',headers=h);assert r.status_code==400
 # Grid check keeps a straight repair for the writer, not a fluid one
 from windows_virtualdj_grids import repair_grid
 assert repair_grid({'grid':{'mode':'straight','bpm':120,'beat_anchors':[{'beat':2,'seconds':1.0}]}})=={'spb':0.5,'first':0.0,'bpm':120.0}
 assert repair_grid({'grid':{'mode':'straight','bpm':120,'beat_anchors':[{'beat':4,'seconds':0.5}]}})=={'spb':0.5,'first':0.5,'bpm':120.0}
 assert repair_grid({'grid':{'mode':'fluid','bpm':120,'beat_anchors':[{'beat':0,'seconds':0.1}]}}) is None
 assert repair_grid({'grid':{'mode':'straight','bpm':120,'terminal_bpm':121,'beat_anchors':[{'beat':0,'seconds':0.1}]}}) is None
 import shutil;shutil.rmtree(folder)
 print('PASS: VirtualDJ write-back changes only planned song lines, keeps existing cues, raises counts only, refuses stale grids, undoes exactly')
except BaseException:
 traceback.print_exc();sys.exit(1)
