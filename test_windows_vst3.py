"""Studio DAW plugins on Windows: the VST3 worker answers AXIOM's Audio Unit worker protocol (scan,
inspect, render). A stand-in plugin processes through pedalboard's own Gain; AXIOM's plugin endpoint
starts the real worker process against an isolated, empty VST3 folder (no installed plugin is loaded)."""
import os,sys,pathlib,uuid,json,base64,re,traceback
import numpy as np,soundfile as sf
workspace=pathlib.Path(__file__).resolve().parent
probe=workspace/'axiom-win-probe';home=workspace/'probe-home'
folder=workspace/'fixtures'/'vst3'/uuid.uuid4().hex;(folder/'Common'/'VST3'/'Fixture.vst3').mkdir(parents=True)
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(folder/'Local'),
 'CommonProgramFiles':str(folder/'Common'),'AXIOM_VST3_FOLDERS':str(folder/'Common'/'VST3'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime')})
sys.path.insert(0,str(probe));os.chdir(probe)
try:
 import pedalboard,windows_vst3_worker as W
 class Param:
  def __init__(s,name,boolean=False,steps=0,raw=0.5):s.name=name;s.is_boolean=boolean;s.is_discrete=bool(steps);s.num_steps=steps;s.raw_value=raw
  @property
  def string_value(s):return f'{s.raw_value:.2f}'
  def get_text_for_raw_value(s,v):return ['Low','Mid','High'][round(v*2)]
 class Fixture:
  name='Fixture Gain';manufacturer_name='AXIOM Tests';version='1.2.3';is_instrument=False
  def __init__(s):s._parameters=[Param('Gain',raw=0.5),Param('Bypass',boolean=True,raw=0.0),Param('Mode',steps=3,raw=0.0)];s.loaded=None
  @property
  def raw_state(s):return json.dumps([p.raw_value for p in s._parameters]).encode()
  @raw_state.setter
  def raw_state(s,b):
   for p,v in zip(s._parameters,json.loads(b)):p.raw_value=v
  def process(s,audio,rate,reset=True):
   db=-24+48*s._parameters[0].raw_value;return pedalboard.Gain(gain_db=db)(audio,rate)
 bundle=folder/'Bundle.vst3'/'Contents'/'x86_64-win';bundle.mkdir(parents=True);(bundle/'Bundle.vst3').write_bytes(b'x')
 assert W.binary(folder/'Bundle.vst3')==bundle/'Bundle.vst3' and W.binary(bundle/'Bundle.vst3')==bundle/'Bundle.vst3'
 assert W.plugin_folders()==[folder/'Common'/'VST3']  # never the PC's real VST3 folder
 load=lambda path,name:Fixture()
 cat=W.handle({'action':'scan'},load)['plugins']
 assert len(cat)==1 and re.fullmatch(r'61756678-[0-9a-f]{8}-[0-9a-f]{8}',cat[0]['id']) and cat[0]['name']=='Fixture Gain' and cat[0]['version']==0x010203,cat
 assert W.handle({'action':'scan'},load)['plugins']==cat  # stable ids, cached catalog
 ins=W.handle({'action':'inspect','id':cat[0]['id'],'version':cat[0]['version']},load)
 kinds=[(p['name'],p['unitCode']) for p in ins['parameters']];assert kinds==[('Gain',0),('Bypass',2),('Mode',1)],kinds
 assert ins['parameters'][2]['valueStrings']==['Low','Mid','High']
 saved=W.handle({'action':'inspect','id':cat[0]['id'],'version':cat[0]['version'],'state':ins['state'],'parameters':{'0':0.25,'2':2}},load)
 assert [p['value'] for p in saved['parameters']]==[0.25,0,2],saved['parameters']
 R=48000;x=(0.5*np.sin(np.arange(R)/10)).astype(np.float32);sf.write(folder/'in.wav',np.stack([x,x],1),R,subtype='FLOAT')
 out=W.handle({'action':'render','id':cat[0]['id'],'version':cat[0]['version'],'state':saved['state'],'parameters':{'0':0.25},
               'tailSeconds':0.5,'input':str(folder/'in.wav'),'output':str(folder/'out.wav')},load)
 y,sr=sf.read(folder/'out.wav')
 assert out['frames']==R+R//2==len(y) and sr==R and y.shape[1]==2 and abs(np.abs(y).max()-0.5*10**(-12/20))<1e-3,(out,np.abs(y).max())
 # Tempo map -> host tempo: steps and ramps; a render with a tempo the DawDreamer path cannot host falls back to pedalboard
 P=[{'beat':0,'bpm':90,'linear':False},{'beat':64,'bpm':100,'linear':True},{'beat':128,'bpm':120,'linear':False}]
 assert (W.bpm_at(P,10),W.bpm_at(P,96),W.bpm_at(P,200))==(90,110.0,120)
 assert W.tempo_curve({'startBeat':0,'points':[{'beat':0,'bpm':92,'linear':False}]},10)==92.0 and type(W.tempo_curve({'startBeat':0,'points':P[:1]},5)) is float
 curve=W.tempo_curve({'startBeat':60,'points':P},30);assert str(curve.dtype)=='float32' and curve[0]==90 and 115<curve[-1]<120
 out=W.handle({'action':'render','id':cat[0]['id'],'version':cat[0]['version'],'state':saved['state'],'parameters':{'0':0.25},'tailSeconds':0,
               'tempo':{'startBeat':0,'points':P},'input':str(folder/'in.wav'),'output':str(folder/'out2.wav')},load)
 y2,_=sf.read(folder/'out2.wav');assert out['frames']==R and abs(np.abs(y2).max()-0.5*10**(-12/20))<1e-3,(out,np.abs(y2).max())
 try:W.handle({'action':'inspect','id':'61756678-00000000-00000000','version':0},load);raise AssertionError('unknown plugin accepted')
 except RuntimeError:pass
 # AXIOM's endpoint starts the real worker process (pedalboard) through the Windows launcher
 import imageio_ffmpeg;from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder,video_cache_root=folder,video_allowed_path=lambda p:True,video_ffmpeg=imageio_ffmpeg.get_ffmpeg_exe())
 client=app.app.test_client();h={'Host':'127.0.0.1','Origin':'http://127.0.0.1'}
 r=client.post('/api/studio-daw/plugins/scan',json={},headers=h);data=r.get_json()
 assert r.status_code==200 and data=={'plugins':cat},(r.status_code,data)  # the worker process sees the isolated folder's catalog
 print('PASS: VST3 worker speaks AXIOM\'s plugin protocol (stable ids, switch/menu/continuous parameters, state, render with tail at exact length); endpoint runs the real worker')
except BaseException:
 traceback.print_exc();sys.exit(1)
