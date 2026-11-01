"""Windows adapters for AXIOM's djay and DJ-app safety code.

AXIOM converts djay file URLs with os.path.normpath(unquote(urlparse(u).path)),
which yields "\\C:\\Music\\x.mp3" on Windows, and builds URLs with
"file://" + quote(path), which yields an invalid URL for "C:\\...". It also
reports DJ applications as closed on every non-macOS platform. This module
corrects those three points for the modules that read or write djay data.

A real djay 5.6 for Windows library (read from a copy) differs from the macOS
layout AXIOM expects: locations are "file:///C:%5CUsers%5C...", every number
is a double (playCount 1.0), title/BPM live in mediaItemTitleIDs and
mediaItemAnalyzedData instead of mediaItems, and the library folder is
"djay Media Library" without the .djayMediaLibrary suffix. The reader is
adapted for these; djay writes on Windows remain unverified.
"""
import ctypes
import errno
import json
import msvcrt
import ntpath
import os
import plistlib
import re
import sqlite3
import struct
import sys
import types
import urllib
import urllib.parse
from ctypes import wintypes
from pathlib import Path

from windows_serato_processes import snapshot_processes, ProcessInspectionError

# AXIOM app labels -> Windows executable names (case-insensitive).
# djayApp.exe comes from the installed djay 5.x AppxManifest; "djay Pro.exe"
# covers the legacy Windows Store build and is unverified.
WINDOWS_APP_EXECUTABLES = {
    'serato dj pro': ('serato dj pro.exe',),
    'serato dj': ('serato dj pro.exe', 'serato dj lite.exe'),
    'serato dj lite': ('serato dj lite.exe',),
    'serato dj pro/lite': ('serato dj pro.exe', 'serato dj lite.exe'),
    'djay pro': ('djayapp.exe', 'djay pro.exe'),
    'djay': ('djayapp.exe', 'djay pro.exe'),
    'lexicon': ('lexicon.exe',),  # unverified
}
_DRIVE_URL_PATH = re.compile(r'^[\\/]([A-Za-z]:)([\\/]|$)')
_DRIVE_PATH = re.compile(r'^([A-Za-z]:)[\\/]')

# ---------------------------------------------------------------- file URLs

def fix_url_path(value):
    """Turn "\\C:\\x" or "/C:/x" (from a file URL) into "C:\\x"."""
    if isinstance(value, str) and _DRIVE_URL_PATH.match(value):
        return ntpath.normpath(value[1:])
    return value

def quote(string, safe='/', encoding=None, errors=None):
    """urllib.parse.quote that renders drive paths the way djay for Windows does:
    "C:\\Music\\x y.mp3" -> "/C:%5CMusic%5Cx%20y.mp3"."""
    if isinstance(string, str) and _DRIVE_PATH.match(string):
        path = ntpath.normpath(string)
        return '/' + path[:2] + urllib.parse.quote(path[2:], safe, encoding, errors)
    return urllib.parse.quote(string, safe, encoding, errors)

def unquote_path(string, encoding='utf-8', errors='replace'):
    """urllib.parse.unquote for a file-URL path: "/C:%5Cx" -> "C:\\x"."""
    value = urllib.parse.unquote(string, encoding, errors)
    return fix_url_path(value) if isinstance(value, str) else value

def _normpath(path):
    return fix_url_path(os.path.normpath(path))

class _Delegate(types.ModuleType):
    def __init__(self, target, **overrides):
        super().__init__(target.__name__)
        object.__setattr__(self, '_target', target)
        for name, value in overrides.items():
            object.__setattr__(self, name, value)
    def __getattr__(self, name):
        return getattr(self._target, name)

# AXIOM makes renames durable the POSIX way: os.replace, then fsync of the
# parent directory opened with os.open(dir, O_RDONLY). Windows cannot open a
# directory like that; instead os.replace here is MoveFileEx with
# MOVEFILE_WRITE_THROUGH, which returns only once the rename is on disk, and
# the directory descriptor's fsync is then already satisfied.
_DIRECTORY_FDS = set()

def _replace(src, dst, *, src_dir_fd=None, dst_dir_fd=None):
    if src_dir_fd is not None or dst_dir_fd is not None:
        raise NotImplementedError('dir_fd is not supported on Windows')
    if not _kernel.MoveFileExW(os.fspath(src), os.fspath(dst), 0x1 | 0x8):  # REPLACE_EXISTING | WRITE_THROUGH
        raise ctypes.WinError(ctypes.get_last_error())

