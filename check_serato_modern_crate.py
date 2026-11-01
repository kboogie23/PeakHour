"""Write an AXIOM crate into a DISPOSABLE copy of a Serato DJ Pro 5 location.sqlite.

Usage: python check_serato_modern_crate.py <copied location.sqlite> <drive letter of the original, e.g. E:> [count]
Tracks are taken from that drive's real Serato library (read-only) and only read.
"""
import os,sys,pathlib,shutil,uuid,sqlite3,hashlib
source=pathlib.Path(sys.argv[1]).resolve();drive=sys.argv[2].upper();count=int(sys.argv[3]) if len(sys.argv)>3 else 5
if source.drive.upper()==drive and '_Serato_' in source.parts:sys.exit('Pass a copy, not the live Serato database')
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
folder=workspace/'fixtures'/'serato-modern'/uuid.uuid4().hex;folder.mkdir(parents=True)
db=folder/'location.sqlite';shutil.copy2(source,db)
from windows_bootstrap import build_backend
app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
library=pathlib.Path(drive+'\\','_Serato_','database V2')
tracks,_,_=app._load_serato_library_tracks(database_paths=[str(library)])
tracks=[t for t in tracks if os.path.isfile(t['path'])][:count]
print('tracks:',[t['path'] for t in tracks])
def snapshot():
    c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True);out={}
    for (t,) in c.execute("select name from sqlite_master where type='table'"):
        out[t]=set(c.execute(f'select rowid,* from "{t}"').fetchall())
    c.close();return out
before=snapshot()
result=app._write_serato_modern_crate_to_database(str(db),tracks,'AXIOM Test')
print('result:',result)
after=snapshot()
for t in sorted(after):
    added,removed=after[t]-before.get(t,set()),before.get(t,set())-after[t]
    if added or removed:print(f' {t}: +{len(added)} -{len(removed)}',sorted(added,key=repr)[:3] if t in ('container','dj_container_metadata','serato','space') else '')
c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
print('integrity:',c.execute('PRAGMA integrity_check').fetchone()[0],'| foreign key problems:',c.execute('PRAGMA foreign_key_check').fetchall())
crate=c.execute("select id,parent_id,type,space_id,portable_id from container where name='AXIOM Test'").fetchall()
print('crate row:',crate,'| Serato Samples crate:',c.execute("select id,parent_id,type,space_id,portable_id from container where name='Samples'").fetchall())
rows=c.execute("select a.portable_id from container_asset ca join space_asset sa on sa.id=ca.space_asset_id join asset a on a.id=sa.asset_id where ca.container_id=? order by ca.list_order",(crate[0][0],)).fetchall()
print('crate tracks in order:',[r[0] for r in rows])
print('assets before/after:',len(before['asset']),len(after['asset']),'| duplicate portable ids:',c.execute('select portable_id,count(*) from asset group by portable_id collate nocase having count(*)>1').fetchall())
print('fixture:',folder)
