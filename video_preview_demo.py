import os,pathlib,sys
from flask import Flask,render_template_string
import imageio_ffmpeg
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_video_api import VideoPreviewStore,create_video_blueprint
fixture=(root/'fixtures/video-preview-test.avi').resolve();cache=root/'fixtures/video-preview-cache';cache.mkdir(exist_ok=True)
store=VideoPreviewStore(cache,lambda p:p==fixture,imageio_ffmpeg.get_ffmpeg_exe())
app=Flask(__name__);app.register_blueprint(create_video_blueprint(store))
@app.get('/')
def home():
 return render_template_string('''<!doctype html><title>AXIOM video preview test</title><h1>Video preview test</h1><button id="prepare">Prepare fixture</button><p id="state">Ready</p><video id="preview" controls width="480"></video><script>document.querySelector('#prepare').onclick=async()=>{const status=document.querySelector('#state');status.textContent='Preparing';try{const r=await fetch('/api/windows/video/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:{{ path|tojson }}})});const j=await r.json();if(!r.ok)throw new Error(j.error);const v=document.querySelector('#preview');v.src='/api/windows/video/'+j.id;v.onloadedmetadata=()=>{status.textContent='Preview ready '+v.videoWidth+'x'+v.videoHeight};v.onerror=()=>{status.textContent='Video playback failed'};}catch(e){status.textContent='Error: '+e.message}};</script>''',path=str(fixture))
if __name__=='__main__':
 try:app.run(host='127.0.0.1',port=48766,debug=False,use_reloader=False)
 finally:store.close()
