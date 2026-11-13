"""Windows versions of Mac-only features: File Explorer reveal (library + duplicate archive), the Windows
audio check behind AXIOM's Core Audio card, and the Recycle Bin for duplicate cleanup (with a STAND-IN
Recycle Bin folder; nothing is recycled for real)."""
import os,sys,pathlib,json,uuid,struct,shutil,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 import windows_mac_parity as M
 folder=workspace/'fixtures'/'mac-parity'/uuid.uuid4().hex;folder.mkdir(parents=True)
 song=folder/'Song.mp3';song.write_bytes(b'\xff\xfb'+b'1'*4000)
 from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 assert app._windows_mac_parity_installed
 app.CACHE_PATH=str(folder/'library_cache.json');pathlib.Path(app.CACHE_PATH).write_text(json.dumps({'tracks':[{'path':str(song)}]}),encoding='utf-8')
 # Reveal: explorer /select for a library file; refusals as AXIOM's own route
 calls=[];M.install_reveal(app,runner=lambda args,**k:calls.append(args))
 c=app.app.test_client()
 r=c.post('/api/library/reveal',json={'path':str(song)});assert r.status_code==200 and r.get_json()['success'],r.get_json()
 assert calls[-1]==['explorer.exe','/select,',str(song)],calls
 assert c.post('/api/library/reveal',json={'path':str(folder/'other.mp3')}).status_code==404
 assert c.post('/api/library/reveal',json={'path':str(song)},environ_base={'REMOTE_ADDR':'192.168.0.9'}).status_code==403
 # Duplicate archive "open folder" goes to File Explorer; other actions still reach AXIOM's route
 import duplicate_archive
 class Store:
  def __init__(self,root):pass
  def load(self,batch_id):
   if batch_id!='b1':raise ValueError('Unknown batch')
   return {'id':batch_id}
  def _check_destination(self,batch):return folder
 real=duplicate_archive.DuplicateArchive;duplicate_archive.DuplicateArchive=Store
 try:
  h={'Origin':'http://localhost'}
  r=c.post('/api/library/dupes/archive',json={'action':'reveal','batch_id':'b1'},headers=h);assert r.get_json()['success'],r.get_json()
  assert calls[-1]==['explorer.exe',str(folder)],calls
  assert c.post('/api/library/dupes/archive',json={'action':'reveal','batch_id':'zz'},headers=h).status_code==400
  assert c.post('/api/library/dupes/archive',json={'action':'reveal','batch_id':'b1'}).status_code==403  # no Origin
 finally:duplicate_archive.DuplicateArchive=real
 # Audio check: Windows Audio service and default output, same shape as AXIOM's Core Audio snapshot
 ok=M.audio_snapshot(app,service=lambda:True,output=lambda:'Speakers')
 assert ok['status']=='ok' and 'Speakers' in ok['message'] and ok['daemon_running']
 assert M.audio_snapshot(app,service=lambda:False,output=lambda:'Speakers')['reason']=='audio_service_stopped'
 assert M.audio_snapshot(app,service=lambda:None,output=lambda:None)['reason']=='no_output_device'
 states=iter([{'status':'error','reason':'no_output_device','message':'No sound output found'},{'status':'ok'}])
 M.install_audio(app,snapshot=lambda:next(states))  # missing output, then found after the device re-scan
 r=c.post('/api/performance/refresh_audio').get_json();assert r['success'] and r['action']=='repaired',r
 M.install_audio(app,snapshot=lambda:{'status':'error','reason':'audio_service_stopped','message':'Windows Audio is stopped'})
 r=c.post('/api/performance/refresh_audio');assert r.status_code==409 and 'Services' in r.get_json()['message']
 M.install_audio(app,snapshot=lambda:{'status':'ok'})
 assert c.post('/api/performance/refresh_audio').get_json()['action']=='not_needed'
 real_status=M.audio_snapshot(app);assert real_status['status'] in ('ok','error') and 'reason' in real_status  # this PC, read-only
 # Recycle Bin: $I records (v1 and v2) and the recycled file found by its original path
 bin_root=folder/'bin';(bin_root/'S-1-5-21-test').mkdir(parents=True)
 def record(original,version=2):
  name=original.encode('utf-16-le')+b'\0\0'
  if version==2:return struct.pack('<qqqi',2,4002,0,len(name)//2)+name
  return struct.pack('<qqq',1,4002,0)+name.ljust(520,b'\0')
 v1=bin_root/'v1.bin';v1.write_bytes(record('C:\\Music\\a.mp3',1));assert M.read_recycle_record(v1)=='C:\\Music\\a.mp3'
 decoy=bin_root/'S-1-5-21-test'/'$IAAAAAA.mp3';decoy.write_bytes(record('C:\\Elsewhere\\Song.mp3'))
 (bin_root/'S-1-5-21-test'/'$RAAAAAA.mp3').write_bytes(b'other')
 def fake_shell(path):
  shutil.move(path,bin_root/'S-1-5-21-test'/'$RBBBBBB.mp3')
  (bin_root/'S-1-5-21-test'/'$IBBBBBB.mp3').write_bytes(record(path))
 before=song.read_bytes()
 recycled=M.recycle(str(song),shell=fake_shell,bin_root=bin_root)
 assert pathlib.Path(recycled).name=='$RBBBBBB.mp3' and pathlib.Path(recycled).read_bytes()==before and not song.exists()
 try:M.recycle(str(song),shell=fake_shell,bin_root=bin_root);raise AssertionError('missing file accepted')
 except OSError as e:assert 'no longer there' in str(e)
 other=folder/'Kept.mp3';other.write_bytes(b'x')
 try:M.recycle(str(other),shell=lambda p:None,bin_root=bin_root);raise AssertionError('not moved accepted')
 except OSError as e:assert 'did not move' in str(e)
 assert other.exists()
 lost=folder/'Lost.mp3';lost.write_bytes(b'x')
 try:M.recycle(str(lost),shell=lambda p:os.remove(p),bin_root=bin_root,wait=0.3);raise AssertionError('unverified accepted')
 except OSError as e:assert 'could not be found in the Recycle Bin' in str(e)
 # Never delete for good: a removable/network drive, a bin set to delete at once, or a file over the bin size is refused untouched
 usb=folder/'Usb.mp3';usb.write_bytes(b'x'*2048);calls=[]
 real_type=M._drive_type;assert real_type(M._volume_root(str(usb)))==M.DRIVE_FIXED
 for kind in (2,4,5):  # DRIVE_REMOVABLE, DRIVE_REMOTE, DRIVE_CDROM
  M._drive_type=lambda root,kind=kind:kind
  try:
   try:M.recycle(str(usb),shell=calls.append,bin_root=bin_root);raise AssertionError('removable drive accepted')
   except OSError as e:assert 'no Recycle Bin' in str(e) and 'NOT deleted' in str(e)
  finally:M._drive_type=real_type
 assert usb.exists() and usb.read_bytes()==b'x'*2048 and not calls
 for setting,word in (((1,None),'immediately'),((0,1),'bigger')):
  M._bin_settings,keep=(lambda root,setting=setting:setting),M._bin_settings
  try:
   if word=='bigger':usb.write_bytes(b'x'*(1024*1024+1))
   try:M.recycle(str(usb),shell=calls.append,bin_root=bin_root);raise AssertionError('bin setting ignored')
   except OSError as e:assert word in str(e)
  finally:M._bin_settings=keep
 assert usb.exists() and not calls
 M.check_recyclable(str(usb),settings=lambda root:(None,None))  # a plain fixed drive passes
 assert M.FOF_WANTNUKEWARNING==0x4000
 # SUBST/no-GUID volume, default-quota estimate, non-numeric registry value
 def no_guid(root):raise OSError('substituted drive with no Recycle Bin')
 try:M.check_recyclable(str(usb),settings=no_guid);raise AssertionError('no-GUID accepted')
 except OSError as e:assert 'Recycle Bin' in str(e)
 usb.write_bytes(b'x'*1000)
 try:M.check_recyclable(str(usb),settings=lambda r:(None,None),disk_total=lambda r:10000);raise AssertionError('over 5% accepted')
 except OSError as e:assert 'probably bigger' in str(e)
 M.check_recyclable(str(usb),settings=lambda r:(None,None),disk_total=lambda r:100000)  # 1%: fine
 M.check_recyclable(str(usb),settings=lambda r:(None,500),disk_total=lambda r:1)  # stored size wins over the estimate
 import winreg
 sub='Software\\PeakHourTest-'+uuid.uuid4().hex
 with winreg.CreateKey(winreg.HKEY_CURRENT_USER,sub) as k:
  winreg.SetValueEx(k,'Bad',0,winreg.REG_SZ,'abc');winreg.SetValueEx(k,'Good',0,winreg.REG_DWORD,7)
 try:assert M._reg_int(winreg.HKEY_CURRENT_USER,sub,'Bad') is None and M._reg_int(winreg.HKEY_CURRENT_USER,sub,'Good')==7 and M._reg_int(winreg.HKEY_CURRENT_USER,sub,'Nope') is None
 finally:winreg.DeleteKey(winreg.HKEY_CURRENT_USER,sub)
 real=M._bin_settings(M._volume_root(str(usb)));assert len(real)==2  # the real lookup works on this fixed drive
 import duplicate_trash
 assert duplicate_trash.apply.__defaults__[-1] is M.recycle and duplicate_trash.mac_trash is M.recycle
 shutil.rmtree(folder)
 print('PASS: File Explorer reveal, Windows audio check and Recycle Bin replace the Mac-only versions')
except BaseException:
 traceback.print_exc();sys.exit(1)
