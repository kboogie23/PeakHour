"""VirtualDJ versions of AXIOM's Serato crate exports, as new VirtualDJ lists.

- Year fixes: the same songs and order as AXIOM's "Serato year handoff"
  (api_export_year_fixes_serato): a release year above zero and, unless every
  year-ready song is wanted, a year AXIOM set itself (year_source or
  year_updated_at); sorted by year, artist, title/filename; up to max_tracks
  (default 500, at most 2000).
- No cue points: AXIOM library songs that have no cue point in VirtualDJ's
  own database (the Serato version uses AXIOM's Serato cue evidence, which
  says nothing about VirtualDJ).
Favorites need no server route: the page already holds the favorites list
and uses the existing /api/windows/virtualdj/lists route.

Each list is written by windows_virtualdj_lists.write_new_vdjfolder: a new
MyLists file, never replacing an existing list, only while VirtualDJ is closed.
"""
import ntpath
import os
from pathlib import Path

from flask import Blueprint, jsonify, request

from windows_virtualdj_database import read_database, VirtualDJDatabaseError
from windows_virtualdj_library import database_paths as all_databases
from windows_virtualdj_lists import (VirtualDJListError, database_paths, ensure_virtualdj_closed,
                                     virtualdj_home, write_new_vdjfolder)


def year_fix_tracks(app, include_all=False, max_tracks=500):
    """(tracks, total candidates) exactly as AXIOM's Serato year handoff selects them."""
    try:
        max_tracks = int(max_tracks or 500)
    except (TypeError, ValueError):
        max_tracks = 500
    max_tracks = max(1, min(max_tracks, 2000))
    picked = []
    for track in app.load_cache(app.CACHE_PATH).get('tracks', []):
        year = app.coerce_release_year(track.get('year'))
        if not year or year <= 0:
            continue
        if not include_all and not (track.get('year_source') or track.get('year_updated_at')):
            continue
        picked.append(dict(track, year=year))
    picked.sort(key=lambda item: (app.coerce_release_year(item.get('year')) or 0, str(item.get('artist') or '').lower(),
                                  str(item.get('title') or item.get('filename') or '').lower()))
    return picked[:max_tracks], len(picked)


def no_cue_tracks(app, databases=all_databases):
    """AXIOM library songs on this PC with no cue point in VirtualDJ."""
    cued = set()
    for database in databases():
        try:
            inventory = read_database(database)
        except VirtualDJDatabaseError:
            continue
        for track in inventory['tracks']:
            if track.get('path_kind') == 'windows_absolute' and any(
                    poi.get('attributes', {}).get('Type') == 'cue' for poi in track.get('source_sections', {}).get('Poi', [])):
                cued.add(ntpath.normcase(ntpath.normpath(track['path'])))
    return [t for t in app.load_cache(app.CACHE_PATH).get('tracks', [])
            if t.get('path') and os.path.isfile(t['path'])
            and ntpath.normcase(ntpath.normpath(str(t['path']))) not in cued]


def write_list(name, tracks, allowed_path, home=virtualdj_home, ensure_closed=ensure_virtualdj_closed):
    paths = []
    for track in tracks:
        path = Path(str(track.get('path') or ''))
        if path.is_absolute() and path.is_file() and not path.is_symlink() and allowed_path(path.resolve(strict=True)):
            paths.append(str(path))
    if not paths:
        raise ValueError('None of these songs are available on this PC.')
    folder = Path(home())
    databases = []
    for db in database_paths(folder, paths):
        try:
            databases.append(read_database(db))
        except VirtualDJDatabaseError:
            pass  # metadata is optional
    return write_new_vdjfolder(folder / 'MyLists', name, paths, databases, ensure_closed)


def create_exports_blueprint(app, allowed_path, license_guard, databases=all_databases, **writer):
    bp = Blueprint('windows_virtualdj_exports', __name__)

    def respond(action, select):
        gate = license_guard(action)
        if gate:
            return gate
        data = request.get_json(silent=True) or {}
        try:
            tracks, extra = select(data)
            result = write_list(str(data.get('name') or ''), tracks, allowed_path, **writer)
            return jsonify(success=True, **extra, **result)
        except FileExistsError:
            return jsonify(success=False, error='A VirtualDJ list with this name already exists. Nothing was overwritten.'), 409
        except (OSError, ValueError, VirtualDJListError, VirtualDJDatabaseError) as exc:
            return jsonify(success=False, error=str(exc)), 400

    @bp.post('/api/windows/virtualdj/export/year_fixes')
    def year_fixes():
        def select(data):
            tracks, total = year_fix_tracks(app, data.get('include_all_year_ready') is True, data.get('max_tracks'))
            return tracks, {'total_year_fix_candidates': total}
        return respond('VirtualDJ year list', select)

    @bp.post('/api/windows/virtualdj/export/no_cue')
    def no_cue():
        return respond('VirtualDJ no-cue list', lambda data: (no_cue_tracks(app, databases), {}))
    return bp
