import os,sys,pathlib,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 import uuid,hashlib,sqlite3,shutil,json
 sys.path.insert(0,str(workspace))
 from djay_fixture import blob,title_id,user_data,windows_library
 from windows_bootstrap import build_backend
 import windows_djay
 import windows_djay_cues as cues
 folder=workspace/'fixtures'/'djay'/uuid.uuid4().hex;folder.mkdir(parents=True)
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 import utils.djay_cue_codec as codec
 from utils.dj_track_colors import decode_djay_record as decode

 # ---- a synthetic djay library with six songs, no real data anywhere
 red=('ADCCuePoint',{'time':0.016,'endTime':-1.0,'comment':'','number':1.0,'color':'#CC0000'})
 plain=('ADCCuePoint',{'time':0.0,'endTime':-1.0,'number':2.0})
 def user(key,title,cue_list=None):
  fields={'uuid':key,'titleIDs':[title_id(key,title)],'playCount':1.0}
  if cue_list is not None: fields['cuePoints']=cue_list
  return blob(('ADCMediaItemUserData',fields))
 names={'a1':'Song A','b1':'Song B','c1':'Song C','d1':'Song D','e1':'Song E','f1':'Song F'}
 base=None;paths={}
 for key,name in names.items():
  track,db=windows_library(folder,name,1.0,windows_djay.quote,key=key);paths[key]=str(track)
  if base is None: base=db
  else:
   src=sqlite3.connect(db);dst=sqlite3.connect(base)
   dst.executemany('insert into database2(collection,key,data) values(?,?,?)',src.execute('select collection,key,data from database2').fetchall())
   dst.commit();src.close();dst.close()
 db=str(base)
 c=sqlite3.connect(db)
 for key,cue_list in (('b1',[red,plain]),('f1',[])):  # b1 already has cues in djay; f1 has an empty cue list
  c.execute("update database2 set data=? where collection='mediaItemUserData' and key=?",(user(key,names[key],cue_list),key))
 c.commit();c.close()
 def rows():
  c=sqlite3.connect(db);r=c.execute('select rowid,collection,key,data from database2 order by rowid').fetchall();c.close();return r
 def others(changed):
  return [(i,col,key,bytes(d)) for i,col,key,d in rows() if not (col=='mediaItemUserData' and key in changed)]
 def sha(): return hashlib.sha256(pathlib.Path(db).read_bytes()).hexdigest()
 def user_blob(key):
  c=sqlite3.connect(db);b=bytes(c.execute("select data from database2 where collection='mediaItemUserData' and key=?",(key,)).fetchone()[0]);c.close();return b

 # ---- cue sources: Serato (A, also in PEAK HOUR's own), VirtualDJ's database.xml (D), PEAK HOUR (E, F); none for C
 serato={paths['a1']:[{'index':0,'time_ms':16,'label':'CUE 1','color':'#cc0000'},{'index':2,'time_ms':30000,'label':'Drop','color':'#0000CC'}]}
 mine={paths['a1']:[{'index':5,'time_ms':999,'label':'Wrong','color':'#111111'}],
       paths['e1']:[{'index':1,'time_ms':12345,'label':'Intro','color':'#00FF00'}],
       paths['b1']:[{'index':0,'time_ms':5,'label':'x','color':'#222222'}],
       paths['f1']:[{'index':0,'time_ms':1000,'label':'F','color':'#FFFFFF'}]}
 xml=folder/'database.xml'
 xml.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<VirtualDJ_Database Version="8.5">\n'
  f'<Song FilePath="{paths["d1"]}" FileSize="7">\n <Tags Author="x" Title="Song D" />\n'
  f' <Poi Name="Chorus" Pos="45.5" Num="4" Color="{0xFF000000|0x0099FF}" Type="cue" />\n'
  ' <Poi Pos="1.0" Type="beatgrid" />\n <Poi Pos="2.5" Num="1" Type="cue" />\n</Song>\n</VirtualDJ_Database>\n',encoding='utf-8')
 root=folder/'backups'
 running=[False]
 cues.configure(app=app,root=root,database=db,running=lambda:running[0],virtualdj_databases=lambda:[xml],
                readers={'serato':lambda p:serato.get(p,[]),'peakhour':lambda p:mine.get(p,[])})
 import utils.dj_transfer as transfer

 # ---- preview: reads only
 def listing(): return sorted(p.name for p in folder.iterdir())
 before_hash,before_stat,before_files=sha(),os.stat(db),listing()
 pv=cues.preview({'tracks':'all'})
 assert sha()==before_hash and os.stat(db).st_mtime_ns==before_stat.st_mtime_ns and listing()==before_files,'preview touched the library'
 by={r['djay_key']:r for r in pv['songs']}
 assert set(by)=={'a1','b1','c1','d1','e1','f1'} and all(r['djay_found'] for r in by.values())
 a=by['a1']
 assert a['will_write'] and a['source']=='serato' and a['existing_cues']==0
 assert a['cues']==[{'slot':1,'seconds':0.016,'name':'','color':'#CC0000'},{'slot':3,'seconds':30.0,'name':'Drop','color':'#0000CC'}],a['cues']
 assert by['b1']['existing_cues']==2 and not by['b1']['will_write'] and 'already has 2' in by['b1']['skip_reason'] and not by['b1']['cues']
 assert not by['c1']['will_write'] and 'No cues found' in by['c1']['skip_reason']
 d=by['d1']
 assert d['source']=='virtualdj'
 assert [c['slot'] for c in d['cues']]==[1,4] and d['cues'][1]=={'slot':4,'seconds':45.5,'name':'Chorus','color':'#0099FF'},d['cues']
 assert d['cues'][0]['color']==cues.DEFAULT_COLOR  # a VirtualDJ cue without a colour
 assert by['e1']['source']=='peakhour' and by['e1']['cues']==[{'slot':2,'seconds':12.345,'name':'Intro','color':'#00FF00'}]
 assert by['f1']['will_write'] and by['f1']['existing_cues']==0 and by['f1']['source']=='peakhour'  # an empty cue list counts as no cues
 assert pv['counts']['songs_to_write']==4 and pv['counts']['cues_to_write']==6,pv['counts']
 # unknown and non-listed songs are reported, not guessed
 one=cues.preview({'tracks':[paths['a1'],'C:\\nowhere\\x.mp3']})
 assert [r['djay_found'] for r in one['songs']]==[True,False] and one['songs'][1]['skip_reason']=='Not in the djay library'
 assert cues.digest({'tracks':'all'})==pv['digest']==cues.digest({'tracks':'all'})
 assert cues.digest({'tracks':[paths['a1']]})!=pv['digest']

 # ---- property order: byte for byte what a record with djay's order looks like
 def cue_obj(t,comment,number,color): return ('ADCCuePoint',{'time':t,'endTime':-1.0,'comment':comment,'number':number,'color':color})
 expected_a=blob(('ADCMediaItemUserData',{'uuid':'a1','titleIDs':[title_id('a1',names['a1'])],'playCount':1.0,
                  'cuePoints':[cue_obj(cues._f32(0.016),'',1.0,'#CC0000'),cue_obj(30.0,'Drop',3.0,'#0000CC')]}))
 at=expected_a.index(b'\x0b\x02\x00\x00\x00+\x08ADCCuePoint');expected_a=expected_a[:at]+b'\n'+expected_a[at+1:]  # PEAK HOUR's codec writes the cue list as tag 10 (mutable array); the fixture's lists are tag 11
 axiom_order=codec.replace_cues(user_blob('a1'),cues._codec_cues(a))
 assert axiom_order!=expected_a and cues._without_defaults(decode(axiom_order),{1.0:0.016})==cues._without_defaults(decode(expected_a),{1.0:0.016})  # PEAK HOUR's codec writes number before comment
 expected_a=cues.djay_default_cues(expected_a,fix_header=True)  # djay refers back to repeated strings (uuid, the second cue's keys); the fixture writes them in full
 assert decode(cues.encode_cues(user_blob('a1'),cues._codec_cues(a)))==decode(expected_a)
 assert cues.encode_cues(user_blob('a1'),cues._codec_cues(a))==expected_a
 assert cues.djay_property_order(expected_a)==expected_a  # already in djay's order: unchanged
 assert cues.djay_property_order(user_blob('b1'))==user_blob('b1')
 # a record whose second cue uses string aliases (as djay writes them): references are remapped, nothing else moves
 tree=cues._parse(axiom_order)
 top=[pair for pair in tree[2] if pair[1].value()==b'cuePoints'][0];listing_=top[0][2];first,second=listing_[0],listing_[1]
 listing_[1]=('obj',cues._Str(ref=first[1],tag=5),[(v,cues._Str(ref=k1,tag=5)) for (v,_k),(_v,k1) in zip(second[2],first[2])])
 aliased=cues._emit(axiom_order,tree)
 assert aliased!=axiom_order and len(aliased)<len(axiom_order)
 relaid=cues.djay_property_order(aliased)
 def keys_of(data):
  node=cues._parse(data);found=[p for p in node[2] if p[1].value()==b'cuePoints'][0][0][2]
  return [[k.value().decode() for _v,k in cue[2]] for cue in found]
 assert keys_of(aliased)==[['time','endTime','number','comment','color']]*2
 assert keys_of(relaid)==[['time','endTime','comment','number','color']]*2 and relaid!=aliased and len(relaid)==len(aliased)
 assert cues.djay_property_order(relaid)==relaid

 # ---- apply: only the intended records change
 snapshot=others({'a1','d1','e1','f1'});untouched_b=user_blob('b1');original_bytes=pathlib.Path(db).read_bytes()
 result=cues.apply({'tracks':'all','digest':pv['digest']})
 assert result['written']==4 and result['backup_id'],result
 assert others({'a1','d1','e1','f1'})==snapshot and user_blob('b1')==untouched_b,'another record changed'
 assert user_blob('a1')==expected_a
 c=sqlite3.connect(db);assert c.execute('pragma integrity_check').fetchone()[0]=='ok';c.close()
 # colours and names round-trip through the reader, and through AXIOM's own djay reader
 got={k:[(x['index'],x['time_ms'],x['label'],x['color']) for x in codec.read_cues(user_blob(k))] for k in ('a1','d1','e1','f1')}
 assert got['a1']==[(0,16,'','#CC0000'),(2,30000,'Drop','#0000CC')],got
 assert got['d1']==[(0,2500,'',cues.DEFAULT_COLOR),(3,45500,'Chorus','#0099FF')],got
 assert got['e1']==[(1,12345,'Intro','#00FF00')],got
 assert got['f1']==[(0,1000,'F','#FFFFFF')],got
 for key in ('a1','d1','e1','f1'):
  data=user_blob(key)
  for cue_keys in keys_of(data):  # djay's property order; a default cue (no name, default colour) has only time, endTime, number
   assert cue_keys in (['time','endTime','number'],['time','endTime','comment','number','color']),(key,cue_keys)
  assert not windows_djay._number_slots(data,b'number',0x12) and windows_djay._number_slots(data,b'number',windows_djay._DOUBLE)
 tracks,errors=transfer.read_djay_tracks([db],include_preparation=True,include_transfer_preparation=True)
 assert not errors and [x['time_ms'] for x in tracks[paths['a1']]['cues']]==[16,30000],(errors,tracks[paths['a1']]['cues'])
 # the second run finds nothing left to do (every song now has cues), and a song with cues is never touched
 again=cues.apply({'tracks':'all'})
 assert again['written']==0 and not again['backup_id'] and all(not r['will_write'] for r in again['songs'])
 assert cues.apply({'tracks':[paths['b1']]})['written']==0 and user_blob('b1')==untouched_b

 # ---- undo: byte for byte
 after_bytes=pathlib.Path(db).read_bytes()
 running[0]=True
 try: cues.undo(result['backup_id']);raise AssertionError('undo while djay is open')
 except cues.DjayCueError as e: assert e.code=='djay_open' and pathlib.Path(db).read_bytes()==after_bytes
 running[0]=False
 assert cues.undo(result['backup_id'])['success'] and pathlib.Path(db).read_bytes()==original_bytes
 try: cues.undo(result['backup_id']);raise AssertionError('undid twice')
 except cues.DjayCueError: pass
 for bad in ('..','../x','','a b'):
  try: cues.undo(bad);raise AssertionError(bad)
  except cues.DjayCueError as e: assert e.code=='bad_request'
 # djay changed its library after a write: undo refuses rather than erase djay's work
 result=cues.apply({'tracks':[paths['a1']]});written_bytes=pathlib.Path(db).read_bytes()
 c=sqlite3.connect(db);c.execute("insert into database2(collection,key,data) values('x','y',x'00')");c.commit();c.close()
 try: cues.undo(result['backup_id']);raise AssertionError('undid over djay changes')
 except cues.DjayCueError as e: assert e.code=='changed'
 pathlib.Path(db).write_bytes(original_bytes)

 # ---- djay open: error and nothing written, nothing backed up
 running[0]=True;backups=sorted(p.name for p in root.iterdir())
 try: cues.apply({'tracks':'all'});raise AssertionError('wrote while djay was open')
 except cues.DjayCueError as e: assert e.code=='djay_open' and 'Quit djay' in str(e)
 assert sha()==before_hash and sorted(p.name for p in root.iterdir())==backups
 # djay opens between the first check and the commit: the transaction is dropped
 calls=[]
 def opens_late(): calls.append(1);return len(calls)>=3  # 1: the plan, 2: before the backup, 3: the last look before the commit
 cues.configure(running=opens_late)
 try: cues.apply({'tracks':'all'});raise AssertionError('committed while djay was open')
 except cues.DjayCueError as e: assert e.code=='djay_open',e.code
 assert sha()==before_hash and len(calls)==3
 cues.configure(running=lambda:running[0]);running[0]=False

 # ---- failures: the library is put back byte for byte
 real_encode=cues.encode_cues;seen=[]
 def fail_second(blob_,cue_list):
  seen.append(1)
  if len(seen)==2: raise ValueError('boom')
  return real_encode(blob_,cue_list)
 cues.encode_cues=fail_second
 try: cues.apply({'tracks':'all'});raise AssertionError('wrote despite failure')
 except cues.DjayCueError as e: assert e.code=='write_failed' and 'boom' in str(e),e
 assert sha()==before_hash,'mid-write failure left changes'
 cues.encode_cues=real_encode
 real_verify=cues._verify
 def fail_verify(*args): raise cues.DjayCueError('readback mismatch','verify_failed')
 cues._verify=fail_verify
 try: cues.apply({'tracks':'all'});raise AssertionError('kept a write that failed verification')
 except cues.DjayCueError as e: assert e.code=='verify_failed'
 assert sha()==before_hash,'a committed write was not rolled back'  # committed, then restored from the backup
 receipts=[json.loads((p/'receipt.json').read_text()) for p in root.iterdir() if (p/'receipt.json').is_file()]
 assert [r['status'] for r in receipts].count('rolled_back')>=2
 cues._verify=real_verify

 # ---- the job digest names only what was asked; each song is checked again when the write runs
 d1=cues.preview({'tracks':'all'})['digest']
 c=sqlite3.connect(db);c.execute("update database2 set data=? where collection='mediaItemUserData' and key='a1'",(user('a1','Song A',[]),));c.commit();c.close()
 assert cues.digest({'tracks':'all'})==d1 and cues.digest({'tracks':[paths['a1']]})!=d1  # unrelated change: same digest
 real_write=cues._write
 def late(database,rows,skipped):  # djay gives a1 cues after the plan was made, before the write
  c=sqlite3.connect(database);c.execute("update database2 set data=? where collection='mediaItemUserData' and key='a1'",(user('a1','Song A',[red]),));c.commit();c.close()
  return real_write(database,rows,skipped)
 cues._write=late
 try: late_result=cues.apply({'tracks':'all','digest':d1})
 finally: cues._write=real_write
 assert late_result['written']==3 and [x['path'] for x in late_result['skipped_at_write']]==[paths['a1']] and 'cue' in late_result['skipped_at_write'][0]['reason'],late_result
 assert [x['time_ms'] for x in codec.read_cues(user_blob('a1'))]==[16],'a1 keeps the cue djay gave it'
 pathlib.Path(db).write_bytes(original_bytes)
 # undo compares the library and its -wal: a change that only reached the -wal also blocks undo
 res=cues.apply({'tracks':[paths['a1']]});assert res['written']==1
 pathlib.Path(db+'-wal').write_bytes(b'\x00'*32)
 try: cues.undo(res['backup_id']);raise AssertionError('undid over a changed -wal')
 except cues.DjayCueError as e: assert e.code=='changed'
 pathlib.Path(db+'-wal').unlink();pathlib.Path(db).write_bytes(original_bytes)
 # while djay is open the library is opened without immutable=1
 seen_uri=[];real_connect=sqlite3.connect
 sqlite3.connect=lambda target,*a,**k:(seen_uri.append(str(target)),real_connect(target,*a,**k))[1]
 try:
  running[0]=True;note=cues.preview({'tracks':'all'})['note'];open_uris=list(seen_uri);del seen_uri[:]
  running[0]=False;closed_note=cues.preview({'tracks':'all'})['note']
 finally: sqlite3.connect=real_connect
 assert 'djay is open' in note and not closed_note and all('immutable' not in u for u in open_uris) and any('immutable=1' in u for u in seen_uri),(note,open_uris,seen_uri)

 # ---- no library
 cues.configure(database=str(folder/'missing.db'))
 try: cues.preview({'tracks':'all'});raise AssertionError('previewed a missing library')
 except cues.DjayCueError as e: assert e.code=='no_library'
 cues.configure(database=db)

 # ---- routes
 from flask import Flask
 web=Flask(__name__);web.register_blueprint(cues.create_blueprint(app,root,None));client=web.test_client();origin={'Origin':'http://localhost'}
 assert client.post('/api/windows/djay/cues/preview',json={'tracks':'all'}).status_code==403  # same-origin only
 r=client.post('/api/windows/djay/cues/preview',json={'tracks':'all'},headers=origin);assert r.status_code==200 and r.json['counts']['songs_to_write']==4 and sha()==before_hash
 assert client.post('/api/windows/djay/cues/apply',json={'tracks':'all'},headers=origin).status_code==400  # needs confirm
 running[0]=True
 r=client.post('/api/windows/djay/cues/apply',json={'tracks':'all','confirm':True},headers=origin)
 assert r.status_code==409 and r.json['code']=='djay_open' and sha()==before_hash
 running[0]=False
 r=client.post('/api/windows/djay/cues/apply',json={'tracks':[paths['e1']],'confirm':True,'digest':cues.digest({'tracks':[paths['e1']]})},headers=origin)
 assert r.status_code==200 and r.json['written']==1,r.json
 r=client.post('/api/windows/djay/cues/undo',json={'backup_id':r.json['backup_id']},headers=origin)
 assert r.status_code==200 and sha()==before_hash
 print('PASS: djay cue publish: preview read-only, only cue-less songs filled in djay property order, djay-open refused, failures and undo restore byte for byte')
 shutil.rmtree(folder,ignore_errors=True)
except BaseException:
 traceback.print_exc();sys.exit(1)
