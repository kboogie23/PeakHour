"""First click on an MP4 starts at once: a ready-to-play container is published without inspecting it first (no helper
process, which took 0.7-5 s and far longer on a busy PC); the page asks /plan afterwards and swaps to a copy/conversion
only if the file needs one. Inspection answers are remembered per unchanged file. The page no longer waits for the
sound player stop before starting the picture, reports a refused autoplay, and retries a dropped connection once."""
import os,sys,pathlib,tempfile,shutil,subprocess,traceback,time
base=None
from unittest.mock import patch
workspace=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(workspace/'axiom-win-probe'))
try:
 import imageio_ffmpeg
 import windows_video_api as api
 from windows_video_api import VideoPreviewStore,create_video_blueprint
 ff=imageio_ffmpeg.get_ffmpeg_exe()
 base=pathlib.Path(tempfile.mkdtemp(prefix='ph-fast-'));(base/'lib').mkdir();(base/'cache').mkdir()
 def make(name,*codec):
  out=base/'lib'/name
  subprocess.run([ff,'-v','error','-f','lavfi','-i','testsrc=size=320x240:rate=25:duration=3','-f','lavfi','-i','sine=frequency=440:duration=3',*codec,'-shortest',str(out)],check=True)
  return out
 mp4=make('direct.mp4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac')
 ac3=make('ac3.mp4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','ac3')
 hevc=make('hevc.mp4','-c:v','libx265','-pix_fmt','yuv420p','-c:a','aac')
 avi=make('copy.avi','-c:v','libx264','-pix_fmt','yuv420p','-c:a','mp3')
 store=VideoPreviewStore(base/'cache',lambda p:True,ff)
 calls=[];real=api.probe_media
 def counting(*a,**k):calls.append(a[0]);return real(*a,**k)
 with patch.object(api,'probe_media',counting):
  # 1. fast prepare of an MP4: published at once, nothing inspected, nothing copied
  t=time.perf_counter();r=store.prepare(str(mp4),fast=True);took=time.perf_counter()-t
  assert r['mode']=='direct' and r['verified'] is False and not calls and store.get(r['id'])==mp4.resolve() and took<5,(r,calls,took)  # the point is no inspection (calls is empty), not the clock
  assert not list((base/'cache').iterdir())
  # 2. the background check inspects it (once), says what the file needs, and remembers the answer
  assert store.plan(r['id'])['plan']=='direct' and len(calls)==1
  assert store.plan(r['id'])['plan']=='direct' and len(calls)==1,'second look must come from memory'
  r2=store.prepare(str(mp4));assert r2['mode']=='direct' and len(calls)==1,'normal prepare reuses the remembered inspection';store.remove(r2['id'])
  store.remove(r['id'])
  # 3. a file that needs work is found by plan(), then prepared the normal way
  r=store.prepare(str(ac3),fast=True);assert r['mode']=='direct' and store.plan(r['id'])['plan']=='copy';store.remove(r['id'])
  assert store.plan(store.prepare(str(mp4),fast=True)['id'])['audio_ok'] is True and store.plan(store.prepare(str(ac3),fast=True)['id'])['audio_ok'] is False
  r=store.prepare(str(hevc),fast=True);p=store.plan(r['id']);assert r['mode']=='direct' and p['plan']=='convert' and p['audio_ok'] is True;store.remove(r['id'])
  slow=store.prepare(str(ac3));assert slow['mode']=='copy' and 'verified' not in slow;store.remove(slow['id'])
  # 4. fast never skips inspection for containers Edge cannot play directly, and convert=True still converts
  before=len(calls);r=store.prepare(str(avi),fast=True);assert r['mode']=='copy' and len(calls)>before;store.remove(r['id'])
  r=store.prepare(str(mp4),convert=True,fast=True);assert r['mode']=='convert';store.remove(r['id'])
  # 5. a changed file is inspected again
  copy=base/'lib'/'copy_of_direct.mp4';shutil.copy(mp4,copy);n=len(calls);store.remove(store.prepare(str(copy))['id']);assert len(calls)==n+1
  os.utime(copy,(time.time()+50,time.time()+50));store.remove(store.prepare(str(copy))['id']);assert len(calls)>=n+2
 # 6. the HTTP side: fast prepare, /plan, range requests, unknown ids
 from flask import Flask
 web=Flask('v');web.register_blueprint(create_video_blueprint(store));c=web.test_client()
 h={'Origin':'http://localhost'};kw=dict(headers=h,base_url='http://localhost')
 r=c.post('/api/windows/video/prepare',json={'path':str(mp4),'fast':True},**kw).get_json()
 assert r['success'] and r['mode']=='direct' and r['verified'] is False
 plan=c.get(f"/api/windows/video/{r['id']}/plan",**kw);assert plan.status_code==200 and plan.get_json()['plan']=='direct' and plan.get_json()['audio'] is True
 part=c.get(f"/api/windows/video/{r['id']}",headers={'Range':'bytes=0-99'},base_url='http://localhost')
 assert part.status_code==206 and part.headers['Accept-Ranges']=='bytes' and part.headers['Content-Type']=='video/mp4' and len(part.data)==100
 assert c.get('/api/windows/video/'+'0'*32+'/plan',**kw).status_code==404
 assert c.get('/api/windows/video/capabilities',**kw).get_json()['video_preview'] is True
 assert c.delete(f"/api/windows/video/{r['id']}",**kw).get_json()['success']
 store.close()
 # 7. the page
 root=workspace/'axiom-win-probe'
 js=(root/'static'/'js'/'shared'/'windows-video-preview.js').read_text(encoding='utf-8')
 assert "fast" in js and "/plan" in js and "checkPlan" in js
 assert "await stopAxiomAudioPlayback" not in js,'the picture must not wait for the sound player to stop'
 assert "Press play to begin." in js and "player.error.code === 2" in js
 html=(root/'templates'/'index.html').read_text(encoding='utf-8')
 assert 'windows-video-preview.js?v=6' in html
 # the outcome of play() is judged by the player's state, never by an AbortError name; unmute waits for play() to settle
 assert "error.name" not in js and "mine !== showSeq" in js and "function checkStart(" in js and "Click for sound" in js and "playPending" in js
 # a picture Edge cannot decode is detected (no error event: it drops the video track), once per open, resuming in place
 assert "watchPicture" in js and "player.videoWidth === 0" in js and "totalVideoFrames === 0" in js
 assert "swapped === token" in js and "function swap(" in js and js.count("swap(path, true, token)")>=3 and "resume" in js
 assert "show(path, true, token)" not in js,'only swap() may start a second conversion'
 assert "player.muted = true" in js and "player.muted = userMuted" in js and "player.muted = false;" not in js.replace("userMuted = false; }","") and "setTimeout(unmute, 1500)" in js and "stopped.then(unmute)" in js
 print('PASS: MP4 starts without inspection, plan check and remembered inspections work, /plan and range requests answer, page does not wait for the sound player')
except BaseException:
 traceback.print_exc();sys.exit(1)
finally:
 if base is not None:shutil.rmtree(base,ignore_errors=True)
