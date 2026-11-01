import os,pathlib,sys,tempfile,hashlib
from flask import Flask,jsonify
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
import windows_virtualdj_lists as L
from windows_virtualdj_api import create_virtualdj_blueprint
from windows_serato_processes import ProcessInspectionError
# Byte layout of a list saved by VirtualDJ 8.5 on Windows (CRLF, tabs, &apos;, attribute order, " />")
EXPECTED=('<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualFolder ordered="yes" singleDrive="yes">\r\n'
 '\t<song path="C:\\Videos\\Jay - Big Pimpin&apos; (Dirty).mp4" size="116367132" songlength="279.1" artist="Jay &amp; Co" title="Big Pimpin&apos; (Dirty)" remix="Dirty" idx="0" />\r\n'
 '\t<song path="C:\\Videos\\Tyla - Water.mp4" size="62120013" songlength="219.2" idx="1" />\r\n</VirtualFolder>\r\n').encode()
try:
 songs=[{'path':'C:\\Videos\\Jay - Big Pimpin\' (Dirty).mp4','size':'116367132','songlength':'279.1','artist':'Jay & Co','title':"Big Pimpin' (Dirty)",'remix':'Dirty'},
        {'path':'C:\\Videos\\Tyla - Water.mp4','size':'62120013','songlength':'219.2','artist':'','title':None}]
 assert L.format_vdjfolder(songs)==EXPECTED
 assert b'singleDrive' not in L.format_vdjfolder([songs[0],dict(songs[1],path='E:\\x.mp3')])
 for bad in ([],[{'size':'1'}],[{'path':'C:\\a\x01.mp3'}]):
  try:L.format_vdjfolder(bad);raise AssertionError(bad)
  except L.VirtualDJListError:pass
 for bad in ('','a/b','a\\b','con','x.','a:b','a?'):
  try:L.list_name(bad);raise AssertionError(bad)
  except L.VirtualDJListError:pass
 assert L.list_name(' Friday Set ')=='Friday Set'
 # Running check: Windows process names, fails closed
 L.ensure_virtualdj_closed(lambda:[(1,'C:\\Windows\\notepad.exe')])
 for snap in (lambda:[(2,'C:\\Program Files\\VirtualDJ\\virtualdj.exe')],):
  try:L.ensure_virtualdj_closed(snap);raise AssertionError('passed while running')
  except L.VirtualDJListError as e:assert 'Quit VirtualDJ' in str(e)
 def broken():raise ProcessInspectionError('denied')
 try:L.ensure_virtualdj_closed(broken);raise AssertionError('passed unverifiable')
 except L.VirtualDJListError as e:assert 'Could not verify' in str(e)
 with tempfile.TemporaryDirectory(dir=root) as d:
  d=pathlib.Path(d);home=d/'VirtualDJ';(home/'MyLists').mkdir(parents=True);music=d/'Music';music.mkdir()
  a=music/"Rock & Roll's Song.mp3";b=music/'Clip.VOB';c=music/'No Tags.avi'
  for f,n in ((a,1000),(b,2000),(c,3000)):f.write_bytes(b'x'*n)
  (home/'database.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<VirtualDJ_Database Version="8.5">'
   f'<Song FilePath="{L._escape(a)}" FileSize="1000"><Tags Author="Band &amp; Co" Title="Rock &amp; Roll&apos;s Song" Remix="Clean"/><Infos SongLength="201.06"/></Song>'
   f'<Song FilePath="{L._escape(b)}" FileSize="2000"><Tags Title="Clip"/><Infos SongLength="60"/></Song></VirtualDJ_Database>',encoding='utf8')
  sums={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in (a,b,c,home/'database.xml')}
  try:L.write_new_vdjfolder(home/'MyLists','Set',[str(a)],[]);raise AssertionError('no guard')
  except L.VirtualDJListError:pass
  def running():raise L.VirtualDJListError('Quit VirtualDJ, then try again.')
  try:L.write_new_vdjfolder(home/'MyLists','Set',[str(a)],[],running);raise AssertionError('wrote while running')
  except L.VirtualDJListError:pass
  assert not list((home/'MyLists').iterdir())
  allowed={a,b,c}
  app=Flask(__name__);app.register_blueprint(create_virtualdj_blueprint(lambda p:p in allowed or p.suffix in ('.xml','.vdjfolder'),lambda feature:None,lambda kind:('',True),home=lambda:home,ensure_closed=lambda:None))
  client=app.test_client();h={'Origin':'http://localhost'}
  assert client.get('/api/windows/virtualdj/capabilities').json['create_lists']
  payload={'name':'Friday Set','paths':[str(b),str(a),str(c)]}
  assert client.post('/api/windows/virtualdj/lists',json=payload).status_code==403
  r=client.post('/api/windows/virtualdj/lists',json=payload,headers=h);assert r.status_code==200 and r.json['tracks']==3 and r.json['with_metadata']==2,r.json
  out=home/'MyLists'/'Friday Set.vdjfolder';data=out.read_bytes()
  assert data==L.format_vdjfolder([{'path':str(b),'size':'2000','songlength':'60.0','title':'Clip'},
   {'path':str(a),'size':'1000','songlength':'201.1','artist':'Band & Co','title':"Rock & Roll's Song",'remix':'Clean'},{'path':str(c),'size':'3000'}])
  assert [s['path'] for s in L.read_list(out)['songs']]==[str(b),str(a),str(c)] and not list((home/'MyLists').glob('.axiom-vdj-*'))
  assert client.post('/api/windows/virtualdj/lists',json=payload,headers=h).status_code==409 and out.read_bytes()==data
  assert client.post('/api/windows/virtualdj/lists',json={'name':'X','paths':[str(music/'missing.mp3')]},headers=h).status_code==400
  assert client.post('/api/windows/virtualdj/lists',json={'name':'../X','paths':[str(a)]},headers=h).status_code==400
  assert client.post('/api/windows/virtualdj/lists',json={'name':'Y','paths':['relative.mp3']},headers=h).status_code==400
  # Inspect accepts the .vdjfolder lists VirtualDJ 8.5 saves
  r=client.post('/api/windows/virtualdj/inspect',json={'database_path':str(home/'database.xml'),'list_path':str(out)},headers=h)
  assert r.status_code==200 and r.json['summary']=={'matched':2,'missing':1,'ambiguous':0,'unresolved':0},r.json
  assert all(hashlib.sha256(p.read_bytes()).hexdigest()==v for p,v in sums.items())
  denied=Flask('denied');denied.register_blueprint(create_virtualdj_blueprint(lambda p:True,lambda feature:(jsonify(error='license required'),403),home=lambda:home,ensure_closed=lambda:None))
  assert denied.test_client().post('/api/windows/virtualdj/lists',json=payload,headers=h).status_code==403
 print('PASS: VirtualDJ 8.5 .vdjfolder lists byte layout, names, running check, API creation with database details, no overwrite, inspect')
except BaseException:
 import traceback;traceback.print_exc();sys.exit(1)
