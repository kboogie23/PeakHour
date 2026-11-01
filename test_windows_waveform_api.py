import hashlib,io,pathlib,sys,tempfile,wave
from flask import Flask
import imageio_ffmpeg
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
from windows_audio_process import ffmpeg_popen_factory
from studio_daw import waveforms
with tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).resolve().parent) as d:
 root=pathlib.Path(d);source=root/'input.wav';cache=root/'cache'
 with wave.open(str(source),'wb') as w:w.setparams((1,2,44100,0,'NONE','not compressed'));w.writeframes(bytes(44100*2))
 digest=hashlib.sha256(source.read_bytes()).hexdigest(); ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
 old=waveforms.subprocess.Popen;waveforms.subprocess.Popen=ffmpeg_popen_factory(ffmpeg)
 try:
  app=Flask(__name__);app.register_blueprint(waveforms.create_waveform_blueprint(allowed_path=lambda p: pathlib.Path(p)==source,root=cache,ffmpeg=ffmpeg));c=app.test_client();h={'Origin':'http://localhost'}
  r=c.post('/api/studio-daw/waveform',json={'path':str(source)},headers=h);assert r.status_code==200,(r.status_code,r.json)
  with wave.open(io.BytesIO(r.data),'rb') as w:assert w.getnchannels()==2 and w.getnframes()>0
  r2=c.post('/api/studio-daw/waveform',json={'path':str(source)},headers=h);assert r2.status_code==200 and r.data==r2.data
  assert c.post('/api/studio-daw/waveform',json={'path':str(source)},headers={'Origin':'http://example.com'}).status_code==403
  assert c.post('/api/studio-daw/waveform',json={'path':str(root/'missing.wav')},headers=h).status_code==400
  r.close();r2.close()
  assert hashlib.sha256(source.read_bytes()).hexdigest()==digest
 finally:waveforms.subprocess.Popen=old
 print('PASS: original waveform API, FFmpeg decode, cache, local-origin gate and unchanged source')
