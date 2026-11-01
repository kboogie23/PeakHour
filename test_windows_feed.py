"""Streaming feed (windows_feed.py): a recording also plays into a virtual audio cable for streaming apps.
Finds the cable by name; plays blocks in order; keeps latency short by dropping the oldest; a feed
problem never stops the take; the recorder reports the cable to AXIOM's Broadcast controls, refuses
the feed without a cable, and closes it when the take stops. Audio devices are stand-ins."""
import pathlib,sys,tempfile,numpy as np,traceback
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
try:
 import windows_feed as F
 from windows_recording import WindowsRecordingManager
 from windows_capture import WindowsInputCapture
 class FakeStream:
  def __init__(self,**kwargs):self.kwargs=kwargs;self.callback=kwargs['callback'];self.active=False;self.closed=False
  def start(self):self.active=True
  def stop(self):self.active=False
  def close(self):self.closed=True
 apis=[{'name':'MME'},{'name':'Windows WASAPI'}]
 devs=[{'name':'Speakers (Focusrite)','hostapi':0,'max_output_channels':2,'max_input_channels':0},
       {'name':'CABLE Input (VB-Audio Virtual C','hostapi':0,'max_output_channels':2,'max_input_channels':0},
       {'name':'CABLE Input (VB-Audio Virtual Cable)','hostapi':1,'max_output_channels':2,'max_input_channels':0}]
 assert F.find_cable(lambda:devs,lambda:apis)=={'index':1,'name':'CABLE Input (VB-Audio Virtual C'}  # the MME entry (converts rates)
 assert F.find_cable(lambda:devs[:1],lambda:apis) is None
 assert F.find_cable(lambda:[{'name':'Voicemeeter Input (VB-Audio Voicemeeter VAIO)','hostapi':1,'max_output_channels':8}],lambda:apis)['index']==0
 def broken():raise OSError('no audio')
 assert F.find_cable(broken,lambda:apis) is None
 # Blocks play in order, split across callbacks; silence when empty; mono becomes stereo
 streams=[];feed=F.StreamingFeed(1,48000,stream_factory=lambda **k:streams.append(FakeStream(**k)) or streams[-1]).start()
 assert streams[0].kwargs['device']==1 and streams[0].kwargs['samplerate']==48000 and streams[0].kwargs['channels']==2
 a=np.full((3,2),0.25,np.float32);b=np.full((2,1),0.5,np.float32);feed.push(a);feed.push(b)
 out=np.ones((4,2),np.float32);streams[0].callback(out,4,None,None)
 assert np.allclose(out[:3],0.25) and np.allclose(out[3],0.5)
 out=np.ones((4,2),np.float32);streams[0].callback(out,4,None,None)
 assert np.allclose(out[0],0.5) and np.allclose(out[1:],0)
 # Falls behind: oldest blocks go, so the stream stays live (about a third of a second)
 for i in range(100):feed.push(np.full((1024,2),i/100,np.float32))
 assert feed.dropped>0 and feed._buffered<=48000*F.MAX_BUFFER_SECONDS+1024
 feed.stop();assert streams[0].closed and not streams[0].active
 feed.push(a)  # after stop: ignored, no error
 # The capture hands blocks to the feed; a failing feed is dropped and recording continues
 got=[];cap=WindowsInputCapture(stream_factory=FakeStream)
 with tempfile.TemporaryDirectory(dir=root) as d:
  cap.start(pathlib.Path(d)/'take.wav',device=0,samplerate=8000,channels=(0,1),input_channels=2)
  cap.feed=got.append;cap._stream.callback(np.full((4,2),0.1,np.float32),4,None,None);assert len(got)==1
  def bad(x):raise RuntimeError('cable gone')
  cap.feed=bad;cap._stream.callback(np.full((4,2),0.1,np.float32),4,None,None)
  assert cap.feed is None and cap.status()['error'] is None
  cap.stop()
 # Recorder: Broadcast fields follow the cable; no cable -> feed refused; feed closes with the take
 A=dict(name='Fixture Mixer',hostapi=0,max_input_channels=2,default_samplerate=8000)
 cable=[{'index':1,'name':'CABLE Input (VB-Audio Virtual C'}];made=[]
 class Feed:
  def __init__(self,device,rate):self.device,self.rate=device,rate;self.pushed=0;self.stopped=False;made.append(self)
  def start(self):return self
  def push(self,s):self.pushed+=1
  def stop(self):self.stopped=True
 with tempfile.TemporaryDirectory(dir=root) as d:
  d=pathlib.Path(d)
  m=WindowsRecordingManager(str(d/'settings.json'),str(d),capture_factory=lambda:WindowsInputCapture(stream_factory=FakeStream),
    device_query=lambda:[dict(A)],host_query=lambda:[dict(name='Test API')],cable_finder=lambda:cable[0],feed_factory=Feed)
  name=m.devices()['devices'][0]['name'];m.save_settings({'source_mode':'device','device_name':name,'broadcast_enabled':True})
  src=m.sources(source_mode='device')
  assert src['broadcast_available'] and src['broadcast_enabled'] and src['broadcast_device_name']=='CABLE Input (VB-Audio Virtual C',src
  m.start(source_mode='device',source_id=name)
  assert made and made[0].device==1 and made[0].rate==8000
  m._capture._stream.callback(np.zeros((4,2),np.float32),4,None,None);assert made[0].pushed==1
  m.stop();assert made[0].stopped and m._feed is None
  cable[0]=None
  src=m.sources(source_mode='device');assert not src['broadcast_available'] and not src['broadcast_enabled']
  try:m.start(source_mode='device',source_id=name);raise AssertionError('feed without a cable')
  except RuntimeError as e:assert 'virtual audio cable' in str(e)
  assert m._capture is None and len(made)==1
  m.save_settings({'broadcast_enabled':False});m.start(source_mode='device',source_id=name);assert m._feed is None;m._capture._stream.callback(np.zeros((4,2),np.float32),4,None,None);m.stop()
 print('PASS: streaming feed plays the take into a virtual cable, stays live, never stops the recording, closes with the take')
except BaseException:
 traceback.print_exc();sys.exit(1)
