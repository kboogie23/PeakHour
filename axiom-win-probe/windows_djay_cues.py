"""Send cue points (position, colour, name) to djay Pro's library on Windows.

Only songs that have no cues in djay yet are filled; a song that already has
cues in djay is left alone. Cues come from the first of these that has any,
the order PEAK HOUR shows them in: Serato, VirtualDJ (<Poi Type="cue"> in
database.xml, read only), then PEAK HOUR's own saved cues.

Public functions take and return plain JSON, so the write queue can call them
later without importing anything else:
  preview(payload)   what would be written; reads djay's library read-only
  apply(payload)     backs the library up, writes in one transaction, reads it
                     back, checks integrity, puts the backup back on any failure
  undo(backup_id)    puts the backed-up library back, byte for byte
  digest(payload)    stable hash of the preview, for a stale check before apply
payload is {"tracks": ["C:\\\\Music\\\\a.mp3", ...] or "all"}; apply also takes an
optional "digest" (from preview/digest): if the preview no longer hashes the
same, nothing is written (code 'stale').

djay must be closed. If it is open apply/undo raise DjayCueError with code
'djay_open' and write nothing. Cue records are written with replace_cues, then
re-laid the way djay lays them out: properties in djay's order (time, endTime,
comment, number, color), times at float32 precision, repeated strings as
references, and a default cue (no name, default or no colour) with only time,
endTime and number, as djay writes it.
"""
import hashlib
import json
import math
import ntpath
import os
import re
import sqlite3
import struct
import threading
import time
import uuid
from pathlib import Path

CUE_SLOTS = 8
CUE_PROPERTY_ORDER = (b'time', b'endTime', b'comment', b'number', b'color')
DEFAULT_COLOR = '#A3FF00'  # what PEAK HOUR shows for a cue without a colour
RULE_VERSION = 2  # part of the queue digest: bump when the cue rules change
SOURCES = ('serato', 'virtualdj', 'peakhour')
LABELS = {'serato': 'Serato', 'virtualdj': 'VirtualDJ', 'peakhour': 'PEAK HOUR'}
_USER_DATA = 'mediaItemUserData'
_LOCK = threading.Lock()


class DjayCueError(RuntimeError):
    """code: 'djay_open', 'stale', 'no_library', 'changed', 'verify_failed', 'write_failed', 'bad_request'."""

    def __init__(self, message, code='error'):
        super().__init__(message)
        self.code = code


# ------------------------------------------------------------------ configuration

_state = {'app': None, 'root': None, 'database': None, 'running': None, 'readers': {}, 'virtualdj_databases': None}


def configure(app=None, root=None, database=None, running=None, readers=None, virtualdj_databases=None):
    """Set what the module works on. Unset values fall back to the app / the real locations.

    root                where backups and receipts go
    database            djay's MediaLibrary.db (default app.DJAY_MEDIA_LIBRARY_DB)
    running             callable -> True while djay is open (default: Windows process list)
    readers             {'serato'|'virtualdj'|'peakhour': callable(path) -> [cue dicts]}
    virtualdj_databases callable -> VirtualDJ database.xml paths
    """
    for name, value in (('app', app), ('root', root), ('database', database), ('running', running),
                        ('virtualdj_databases', virtualdj_databases)):
        if value is not None:
            _state[name] = value
    if readers is not None:
        _state['readers'] = dict(readers)


def _database():
    database = _state['database'] or getattr(_state['app'], 'DJAY_MEDIA_LIBRARY_DB', '') or ''
    return os.path.abspath(str(database)) if database else ''


def _root():
    if _state['root'] is not None:
        return Path(_state['root'])
    cache = getattr(_state['app'], 'CACHE_PATH', None)
    if cache:
        return Path(cache).parent / 'djay-cue-writes'
    raise DjayCueError('No folder is set for djay cue backups.', 'no_library')


def _running():
    check = _state['running']
    if check is not None:
        return bool(check())
    import windows_djay
    return windows_djay.process_running('djay Pro', 'djay')


def _ensure_closed():
    if _running():
        raise DjayCueError('Quit djay Pro, then try again. Nothing was written.', 'djay_open')


# ------------------------------------------------------------------ small helpers

def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _state_sha(database):
    """Hash of the library file and its -wal: the whole library as djay would open it."""
    database = str(database)
    digest_ = hashlib.sha256(_file_sha(database).encode())
    wal = Path(database + '-wal')
    if wal.is_file():
        digest_.update(b'wal' + _file_sha(wal).encode())
    return digest_.hexdigest()


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


OPEN_NOTE = 'djay is open; this preview may be incomplete.'


