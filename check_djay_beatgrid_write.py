"""Publish an AXIOM clean grid into DISPOSABLE copies of a real djay library and metadata file.

Usage: python check_djay_beatgrid_write.py <copied MediaLibrary.db> <copied .djayMetadata> <track key> <audio path> <bpm> <first beat seconds>
Both copies are copied again into work/fixtures; the audio is only read (the
probe's audit hook refuses any write outside the workspace).
"""
import os,sys,pathlib,shutil,json,hashlib,plistlib
source=pathlib.Path(sys.argv[1]).resolve();meta=pathlib.Path(sys.argv[2]).resolve()
key,audio,bpm,first=sys.argv[3],sys.argv[4],float(sys.argv[5]),float(sys.argv[6])
live=pathlib.Path(os.environ.get('USERPROFILE',''))
for p in (source,meta):
    if p.is_relative_to(live/'Music'/'djay') or 'Packages' in p.parts: sys.exit('Refusing to use live djay data; pass copies')
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
import uuid,sqlite3
folder=workspace/'fixtures'/'djay-grid'/uuid.uuid4().hex
(folder/'lib').mkdir(parents=True);(folder/'Metadata'/meta.parent.name).mkdir(parents=True)
for f in source.parent.glob(source.name+'*'): shutil.copy2(f,folder/'lib'/f.name)
shutil.copy2(meta,folder/'Metadata'/meta.parent.name/meta.name)
db=folder/'lib'/source.name;metadata_root=folder/'Metadata'
from windows_bootstrap import build_backend
app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
import djay_beatgrid_publisher as bp
from utils.dj_track_colors import decode_djay_record
def records():
    c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
    r={(a,b):bytes(d) for a,b,d in c.execute('select collection,key,data from database2')};c.close();return r
before=records();meta_before=plistlib.loads((metadata_root/meta.parent.name/meta.name).read_bytes())
audio_sum=hashlib.sha256(open(audio,'rb').read()).hexdigest()
step=60.0/bpm;last=int((136.0-first)/step)
grid={'mode':'straight','bpm':bpm,'time_signature_index':4,'beat_anchors':[{'beat':0,'seconds':first},{'beat':last,'seconds':first+last*step}]}
backup=pathlib.Path(os.environ['AXIOM_RUNTIME_DIR'])/'djay-grid-backups'/folder.name;backup.mkdir(parents=True)
result=bp.publish_djay_existing_track_beatgrid(str(db),str(metadata_root),audio,key,grid,backup_root=str(backup))
print(json.dumps(result,indent=1,default=str)[:2500])
after=records()
for k in sorted(set(before)|set(after)):
    if before.get(k)!=after.get(k):
        try: shown=decode_djay_record(after[k])
        except Exception as e: shown=f'<{type(e).__name__}: {e}>'
        print('changed' if k in before else 'added',k,repr({x:y for x,y in shown.items() if x not in ('timestampIdentifier','titleIDs','titleID')} if isinstance(shown,dict) else shown)[:900])
meta_after=plistlib.loads((metadata_root/meta.parent.name/meta.name).read_bytes())
for section in meta_after:
    if meta_after[section]!=meta_before.get(section):
        a,b=meta_before.get(section,{}),meta_after[section]
        print('metadata',section,{k:(repr(a.get(k))[:40],repr(b.get(k))[:40]) for k in set(a)|set(b) if a.get(k)!=b.get(k)})
c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True);print('integrity:',c.execute('PRAGMA integrity_check').fetchone()[0]);c.close()
print('audio unchanged:',hashlib.sha256(open(audio,'rb').read()).hexdigest()==audio_sum)
print('fixture:',folder)
