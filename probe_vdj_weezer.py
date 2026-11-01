import os,sys,pathlib,json
sys.argv=['x','home','0']
__file__=str(pathlib.Path("probe_vdj_grid.py").resolve());exec(open("probe_vdj_grid.py",encoding="utf-8").read().split("n=0")[0])
for t in inv['tracks']:
  if 'Weezer' in t['path']:
    scan=(t['source_sections'].get('Scan') or [{}])[0].get('attributes',{});spb=float(scan.get('Bpm') or 0)
    if not spb: continue
    grid=[float(p['attributes']['Pos']) for p in t['source_sections'].get('Poi',[]) if p['attributes'].get('Type')=='beatgrid']
    dur=app._beatgrid_doctor_audio_duration_seconds(t['path']);first=min(grid);beats=int((dur-first)/spb)
    times,fdb=D._expanded_beat_times({'beat_anchors':[{'beat':0,'seconds':first},{'beat':beats,'seconds':first+beats*spb}]})
    r=eng.audit({'path':t['path'],'cues':[],'edits':{},'analysis':{'variants':{'detected':{'times':times,'firstDownBeatIndex':fdb}}},'djay_bpm':60/spb})
    print('scan',scan,'grid',grid)
    print(json.dumps({k:v for k,v in r.items() if k not in ('analysis',)},default=str)[:3500])
