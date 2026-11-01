"""Child process for bounded metadata inspection of one local media file."""
import json,sys
import av

def inspect(path):
 with av.open(path,mode='r',options={'protocol_whitelist':'file'}) as container:
  streams=[]
  for stream in container.streams:
   if stream.type not in ('audio','video'):continue
   if len(streams)>=64:raise ValueError('Too many media streams')
   c=stream.codec_context
   item={'index':stream.index,'type':stream.type,'codec':c.name}
   if stream.type=='video':item.update(width=c.width,height=c.height,pix_fmt=getattr(c.format,'name',None) if c.format else None)
   else:item.update(sample_rate=c.sample_rate,channels=c.channels)
   streams.append(item)
  duration=container.duration/av.time_base if container.duration is not None else None
  return {'container':container.format.name,'duration_seconds':duration,'streams':streams}
if __name__=='__main__':
 try:
  if len(sys.argv)!=2:raise ValueError('Expected one media file')
  print(json.dumps({'success':True,'media':inspect(sys.argv[1])},allow_nan=False,separators=(',',':')))
 except Exception as exc:
  print(json.dumps({'success':False,'error':str(exc)[:500]},separators=(',',':')));sys.exit(1)
