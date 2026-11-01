import pathlib,sys,subprocess
import imageio_ffmpeg
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
from windows_audio_process import ffmpeg_popen_factory
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe();runner=ffmpeg_popen_factory(ffmpeg)
p=runner([ffmpeg,'-v','error','-re','-f','lavfi','-i','anullsrc','-t','60','-f','null','-'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 assert p.poll() is None
 p.kill();p.wait(timeout=10);assert p.poll() is not None
finally:
 if p.poll() is None:p.kill();p.wait(timeout=10)
try:runner([ffmpeg,'-version'],read_files={1:'file'})
except NotImplementedError:pass
else:raise AssertionError('unsupported descriptor access silently accepted')
print('PASS: Windows FFmpeg process stops and unsupported descriptor access is rejected')
