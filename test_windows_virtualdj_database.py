import hashlib,pathlib,sys,tempfile
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_virtualdj_database import read_database,match_list,VirtualDJDatabaseError
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);db=d/'database.xml'
 db.write_text('''<?xml version="1.0" encoding="UTF-8"?><VirtualDJ_Database Version="8.1"><Song FilePath="D:\\Music\\one.mp3" FileSize="12"><Tags Author="DJ &amp; Co" Title="Track" Genre="House"/><Infos SongLength="215.5" PlayCount="4"/><Scan Bpm="0.5" Key="Am"/><Poi Type="cue" Pos="12.25" Name="Drop" Num="1"/><Extra Unknown="value"/></Song><Song FilePath="D:\\Video\\two.vob"><Tags Title="Video"/><Scan Bpm="0"/></Song><Song FilePath="stream://not-local"><Scan Bpm="NaN"/></Song></VirtualDJ_Database>''',encoding='utf8')
 before=hashlib.sha256(db.read_bytes()).hexdigest();data=read_database(db);tracks=data['tracks']
 assert data['version']=='8.1' and len(tracks)==3
 assert tracks[0]['bpm']==120 and tracks[0]['key']=='Am' and tracks[0]['duration_sec']==215.5
 assert tracks[0]['artist']=='DJ & Co' and tracks[0]['source_sections']['Poi'][0]['attributes']['Name']=='Drop'
 assert tracks[0]['unrecognized_sections'][0]['tag']=='Extra' and tracks[1]['bpm'] is None and tracks[2]['path_kind']=='unresolved'
 data['tracks'].append(dict(data['tracks'][1]))
 joined=match_list(data,{'songs':[{'path':'d:/music/ONE.mp3'},{'path':'D:/Video/two.vob'},{'path':'D:/missing.mp3'},{'path':'stream://example'},{'path':'D:/Music/one.mp3'}]})
 assert [x['status'] for x in joined['items']]==['matched','ambiguous','missing','unresolved','matched']
 assert joined['items'][0]['track']['bpm']==120 and joined['matched']==2
 assert hashlib.sha256(db.read_bytes()).hexdigest()==before
 bad=d/'bad.xml';bad.write_text('<!DOCTYPE a [<!ENTITY x "evil">]><VirtualDJ_Database><Song FilePath="&x;"/></VirtualDJ_Database>',encoding='utf8')
 try:read_database(bad)
 except VirtualDJDatabaseError:pass
 else:raise AssertionError('DTD was accepted')
 print('PASS: VirtualDJ database metadata, tempo conversion, cue preservation, ordered matching, source hash and DTD rejection')