def _open(path, flags, mode=0o777, *, dir_fd=None):
    if dir_fd is None and flags == os.O_RDONLY and os.path.isdir(path):
        handle = _kernel.CreateFileW(os.fspath(path), 0x80, 0x7, None, 3, 0x02000000, None)
        if handle == wintypes.HANDLE(-1).value:  # FILE_READ_ATTRIBUTES, share all, OPEN_EXISTING, BACKUP_SEMANTICS
            raise ctypes.WinError(ctypes.get_last_error())
        fd = msvcrt.open_osfhandle(handle, os.O_RDONLY)
        _DIRECTORY_FDS.add(fd)
        return fd
    return os.open(path, flags, mode, dir_fd=dir_fd)

def _close(fd):
    _DIRECTORY_FDS.discard(fd)
    os.close(fd)

def _fsync(fd):
    """os.fsync that also works on read-only handles.

    AXIOM fsyncs files it opened with 'rb'; Windows' FlushFileBuffers needs
    write access, so the same file is reopened for writing and flushed.
    """
    if fd in _DIRECTORY_FDS:
        return
    try:
        return os.fsync(fd)
    except OSError as exc:
        if exc.errno != errno.EBADF:
            raise
    handle = _kernel.ReOpenFile(msvcrt.get_osfhandle(fd), 0x40000000, 0x7, 0)  # GENERIC_WRITE, share all
    if not handle or handle == wintypes.HANDLE(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        if not _kernel.FlushFileBuffers(handle):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        _kernel.CloseHandle(handle)

_PATH = _Delegate(os.path, normpath=_normpath)
OS_PROXY = _Delegate(os, path=_PATH, fsync=_fsync, replace=_replace, open=_open, close=_close)
URLLIB_PROXY = _Delegate(urllib, parse=_Delegate(urllib.parse, quote=quote))

# ---------------------------------------------------------------- processes

_kernel = ctypes.WinDLL('kernel32', use_last_error=True)
_kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
_kernel.OpenProcess.restype = wintypes.HANDLE
_kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
_kernel.GetProcessTimes.restype = wintypes.BOOL
_kernel.CloseHandle.argtypes = [wintypes.HANDLE]
_kernel.CloseHandle.restype = wintypes.BOOL
_kernel.ReOpenFile.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD]
_kernel.ReOpenFile.restype = wintypes.HANDLE
_kernel.FlushFileBuffers.argtypes = [wintypes.HANDLE]
_kernel.FlushFileBuffers.restype = wintypes.BOOL
_kernel.MoveFileExW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]
_kernel.MoveFileExW.restype = wintypes.BOOL
_kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                                wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
_kernel.CreateFileW.restype = wintypes.HANDLE

def _started_at(pid):
    """Process creation time as a Unix timestamp, or None if unavailable."""
    handle = _kernel.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
    if not handle:
        return None
    try:
        times = [wintypes.FILETIME() for _ in range(4)]
        if not _kernel.GetProcessTimes(handle, *[ctypes.byref(t) for t in times]):
            return None
        ticks = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
        return ticks / 10_000_000 - 11644473600
    finally:
        _kernel.CloseHandle(handle)

def process_snapshot(*names, snapshot=snapshot_processes):
    """Windows replacement for AXIOM's _mac_process_snapshot.

    Fails closed: if processes cannot be listed, the apps are reported running.
    """
    wanted = set()
    for name in names:
        executables = WINDOWS_APP_EXECUTABLES.get(str(name).casefold())
        wanted.update(executables or (str(name).casefold() + '.exe',))
    try:
        pids = sorted(pid for pid, exe in snapshot() if ntpath.basename(exe).casefold() in wanted)
    except ProcessInspectionError:
        return {'running': True, 'token': 'unverifiable', 'started_at': None, 'pids': []}
    if not pids:
        return {'running': False, 'token': '', 'started_at': None, 'pids': []}
    starts = [s for s in (_started_at(pid) for pid in pids) if s is not None]
    token = ','.join(str(pid) for pid in pids)
    return {'running': True, 'token': token, 'started_at': min(starts) if starts else None, 'pids': pids}

def process_running(*names):
    return bool(process_snapshot(*names).get('running'))

