"""Write an AXIOM playlist into a DISPOSABLE copy of a real djay library.

Usage: python check_djay_playlist_write.py <copied MediaLibrary.db> <track path> [<track path> ...]
The copy is placed at probe-home\\Music\\djay\\djay Media Library, where the
probe's AXIOM looks for djay; the real library is never touched.
"""
import os,sys,pathlib,hashlib,shutil,json
source=pathlib.Path(sys.argv[1]).resolve();paths=sys.argv[2:]
live=pathlib.Path(os.environ.get('USERPROFILE',''))/'Music'/'djay'
if source.is_relative_to(live): sys.exit('Refusing to use the live djay library; pass a copy')
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
import uuid,sqlite3
target=home/'Music'/'djay'/'djay Media Library'
assert target.is_relative_to(workspace)
if target.exists(): shutil.rmtree(target)
target.mkdir(parents=True)
for f in source.parent.glob(source.name+'*'): shutil.copy2(f,target/f.name)
db=target/'MediaLibrary.db'
folder=workspace/'fixtures'/'djay-write'/uuid.uuid4().hex;folder.mkdir(parents=True)
from windows_bootstrap import build_backend
app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
from utils.dj_track_colors import decode_djay_record
assert app._djay_database_candidates(None)[-1]==str(db),app._djay_database_candidates(None)
def snapshot():
    c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
    r={(a,b):bytes(d) for a,b,d in c.execute('select collection,key,data from database2')}
    c.close();return r
before=snapshot()
name='AXIOM Windows Test '+uuid.uuid4().hex[:6]
# allow_running: djay is open on the real library; this writes only the copy above.
result=app._write_djay_native_playlist([{'path':p} for p in paths],name,allow_running=True,reopen=False)
print(json.dumps(result,indent=1,default=str)[:2500])
after=snapshot()
c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
print('integrity:',c.execute('PRAGMA integrity_check').fetchone()[0]);c.close()
for k in sorted(set(before)|set(after)):
    if before.get(k)!=after.get(k):
        state='added' if k not in before else 'removed' if k not in after else 'changed'
        rec=after.get(k) or before.get(k)
        try: shown=decode_djay_record(rec)
        except Exception as e: shown=f'<{type(e).__name__}: {e}>'
        print(state,k,repr(shown)[:400])
print('library copy:',target)