def _readonly(database, closed=None):
    """Read-only connection. Only when djay is CLOSED and no -wal is pending is it opened immutable (so SQLite leaves no
    empty -wal/-shm files beside the library); while djay runs it is a plain read-only connection, because an immutable
    read of a library that is being written can be wrong."""
    wal = Path(str(database) + '-wal')
    if closed is None:
        try:
            closed = not _running()
        except Exception:
            closed = False
    quiet = closed and (not wal.exists() or wal.stat().st_size == 0)
    return sqlite3.connect(Path(database).as_uri() + '?mode=ro' + ('&immutable=1' if quiet else ''), uri=True)


def _open_note():
    try:
        return OPEN_NOTE if _running() else ''
    except Exception:
        return OPEN_NOTE


def _swap_file(target, data):
    """Write data next to target, flush it, then swap it in."""
    target = Path(target)
    stage = target.with_name(f'.{target.name}.peakhour-{uuid.uuid4().hex[:8]}.tmp')
    try:
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


# ------------------------------------------------------------------ cue sources

def _app_reader(name):
    if name == 'serato':  # Serato's cues are read from the tag region of the song only (and cached), never the whole file
        from windows_serato_cues import serato_cues_for
        return serato_cues_for
    app = _state['app']
    attribute = {'serato': 'read_serato_cues', 'peakhour': 'read_cues'}.get(name)
    reader = getattr(app, attribute, None) if attribute else None
    return reader if callable(reader) else None


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
            reader = _app_reader(name)
        if reader is None:
            return []
        try:
            return reader(path) or []
        except Exception:
            return []


def _clean(cues):
    """Valid, one-per-slot cues as [{slot, seconds, name, color, ms}] sorted by slot (slot is djay's 1-based number)."""
    result, used = [], set()
    for order, cue in enumerate(cues if isinstance(cues, list) else []):
        if not isinstance(cue, dict):
            continue
        index = cue.get('index', order)
        milliseconds = _float(cue.get('time_ms'))
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < CUE_SLOTS \
                or milliseconds is None or milliseconds < 0 or index in used:
            continue
        used.add(index)
        name = str(cue.get('label') or '').strip()
        if re.fullmatch(r'(?i)cue\s*\d+', name):
            name = ''
        text = str(cue.get('color') or '').strip()
        color = ('#' + text.lstrip('#').upper()) if re.fullmatch(r'#?[0-9A-Fa-f]{6}', text) else DEFAULT_COLOR
        milliseconds = int(round(milliseconds))
        result.append({'slot': index + 1, 'seconds': milliseconds / 1000.0, 'name': name[:60], 'color': color})
    return sorted(result, key=lambda c: c['slot'])


def _source_cues(sources, path):
    for name in SOURCES:
        cues = _clean(sources.read(name, path))
        if cues:
            return name, cues
    return '', []


# ------------------------------------------------------------------ djay's property order

_FORMATS = {15: 'b', 16: 'h', 17: 'i', 18: 'q', 19: 'f', 20: 'd', 22: 'd', 48: 'd'}
_OBJECT_ALIASES = {2: 'B', 3: 'H', 4: 'I'}
_STRING_ALIASES = {5: 'B', 6: 'H', 7: 'I'}
_PAIRS, _ITEMS = (9, 24), (9, 10, 11, 12, 24, 25, 26, 27)


class _Str:
    """A FastCoding string: a literal, or an alias of an earlier literal (ref)."""
    __slots__ = ('text', 'ref', 'tag')

    def __init__(self, text=None, ref=None, tag=8):
        self.text, self.ref, self.tag = text, ref, tag

    def value(self):
        return self.text if self.ref is None else self.ref.text


