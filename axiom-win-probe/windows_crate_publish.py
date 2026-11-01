"""Experimental, fixture-only publication of new volume-relative crates.

Does not replace existing crates or update Serato's modern database. This is not
safe for real libraries until Windows handle confinement and Serato acceptance
are verified. Callers must not treat process snapshots as exclusive access.
"""
import copy
import hashlib
import os
import stat
import tempfile
import uuid
from pathlib import Path
from serato_tools.crate import Crate
from windows_serato_paths import crate_relative_path
from windows_serato_processes import require_serato_closed, snapshot_processes

class CratePublicationError(RuntimeError):
    pass

def _identity(path):
    info=os.stat(path,follow_symlinks=False)
    if not stat.S_ISREG(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400:
        raise CratePublicationError('Track must be a regular non-reparse file')
    return (info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns)

def publish_new_crate(serato_root, name, tracks, *, snapshot=snapshot_processes):
    root=Path(serato_root).absolute();directory=root/'Subcrates'
    if root.is_symlink() or directory.is_symlink() or not directory.is_dir():
        raise CratePublicationError('A regular Serato Subcrates directory is required')
    if (not isinstance(name,str) or not name.strip() or name != name.strip()
        or name in ('.','..') or any(c in name for c in '<>:"/\\|?*')
        or name.endswith(('.', ' ')) or any(ord(c)<32 for c in name)):
        raise CratePublicationError('Invalid crate name')
    if name.lower().endswith('.crate'):name=name[:-6]
    if not name:raise CratePublicationError('Invalid crate name')
    if not isinstance(tracks,(list,tuple)) or not tracks or len(tracks)>100000:
        raise CratePublicationError('A nonempty, bounded list of tracks is required')
    target=directory/(name+'.crate')
    require_serato_closed(snapshot)
    if os.path.lexists(target):raise FileExistsError(target)
    relative=[];identities=[];seen=set()
    for track in tracks:
        path=Path(track)
        if not path.is_absolute():raise CratePublicationError('Track paths must be absolute')
        rel=crate_relative_path(str(path),str(root));key=rel.casefold()
        if key in seen:raise CratePublicationError('Duplicate track paths are not supported')
        seen.add(key);relative.append(rel);identities.append(_identity(path))
    # Build the original crate bytes without opening or touching any existing crate.
    virtual=directory/('.axiom-build-'+uuid.uuid4().hex+'.crate')
    if os.path.lexists(virtual):raise CratePublicationError('Temporary name collision')
    crate=Crate(str(virtual));crate.entries=copy.deepcopy(Crate.DEFAULT_ENTRIES)
    for track in tracks:crate.add_track(str(track))
    crate._dump();payload=crate.raw_data;digest=hashlib.sha256(payload).hexdigest()
    fd,stage_name=tempfile.mkstemp(prefix='.axiom-stage-',suffix='.crate',dir=directory)
    stage=Path(stage_name);stage_identity=None
    try:
        with os.fdopen(fd,'wb') as handle:
            handle.write(payload);handle.flush();os.fsync(handle.fileno());stage_identity=os.fstat(handle.fileno())
        if Crate(str(stage)).get_track_paths()!=relative:
            raise CratePublicationError('Crate verification failed')
        require_serato_closed(snapshot)
        if any(_identity(Path(p))!=old for p,old in zip(tracks,identities)):
            raise CratePublicationError('A track changed while preparing the crate')
        # A hard link creates the destination atomically and fails if it exists.
        # It does not guarantee Serato is closed or protect against directory races.
        os.link(stage,target)
        published=os.stat(target,follow_symlinks=False)
        if (published.st_dev,published.st_ino)!=(stage_identity.st_dev,stage_identity.st_ino):
            raise CratePublicationError('Crate was published but identity verification failed')
        return {'path':str(target),'tracks':len(relative),'sha256':digest}
    finally:
        try:
            current=os.stat(stage,follow_symlinks=False)
            if stage_identity and (current.st_dev,current.st_ino)==(stage_identity.st_dev,stage_identity.st_ino):
                os.unlink(stage)
        except FileNotFoundError:pass
