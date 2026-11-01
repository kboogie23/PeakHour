"""Studio DAW mix saving on Windows: Save As (stubbed), chunked WAV transfer, MP3 via FFmpeg/LAME
with Title/Artist/BPM/Key, verified receipts and Add to Library, on generated audio only."""
import os,sys,pathlib,uuid,json,base64,struct,hashlib,traceback
import numpy as np
import imageio_ffmpeg;ff=imageio_ffmpeg.get_ffmpeg_exe()
workspace=pathlib.Path(__file__).resolve().parent
probe=workspace/'axiom-win-probe';home=workspace/'probe-home'
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(home/'AppData/Local'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime'),'NO_PROXY':'*'})
sys.path.insert(0,str(probe));os.chdir(probe)
def audit(event,args):  # only FFmpeg may start; no network; no writes outside the workspace
 if event=='subprocess.Popen' and not os.path.normcase(str(args[1])).lstrip('"').startswith(os.path.normcase(ff)):raise PermissionError('Probe blocks '+str(args[1])[:80])
 if event in ('socket.connect','socket.connect_ex','os.system','os.startfile'):raise PermissionError('Probe blocks '+event)
 if event=='open' and len(args)>1 and isinstance(args[0],(str,os.PathLike)) and isinstance(args[1],str) and any(x in args[1] for x in 'wax+'):
  if not pathlib.Path(args[0]).resolve().is_relative_to(workspace):raise PermissionError('Probe blocks file write outside workspace')
sys.addaudithook(audit)
try:

 folder=workspace/'fixtures'/'mix-export'/uuid.uuid4().hex;folder.mkdir(parents=True)
 chosen=[]
 def chooser(filename,format):
  chosen.append((filename,format));return ('',True) if filename.startswith('Cancel') else (str(folder/filename),False)
 from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder,video_cache_root=folder,video_allowed_path=lambda p:True,video_ffmpeg=ff,mix_export_chooser=chooser)
 app.CACHE_PATH=str(folder/'library.json');pathlib.Path(app.CACHE_PATH).write_text(json.dumps({'tracks':[]}),encoding='utf-8')
 client=app.app.test_client();h={'Host':'127.0.0.1','Origin':'http://127.0.0.1'}
 def call(action,**data):
  r=client.post('/api/windows/mix-export/'+action,json=data,headers=h);assert r.status_code==200,(r.status_code,r.data);return r.get_json()
 # Studio's render: 58-byte float WAV (export.js encode) plus wav-metadata.js LIST/INFO and ID3v2.4 chunks
 frames=48000*3;pcm=(np.sin(np.arange(frames*2)/30)*0.3).astype('<f4').tobytes()
 head=b'RIFF'+struct.pack('<I',50+len(pcm))+b'WAVEfmt '+struct.pack('<IHHIIHHH',18,3,2,48000,384000,8,32,0)+b'fact'+struct.pack('<II',4,frames)+b'data'+struct.pack('<I',len(pcm))
 def frame(i,v):
  body=b'\x03'+v.encode();n=len(body);return i.encode()+bytes([(n>>21)&127,(n>>14)&127,(n>>7)&127,n&127])+b'\0\0'+body
 fr=frame('TIT2','Test Edit')+frame('TPE1','AXIOM Tester')+frame('TBPM','124')+frame('TKEY','8A');n=len(fr)
 id3=b'ID3\x04\0\0'+bytes([(n>>21)&127,(n>>14)&127,(n>>7)&127,n&127])+fr
 chunk=lambda i,b:i+struct.pack('<I',len(b))+b+(b'\0' if len(b)%2 else b'')
 tags=chunk(b'LIST',b'INFO'+chunk(b'INAM',b'Test Edit\0')+chunk(b'IART',b'AXIOM Tester\0'))+chunk(b'id3 ',id3)
 blob=bytearray(head+pcm+tags);struct.pack_into('<I',blob,4,len(blob)-8);blob=bytes(blob)
 assert call('mixExportSupport')['formats']==['wav','mp3']
 def save(filename,fmt):
  eid=str(uuid.uuid4());c=call('mixExportChoose',exportId=eid,filename=filename,format=fmt)
  if not c['success']:return c
  assert call('mixExportStart',exportId=eid,size=len(blob))['success']
  for off in range(0,len(blob),256*1024):
   r=call('mixExportChunk',exportId=eid,offset=off,data=base64.b64encode(blob[off:off+256*1024]).decode());assert r['received']==min(off+256*1024,len(blob)),r
  return call('mixExportFinish',exportId=eid)
 w=save('AXIOM Tester - Test Edit.wav','wav')
 assert w['state']=='saved' and w['bytes']==len(blob) and w['frames']==frames and pathlib.Path(w['path']).read_bytes()==blob,w
 m=save('AXIOM Tester - Test Edit.mp3','mp3')
 assert m.get('state')=='saved' and m['format']=='mp3' and m['inputBytes']==len(blob) and m['bytes']>0 and m['frames']==frames,m
 assert m['sha256']==hashlib.sha256(pathlib.Path(m['path']).read_bytes()).hexdigest()
 import mutagen.mp3;mp3=mutagen.mp3.MP3(m['path'])
 assert abs(mp3.info.length-3.0)<0.1 and mp3.info.bitrate==320000,(mp3.info.length,mp3.info.bitrate)
 assert [str(mp3.tags[k]) for k in ('TIT2','TPE1','TBPM','TKEY')]==['Test Edit','AXIOM Tester','124','8A'],mp3.tags
 assert sorted(p.name for p in folder.iterdir() if 'partial' in p.name)==[]  # no partial files left
 assert call('mixExportChoose',exportId=str(uuid.uuid4()),filename='Cancel.wav',format='wav')=={'success':False,'cancelled':True}
 eid=str(uuid.uuid4());call('mixExportChoose',exportId=eid,filename='Stopped.wav',format='wav');call('mixExportStart',exportId=eid,size=len(blob))
 call('mixExportChunk',exportId=eid,offset=0,data=base64.b64encode(blob[:1000]).decode());call('mixExportCancel',exportId=eid)
 assert not any('Stopped' in p.name for p in folder.iterdir())
 bad=call('mixExportChunk',exportId=eid,offset=0,data='AAAA');assert bad['success'] is False
 r=client.post('/api/windows/mix-export/mixExportSupport',json={},headers={'Host':'127.0.0.1','Origin':'http://evil.example'});assert r.status_code==403
 lib=client.post('/api/studio-daw/export/library',json={'path':m['path'],'sha256':m['sha256'],'bpm':124,'original_song':'','metadata':{'title':'Test Edit','artist':'AXIOM Tester','key':'8A'}},headers=h)
 data=lib.get_json();assert lib.status_code==200 and data.get('success') is not False,(lib.status_code,data)
 print('PASS: Studio saves WAV and 320 kbps MP3 (tags copied) through Save As with verified receipts; cancel cleans up; Add to Library accepts the MP3 ->',{k:data[k] for k in list(data)[:4]})
except BaseException:
 traceback.print_exc();sys.exit(1)