def _parse(blob):
    pos, table = [20], []

    def take(fmt):
        size = struct.calcsize(fmt)
        pos[0] += (size - pos[0] % size) % size
        value = struct.unpack_from('<' + fmt, blob, pos[0])[0]
        pos[0] += size
        return value

    def token(depth=0):
        if depth > 40:
            raise ValueError('djay record nesting limit')
        tag = blob[pos[0]]
        pos[0] += 1
        if tag in (0, 1, 13, 14, 45, 46):
            return ('raw', tag)
        if tag in _FORMATS:
            return ('num', tag, _FORMATS[tag], take(_FORMATS[tag]))
        if tag in _OBJECT_ALIASES:
            return ('objref', tag, _OBJECT_ALIASES[tag], take(_OBJECT_ALIASES[tag]))
        if tag in _STRING_ALIASES:
            index = take(_STRING_ALIASES[tag])
            if index >= len(table):
                raise ValueError('djay string alias out of range')
            return _Str(ref=table[index], tag=tag)
        if tag == 8:
            end = blob.index(0, pos[0])
            node = _Str(text=bytes(blob[pos[0]:end]))
            pos[0] = end + 1
            table.append(node)
            return node
        if tag in _ITEMS:
            count = take('I')
            if count > 100000:
                raise ValueError('djay record count limit')
            return ('col', tag, [token(depth + 1) for _ in range(count * (2 if tag in _PAIRS else 1))])
        if tag == 43:
            cls, pairs = token(depth + 1), []
            while blob[pos[0]] != 0:
                value = token(depth + 1)
                pairs.append((value, token(depth + 1)))
            pos[0] += 1
            return ('obj', cls, pairs)
        if tag in (21, 28):
            size = take('I')
            data = bytes(blob[pos[0]:pos[0] + size])
            pos[0] += size
            pos[0] += (4 - pos[0] % 4) % 4
            return ('data', tag, data)
        raise ValueError(f'Unsupported djay FastCoding tag {tag}')

    root = token()
    if pos[0] != len(blob):
        raise ValueError('Trailing djay data')
    return root


