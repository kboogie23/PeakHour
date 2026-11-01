import hashlib,pathlib,subprocess,sys,tempfile
import imageio_ffmpeg
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_video_scan import install_video_scanning
import scanner
ff=imageio_ffmpeg.get_ffmpeg_exe()
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);music=d/'music';music.mkdir();cache=d/'library.json';files=[]
 specs=[('sample.mp4',['-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac']),('sample.avi',['-c:v','mpeg4','-c:a','libmp3lame']),('sample.vob',['-c:v','mpeg2video','-c:a','ac3','-f','vob'])]
 for name,options in specs:
  file=music/name;subprocess.run([ff,'-v','error','-f','lavfi','-i','color=black:s=160x120:r=25','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1',*options,str(file)],check=True,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW);files.append(file)
 before=[hashlib.sha256(f.read_bytes()).hexdigest() for f in files]
 install_video_scanning(d)
 first=scanner.scan_library(str(music),str(cache));assert len(first['tracks'])==3
 assert all(t.get('duration_sec',0)>0 for t in first['tracks'])
 saved=scanner.load_cache(str(cache));assert all(t.get('duration_sec',0)>0 for t in saved['tracks'])
 assert len(scanner.search_tracks(saved,'sample'))==3
 second=scanner.scan_library(str(music),str(cache));assert {t['axiom_track_id'] for t in first['tracks']}=={t['axiom_track_id'] for t in second['tracks']}
 assert [hashlib.sha256(f.read_bytes()).hexdigest() for f in files]==before
 print('PASS: original library scanner indexes AVI, MP4, VOB with durations, search and stable IDs')