def running_dj_publish_apps():
    """Windows replacement for AXIOM's _running_dj_publish_apps."""
    running = []
    if process_running('Serato DJ Pro', 'Serato DJ', 'Serato DJ Lite'):
        running.append('Serato DJ Pro/Lite')
    if process_running('djay Pro', 'djay'):
        running.append('djay Pro')
    return running

# ---------------------------------------------------------------- locations

def default_media_library():
    # djay 5.6 for Windows creates "djay Media Library"; the suffixed name is
    # the macOS bundle name, kept in case a library was copied across.
    djay = Path(os.environ.get('USERPROFILE') or Path.home()) / 'Music' / 'djay'
    for name in ('djay Media Library', 'djay Media Library.djayMediaLibrary'):
        if (djay / name).is_dir():
            return djay / name
    return djay / 'djay Media Library'

def now_playing_candidates():
    result = []
    override = os.environ.get('AXIOM_DJAY_NOW_PLAYING_PATH', '').strip()
    if override:
        result.append(os.path.abspath(os.path.expandvars(os.path.expanduser(override))))
    result.append(str(default_media_library() / 'NowPlaying.txt'))
    return list(dict.fromkeys(result))

def database_candidates(now_playing_path=None):
    result = []
    if now_playing_path:
        result.append(os.path.join(os.path.dirname(os.fspath(now_playing_path)), 'MediaLibrary.db'))
    result.append(str(default_media_library() / 'MediaLibrary.db'))
    return list(dict.fromkeys(os.path.abspath(p) for p in result))

# ---------------------------------------------------------------- library format

_TRACK_QUERY = "collection IN ('localMediaItemLocations','mediaItems','mediaItemUserData')"
_WINDOWS_MEDIA = b'AXIOM-WINDOWS-MEDIA\x00'
_DECODE_ERRORS = (ValueError, IndexError, KeyError, TypeError, UnicodeError, struct.error)

def make_record_decoder(decode):
    """Wrap decode_djay_record for djay for Windows records.

    Whole, non-negative float play counts become ints (AXIOM rejects anything
    that is not an int), and synthetic mediaItems rows decode to their dict.
    """
    def decode_record(blob):
        if bytes(blob[:len(_WINDOWS_MEDIA)]) == _WINDOWS_MEDIA:
            return json.loads(bytes(blob[len(_WINDOWS_MEDIA):]))
        record = decode(blob)
        count = record.get('playCount') if isinstance(record, dict) else None
        if isinstance(count, float) and count >= 0 and count.is_integer():
            record['playCount'] = int(count)
        return record
    return decode_record

def windows_media_rows(conn, decode):
    """mediaItems rows built from mediaItemTitleIDs/mediaItemAnalyzedData for
    tracks that have no mediaItems record (the djay for Windows layout)."""
    rows = conn.execute("SELECT collection,key,data FROM database2 WHERE collection IN "
                        "('mediaItems','mediaItemTitleIDs','mediaItemAnalyzedData')").fetchall()
    present = {key for collection, key, _ in rows if collection == 'mediaItems'}
    titles, analyzed = {}, {}
    for collection, key, data in rows:
        if collection == 'mediaItems' or key in present:
            continue
        try:
            record = decode(bytes(data))
        except _DECODE_ERRORS:
            continue
        if isinstance(record, dict):
            (titles if collection == 'mediaItemTitleIDs' else analyzed)[key] = record
    result = []
    for key, title in titles.items():
        extra = analyzed.get(key, {})
        media = {'title': title.get('title'), 'bpm': extra.get('bpm'), 'titleID': title,
                 'titleIDs': extra.get('titleIDs') or []}
        result.append(('mediaItems', key, _WINDOWS_MEDIA + json.dumps(media, default=str).encode()))
    return result

_PLAY_COUNT_KEY = b'\x08playCount\x00'
_INT64, _DOUBLE = 0x12, 0x14

def _play_count_slot(blob, tag):
    """(tag offset, value offset) of an 8-byte playCount value with a literal key,
    or None. AXIOM's codec and djay for Windows both lay it out this way."""
    if blob.count(_PLAY_COUNT_KEY) != 1:
        return None
    value = blob.index(_PLAY_COUNT_KEY) - 8
    if value < 21 or value % 8:
        return None
    start = value - 1
    while start > value - 8 and blob[start] == 0:
        start -= 1
    return (start, value) if blob[start] == tag else None

