import os,sys,pathlib,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
# Records djay 5.6 for Windows wrote itself (2026-11-13): the owner made folder "PH Folder", moved playlist "PH Test" (one song) into it
ROOT_EMPTY=bytes.fromhex('54534146030003000100000000000000060000002b084144434d656469614974656d506c61796c69737400086d656469614974656d506c61796c6973742d726f6f740008757569640008506c61796c6973747300086e616d6500140000000000000000000000f03f08747970650000')
ROOT_AFTER=bytes.fromhex('54534146030003000200000000000000080000002b084144434d656469614974656d506c61796c69737400086d656469614974656d506c61796c6973742d726f6f740008757569640008506c61796c6973747300086e616d6500140000000000000000000000f03f0874797065000c00010000000831463944433844462d324630302d363130312d363534372d39314636384536384232454300086368696c6455554944730000')
FOLDER_RECORD=bytes.fromhex('545341460300030002000000000000000a0000002b084144434d656469614974656d506c61796c697374000831463944433844462d324630302d363130312d363534372d3931463638453638423245430008757569640008504820466f6c64657200086e616d6500086d656469614974656d506c61796c6973742d726f6f740008706172656e74555549440014000000000000000000f03f0874797065000c00010000000842393441313842462d424131422d363630362d344141322d43384646303035313341384400086368696c6455554944730000')
PLAYLIST_RECORD=bytes.fromhex('545341460300030002000000000000000a0000002b084144434d656469614974656d506c61796c697374000842393441313842462d424131422d363630362d344141322d43384646303035313341384400087575696400085048205465737400086e616d65000831463944433844462d324630302d363130312d363534372d3931463638453638423245430008706172656e745555494400140000000000000000000000000000000874797065001b00010000000834433732413446462d373238442d414330432d344543432d34444433454545443439383100086974656d55554944730000')
ITEM_RECORD=bytes.fromhex('54534146030003000100000000000000070000002b084144434d656469614974656d506c61796c6973744974656d000834433732413446462d373238442d414330432d344543432d344444334545454434393831000875756964000842393441313842462d424131422d363630362d344141322d4338464630303531334138440008706c61796c697374555549440008666166396366666638626639366166393064623562646235643534393630633000086d656469614974656d555549440000')
ROOT,FOLDER,PLAYLIST,ITEM,MEDIA='mediaItemPlaylist-root','1F9DC8DF-2F00-6101-6547-91F68E68B2EC','B94A18BF-BA1B-6606-4AA2-C8FF00513A8D','4C72A4FF-728D-AC0C-4ECC-4DD3EEED4981','faf9cfff8bf96af90db5bdb5d54960c0'
# What djay keeps next to those records (identified by collection and key, not rowid): relationships, view pages, index and search rows
DJAY_STATE={'fts': {('mediaItemPlaylists', '1F9DC8DF-2F00-6101-6547-91F68E68B2EC'): 'PH Folder',
         ('mediaItemPlaylists', 'B94A18BF-BA1B-6606-4AA2-C8FF00513A8D'): 'PH Test',
         ('mediaItemPlaylists', 'mediaItemPlaylist-root'): 'Playlists'},
 'index': {('mediaItemPlaylists', '1F9DC8DF-2F00-6101-6547-91F68E68B2EC'): 'PH Folder',
           ('mediaItemPlaylists', 'B94A18BF-BA1B-6606-4AA2-C8FF00513A8D'): 'PH Test',
           ('mediaItemPlaylists', 'mediaItemPlaylist-root'): 'Playlists'},
 'maps': {('mediaItemPlaylistView', ('mediaItemPlaylistItems', '4C72A4FF-728D-AC0C-4ECC-4DD3EEED4981')): 'B94A18BF-BA1B-6606-4AA2-C8FF00513A8D',
          ('mediaItemPlaylistsView', ('mediaItemPlaylists', '1F9DC8DF-2F00-6101-6547-91F68E68B2EC')): 'mediaItemPlaylist-root',
          ('mediaItemPlaylistsView', ('mediaItemPlaylists', 'B94A18BF-BA1B-6606-4AA2-C8FF00513A8D')): '1F9DC8DF-2F00-6101-6547-91F68E68B2EC',
          ('mediaItemPlaylistsView', ('mediaItemPlaylists', 'mediaItemPlaylist-root')): 'root',
          ('mediaView', ('mediaItemPlaylists', 'B94A18BF-BA1B-6606-4AA2-C8FF00513A8D')): 'playlist'},
 'pages': {('mediaItemPlaylistView', 'B94A18BF-BA1B-6606-4AA2-C8FF00513A8D'): [('mediaItemPlaylistItems', '4C72A4FF-728D-AC0C-4ECC-4DD3EEED4981')],
           ('mediaItemPlaylistsView', '1F9DC8DF-2F00-6101-6547-91F68E68B2EC'): [('mediaItemPlaylists', 'B94A18BF-BA1B-6606-4AA2-C8FF00513A8D')],
           ('mediaItemPlaylistsView', 'mediaItemPlaylist-root'): [('mediaItemPlaylists', '1F9DC8DF-2F00-6101-6547-91F68E68B2EC')],
           ('mediaItemPlaylistsView', 'root'): [('mediaItemPlaylists', 'mediaItemPlaylist-root')],
           ('mediaView', 'playlist'): [('mediaItemPlaylists', 'B94A18BF-BA1B-6606-4AA2-C8FF00513A8D')]},
 'rels': [('mediaItemPlaylistChild',
           ('mediaItemPlaylists', '1F9DC8DF-2F00-6101-6547-91F68E68B2EC'),
           ('mediaItemPlaylists', 'B94A18BF-BA1B-6606-4AA2-C8FF00513A8D'),
           2,
           0),
          ('mediaItemPlaylistChild',
           ('mediaItemPlaylists', 'mediaItemPlaylist-root'),
           ('mediaItemPlaylists', '1F9DC8DF-2F00-6101-6547-91F68E68B2EC'),
           2,
           0),
          ('mediaItemPlaylistItem',
           ('mediaItemPlaylists', 'B94A18BF-BA1B-6606-4AA2-C8FF00513A8D'),
           ('mediaItemPlaylistItems', '4C72A4FF-728D-AC0C-4ECC-4DD3EEED4981'),
           2,
           0),
          ('mediaItemPlaylistItemMediaItem',
           ('mediaItemPlaylistItems', '4C72A4FF-728D-AC0C-4ECC-4DD3EEED4981'),
           ('mediaItems', 'faf9cfff8bf96af90db5bdb5d54960c0'),
           4,
           0),
          ('mediaItemPlaylistItemPlaylist',
           ('mediaItemPlaylistItems', '4C72A4FF-728D-AC0C-4ECC-4DD3EEED4981'),
           ('mediaItemPlaylists', 'B94A18BF-BA1B-6606-4AA2-C8FF00513A8D'),
           4,
           0),
          ('mediaItemPlaylistParent',
           ('mediaItemPlaylists', '1F9DC8DF-2F00-6101-6547-91F68E68B2EC'),
           ('mediaItemPlaylists', 'mediaItemPlaylist-root'),
           4,
           0),
          ('mediaItemPlaylistParent',
           ('mediaItemPlaylists', 'B94A18BF-BA1B-6606-4AA2-C8FF00513A8D'),
           ('mediaItemPlaylists', '1F9DC8DF-2F00-6101-6547-91F68E68B2EC'),
           4,
           0)]}
