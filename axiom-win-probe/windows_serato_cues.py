"""Send cue points (position, colour, name) to Serato DJ Pro on Windows.

Serato keeps hot cues only in the audio file's own tags (not in location.sqlite or database V2):
  MP3        ID3 GEOB "Serato Markers2" (and the legacy "Serato Markers_", which is left untouched)
  MP4 / M4A  freeform atoms ----:com.serato.dj:markersv2 and ----:com.serato.dj:markers
Layout checked against files Serato DJ Pro 5 wrote (investigation.md, 2026-11-13): Markers2 is b"\\x01\\x01" +
base64 of (b"\\x01\\x01" + entries), the base64 wrapped at 72 columns and NUL padded to 470 bytes;
an entry is name + NUL + big-endian length + body; a CUE body is 00, index, position ms (be32), 00, RGB, 00 00,
name + NUL. In MP4 the atom holds base64 (wrapped at 72, final newline) of
b"application/octet-stream\\0\\0Serato Markers2\\0" + that payload.

Only songs that have NO Serato cues yet are filled; a song with cues in Serato is left alone. Cues come from the
first of these that has any: PEAK HOUR's own saved cues, VirtualDJ (<Poi Type="cue"> in database.xml, read only),
then djay (read only). Slots 1-8.

Public functions take and return plain JSON, so the write queue can call them later:
  preview(payload)   what would be written; reads files and databases, writes nothing
  apply(payload)     per song: copy of the original to a backup folder, tags written to a temp copy, audio stream
                     compared byte for byte, cues read back, then an atomic replace
  undo(backup_id)    puts the original files back, byte for byte
  digest(payload)    stable hash of the preview, for a stale check before apply
payload is {"tracks": ["D:\\\\Music\\\\a.mp3", ...] or "all"}; apply also takes an optional "digest".

Serato must be closed; if it is open apply/undo raise SeratoCueError with code 'serato_open' and write nothing
(checked at the start and again right before each file is replaced).
"""
import base64
import hashlib
import json
import logging
import math
import ntpath
import os
import re
import shutil
import sqlite3
import string
import struct
import threading
import time
import uuid
from pathlib import Path

import windows_cue_jobs as _jobs

CUE_SLOTS = 8
SOURCES = ('peakhour', 'virtualdj', 'djay')
LABELS = {'peakhour': 'PEAK HOUR', 'virtualdj': 'VirtualDJ', 'djay': 'djay'}
PLACEHOLDER_COLOR = 'A3FF00'  # what PEAK HOUR shows for a cue without a colour: not a real choice
DEFAULT_SLOT_COLORS = ('CC0000', 'CC8800', '0000CC', 'CCCC00', '00CC00', 'CC00CC', '00CCCC', '8800CC')
FORMATS = {'.mp3': 'mp3', '.mp4': 'mp4', '.m4a': 'mp4', '.m4v': 'mp4'}
VIDEO_EXTENSIONS = ('.mp4', '.m4v')  # Serato's default track colour is cyan for video, white for audio (asset.color)
HEAD_V2 = b'application/octet-stream\x00\x00Serato Markers2\x00'
HEAD_V1 = b'application/octet-stream\x00\x00Serato Markers_\x00'
ATOM_V2, ATOM_V1 = '----:com.serato.dj:markersv2', '----:com.serato.dj:markers'
GEOB_V2, GEOB_V1 = 'GEOB:Serato Markers2', 'GEOB:Serato Markers_'
_LOCK = threading.Lock()


class SeratoCueError(RuntimeError):
    """code: 'serato_open', 'stale', 'bad_request', 'unreadable', 'changed', 'verify_failed', 'write_failed'."""

    def __init__(self, message, code='error'):
        super().__init__(message)
        self.code = code


# ------------------------------------------------------------------ configuration

_state = {'app': None, 'root': None, 'running': None, 'readers': {}, 'virtualdj_databases': None, 'libraries': None,
          'programs': None, 'recovered': 0, 'recovery': None}
_ACTIVE = set()  # receipts of writes running right now in this process
log = logging.getLogger('peakhour.serato_cues')


def configure(app=None, root=None, running=None, readers=None, virtualdj_databases=None, libraries=None, programs=None):
    """Set what the module works on. Unset values fall back to the app / the real locations.

    root                where backups and receipts go
    running             callable -> True while Serato is open (default: Windows process list)
    readers             {'peakhour'|'virtualdj'|'djay': callable(path) -> [cue dicts]}
    virtualdj_databases callable -> VirtualDJ database.xml paths
    libraries           callable -> [(drive like 'D:', path of that drive's location.sqlite)] for "all"
    programs            callable -> set of DJ programs that are open ('virtualdj', 'serato', 'djay'); default: the process list
    """
    for name, value in (('app', app), ('root', root), ('running', running),
                        ('virtualdj_databases', virtualdj_databases), ('libraries', libraries), ('programs', programs)):
        if value is not None:
            _state[name] = value
    if root is not None:
        cleanup_leftovers(root)
        start_recovery(root)
    if readers is not None:
        _state['readers'] = dict(readers)


def _root():
    if _state['root'] is not None:
        return Path(_state['root'])
    cache = getattr(_state['app'], 'CACHE_PATH', None)
    if cache:
        return Path(cache).parent / 'serato-cue-writes'
    return Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local') / 'AXIOM DJ' / 'serato-cue-writes'


def _running():
    check = _state['running']
    if check is not None:
        return bool(check())
    from windows_serato_processes import ProcessInspectionError, running_serato
    try:
        return bool(running_serato())
    except ProcessInspectionError:
        return True  # cannot tell: count it as open


def _ensure_closed():
    if _running():
        raise SeratoCueError('Quit Serato DJ, then try again. Nothing was written.', 'serato_open')


# ------------------------------------------------------------------ small helpers

