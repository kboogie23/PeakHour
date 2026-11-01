import pathlib,subprocess,sys,tempfile
from flask import Flask
import imageio_ffmpeg
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_video_api import VideoPreviewStore,create_video_blueprint
ff=imageio_ffmpeg.get_ffmpeg_exe()
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);source=d/'sample.avi';cache=d/'cache';cache.mkdir()
 subprocess.run([ff,'-v','error','-f','lavfi','-i','color=black:s=160x120:r=25','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1','-c:v','mpeg4','-c:a','libmp3lame',str(source)],check=True,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
 broken=d/'bad.avi';broken.write_bytes(b'not video')
 store=VideoPreviewStore(cache,lambda p:p in (source,broken),ff);app=Flask(__name__);app.register_blueprint(create_video_blueprint(store));c=app.test_client();h={'Origin':'http://localhost'}
 try:
  assert c.post('/api/windows/video/prepare',json={'path':str(source)},headers={'Origin':'http://example.com'}).status_code==403
  assert c.post('/api/windows/video/prepare',json={'path':str(source)}).status_code==403
  assert c.post('/api/windows/video/prepare',json={'path':str(broken)},headers=h).status_code==400
  r=c.post('/api/windows/video/prepare',json={'path':str(source)},headers=h);assert r.status_code==200,r.json
  key=r.json['id'];r=c.get('/api/windows/video/'+key,headers={'Range':'bytes=0-31'});assert r.status_code==206 and len(r.data)==32 and b'ftyp' in r.data;r.close()
  assert c.get('/api/windows/video/'+'0'*32).status_code==404
  assert c.delete('/api/windows/video/'+key,headers=h).status_code==200
  assert c.get('/api/windows/video/'+key).status_code==404
 finally:store.close()
 print('PASS: local preview API, cross-origin rejection, MP4 range serving and cleanup')