def _swap_play_count(blob, slot, tag, packed):
    start, value = slot
    return blob[:start] + bytes([tag]) + blob[start + 1:value] + packed + blob[value + 8:]

def make_play_count_replacer(replace, decode):
    """Wrap replace_play_count so djay for Windows keeps its double playCount.

    AXIOM's codec only accepts integer playCount values and writes int64. A
    double count is handed to it as the equal int64 and the result converted
    back; a missing count is written as a double, as djay for Windows does.
    Everything except playCount must decode identically, or nothing is returned.
    """
    def replace_play_count(blob, count):
        blob = bytes(blob)
        original = decode(blob)
        current = original.get('playCount') if isinstance(original, dict) else None
        if isinstance(current, int) and not isinstance(current, bool):
            return replace(blob, count)
        source = blob
        if current is not None:
            slot = _play_count_slot(blob, _DOUBLE)
            if (slot is None or not isinstance(current, float) or not current.is_integer()
                    or not 0 <= current <= 2147483647):
                raise ValueError('Unexpected playCount type')
            source = _swap_play_count(blob, slot, _INT64, struct.pack('<q', int(current)))
        written = bytes(replace(source, count))
        slot = _play_count_slot(written, _INT64)
        if slot is None:
            raise ValueError('Unexpected playCount layout')
        result = _swap_play_count(written, slot, _DOUBLE, struct.pack('<d', float(count)))
        check, expected = decode(result), dict(original)
        expected['playCount'] = float(count)
        if check != expected or type(check['playCount']) is not float:
            raise ValueError('Non-play-count data changed')
        return result
    return replace_play_count

# The apps djay_play_count_publish.running_dj_apps checks with pgrep on macOS.
PLAY_COUNT_GUARD_APPS = ('djay Pro', 'djay', 'Serato DJ Pro', 'Serato DJ', 'Serato DJ Lite', 'Lexicon')

# ---------------------------------------------------------------- cues
# djay for Windows stores a cue's slot "number" as a double (1.0) and may omit
# "color" (and "comment"); AXIOM requires int slots and an RGB colour. A cue
# AXIOM writes has an int64 "number"; djay for Windows writes a double.

AXIOM_DEFAULT_CUE_COLOR = '#A3FF00'  # what utils.cues._cue_color_hex shows for a colourless cue

def _integral_cue_numbers(record, default_color=None):
    cues = record.get('cuePoints') if isinstance(record, dict) else None
    if isinstance(cues, list):
        for cue in cues:
            if not isinstance(cue, dict) or cue.get('_class') != 'ADCCuePoint':
                continue
            number = cue.get('number')
            if isinstance(number, float) and number.is_integer():
                cue['number'] = int(number)
            if default_color and 'color' not in cue:
                cue['color'] = default_color
    return record

def make_cue_decoder(decode, default_color=None):
    """Wrap decode_djay_record for AXIOM's cue readers (see above)."""
    def decode_record(blob):
        return _integral_cue_numbers(decode(blob), default_color)
    return decode_record

def _number_slots(blob, key, tag):
    """(tag offset, value offset) of every 8-byte value stored under a literal key."""
    literal, slots, start = b'\x08' + key + b'\x00', [], 0
    while (found := blob.find(literal, start)) >= 0:
        value, start = found - 8, found + 1
        if value < 21 or value % 8:
            continue
        cursor = value - 1
        while cursor > value - 8 and blob[cursor] == 0:
            cursor -= 1
        if blob[cursor] == tag:
            slots.append((cursor, value))
    return slots

def make_cue_replacer(replace, decode):
    """Wrap replace_cues so newly written cue slots are doubles, as djay for
    Windows writes them. Everything else must decode exactly as AXIOM wrote it."""
    def replace_cues(blob, cues):
        written = bytes(replace(blob, cues))
        if written == bytes(blob):
            return written
        result = written
        for slot in _number_slots(written, b'number', _INT64):
            number = struct.unpack_from('<q', written, slot[1])[0]
            result = _swap_play_count(result, slot, _DOUBLE, struct.pack('<d', float(number)))
        check, expected = decode(result), decode(written)
        for cue in expected.get('cuePoints') or []:
            cue['number'] = float(cue['number'])
        if check != expected or any(type(c.get('number')) is not float for c in check.get('cuePoints') or []):
            raise ValueError('Unexpected djay cue layout; no cues were written.')
        return result
    return replace_cues

