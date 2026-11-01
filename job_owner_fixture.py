import os,pathlib,subprocess,sys,time
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_audio_process import ffmpeg_popen_factory
runner=ffmpeg_popen_factory(sys.executable)
p=runner([sys.executable,'-c','import time;time.sleep(60)'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
pathlib.Path(sys.argv[1]).write_text(str(p.pid),encoding='ascii')
while not pathlib.Path(sys.argv[2]).exists():time.sleep(.01)
os._exit(0)
