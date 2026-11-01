"""Fast video preview (windows_video_preview.preview_plan, VideoPreviewStore): H.264 + AAC in MP4 streams
straight from the library (no copy, range requests work, nothing written to the cache); H.264 in AVI keeps the
picture and converts only the sound; MPEG-2 in VOB is converted in full; convert=True forces a conversion (the
page's fallback when Edge cannot play a direct file); sources unchanged."""
import os,sys,pathlib,uuid,shutil,subprocess,traceback,time
workspace=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(workspace/'axiom-win-probe'))
try:
 import imageio_ffmpeg
 from windows_video_preview import preview_plan
 from windows_video_api import VideoPreviewStore,create_video_blueprint
 ff=imageio_ffmpeg.get_ffmpeg_exe()
 base=workspace/'fixtures'/'video-direct'/uuid.uuid4().hex;(base/'lib').mkdir(parents=True);(base/'cache').mkdir()
 def make(name,*codec):
  out=base/'lib'/name
  subprocess.run([ff,'-v','error','-f','lavfi','-i','testsrc=size=320x240:rate=25:duration=3','-f','lavfi','-i','sine=frequency=440:duration=3',*codec,'-shortest',str(out)],check=True)
  return out
 mp4=make('direct.mp4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac')
 avi=make('copy.avi','-c:v','libx264','-pix_fmt','yuv420p','-c:a','mp3')
 vob=make('convert.vob','-c:v','mpeg2video','-c:a','mp2','-f','vob')
 hi=make('tenbit.mp4','-c:v','libx264','-pix_fmt','yuv444p','-c:a','aac')
 before={p.name:p.read_bytes() for p in (base/'lib').iterdir()}
 assert preview_plan({'streams':[{'type':'video','codec':'h264','pix_fmt':'yuv420p'},{'type':'audio','codec':'aac'}]},'.MP4')=='direct'
 assert preview_plan({'streams':[{'type':'video','codec':'h264','pix_fmt':'yuv420p'},{'type':'audio','codec':'ac3'}]},'.mp4')=='copy'
 assert preview_plan({'streams':[{'type':'video','codec':'hevc','pix_fmt':'yuv420p'}]},'.mp4')=='convert'
 store=VideoPreviewStore(base/'cache',lambda p:True,ff)
 modes={}
 for path in (mp4,avi,vob,hi):
  t=time.time();r=store.prepare(str(path));modes[path.name]=(r['mode'],round(time.time()-t,2),r['audio'])
  assert store.get(r['id']).is_file()
  if r['mode']=='direct':
   assert store.get(r['id'])==path.resolve() and not list((base/'cache').iterdir())  # nothing copied
  store.remove(r['id'])
 assert modes['direct.mp4'][0]=='direct' and modes['copy.avi'][0]=='copy' and modes['convert.vob'][0]=='convert' and modes['tenbit.mp4'][0]=='convert',modes  # 4:4:4 H.264 does not play in Edge: full conversion
 assert all(m[2] for m in modes.values())
 forced=store.prepare(str(mp4),convert=True);assert forced['mode']=='convert' and store.get(forced['id'])!=mp4.resolve();store.remove(forced['id'])
 # Direct files stream with range requests through the endpoint
 from flask import Flask
 web=Flask('v');web.register_blueprint(create_video_blueprint(store));c=web.test_client()
 h={'Origin':'http://localhost'}
 r=c.post('/api/windows/video/prepare',json={'path':str(mp4)},headers=h,base_url='http://localhost').get_json()
 assert r['success'] and r['mode']=='direct'
 part=c.get(f"/api/windows/video/{r['id']}",headers={'Range':'bytes=0-99'},base_url='http://localhost')
 assert part.status_code==206 and len(part.data)==100 and part.data==mp4.read_bytes()[:100]
 r2=c.post('/api/windows/video/prepare',json={'path':str(mp4),'convert':True},headers=h,base_url='http://localhost').get_json()
 assert r2['mode']=='convert'
 for k in (r['id'],r2['id']):assert c.delete(f'/api/windows/video/{k}',headers=h,base_url='http://localhost').get_json()['success']
 assert mp4.exists() and before=={p.name:p.read_bytes() for p in (base/'lib').iterdir()}  # sources untouched
 print('modes',modes)
 shutil.rmtree(base,ignore_errors=True)
 print('PASS: ready-to-play videos stream directly, others keep the picture or convert, forced conversion works, sources unchanged')
except BaseException:
 traceback.print_exc();sys.exit(1)