def make_running_dj_apps(labels, snapshot=snapshot_processes):
    """Windows replacement for djay_play_count_publish.running_dj_apps.

    Like the macOS original, raises when processes cannot be listed.
    """
    def running_dj_apps():
        try:
            names = {ntpath.basename(exe).casefold() for _, exe in snapshot()}
        except ProcessInspectionError as exc:
            raise RuntimeError('Could not verify that DJ apps are closed. No changes were made.') from exc
        running, seen = [], set()
        for label in labels:
            executables = set(WINDOWS_APP_EXECUTABLES.get(label.casefold(), (label.casefold() + '.exe',)))
            hit = executables & names
            if hit and not hit <= seen:
                running.append(label)
                seen |= hit
        return running
    return running_dj_apps

# publish_counts checks the track exists in mediaItems; djay for Windows has
# mediaItemTitleIDs instead.
_MEDIA_COUNT = "SELECT count(*) FROM database2 WHERE collection='mediaItems' AND key=?"
_MEDIA_COUNT_WINDOWS = ("SELECT CASE WHEN (SELECT count(*) FROM database2 WHERE collection='mediaItems' AND key=?1)>0 "
                        "THEN (SELECT count(*) FROM database2 WHERE collection='mediaItems' AND key=?1) "
                        "ELSE (SELECT count(*) FROM database2 WHERE collection='mediaItemTitleIDs' AND key=?1) END")

class _Rows(list):
    def fetchall(self):
        return list(self)

class _Connection:
    """sqlite3 connection that presents djay for Windows tracks as mediaItems."""
    def __init__(self, conn, decode):
        self._conn, self._decode = conn, decode
    def __getattr__(self, name):
        return getattr(self._conn, name)
    def __enter__(self):
        self._conn.__enter__()
        return self
    def __exit__(self, *exc):
        return self._conn.__exit__(*exc)
    def backup(self, target, *args, **kwargs):
        return self._conn.backup(getattr(target, '_conn', target), *args, **kwargs)
    def execute(self, sql, *args):
        if sql == _MEDIA_COUNT:
            sql = _MEDIA_COUNT_WINDOWS
        cursor = self._conn.execute(sql, *args)
        if not isinstance(sql, str) or _TRACK_QUERY not in sql:
            return cursor
        return _Rows(cursor.fetchall() + windows_media_rows(self._conn, self._decode))

def make_sqlite_proxy(decode):
    def connect(*args, **kwargs):
        return _Connection(sqlite3.connect(*args, **kwargs), decode)
    return _Delegate(sqlite3, connect=connect)

# ---------------------------------------------------------------- playlists
# A playlist made in djay 5.6 for Windows stores "type" as a double (0.0, root
# 1.0) where AXIOM writes FastCoding's integer constants, and "itemUUIDs" as a
# mutable ordered set (tag 27) where AXIOM writes an immutable one (tag 12);
# the root's "childUUIDs" stays immutable. Item records are already identical.

_PLAYLIST_CLASS = 'ADCMediaItemPlaylist'
_MUTABLE_SETS = {'itemUUIDs'}

def encode_windows_playlist(decoded):
    """FastCoding blob for an ADCMediaItemPlaylist in djay for Windows' layout.

    Takes AXIOM's decoded form ({'class_name', 'properties', 'header'}) with
    string, integer and ordered_set properties.
    """
    if decoded.get('class_name') != _PLAYLIST_CLASS:
        raise ValueError('Not a djay playlist record')
    body, strings, objects = bytearray(), [], 1
    def pad(size):
        body.extend(bytes((size - (20 + len(body)) % size) % size))
    def put_string(value):
        if value in strings:
            index = strings.index(value)
            for tag, fmt in ((5, '<B'), (6, '<H'), (7, '<I')):
                if index < 1 << (8 * struct.calcsize(fmt)):
                    body.append(tag); pad(struct.calcsize(fmt)); body.extend(struct.pack(fmt, index))
                    return
        strings.append(value)
        body.extend(b'\x08' + value.encode() + b'\x00')
    body.append(43); put_string(_PLAYLIST_CLASS)
    for key, kind, value in decoded['properties']:
        if kind == 'string':
            put_string(value)
        elif kind == 'integer' and not isinstance(value, bool):
            body.append(20); pad(8); body.extend(struct.pack('<d', float(value)))
        elif kind == 'ordered_set':
            objects += 1
            body.append(27 if key in _MUTABLE_SETS else 12); pad(4); body.extend(struct.pack('<I', len(value)))
            for item in value:
                put_string(item)
        else:
            raise ValueError(f'Unsupported djay playlist property {key!r} ({kind})')
        put_string(key)
    body.append(0)
    major, minor, extra = decoded.get('header', (3, 3, 0))
    return b'TSAF' + struct.pack('<HHIII', major, minor, objects, extra, len(strings)) + bytes(body)