def _file_sha(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _key(path):
    return ntpath.normcase(ntpath.normpath(str(path)))


def _float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _signature(path):
    info = os.stat(path)
    return [info.st_size, info.st_mtime_ns]


def _swap_file(target, data=None, source=None):
    """Put data (or a copy of source, keeping its times) next to target, flush it, then swap it in."""
    target = Path(target)
    stage = target.with_name(f'.{target.name}.peakhour-{uuid.uuid4().hex[:8]}.tmp')
    try:
        if source is not None:
            shutil.copy2(source, stage)
            with open(stage, 'rb+') as handle:
                os.fsync(handle.fileno())
        else:
            with open(stage, 'wb') as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
        os.replace(stage, target)
    finally:
        try:
            stage.unlink()
        except OSError:
            pass


# ------------------------------------------------------------------ Serato tag codec

def _b64decode(text):
    """Base64 as Serato leaves it: line breaks, missing '=' padding, and a length of 4n+1 (read as Serato does, 'A==')."""
    text = bytes(text).replace(b'\n', b'').replace(b'\r', b'')
    return base64.b64decode(text + (b'A==' if len(text) % 4 == 1 else b'=' * (-len(text) % 4)))


def _wrap(text, width=72):
    return b'\n'.join(text[i:i + width] for i in range(0, len(text), width))


def parse_markers2(raw):
    """[(entry name, body bytes)] from Markers2 data (b"\\x01\\x01" + wrapped base64 + padding)."""
    raw = bytes(raw)
    if raw[:2] != b'\x01\x01':
        raise ValueError('not Serato Markers2 data')
    text = raw[2:].split(b'\x00', 1)[0]
    inner = _b64decode(text)
    if inner[:2] != b'\x01\x01':
        raise ValueError('unexpected Markers2 version')
    entries, offset = [], 2
    while offset < len(inner):
        end = inner.index(b'\x00', offset)
        name = inner[offset:end].decode('utf-8')
        if not name:
            break
        (length,) = struct.unpack('>I', inner[end + 1:end + 5])
        body = inner[end + 5:end + 5 + length]
        if len(body) != length:
            raise ValueError('truncated Markers2 entry')
        entries.append((name, body))
        offset = end + 5 + length
    return entries


def parse_cue_entry(body):
    """(index, position ms, 'RRGGBB', name) of a CUE entry body."""
    index, position = body[1], struct.unpack('>I', body[2:6])[0]
    return index, position, body[7:10].hex().upper(), body[12:].split(b'\x00', 1)[0].decode('utf-8')


def cue_entry(index, ms, color, name):
    body = b'\x00' + bytes([index]) + struct.pack('>I', max(0, min(int(ms), 0xFFFFFFFF))) + b'\x00' + bytes.fromhex(color) \
        + b'\x00\x00' + name.encode('utf-8') + b'\x00'
    return 'CUE', body


def encode_markers2(cues, kept=(), default_color=b'\xff\xff\xff'):
    """Markers2 data holding these cues ([{'index', 'ms', 'color', 'name'}]) and the entries to keep as they are.

    Order as Serato writes it: COLOR, the CUE entries, then the rest (BPMLOCK is added if missing)."""
    kept = list(kept)
    color = [e for e in kept if e[0] == 'COLOR'] or [('COLOR', b'\x00' + default_color)]
    rest = [e for e in kept if e[0] not in ('COLOR', 'CUE')]
    if not any(name == 'BPMLOCK' for name, _ in rest):
        rest.append(('BPMLOCK', b'\x00'))
    entries = color[:1] + [cue_entry(c['index'], c['ms'], c['color'], c['name']) for c in sorted(cues, key=lambda c: c['index'])] + rest
    inner = b'\x01\x01' + b''.join(name.encode('utf-8') + b'\x00' + struct.pack('>I', len(body)) + body for name, body in entries)
    return (b'\x01\x01' + _wrap(base64.b64encode(inner))).ljust(470, b'\x00')


def parse_markers_v1(payload):
    """(cue count, track colour tail bytes) of a Serato "Markers_" payload: version, entry count, then 19-byte entries
    (Serato DJ Pro 5, as in files it wrote) or the older 22-byte ones, then the track colour. ValueError if neither fits."""
    payload = bytes(payload)
    if payload[:1] != b'\x02' and payload[:2] != b'\x01\x01':
        raise ValueError('unknown Markers_ version')
    (count,) = struct.unpack('>I', payload[2:6])
    body = payload[6:]
    for size in (19, 22):
        spare = len(body) - count * size
        if 0 <= spare <= 16 and count <= 64:
            cues = 0
            for number in range(count):
                entry = body[number * size:(number + 1) * size]
                if size == 19:
                    cues += entry[17] == 1 and entry[:4] != b'\xff\xff\xff\xff'
                else:
                    cues += entry[20] == 1 and entry[0] == 0
            return cues, body[count * size:]
    raise ValueError('unknown Markers_ layout')


def encode_markers_v1(cues, tail):
    """MP4 "Serato Markers_" payload: 5 cue slots and 9 loop slots as Serato DJ Pro 5 writes them, then the track colour."""
    slots = {c['index']: c for c in cues if c['index'] < 5}
    out = [b'\x02\x05' + struct.pack('>I', 14)]
    for slot in range(5):
        cue = slots.get(slot)
        start = struct.pack('>I', int(cue['ms'])) if cue else b'\xff\xff\xff\xff'
        out.append(start + b'\xff\xff\xff\xff' + b'\x00\xff\xff\xff\xff\x00' + (bytes.fromhex(cue['color']) if cue else b'\x00\x00\x00')
                   + (b'\x01' if cue else b'\x00') + b'\x00')
    out += [b'\xff' * 8 + b'\x00\xff\xff\xff\xff\x00' + b'\x00\x00\x00' + b'\x03\x00'] * 9
    out.append(tail)
    return b''.join(out)


def _atom_value(header, payload):
    return _wrap(base64.b64encode(header + payload)) + b'\n'


def _atom_payload(value, *headers):
    """The Serato payload inside a freeform atom. Serato DJ Pro 5 names the legacy "markers" atom "Serato Markers_" in some
    files and "Serato Markers2" in others, so the legacy atom accepts both."""
    data = _b64decode(value)
    for header in headers:
        if data.startswith(header):
            return data[len(header):]
    raise ValueError('unexpected Serato atom')


# ------------------------------------------------------------------ reading and writing a file's Serato tags

def file_format(path):
    return FORMATS.get(os.path.splitext(str(path))[1].lower())


def _default_color(path):
    return b'\x00\xff\xff' if os.path.splitext(str(path))[1].lower() in VIDEO_EXTENSIONS else b'\xff\xff\xff'


def _read_region(path, kind):
    """The part of a song that holds its tags and nothing else: MP3 = the 10-byte ID3v2 header and exactly the tag; MP4/M4A = the
    top-level atoms other than mdat (mdat, the media data, is seeked past). The sound is never read."""
    with open(path, 'rb') as handle:
        if kind == 'mp3':
            head = handle.read(10)
            if head[:3] != b'ID3':
                return b''
            size = ((head[6] & 0x7F) << 21) | ((head[7] & 0x7F) << 14) | ((head[8] & 0x7F) << 7) | (head[9] & 0x7F)
            return head + handle.read(size + (10 if head[5] & 0x10 else 0))
        size = os.fstat(handle.fileno()).st_size
        pieces = []
        for offset, length, name, body in _mp4_atoms(handle, size):
            if name != b'mdat':
                handle.seek(offset)
                pieces.append(handle.read(length))
        return b''.join(pieces)


def _inspect_region(region, kind):
    import io
    found = {'format': kind, 'cues': [], 'entries': [], 'has_v2': False, 'has_v1': False, 'v1_cues': 0, 'v1_tail': b''}
    if kind == 'mp3':
        from mutagen.id3 import ID3, ID3NoHeaderError
        tags = ID3()
        try:
            tags.load(io.BytesIO(region), translate=False, load_v1=False)
        except ID3NoHeaderError:
            return found
        v2, v1 = tags.get(GEOB_V2), tags.get(GEOB_V1)
        v2_data = bytes(v2.data) if v2 is not None else None
        v1_data = bytes(v1.data) if v1 is not None else None
    elif kind == 'mp4':
        from mutagen.mp4 import MP4
        tags = MP4(io.BytesIO(region)).tags or {}
        v2_data = _atom_payload(tags[ATOM_V2][0], HEAD_V2) if ATOM_V2 in tags and tags[ATOM_V2] else None
        v1_data = _atom_payload(tags[ATOM_V1][0], HEAD_V1, HEAD_V2) if ATOM_V1 in tags and tags[ATOM_V1] else None
    else:
        raise ValueError('Only MP3, MP4 and M4A files can carry Serato cues here.')
    if v2_data is not None:
        found['has_v2'] = True
        found['entries'] = parse_markers2(v2_data)
        found['cues'] = [parse_cue_entry(body) for name, body in found['entries'] if name == 'CUE']
    if v1_data:  # an empty legacy tag (Serato leaves one on many MP3s) holds no cues
        found['has_v1'] = True
        found['v1_cues'], found['v1_tail'] = parse_markers_v1(v1_data)  # unreadable legacy tag: the song is left alone
    return found


def inspect(path, kind=None):
    """What Serato has stored in this file: {'format', 'cues': [(index, ms, color, name)], 'entries', 'has_v2',
    'has_v1', 'v1_cues', 'v1_tail'}. ValueError if the tags cannot be read; kind overrides the extension. Reads only the tag
    region of the song."""
    kind = kind or file_format(path)
    if kind not in ('mp3', 'mp4'):
        raise ValueError('Only MP3, MP4 and M4A files can carry Serato cues here.')
    return _inspect_region(_read_region(path, kind), kind)


# ------------------------------------------------------------------ what a preview learned about a song, kept between previews
# Keyed by path; valid while the song's size and modified time are the same. A write that keeps the date (an in-place patch)
# forgets the song's entry itself.
_CACHE = {'songs': None, 'dirty': False, 'lock': threading.RLock(), 'path': None}
CACHE_LIMIT = 400000


def _cache_file():
    return _root().parent / 'cue-preview-cache.json'


def _cache_songs():
    with _CACHE['lock']:
        path = _cache_file()
        if _CACHE['songs'] is None or _CACHE['path'] != str(path):
            _CACHE['path'], _CACHE['dirty'] = str(path), False
            try:
                data = json.loads(path.read_text(encoding='utf-8'))
                _CACHE['songs'] = data['songs'] if data.get('version') == 1 and isinstance(data.get('songs'), dict) else {}
            except (OSError, ValueError, KeyError, AttributeError):
                _CACHE['songs'] = {}
        return _CACHE['songs']


def save_cache():
    """Write the preview cache to disk (atomic); a no-op if nothing changed."""
    with _CACHE['lock']:
        if not _CACHE['dirty'] or _CACHE['songs'] is None:
            return
        path = Path(_CACHE['path'])
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            stage = path.with_name(path.name + '.tmp')
            stage.write_text(json.dumps({'version': 1, 'songs': _CACHE['songs']}), encoding='utf-8')
            os.replace(stage, path)
            _CACHE['dirty'] = False
        except OSError:
            pass


def _cache_forget(path):
    with _CACHE['lock']:
        if _cache_songs().pop(_key(path), None) is not None:
            _CACHE['dirty'] = True


def _facts_of(info):
    return {'cues': [list(c) for c in info['cues']], 'v1_cues': info['v1_cues'], 'has_v1': info['has_v1'], 'has_v2': info['has_v2'],
            'v1_tail': info['v1_tail'].hex(), 'entries': [[n, b.hex()] for n, b in info['entries'] if n != 'CUE'], 'delta': {}}


def _info_of(facts, kind):
    return {'format': kind, 'cues': [tuple(c) for c in facts['cues']], 'entries': [(n, bytes.fromhex(h)) for n, h in facts['entries']],
            'has_v2': facts['has_v2'], 'has_v1': facts['has_v1'], 'v1_cues': facts['v1_cues'], 'v1_tail': bytes.fromhex(facts['v1_tail'])}


def _facts_for(path, kind, signature):
    """(facts, region): what the song's tags say, from the cache if its size and date match, else read from the tag region (which
    is then returned too, so a trial write can use it without reading again)."""
    key = _key(path)
    with _CACHE['lock']:
        entry = _cache_songs().get(key)
        if entry and entry[0] == signature[0] and entry[1] == signature[1]:
            return entry[2], None
    region = _read_region(path, kind)
    facts = _facts_of(_inspect_region(region, kind))
    with _CACHE['lock']:
        songs = _cache_songs()
        if len(songs) >= CACHE_LIMIT:
            songs.clear()
        songs[key] = [signature[0], signature[1], facts]
        _CACHE['dirty'] = True
    return facts, region


def serato_cues_for(path):
    """Serato's hot cues in a song as [{'index', 'time_ms', 'label', 'color'}] (what the djay and VirtualDJ readers expect),
    from the tag region only (and the preview cache)."""
    kind = file_format(path)
    if not kind:
        return []
    facts, _region = _facts_for(path, kind, _signature(path))
    return [{'index': i, 'time_ms': ms, 'label': name, 'color': '#' + color} for i, ms, color, name in facts['cues']]


def audio_fingerprint(path, kind=None):
    """sha256 of the audio stream only: MP3 = bytes after the ID3v2 tag (before an ID3v1 tag); MP4 = every mdat payload."""
    kind = kind or file_format(path)
    digest, total = hashlib.sha256(), 0
    with open(path, 'rb') as handle:
        size = os.fstat(handle.fileno()).st_size
        if kind == 'mp3':
            head = handle.read(10)
            start = 0
            if head[:3] == b'ID3':
                start = 10 + (((head[6] & 0x7F) << 21) | ((head[7] & 0x7F) << 14) | ((head[8] & 0x7F) << 7) | (head[9] & 0x7F))
                if head[5] & 0x10:
                    start += 10
            end = size
            if size - start >= 128:
                handle.seek(size - 128)
                if handle.read(3) == b'TAG':
                    end = size - 128
            handle.seek(start)
            left = end - start
            while left > 0:
                chunk = handle.read(min(1 << 20, left))
                if not chunk:
                    break
                digest.update(chunk)
                left -= len(chunk)
                total += len(chunk)
            return digest.hexdigest(), total
        offset = 0
        while offset + 8 <= size:
            handle.seek(offset)
            header = handle.read(16)
            length, name = struct.unpack('>I4s', header[:8])
            body = 8
            if length == 1:
                length, body = struct.unpack('>Q', header[8:16])[0], 16
            elif length == 0:
                length = size - offset
            if length < body:
                raise ValueError('damaged MP4 atom')
            if name == b'mdat':
                handle.seek(offset + body)
                left = min(length, size - offset) - body
                while left > 0:
                    chunk = handle.read(min(1 << 20, left))
                    if not chunk:
                        break
                    digest.update(chunk)
                    left -= len(chunk)
                    total += len(chunk)
            offset += length
        if not total:
            raise ValueError('no audio data found in this MP4')
        return digest.hexdigest(), total


def _keep_padding(info):
    """mutagen padding callback: use exactly the room the old tag had (a negative value means it does not fit)."""
    return max(info.padding, 0)


GROW_PADDING = 2048  # room left in a tag that had to grow, so the next edit fits without growing again
MAX_GROW = 16384  # a cue write never makes a song more than this much bigger


def _grow_padding(info):
    return GROW_PADDING


def _write_tags(target, cues, info, kind, color, padding=None):
    """Write the cues into the Serato tags of `target` (a path or a file object). Other tags are not changed.

    The tag keeps its old total size when the new data fits in its padding; if it does not fit the result is
    larger and the caller skips the song (nothing is ever grown in a real file)."""
    kept = [e for e in info['entries'] if e[0] != 'CUE']
    if kind == 'mp3':
        from mutagen.id3 import GEOB, ID3, ID3NoHeaderError
        original_v1 = None
        if isinstance(target, (str, os.PathLike)):
            with open(target, 'rb') as handle:
                handle.seek(0, 2)
                if handle.tell() >= 128:
                    handle.seek(-128, 2)
                    block = handle.read(128)
                    original_v1 = block if block[:3] == b'TAG' else None
        version = 3
        try:
            tags = ID3(target, translate=False)
            if tags.version[1] == 2:
                tags = ID3(target)  # ID3v2.2 frames are upgraded; the tag is written as v2.3
            elif tags.version[1] == 4:
                version = 4
        except ID3NoHeaderError:
            tags = ID3()
        tags.add(GEOB(encoding=0, mime='application/octet-stream', desc='Serato Markers2', data=encode_markers2(cues, kept, color)))
        if hasattr(target, 'seek'):
            target.seek(0)  # mutagen reads the old tag size from the current position
        tags.save(target, v2_version=version, v1=1, padding=padding or _keep_padding)
        if original_v1 is not None:  # mutagen refreshes an ID3v1 tag it finds; keep the song's own bytes
            with open(target, 'rb+') as handle:
                handle.seek(-128, 2)
                if handle.read(3) == b'TAG':
                    handle.seek(-128, 2)
                    handle.write(original_v1)
        return
    from mutagen.mp4 import MP4, MP4FreeForm
    file = MP4(target)
    if file.tags is None:
        file.add_tags()
    stored = [e for e in kept if e[0] == 'COLOR']
    tail = stored[0][1] if stored else b'\x00' + color
    file.tags[ATOM_V2] = [MP4FreeForm(_atom_value(HEAD_V2, encode_markers2(cues, kept, color)), dataformat=1)]
    if not info['has_v1']:
        file.tags[ATOM_V1] = [MP4FreeForm(_atom_value(HEAD_V1, encode_markers_v1(cues, tail)), dataformat=1)]
    if hasattr(target, 'seek'):
        target.seek(0)
    file.save(target, padding=padding or _keep_padding)


def _mp4_atoms(handle, size):
    """[(offset, length, name, header length)] of the top-level atoms."""
    atoms, offset = [], 0
    while offset + 8 <= size:
        handle.seek(offset)
        header = handle.read(16)
        length, name = struct.unpack('>I4s', header[:8])
        body = 8
        if length == 1:
            length, body = struct.unpack('>Q', header[8:16])[0], 16
        elif length == 0:
            length = size - offset
        if length < body:
            raise ValueError('damaged MP4 atom')
        length = min(length, size - offset)
        atoms.append((offset, length, name, body))
        offset += length
    return atoms


def _audio_ranges(path, kind):
    """Byte ranges that carry the sound (and an ID3v1 tag) and must never change: MP3 = after the ID3v2 tag;
    MP4 = each mdat payload."""
    size = os.path.getsize(path)
    with open(path, 'rb') as handle:
        if kind == 'mp3':
            head = handle.read(10)
            start = 0
            if head[:3] == b'ID3':
                start = 10 + (((head[6] & 0x7F) << 21) | ((head[7] & 0x7F) << 14) | ((head[8] & 0x7F) << 7) | (head[9] & 0x7F))
                if head[5] & 0x10:
                    start += 10
            return [(start, size)]
        return [(offset + body, offset + length) for offset, length, name, body in _mp4_atoms(handle, size) if name == b'mdat']


def _tag_delta(path, cues, info, kind, color, allow_grow=True, region=None):
    """How the cues go into this song, tried on an in-memory copy of just the tag part (no audio): 0 = they fit in the
    tag's existing room (written in place, size unchanged); N > 0 = the file grows by N bytes; None = no room and growing
    is off (or the tag cannot be built)."""
    import io
    if region is None:
        region = _read_region(path, kind)
    for padding, grows in ((_keep_padding, False), (_grow_padding, True)):
        if grows and not allow_grow:
            break
        memory = io.BytesIO(region)
        try:
            _write_tags(memory, cues, info, kind, color, padding)
        except Exception:
            continue
        delta = len(memory.getvalue()) - len(region)
        if not grows and delta == 0:
            return 0
        if grows and 0 < delta <= MAX_GROW:
            return delta
    return None


def _tag_regions(path, kind):
    """The parts of the file that are not the audio: where a new tag can differ."""
    size, cursor, regions = os.path.getsize(path), 0, []
    for start, end in sorted(_audio_ranges(path, kind)):
        if start > cursor:
            regions.append((cursor, start))
        cursor = max(cursor, end)
    if cursor < size:
        regions.append((cursor, size))
    return regions


def _diff_ranges(first, second, regions, block=64 * 1024):
    """[(start, end)] where two files of the same size differ, looking only inside `regions` (the tag, not the audio).
    Blocks are compared whole; only a block that differs is scanned byte by byte."""
    ranges = []
    with open(first, 'rb') as a, open(second, 'rb') as b:
        for start, end in regions:
            a.seek(start)
            b.seek(start)
            offset = start
            while offset < end:
                x, y = a.read(min(block, end - offset)), b.read(min(block, end - offset))
                if not x or len(x) != len(y):
                    break
                if x != y:
                    for i in range(len(x)):
                        if x[i] != y[i]:
                            if ranges and ranges[-1][1] == offset + i:
                                ranges[-1][1] += 1
                            else:
                                ranges.append([offset + i, offset + i + 1])
                offset += len(x)
    return [tuple(r) for r in ranges]


def _open_exclusive(path):
    """The song opened for reading and writing with sharing switched off, so no other program has it open while it is
    changed. Raises code 'in_use' if another program has it open."""
    if os.name != 'nt':
        return open(path, 'rb+')
    import ctypes
    import msvcrt
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
                                   wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    handle = kernel.CreateFileW(str(path), 0xC0000000, 0, None, 3, 0x80, None)  # GENERIC_READ|WRITE, no sharing, OPEN_EXISTING
    if handle in (None, ctypes.c_void_p(-1).value):
        raise SeratoCueError('The song is open in another program. Left alone.', 'in_use')
    try:
        fd = msvcrt.open_osfhandle(handle, os.O_RDWR | os.O_BINARY)
    except OSError:
        kernel.CloseHandle(handle)
        raise
    return os.fdopen(fd, 'rb+')


def _patch_in_place(handle, source, ranges):
    """Copy just these byte ranges from source into the (already open) real file, which keeps its file identity."""
    with open(source, 'rb') as new:
        for start, end in ranges:
            new.seek(start)
            handle.seek(start)
            handle.write(new.read(end - start))
    handle.flush()
    os.fsync(handle.fileno())


def _restore_in_place(path, backup, stat, exclusive=False):
    """Write the backup's bytes back over the real file (same file, not a new one) and its original dates. exclusive: nobody else
    may have the song open (raises code 'in_use' otherwise)."""
    with open(backup, 'rb') as old, (_open_exclusive(path) if exclusive else open(path, 'rb+')) as handle:
        while True:
            chunk = old.read(1 << 20)
            if not chunk:
                break
            handle.write(chunk)
        handle.truncate()
        handle.flush()
        os.fsync(handle.fileno())
    os.utime(path, ns=(stat['atime_ns'], stat['mtime_ns']))
    _cache_forget(path)  # the song went back to an older state that may carry the same size and date


def _rewrite_in_place(handle, source):
    """Write the whole new file over the (already open) original, same file so its identity and creation time stay, then cut
    it to length."""
    handle.seek(0)
    with open(source, 'rb') as new:
        while True:
            chunk = new.read(1 << 20)
            if not chunk:
                break
            handle.write(chunk)
    handle.truncate()
    handle.flush()
    os.fsync(handle.fileno())


def _ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        raise SeratoCueError(f'Could not check the sound of the changed song ({exc}). Left alone.', 'no_space') from exc


def _run_ffmpeg(*args):
    import subprocess
    return subprocess.run([_ffmpeg(), *args], capture_output=True, timeout=300, creationflags=0x08000000 if os.name == 'nt' else 0)


def _decode_md5(path, *window, video=False):
    mapping = ('-map', '0:v:0', '-an') if video else ('-map', '0:a:0', '-vn')
    done = _run_ffmpeg('-v', 'error', *window, '-i', str(path), *mapping, '-f', 'md5', '-')
    if done.returncode != 0 or b'MD5=' not in done.stdout:
        raise SeratoCueError('Could not decode the changed song. Left alone.', 'no_space')
    return done.stdout.strip()


def _has_video(path):
    return b'Video:' in _run_ffmpeg('-hide_banner', '-i', str(path)).stderr


def _check_decode(original, changed):
    """An MP4's tag sits before the media data, so growing it moves every sample offset: decode the first and the last seconds
    of the sound (and of the picture, if there is one) of both files and require identical results."""
    video = _has_video(original)
    for window in (('-t', '2'), ('-sseof', '-2')):
        if _decode_md5(original, *window) != _decode_md5(changed, *window):
            raise SeratoCueError('The sound of the changed song does not match the original. Left alone.', 'no_space')
        if video and _decode_md5(original, *window, video=True) != _decode_md5(changed, *window, video=True):
            raise SeratoCueError('The picture of the changed song does not match the original. Left alone.', 'no_space')


def _stat(path):
    info = os.stat(path)
    return {'size': info.st_size, 'ino': info.st_ino, 'mtime_ns': info.st_mtime_ns, 'atime_ns': info.st_atime_ns,
            'created': getattr(info, 'st_birthtime', info.st_ctime)}


def _check_written(path, cues, info, audio, kind):
    """Re-read the written file: same cues, same other Serato entries, same audio stream, same length."""
    now = inspect(path, kind)
    got = sorted((i, ms, color, name) for i, ms, color, name in now['cues'])
    want = sorted((c['index'], c['ms'], c['color'], c['name']) for c in cues)
    if got != want:
        raise SeratoCueError('The cues did not read back as written.', 'verify_failed')
    if info['has_v2']:  # every other entry is still there as it was (only a missing BPMLOCK may have been added)
        extra = [e for e in now['entries'] if e[0] != 'CUE']
        for entry in (e for e in info['entries'] if e[0] != 'CUE'):
            if entry not in extra:
                raise SeratoCueError("Serato's other marker entries changed.", 'verify_failed')
            extra.remove(entry)
        if any(name != 'BPMLOCK' for name, _ in extra):
            raise SeratoCueError("Serato's other marker entries changed.", 'verify_failed')
    if info['has_v1'] and (not now['has_v1'] or now['v1_cues'] != info['v1_cues']):
        raise SeratoCueError("Serato's legacy markers changed.", 'verify_failed')
    if audio_fingerprint(path, kind) != audio:
        raise SeratoCueError('The audio stream changed.', 'verify_failed')


# ------------------------------------------------------------------ cue sources

def _virtualdj_cues():
    """{path key: [cue dicts]} from VirtualDJ's database.xml files (read only); {} when there are none."""
    paths = _state['virtualdj_databases']
    if paths is None:
        from windows_virtualdj_library import database_paths as paths
    from windows_virtualdj_database import read_database
    found = {}
    for database in paths():
        try:
            tracks = read_database(database)['tracks']
        except Exception:
            continue
        for track in tracks:
            cues = []
            for poi in track.get('source_sections', {}).get('Poi', []):
                attributes = poi.get('attributes', {})
                if attributes.get('Type') != 'cue':
                    continue
                seconds, number = _float(attributes.get('Pos')), _float(attributes.get('Num'))
                if seconds is None or number is None or not number.is_integer() or number < 1:
                    continue
                color = None
                argb = _float(attributes.get('Color'))
                if argb is not None and argb.is_integer() and 0 <= argb <= 0xFFFFFFFF:
                    color = '#%06X' % (int(argb) & 0xFFFFFF)
                cues.append({'index': int(number) - 1, 'time_ms': seconds * 1000.0,
                             'label': attributes.get('Name') or '', 'color': color})
            if cues:
                found.setdefault(_key(track['path']), cues)
    return found


class _Sources:
    """Cue readers for one planning run; VirtualDJ's databases are read once, and only if needed."""

    def __init__(self):
        self._virtualdj = None

    def read(self, name, path):
        reader = _state['readers'].get(name)
        if reader is None:
            if name == 'virtualdj':
                if self._virtualdj is None:
                    try:
                        self._virtualdj = _virtualdj_cues()
                    except Exception:
                        self._virtualdj = {}
                return self._virtualdj.get(_key(path), [])
            attribute = {'peakhour': 'read_cues', 'djay': '_load_djay_cues_for_path'}.get(name)
            reader = getattr(_state['app'], attribute, None) if attribute else None
        if not callable(reader):
            return []
        try:
            return reader(path) or []
        except Exception:
            return []


def _clean(cues):
    """Valid, one-per-slot cues as [{index, ms, name, color}] sorted by slot."""
    result, used = [], set()
    for order, cue in enumerate(cues if isinstance(cues, list) else []):
        if not isinstance(cue, dict):
            continue
        index = cue.get('index', order)
        milliseconds = _float(cue.get('time_ms'))
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < CUE_SLOTS \
                or milliseconds is None or milliseconds < 0 or milliseconds > 0xFFFFFFFF or index in used:
            continue
        used.add(index)
        name = re.sub(r'[\x00-\x1f]', '', str(cue.get('label') or '')).strip()
        if re.fullmatch(r'(?i)cue\s*\d+', name):
            name = ''
        text = str(cue.get('color') or '').strip().lstrip('#').upper()
        color = text if re.fullmatch(r'[0-9A-F]{6}', text) and text != PLACEHOLDER_COLOR else DEFAULT_SLOT_COLORS[index]
        result.append({'index': index, 'ms': int(round(milliseconds)), 'name': name[:60], 'color': color})
    return sorted(result, key=lambda c: c['index'])


def _source_cues(sources, path):
    for name in SOURCES:
        cues = _clean(sources.read(name, path))
        if cues:
            return name, cues
    return '', []


# ------------------------------------------------------------------ preview

def _requested(payload):
    tracks = payload.get('tracks', 'all') if isinstance(payload, dict) else payload
    if tracks is None or tracks == 'all':
        return None
    if not isinstance(tracks, list):
        raise SeratoCueError('Choose songs, or "all".', 'bad_request')
    paths = []
    for entry in tracks:
        path = entry.get('path') if isinstance(entry, dict) else entry
        if not isinstance(path, str) or not path:
            raise SeratoCueError('A song in the list has no file path.', 'bad_request')
        paths.append(path)
    return paths


def _libraries():
    chooser = _state['libraries']
    if chooser is not None:
        return list(chooser())
    found = []
    for letter in string.ascii_uppercase:
        database = Path(letter + ':\\', '_Serato_', 'Library', 'location.sqlite')
        try:
            if database.is_file():
                found.append((letter + ':', database))
        except OSError:
            continue
    return found


def _all_songs():
    """Songs Serato knows (its location.sqlite assets, read only) that can carry cues here."""
    paths = []
    for drive, database in _libraries():
        connection = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True)
        try:
            for (pid,) in connection.execute('SELECT portable_id FROM asset ORDER BY id'):
                if file_format(pid):
                    paths.append(drive + '\\' + pid.replace('/', '\\'))
        except sqlite3.Error:
            continue
        finally:
            connection.close()
    return paths


