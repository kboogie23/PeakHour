"""Speed-ups for big libraries on Windows, each giving exactly AXIOM's own answer.

health_recordings.recording_classification decides whether a track is a long recording (DJ mix, live set)
that Health should leave out. Library asks for it for every track on every page of 40 (the filter counts
in _library_preparation_counts), and each call builds the title text and runs two regular expressions:
with 20,339 tracks that was most of the 0.6 s each Library page took. The expressions only matter at 15
minutes or longer (900 s); below that, with no manual override, AXIOM always answers "Individual music
track". So shorter tracks get that answer straight away (a new dict each time, as AXIOM returns), and
everything else, overrides included, goes to AXIOM's function.

_track_source_connected (is the file still on its drive?) runs twice for each of the 40 tracks on a Library
page; on a USB drive each check costs a few milliseconds. Within one read-only (GET) request each file is
checked once; requests that can move or delete files always ask the drive.

The Health count stats and resolves every track's file each time Health opens; see faster_health_count.

_strip_suffixes (normalize_title / normalize_artist) built its pattern from TITLE_ARTIST_SUFFIXES on every
call: sorted, escaped and joined, then compiled for each title and artist. The enrichment report made
123,000 such calls (11.6 s). The pattern is now built once for each distinct suffix list.
"""
import math
import os
import re

MUSIC = ('music', 'Individual music track')
MANUAL = frozenset({'dj_mix', 'music', 'live_recording'})  # AXIOM's override values
SHORTEST_RECORDING = 900


def _duration(track):
    """AXIOM's own reading: the first of duration_sec / duration that is a finite positive number."""
    for field in ('duration_sec', 'duration'):
        try:
            value = float(track.get(field) or 0)
            if math.isfinite(value) and value > 0:
                return value
        except (ValueError, TypeError):
            pass
    return 0


def quick_classification(original):
    def recording_classification(track):
        info = track or {}
        if info.get('health_recording_override') in MANUAL or _duration(info) >= SHORTEST_RECORDING:
            return original(track)
        return {'type': MUSIC[0], 'excluded': False, 'reason': MUSIC[1], 'manual': False}
    recording_classification.windows_original = original
    return recording_classification


def once_per_request(original):
    from flask import g, has_request_context, request

    def track_source_connected(track):
        path = str((track or {}).get('path') or '') if isinstance(track, dict) else None
        if path is None or not has_request_context() or request.method != 'GET':
            return original(track)
        seen = g.setdefault('windows_source_connected', {})
        if path not in seen:
            seen[path] = original(track)
        return seen[path]
    track_source_connected.windows_original = original
    return track_source_connected


def faster_health_count(original):
    """AXIOM's Health count (_run_health_scan_job, a thread started each time Health opens) stats and
    resolves every track's file. On the exFAT USB drive with 20,283 videos in one folder each stat cost
    about 6 ms of processor time, about two minutes per count at full load. In that thread files are
    answered from one folder listing (windows_intake.FastRealpath): same existence, size and modified time."""
    from windows_intake import FAST_REALPATH

    def run_health_scan_job(*args, **kwargs):
        with FAST_REALPATH.active(stat=True):
            return original(*args, **kwargs)
    run_health_scan_job.windows_original = original
    return run_health_scan_job


def suffix_stripper(app):
    patterns = {}

    def _strip_suffixes(value):
        suffixes = tuple(app.TITLE_ARTIST_SUFFIXES)
        found = patterns.get(suffixes)
        if found is None:  # AXIOM's own construction, done once
            suffix_pattern = '|'.join(re.escape(s) for s in sorted(suffixes, key=len, reverse=True))
            found = patterns[suffixes] = (re.compile(rf'\b(?:{suffix_pattern})\b\s*$', re.IGNORECASE),
                                          re.compile(rf'\b(?:{suffix_pattern})\b', re.IGNORECASE))
        return found[1].sub(' ', found[0].sub(' ', value))
    _strip_suffixes.windows_original = app._strip_suffixes
    return _strip_suffixes


def install(app):
    from windows_intake import FAST_REALPATH
    if not getattr(app._strip_suffixes, 'windows_original', None):
        app._strip_suffixes = suffix_stripper(app)
    if getattr(os.stat, '__self__', None) is not FAST_REALPATH:  # a bound method is a new object each time
        FAST_REALPATH.original_stat = os.stat
        os.stat = FAST_REALPATH.stat  # only answers from a listing inside an active Health count
    if not getattr(app._run_health_scan_job, 'windows_original', None):
        app._run_health_scan_job = faster_health_count(app._run_health_scan_job)
    if not getattr(app._track_source_connected, 'windows_original', None):
        app._track_source_connected = once_per_request(app._track_source_connected)
    import health_recordings
    if getattr(health_recordings.recording_classification, 'windows_original', None):
        return
    quick = quick_classification(health_recordings.recording_classification)
    health_recordings.recording_classification = quick  # is_health_recording looks it up here
    if getattr(app, 'recording_classification', None) is quick.windows_original:
        app.recording_classification = quick