def make_playlist_decoder(decode):
    """Wrap _djay_decode_fastcoding_object: a playlist whose whole-number double
    "type" re-encodes to the same bytes in Windows layout reports it as AXIOM's
    integer, so AXIOM's own playlist rules apply unchanged."""
    def decode_playlist(blob):
        decoded = decode(blob)
        if not isinstance(decoded, dict) or decoded.get('class_name') != _PLAYLIST_CLASS:
            return decoded
        properties = []
        for key, kind, value in decoded.get('properties', []):
            if (key == 'type' and kind == 'archive' and isinstance(value, list) and len(value) == 2
                    and value[0] == 20 and len(value[1]) == 8):
                number = struct.unpack('<d', value[1])[0]
                if number.is_integer() and 0 <= number < 2 ** 31:
                    kind, value = 'integer', int(number)
            properties.append((key, kind, value))
        converted = dict(decoded, properties=properties)
        converted.pop('_archive_blob', None)
        try:
            if encode_windows_playlist(converted) == bytes(blob):
                return converted
        except ValueError:
            pass
        return decoded
    return decode_playlist

def make_playlist_encoder(encode):
    """Wrap _djay_encode_fastcoding_object to write playlists in Windows layout.

    Anything the Windows layout does not cover goes to AXIOM's encoder, whose
    output then fails AXIOM's own lossless checks with its usual error.
    """
    def encode_record(decoded):
        if isinstance(decoded, dict) and decoded.get('class_name') == _PLAYLIST_CLASS:
            try:
                return encode_windows_playlist(decoded)
            except ValueError:
                pass
        return encode(decoded)
    return encode_record

def make_playlist_blob(build, decode):
    """Wrap _djay_fastcoding_playlist_blob to emit the Windows layout."""
    def playlist_blob(*args, **kwargs):
        decoded = decode(build(*args, **kwargs))
        return encode_windows_playlist({k: decoded[k] for k in ('class_name', 'properties', 'header')})
    return playlist_blob

# ---------------------------------------------------------------- numbers as doubles
# Every number in records djay 5.6 for Windows writes is a double (tag 20):
# counts, BPM, flags such as isStraightGrid (1.0) and cue slots. AXIOM's
# grid writer emits macOS-style compact numbers (float32, constant 0/1/true).
# transcode_numbers re-lays a FastCoding blob token by token with every number
# as a double; numbers are never cached, so string and object alias indices
# stay valid, and alignment padding is recomputed for the new offsets.

_FORMATS = {15: 'b', 16: 'h', 17: 'i', 18: 'q', 19: 'f', 20: 'd'}
_CONSTANTS = {13: 1.0, 45: 1.0, 14: 0.0, 46: 0.0}
_ALIAS = {2: 'B', 3: 'H', 4: 'I', 5: 'B', 6: 'H', 7: 'I'}
_DICTS, _COLLECTIONS = (9, 24), (9, 10, 11, 12, 24, 25, 26, 27)