def _delta_for(path, kind, facts, region, cues, info, allow_grow):
    """tag_delta for these cues, from the song's cached facts if this exact payload size was worked out before."""
    color = _default_color(path)
    kept = [e for e in info['entries'] if e[0] != 'CUE']
    key = f"{len(encode_markers2(cues, kept, color))}:{int(allow_grow)}"
    if key in facts['delta']:
        found = facts['delta'][key]
        return None if found < 0 else found
    delta = _tag_delta(path, cues, info, kind, color, allow_grow, region)
    with _CACHE['lock']:
        facts['delta'][key] = -1 if delta is None else delta
        _CACHE['dirty'] = True
    return delta


_KNOWN = {}  # location.sqlite -> (size, mtime, {casefolded portable ids}), so a preview does not read a library twice


def _known_assets(database):
    info = os.stat(database)
    cached = _KNOWN.get(str(database))
    if cached and cached[:2] == (info.st_size, info.st_mtime_ns):
        return cached[2]
    connection = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True)
    try:
        ids = {row[0].casefold() for row in connection.execute('SELECT portable_id FROM asset')}
    finally:
        connection.close()
    _KNOWN[str(database)] = (info.st_size, info.st_mtime_ns, ids)
    return ids


def _mark_not_in_serato(rows):
    """Songs whose drive has no Serato library, or that Serato's library on that drive does not list, get row['not_in_serato']
    (a note only: cue points are saved in the file and Serato shows them when it adds the song). Nothing is marked when no
    Serato library is found at all."""
    try:
        libraries = {drive.upper(): database for drive, database in _libraries()}
        if not libraries:
            return
        known = {}
        for row in rows:
            if row['skip_reason'] == 'The file is not there' or not row['format']:
                continue
            drive = ntpath.splitdrive(row['path'])[0].upper()
            if drive not in libraries:
                row['not_in_serato'] = True
                continue
            if drive not in known:
                known[drive] = _known_assets(libraries[drive])
            relative = ntpath.splitdrive(row['path'])[1].lstrip('\\/').replace('\\', '/').casefold()
            if relative not in known[drive]:
                row['not_in_serato'] = True
    except Exception:
        return


