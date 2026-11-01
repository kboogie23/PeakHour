import pathlib,sys
from flask import Flask
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
from studio_daw.midi import MidiInputBridge,create_midi_blueprint
class FakeMidi:
 def __init__(self):self.callback=None;self.opened=False;self.ports=['Fixture MIDI controller']
 def ignore_types(self,**kwargs):pass
 def get_ports(self):return self.ports[:]
 def open_port(self,index,name):assert index==0;self.opened=True
 def is_port_open(self):return self.opened
 def set_callback(self,cb):self.callback=cb
 def close_port(self):self.opened=False
fake=FakeMidi();bridge=MidiInputBridge(factory=lambda:fake,watchdog=False)
app=Flask(__name__);app.register_blueprint(create_midi_blueprint(bridge));c=app.test_client(); c.environ_base['HTTP_ORIGIN']='http://localhost'
try:
 r=c.post('/api/studio-daw/midi/connect',json={});assert r.status_code==200
 token=r.json['token'];port=r.json['inputs'][0]['id'];h={'Authorization':'Bearer '+token}
 r=c.post('/api/studio-daw/midi/open',json={'id':port},headers=h);assert r.status_code==200
 fake.callback(([0x90,60,100],0.0),None);fake.callback(([0x80,60,0],0.0),None)
 r=c.post('/api/studio-daw/midi/poll',json={},headers=h);assert r.status_code==200
 events=r.json['events'];assert [e['data'] for e in events]==[[144,60,100],[128,60,0]]
 assert c.post('/api/studio-daw/midi/poll',json={},headers={'Authorization':'Bearer invalid'}).status_code==403
 r=c.post('/api/studio-daw/midi/stop',json={},headers=h);assert r.status_code==200 and not fake.opened
 r=c.post('/api/studio-daw/midi/close',json={},headers=h);assert r.status_code==200
 fake.ports=['Duplicate','Duplicate']
 r=c.post('/api/studio-daw/midi/connect',json={});assert r.status_code==200
 h={'Authorization':'Bearer '+r.json['token']}; port=r.json['inputs'][0]['id']
 assert c.post('/api/studio-daw/midi/open',json={'id':port},headers=h).status_code==409
 print('PASS: MIDI routes, note events, authorization, duplicate-device rejection and stop')
finally:bridge.close()