def transcode_numbers(blob, tag_counts=None):
    """Return blob with every FastCoding number written as a double.

    tag_counts, if given (a dict), receives a histogram of the tags read.
    """
    blob = bytes(blob)
    if blob[:8] != b'TSAF\x03\x00\x03\x00' or len(blob) < 21:
        raise ValueError('Unsupported djay record')
    out, pos = bytearray(blob[:20]), [20]
    def take(fmt):
        size = struct.calcsize(fmt)
        pos[0] += (size - pos[0] % size) % size
        value = struct.unpack_from('<' + fmt, blob, pos[0])[0]
        pos[0] += size
        return value
    def put(fmt, value):
        size = struct.calcsize(fmt)
        out.extend(bytes((size - len(out) % size) % size))
        out.extend(struct.pack('<' + fmt, value))
    def token(depth=0):
        if depth > 40:
            raise ValueError('djay record nesting limit')
        tag = blob[pos[0]]; pos[0] += 1
        if tag_counts is not None:
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
        if tag in (0, 1):
            out.append(tag)
        elif tag in _CONSTANTS or tag in _FORMATS or tag in (22, 48):
            value = _CONSTANTS[tag] if tag in _CONSTANTS else take(_FORMATS.get(tag, 'd'))
            out.append(tag if tag in (22, 48) else 20); put('d', float(value))
        elif tag in _ALIAS:
            out.append(tag); put(_ALIAS[tag], take(_ALIAS[tag]))
        elif tag == 8:
            end = blob.index(0, pos[0])
            out.extend(blob[pos[0] - 1:end + 1]); pos[0] = end + 1
        elif tag in _COLLECTIONS:
            count = take('I')
            if count > 100000:
                raise ValueError('djay record count limit')
            out.append(tag); put('I', count)
            for _ in range(count * (2 if tag in _DICTS else 1)):
                token(depth + 1)
        elif tag == 43:
            out.append(tag); token(depth + 1)
            while blob[pos[0]] != 0:
                token(depth + 1); token(depth + 1)
            out.append(0); pos[0] += 1
        elif tag in (21, 28):
            size = take('I')
            out.append(tag); put('I', size)
            out.extend(blob[pos[0]:pos[0] + size]); pos[0] += size
            pos[0] += (4 - pos[0] % 4) % 4
            out.extend(bytes((4 - len(out) % 4) % 4))
        else:
            raise ValueError(f'Unsupported djay FastCoding tag {tag} at {pos[0] - 1}')
    token()
    if pos[0] != len(blob):
        raise ValueError('Trailing djay data')
    return bytes(out)

def make_double_writer(write, decode):
    """Wrap a grid-publisher record writer so its output uses doubles; the
    result must decode to the same values as AXIOM's own output."""
    def write_record(*args, **kwargs):
        written = write(*args, **kwargs)
        result = transcode_numbers(written)
        if decode(result) != decode(written):
            raise ValueError('djay number conversion changed record data; nothing was written.')
        return result
    return write_record

GRID_RECORD_WRITERS = ('_replace_djay_root_numeric_properties', '_replace_djay_root_properties',
                       '_replace_djay_manual_grid_edit')

# ---------------------------------------------------------------- beatgrid metadata
# djay for Windows keeps per-track analysis (.djayMetadata binary plists) in its
# MSIX package folder, and stores grid flags as integers 0/1: 32 of 32 files on
# the test machine contained no plist booleans. AXIOM requires booleans when it
# checks a file and writes booleans in its grid payload.

GRID_FLAGS = ('hasStraightSegment', 'straightGrid', 'forcedStraightGrid')

def metadata_root():
    """djay for Windows' Metadata folder as seen from outside its package."""
    packages = Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local') / 'Packages'
    tail = Path('LocalCache', 'Local', 'Algoriddim', 'djay', 'Metadata')
    found = sorted(p / tail for p in packages.glob('*.djay_*') if (p / tail).is_dir())
    if len(found) == 1:
        return found[0]
    return Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local') / 'Algoriddim' / 'djay' / 'Metadata'

def _grid_flags(value, convert):
    if isinstance(value, dict) and isinstance(value.get('deepBeatTrackerInfo'), dict):
        deep = dict(value['deepBeatTrackerInfo'])
        for key in GRID_FLAGS:
            if key in deep:
                deep[key] = convert(deep[key])
        value = dict(value, deepBeatTrackerInfo=deep)
    return value

def _flag_to_bool(flag):
    return bool(flag) if type(flag) is int and flag in (0, 1) else flag

def _flag_to_int(flag):
    return int(flag) if type(flag) is bool else flag

def _plist_loads(data, **kwargs):
    return _grid_flags(plistlib.loads(data, **kwargs), _flag_to_bool)

def _plist_load(fp, **kwargs):
    return _grid_flags(plistlib.load(fp, **kwargs), _flag_to_bool)

def _plist_dumps(value, **kwargs):
    return plistlib.dumps(_grid_flags(value, _flag_to_int), **kwargs)

def _plist_dump(value, fp, **kwargs):
    return plistlib.dump(_grid_flags(value, _flag_to_int), fp, **kwargs)

PLISTLIB_PROXY = _Delegate(plistlib, loads=_plist_loads, load=_plist_load, dumps=_plist_dumps, dump=_plist_dump)

