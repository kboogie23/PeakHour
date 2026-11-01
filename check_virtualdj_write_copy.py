"""Write-back on COPIES of the real VirtualDJ databases (the real ones are only read).
Sources are real: Serato/djay cues and play counts, plus a 10-song grid check run against the copies.
Usage: python check_virtualdj_write_copy.py"""
import os,sys,pathlib,json,uuid,shutil,hashlib,time,traceback
# The probe startup points LOCALAPPDATA at a stand-in home, so find the real databases first.
real=[pathlib.Path(os.environ['LOCALAPPDATA'],'VirtualDJ','database.xml')]+[pathlib.Path(d+':/','VirtualDJ','database.xml') for d in 'CDEFGHIJ']
real=[p for p in dict.fromkeys(real) if p.is_file()]
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
try:
 from windows_virtualdj_library import database_paths
 from windows_virtualdj_grids import VirtualDJGridCheck
 import windows_virtualdj_write as W
 assert real,'no VirtualDJ database';print('databases',[str(p) for p in real])
 before={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in real}
 folder=workspace/'fixtures'/'vdj-write-copy'/uuid.uuid4().hex;copies=[]
 for n,p in enumerate(real):
  c=folder/f'db{n}'/'database.xml';c.parent.mkdir(parents=True);shutil.copy2(p,c);copies.append(c)
 from windows_bootstrap import build_backend
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 grids=VirtualDJGridCheck(app,folder/'grid_check.json',databases=lambda:copies)
 grids.start('test')
 while grids.snapshot()['status']=='running':time.sleep(1)
 snap=grids.snapshot(include_results=True)
 print('grid check:',snap['counts'],'repairs with a grid to write:',sum(1 for r in snap['results'] if r.get('repair_grid')))
 app.WINDOWS_VIRTUALDJ_GRIDS=grids
 writer=W.VirtualDJWriter(app,folder/'writes',databases=lambda:copies,ensure_closed=lambda:None)
 t=time.time();p=writer.preview(list(W.KINDS))
 print('preview %.1fs'%(time.time()-t),p['counts'],'songs',p['songs'],'skipped',p['skipped_count'])
 for row in p['rows'][:6]:print('  ',row['artist'][:20],'-',row['title'][:30],[{k:v for k,v in c.items() if k in('kind','num','seconds','source','before','after')} for c in row['changes']])
 for x in p['skipped'][:4]:print('  skip',pathlib.Path(x['path']).name[:40],x['reasons'])
 r=writer.apply(list(W.KINDS),p['preview_token'])
 print('written',r['written'],'undo available',r['undo']['available'])
 again=writer.preview(list(W.KINDS));print('second preview',again['counts'])
 u=writer.undo();assert all(hashlib.sha256(c.read_bytes()).hexdigest()==hashlib.sha256(pathlib.Path(rp).read_bytes()).hexdigest() for c,rp in zip(copies,real)),'undo mismatch'
 print('undo restored the copies byte for byte')
 after={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in real}
 assert before==after,'REAL DATABASE CHANGED';print('real VirtualDJ databases unchanged')
 shutil.rmtree(folder)
except BaseException:
 traceback.print_exc();sys.exit(1)