_CODES = (('Only MP3', 'cannot_read'), ('The file is not there', 'missing'), ('could not be read', 'cannot_read'),
          ('already has', 'has_cues'), ('No cues found', 'no_cues'), ('Not enough space', 'no_room'), ('changed since', 'changed'))


def _reason_code(row):
    for prefix, code in _CODES:
        if prefix in row['skip_reason']:
            return code
    return ''


def _plan(payload):
    from windows_cue_jobs import progress
    requested = _requested(payload)
    if requested is None:
        progress(0, 0, 'Listing the songs in Serato', 'checking')
        requested = _all_songs()
    allow_grow = _allow_grow(payload)
    sources, rows, seen = _Sources(), [], set()
    total = len(requested)
    for number, path in enumerate(requested):
        key = _key(path)
        if key in seen:
            continue
        seen.add(key)
        title = os.path.splitext(ntpath.basename(path))[0]
        progress(number, total, title, 'checking')
        row = {'path': path, 'title': title, 'format': file_format(path) or '',
               'existing_cues': 0, 'source': '', 'cues': [], 'skip_reason': '', 'signature': [], 'will_write': False,
               'grows_by': 0, 'mode': ''}
        rows.append(row)
        if not row['format']:
            row['skip_reason'] = 'Only MP3, MP4 and M4A files can carry Serato cues'
            continue
        try:
            row['signature'] = _signature(path)
            facts, region = _facts_for(path, row['format'], row['signature'])
            info = _info_of(facts, row['format'])
        except OSError:
            row['skip_reason'] = 'The file is not there'
            continue
        except Exception:
            row['skip_reason'] = "The song's Serato tags could not be read; left alone"
            continue
        row['existing_cues'] = max(len(info['cues']), info['v1_cues'])
        if row['existing_cues']:
            row['skip_reason'] = f"Serato already has {row['existing_cues']} cue(s); left alone"
            continue
        row['source'], cues = _source_cues(sources, path)
        row['cues'] = [dict(c) for c in cues]
        if not row['cues']:
            row['skip_reason'] = 'No cues found in PEAK HOUR, VirtualDJ or djay'
            continue
        try:
            delta = _delta_for(path, row['format'], facts, region, row['cues'], info, allow_grow)
        except OSError:
            row['skip_reason'] = 'The file is not there'
            row['cues'] = []
            continue
        if delta is None:
            row['skip_reason'] = NO_ROOM
            continue
        row['grows_by'] = delta
        row['mode'] = f'file grows by {delta:,} bytes' if delta else 'in place'
        row['will_write'] = True
    save_cache()
    _mark_not_in_serato(rows)
    return {'songs': rows, 'digest': digest(payload)}


