"""DJ Software Audio on Windows: AXIOM records one program's own output through process loopback.
A helper process stands in for the DJ program and plays a quiet 440 Hz tone; nothing else is captured."""
import pathlib,sys,subprocess,tempfile,time,traceback
import numpy as np,soundfile as sf
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
TONE='import numpy as np,sounddevice as sd,time\ntime.sleep(0.3)\nt=np.arange(48000*4)/48000\nsd.play((0.02*np.sin(2*np.pi*440*t)).astype(np.float32),48000);sd.wait()'
try:
 import windows_loopback as L
 from windows_recording import WindowsRecordingManager
 fake=[(10,1,'explorer.exe'),(20,10,'Serato DJ Pro.exe'),(21,20,'Serato DJ Pro.exe'),(30,10,'VirtualDJ.exe')]
 assert L.running_applications(lambda:fake)==[{'name':'Serato DJ Pro','bundle_id':'serato dj pro.exe','pid':20,'provider':'serato'},{'name':'VirtualDJ','bundle_id':'virtualdj.exe','pid':30,'provider':'virtualdj'}]
 player=subprocess.Popen([sys.executable,'-c',TONE])
 try:
  apps=lambda:[{'name':'Serato DJ Pro','bundle_id':'serato dj pro.exe','pid':player.pid,'provider':'serato'}]
  with tempfile.TemporaryDirectory(dir=root) as d:
   d=pathlib.Path(d);m=WindowsRecordingManager(str(d/'settings.json'),str(d),app_query=apps,device_query=lambda:[],host_query=lambda:[])
   m.save_settings({'provider':'serato','source_mode':'application','application_bundle_id':'serato dj pro.exe','format':'wav'})
   src=m.sources(provider='serato')
   assert src['ready'] and src['selected_source_id']=='serato dj pro.exe' and src['applications']==[{'name':'Serato DJ Pro','bundle_id':'serato dj pro.exe'}],src
   test=m.test_input(provider='serato',source_mode='application',source_id='serato dj pro.exe')
   assert test['success'] and test['signal']['signal']!='none' and -40<test['signal']['dbfs']<-30,test
   m.start(provider='serato',source_mode='application',source_id='serato dj pro.exe');time.sleep(0.7)
   assert m.status()['recording'] and m.status()['engine']=='windows-process-loopback'
   st=m.stop();x,sr=sf.read(st['saved_path'])
   spec=np.abs(np.fft.rfft(x[:,0]*np.hanning(len(x))))
   assert sr==48000 and 0.5<len(x)/sr<1.2 and abs(np.argmax(spec)*sr/len(x)-440)<3 and 0.015<np.abs(x).max()<0.025,(len(x),np.abs(x).max())
   try:m.start(provider='djay',source_mode='application',source_id='djay.exe');raise AssertionError('closed program recorded')
   except RuntimeError as e:assert 'Open djay Pro' in str(e),e
 finally:
  player.wait(10)
 print('PASS: DJ Software Audio lists open DJ programs, tests and records one program\'s own output (440 Hz at -34 dBFS, real time)')
except BaseException:
 traceback.print_exc();sys.exit(1)
