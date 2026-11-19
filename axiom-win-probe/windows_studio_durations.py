r"""Magic Set rows show real song lengths: the Studio answers carry duration_sec.

The compiled server's answers for POST /api/studio/generate_from_curve (`tracks`), /api/studio/build_around_tracks
(`playlist`), /api/studio/autofill (`tracks`), /api/studio/generate_from_anchor (`tracks`) and /api/studio/optimize
(`optimized`) leave out `duration_sec` / `duration_min` even for songs whose library record has `duration_sec` (what a real
scan writes). The page (studioTrackDurationSeconds) reads only those two fields, so every generated row showed "--:--" and the
"Total time" chip and the set length were estimated at 3.5 minutes a song.

An after_request hook fills `duration_sec` from the library record of each track path in those lists, and nothing else: no
other key, no other route, no track that already has a positive duration_sec, no track the library does not know. The
library is read once into a dict {path: duration_sec} (exact path and its normalised spelling) and kept while
library_cache.json keeps the same (size, mtime_ns), so a 60-song set costs 60 dict lookups even on a 50,000-song library.
On any error the response is passed through untouched.
"""
import json
import ntpath
import os
import threading

ROUTES = {'/api/studio/generate_from_curve': ('tracks',), '/api/studio/build_around_tracks': ('playlist',),
          '/api/studio/autofill': ('tracks',), '/api/studio/generate_from_anchor': ('tracks',),
          '/api/studio/optimize': ('optimized',)}


def _positive(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return value if number > 0 and number == number and number != float('inf') else None


def _normal(path):
    return ntpath.normcase(os.path.abspath(path))


class DurationIndex:
    """{track path -> duration_sec} for the library, rebuilt only when library_cache.json changes."""

    def __init__(self, app):
        self.app = app
        self.lock = threading.Lock()
        self.signature = None
        self.exact = {}
        self.normal = {}
        self.builds = 0  # for tests

    def _signature(self):
        stat = os.stat(self.app.CACHE_PATH)
        return (str(self.app.CACHE_PATH), stat.st_size, stat.st_mtime_ns)

    def _build(self):
        app = self.app
        cache = app.load_cache(app.CACHE_PATH)
        tracks = app._all_library_cache_tracks(cache) if hasattr(app, '_all_library_cache_tracks') else (cache or {}).get('tracks') or []
        exact, normal = {}, {}
        for track in tracks:
            if not isinstance(track, dict) or not isinstance(track.get('path'), str):
                continue
            seconds = _positive(track.get('duration_sec'))
            if seconds is None:
                continue
            exact[track['path']] = seconds
            normal.setdefault(_normal(track['path']), seconds)
        return exact, normal

    def refresh(self):
        signature = self._signature()
        if signature == self.signature:
            return
        with self.lock:
            if signature == self.signature:
                return
            self.exact, self.normal = self._build()
            self.signature = signature
            self.builds += 1

    def lookup(self, path):
        seconds = self.exact.get(path)
        if seconds is None:
            seconds = self.normal.get(_normal(path))
        return seconds


def fill(data, keys, index):
    """Put duration_sec on the listed tracks that lack it. Returns how many were filled."""
    filled = 0
    for key in keys:
        tracks = data.get(key) if isinstance(data, dict) else None
        if not isinstance(tracks, list):
            continue
        for track in tracks:
            if not isinstance(track, dict) or not isinstance(track.get('path'), str) or not track['path']:
                continue
            if _positive(track.get('duration_sec')) is not None:
                continue
            seconds = index.lookup(track['path'])
            if seconds is not None:
                track['duration_sec'] = seconds
                filled += 1
    return filled



def make_after_request(index):
    from flask import request

    def after(response):
        try:
            keys = ROUTES.get(request.path)
            if (keys is None or request.method != 'POST' or response.status_code != 200 or response.mimetype != 'application/json'
                    or response.direct_passthrough or response.is_streamed):
                return response
            data = json.loads(response.get_data(as_text=True))
            if not isinstance(data, dict) or not any(isinstance(data.get(key), list) for key in keys):
                return response
            index.refresh()
            if not fill(data, keys, index):
                return response
            body = json.dumps(data)
            response.set_data(body)
            response.headers['Content-Length'] = str(len(response.get_data()))
        except Exception:
            return response  # whatever went wrong, the answer the server made is what the page gets
        return response
    return after


def install(app):
    flask_app = app.app
    if getattr(flask_app, '_windows_studio_durations', False):
        return
    app.WINDOWS_DURATION_INDEX = DurationIndex(app)
    flask_app.after_request(make_after_request(app.WINDOWS_DURATION_INDEX))
    flask_app._windows_studio_durations = True
