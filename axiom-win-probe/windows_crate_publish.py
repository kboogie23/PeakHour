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
from windows_serato_library import SeratoLibraryError

class CratePublicationError(SeratoLibraryError):
    code = 'legacy_files'

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


# ---------------------------------------------------------------- legacy files Serato DJ Pro 5 mirrors every crate into
# Layout decoded from the 468-byte "PH Parent%%PH child.crate" Serato wrote (investigation.md, 2026-11-13): a stream of
# 4-byte tag, 4-byte big-endian length, payload; text is UTF-16BE. Track paths are relative to the drive root.
LEGACY_VERSION = '1.0/Serato ScratchLive Crate'
LEGACY_COLUMNS = (('song', '250'), ('artist', '250'), ('bpm', '30'), ('key', '30'), ('album', '250'), ('length', '250'),
                  ('comment', '250'))
NEWORDER_BEGIN, NEWORDER_END = '[begin record]', '[end record]'

def _tag(name, payload):
    return name.encode('ascii') + len(payload).to_bytes(4, 'big') + payload

def _text(value):
    return value.encode('utf-16-be')

def legacy_crate_name(parts):
    """The file name for a crate path: ["Parent", "Child"] -> "Parent%%Child.crate"."""
    return '%%'.join(parts) + '.crate'

def _blocks(data):
    """[(tag, payload)] of a legacy crate's top-level tags; ValueError if the stream is damaged."""
    blocks, offset = [], 0
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError('truncated crate')
        name, length = data[offset:offset + 4], int.from_bytes(data[offset + 4:offset + 8], 'big')
        if offset + 8 + length > len(data) or not name.isalpha():
            raise ValueError('damaged crate')
        blocks.append((name.decode('ascii'), data[offset + 8:offset + 8 + length]))
        offset += 8 + length
    return blocks

def _track_path(payload):
    for name, body in _blocks(payload):
        if name == 'ptrk':
            return body.decode('utf-16-be').casefold()
    return None

def legacy_crate_bytes(relative_paths, previous=None):
    """The bytes of a Serato legacy crate holding these drive-relative tracks (forward slashes, no drive letter).

    With `previous` (the crate file being replaced) its version, column (ovct) and sort (osrt) tags are kept as they
    are, and the tags of a track that stays are reused; only the list of tracks changes."""
    head, old_tracks = None, {}
    if previous:
        try:
            parsed = _blocks(previous)
            if parsed and parsed[0][0] == 'vrsn':
                head = [(n, p) for n, p in parsed if n != 'otrk']
                old_tracks = {key: p for n, p in parsed if n == 'otrk' for key in [_track_path(p)] if key}
        except (ValueError, UnicodeDecodeError):
            head, old_tracks = None, {}
    if head is None:
        head = [('vrsn', _text(LEGACY_VERSION))] + [('ovct', _tag('tvcn', _text(column)) + _tag('tvcw', _text(width)))
                                                     for column, width in LEGACY_COLUMNS]
    blocks = [_tag(name, payload) for name, payload in head]
    for path in relative_paths:
        kept = old_tracks.get(path.casefold())
        blocks.append(_tag('otrk', kept if kept is not None else _tag('ptrk', _text(path))))
    return b''.join(blocks)

def _atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    stage = path.with_name('.' + path.name + '.peakhour-' + uuid.uuid4().hex[:8] + '.tmp')
    try:
        with open(stage, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(stage, path)
    finally:
        try:
            os.unlink(stage)
        except OSError:
            pass

def restore_file(path, old):
    """Put a file back as it was (old = its bytes, or None if it did not exist)."""
    if old is None:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
    else:
        _atomic_write(path, old)

def write_legacy_crate(serato_root, parts, relative_paths, undo):
    """Write <serato_root>\\Subcrates\\Parent%%Child.crate atomically. undo[path] = the previous bytes (None = new)."""
    path = Path(serato_root) / 'Subcrates' / legacy_crate_name(parts)
    try:
        old = path.read_bytes()
    except FileNotFoundError:
        old = None
    new = legacy_crate_bytes(relative_paths, old)
    if old != new:
        undo[path] = old
        _atomic_write(path, new)
    return undo

def update_neworder(serato_root, crate_names, undo):
    """Append "[crate]<name>" lines for names not yet listed (parents before children) to neworder.pref, rewritten
    atomically as UTF-16BE. A file that is not a record Serato wrote is refused untouched."""
    path = Path(serato_root) / 'neworder.pref'
    try:
        old = path.read_bytes()
    except FileNotFoundError:
        old = None
    if old is None:
        text, newline = NEWORDER_BEGIN + '\n' + NEWORDER_END + '\n', '\n'
    else:
        if len(old) % 2:
            raise CratePublicationError('neworder.pref is not UTF-16 text; left alone')
        text = old.decode('utf-16-be', errors='strict')
        if text.startswith('﻿'):
            raise CratePublicationError('neworder.pref has a byte-order mark Serato does not write; left alone')
        newline = '\r\n' if '\r\n' in text else '\n'
    lines = text.split(newline)
    if NEWORDER_END not in lines or NEWORDER_BEGIN not in lines:
        raise CratePublicationError('neworder.pref is not a record Serato wrote; left alone')
    listed = {line[len('[crate]'):].casefold() for line in lines if line.startswith('[crate]')}
    add = ['[crate]' + name for name in crate_names if name.casefold() not in listed]
    if not add:
        return undo
    end = len(lines) - 1 - lines[::-1].index(NEWORDER_END)
    lines[end:end] = add
    undo[path] = old
    _atomic_write(path, newline.join(lines).encode('utf-16-be'))
    return undo
