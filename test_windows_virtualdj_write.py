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
 assert c.post('/api/windows/virtualdj/write/apply',json={'background':False,'kinds':kinds,'preview_token':p['preview_token']},headers=h).status_code==400
 assert c.post('/api/windows/virtualdj/write/preview',json={'background':False,'kinds':kinds}).status_code==403  # no Origin
 running=True
 r=c.post('/api/windows/virtualdj/write/apply',json={'background':False,'kinds':kinds,'preview_token':p['preview_token'],'confirm':True},headers=h)
 assert r.status_code==400 and 'Quit VirtualDJ' in r.get_json()['error'] and db.read_bytes()==original
 running=False
 r=c.post('/api/windows/virtualdj/write/apply',json={'background':False,'kinds':kinds,'preview_token':'x','confirm':True},headers=h)
 assert r.status_code==400 and 'Preview again' in r.get_json()['error'] and db.read_bytes()==original
 # Write
 r=c.post('/api/windows/virtualdj/write/apply',json={'background':False,'kinds':kinds,'preview_token':p['preview_token'],'confirm':True},headers=h).get_json()
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
 # Writing reuses the plans its preview made (no second read of every audio file) as long as nothing they came from has changed
 def make_db(parent,count,name='database.xml'):
  parent.mkdir(parents=True,exist_ok=True);rows=['<?xml version="1.0" encoding="UTF-8"?>','<VirtualDJ_Database Version="2023">'];paths=[]
  for i in range(count):
   f=parent/f'track {i}.mp3';f.write_bytes(b'\xff\xfb'+bytes([i%251])*2000);paths.append(str(f))
   rows+=[f' <Song FilePath="{str(f)}" FileSize="2002">',f'  <Tags Author="A{i}" Title="T{i}" />','  <Infos SongLength="200.0" PlayCount="1" />',
          '  <Poi Pos="1.000" Num="1" Type="cue" />',' </Song>']
  target=parent/name;target.write_bytes('\r\n'.join(rows+['</VirtualDJ_Database>','']).encode('utf-8'));return target,paths
 reads=[]
 class CueApp:
  shift=0
  def read_serato_cues(self,path):
   reads.append(path);end=time.perf_counter()+0.002
   while time.perf_counter()<end:pass  # stands in for parsing the tags of a real audio file
   return [{'label':'Drop','time_ms':30000+self.shift,'index':2}]
  def _load_djay_cues_for_path(self,path):return []
  def read_cues(self,path):return []
 import time
 big_db,big_files=make_db(folder/'big',2000);big_original=big_db.read_bytes()
 app=CueApp();big=W.VirtualDJWriter(app,folder/'big-writes',databases=lambda:[big_db],ensure_closed=lambda:None)
 big._sources=lambda kinds:{'serato':{},'djay':{},'grids':{}}
 t0=time.perf_counter();pv=big.preview(['cues']);t_preview=time.perf_counter()-t0;assert pv['counts']['cues']==2000 and len(reads)==2000
 del reads[:];t0=time.perf_counter();big._plans(['cues']);t_replan=time.perf_counter()-t0  # what writing used to do first
 assert len(reads)==2000;del reads[:]
 t0=time.perf_counter();r=big.apply(['cues'],pv['preview_token']);t_apply=time.perf_counter()-t0
 assert r['success'] and r['written']==2000 and reads==[] and big_db.read_bytes()!=big_original and big.undo_status()['available']
 print('virtualdj write, 2000 tracks (2 ms simulated tag read each): preview %.2fs; replanning for apply used to cost %.2fs (2000 file reads), apply now %.2fs (0 reads)'%(t_preview,t_replan,t_apply))
 assert t_apply<t_replan
 big.undo();assert big_db.read_bytes()==big_original
 # Anything changed since the preview: the plans are not reused and the old checks apply
 def fresh_preview(kinds=('cues',)):
  del reads[:];return big.preview(list(kinds))
 pv=fresh_preview();open(big_files[7],'ab').write(b'x');del reads[:]  # an audio file changed
 r=big.apply(['cues'],pv['preview_token']);assert r['success'] and len(reads)==2000  # planned again; same cues, same token: written
 big.undo()
 pv=fresh_preview();app.shift=500  # the cue source gives other cues now, and the audio file moved on too
 os.utime(big_files[9],(1,1))
 try:big.apply(['cues'],pv['preview_token']);raise AssertionError('stale preview was written')
 except W.VirtualDJWriteError as e:assert 'Preview again' in str(e)
 assert big_db.read_bytes()==big_original;app.shift=0
 pv=fresh_preview();big_db.write_bytes(big_original+b'\r\n')  # VirtualDJ saved its database
 try:big.apply(['cues'],pv['preview_token']);raise AssertionError('changed database was written')
 except W.VirtualDJWriteError as e:assert 'Preview again' in str(e)
 assert big_db.read_bytes()==big_original+b'\r\n';big_db.write_bytes(big_original)
 pv=fresh_preview();big._previews[pv['preview_token']]['at']-=W.PREVIEW_SECONDS+1;del reads[:]  # expired: planned again
 r=big.apply(['cues'],pv['preview_token']);assert r['success'] and len(reads)==2000;big.undo()
 for kinds in (['cues'],['play_counts'],['grids'],['cues','play_counts'],['cues','grids']):big.preview(kinds)
 assert len(big._previews)<=W.PREVIEWS_KEPT,len(big._previews)
 # The kept preview is small, expires on insert, and also depends on djay's library file and AXIOM's saved-cue files
 import pickle,utils.cues as UC
 assert W.PREVIEWS_KEPT==1
 pv=fresh_preview();entry=big._previews[pv['preview_token']];assert len(big._previews)==1
 (kept,)=entry['plans'];assert kept['before'] is None and len(kept['before_sha'])==64 and kept['after']
 old_style=len(big_original)+len(kept['after']);now_style=len(pickle.dumps(entry))
 print('virtualdj write preview cache, 2000 tracks: database %d bytes; kept before the fix (before+after bytes, up to 3 previews) %d bytes each; now %d bytes in total for 1 preview (%d of them the new text, the rest signatures and rows)'%(len(big_original),old_style,now_style,len(kept['after'])))
 idle_db,_f=make_db(folder/'idle',1);idle=W.VirtualDJWriter(CueApp(),folder/'idle-writes',databases=lambda:[idle_db],ensure_closed=lambda:None)
 idle._sources=lambda kinds:{'serato':{},'djay':{},'grids':{}};idle.preview(['play_counts'])
 (kept,)=next(iter(idle._previews.values()))['plans'];assert kept['rows']==[] and kept['after'] is None and kept['before'] is None
 big._previews['stale']={'at':time.monotonic()-W.PREVIEW_SECONDS-1}  # an expired entry
 big.preview(['cues']);assert 'stale' not in big._previews and len(big._previews)==1  # expired entries go on insert
 djay_db=folder/'MediaLibrary.db';djay_db.write_bytes(b'one');app.DJAY_MEDIA_LIBRARY_DB=str(djay_db)
 pv=fresh_preview();del reads[:];r=big.apply(['cues'],pv['preview_token']);assert r['success'] and reads==[];big.undo()  # unchanged djay file: reused
 pv=fresh_preview();djay_db.write_bytes(b'two!');del reads[:]  # djay changed since the preview
 r=big.apply(['cues'],pv['preview_token']);assert r['success'] and len(reads)==2000;big.undo()  # planned again (same result here, so written)
 cue_dir=folder/'axiom-cues';cue_dir.mkdir();real_sidecar=UC.sidecar_path_for
 UC.sidecar_path_for=lambda path:str(cue_dir/(hashlib.sha256(path.encode()).hexdigest()+'.cues.json'))
 try:
  pv=fresh_preview();(cue_dir/(hashlib.sha256(big_files[3].encode()).hexdigest()+'.cues.json')).write_text('[]');del reads[:]  # AXIOM saved cues for a song
  r=big.apply(['cues'],pv['preview_token']);assert r['success'] and len(reads)==2000;big.undo()
  pv=fresh_preview();del reads[:];r=big.apply(['cues'],pv['preview_token']);assert r['success'] and reads==[];big.undo()
 finally:UC.sidecar_path_for=real_sidecar
 # A request for some songs looks at those songs only: no tag reads for the others, and the same songs written
 chosen=big_files[100:105]
 for name in ('database.xml',):assert big_db.read_bytes()==big_original
 del reads[:];t0=time.perf_counter();sp=big.preview(['cues'],W.scope_keys(chosen));t_scoped=time.perf_counter()-t0
 assert sp['scoped'] and sp['songs']==5 and sp['counts']['cues']==5 and sorted(reads)==sorted(chosen),(sp['songs'],len(reads))
 assert {row['path'] for row in sp['rows']}==set(chosen)
 other=big.preview(['cues'],W.scope_keys(big_files[:3]));assert other['preview_token']!=sp['preview_token']  # the token names the songs
 sp=big.preview(['cues'],W.scope_keys(chosen))
 try:big.apply(['cues'],sp['preview_token']);raise AssertionError('a token for some songs wrote the whole library')
 except W.VirtualDJWriteError as e:assert 'Preview again' in str(e)
 del reads[:];r=big.apply(['cues'],sp['preview_token'],W.scope_keys(chosen))
 assert r['success'] and r['written']==5 and reads==[] and big_db.read_bytes()!=big_original
 changed_text=big_db.read_bytes().decode('utf-8');old_text=big_original.decode('utf-8')
 assert [s for s,e,el in W.songs(changed_text) if el.get('FilePath') in chosen] and len(W.songs(changed_text))==2000
 only={el.get('FilePath') for (a,b,el),(c2,d,f) in zip(W.songs(old_text),W.songs(changed_text)) if old_text[a:b]!=changed_text[c2:d]};assert only==set(chosen),only
 big.undo();assert big_db.read_bytes()==big_original
 # the path index is remembered while the file is unchanged; an odd file (FilePath not first) still works
 t0=time.perf_counter();big.preview(['cues'],W.scope_keys(chosen));t_again=time.perf_counter()-t0
 print('virtualdj write, 5 songs of 2000: preview %.2fs (%.2fs the second time); the whole library took %.2fs'%(t_scoped,t_again,t_preview))
 assert t_again<t_preview
 odd,odd_files=make_db(folder/'odd',3);odd.write_bytes(odd.read_bytes().replace(b'<Song FilePath=',b'<Song Flag="1" FilePath=',1))
 oddw=W.VirtualDJWriter(CueApp(),folder/'odd-writes',databases=lambda:[odd],ensure_closed=lambda:None);oddw._sources=lambda kinds:{'serato':{},'djay':{},'grids':{}}
 assert oddw.preview(['cues'],W.scope_keys(odd_files[:2]))['songs']==2
 # Big requests run as background jobs with progress (the whole library, or more than 50 songs); a few songs answer at once
 import time as _t
 web2=Flask('t2');web2.register_blueprint(W.create_write_blueprint(big,lambda action:None));c2=web2.test_client()
 def job_wait(job_id):
  for _ in range(400):
   j=c2.get('/api/windows/virtualdj/write/job/'+job_id).get_json()
   if j['state']!='running':return j
   _t.sleep(0.05)
  raise AssertionError('job did not finish')
 started=c2.post('/api/windows/virtualdj/write/preview',json={'kinds':['cues'],'tracks':big_files[:60]},headers=h).get_json()
 assert started['background'] and started['job_id'],started
 job=job_wait(started['job_id']);assert job['state']=='done' and job['result']['songs']==60,job
 now=c2.post('/api/windows/virtualdj/write/preview',json={'kinds':['cues'],'tracks':big_files[:5]},headers=h).get_json()
 assert now['songs']==5 and 'job_id' not in now,now  # few songs: no job
 started=c2.post('/api/windows/virtualdj/write/preview',json={'kinds':['cues']},headers=h).get_json()  # no tracks = the whole library
 job=job_wait(started['job_id']);assert job['state']=='done' and job['result']['songs']==2000,job['state']
 assert c2.get('/api/windows/virtualdj/write/job/nope').status_code==404
 # A failed swap leaves no stage file; a failed rollback does not hide the first error; a bad read-back is rolled back
 small,_ = make_db(folder/'s1',3);small2,_ = make_db(folder/'s2',3)
 two=W.VirtualDJWriter(CueApp(),folder/'two-writes',databases=lambda:[small,small2],ensure_closed=lambda:None)
 two._sources=lambda kinds:{'serato':{},'djay':{},'grids':{}}
 o1,o2=small.read_bytes(),small2.read_bytes();real_replace=os.replace
 def boom(a,b):raise OSError('disk full')
 os.replace=boom
 try:W._replace(small,b'new');raise AssertionError('swap should fail')
 except OSError as e:assert 'disk full' in str(e)
 finally:os.replace=real_replace
 assert not list(small.parent.glob('*.axiom-*.tmp')) and small.read_bytes()==o1
 pv=two.preview(['cues']);calls=[];real=W._replace
 def flaky(target,data):
  calls.append(target)
  if len(calls)==2:raise OSError('disk full')
  if len(calls)==3:raise OSError('file locked')
  return real(target,data)
 W._replace=flaky
 try:two.apply(['cues'],pv['preview_token']);raise AssertionError('should fail')
 except W.VirtualDJWriteError as e:assert 'disk full' in str(e) and str(small) in str(e),str(e)  # the first error, plus what could not be put back
 finally:W._replace=real
 assert not list(small.parent.glob('*.axiom-*.tmp')) and small2.read_bytes()==o2
 small.write_bytes(o1);pv=two.preview(['cues']);calls[:]=[]
 def wrong(target,data):return real(target,data[:-5] if len(calls.append(1) or calls)==1 else data)  # first database is written damaged
 W._replace=wrong
 try:two.apply(['cues'],pv['preview_token']);raise AssertionError('damaged write accepted')
 except W.VirtualDJWriteError as e:assert 'did not read back' in str(e)
 finally:W._replace=real
 assert small.read_bytes()==o1 and small2.read_bytes()==o2 and not list(small.parent.glob('*.axiom-*.tmp'))
 print('PASS: virtualdj write: stage file cleaned up, first error kept when rollback fails, bad read-back rolled back')
 import shutil;shutil.rmtree(folder)
 print('PASS: VirtualDJ write-back changes only planned song lines, keeps existing cues, raises counts only, refuses stale grids, undoes exactly')
except BaseException:
 traceback.print_exc();sys.exit(1)