def _public(plan):
    rows = [dict(row, code='' if row['will_write'] else _reason_code(row)) for row in plan['songs']]
    count = lambda code: sum(1 for r in rows if r['code'] == code)
    return {'success': True, 'songs': rows, 'digest': plan['digest'], 'recovered_after_interrupt': _state['recovered'],
            'counts': {'already_have_cues': count('has_cues'), 'no_cues_to_copy': count('no_cues'), 'file_not_found': count('missing'),
                       'cannot_read': count('cannot_read'), 'no_room': count('no_room'),
                       'not_in_serato': sum(1 for r in rows if r.get('not_in_serato')),
                       'songs_to_write': sum(r['will_write'] for r in rows),
                       'cues_to_write': sum(len(r['cues']) for r in rows if r['will_write']),
                       'skipped': sum(not r['will_write'] for r in rows),
                       'songs_growing': sum(1 for r in rows if r['will_write'] and r['grows_by']),
                       'bytes_added': sum(r['grows_by'] for r in rows if r['will_write'])},
            'sources_order': [LABELS[s] for s in SOURCES], 'writes_to': 'nothing (preview)'}


def preview(payload=None):
    """What apply would do, per song. Reads files and databases read-only and writes nothing."""
    return _public(_plan(payload))


RULE_VERSION = 3  # bump when the rules for what gets written change


def _allow_grow(payload):
    """Songs with no room in their tag get a bigger file unless the request says allow_grow: false."""
    return not (isinstance(payload, dict) and payload.get('allow_grow') is False)


def digest(payload=None):
    """Stable hash of the request (the song list, or "all", and the rule version). It does not plan, so it is cheap and
    does not change when unrelated songs change; each song is re-checked on its own when it is written."""
    requested = _requested(payload)
    listing = 'all' if requested is None else sorted({_key(p) for p in requested})
    return hashlib.sha256(json.dumps({'rules': RULE_VERSION, 'tracks': listing, 'grow': _allow_grow(payload)},
                                     sort_keys=True).encode()).hexdigest()


# ------------------------------------------------------------------ apply / undo

def _fsync_file(path):
    with open(path, 'rb+') as handle:
        os.fsync(handle.fileno())


