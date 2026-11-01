import hashlib,pathlib,sys,tempfile
from flask import Flask,jsonify
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_virtualdj_api import create_virtualdj_blueprint
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);db=d/'database.xml';songs=d/'list.xml'
 db.write_text('<VirtualDJ_Database Version="8.1"><Song FilePath="C:\\Music\\a.mp3"><Tags Title="A"/><Scan Bpm="0.5"/></Song><Song FilePath="C:\\Video\\b.vob"/></VirtualDJ_Database>',encoding='utf8')
 songs.write_text('<VirtualFolder ordered="yes"><song path="c:/music/A.mp3"/><song path="C:/missing.avi"/><song path="C:/Video/b.vob"/></VirtualFolder>',encoding='utf8')
 before=[hashlib.sha256(x.read_bytes()).hexdigest() for x in (db,songs)]
 app=Flask(__name__);app.register_blueprint(create_virtualdj_blueprint(lambda p:p in (db,songs),lambda feature:None,lambda kind:(str(db if kind=='database' else songs),False)));c=app.test_client();h={'Origin':'http://localhost'}
 assert c.get('/api/windows/virtualdj/capabilities').json['chooser']
 assert c.post('/api/windows/virtualdj/choose',json={'kind':'database'},headers=h).json['path']==str(db)
 payload={'database_path':str(db),'list_path':str(songs),'limit':2}
 assert c.post('/api/windows/virtualdj/inspect',json=payload).status_code==403
 assert c.post('/api/windows/virtualdj/inspect',json=payload,headers={'Origin':'http://example.com'}).status_code==403
 r=c.post('/api/windows/virtualdj/inspect',json=payload,headers=h);assert r.status_code==200,r.json
 assert [x['status'] for x in r.json['items']]==['matched','missing'] and r.json['summary']['matched']==2 and r.json['next_offset']==2
 payload['offset']=2;r=c.post('/api/windows/virtualdj/inspect',json=payload,headers=h);assert r.json['items'][0]['track']['path'].endswith('b.vob')
 payload['database_path']=str(d/'other.xml');assert c.post('/api/windows/virtualdj/inspect',json=payload,headers=h).status_code==400
 assert [hashlib.sha256(x.read_bytes()).hexdigest() for x in (db,songs)]==before
 denied=Flask('denied');denied.register_blueprint(create_virtualdj_blueprint(lambda p:True,lambda feature:(jsonify(error='license required'),403)))
 assert denied.test_client().post('/api/windows/virtualdj/inspect',json={},headers=h).status_code==403
 print('PASS: paged VirtualDJ database/list API, origin and license gates, unchanged files')
