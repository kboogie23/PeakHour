"""Recording Test Signal and MP3 takes on Windows, with fake inputs (no device opens) and FFmpeg."""
import pathlib,sys,tempfile,math,wave,numpy as np,traceback
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
try:
 import imageio_ffmpeg;ff=imageio_ffmpeg.get_ffmpeg_exe()
 from windows_recording import WindowsRecordingManager
 from windows_capture import WindowsInputCapture,sample_peak
 class FakeStream:
  def __init__(self,**kw):self.kw=kw;self.callback=kw['callback'];self.active=False;FakeStream.last=self
  def start(self):
   self.active=True;block=np.zeros((480,4),np.float32);block[:,2]=0.25;block[:,3]=-0.5  # channels 3/4 carry the mix
   self.callback(block,480,None,None)
  def stop(self):self.active=False
  def close(self):pass
 dev=[dict(name='Mixer',hostapi=0,max_input_channels=4,default_samplerate=48000)]
 # The sampler reads only the chosen pair, applies record gain, and opens no file
 db=sample_peak(device=0,samplerate=48000,channels=(2,3),input_channels=4,gain_db=-6,stream_factory=FakeStream,sleep=lambda s:None)
 assert abs(db-(20*math.log10(0.5)-6))<1e-6,db
 assert sample_peak(device=0,samplerate=48000,channels=(0,1),input_channels=4,stream_factory=FakeStream,sleep=lambda s:None)==-math.inf
 with tempfile.TemporaryDirectory(dir=root) as d:
  d=pathlib.Path(d);calls=[]
  def sampler(**kw):calls.append(kw);return sample_peak(stream_factory=FakeStream,sleep=lambda s:None,**kw)
  m=WindowsRecordingManager(str(d/'settings.json'),str(d),capture_factory=lambda:WindowsInputCapture(stream_factory=FakeStream),
     device_query=lambda:[dict(x) for x in dev],host_query=lambda:[dict(name='WASAPI')],ffmpeg=ff,peak_sampler=sampler)
  name=m.devices()['devices'][0]['name']
  m.save_settings({'source_mode':'device','device_name':name,'format':'mp3'})
  r=m.test_input(source_mode='device',source_id=name,left_channel=2,right_channel=3)
  assert r['success'] and r['signal']['signal']!='none' and r['pair_confirmed'] is False and r['capture_channel_label']=='Channels 3/4',r
  assert calls[-1]['channels']==(2,3) and calls[-1]['seconds']==3.0 and list(d.iterdir())==[d/'settings.json'],list(d.iterdir())
  silent=m.test_input(source_mode='device',source_id=name,left_channel=0,right_channel=1)
  assert silent['signal']['signal']=='none',silent
  try:m.test_input(source_mode='device',source_id=name,left_channel=1,right_channel=1);raise AssertionError('same channel accepted')
  except RuntimeError:pass
  try:m.test_input(source_mode='device',source_id='Gone');raise AssertionError('missing input accepted')
  except RuntimeError:pass
  # An MP3 take: captured as WAV, encoded at the chosen bitrate, WAV removed only after success
  m.save_settings({'device_capture_pair':{'device_key':'name:'+name.casefold(),'left_channel':2,'right_channel':3}})
  prof=m._capture_profile(m._input_devices()[0],m.load_settings())
  if not prof['confirmed']:
   import json;s=json.loads((d/'settings.json').read_text());s.setdefault('device_capture_pairs',{})[prof['device_key']]={'left_channel':2,'right_channel':3,'channel_label':'Channels 3/4','confirmed':True};(d/'settings.json').write_text(json.dumps(s))
  m.start(source_mode='device',source_id=name)
  for _ in range(100):FakeStream.last.callback(np.full((480,4),0.1,np.float32),480,None,None)
  st=m.stop()
  saved=pathlib.Path(st['saved_path'])
  assert st['format']=='mp3' and saved.suffix=='.mp3' and saved.stat().st_size>1000 and not list(d.glob('*.wav*')),(st,list(d.iterdir()))
  import mutagen.mp3;info=mutagen.mp3.MP3(saved).info
  assert info.bitrate==320000 and abs(info.length-1.0)<0.1,(info.bitrate,info.length)
  assert m.status()['ffmpeg_available'] is True
 print('PASS: Test Signal meters the chosen pair for 3 s without a file; MP3 takes encode at 320 kbps and keep no WAV')
except BaseException:
 traceback.print_exc();sys.exit(1)
