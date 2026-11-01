"""Performance / Live Assist "now playing" from VirtualDJ (read-only).

AXIOM follows djay Pro and Serato live (_performance_dj_live_payload: one
provider per running DJ program, with session tokens, freshness and
ownership). VirtualDJ appends every played song to its session history,
History\\<year>\\<month>\\<date>.m3u, as an #EXTVDJ line (artist, title, play
time) followed by the song's exact file path. This reads that file into the
same payload shape as the Serato history provider.

AXIOM's provider table is fixed (djay, Serato), so VirtualDJ is served through
the Serato slot only while Serato itself is not running: the process check for
Serato reports VirtualDJ's processes, the Serato loader returns the VirtualDJ
payload, and the result is labelled provider "virtualdj" / "VirtualDJ". When
Serato is running, everything behaves exactly as before.
"""
import ntpath
import os
import re
import time
from pathlib import Path

HISTORY_MAX_AGE = 12 * 3600
HISTORY_LIMIT = 50
SERATO_NAMES = ('Serato DJ Pro', 'Serato DJ')
_FIELD = re.compile(r'<(\w+)>(.*?)</\1>')


def history_files(home):
    root = Path(home) / 'History'
    files = [p for p in root.rglob('*.m3u') if p.is_file() and not p.is_symlink()] if root.is_dir() else []
    return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)


def parse_history(path):
    """Played songs in order: {'path', 'artist', 'title', 'remix', 'time', 'played_at', 'length'}."""
    entries, info = [], None
    for line in Path(path).read_text(encoding='utf-8', errors='replace').splitlines():
        line = line.strip()
        if line.startswith('#EXTVDJ:'):
            info = dict(_FIELD.findall(line[len('#EXTVDJ:'):]))
        elif line and not line.startswith('#'):
            info = info or {}
            try:
                played = float(info.get('lastplaytime') or 0)
            except ValueError:
                played = 0.0
            try:
                length = float(info.get('songlength') or 0)
            except ValueError:
                length = 0.0
            entries.append({'path': line, 'artist': info.get('artist', ''), 'title': info.get('title', ''),
                            'remix': info.get('remix', ''), 'time': info.get('time', ''), 'played_at': played,
                            'length': length})
            info = None
    return entries


def _library(app):
    try:
        tracks = app.load_cache(app.CACHE_PATH).get('tracks', [])
    except Exception:
        return {}
    return {ntpath.normcase(ntpath.normpath(str(t['path']))): t for t in tracks if isinstance(t, dict) and t.get('path')}


def live_payload(app, home, now=time.time):
    base = {'source_audio_untouched': True, 'dj_database_untouched': True, 'provider': 'virtualdj',
            'source_label': 'VirtualDJ'}
    files = history_files(home)
    if not files or now() - files[0].stat().st_mtime > HISTORY_MAX_AGE:
        return dict(base, success=False, active=True, waiting_for_track=True,
                    error='Play a song in VirtualDJ; AXIOM follows its history.')
    entries = parse_history(files[0])
    if not entries:
        return dict(base, success=False, active=True, waiting_for_track=True, error='VirtualDJ has not played a song yet.')
    library = _library(app)

    def track(entry, live):
        key = ntpath.normcase(ntpath.normpath(entry['path']))
        known = library.get(key, {})
        name = f"{entry['artist']} - {entry['title']}" if entry['artist'] else entry['title']
        bpm = known.get('bpm')
        row = {'path': entry['path'], 'filename': ntpath.basename(entry['path']), 'title': known.get('title') or entry['title'],
               'name': name, 'artist': known.get('artist') or entry['artist'], 'album': known.get('album', ''),
               'source': 'virtualdj_history', 'connected_from': 'virtualdj', 'live_provider': 'virtualdj',
               'source_label': 'VirtualDJ', 'time_display': entry['time'], 'observed_at': entry['played_at'], 'is_live': live}
        if live:
            row.update(bpm=bpm, serato_bpm=None, bpm_source=known.get('bpm_source') or ('axiom' if bpm else ''),
                       energy=known.get('energy') or (app.classify_energy(bpm) if bpm else 'Unknown'), deck=None,
                       start_time=entry['played_at'])
        if entry['length'] and entry['played_at']:
            row['end_time'] = entry['played_at'] + entry['length']
        return row, key

    current, key = track(entries[-1], True)
    history = [track(entry, False)[0] for entry in reversed(entries[:-1])][:HISTORY_LIMIT]
    return dict(base, success=True, active=True, track=current, history=history, history_count=len(entries) - 1,
                path_exists=os.path.isfile(current['path']), match_key=key, observed_at=current['observed_at'],
                warning='' if key in library else 'This VirtualDJ song is not in your AXIOM library yet.')


def install(app, home_finder=None):
    if getattr(app, '_windows_virtualdj_live_installed', False):
        return
    from windows_virtualdj_lists import virtualdj_home, VirtualDJListError
    home_finder = home_finder or virtualdj_home
    snapshot, serato_payload, dj_payload = app._mac_process_snapshot, app._serato_live_history_payload, app._performance_dj_live_payload

    def serato_running():
        return bool(snapshot(*SERATO_NAMES).get('running'))

    def process_snapshot(*names):
        result = snapshot(*names)
        if tuple(names) == SERATO_NAMES and not result.get('running'):
            vdj = snapshot('VirtualDJ')
            if vdj.get('running') and vdj.get('token') != 'unverifiable':
                return dict(vdj, token='virtualdj:' + vdj['token'])
        return result

    def serato_history_payload():
        if serato_running():
            return serato_payload()
        try:
            return live_payload(app, home_finder())
        except (OSError, VirtualDJListError) as exc:
            return {'success': False, 'active': True, 'waiting_for_track': True, 'error': str(exc),
                    'provider': 'virtualdj', 'source_label': 'VirtualDJ', 'source_audio_untouched': True}

    def performance_dj_live_payload(*args, **kwargs):
        result = dj_payload(*args, **kwargs)
        track = result.get('track') if isinstance(result, dict) else None
        if isinstance(track, dict) and track.get('live_provider') == 'virtualdj':
            for field in ('provider', 'active_provider'):
                if result.get(field) == 'serato':
                    result[field] = 'virtualdj'
            result['source_label'] = 'VirtualDJ'
        return result

    app._mac_process_snapshot = process_snapshot
    app._serato_live_history_payload = serato_history_payload
    app._performance_dj_live_payload = performance_dj_live_payload
    app._windows_virtualdj_live_installed = True
