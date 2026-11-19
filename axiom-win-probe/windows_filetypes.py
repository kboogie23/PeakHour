"""Library > Type: show only audio, only video, or one file type (MP3, M4A, WAV, FLAC, MP4, VOB, AVI...).

The Library list (/get-tracks) and its search (/api/library/search) both start from AXIOM's read-only library
snapshot (_load_library_search_snapshot). When the page sends `filetype` (a group, "audio" or "video", or an
extension such as "mp3"), those two requests get a copy of the snapshot holding only that type, under its own
search-index key, so the list, its counts, paging and search all follow it. The shared snapshot is not changed
and every other request is unaffected.
/api/windows/library/types reports how many library tracks there are of each type for the dropdown.
"""
import os

from flask import Blueprint, has_request_context, jsonify, request

AUDIO = {'.mp3', '.m4a', '.aac', '.wav', '.aif', '.aiff', '.flac', '.ogg', '.alac', '.wma', '.opus'}
VIDEO = {'.mp4', '.m4v', '.mov', '.avi', '.vob', '.mpg', '.mpeg', '.mkv', '.webm', '.wmv'}
LIBRARY_ROUTES = ('/get-tracks', '/api/library/search')


def extension(track):
    return os.path.splitext(str((track or {}).get('path') or (track or {}).get('filename') or ''))[1].lower()


def matches_type(track, wanted):
    ext = extension(track)
    if wanted == 'audio':
        return ext in AUDIO
    if wanted == 'video':
        return ext in VIDEO
    return ext == '.' + wanted.lstrip('.')


def requested_type():
    if not has_request_context() or request.path not in LIBRARY_ROUTES:
        return ''
    wanted = str(request.args.get('filetype') or '').strip().lower()
    return wanted if wanted in ('audio', 'video') or (wanted.isalnum() and len(wanted) <= 5) else ''


def type_counts(tracks):
    counts = {}
    for track in tracks:
        ext = extension(track)
        if ext:
            counts[ext] = counts.get(ext, 0) + 1
    return {'audio': sum(n for e, n in counts.items() if e in AUDIO), 'video': sum(n for e, n in counts.items() if e in VIDEO),
            'types': [{'type': e.lstrip('.'), 'count': n, 'group': 'video' if e in VIDEO else 'audio' if e in AUDIO else 'other'}
                      for e, n in sorted(counts.items(), key=lambda item: -item[1])]}


def install(app):
    original = app._load_library_search_snapshot
    if getattr(original, 'windows_original', None):
        return

    def load_library_search_snapshot(*args, **kwargs):
        result = original(*args, **kwargs)
        wanted = requested_type()
        if not wanted:
            return result
        cache, policy, trimmed, index_key = result
        narrowed = dict(cache)
        for name in ('tracks', 'locked_tracks'):
            if isinstance(cache.get(name), list):
                narrowed[name] = [t for t in cache[name] if matches_type(t, wanted)]
        if isinstance(cache.get('total_tracks'), int):
            narrowed['total_tracks'] = len(narrowed.get('tracks') or [])
        return narrowed, policy, trimmed, (index_key, 'filetype', wanted)
    load_library_search_snapshot.windows_original = original
    app._load_library_search_snapshot = load_library_search_snapshot

    bp = Blueprint('windows_filetypes', __name__)

    counted = {}  # (library file mtime, size) -> counts: the page asks on every Library visit; reading 21,000 songs took 0.3 s each time

    @bp.get('/api/windows/library/types')
    def types():
        try:
            stat = os.stat(app.CACHE_PATH)
            key = (stat.st_mtime_ns, stat.st_size)
        except OSError:
            key = None
        if key is not None and counted.get('key') == key:
            return jsonify(success=True, **counted['counts'])
        cache = app.load_cache(app.CACHE_PATH)
        tracks = app._all_library_cache_tracks(cache) if hasattr(app, '_all_library_cache_tracks') else cache.get('tracks') or []
        counts = type_counts(tracks)
        if key is not None:
            counted.update(key=key, counts=counts)
        return jsonify(success=True, **counts)
    app.app.register_blueprint(bp)
