"""Runs AXIOM's Beatgrid Doctor engine on VirtualDJ grids from a COPY of a VirtualDJ database (read-only).
Usage: python probe_vdj_grid.py home|E COUNT"""
import os,sys,pathlib,json,time
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
import app,djay_beatgrid_publisher as D
from windows_virtualdj_database import read_database
from utils.beatgrid_engine import BeatgridEngine
eng=BeatgridEngine(app)
inv=read_database(workspace/'fixtures'/'vdj-copy'/sys.argv[1]/'database.xml')
n=0
for t in inv['tracks']:
  if not os.path.isfile(t['path']) or not t['path'].lower().endswith('.mp3'):continue
  scan=(t['source_sections'].get('Scan') or [{}])[0].get('attributes',{});spb=float(scan.get('Bpm',0) or 0)
  grid=[float(p['attributes']['Pos']) for p in t['source_sections'].get('Poi',[]) if p['attributes'].get('Type')=='beatgrid']
  if not spb or not grid:continue
  dur=app._beatgrid_doctor_audio_duration_seconds(t['path']);first=min(grid)
  while first<0:first+=spb
  beats=int((dur-first)/spb)
  times,fdb=D._expanded_beat_times({'beat_anchors':[{'beat':0,'seconds':first},{'beat':beats,'seconds':first+beats*spb}]})
  track={'path':t['path'],'cues':[],'edits':{},'analysis':{'variants':{'detected':{'times':times,'firstDownBeatIndex':fdb}}},'djay_bpm':60/spb}
  t0=time.time();r=eng.audit(track)
  extra={k:v for k,v in r.items() if k not in ('grid','analysis','path','cues','plan','issues','status')}
  print(round(60/spb,2),os.path.basename(t['path'])[:45],'->',r.get('status'),[i if isinstance(i,str) else i.get('code',i) for i in (r.get('issues') or [])][:4],'%.1fs'%(time.time()-t0))
  print('    ',json.dumps(extra,default=str)[:500])
  n+=1
  if n>=int(sys.argv[2]):break