def _emit(blob, root):
    out, indexes = bytearray(blob[:20]), {}

    def put(fmt, value):
        size = struct.calcsize(fmt)
        out.extend(bytes((size - len(out) % size) % size))
        out.extend(struct.pack('<' + fmt, value))

    def write(node):
        if isinstance(node, _Str):
            if node.ref is None:
                indexes[id(node)] = len(indexes)
                out.extend(b'\x08' + node.text + b'\x00')
            else:
                if id(node.ref) not in indexes:
                    raise ValueError('djay string alias would come before its string')
                out.append(node.tag)
                put(_STRING_ALIASES[node.tag], indexes[id(node.ref)])
            return
        kind = node[0]
        if kind == 'raw':
            out.append(node[1])
        elif kind in ('num', 'objref'):
            out.append(node[1])
            put(node[2], node[3])
        elif kind == 'col':
            out.append(node[1])
            put('I', len(node[2]) // (2 if node[1] in _PAIRS else 1))
            for item in node[2]:
                write(item)
        elif kind == 'obj':
            out.append(43)
            write(node[1])
            for value, key in node[2]:
                write(value)
                write(key)
            out.append(0)
        else:  # data
            out.append(node[1])
            put('I', len(node[2]))
            out.extend(node[2])
            out.extend(bytes((4 - len(out) % 4) % 4))

    write(root)
    return bytes(out)


def _reorder_cues(node):
    """Put every ADCCuePoint's properties in djay's order, in place; returns how many cues were reordered."""
    count = 0
    if isinstance(node, tuple):
        if node[0] == 'col':
            for item in node[2]:
                count += _reorder_cues(item)
        elif node[0] == 'obj':
            if node[1].value() == b'ADCCuePoint':
                ranks = []
                for value, key in node[2]:
                    name = key.value() if isinstance(key, _Str) else None
                    if name not in CUE_PROPERTY_ORDER:
                        raise ValueError('Unexpected property in a djay cue')
                    ranks.append(CUE_PROPERTY_ORDER.index(name))
                node[2][:] = [pair for _rank, pair in sorted(zip(ranks, node[2]), key=lambda item: item[0])]
                count += 1
            for value, _key in node[2]:
                count += _reorder_cues(value)
    return count


def djay_property_order(blob):
    """blob with every cue's properties in djay's order: time, endTime, comment, number, color.

    The record is parsed and written back token by token (alignment and string
    references recomputed); the unchanged parse must reproduce the input byte
    for byte first, or nothing is returned.
    """
    blob = bytes(blob)
    if blob[:8] != b'TSAF\x03\x00\x03\x00' or len(blob) < 21:
        raise ValueError('Unsupported djay record')
    root = _parse(blob)
    if _emit(blob, root) != blob:
        raise ValueError('Cannot re-lay this djay record exactly; no cues were written.')
    _reorder_cues(root)
    return _emit(blob, root)


def _f32(value):
    """value rounded to float32 precision (djay stores float32 times, widened to doubles)."""
    return struct.unpack('<f', struct.pack('<f', value))[0]


def _strings(node):
    """Every _Str of a parsed record, in the order the writer emits them."""
    if isinstance(node, _Str):
        yield node
    elif isinstance(node, tuple) and node[0] == 'col':
        for item in node[2]:
            yield from _strings(item)
    elif isinstance(node, tuple) and node[0] == 'obj':
        yield from _strings(node[1])
        for value, key in node[2]:
            yield from _strings(value)
            yield from _strings(key)


def _cue_objects(node):
    if isinstance(node, tuple):
        if node[0] == 'col':
            for item in node[2]:
                yield from _cue_objects(item)
        elif node[0] == 'obj':
            if node[1].value() == b'ADCCuePoint':
                yield node
            for value, _key in node[2]:
                yield from _cue_objects(value)


def _smallest_refs(node):
    """Write every object reference with the smallest tag that holds its index (djay does; PEAK HOUR's codec uses 4 bytes)."""
    def shrink(item):
        if isinstance(item, tuple) and item[0] == 'objref':
            tag, fmt = (2, 'B') if item[3] < 1 << 8 else (3, 'H') if item[3] < 1 << 16 else (4, 'I')
            return ('objref', tag, fmt, item[3])
        _smallest_refs(item)
        return item
    if isinstance(node, tuple) and node[0] == 'col':
        node[2][:] = [shrink(item) for item in node[2]]
    elif isinstance(node, tuple) and node[0] == 'obj':
        node[2][:] = [(shrink(value), key) for value, key in node[2]]


def _is_default_cue(node):
    """True for a cue with no name and no colour (or djay's default colour): djay writes neither property for it."""
    seen = {key.value(): value for value, key in node[2]}
    comment, color = seen.get(b'comment'), seen.get(b'color')
    return (comment is None or (isinstance(comment, _Str) and comment.value() == b'')) \
        and (color is None or (isinstance(color, _Str) and color.value().upper() == DEFAULT_COLOR.encode()))


def djay_default_cues(blob, seconds_by_slot=None, fix_header=False):
    """blob with djay's own cue layout: float32 times, and no comment/color on a default cue.

    A default cue (no name, default or no colour) is written by djay as only
    time, endTime and number. Named or coloured cues keep all five properties.
    seconds_by_slot ({slot number: seconds}) gives the exact time to round to float32;
    without it the stored double is rounded. The record is re-laid token by token
    (alignment and string aliases recomputed). The header's string count is set to the
    number of strings written when it matched before, or always with fix_header.
    """
    blob = bytes(blob)
    root = _parse(blob)
    if _emit(blob, root) != blob:
        raise ValueError('Cannot re-lay this djay record exactly; no cues were written.')
    cues = list(_cue_objects(root))
    removed, strings = set(), list(_strings(root))
    for cue in cues:
        pairs = cue[2]
        slot = next((v[3] for v, k in pairs if k.value() == b'number' and isinstance(v, tuple) and v[0] == 'num'), None)
        for index, (value, key) in enumerate(pairs):
            if key.value() == b'time' and isinstance(value, tuple) and value[0] == 'num' and value[2] == 'd':
                seconds = (seconds_by_slot or {}).get(slot, value[3])
                pairs[index] = (('num', value[1], value[2], _f32(float(seconds))), key)
        if _is_default_cue(cue):
            for value, key in pairs:
                if key.value() in (b'comment', b'color'):
                    removed.update(id(s) for s in _strings(value))
                    removed.update(id(s) for s in _strings(key))
            cue[2][:] = [(v, k) for v, k in pairs if k.value() not in (b'comment', b'color')]
    for literal in [s for s in strings if s.ref is None and id(s) in removed]:
        aliases = [s for s in strings if s.ref is literal and id(s) not in removed]
        if aliases:  # a later reference now carries the text itself; the others point at that one
            first = aliases[0]
            first.text, first.ref, first.tag = literal.text, None, 8
            for other in aliases[1:]:
                other.ref = first
    if fix_header:  # PEAK HOUR's cue codec writes every string out in full; djay refers back to a repeated string
        seen = {}
        for s in _strings(root):
            if s.ref is None and s.text in seen:
                index = seen[s.text][1]
                s.ref, s.tag, s.text = seen[s.text][0], 5 if index < 1 << 8 else 6 if index < 1 << 16 else 7, None
            elif s.ref is None:
                seen[s.text] = (s, len(seen))
    if fix_header:
        _smallest_refs(root)
    old_count = struct.unpack_from('<I', blob, 16)[0]
    literals = sum(1 for s in strings if s.ref is None)
    result = bytearray(_emit(blob, root))
    if fix_header or old_count == literals:
        struct.pack_into('<I', result, 16, sum(1 for s in _strings(root) if s.ref is None))
    return bytes(result)


def encode_cues(blob, cues):
    """The djay user-data record with these cues ([{index, time_ms, label, color}]) written, in djay's layout.

    Property order time, endTime, comment, number, color; times at float32 precision;
    a cue without a name and with no (or the default) colour has no comment/color at all.
    Repeated strings are written as references, as djay does.
    A cue may carry 'seconds' (its exact time) next to the whole-millisecond 'time_ms' the codec needs.
    """
    import utils.djay_cue_codec as codec
    written = bytes(codec.replace_cues(bytes(blob), [{k: v for k, v in c.items() if k != 'seconds'} for c in cues]))
    seconds = {float(c['index'] + 1): float(c.get('seconds', float(c['time_ms']) / 1000.0)) for c in cues}
    result = djay_default_cues(djay_property_order(written), seconds, fix_header=True)
    if codec.read_cues(result) != codec.read_cues(written) \
            or _without_defaults(codec.decode_djay_record(result), seconds) != _without_defaults(codec.decode_djay_record(written), seconds):
        raise ValueError('Re-laying the cues changed the record; no cues were written.')
    return result


def _without_defaults(record, seconds):
    """A decoded user-data record with default cues stripped of comment/color and times at float32 precision."""
    record = dict(record)
    cues = []
    for cue in record.get('cuePoints') or []:
        cue = dict(cue)
        if cue.get('comment', '') == '' and str(cue.get('color', DEFAULT_COLOR)).upper() == DEFAULT_COLOR:
            cue.pop('comment', None)
            cue.pop('color', None)
        if isinstance(cue.get('time'), float):
            cue['time'] = _f32(float(seconds.get(float(cue.get('number')), cue['time'])))
        cues.append(cue)
    if 'cuePoints' in record:
        record['cuePoints'] = cues
    return record


def _codec_cues(row):
    return [{'index': c['slot'] - 1, 'time_ms': int(round(c['seconds'] * 1000)), 'label': c['name'], 'color': c['color']}
            for c in row['cues']]


# ------------------------------------------------------------------ preview

def _requested(payload):
    tracks = payload.get('tracks', 'all') if isinstance(payload, dict) else payload
    if tracks is None or tracks == 'all':
        return None
    if not isinstance(tracks, list):
        raise DjayCueError('Choose songs, or "all".', 'bad_request')
    paths = []
    for entry in tracks:
        path = entry.get('path') if isinstance(entry, dict) else entry
        if not isinstance(path, str) or not path:
            raise DjayCueError('A song in the list has no file path.', 'bad_request')
        paths.append(path)
    return paths


def _plan(payload):
    database = _database()
    if not database or not os.path.isfile(database):
        raise DjayCueError('djay Pro has no library on this PC yet.', 'no_library')
    requested = _requested(payload)
    from utils.dj_transfer import read_djay_tracks
    import utils.dj_track_colors as colors
    from windows_cue_jobs import progress
    progress(0, 0, "Reading djay's library", 'checking')
    tracks, errors = read_djay_tracks([database])
    by_key = {_key(path): track for path, track in (tracks or {}).items()}
    if requested is None:
        requested = list(tracks or {})
    sources, rows, seen = _Sources(), [], set()
    note = _open_note()
    try:
        connection = _readonly(database, closed=not note)
    except sqlite3.Error as error:
        raise DjayCueError(f'{note or "djay library could not be opened."} ({error}) Try again in a moment.', 'busy') from error
    try:
        total = len(requested)
        for number, path in enumerate(requested):
            key = _key(path)
            if key in seen:
                continue
            seen.add(key)
            progress(number, total, os.path.splitext(ntpath.basename(path))[0], 'checking')
            row = {'path': path, 'title': '', 'djay_found': False, 'djay_key': '', 'existing_cues': 0, 'source': '',
                   'cues': [], 'skip_reason': '', 'user_sha256': '', 'will_write': False}
            track = by_key.get(key)
            if track is None:
                row['skip_reason'] = 'Not in the djay library'
                rows.append(row)
                continue
            row.update(djay_found=True, djay_key=track.get('key') or track.get('djay_uuid') or '',
                       title=track.get('title') or '')
            found = connection.execute('SELECT data FROM database2 WHERE collection=? AND key=?',
                                       (_USER_DATA, row['djay_key'])).fetchone()
            if found is None:
                row['skip_reason'] = 'djay has no record for this song yet; open it once in djay'
            else:
                blob = bytes(found[0])
                row['user_sha256'] = _sha(blob)
                try:
                    cues = colors.decode_djay_record(blob).get('cuePoints') or []
                    row['existing_cues'] = len(cues)
                except Exception:
                    row['skip_reason'] = "djay's record for this song could not be read"
            if not row['skip_reason'] and row['existing_cues']:
                row['skip_reason'] = f"djay already has {row['existing_cues']} cue(s); left alone"
            if not row['skip_reason']:
                row['source'], row['cues'] = _source_cues(sources, path)
                if not row['cues']:
                    row['skip_reason'] = 'No cues found in Serato, VirtualDJ or PEAK HOUR'
            row['will_write'] = bool(row['cues']) and not row['skip_reason']
            rows.append(row)
    except sqlite3.Error as error:
        raise DjayCueError(f'{note or "djay library could not be read."} ({error}) Try again in a moment.', 'busy') from error
    finally:
        connection.close()
        try:
            from windows_serato_cues import save_cache
            save_cache()
        except Exception:
            pass
    # The job digest names only WHAT was asked (songs + rule version): djay and the cue sources change during a gig, so
    # each song is checked again when the write runs and is skipped (with a reason) if it changed or now has cues.
    token = _sha(json.dumps([_key(database), RULE_VERSION, sorted(_key(p) for p in requested)], sort_keys=True).encode())
    return {'database': database, 'songs': rows, 'digest': token, 'library_errors': len(errors or []), 'note': note}


def _public(plan):
    rows = [{k: v for k, v in row.items()} for row in plan['songs']]
    return {'success': True, 'database': plan['database'], 'songs': rows, 'digest': plan['digest'],
            'counts': {'songs_to_write': sum(r['will_write'] for r in rows),
                       'cues_to_write': sum(len(r['cues']) for r in rows if r['will_write']),
                       'skipped': sum(not r['will_write'] for r in rows)},
            'sources_order': [LABELS[s] for s in SOURCES], 'note': plan.get('note', ''), 'writes_to': 'nothing (preview)'}


def preview(payload=None):
    """What apply would do, per song. Reads djay's library read-only and writes nothing."""
    return _public(_plan(payload))


def digest(payload=None):
    """Stable hash of what would be written (songs, their djay records, the cues); equal while nothing relevant changed."""
    return _plan(payload)['digest']


# ------------------------------------------------------------------ apply / undo

def _others(connection, keys):
    """Hash of every row of database2 except the user-data rows of these keys."""
    digest_ = hashlib.sha256()
    for row in connection.execute('SELECT rowid, collection, key, data, metadata FROM database2 ORDER BY rowid'):
        if row[1] == _USER_DATA and row[2] in keys:
            continue
        digest_.update(repr((row[0], row[1], row[2], bytes(row[3]) if row[3] is not None else None,
                             bytes(row[4]) if row[4] is not None else None)).encode())
    return digest_.hexdigest()


def _write(database, rows, skipped):
    """Write the cues of every row that is still as previewed, in one transaction. A song that djay changed since, or
    that now has cues, is left alone and added to `skipped` with a reason. Returns (hash of all other rows, rows written)."""
    import utils.djay_cue_codec as codec
    import utils.dj_track_colors as colors
    keys = {row['djay_key'] for row in rows}
    written = []
    connection = sqlite3.connect(database, isolation_level=None, timeout=5)
    try:
        connection.execute('BEGIN IMMEDIATE')
        before = _others(connection, keys)
        for row in rows:
            found = connection.execute('SELECT data FROM database2 WHERE collection=? AND key=?',
                                       (_USER_DATA, row['djay_key'])).fetchone()
            if found is None:
                skipped.append(dict(row, will_write=False, skip_reason='djay no longer has a record for this song; left alone'))
                continue
            if _sha(bytes(found[0])) != row['user_sha256']:
                try:
                    now_cues = len(colors.decode_djay_record(bytes(found[0])).get('cuePoints') or [])
                except Exception:
                    now_cues = None
                if now_cues is None or now_cues:
                    skipped.append(dict(row, will_write=False, skip_reason=(
                        f'djay now has {now_cues} cue(s) for this song; left alone' if now_cues else
                        "djay's record for this song changed and could not be read; left alone")))
                    continue
                row = dict(row, user_sha256=_sha(bytes(found[0])))  # changed in an unrelated way: still has no cues
            wanted = _codec_cues(row)
            new = encode_cues(bytes(found[0]), wanted)
            changed = connection.execute('UPDATE database2 SET data=? WHERE collection=? AND key=?',
                                         (new, _USER_DATA, row['djay_key'])).rowcount
            if changed != 1:
                raise DjayCueError('djay has more than one record for a song; nothing was written.', 'write_failed')
            stored = bytes(connection.execute('SELECT data FROM database2 WHERE collection=? AND key=?',
                                              (_USER_DATA, row['djay_key'])).fetchone()[0])
            _check_cues(codec, stored, wanted)
            written.append(row)
        if _others(connection, keys) != before:
            raise DjayCueError('Other djay records changed; nothing was written.', 'verify_failed')
        _ensure_closed()  # last look, right before the commit
        connection.execute('COMMIT')
        return before, written
    except BaseException:
        try:
            connection.execute('ROLLBACK')
        except sqlite3.Error:
            pass
        raise
    finally:
        connection.close()


def _check_cues(codec, stored, wanted):
    got = codec.read_cues(stored)
    if [(c['index'], c['time_ms']) for c in got] != [(c['index'], c['time_ms']) for c in wanted] \
            or [c['label'] for c in got] != [c['label'] for c in wanted]:
        raise DjayCueError('The cues did not read back as written.', 'verify_failed')


def _verify(database, rows, others, candidates=None):
    import utils.djay_cue_codec as codec
    connection = _readonly(database)
    try:
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise DjayCueError('The djay library failed its integrity check after the write.', 'verify_failed')
        for row in rows:
            found = connection.execute('SELECT data FROM database2 WHERE collection=? AND key=?',
                                       (_USER_DATA, row['djay_key'])).fetchone()
            _check_cues(codec, bytes(found[0]), _codec_cues(row))
        if _others(connection, {row['djay_key'] for row in (candidates or rows)}) != others:
            raise DjayCueError('Other djay records changed; the write was undone.', 'verify_failed')
    finally:
        connection.close()


def _companions(database):
    return [Path(database + suffix) for suffix in ('-wal', '-shm')]


def _save(folder, receipt):
    stage = folder / 'receipt.json.tmp'
    stage.write_text(json.dumps(receipt, indent=1), encoding='utf-8')
    os.replace(stage, folder / 'receipt.json')


def _restore(database, folder, receipt):
    """Put the backed-up library (and its -wal/-shm files, or their absence) back."""
    _swap_file(database, (folder / 'MediaLibrary.db').read_bytes())
    for companion in _companions(database):
        saved = folder / ('MediaLibrary.db' + companion.name[len(Path(database).name):])
        if saved.is_file():
            _swap_file(companion, saved.read_bytes())
        elif companion.exists():
            companion.unlink()
    if _file_sha(database) != receipt['before_sha256']:
        raise DjayCueError('The djay library did not restore exactly.', 'verify_failed')


def apply(payload=None):
    """Write the previewed cues into djay's library (songs with zero djay cues only), with a backup kept."""
    with _LOCK:
        plan = _plan(payload)
        expected = payload.get('digest') if isinstance(payload, dict) else None
        if expected and expected != plan['digest']:
            raise DjayCueError('The djay library or the cue sources changed since the preview. Preview again.', 'stale')
        rows = [row for row in plan['songs'] if row['will_write']]
        summary = _public(plan)
        if not rows:
            return dict(summary, written=0, backup_id='', message='Nothing to write.')
        skipped_late = []
        database = plan['database']
        _ensure_closed()
        identifier = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
        folder = _root() / identifier
        folder.mkdir(parents=True)
        before_state = _state_sha(database)
        for companion in [Path(database)] + _companions(database):
            if companion.is_file():
                (folder / ('MediaLibrary.db' + companion.name[len(Path(database).name):])).write_bytes(companion.read_bytes())
        receipt = {'kind': 'peakhour_djay_cues', 'id': identifier, 'created_at': time.time(), 'status': 'writing',
                   'database': database, 'before_sha256': _file_sha(folder / 'MediaLibrary.db'), 'before_state': before_state,
                   'songs': [{'path': r['path'], 'key': r['djay_key'], 'cues': len(r['cues'])} for r in rows]}
        if _state_sha(database) != before_state:
            raise DjayCueError('djay changed its library while PEAK HOUR was backing it up. Try again.', 'changed')
        _save(folder, receipt)
        try:
            candidates = rows
            others, rows = _write(database, rows, skipped_late)
            _verify(database, rows, others, candidates)
        except BaseException as error:
            problem = None
            try:
                if _state_sha(database) != before_state:
                    _restore(database, folder, receipt)
                receipt['status'] = 'rolled_back'
            except Exception as failure:
                receipt['status'] = 'rollback_failed'
                problem = failure
            try:
                _save(folder, receipt)
            except OSError:
                pass
            if problem is not None:
                raise DjayCueError(f'{error} PEAK HOUR could not put the djay library back ({problem}); '
                                   f'the backup is in {folder}.', 'write_failed') from error
            if isinstance(error, DjayCueError) or not isinstance(error, Exception):
                raise
            raise DjayCueError(f'Could not write the cues to djay ({error}). The library was left as it was.',
                               'write_failed') from error
        receipt.update(status='written', after_sha256=_file_sha(database), after_state=_state_sha(database),
                       songs=[{'path': r['path'], 'key': r['djay_key'], 'cues': len(r['cues'])} for r in rows])
        _save(folder, receipt)
        left = [{'path': r['path'], 'reason': r['skip_reason']} for r in skipped_late]
        return dict(summary, written=len(rows), backup_id=identifier, skipped_at_write=left,
                    message='Cues written to djay. A backup was kept and this can be undone.' + (
                        f' {len(left)} song(s) changed in djay meanwhile and were left alone.' if left else ''))


def undo(backup_id):
    """Put the library back as it was before that write, byte for byte (djay closed, and unchanged since)."""
    if not isinstance(backup_id, str) or not re.fullmatch(r'[0-9A-Za-z_-]{1,64}', backup_id):
        raise DjayCueError('Unknown backup.', 'bad_request')
    with _LOCK:
        folder = _root() / backup_id
        try:
            receipt = json.loads((folder / 'receipt.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            raise DjayCueError('There is no such djay cue backup.', 'bad_request') from None
        if receipt.get('kind') != 'peakhour_djay_cues' or receipt.get('status') != 'written':
            raise DjayCueError('That write cannot be undone (it did not complete, or was undone already).', 'bad_request')
        _ensure_closed()
        database = receipt['database']
        after = receipt.get('after_state')
        if not os.path.isfile(database) or (_state_sha(database) != after if after else _file_sha(database) != receipt['after_sha256']):
            raise DjayCueError('djay has changed its library since this write, so it cannot be undone safely.', 'changed')
        if _file_sha(folder / 'MediaLibrary.db') != receipt['before_sha256']:
            raise DjayCueError('The backup is damaged. Nothing was changed.', 'verify_failed')
        _restore(database, folder, receipt)
        receipt.update(status='undone', undone_at=time.time())
        _save(folder, receipt)
        return {'success': True, 'restored': database, 'backup_id': backup_id}


# ------------------------------------------------------------------ routes

def create_blueprint(app, root=None, license_guard=None):
    from flask import Blueprint, jsonify, request
    configure(app=app, root=root)
    bp = Blueprint('windows_djay_cues', __name__)

    @bp.before_request
    def local_only():
        if request.remote_addr not in ('127.0.0.1', '::1'):
            return jsonify(success=False, error='Writing to djay requires this PC'), 403
        origin = request.headers.get('Origin')
        if request.method != 'GET' and (not origin or origin.rstrip('/') != request.host_url.rstrip('/')):
            return jsonify(success=False, error='Writing to djay requires a same-origin request'), 403

    def respond(action):
        try:
            result = action()
            if isinstance(result, tuple):  # (body, status): queued until djay closes
                return jsonify(result[0]), result[1]
            return jsonify(result)
        except DjayCueError as exc:
            return jsonify(success=False, error=str(exc), code=exc.code), 409 if exc.code == 'djay_open' else 400
        except (ValueError, OSError) as exc:
            return jsonify(success=False, error=str(exc), code='error'), 400

    def gated(action):
        gate = license_guard('Send cue points to djay') if license_guard else None
        return gate if gate else respond(action)

    import windows_cue_jobs as jobs

    def job_or(action_now, data, kind, work):
        """Small requests answer at once; "all" or more than 50 songs start a background job and answer with its id."""
        if not jobs.is_big(data):
            return gated(action_now)
        gate = license_guard('Send cue points to djay') if license_guard else None
        if gate:
            return gate
        return jsonify(success=True, background=True, state='running', job_id=jobs.start_job(kind, work))

    jobs.add_routes(bp, '/api/windows/djay/cues', 'djay')

    @bp.post('/api/windows/djay/cues/preview')
    def preview_route():
        data = request.get_json(silent=True) or {}
        return job_or(lambda: preview(data), data, 'djay-preview', lambda: preview(data))

    def queued_or_apply(data):
        from windows_dj_write_queue import queue_if_open
        payload = {key: value for key, value in data.items() if key != 'confirm'}
        return queue_if_open('djay', 'cues', payload, 'djay', lambda: apply(payload)) or apply(payload)

    @bp.post('/api/windows/djay/cues/apply')
    def apply_route():
        data = request.get_json(silent=True) or {}
        if data.get('confirm') is not True:
            return jsonify(success=False, error='Confirm before writing to djay', code='bad_request'), 400
        def work():
            result = queued_or_apply(data)
            if isinstance(result, tuple):  # (body, status): the page reads the status from the job result
                return dict(result[0], http_status=result[1])
            return result
        return job_or(lambda: queued_or_apply(data), data, 'djay-apply', work)

    @bp.post('/api/windows/djay/cues/undo')
    def undo_route():
        data = request.get_json(silent=True) or {}
        from windows_dj_write_queue import program_locked

        def locked_undo():
            with program_locked('djay'):
                return undo(data.get('backup_id'))
        return gated(locked_undo)

    return bp
