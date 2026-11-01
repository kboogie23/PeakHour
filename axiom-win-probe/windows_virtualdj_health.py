"""Health Accelerator for VirtualDJ: fill missing BPM, key and year in AXIOM from VirtualDJ.

AXIOM's Serato Database V2 accelerator copies trusted Serato BPM, key and
year into AXIOM's cache, matching songs by title and artist. VirtualDJ's
database.xml records each song's exact file path, so this matches by path
only. It fills values AXIOM is missing and never overwrites one AXIOM already
has: a different VirtualDJ value is listed as a conflict for the user to judge.
Only AXIOM's library cache changes (written with AXIOM's own load_cache and
safe_write_json); VirtualDJ's database and the audio files are read only.
"""
import ntpath
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from windows_virtualdj_database import read_database, VirtualDJDatabaseError
from windows_virtualdj_library import database_paths

ROW_LIMIT = 300


def virtualdj_values(databases):
    """{normalized path: {'bpm', 'key', 'year'}} from every VirtualDJ database (first database wins)."""
    values, errors = {}, []
    for database in databases():
        try:
            inventory = read_database(database)
        except VirtualDJDatabaseError as exc:
            errors.append(f'{database}: {exc}')
            continue
        for track in inventory['tracks']:
            if track.get('path_kind') != 'windows_absolute':
                continue
            key = ntpath.normcase(ntpath.normpath(track['path']))
            tags = (track.get('source_sections', {}).get('Tags') or [{}])[0].get('attributes', {})
            values.setdefault(key, {'bpm': track.get('bpm'), 'key': track.get('key'), 'year': tags.get('Year')})
    return values, errors


def pull(app, apply=False, databases=database_paths):
    cache = app.load_cache(app.CACHE_PATH)
    tracks = cache.get('tracks', []) if isinstance(cache, dict) else []
    source, errors = virtualdj_values(databases)
    if not source:
        return {'success': False, 'error': 'No VirtualDJ database was found on this PC.' + (' ' + errors[0] if errors else '')}
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    summary = {'checked': len(tracks), 'matched': 0, 'bpm': 0, 'key': 0, 'year': 0, 'conflicts': 0, 'updated': 0}
    rows = []
    for track in tracks:
        if not isinstance(track, dict) or not track.get('path'):
            continue
        vdj = source.get(ntpath.normcase(ntpath.normpath(str(track['path']))))
        if not vdj:
            continue
        summary['matched'] += 1
        changes, conflicts = {}, []
        bpm = app.coerce_bpm_value(vdj['bpm']) if vdj.get('bpm') else None
        if bpm:
            current = app.coerce_bpm_value(track.get('bpm')) if track.get('bpm') else None
            if not current:
                changes.update(bpm=bpm, energy=app.classify_energy(bpm), bpm_source='virtualdj_database')
            elif abs(current - bpm) > 0.5 and abs(current - 2 * bpm) > 1 and abs(2 * current - bpm) > 1:
                conflicts.append(f'BPM: AXIOM {current:g}, VirtualDJ {bpm:g}')
        camelot = app.get_camelot(vdj['key']) if vdj.get('key') else None
        if camelot:
            if not track.get('camelot'):
                changes.update(camelot=camelot, key_raw=vdj['key'], key_source='virtualdj_database')
            elif str(track.get('camelot')).upper() != str(camelot).upper():
                conflicts.append(f"Key: AXIOM {track.get('camelot')}, VirtualDJ {camelot}")
        year = app.coerce_release_year(vdj['year']) if vdj.get('year') else None
        if year:
            current = app.coerce_release_year(track.get('year')) if track.get('year') else None
            if not current:
                changes.update(year=year, era=app.get_era_from_year(year), year_source='virtualdj_database',
                               year_updated_at=now)
            elif current != year:
                conflicts.append(f'Year: AXIOM {current}, VirtualDJ {year}')
        for field in ('bpm', 'camelot', 'year'):
            if field in changes:
                summary['key' if field == 'camelot' else field] += 1
        summary['conflicts'] += bool(conflicts)
        if changes or conflicts:
            if changes and apply:
                track.update(changes)
                summary['updated'] += 1
            if len(rows) < ROW_LIMIT:
                rows.append({'title': track.get('title', ''), 'artist': track.get('artist', ''), 'path': track['path'],
                             'fills': {k: changes[k] for k in ('bpm', 'camelot', 'year') if k in changes},
                             'conflicts': conflicts})
    if apply and summary['updated']:
        app.safe_write_json(app.CACHE_PATH, cache)
    return {'success': True, 'apply': bool(apply), 'summary': summary, 'rows': rows, 'database_errors': errors,
            'source_audio_untouched': True, 'dj_library_untouched': True,
            'writes_to': 'AXIOM library cache' if apply else 'nothing (preview)'}


def create_health_blueprint(app, license_guard, databases=database_paths):
    bp = Blueprint('windows_virtualdj_health', __name__)

    @bp.post('/api/windows/virtualdj/health_pull')
    def health_pull():
        gate = license_guard('Use VirtualDJ data in Health')
        if gate:
            return gate
        data = request.get_json(silent=True) or {}
        try:
            return jsonify(pull(app, apply=data.get('apply') is True, databases=databases))
        except (OSError, ValueError) as exc:
            return jsonify(success=False, error=str(exc)), 400
    return bp
