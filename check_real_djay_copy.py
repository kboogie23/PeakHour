"""Read a COPY of a real djay MediaLibrary.db through AXIOM's original reader.

Usage: python check_real_djay_copy.py <path to copied MediaLibrary.db>
Never point this at the live library; copy MediaLibrary.db, -wal and -shm first.
"""
import os,sys,pathlib,hashlib
db=pathlib.Path(sys.argv[1]).resolve()
live=pathlib.Path(os.environ.get('USERPROFILE',''))/'Music'/'djay'
if db.is_relative_to(live): sys.exit('Refusing to read the live djay library; pass a copy')
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
from windows_bootstrap import build_backend
import uuid
folder=workspace/'fixtures'/'djay-real'/uuid.uuid4().hex;folder.mkdir(parents=True)
app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
from utils.dj_transfer import read_djay_tracks
before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in db.parent.glob(db.name+'*')}
tracks,errors=read_djay_tracks([db])
after={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in db.parent.glob(db.name+'*')}
print('errors:',errors)
print('tracks:',len(tracks))
for path,info in tracks.items():
    print(repr(path),'exists=',pathlib.Path(path).exists())
    print('  ',{k:v for k,v in info.items() if v not in (None,'',[],{})})
print('changed files:',sorted(k for k in before if before[k]!=after.get(k)) or 'none')