# ---------------------------------------------------------------- DJ export paths
# AXIOM's _dj_export_path (rekordbox XML locations) turns file://localhost/C:/x
# into "C:x", a drive-relative path, so every rekordbox track needed relinking.

def make_export_path(original):
    def export_path(value):
        result = original(value)
        if isinstance(value, str) and value.lower().startswith('file:') and isinstance(result, str) \
                and re.match(r'^[A-Za-z]:(?![\\/])', result):
            fixed = fix_url_path(urllib.parse.unquote(urllib.parse.urlsplit(value).path))
            if _DRIVE_PATH.match(fixed):
                return fixed
        return result
    return export_path

# ---------------------------------------------------------------- install

_URL_MODULES = ('app', 'utils.dj_transfer', 'utils.dj_track_colors', 'utils.djay_play_count_publish',
                'djay_beatgrid_publisher', 'studio_daw.djay_analysis')

def install(app):
    """Patch an imported AXIOM app module and its djay helpers for Windows."""
    if getattr(app, '_windows_djay_installed', False):
        return
    import importlib
    for name in _URL_MODULES:
        module = app if name == 'app' else importlib.import_module(name)
        if getattr(module, 'os', None) is os:
            module.os = OS_PROXY
        if getattr(module, 'urllib', None) is urllib:
            module.urllib = URLLIB_PROXY
        if getattr(module, 'quote', None) is urllib.parse.quote:
            module.quote = quote
    transfer = importlib.import_module('utils.dj_transfer')
    original_decode = transfer.decode_djay_record
    transfer.decode_djay_record = make_record_decoder(original_decode)
    if getattr(transfer, 'sqlite3', None) is sqlite3:
        transfer.sqlite3 = make_sqlite_proxy(original_decode)
    colors = importlib.import_module('utils.dj_track_colors')
    colors.decode_djay_record = make_cue_decoder(original_decode)  # utils.cues imports it per call
    cue_codec = importlib.import_module('utils.djay_cue_codec')
    cue_codec.decode_djay_record = make_cue_decoder(original_decode, AXIOM_DEFAULT_CUE_COLOR)
    cue_codec.replace_cues = make_cue_replacer(cue_codec.replace_cues, original_decode)
    counts = importlib.import_module('utils.djay_play_count_publish')
    counts.decode_djay_record = make_record_decoder(original_decode)
    counts.replace_play_count = make_play_count_replacer(counts.replace_play_count, original_decode)
    counts.running_dj_apps = make_running_dj_apps(PLAY_COUNT_GUARD_APPS)
    if getattr(counts, 'sqlite3', None) is sqlite3:
        counts.sqlite3 = make_sqlite_proxy(original_decode)
    app._mac_process_snapshot = process_snapshot
    app._mac_process_running = process_running
    app._running_dj_publish_apps = running_dj_publish_apps
    original_playlist_decode = app._djay_decode_fastcoding_object
    app._djay_decode_fastcoding_object = make_playlist_decoder(original_playlist_decode)
    app._djay_encode_fastcoding_object = make_playlist_encoder(app._djay_encode_fastcoding_object)
    app._djay_fastcoding_playlist_blob = make_playlist_blob(app._djay_fastcoding_playlist_blob,
                                                            app._djay_decode_fastcoding_object)
    analysis = importlib.import_module('studio_daw.djay_analysis')
    if getattr(analysis, 'unquote', None) is urllib.parse.unquote:
        analysis.unquote = unquote_path  # only used on file-URL paths there
    grids = importlib.import_module('djay_beatgrid_publisher')
    for module in (analysis, grids):
        if getattr(module, 'plistlib', None) is plistlib:
            module.plistlib = PLISTLIB_PROXY
    for name in GRID_RECORD_WRITERS:
        setattr(grids, name, make_double_writer(getattr(grids, name), original_decode))
    app.DJAY_METADATA_ROOT = str(metadata_root())
    app._dj_export_path = make_export_path(app._dj_export_path)
    library = default_media_library()
    app.DJAY_MEDIA_LIBRARY_DIR = str(library)
    app.DJAY_MEDIA_LIBRARY_DB = str(library / 'MediaLibrary.db')
    app._djay_database_candidates = database_candidates
    app._djay_now_playing_candidates = now_playing_candidates
    app._windows_djay_installed = True
