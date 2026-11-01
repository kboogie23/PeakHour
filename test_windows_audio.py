import pathlib,sys,time,wave
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
from windows_audio import WindowsAudioDeck
p=pathlib.Path(__file__).resolve().parent/'fixtures'/'silent.wav'
p.parent.mkdir(exist_ok=True)
with wave.open(str(p),'wb') as w: w.setparams((2,2,44100,0,'NONE','not compressed')); w.writeframes(b'\0'*(44100*2*2*2))
d=WindowsAudioDeck()
try:
 s=d.play(str(p),title='Silent test'); assert s['has_track'] and s['playing'] and abs(s['duration']-2)<0.01
 time.sleep(.2); assert d.pause()['playing'] is False
 assert abs(d.seek(1.4)['current_time']-1.4)<0.02
 assert d.set_volume(.2)['volume']==.2
 assert d.resume()['playing']; time.sleep(1)
 assert d.status()['ended'] and not d.status()['playing']
 assert not d.stop()['has_track']
 print('PASS: Windows output stream play, pause, seek, volume, resume, completion and stop with silent WAV')
finally: d.stop()
