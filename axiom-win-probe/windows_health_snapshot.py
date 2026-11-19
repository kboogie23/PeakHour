"""Health shows its last results at once, and counts again only when something changed or you ask.

AXIOM keeps the finished Health count in memory only. After every restart the first open of Health counted
all the tracks again: about 50 to 100 seconds for a 49,000 song library on an external drive. This module
saves the finished count to data\\health_snapshot.json (written to a temporary file, then renamed) and, when
Health opens and AXIOM has no result in memory, answers with the saved count at once (status "complete",
"from_snapshot": true, "computed_at") if the saved count is still good:

  - library_cache.json has the same size and modified time (every change AXIOM makes to the library, repairs
    included, writes this file). The reset generation, latest import batch, track total and connected source
    (read from the end of the file) are also compared, but they add little beyond size and modified time;
  - every drive the library's songs live on is still there, and any drive that was missing still is. Drive
    fixed drives are checked without touching them (GetLogicalDrives / GetDriveTypeW); removable, network
    and CD drives and network shares are checked in a thread with a short time limit, and no answer in time counts as changed (AXIOM counts);
  - same AXIOM version and build, same access tier and track limit, same version of this module;
  - it is less than 24 hours old (a tag edited by another program is picked up after that, or at Refresh).

If any of this differs, AXIOM counts as before and the new result is saved. "Scan Health" and every
?force=1 request always count again. Nothing starts a count by itself when nothing changed.
"""
import json
import ntpath
import os
import re
import threading
import time
from datetime import datetime, timezone

MODULE_VERSION = 1
MAX_AGE_SECONDS = 24 * 3600
FILE_NAME = 'health_snapshot.json'
FORCE_VALUES = frozenset({'true', 'yes', '1'})  # AXIOM's own list
TAIL_BYTES = 16384  # AXIOM writes track_total, reset_generation... after the tracks, so they are at the end
TAIL_PATTERNS = {
    'total_tracks': re.compile(r'"total_tracks":\s*(\d+)'),
    'reset_generation': re.compile(r'"reset_generation":\s*(-?\d+)'),
    'latest_import_batch': re.compile(r'"latest_import_batch":\s*\{\s*"id":\s*"([^"]*)"'),
    'connected_source': re.compile(r'"connected_source":\s*"([^"]*)"'),
}


def drive_root(path):
    """'D:\\' for D:\\Music\\a.mp3, '\\\\server\\share\\' for a network share, '' for a path with no drive."""
    drive = ntpath.splitdrive(str(path or ''))[0]
    return drive + '\\' if drive else ''


UNC_TIMEOUT = 1.5  # seconds to wait for all network shares together
UNC_KEEP = 30.0  # seconds an asked drive's or share's answer is reused
_unc_seen = {}


def drive_types():
    """{letter: GetDriveTypeW} for the drive letters that exist, from the system's drive table (no access to the drives)."""
    import ctypes
    mask = ctypes.windll.kernel32.GetLogicalDrives()
    found = {}
    for index in range(26):
        letter = chr(65 + index)
        if mask >> index & 1:
            found[letter] = ctypes.windll.kernel32.GetDriveTypeW(letter + ':' + chr(92))
    return found


FIXED = 3  # DRIVE_FIXED; 0 unknown and 1 no root mean the letter is not usable


