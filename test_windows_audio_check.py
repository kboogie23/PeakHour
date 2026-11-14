"""Studio "Audio check" reasons on Windows (windows_audio_check), through the real /api/studio-daw/assets/check route
on generated audio: odd names and a file outside any library folder stay ready; a gone drive letter, a path of 260+
characters, a moved file, a folder and an unsupported format each get their own plain reason."""
import os,sys,pathlib,uuid,time,traceback,wave,struct,string
workspace=pathlib.Path(__file__).resolve().parent
probe=workspace/'axiom-win-probe';home=workspace/'probe-home'
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(home/'AppData/Local'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime')})
sys.path.insert(0,str(probe));os.chdir(probe)
PFX=chr(92)*2+'?'+chr(92)
def tone(path):
 p=str(path)
 if len(p)>240:p=PFX+p
 with wave.open(p,'wb') as w:
  w.setnchannels(1);w.setsampwidth(2);w.setframerate(8000);w.writeframes(struct.pack('<h',0)*16000)
try:
 import imageio_ffmpeg;ff=imageio_ffmpeg.get_ffmpeg_exe()
 folder=workspace/'fixtures'/'audio_check'/uuid.uuid4().hex;(folder/'library').mkdir(parents=True);(folder/'outside').mkdir()
 lib=folder/'library'
 ok={'plain':lib/'plain.wav','special':lib/"Hey! #1 [Remix] & Co's  double  space.wav",'combining':lib/('N\u0303engo.wav'),'outside':folder/'outside'/'o.wav'}
 for p in ok.values():tone(p)
 deep=lib
 while len(str(deep))<280:deep=deep/('d'*40)
 pathlib.Path(PFX+str(deep)).mkdir(parents=True);long=deep/'long.wav';tone(long)
 assert len(str(long))>=260
 gone=next(c for c in string.ascii_uppercase[::-1] if not os.path.isdir(c+':'+chr(92)))  # a drive letter nothing uses
 drive,tail=os.path.splitdrive(str(lib/'plain.wav'))
 on_gone=gone+':'+tail;on_gone_alone=gone+':'+chr(92)+'no'+chr(92)+'copy'+chr(92)+'anywhere.wav'
 moved=lib/'moved.wav';(lib/'folder.wav').mkdir();video=lib/'clip.mpg';video.write_bytes(b'\0'*64)
 from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder,video_cache_root=folder,video_allowed_path=lambda p:True,video_ffmpeg=ff)
 client=app.app.test_client();h={'Host':'127.0.0.1','Origin':'http://127.0.0.1'}
 paths=[str(p) for p in ok.values()]+[str(long),on_gone,on_gone_alone,str(moved),str(lib/'folder.wav'),str(video)]
 res={};wait=list(paths);end=time.time()+120
 while wait:
  assert time.time()<end,wait
  data=client.post('/api/studio-daw/assets/check',json={'paths':wait,'metadataOnly':True,'verifyDecoded':True},headers=h).get_json()
  for a in data['assets']:
   if a['status']!='pending':res[a['path']]=a
  wait=[p for p in wait if p not in res];time.sleep(0.2)
 for name,p in ok.items():assert res[str(p)]['status']=='ready',(name,res[str(p)])
 r=res[str(long)];assert r['status']=='unavailable' and 'characters long' in r['reason'] and str(len(str(long))) in r['reason'],r
 r=res[on_gone]['reason'];assert 'drive %s:'%gone in r and 'not connected' in r and 'same file is on '+drive in r and 'Reconnect Music' in r,r
 r=res[on_gone_alone]['reason'];assert 'drive %s:'%gone in r and 'not connected' in r and 'same file' not in r,r
 r=res[str(moved)]['reason'];assert 'no longer at that location' in r,r
 r=res[str(lib/'folder.wav')]['reason'];assert 'folder, not an audio file' in r,r
 r=res[str(video)]['reason'];assert r.startswith('.mpg files cannot be used in Studio') and 'mp3' in r,r
 assert not any('missing or is not a regular file' in a.get('reason','') or 'not permitted' in a.get('reason','') for a in res.values())
 import windows_audio_check as c
 d=c.explain('x.mp3',{'status':'unavailable','reason':c.DECODER},{'.mp3'});assert d['reason'].startswith(c.DECODER) and 'damaged' in d['reason']
 assert c.explain('x.mp3',{'status':'ready'},{'.mp3'})=={'status':'ready'}  # a ready song is never touched
 # One probe per drive for a whole request, drive type first, a dead network drive is never waited on twice
 import threading
 kinds={'Q':1,'X':3,'N':4};typed=[];probed=[];real_type,real_isdir,real_wait=c.drive_type,os.path.isdir,c.PROBE_WAIT
 def fake_type(root):typed.append(root[0].upper());return kinds.get(root[0].upper(),1)
 def fake_isdir(p):
  p=str(p)
  if len(p)==3 and p[1:]==':'+chr(92):
   probed.append(p[0].upper())
   if p[0].upper()=='N':time.sleep(1.0)  # does not answer within the wait
   if p[0].upper() in 'XN':return False
  return real_isdir(p)
 c.drive_type,c.PROBE_WAIT,os.path.isdir=fake_type,0.2,fake_isdir;c._DRIVES.clear()
 try:
  started=time.time()
  for drv in 'QXN':
   for i in range(100):
    r=c.missing_reason(drv+':'+chr(92)+'songs'+chr(92)+'s%d.mp3'%i)
    if i==0:first=r
   assert ('not answering' if drv=='N' else 'not connected') in first,(drv,first)
   assert r==first
  assert probed.count('Q')==0 and probed.count('X')==1 and probed.count('N')==1,probed  # absent drive never touched
  assert time.time()-started<3,'a dead network drive was waited on more than once'
  c._DRIVES['X:']=(time.monotonic()-c.TTL-1,'ok');c.drive_state('X:');assert probed.count('X')==2  # answers expire
 finally:c.drive_type,c.PROBE_WAIT,os.path.isdir=real_type,real_wait,real_isdir
 c.install();from studio_daw import imports;assert imports._duration_asset._windows_audio_check  # installing twice does not nest
 print('PASS: Studio audio check keeps odd names ready and explains gone drive (names the copy on another drive), 260+ path, moved file, folder, unsupported format')
except BaseException:
 traceback.print_exc();sys.exit(1)