def _fsync_dir(path):
    """Flush a directory entry where the platform allows it (best effort; Windows may refuse to open a folder)."""
    try:
        fd = os.open(str(path), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def _save(folder, receipt):
    stage = folder / 'receipt.json.tmp'
    with open(stage, 'w', encoding='utf-8') as handle:
        handle.write(json.dumps(receipt, indent=1))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(stage, folder / 'receipt.json')
    _fsync_dir(folder)


SKIP_CODES = ('changed', 'no_space', 'in_use')
NO_ROOM = 'Not enough space in the tag, and growing the file is switched off. Left alone.'
PAUSE_SECONDS = 0.05  # between songs, so a live set is never starved of disk time
RESERVE_BYTES = 200 * 1024 * 1024


class _Background:
    """Windows background mode for this thread (low CPU and I/O priority) while songs are written."""

    def __enter__(self):
        self.on = False
        try:
            import ctypes
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.GetCurrentThread.restype = ctypes.c_void_p
            kernel.SetThreadPriority.argtypes = [ctypes.c_void_p, ctypes.c_int]
            self.kernel = kernel
            self.on = bool(kernel.SetThreadPriority(kernel.GetCurrentThread(), 0x00010000))  # THREAD_MODE_BACKGROUND_BEGIN
        except Exception:
            pass
        return self

    def __exit__(self, *exc):
        if self.on:
            self.kernel.SetThreadPriority(self.kernel.GetCurrentThread(), 0x00020000)  # THREAD_MODE_BACKGROUND_END


def _write_one(row, folder, number, receipt):
    """Build the new tag on a temp copy, check it, back the song up, patch only the changed bytes into the real
    file, restore its dates, verify. Raises code 'no_space' / 'changed' when the song is skipped."""
    path = row['path']
    before = _stat(path)
    if [before['size'], before['mtime_ns']] != list(row['signature']):
        raise SeratoCueError('The file changed since the preview; left alone.', 'changed')
    kind = file_format(path)
    info = inspect(path)
    if info['cues'] or info['v1_cues']:
        raise SeratoCueError('Serato has cues in this song now; left alone.', 'changed')
    audio = audio_fingerprint(path)
    stage = folder / 'work' / f'.{ntpath.basename(path)}.peakhour-{uuid.uuid4().hex[:8]}.tmp'
    stage.parent.mkdir(exist_ok=True)
    receipt['pending_temp'] = str(stage)
    _save(folder, receipt)
    try:
        grow = bool(row.get('grows_by'))
        shutil.copyfile(path, stage)
        _write_tags(str(stage), row['cues'], info, kind, _default_color(path), _grow_padding if grow else _keep_padding)
        new_size = os.path.getsize(stage)
        ranges = None
        if grow:
            if not before['size'] < new_size <= before['size'] + MAX_GROW:
                raise SeratoCueError('The song would change size in an unexpected way. Left alone.', 'no_space')
        else:
            if new_size != before['size']:
                raise SeratoCueError(NO_ROOM, 'no_space')
            ranges = _diff_ranges(path, stage, _tag_regions(path, kind))
            protected = _audio_ranges(path, kind)
            if not ranges or any(s < pe and e > ps for s, e in ranges for ps, pe in protected):
                raise SeratoCueError('The new tag would touch the audio. Left alone.', 'no_space')
        _check_written(str(stage), row['cues'], info, audio, kind)
        if grow and kind == 'mp4':  # the sample offsets moved with the tag: the sound must still decode the same
            _check_decode(path, str(stage))
        backup = folder / 'files' / f'{number:04d}-{ntpath.basename(path)}'
        backup.parent.mkdir(exist_ok=True)
        shutil.copy2(path, backup)
        _fsync_file(backup)  # the backup is on disk before the song is touched
        _fsync_dir(backup.parent)
        before_sha = _file_sha(backup)
        if before_sha != _file_sha(path):
            raise SeratoCueError('The backup copy did not match the song. Nothing was changed.', 'write_failed')
        entry = {'path': path, 'backup': str(backup), 'before_sha256': before_sha, 'status': 'patching', 'cues': len(row['cues']),
                 'mtime_ns': before['mtime_ns'], 'atime_ns': before['atime_ns'], 'size': before['size'],
                 'after_sha256': _file_sha(stage), 'new_size': new_size, 'grew': grow,
                 'started_ns': time.time_ns()}  # the song will be exactly the temp copy; started_ns tells a torn write from a later edit
        _ensure_closed()  # last look, right before the song is touched
        try:
            handle = _open_exclusive(path)  # nobody else has the song open while it is changed
        except SeratoCueError:
            backup.unlink(missing_ok=True)
            raise
        receipt['files'].append(entry)
        _save(folder, receipt)
        try:
            try:
                if grow:
                    _rewrite_in_place(handle, str(stage))
                else:
                    _patch_in_place(handle, str(stage), ranges)
            finally:
                handle.close()
            os.utime(path, ns=(before['atime_ns'], before['mtime_ns']))
            after = _stat(path)
            if after['size'] != new_size or after['mtime_ns'] != before['mtime_ns'] or after['ino'] != before['ino'] \
                    or after['created'] != before['created']:
                raise SeratoCueError('The song changed size, identity or date; it was put back.', 'verify_failed')
            if _file_sha(path) != entry['after_sha256']:
                raise SeratoCueError('The song did not read back as written; it was put back.', 'verify_failed')
            _check_written(path, row['cues'], info, audio, kind)
        except BaseException:
            _restore_in_place(path, backup, before)
            entry['status'] = 'restored'
            _save(folder, receipt)
            raise
        entry.update(status='written', after_sha256=_file_sha(path))
        return entry
    finally:
        receipt.pop('pending_temp', None)
        try:
            stage.unlink()
        except OSError:
            pass


SYNC_KEYS = ('virtualdj_sync', 'virtualdj_sync_undo')


def _plan_sync(receipt, key, songs):
    """Record in the receipt that VirtualDJ's file sizes still have to follow (state 'pending'); the caller saves the receipt and
    then calls _launch_sync. songs = [{'path', 'old_size', 'new_size'}]."""
    if not songs:
        return None
    receipt[key] = {'state': 'pending', 'songs': len(songs), 'payload': {'songs': songs}}
    return {'state': 'pending', 'songs': len(songs)}


def _launch_sync(folder, key):
    """Hand the sync to the write queue from a background thread: the queue applies it at once if VirtualDJ is closed, otherwise
    when it closes. A request thread never edits VirtualDJ's database."""
    threading.Thread(target=_run_sync, args=(Path(folder), key), daemon=True, name='serato-vdj-size-sync').start()


def _run_sync(folder, key):
    state = {'state': 'pending', 'message': 'The write queue is not running yet.'}
    try:
        receipt = json.loads((folder / 'receipt.json').read_text(encoding='utf-8'))
        payload = receipt[key]['payload']
        import windows_dj_write_queue as queue_module
        queue = queue_module.QUEUE
        if queue is not None and ('virtualdj', 'filesize_sync') in queue.appliers:
            lock = queue.program_lock('virtualdj') if hasattr(queue, 'program_lock') else threading.RLock()
            with lock:
                outcome = queue.submit('virtualdj', 'filesize_sync', payload)
            state = {'state': 'submitted' if outcome.get('queued') else 'done', 'id': outcome.get('id'),
                     'result': outcome.get('result')}
    except Exception as exc:
        log.warning('VirtualDJ file-size sync for %s failed: %s', folder.name, exc)
        state = {'state': 'failed', 'error': str(exc)}
    try:
        with _LOCK:  # after the write that started this has finished with the receipt
            receipt = json.loads((folder / 'receipt.json').read_text(encoding='utf-8'))
            receipt[key].update(state)
            _save(folder, receipt)
    except Exception as exc:
        log.warning('could not record the VirtualDJ file-size sync in %s: %s', folder, exc)


def resubmit_pending_syncs(root=None):
    """At start-up: size syncs that were recorded but never handed to the queue (PEAK HOUR closed first) go again."""
    try:
        base = Path(root) if root is not None else _root()
        receipts = list(base.glob('*/receipt.json'))
    except Exception:
        return 0
    count = 0
    for file in receipts:
        try:
            receipt = json.loads(file.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        for key in SYNC_KEYS:
            if isinstance(receipt.get(key), dict) and receipt[key].get('state') == 'pending':
                _launch_sync(file.parent, key)
                count += 1
    return count


def _programs_running():
    """The DJ programs that are open right now (fails closed: if the process list cannot be read, all of them)."""
    import windows_dj_write_queue as queue_module
    hook = _state['programs']
    try:
        if hook is not None:
            found = set(hook())
        elif queue_module.QUEUE is not None and hasattr(queue_module.QUEUE, 'running_programs'):
            found = set(queue_module.QUEUE.running_programs())
        else:
            from windows_serato_processes import snapshot_processes
            names = {ntpath.basename(exe).casefold() for _, exe in snapshot_processes()}
            found = {program for program, exes in queue_module.EXECUTABLES.items() if names & set(exes)}
    except Exception:
        found = set(queue_module.PROGRAMS)
    if _running():
        found.add('serato')
    return found


class SeratoNeedsQueue(SeratoCueError):
    """Raised (before anything is written, and so before any queue is touched) when songs have to grow while a DJ program is
    open. The caller lets go of every lock and then calls queue_for_later(); the queue watcher also treats the '_open' code as
    "wait until the program is closed" if it ever sees this."""

    def __init__(self, payload, running):
        super().__init__('Some songs need to get a little bigger, which is only done while no DJ program is open (' +
                         ', '.join(sorted(running)) + ' is open). PEAK HOUR will write them after it closes.', 'dj_open')
        self.payload = {key: value for key, value in (payload if isinstance(payload, dict) else {}).items() if key != 'confirm'}


def queue_for_later(payload):
    """Hand a job that cannot run now to the write queue as the fixed ('serato', 'cues') job. It is only appended (no apply-now
    path, no lock), and the watcher runs it once NO DJ program is open."""
    import windows_dj_write_queue as queue_module
    queue = queue_module.QUEUE
    if queue is None or ('serato', 'cues') not in queue.appliers or not hasattr(queue, 'enqueue'):
        raise SeratoCueError('Some songs need to get a little bigger, which is only done while no DJ program is open. '
                             'Close your DJ programs and try again. Nothing was written.', 'dj_open')
    outcome = queue.enqueue('serato', 'cues', payload)
    return {'success': True, 'queued': True, 'id': outcome['id'],
            'message': 'A DJ program is open \u2014 PEAK HOUR will write these cue points after you close it.'}


def _nearest_existing(path):
    path = Path(path)
    while not path.exists() and path.parent != path:
        path = path.parent
    return path


def apply(payload=None):
    """Write the previewed cues into songs that have no Serato cues. The song keeps its size, file identity and
    dates; a backup of each song written is kept. Songs that changed, or whose tag has no room, are skipped."""
    with _LOCK:
        plan = _plan(payload)  # planned once
        expected = payload.get('digest') if isinstance(payload, dict) else None
        if expected and expected != digest(payload):
            raise SeratoCueError('The song list changed since the preview. Preview again.', 'stale')
        signatures = payload.get('signatures') if isinstance(payload, dict) else None
        skipped = []
        for row in plan['songs']:
            if row['will_write'] and isinstance(signatures, dict) and row['path'] in signatures \
                    and list(signatures[row['path']]) != list(row['signature']):
                row['will_write'], row['skip_reason'] = False, 'The song changed since the preview. Left alone.'
                skipped.append({'path': row['path'], 'reason': row['skip_reason']})
        rows = [row for row in plan['songs'] if row['will_write']]
        summary = _public(plan)
        if not rows:
            return dict(summary, written=0, failed=[], skipped_now=skipped, backup_id='', message='Nothing to write.')
        if any(row.get('grows_by') for row in rows):
            running = _programs_running()
            if running:  # songs that get bigger are written only while no DJ program is open
                raise SeratoNeedsQueue(payload, running)
        _ensure_closed()
        total = sum(row['signature'][0] for row in rows)
        free = shutil.disk_usage(_nearest_existing(_root())).free
        if free < 2 * total + RESERVE_BYTES:
            raise SeratoCueError(f'Not enough free space on the backup drive: PEAK HOUR needs about '
                                 f'{(2 * total + RESERVE_BYTES) // (1024 * 1024)} MB for backups and has {free // (1024 * 1024)} MB. '
                                 'Nothing was written.', 'no_space')
        identifier = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
        folder = _root() / identifier
        (folder / 'files').mkdir(parents=True)
        receipt = {'kind': 'peakhour_serato_cues', 'id': identifier, 'created_at': time.time(), 'status': 'writing', 'files': []}
        _save(folder, receipt)
        _ACTIVE.add(identifier)
        try:
            failed = []
            stopped = False
            with _Background():
                for number, row in enumerate(rows):
                    if _jobs.cancelled():  # the page asked to stop: songs already written stay written (and can be undone)
                        stopped = True
                        break
                    _jobs.progress(number, len(rows), row['title'], 'writing', raise_on_cancel=False)
                    try:
                        _write_one(row, folder, number, receipt)
                        _cache_forget(row['path'])
                    except SeratoCueError as error:
                        if error.code == 'serato_open':
                            receipt['status'] = 'written' if any(e['status'] == 'written' for e in receipt['files']) else 'failed'
                            _save(folder, receipt)
                            raise
                        if error.code in SKIP_CODES:
                            skipped.append({'path': row['path'], 'reason': str(error)})
                        else:
                            failed.append({'path': row['path'], 'error': str(error), 'code': error.code})
                    except Exception as error:
                        failed.append({'path': row['path'], 'error': f'Could not write the cues ({error}). The song was left as it was.',
                                       'code': 'write_failed'})
                    _save(folder, receipt)
                    time.sleep(PAUSE_SECONDS)
            written = sum(1 for e in receipt['files'] if e['status'] == 'written')
            receipt['status'] = 'written' if written else 'failed'
            grown = [{'path': e['path'], 'old_size': e['size'], 'new_size': e['new_size']}
                     for e in receipt['files'] if e['status'] == 'written' and e.get('grew')]
            sync = _plan_sync(receipt, 'virtualdj_sync', grown)
            _save(folder, receipt)
            if sync is not None:
                _launch_sync(folder, 'virtualdj_sync')
            message = (f'Cues written to {written} song(s).' if written else 'No cues were written.') \
                + (f' {len(skipped)} left alone.' if skipped else '') + (f' {len(failed)} could not be written.' if failed else '')
            if written:
                message += (f' {len(grown)} got a little bigger (the sound is unchanged)' if grown else '') \
                    + '. Files keep their identity and date; a backup of each was kept and this can be undone.'
            if stopped:
                message += ' Cancelled before the rest were written.'
            return dict(summary, written=written, failed=failed, skipped_now=skipped, backup_id=identifier if written else '',
                        grown=len(grown), virtualdj_sync=sync, message=message, cancelled=stopped)
        finally:
            _ACTIVE.discard(identifier)


def cleanup_leftovers(root=None):
    """Remove temp files recorded by a write that never finished (PEAK HOUR closed or crashed mid-write)."""
    try:
        base = Path(root) if root is not None else _root()
        receipts = list(base.glob('*/receipt.json'))
    except Exception:
        return
    for file in receipts:
        try:
            receipt = json.loads(file.read_text(encoding='utf-8'))
            temp = receipt.get('pending_temp') if receipt.get('status') == 'writing' else None
            if temp and Path(temp).parent == file.parent / 'work':
                os.unlink(temp)
        except (OSError, ValueError):
            continue


TORN_SLACK_NS = 120 * 10 ** 9  # a torn write's mtime is within this of when the write began; a later edit is not


def _looks_torn(path, entry):
    """True if the song is plausibly what an interrupted write left: its size is between the old and the planned new size and
    nobody has touched it since the write began (its mtime is not later than that, give or take the write itself)."""
    try:
        info = os.stat(path)
    except OSError:
        return False
    low, high = sorted((entry.get('size', -1), entry.get('new_size', entry.get('size', -1))))
    started = entry.get('started_ns')
    return low <= info.st_size <= high and started is not None and info.st_mtime_ns <= started + TORN_SLACK_NS


def _save_current_copy(folder, entry, number):
    """Keep the song exactly as it is now, in the receipt folder, before anything is written over it."""
    copy = Path(folder) / 'files' / f"pre-restore-{number:04d}-{ntpath.basename(entry['path'])}"
    copy.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(entry['path'], copy)
    _fsync_file(copy)
    entry['pre_restore_copy'] = str(copy)
    return copy


def attention_list(root=None):
    """Songs an interrupted write left in a state PEAK HOUR will not repair by itself: [{'song', 'receipt', 'reason', 'copy'}]."""
    found = []
    try:
        base = Path(root) if root is not None else _root()
        files = list(base.glob('*/receipt.json'))
    except Exception:
        return found
    for file in files:
        try:
            receipt = json.loads(file.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        for entry in receipt.get('files', []):
            if entry.get('status') == 'needs_attention':
                found.append({'song': entry['path'], 'receipt': receipt.get('id'), 'reason': entry.get('reason', ''),
                              'copy': entry.get('pre_restore_copy', '')})
    return found


def start_recovery(root=None):
    """Run recover_interrupted on a background thread (start-up never waits for it)."""
    thread = threading.Thread(target=recover_interrupted, args=(root,), daemon=True, name='serato-cues-recovery')
    _state['recovery'] = thread
    thread.start()
    return thread


def recover_interrupted(root=None):
    """A write that PEAK HOUR never finished (closed, crashed or power loss) may have left a song half written. Songs still
    marked 'patching' are put back from their verified backup ONLY if they look exactly like an interrupted write (size between
    the old and the planned size, not modified since the write began), no DJ program is open, and the song can be opened
    exclusively; a copy of the song as it is now is kept first. Anything else becomes 'needs_attention' and is never
    overwritten automatically. Returns how many songs were restored."""
    try:
        base = Path(root) if root is not None else _root()
        receipts = list(base.glob('*/receipt.json'))
    except Exception:
        return 0
    if not receipts:
        return 0
    if _programs_running():  # a DJ program may have the song open: try again at the next start
        return 0
    count = 0
    for file in receipts:
        try:
            receipt = json.loads(file.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if receipt.get('kind') != 'peakhour_serato_cues' or receipt.get('status') != 'writing' or receipt.get('id') in _ACTIVE:
            continue
        for number, entry in enumerate(receipt.get('files', [])):
            if entry.get('status') != 'patching':
                continue
            path, backup = entry['path'], entry['backup']
            try:
                if not (os.path.isfile(backup) and _file_sha(backup) == entry['before_sha256'] and os.path.isfile(path)):
                    raise OSError('the backup or the song is missing, or the backup is damaged')
                if _file_sha(path) == entry['before_sha256']:  # the write never reached the song
                    entry['status'] = 'recovered'
                    continue
                if not _looks_torn(path, entry):
                    raise OSError('the song was changed after the interrupted write, so it is not overwritten')
                _save_current_copy(file.parent, entry, number)
                _restore_in_place(path, backup, entry, exclusive=True)
                if _file_sha(path) != entry['before_sha256']:
                    raise OSError('the song did not restore exactly')
                entry['status'] = 'recovered'
                count += 1
                log.warning('Restored %s from its backup after an interrupted write (%s)', path, receipt.get('id'))
            except Exception as exc:
                entry['status'] = 'needs_attention'
                entry['reason'] = str(exc)
                if 'pre_restore_copy' not in entry and os.path.isfile(path):
                    try:
                        _save_current_copy(file.parent, entry, number)
                    except OSError:
                        pass
                log.error('%s needs attention after an interrupted write: %s (backup %s)', path, exc, backup)
        receipt['status'] = 'interrupted'
        try:
            _save(file.parent, receipt)
        except OSError:
            pass
    _state['recovered'] += count
    return count


def undo(backup_id, confirm=False):
    """Put each song back as it was before that write, byte for byte, same file, original dates (Serato closed). A song
    changed since the write is left alone. A song an interrupted write may have left half done is restored from its verified
    backup; if it also looks edited after the interruption, this asks for confirm=True first (a copy of it is kept)."""
    if not isinstance(backup_id, str) or not re.fullmatch(r'[0-9A-Za-z_-]{1,64}', backup_id):
        raise SeratoCueError('Unknown backup.', 'bad_request')
    with _LOCK:
        folder = _root() / backup_id
        try:
            receipt = json.loads((folder / 'receipt.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            raise SeratoCueError('There is no such Serato cue backup.', 'bad_request') from None
        if receipt.get('kind') != 'peakhour_serato_cues' or receipt.get('status') not in ('written', 'partly_undone', 'writing', 'interrupted'):
            raise SeratoCueError('That write cannot be undone (it did not complete, or was undone already).', 'bad_request')
        _ensure_closed()
        doubtful = [e['path'] for e in receipt['files']
                    if e.get('status') == 'needs_attention' or (e.get('status') == 'patching' and not _looks_torn(e['path'], e))]
        if doubtful and not confirm:
            raise SeratoCueError('An interrupted write left ' + ', '.join(ntpath.basename(p) for p in doubtful) + ' in a state PEAK HOUR '
                                 'cannot be sure about: the song may have been changed since. Restoring it puts the original back '
                                 'and overwrites those changes (a copy of the song as it is now is kept). Confirm to restore it.',
                                 'confirm_needed')
        restored, skipped = [], []
        for number, entry in enumerate(receipt['files']):
            if entry.get('status') not in ('written', 'patching', 'needs_attention'):
                continue
            path, backup = entry['path'], entry['backup']
            backup_ok = os.path.isfile(backup) and _file_sha(backup) == entry['before_sha256']
            current = _file_sha(path) if os.path.isfile(path) else None
            interrupted = entry['status'] in ('patching', 'needs_attention')
            if interrupted and backup_ok:
                pass  # interrupted in the middle of the write: whatever the song holds now, the verified backup puts it right
            elif current not in (entry['before_sha256'], entry.get('after_sha256')):  # neither as it was, nor as PEAK HOUR wrote it
                skipped.append({'path': path, 'error': 'The song has changed since this write, so it was not restored.'})
                continue
            elif current == entry['before_sha256']:  # an interrupted write that never reached the song
                entry['status'] = 'undone'
                restored.append(path)
                continue
            if not backup_ok:
                skipped.append({'path': path, 'error': 'The backup copy is damaged. The song was not changed.'})
                continue
            _ensure_closed()
            if interrupted and current != entry['before_sha256'] and 'pre_restore_copy' not in entry:
                _save_current_copy(folder, entry, number)
            _restore_in_place(path, backup, entry)
            if _file_sha(path) != entry['before_sha256']:
                raise SeratoCueError('A song did not restore exactly; its backup is ' + backup, 'verify_failed')
            entry['status'] = 'undone'
            restored.append(path)
        cleanup_leftovers(_root())
        back = [{'path': e['path'], 'old_size': e['new_size'], 'new_size': e['size']} for e in receipt['files']
                if e.get('status') == 'undone' and e.get('grew') and e['path'] in restored]
        sync = _plan_sync(receipt, 'virtualdj_sync_undo', back)  # VirtualDJ's records follow the files back to their old size
        receipt.update(status='undone' if not skipped else 'partly_undone', undone_at=time.time())
        _save(folder, receipt)
        if sync is not None:
            _launch_sync(folder, 'virtualdj_sync_undo')
        return {'success': not skipped, 'restored': restored, 'skipped': skipped, 'backup_id': backup_id,
                'virtualdj_sync': sync}


# ------------------------------------------------------------------ queue and routes

def register_with_queue(queue):
    resubmit_pending_syncs()
    """Register Serato's 'cues' writer with the DJ write queue (windows_dj_write_queue)."""
    queue.register('serato', 'cues', apply, digest)


def create_blueprint(app, root=None, license_guard=None):
    from flask import Blueprint, jsonify, request
    configure(app=app, root=root)
    bp = Blueprint('windows_serato_cues', __name__)

    @bp.before_request
    def local_only():
        if request.remote_addr not in ('127.0.0.1', '::1'):
            return jsonify(success=False, error='Writing to Serato requires this PC'), 403
        origin = request.headers.get('Origin')
        if request.method != 'GET' and (not origin or origin.rstrip('/') != request.host_url.rstrip('/')):
            return jsonify(success=False, error='Writing to Serato requires a same-origin request'), 403

    def respond(action):
        try:
            result = action()
            if isinstance(result, tuple):  # (body, status): queued until Serato closes
                return jsonify(result[0]), result[1]
            return jsonify(result)
        except SeratoCueError as exc:
            return jsonify(success=False, error=str(exc), code=exc.code), 409 if exc.code in ('serato_open', 'changed', 'confirm_needed', 'dj_open') else 400
        except (ValueError, OSError) as exc:
            return jsonify(success=False, error=str(exc), code='error'), 400

    def _locked(action):
        from windows_dj_write_queue import program_locked  # an undo never runs during a write to the same program
        with program_locked('serato'):
            return action()

    def gated(action):
        gate = license_guard('Send cue points to Serato') if license_guard else None
        return gate if gate else respond(action)

    def job_or(action_now, data, kind, work):
        """Small requests answer at once; "all" or more than 50 songs start a background job and answer with its id."""
        if not _jobs.is_big(data):
            return gated(action_now)
        gate = license_guard('Send cue points to Serato') if license_guard else None
        if gate:
            return gate
        return jsonify(success=True, background=True, state='running', job_id=_jobs.start_job(kind, work))

    @bp.post('/api/windows/serato/cues/preview')
    def preview_route():
        data = request.get_json(silent=True) or {}
        return job_or(lambda: preview(data), data, 'serato-preview', lambda: preview(data))

    def queued_or_apply(data):
        from windows_dj_write_queue import queue_if_open
        payload = {key: value for key, value in data.items() if key != 'confirm'}
        try:
            result = queue_if_open('serato', 'cues', payload, 'Serato', lambda: apply(payload)) or apply(payload)
        except SeratoNeedsQueue as need:  # every lock is released by now; the job is only appended to the queue
            return queue_for_later(need.payload), 202
        body = result[0] if isinstance(result, tuple) else result
        if isinstance(body, dict) and body.get('queued'):  # waiting for a DJ program to close
            return body, 202
        return result

    _jobs.add_routes(bp, '/api/windows/serato/cues', 'serato')

    @bp.get('/api/windows/serato/cues/status')
    def status_route():
        return jsonify(success=True, recovered_after_interrupt=_state['recovered'], needs_attention=attention_list())

    @bp.post('/api/windows/serato/cues/apply')
    def apply_route():
        data = request.get_json(silent=True) or {}
        if data.get('confirm') is not True:
            return jsonify(success=False, error='Confirm before writing to Serato', code='bad_request'), 400
        def work():
            result = queued_or_apply(data)
            if isinstance(result, tuple):  # (body, status): the page reads the status from the job result
                return dict(result[0], http_status=result[1])
            return result
        return job_or(lambda: queued_or_apply(data), data, 'serato-apply', work)

    @bp.post('/api/windows/serato/cues/undo')
    def undo_route():
        data = request.get_json(silent=True) or {}
        return gated(lambda: _locked(lambda: undo(data.get('backup_id'), data.get('confirm') is True)))

    @bp.post('/api/windows/serato/folders/undo')
    def folders_undo_route():
        """Undo a crate / crate folder write (database, legacy .crate files, neworder.pref)."""
        from windows_serato_library import SeratoLibraryError, undo_crate_write
        data = request.get_json(silent=True) or {}

        def action():
            try:
                return _locked(lambda: undo_crate_write(data.get('backup_id')))
            except SeratoLibraryError as exc:
                code = getattr(exc, 'code', 'error')
                raise SeratoCueError(str(exc), code) from exc
        return gated(action)

    return bp
