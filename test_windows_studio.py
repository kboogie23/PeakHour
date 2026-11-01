"""Studio DAW audio jobs on Windows: FFmpeg lookup, child processes, pipe selector and the
prepared-cache file handling, on a generated tone (no user music)."""
import os,sys,pathlib,uuid,threading,subprocess,traceback,wave,struct,math
workspace=pathlib.Path(__file__).resolve().parent
probe=workspace/'axiom-win-probe';home=workspace/'probe-home'
os.environ.update({'USERPROFILE':str(home),'HOME':str(home),'APPDATA':str(home/'AppData/Roaming'),'LOCALAPPDATA':str(home/'AppData/Local'),'AXIOM_RUNTIME_DIR':str(home/'axiom-runtime')})
sys.path.insert(0,str(probe));os.chdir(probe)
try:
 import imageio_ffmpeg;ff=imageio_ffmpeg.get_ffmpeg_exe()
 folder=workspace/'fixtures'/'studio'/uuid.uuid4().hex;folder.mkdir(parents=True)
 tone=folder/'tone.wav'
 with wave.open(str(tone),'wb') as w:
  w.setnchannels(2);w.setsampwidth(2);w.setframerate(44100)
  w.writeframes(b''.join(struct.pack('<hh',int(8000*math.sin(i/20)),0) for i in range(44100*3)))
 from windows_bootstrap import build_backend
 build_backend(recording_settings=folder/'settings.json',recording_directory=folder,video_cache_root=folder,video_allowed_path=lambda p:True,video_ffmpeg=ff)
 import windows_studio,windows_posix
 from studio_daw import runtime,audio_process,source_probe,waveforms,prepared_cache,stems
 # FFmpeg is found before app import, so blueprints built at import see it too
 assert runtime.resolve_audio_tool('ffmpeg')==ff and waveforms.resolve_audio_tool('ffmpeg')==ff
 assert audio_process.Popen is windows_studio.Popen and audio_process.resource_usage()['running'] is False
 try: windows_studio.Popen(['ffmpeg','-version']);raise AssertionError('relative engine accepted')
 except ValueError: pass
 try: windows_studio.Popen([ff,'-i','x'],read_files={2:'y'});raise AssertionError('mismatched read file accepted')
 except ValueError: pass
 # A full decode goes through Popen, the pipe selector and the no-op set_blocking
 result=source_probe.decoded_end(tone,ff,threading.Event(),lambda n:None)
 assert result['status']=='ready' and result['decodedEOF'] and abs(result['durationSec']-3.0)<0.05,result
 cancelled=threading.Event();cancelled.set()
 try: source_probe.decoded_end(tone,ff,cancelled,lambda n:None);raise AssertionError('cancel ignored')
 except InterruptedError: pass
 # The selector reports EOF as readable, so a finished pipe never blocks the loop
 p=subprocess.Popen([sys.executable,'-c','print(1)'],stdout=subprocess.PIPE)
 with windows_studio.PipeSelector() as s:
  s.register(p.stdout,1);assert s.select(5)
 p.stdout.read();p.wait();p.stdout.close()
 # Prepared-cache rules: O_NOFOLLOW, binary descriptors, utime by descriptor, rmtree capability
 cache_os=prepared_cache.os;assert cache_os.O_NOFOLLOW==windows_posix.O_NOFOLLOW
 target=folder/'bin.dat';fd=cache_os.open(target,cache_os.O_CREAT|cache_os.O_WRONLY|cache_os.O_NOFOLLOW,0o600)
 os.write(fd,b'a\nb');cache_os.utime(fd,(1,1));cache_os.close(fd)
 assert target.read_bytes()==b'a\nb' and int(target.stat().st_mtime)==1
 try: cache_os.utime(fd);raise AssertionError('closed descriptor accepted')
 except OSError: pass
 link=folder/'link.dat'
 try: os.symlink(target,link)
 except OSError: link=None  # creating symlinks needs Developer Mode or admin
 if link:
  try: cache_os.open(link,cache_os.O_RDONLY|cache_os.O_NOFOLLOW);raise AssertionError('symlink followed')
  except OSError as e: assert e.errno==40 or 'symbolic' in str(e)
 assert prepared_cache.shutil.rmtree.avoids_symlink_attacks and stems.signal.SIGKILL==9
 print('PASS: Studio DAW audio jobs run on Windows (FFmpeg decode, cancel, pipe EOF, cache file rules)'+('' if link else ' [symlink case skipped]'))
except BaseException:
 traceback.print_exc();sys.exit(1)
