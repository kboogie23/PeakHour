import hashlib,os,pathlib,subprocess,sys,tempfile,wave
import numpy as np
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_wav_recovery import recover_pcm16_partial,RecoveryError
from windows_recording import WindowsRecordingManager
import json
with tempfile.TemporaryDirectory(dir=root) as d:
 target=pathlib.Path(d)/'take.wav';partial=target.with_name(target.name+'.partial');recovered=pathlib.Path(d)/'recovered.wav'
 subprocess.run([sys.executable,str(root/'crash_capture_fixture.py'),str(target)],check=True,timeout=15)
 assert partial.exists() and not target.exists();before=hashlib.sha256(partial.read_bytes()).hexdigest()
 manager=WindowsRecordingManager(str(pathlib.Path(d)/'settings.json'),d)
 pathlib.Path(manager.state_path).write_text(json.dumps({'status':'recording','output_path':str(target),'temp_wav_path':str(partial)}),encoding='utf8')
 manager=WindowsRecordingManager(str(pathlib.Path(d)/'settings.json'),d)
 r=manager.recover_interrupted(str(recovered))
 assert hashlib.sha256(partial.read_bytes()).hexdigest()==before
 with wave.open(str(recovered),'rb') as f:
  assert f.getnchannels()==2 and f.getframerate()==8000 and f.getnframes()==r['frames'] and r['frames']>0
  pcm=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2');assert (pcm==8191).all()
 try:recover_pcm16_partial(partial,recovered)
 except RecoveryError:pass
 else:raise AssertionError('existing destination overwritten')
 invalid=pathlib.Path(d)/'invalid';invalid.write_bytes(b'bad');dest=pathlib.Path(d)/'invalid.wav'
 try:recover_pcm16_partial(invalid,dest)
 except RecoveryError:pass
 else:raise AssertionError('invalid format accepted')
 assert not dest.exists() and invalid.read_bytes()==b'bad'
 print('PASS: real child-process termination; recovered playable PCM and preserved original partial')