def drive_presence(roots, timeout=UNC_TIMEOUT):
    """{root: is it there}. A fixed drive is answered by the drive table alone. Removable, network and CD drives
    (a card reader with no card, a mapped drive whose server is off still have a letter) and network shares are
    asked with isdir in threads, waited for at most `timeout` together and reused for 30 s; no answer in time
    counts as not there (so the library is counted)."""
    roots = sorted(roots)
    result, ask = {}, []
    types = None
    for root in roots:
        if len(root) == 3 and root[1] == ':':
            if types is None:
                types = drive_types()
            kind = types.get(root[0].upper(), 0)
            if kind == FIXED:
                result[root] = True
            elif kind in (0, 1):
                result[root] = False
            else:
                ask.append(root)
        else:
            ask.append(root)
    now = time.monotonic()
    asking = {}
    for root in ask:
        seen = _unc_seen.get(root)
        if seen and now - seen[0] < UNC_KEEP:
            result[root] = seen[1]
            continue
        answer = asking[root] = {}
        threading.Thread(target=lambda r=root, a=answer: a.update(there=bool(os.path.isdir(r))), daemon=True).start()
    deadline = time.monotonic() + timeout
    for root, answer in asking.items():
        while 'there' not in answer and time.monotonic() < deadline:
            time.sleep(0.01)
        result[root] = answer.get('there', False)
        if 'there' in answer:
            _unc_seen[root] = (time.monotonic(), answer['there'])
    return {root: result[root] for root in roots}


def file_stat(path):
    try:
        stat = os.stat(path)
    except OSError:
        return None
    return stat.st_size, stat.st_mtime_ns


def tail_meta(path):
    """The small fields at the end of library_cache.json, without reading the 40 MB of tracks."""
    found = {name: None for name in TAIL_PATTERNS}
    try:
        with open(path, 'rb') as handle:
            handle.seek(0, os.SEEK_END)
            handle.seek(max(0, handle.tell() - TAIL_BYTES))
            text = handle.read().decode('utf-8', 'ignore')
    except OSError:
        return found
    for name, pattern in TAIL_PATTERNS.items():
        matches = pattern.findall(text)
        if matches:  # the last one is the top-level field
            found[name] = matches[-1] if name in ('latest_import_batch', 'connected_source') else int(matches[-1])
    return found


