"""Publish a play count into a DISPOSABLE copy of a real djay library.

Usage: python check_djay_play_count_write.py <copied MediaLibrary.db> <new count>
The copy (with -wal/-shm) is copied again into work/fixtures before writing.
"""
import os,sys,pathlib,hashlib,shutil,json
source=pathlib.Path(sys.argv[1]).resolve();new_count=int(sys.argv[2])
live=pathlib.Path(os.environ.get('USERPROFILE',''))/'Music'/'djay'
if source.is_relative_to(live): sys.exit('Refusing to use the live djay library; pass a copy')
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
from windows_bootstrap import build_backend
import uuid,sqlite3
folder=workspace/'fixtures'/'djay-write'/uuid.uuid4().hex;(folder/'lib').mkdir(parents=True)
for f in source.parent.glob(source.name+'*'): shutil.copy2(f,folder/'lib'/f.name)
db=folder/'lib'/source.name
app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
from utils.dj_transfer import read_djay_tracks
import utils.djay_play_count_publish as counts
from utils.dj_track_colors import decode_djay_record
print('guard on this PC:',end=' ')
try: counts.assert_apps_quit();print('no DJ apps running')
except RuntimeError as e: print(e)
tracks,errors=read_djay_tracks([db]);assert not errors,errors
rows=[dict(t,serato_play_count=new_count,exact_path=True,match_source='exact_path',owner_confirmed_location=True) for t in tracks.values()]
print('eligible:',len(counts.eligible_rows(rows)))
backup=pathlib.Path(os.environ['AXIOM_RUNTIME_DIR'])/'djay-play-count-backups'/folder.name;backup.mkdir(parents=True)
result=counts.publish_counts(str(db),rows,str(backup),confirmation=counts.CONFIRMATION,ensure_quit=lambda:None)
print(json.dumps(result,indent=1,default=str)[:1500])
c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
print('integrity:',c.execute('PRAGMA integrity_check').fetchone()[0])
for key,data in c.execute("SELECT key,data FROM database2 WHERE collection='mediaItemUserData'"):
    rec=decode_djay_record(bytes(data));print(key,'playCount =',repr(rec.get('playCount')))
c.close()
after,errors=read_djay_tracks([db]);print('read back:',[(t['title'],t['djay_play_count']) for t in after.values()],errors)
print('fixture folder:',folder)
