"""A REAL VST3 effect through PEAK HOUR's VST3 worker and AXIOM's plugin endpoint.
Uses Dragonfly Reverb 3.2.10 (GPL-3, github.com/michaelwillis/dragonfly-reverb, win64 zip) extracted to
fixtures/vst3-plugins. Windows' VST3 folder is replaced by an isolated copy holding only those plug-ins,
so nothing installed on this PC is loaded. Not part of the test suite (needs the download).
Usage: python check_vst3_real_plugin.py"""
import os,sys,pathlib,uuid,shutil,json,traceback
import numpy as np,soundfile as sf
workspace=pathlib.Path(__file__).resolve().parent
probe=workspace/'axiom-win-probe';home=workspace/'probe-home';plugins=workspace/'fixtures'/'vst3-plugins'
folder=workspace/'fixtures'/'vst3-real'/uuid.uuid4().hex
shutil.copytree(plugins,folder/'Common'/'VST3')
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(folder/'Local'),
 'CommonProgramFiles':str(folder/'Common'),'AXIOM_VST3_FOLDERS':str(folder/'Common'/'VST3'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime')})
sys.path.insert(0,str(probe));os.chdir(probe)
try:
 import windows_vst3_worker as W
 catalog=W.handle({'action':'scan'})['plugins']
 print('scan:',[(p['name'],p['manufacturer'],p['version']) for p in catalog])
 assert len(catalog)==4 and all('Dragonfly' in p['name'] for p in catalog),catalog
 hall=next(p for p in catalog if 'Hall' in p['name'])
 ins=W.handle({'action':'inspect','id':hall['id'],'version':hall['version']})
 print('Hall Reverb controls:',len(ins['parameters']),[(p['name'],p.get('displayValue')) for p in ins['parameters'][:8]])
 # A short drum-like hit, then silence: a reverb leaves a tail where the dry clip is silent.
 R=48000;n=R;x=np.zeros(n,np.float32);t=np.arange(2400)/R
 x[:2400]=(0.8*np.sin(2*np.pi*120*t)*np.exp(-t*40)).astype(np.float32)
 sf.write(folder/'in.wav',np.stack([x,x],1),R,subtype='FLOAT')
 out=W.handle({'action':'render','id':hall['id'],'version':hall['version'],'state':ins['state'],'tailSeconds':2.0,
               'input':str(folder/'in.wav'),'output':str(folder/'out.wav')})
 y,sr=sf.read(folder/'out.wav')
 dry_tail=float(np.sqrt(np.mean(x[R//4:]**2)));wet_tail=float(np.sqrt(np.mean(y[R//4:]**2)))
 print('render: %d frames (%.2f s), peak %.3f, tail level dry %.6f -> wet %.6f'%(out['frames'],out['frames']/R,np.abs(y).max(),dry_tail,wet_tail))
 assert out['frames']==3*R and sr==R and y.shape[1]==2 and np.isfinite(y).all()
 assert dry_tail==0 and wet_tail>1e-4,'no reverb tail'
 # With the DAW's tempo map the clip renders through DawDreamer (the effect gets the song's BPM)
 import dawdreamer
 used=[];real_render=W.render_with_tempo;W.render_with_tempo=lambda *args:(used.append(1),real_render(*args))[1]
 out=W.handle({'action':'render','id':hall['id'],'version':hall['version'],'state':ins['state'],'tailSeconds':2.0,
               'tempo':{'startBeat':0,'points':[{'beat':0,'bpm':92,'linear':False}]},'input':str(folder/'in.wav'),'output':str(folder/'tempo.wav')})
 W.render_with_tempo=real_render;yt,_=sf.read(folder/'tempo.wav');tempo_tail=float(np.sqrt(np.mean(yt[R//4:]**2)))
 print('render with tempo 92 BPM: DawDreamer used',bool(used),'tail level %.6f (pedalboard %.6f)'%(tempo_tail,wet_tail))
 assert used and out['frames']==3*R and abs(tempo_tail-wet_tail)<0.25*wet_tail
 # AXIOM's own endpoint: starts the worker process, which finds the same four effects
 import imageio_ffmpeg;from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder,video_cache_root=folder,
                   video_allowed_path=lambda p:True,video_ffmpeg=imageio_ffmpeg.get_ffmpeg_exe())
 client=app.app.test_client();h={'Host':'127.0.0.1','Origin':'http://127.0.0.1'}
 r=client.post('/api/studio-daw/plugins/scan',json={},headers=h);data=r.get_json()
 print('endpoint scan:',r.status_code,[p['name'] for p in data.get('plugins',[])] or data)
 assert r.status_code==200 and sorted(p['id'] for p in data['plugins'])==sorted(p['id'] for p in catalog)
 shutil.rmtree(folder,ignore_errors=True)  # the loaded plug-in file stays locked until this process ends
 print('PASS: Dragonfly Reverb (real VST3) scans, shows its controls, renders a reverb tail, and appears through AXIOM\'s endpoint')
except BaseException:
 traceback.print_exc();sys.exit(1)