REAL_TRACK='D:\\2022\\#!_YOU_TONIGHT_(FEATURING_R._KELLY).MP3'
DISCOVERY=pathlib.Path(os.environ.get('PEAKHOUR_DJAY_DISCOVERY') or r'C:\Users\gatli\AppData\Local\Temp\claude\f4654d8614da80ab\3659b411-6843-41fd-a174-ae16523e1f95\scratchpad\discovery\after\djay')
try:
 import uuid,hashlib,sqlite3,shutil,json,struct,copy
 sys.path.insert(0,str(workspace))
 from djay_fixture import djay_library
 from windows_bootstrap import build_backend
 import windows_djay,windows_djay_cues,windows_djay_folders as F
 from windows_dj_write_queue import DJWriteQueue
 folder=workspace/'fixtures'/'djay'/uuid.uuid4().hex;folder.mkdir(parents=True)
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 running=[False]
 real_uuid=F.new_uuid

 # ---- helpers that read a library with plain SQL (not through the module under test)
 def sha(db): return hashlib.sha256(pathlib.Path(db).read_bytes()).hexdigest()
 def listing(d): return sorted(p.name for p in pathlib.Path(d).iterdir())
 def record(db,key):
  c=sqlite3.connect(db);r=c.execute("select data from database2 where collection in ('mediaItemPlaylists','mediaItemPlaylistItems') and key=?",(key,)).fetchone();c.close()
  return None if r is None else bytes(r[0])
 def props(blob): return {k:v for k,_kind,v in app._djay_decode_fastcoding_object(bytes(blob))['properties']}
 def state(db):
  c=sqlite3.connect(db);ids={r:(a,b) for r,a,b in c.execute('select rowid,collection,key from database2')}
  rels=sorted((n,ids[s],ids[d],r,m) for n,s,d,r,m in c.execute("select name,src,dst,rules,manual from relationship_relationship where name like 'mediaItemPlaylist%'"))
  pages,maps={},{}
  for v in ('mediaItemPlaylistsView','mediaItemPlaylistView','mediaView'):
   keys={}
   for k,g,count,data in c.execute(f'select pageKey,"group",count,data from view_{v}_page'):
    if v=='mediaView' and g!='playlist': continue
    keys[k]=g;pages.setdefault((v,g),[]).extend(ids[x] for x in struct.unpack(f'<{count}Q',bytes(data)))
   for r,k in c.execute(f'select rowid,pageKey from view_{v}_map'):
    if k in keys: maps[(v,ids[r])]=keys[k]
  index={ids[r]:n for r,n in c.execute('select rowid,name from secondaryIndex_mediaItemPlaylistIndex')}
  fts={ids[r]:p for r,p in c.execute('select rowid,playlist from fts_searchIndex where playlist is not null')}
  c.close();return {'rels':rels,'pages':pages,'maps':maps,'index':index,'fts':fts}
 def other_rows(db):  # everything that is not a playlist record, a playlist relationship, a playlist view page, or a playlist index row
  c=sqlite3.connect(db)
  rows=[tuple(bytes(x) if isinstance(x,memoryview) else x for x in r) for r in c.execute("select rowid,collection,key,data,metadata from database2 where collection not in ('mediaItemPlaylists','mediaItemPlaylistItems') order by rowid")]
  rows+=[tuple(r) for r in c.execute("select * from relationship_relationship where name not like 'mediaItemPlaylist%' order by rowid")]
  rows+=[tuple(r) for r in c.execute('select * from yap2 order by extension,key')]
  c.close();return hashlib.sha256(repr(rows).encode()).hexdigest()
 def integrity(db):
  c=sqlite3.connect(db);r=c.execute('pragma integrity_check').fetchone()[0];c.close();assert r=='ok',r
 def tree(db,key=ROOT):
  c=sqlite3.connect(db)
  def node(k):
   p=props(c.execute("select data from database2 where collection='mediaItemPlaylists' and key=?",(k,)).fetchone()[0])
   if p['type']==1: return {'folder':p['name'],'children':[node(x) for x in p.get('childUUIDs',[])]}
   songs=[props(c.execute("select data from database2 where collection='mediaItemPlaylistItems' and key=?",(i,)).fetchone()[0])['mediaItemUUID'] for i in p.get('itemUUIDs',[])]
   return {'playlist':p['name'],'songs':songs}
  top=node(key);c.close();return top['children']
 def put(children,path,songs):  # what the tree should look like after writing path
  name=path[0]
  if len(path)==1: children.append({'playlist':name,'songs':songs});return
  for child in children:
   if 'folder' in child and child['folder'].casefold()==name.casefold(): put(child['children'],path[1:],songs);return
  new={'folder':name,'children':[]};children.append(new);put(new['children'],path[1:],songs)
 def audit(db):  # every folder/playlist is listed once by its parent, linked both ways, in its view pages, indexed; folders are not playlists
  S=state(db);c=sqlite3.connect(db);rels=set(S['rels']);seen=set()
  for key,data in c.execute("select key,data from database2 where collection='mediaItemPlaylists'"):
   ident=('mediaItemPlaylists',key);p=props(data)
   assert S['index'][ident]==p['name']==S['fts'][ident],key
   if key==ROOT: assert S['pages'][('mediaItemPlaylistsView','root')]==[ident];continue
   parent=p['parentUUID'];pident=('mediaItemPlaylists',parent);pp=props(c.execute("select data from database2 where collection='mediaItemPlaylists' and key=?",(parent,)).fetchone()[0])
   assert pp['type']==1 and pp['childUUIDs'].count(key)==1,key
   assert ('mediaItemPlaylistParent',ident,pident,4,0) in rels and ('mediaItemPlaylistChild',pident,ident,2,0) in rels,key
   assert ident in S['pages'][('mediaItemPlaylistsView',parent)] and S['maps'][('mediaItemPlaylistsView',ident)]==parent,key
   assert (ident in S['pages'].get(('mediaView','playlist'),[]))==(p['type']==0),key  # folders are not in the playlist group
   seen.add(key)
   if p['type']==0:
    assert 'childUUIDs' not in p
    pages=S['pages'].get(('mediaItemPlaylistView',key),[])
    assert pages==[('mediaItemPlaylistItems',i) for i in p.get('itemUUIDs',[])],key
    for item in p.get('itemUUIDs',[]):
     ip=props(c.execute("select data from database2 where collection='mediaItemPlaylistItems' and key=?",(item,)).fetchone()[0]);iident=('mediaItemPlaylistItems',item)
     assert ip['playlistUUID']==key and ('mediaItemPlaylistItem',ident,iident,2,0) in rels and ('mediaItemPlaylistItemPlaylist',iident,ident,4,0) in rels
     assert ('mediaItemPlaylistItemMediaItem',iident,('mediaItems',ip['mediaItemUUID']),4,0) in rels and S['maps'][('mediaItemPlaylistView',iident)]==key
   else: assert 'itemUUIDs' not in p
  # nothing is left over: every item record belongs to a playlist, every relationship ends at a record
  items={i for key,d in c.execute("select key,data from database2 where collection='mediaItemPlaylists'") for i in props(d).get('itemUUIDs',[])}
  assert {k for (k,) in c.execute("select key from database2 where collection='mediaItemPlaylistItems'")}==items
  assert len(S['rels'])==len(rels);c.close();integrity(db)
 def errors(code,call,*args,**kwargs):
  try: call(*args,**kwargs)
  except F.DjayFolderError as e:
   assert e.code==code,(e.code,str(e));return e
  raise AssertionError('no error, wanted '+code)

 # ---- 1. records and rows byte for byte as djay wrote them (synthetic library with djay's own track key and uuids)
 lib=folder/'bytes';lib.mkdir()
 paths,db=djay_library(lib,['You Tonight'],windows_djay.quote,keys=[MEDIA]);track=paths['You Tonight']
 assert record(db,ROOT)==ROOT_EMPTY  # the fixture's empty root is djay's empty root
 backups=folder/'backups'
 F.configure(app=app,root=backups,database=str(db),running=lambda:running[0])
 uuids=iter([FOLDER,PLAYLIST,ITEM]);F.new_uuid=lambda:next(uuids)
 before_rows=other_rows(db)
 result=F.apply({'path':['PH Folder','PH Test'],'tracks':[track]});F.new_uuid=real_uuid
 assert result['written']==1 and result['folders_created']==[FOLDER] and result['playlist_uuid']==PLAYLIST
 assert record(db,ROOT)==ROOT_AFTER and record(db,FOLDER)==FOLDER_RECORD and record(db,PLAYLIST)==PLAYLIST_RECORD and record(db,ITEM)==ITEM_RECORD
 assert state(db)==DJAY_STATE,state(db)
 assert other_rows(db)==before_rows;integrity(db);audit(db)
 assert tree(db)==[{'folder':'PH Folder','children':[{'playlist':'PH Test','songs':[MEDIA]}]}]
 # writing djay's own folder and playlist again changes nothing (idempotent)
 again=F.apply({'path':['PH Folder','PH Test'],'tracks':[track]});assert again['written']==0 and not again['backup_id'] and again['playlist']['action']=='unchanged'
 assert record(db,FOLDER)==FOLDER_RECORD and state(db)==DJAY_STATE

 # ---- 2. a copy of the owner's real djay library (djay's own folder and playlist are in it)
 real_libs=[]
 if DISCOVERY.is_dir():
  real_isfile=os.path.isfile
  os.path.isfile=lambda p,_r=real_isfile:True if str(p)==REAL_TRACK else _r(p)
  def real_copy(name):
   target=folder/name;target.mkdir()
   for f in DISCOVERY.iterdir(): shutil.copy2(f,target/f.name)
   c=sqlite3.connect(target/'MediaLibrary.db');c.execute('pragma wal_checkpoint(truncate)');c.close()
   for extra in ('-wal','-shm'):
    if (target/('MediaLibrary.db'+extra)).exists(): (target/('MediaLibrary.db'+extra)).unlink()
   return target/'MediaLibrary.db'
  # (a) take djay's folder, playlist and song out again, write them with PEAK HOUR: the same records, relationships, pages and rows
  pre=real_copy('real-pre');c=sqlite3.connect(pre)
  ids=[r for (r,) in c.execute('select rowid from database2 where key in (?,?,?)',(FOLDER,PLAYLIST,ITEM))];marks=','.join('?'*len(ids))
  c.execute(f"delete from relationship_relationship where name like 'mediaItemPlaylist%' and (src in ({marks}) or dst in ({marks}))",ids+ids)
  c.execute(f'delete from database2 where rowid in ({marks})',ids)
  for v,groups in (('mediaItemPlaylistsView',(FOLDER,ROOT)),('mediaItemPlaylistView',(PLAYLIST,)),('mediaView',('playlist',))):
   c.execute(f'delete from view_{v}_page where "group" in ({",".join("?"*len(groups))})',groups);c.execute(f'delete from view_{v}_map where rowid in ({marks})',ids)
  c.execute(f'delete from secondaryIndex_mediaItemPlaylistIndex where rowid in ({marks})',ids);c.execute(f'delete from fts_searchIndex where rowid in ({marks})',ids)
  c.execute('update database2 set data=? where key=?',(ROOT_EMPTY,ROOT));c.commit();c.close();integrity(pre)
  assert tree(pre)==[]
  F.configure(database=str(pre));uuids=iter([FOLDER,PLAYLIST,ITEM]);F.new_uuid=lambda:next(uuids)
  F.apply({'path':['PH Folder','PH Test'],'tracks':[REAL_TRACK]});F.new_uuid=real_uuid
  reference=real_copy('real-reference')
  for key in (ROOT,FOLDER,PLAYLIST,ITEM): assert record(pre,key)==record(reference,key),key
  assert state(pre)==state(reference)==DJAY_STATE and other_rows(pre)==other_rows(reference);audit(pre);integrity(pre)
  real_libs.append(reference)
  print('records and rows match djay for Windows; real library part:','ran' if real_libs else 'skipped (no discovery copy)')

 # ---- 3. the scenarios, on the synthetic library and on the real copy
 def scenarios(label,db,songs,media,many,djay_folder=None):
  db=pathlib.Path(db);root=folder/('backups-'+label);F.configure(app=app,root=root,database=str(db),running=lambda:running[0])
  def sweep(): return sha(db),listing(db.parent),other_rows(db),copy.deepcopy(tree(db))
  start=sha(db);audit(db)
  def go(path,tracks=None,**more): return F.apply(dict(path=path,tracks=songs if tracks is None else tracks,**more))
  def boom(*args,**kwargs): raise ValueError('boom')
  # preview writes nothing
  files=listing(db.parent);tree0=tree(db)
  pv=F.preview({'path':['PH Parent','PH child'],'tracks':songs})
  assert pv['will_write'] and [f['action'] for f in pv['folders']]==['create'] and pv['playlist']['action']=='create' and pv['counts']['songs']==len(songs)
  assert sha(db)==start,'preview changed the library';assert listing(db.parent)==files,(files,listing(db.parent));assert not root.exists() and tree(db)==tree0
  assert F.digest({'path':['PH Parent','PH child'],'tracks':songs})==pv['digest']
  # two levels: the folder and the playlist are made; nothing else changes
  expect=copy.deepcopy(tree0);put(expect,['PH Parent','PH child'],media)
  others=other_rows(db);r1=go(['PH Parent','PH child'],digest=pv['digest'])
  assert r1['written']==1 and r1['backup_id'] and len(r1['folders_created'])==1 and tree(db)==expect and other_rows(db)==others;audit(db)
  after1=sha(db)
  # idempotent: the same again writes nothing and makes no backup
  backups_now=listing(root);again=go(['PH Parent','PH child'])
  assert again['written']==0 and not again['backup_id'] and listing(root)==backups_now and sha(db)==after1 and tree(db)==expect
  # the folder is found again by name (any case), never duplicated or renamed; a sibling playlist lands after the first
  reuse=go(['ph PARENT','Second']);put(expect,['PH Parent','Second'],media)
  assert reuse['folders_created']==[] and tree(db)==expect;audit(db)
  c=sqlite3.connect(db);assert c.execute("select count(*) from secondaryIndex_mediaItemPlaylistIndex where name='PH Parent'").fetchone()[0]==1;c.close()
  # one level: a playlist straight under the root
  go(['Flat']);put(expect,['Flat'],media);assert tree(db)==expect;audit(db)
  # three levels: every missing folder is made, in order; an existing folder is passed through
  go(['L1','L2','L3','Deep']);put(expect,['L1','L2','L3','Deep'],media);assert tree(db)==expect;audit(db)
  go(['L1','L2','Other']);put(expect,['L1','L2','Other'],media);assert tree(db)==expect;audit(db)
  go(['L1','L2','New folder','Inside']);put(expect,['L1','L2','New folder','Inside'],media);assert tree(db)==expect;audit(db)
  assert other_rows(db)==others
  if djay_folder:  # djay's own folder and playlist: found, passed through, and the same songs are already there
   assert go([djay_folder,'PH Test'])['written']==0
   go([djay_folder.lower(),'Added by PEAK HOUR']);put(expect,[djay_folder,'Added by PEAK HOUR'],media);assert tree(db)==expect;audit(db)
   assert props(record(db,FOLDER))['childUUIDs'][0]==PLAYLIST and len(props(record(db,FOLDER))['childUUIDs'])==2
  # names that are in the way are refused, nothing is written
  held=sweep()
  errors('name_conflict',go,['PH Parent','PH child','Under a playlist'])
  errors('name_conflict',go,['PH Parent'])
  errors('name_conflict',go,['Flat','Under a playlist'])
  for bad in ([],'PH',['PH',''],['PH',5],[' '],['a\nb'],['x']*30,['x'*300]): errors('bad_request',F.preview,{'path':bad,'tracks':songs})
  errors('bad_request',F.preview,{'path':['PH'],'tracks':[]});errors('bad_request',F.preview,{'path':['PH']});errors('bad_request',F.preview,{'path':['PH'],'tracks':[5]})
  errors('no_tracks',F.preview,{'path':['PH'],'tracks':[str(folder/'not-a-song.mp3')]})
  assert sweep()==held
  if many:
   # the same name with other songs: kept apart as "Name (2)" like flat playlists, once
   rev_t,rev_m=songs[::-1],media[::-1]
   two=go(['PH Parent','PH child'],rev_t);put(expect,['PH Parent','PH child (2)'],rev_m)
   assert two['playlist']['final_name']=='PH child (2)' and tree(db)==expect;audit(db)
   assert go(['PH Parent','PH child'],rev_t)['written']==0 and tree(db)==expect
   # replace: a playlist PEAK HOUR made keeps its place and uuid and gets the new songs; its old song records go
   c=sqlite3.connect(db);row=c.execute("select rowid from secondaryIndex_mediaItemPlaylistIndex where name='PH child'").fetchone();c.close()
   few=songs[:2];rep=go(['PH Parent','PH child'],few,replace=True)
   expect[[n for n,x in enumerate(expect) if x.get('folder')=='PH Parent'][0]]['children'][0]['songs']=media[:2]
   assert rep['written']==1 and rep['playlist']['action']=='replace' and tree(db)==expect;audit(db)
   c=sqlite3.connect(db);assert c.execute("select rowid from secondaryIndex_mediaItemPlaylistIndex where name='PH child'").fetchone()==row;c.close()
   assert other_rows(db)==others
   # a playlist PEAK HOUR did not make is only replaced when the owner confirms
   shutil.rmtree(root)
   errors('exists',go,['PH Parent','PH child'],songs[:1],replace=True);assert tree(db)==expect
   go(['PH Parent','PH child'],songs[:1],replace=True,confirm_replace=True)
   expect[[n for n,x in enumerate(expect) if x.get('folder')=='PH Parent'][0]]['children'][0]['songs']=media[:1];assert tree(db)==expect;audit(db)
  # a stale preview is refused
  fresh=F.preview({'path':['Fresh'],'tracks':songs})['digest'];go(['Unrelated top level folder'])
  assert F.digest({'path':['Fresh'],'tracks':songs})==fresh  # an unrelated change elsewhere in djay does not make a queued job stale
  stale=F.preview({'path':['Stale'],'tracks':songs})['digest'];go(['Stale']);held=sweep()  # the target itself changed
  errors('stale',go,['Stale'],digest=stale);assert sweep()==held
  # djay open: refused, nothing written, nothing backed up
  listed=listing(root);running[0]=True
  e=errors('djay_open',go,['Closed first']);assert 'Quit djay' in str(e) and sweep()==held and listing(root)==listed
  running[0]=False
  # djay opens between the first check and the commit: the transaction is dropped
  calls=[];F.configure(running=lambda:(calls.append(1),len(calls)>=2)[1])
  errors('djay_open',go,['Opens late']);assert sweep()==held and len(calls)==2
  F.configure(running=lambda:running[0])
  # failures put the library back byte for byte: inside the transaction, in the check before the commit, and after the commit
  real_items,real_check,real_verify=F._items,F._check,F._verify
  F._items=boom
  e=errors('write_failed',go,['Fails early']);assert 'boom' in str(e) and sweep()==held;F._items=real_items
  def check_fails(*args):
   F._check=real_check;raise F.DjayFolderError('check failed','verify_failed')
  F._check=check_fails;errors('verify_failed',go,['Fails check']);assert sweep()==held;F._check=real_check
  def verify_fails(*args): raise F.DjayFolderError('readback mismatch','verify_failed')
  F._verify=verify_fails;errors('verify_failed',go,['Fails after commit']);F._verify=real_verify
  assert sweep()==held,'a committed write was not rolled back'
  receipts=[json.loads((p/'receipt.json').read_text()) for p in root.iterdir() if (p/'receipt.json').is_file()]
  assert [r['status'] for r in receipts].count('rolled_back')>=4,[r['status'] for r in receipts]
  audit(db)
  # undo: byte for byte; refused while djay is open, twice, or after djay changed the library
  base=sha(db);ur=go(['Undo me']);written=db.read_bytes();assert sha(db)!=base
  running[0]=True;errors('djay_open',F.undo,ur['backup_id']);assert db.read_bytes()==written;running[0]=False
  assert F.undo(ur['backup_id'])['success'] and sha(db)==base and listing(db.parent)==files and tree(db)==held[3]
  errors('bad_request',F.undo,ur['backup_id'])
  for bad in ('..','../x','','a b',5): errors('bad_request',F.undo,bad)
  ur=go(['Undo me']);c=sqlite3.connect(db);c.execute("insert into database2(collection,key,data) values('x','y',x'00')");c.commit();c.close()
  errors('changed',F.undo,ur['backup_id']);c=sqlite3.connect(db);c.execute("delete from database2 where collection='x'");c.commit();c.close()
  # routes
  from flask import Flask
  web=Flask(__name__);web.register_blueprint(F.create_blueprint(app,root,None));client=web.test_client();origin={'Origin':'http://localhost'}
  body={'path':['Route','Playlist'],'tracks':songs};held=sweep()
  assert client.post('/api/windows/djay/folders/preview',json=body).status_code==403  # same-origin only
  r=client.post('/api/windows/djay/folders/preview',json=body,headers=origin);assert r.status_code==200 and r.json['will_write'] and sweep()==held
  r=client.post('/api/windows/djay/folders/preview',json={'path':[],'tracks':songs},headers=origin);assert r.status_code==400 and r.json['code']=='bad_request'
  assert client.post('/api/windows/djay/folders/apply',json=body,headers=origin).status_code==400  # needs confirm
  running[0]=True;r=client.post('/api/windows/djay/folders/apply',json=dict(body,confirm=True),headers=origin)
  assert r.status_code==409 and r.json['code']=='djay_open' and sweep()==held;running[0]=False
  r=client.post('/api/windows/djay/folders/apply',json=dict(body,confirm=True,digest=F.digest(body)),headers=origin);assert r.status_code==200 and r.json['written']==1,r.json
  put(held[3],['Route','Playlist'],media);assert tree(db)==held[3];audit(db)
  r=client.post('/api/windows/djay/folders/undo',json={'backup_id':r.json['backup_id']},headers=origin);assert r.status_code==200 and tree(db)==held[3][:-1]
  audit(db);integrity(db)

 plain=folder/'plain';plain.mkdir()
 paths,db=djay_library(plain,['Song A','Song B','Song C'],windows_djay.quote)
 songs=[paths['Song A'],paths['Song B'],paths['Song C']]
 scenarios('synthetic',db,songs,['k1','k2','k3'],True)
 for n,reference in enumerate(real_libs):
  scenarios('real',reference,[REAL_TRACK],[MEDIA],False,'PH Folder')
 # a library without djay's playlist tables, and none at all
 odd=folder/'odd';odd.mkdir()
 from djay_fixture import windows_library
 track,odd_db=windows_library(odd,'x',1.0,windows_djay.quote)
 F.configure(database=str(odd_db));errors('unsupported',F.preview,{'path':['A','B'],'tracks':[str(track)]})
 F.configure(database=str(odd/'missing.db'));errors('no_library',F.preview,{'path':['A','B'],'tracks':[str(track)]})
 # the DJ write queue runs both djay writers: now when djay is closed, later (with a digest) when it is open
 q=DJWriteQueue(folder/'queue.json',snapshot=lambda:[],settles={});F.register_with_queue(q)
 assert q.appliers[('djay','playlist_folder')]==(F.apply,F.digest) and q.appliers[('djay','cues')]==(windows_djay_cues.apply,windows_djay_cues.digest)
 F.configure(database=str(db),root=folder/'backups-queue',running=lambda:False)
 sent={'path':['Queue','Playlist'],'tracks':songs[:1]}
 ran=q.submit('djay','playlist_folder',sent);assert ran['applied'] and ran['result']['written']==1
 busy=DJWriteQueue(folder/'queue2.json',snapshot=lambda:[(1,'C:\\Program Files\\djay\\djayApp.exe')],settles={});F.register_with_queue(busy)
 queued=busy.submit('djay','playlist_folder',{'path':['Queue','Later'],'tracks':songs[:1]})
 assert queued['queued'] and busy.jobs[0]['preview_digest']==F.digest({'path':['Queue','Later'],'tracks':songs[:1]}) and busy.jobs[0]['kind']=='playlist_folder'
 if real_libs: os.path.isfile=real_isfile
 print('PASS: djay folders: 1-3 levels, existing folders reused, idempotent, records byte for byte as djay wrote them, other rows untouched, djay-open refused, failures and undo restore byte for byte')
 shutil.rmtree(folder,ignore_errors=True)
except BaseException:
 traceback.print_exc();sys.exit(1)
