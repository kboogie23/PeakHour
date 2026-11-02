import pathlib,subprocess,sys,tempfile,threading,time
from unittest.mock import patch
import imageio_ffmpeg
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
import windows_video_api as api
ff=imageio_ffmpeg.get_ffmpeg_exe()
def make(path,*extra):
 subprocess.run([ff,'-v','error','-y','-f','lavfi','-i','color=black:s=160x120:r=25','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1',*extra,str(path)],check=True,stdin=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
with tempfile.TemporaryDirectory(dir=root) as d:
 d=pathlib.Path(d);cache=d/'cache';cache.mkdir()
 avi=d/'a.avi';make(avi,'-c:v','mpeg4','-c:a','libmp3lame')
 mp4=d/'b.mp4';make(mp4,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac')
 now=[0.0];store=api.VideoPreviewStore(cache,lambda p:True,ff,idle_seconds=7200,clock=lambda:now[0])
 try:
  # a slow conversion does not block get() or remove() of an existing preview
  first=store.prepare(str(mp4))['id'];assert store.get(first)==mp4.resolve()
  entered=threading.Event();release=threading.Event();real=api.create_video_preview;result={}
  def slow(*a,**k):
   entered.set();assert release.wait(10);return real(*a,**k)
  def convert():result['r']=store.prepare(str(avi))
  with patch.object(api,'create_video_preview',slow):
   t=threading.Thread(target=convert);t.start();assert entered.wait(10)
   begin=time.perf_counter();assert store.get(first)==mp4.resolve();extra=store.prepare(str(mp4))['id'];store.remove(extra)
   assert time.perf_counter()-begin<1,'get/remove/prepare must not wait for a conversion'
   assert len(store._items)==1 and store._preparing==1  # the running conversion owns a reserved slot
   release.set();t.join(30);assert not t.is_alive()
  second=result['r']['id'];assert second in store._items and store._preparing==0
  # a failed conversion frees its slot and its folder
  with patch.object(api,'create_video_preview',side_effect=api.VideoPreviewError('boom')):
   try:store.prepare(str(avi),convert=True)
   except api.VideoPreviewError:pass
   else:raise AssertionError
  assert store._preparing==0 and len(store._items)==2
  # when full, the least recently used preview is closed to make room; running conversions are never evicted
  third=store.prepare(str(mp4))['id'];fourth=store.prepare(str(mp4))['id'];now[0]+=10;store.get(first);store.get(third);store.get(fourth)
  assert len(store._items)==4;fifth=store.prepare(str(mp4))['id']
  assert second not in store._items and len(store._items)==4 and first in store._items  # `second` was the least recently used
  entered.clear();release.clear()
  def hold(*a,**k):
   entered.set();assert release.wait(10);return real(*a,**k)
  with patch.object(api,'create_video_preview',hold):
   t1=threading.Thread(target=lambda:store.prepare(str(avi),convert=True));t1.start();assert entered.wait(10)
   assert len(store._items)==3 and store._preparing==1
   store.prepare(str(mp4));store.prepare(str(mp4));assert len(store._items)==3  # the reserved slot is kept, others are recycled
   release.set();t1.join(30)
  assert len(store._items)==4  # the finished conversion was published
  for k in list(store._items):store.remove(k)
  second=store.prepare(str(avi),convert=True)['id']
  # a delete that fails (Edge still has the file open) does not leak the slot; the folder is removed later
  stuck=pathlib.Path(store._items[second][0].name);real_cleanup=type(store._items[second][0]).cleanup
  failing=[True]
  def locked(self):
   if failing[0]:raise PermissionError('in use')
   return real_cleanup(self)
  with patch.object(type(store._items[second][0]),'cleanup',locked):
   store.remove(second);assert second not in store._items and stuck.exists() and len(store._trash)==1
   try:store.get(second)
   except KeyError:pass
   else:raise AssertionError
   failing[0]=False;store.remove(store.prepare(str(mp4))['id'])
   assert stuck.exists() and len(store._trash)==1  # retries are throttled to one per 30 s
   now[0]+=31;store.remove(store.prepare(str(mp4))['id'])  # next prepare/remove after that retries the queued delete
  assert not stuck.exists() and not store._trash
  # nothing expires early while there is room; very old idle previews do expire
  for k in list(store._items):store.remove(k)
  old=store.prepare(str(avi),convert=True)['id'];folder=pathlib.Path(store._items[old][0].name);keep=store.prepare(str(mp4))['id']
  now[0]+=3600;store.get(keep);assert old in store._items  # an hour idle and still there
  now[0]+=5000;store.get(keep)
  try:store.get(old)
  except KeyError:pass
  else:raise AssertionError('idle preview not expired')
  assert not folder.exists() and store.get(keep)==mp4.resolve()
 finally:store.close()
 assert not list(cache.iterdir()),list(cache.iterdir())
js=(root/'axiom-win-probe'/'static'/'js'/'shared'/'windows-video-preview.js').read_text(encoding='utf-8')
assert "status === 404" in js and "keepalive: true" in js and "'pagehide'" in js  # a closed preview is reported, not re-converted
print('PASS: video store does slow work unlocked, evicts least recently used when full, survives failed deletes and expires very old previews')
