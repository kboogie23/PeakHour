import pathlib,sys,tempfile,numpy as np
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_recording import WindowsRecordingManager
from windows_capture import WindowsInputCapture
class FakeStream:
 def __init__(self,**kwargs):self.kwargs=kwargs;self.callback=kwargs['callback'];self.active=False
 def start(self):self.active=True
 def stop(self):self.active=False
 def close(self):pass
A=dict(name='Fixture Mixer',hostapi=0,max_input_channels=2,default_samplerate=8000)
B=dict(name='Other Device',hostapi=0,max_input_channels=2,default_samplerate=8000)
items=[A,B]
def devices():return [dict(x) for x in items]
def hosts():return [dict(name='Test API')]
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);m=WindowsRecordingManager(str(d/'settings.json'),str(d),capture_factory=lambda:WindowsInputCapture(stream_factory=FakeStream),device_query=devices,host_query=hosts)
 selected=m.devices()['devices'][0]['name'];m.save_settings({'source_mode':'device','device_name':selected})
 items[:]=[B,A]
 assert m.sources(source_mode='device')['selected_source_id']==selected
 m.start(source_mode='device',source_id=selected)
 assert m._capture._stream.kwargs['device']==1
 m._capture._stream.callback(np.zeros((4,2),dtype=np.float32),4,None,None);m.stop()
 items[:]=[A,A]
 choices=m.devices()['devices'];assert all(x['ambiguous'] for x in choices)
 assert not m.sources(source_mode='device')['ready']
 try:m.start(source_mode='device',source_id=choices[0]['name'])
 except RuntimeError as e:assert 'same name' in str(e)
 else:raise AssertionError('ambiguous input accepted')
 items[:]=[A,B];calls=0
 def changing():
  global calls
  calls+=1
  return [dict(x) for x in ([A,B] if calls==1 else [B,A])]
 m._device_query=changing
 try:m.start(source_mode='device',source_id=selected)
 except RuntimeError as e:assert 'changed' in str(e)
 else:raise AssertionError('changed index accepted')
 assert m._capture is None
print('PASS: stable selection after reordering; duplicates and mid-start device changes rejected')
