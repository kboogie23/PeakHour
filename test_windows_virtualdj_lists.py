import hashlib,pathlib,sys,tempfile
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_virtualdj_lists import write_new_list,read_list,VirtualDJListError
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);files=[]
 for name in ['Song & One.mp3','Visual é.avi','Clip.mp4','Disc.vob']:
  p=d/name;p.write_bytes(name.encode('utf8'));files.append(p)
 before=[hashlib.sha256(p.read_bytes()).hexdigest() for p in files]
 target=d/'Test List.xml';result=write_new_list(target,files+[files[0]])
 data=read_list(target);assert result['tracks']==5 and data['attributes']['ordered']=='yes'
 assert [x['path'] for x in data['songs']]==[str(p) for p in files+[files[0]]]
 assert [int(x['idx']) for x in data['songs']]==list(range(5))
 assert [int(x['size']) for x in data['songs']]==[p.stat().st_size for p in files+[files[0]]]
 old=target.read_bytes()
 try:write_new_list(target,files)
 except FileExistsError:pass
 else:raise AssertionError('existing list overwritten')
 assert target.read_bytes()==old and [hashlib.sha256(p.read_bytes()).hexdigest() for p in files]==before
 malicious=d/'bad.xml';malicious.write_text('<!DOCTYPE a [<!ENTITY x "unsafe">]><VirtualFolder><song path="&x;"/></VirtualFolder>',encoding='utf8')
 try:read_list(malicious)
 except VirtualDJListError:pass
 else:raise AssertionError('DTD accepted')
 print('PASS: ordered VirtualDJ XML lists preserve audio/video paths, duplicates, files, and reject DTD/overwrite')
