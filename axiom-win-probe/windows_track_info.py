"""Track Information on a big library: the same answer, without re-reading and re-resolving the library each time.

GET /api/library/track?path=... makes AXIOM (a) read library_cache.json and deep-copy all of it through
_load_access_limited_cache (46 MB, 49,111 tracks: about 0.4 s to read and 1.5-3 s to copy) and (b) run
_resolve_library_cache_tracks_for_health, which resolves the real path (canonical_path -> os.path.realpath) of
EVERY library track to find the one asked for (about 3 s; 13,000 of those tracks were on a drive that is not
connected). Both depend only on the library file and on which drives exist, so for this one route:

* _load_access_limited_cache: when there is no track limit, no locked tracks and the caller does not write back,
  AXIOM's deep copy changes nothing but the 'tracks'/'total_tracks' keys, so the freshly read library is used as
  it is, and kept while library_cache.json keeps the same (size, mtime_ns). Any AXIOM write changes that
  signature, so the next open reads the new file. Kept in memory for IDLE_SECONDS after the last open.
* _resolve_library_cache_tracks_for_health still runs AXIOM's own function, but each library track's path is
  resolved once per (library file signature, set of connected drives) and remembered. The requested path itself
  is always resolved live, and the page's source_connected check (os.path.isfile of that one file) is AXIOM's
  own and untouched.
The remembered paths are invalidated only by the drive-letter mask and the library file signature (and by
idle release); a file renamed or relinked on disk meanwhile is not noticed until one of those changes.
Every other route, caller or situation gets AXIOM's functions exactly as before.
"""
import ctypes
import inspect
import os
import threading
import time

IDLE_SECONDS = 120.0


def drive_signature():
    """Bit mask of the connected drive letters (a drive appearing or leaving changes what paths resolve to)."""
    try:
        return int(ctypes.windll.kernel32.GetLogicalDrives())
    except (AttributeError, OSError):
        return 0


def file_signature(path):
    try:
        stat = os.stat(path)
    except OSError:
        return None
    return (str(path), stat.st_size, stat.st_mtime_ns)


class TrackInfoCache:
    def __init__(self, app, drives=drive_signature, clock=time.monotonic):
        self.app, self.drives, self.clock = app, drives, clock
        self.lock = threading.RLock()
        self.fill_lock = threading.Lock()  # one Track Information resolve at a time; never held for other callers
        self.entry = None  # {'sig', 'cache', 'memo', 'drives', 'used'}
        self.local = threading.local()
        self.original_load = app._load_access_limited_cache
        self.original_resolve = app._resolve_library_cache_tracks_for_health
        self.original_canonical = app.canonical_path
        self.load_calls = self.canonical_calls = 0  # for tests

    @staticmethod
    def in_track_request():
        from flask import has_request_context, request
        return has_request_context() and request.method == 'GET' and request.path == '/api/library/track'

    def expire(self):
        """Release the library once it has been idle IDLE_SECONDS; if it was used meanwhile, check again when
        the remaining idle time is up (so it is released after the last open, not kept until the library changes)."""
        with self.lock:
            if not self.entry:
                return
            idle = self.clock() - self.entry['used']
            if idle > IDLE_SECONDS:
                self.entry = None
                return
            remaining = IDLE_SECONDS - idle
        self._schedule_expiry(remaining + 1)

    def _schedule_expiry(self, delay=None):
        timer = threading.Timer(IDLE_SECONDS + 1 if delay is None else delay, self.expire)
        timer.daemon = True
        timer.start()

    def load(self, *args, **kwargs):
        app = self.app
        write_back = args[0] if args else kwargs.get('write_back', False)
        try:
            if write_back or kwargs.keys() - {'write_back'} or len(args) > 1 or not self.in_track_request():
                return self.original_load(*args, **kwargs)
            with app.STREAMING_LIBRARY_LOCK:
                if app.STREAMING_LIBRARY_CACHE.get('streaming_mode'):
                    return self.original_load(*args, **kwargs)
            policy = app._current_access_policy()
            sig = file_signature(app.CACHE_PATH)
            if sig is None or policy.get('track_limit'):
                return self.original_load(*args, **kwargs)
        except Exception:
            return self.original_load(*args, **kwargs)
        with self.lock:
            entry = self.entry
            if entry is not None and entry['sig'] == sig:
                entry['used'] = self.clock()
                return entry['cache'], policy, 0
            cache = app.load_cache(app.CACHE_PATH)
            self.load_calls += 1
            if not cache or cache.get('locked_tracks'):
                self.entry = None
                return self.original_load(*args, **kwargs)
            cache['tracks'] = list(cache.get('tracks') or [])
            cache['total_tracks'] = len(cache['tracks'])
            for key in ('locked_tracks', 'original_total_tracks', 'proof_sample', 'track_limit'):
                cache.pop(key, None)
            self.entry = {'sig': sig, 'cache': cache, 'memo': {}, 'drives': self.drives(), 'used': self.clock()}
            self._schedule_expiry()
            return cache, policy, 0

    def canonical(self, path, *args, **kwargs):
        memo = getattr(self.local, 'memo', None)
        if memo is None or args or kwargs or not isinstance(path, str) or path == self.local.live:
            return self.original_canonical(path, *args, **kwargs)
        try:
            return memo[path]
        except KeyError:
            self.canonical_calls += 1
            value = memo[path] = self.original_canonical(path)
            return value

    def resolve(self, *args, **kwargs):
        with self.lock:  # identity checks only; AXIOM's function for anyone else runs outside the lock
            entry = self.entry
            ours = not (entry is None or not args or args[0] is not entry['cache'] or not self.in_track_request())
            if ours:
                drives = self.drives()
                if drives != entry['drives']:  # a drive appeared or went away: resolve everything again
                    entry['memo'], entry['drives'] = {}, drives
                entry['used'] = self.clock()
                memo = entry['memo']
        if not ours:
            return self.original_resolve(*args, **kwargs)
        raw = args[1] if len(args) > 1 else kwargs.get('path')
        with self.fill_lock:
            self.local.memo, self.local.live = memo, str(raw or '').strip()
            try:
                return self.original_resolve(*args, **kwargs)
            finally:
                self.local.memo = self.local.live = None


def install(app):
    if getattr(app, '_windows_track_info_installed', False):
        return
    cache = TrackInfoCache(app)
    app.TRACK_INFO_CACHE = cache
    app._load_access_limited_cache = cache.load
    app._resolve_library_cache_tracks_for_health = cache.resolve
    app.canonical_path = cache.canonical
    app._windows_track_info_installed = True