def utc_text(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


class HealthSnapshot:
    def __init__(self, app, clock=time.time):
        self.app = app
        self.clock = clock
        self.lock = threading.Lock()
        self.written = None  # (scan_id, completed_at) of the last count this process tried to save
        self.worker = None

    # -------------------------------------------------------------- the key
    @property
    def path(self):
        return os.path.join(self.app.DATA_DIR, FILE_NAME)

    def build_info(self):
        info = getattr(self.app, 'BUILD_INFO', None)
        build = info.get('build') if isinstance(info, dict) else None
        return {'version': str(getattr(self.app, 'AXIOM_VERSION', '')), 'build': str(build or getattr(self.app, 'AXIOM_BUILD', ''))}

    def policy(self):
        try:
            policy = self.app._current_access_policy() or {}
            return {'access_tier': policy.get('access_tier'), 'track_limit': policy.get('track_limit')}
        except Exception:
            return {'access_tier': None, 'track_limit': None}

    def key(self, stat):
        key = {'size': stat[0], 'mtime_ns': stat[1], 'module': MODULE_VERSION}
        key.update(tail_meta(self.app.CACHE_PATH))
        key.update(self.build_info())
        key.update(self.policy())
        return key

    # -------------------------------------------------------------- reading
    def streaming(self):
        cache = getattr(self.app, 'STREAMING_LIBRARY_CACHE', None)
        return bool(cache and cache.get('streaming_mode'))

    def core_has_result(self, stat):
        """True when AXIOM is counting now, or already holds the count for this very library file."""
        app = self.app
        with app.BACKGROUND_HEALTH_SCAN_LOCK:
            state = app.BACKGROUND_HEALTH_SCAN_STATE
            thread = app.BACKGROUND_HEALTH_SCAN_THREAD
            running = bool(thread and thread.is_alive()) or state.get('status') == 'scanning'
            held = state.get('status') == 'complete' and str(state.get('snapshot_fingerprint') or '').endswith(':%d:%d' % stat)
        return running or held

    def load(self):
        try:
            with open(self.path, 'r', encoding='utf-8') as handle:
                data = json.load(handle)
        except (OSError, ValueError):
            return None
        if not isinstance(data, dict) or not isinstance(data.get('payload'), dict) or not isinstance(data.get('key'), dict):
            return None
        if not isinstance(data.get('drives'), dict) or not isinstance(data.get('computed_epoch'), (int, float)):
            return None
        return data

    def saved_answer(self):
        """The saved count as a Health answer, or None when it must be counted again."""
        if self.streaming():
            return None
        stat = file_stat(self.app.CACHE_PATH)
        if stat is None or self.core_has_result(stat):
            return None
        data = self.load()
        if data is None:
            return None
        age = self.clock() - data['computed_epoch']
        if age >= MAX_AGE_SECONDS or age < -300:
            return None
        if data['key'] != self.key(stat):
            return None
        if data['drives'] != drive_presence(data['drives']):
            return None
        payload = dict(data['payload'])
        payload.update(status='complete', stale=False, from_snapshot=True, snapshot_available=True,
                       computed_at=utc_text(data['computed_epoch']), snapshot_age_seconds=int(max(0, age)))
        return payload

    # -------------------------------------------------------------- writing
    def remember(self, payload):
        """Save a count AXIOM has just finished, in a background thread (it reads the library to find the drives).
        Each count is tried once: a failed save only means a count next time, never a retry per poll."""
        app = self.app
        if (payload.get('status') != 'complete' or payload.get('stale') or payload.get('from_snapshot')
                or payload.get('streaming_mode') or not isinstance(payload.get('summary'), dict)):
            return
        with app.BACKGROUND_HEALTH_SCAN_LOCK:
            state = app.BACKGROUND_HEALTH_SCAN_STATE
            marker = (state.get('scan_id'), payload.get('completed_at'))
            counted = str(state.get('snapshot_fingerprint') or '')
        with self.lock:
            if marker == self.written:
                return
            self.written = marker  # on every attempt
            self.worker = threading.Thread(target=self.save, args=(payload, counted), daemon=True, name='health-snapshot-save')
            self.worker.start()

    def wait(self, timeout=60):
        worker = getattr(self, 'worker', None)
        if worker is not None:
            worker.join(timeout)

    def save(self, payload, counted):
        app = self.app
        temp = None
        try:
            before = file_stat(app.CACHE_PATH)
            if before is None or not counted.endswith(':%d:%d' % before):
                return  # the library changed while it was counted
            tracks = app._all_library_cache_tracks(app.load_cache(app.CACHE_PATH))
            roots = {drive_root(t.get('path')) for t in tracks if isinstance(t, dict)} - {''}
            if file_stat(app.CACHE_PATH) != before:
                return
            now = self.clock()
            record = {'payload': payload, 'key': self.key(before), 'drives': drive_presence(roots),
                      'computed_epoch': now, 'computed_at': utc_text(now)}
            os.makedirs(app.DATA_DIR, exist_ok=True)
            temp = '%s.%d.tmp' % (self.path, os.getpid())
            with open(temp, 'w', encoding='utf-8') as handle:
                json.dump(record, handle, ensure_ascii=False)
            os.replace(temp, self.path)
        except Exception:
            if temp:
                try:
                    os.remove(temp)
                except OSError:
                    pass


def install(app, clock=time.time):
    from flask import jsonify, request
    flask_app = app.app
    endpoint = 'api_library_health'
    original = flask_app.view_functions[endpoint]
    if getattr(original, 'windows_original', None):
        return getattr(original, 'windows_snapshot', None)
    snapshot = HealthSnapshot(app, clock)

    def api_library_health(*args, **kwargs):
        force = str(request.args.get('force') or '').strip().lower() in FORCE_VALUES
        if request.method == 'GET' and not force:
            try:
                answer = snapshot.saved_answer()
            except Exception:
                answer = None  # anything odd: count as AXIOM always did
            if answer is not None:
                return jsonify(answer)
        response = flask_app.make_response(original(*args, **kwargs))
        if request.method == 'GET' and response.status_code == 200 and response.is_json:
            snapshot.remember(response.get_json(silent=True) or {})
        return response
    api_library_health.__name__ = original.__name__
    api_library_health.windows_original = original
    api_library_health.windows_snapshot = snapshot
    flask_app.view_functions[endpoint] = api_library_health
    return snapshot
