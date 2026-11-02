"""PEAK HOUR names on downloaded files.

The compiled core still names its downloads AXIOM_EXPORT.csv, AXIOM_REKORDBOX.xml, AXIOM_SET...,
AXIOM_MISSING_KEYS_..., AXIOM_INTELLIGENCE_PACK_... and AXIOM-Beatgrid-Doctor-.... filename() maps
such a name to its PEAK HOUR form (same rules as the browser side) and install() applies it to the
filename= / filename*= parts of the Content-Disposition header, but ONLY on responses from the app's own export routes
(EXPORT_ENDPOINTS, matched on request.endpoint). Routes serving the user's own files (library stream, audio/video
preview, artwork, waveform, downloads of user media) are never touched, so a song named AXIOM_Mix.mp3 keeps its
name; any other endpoint, inline dispositions included, counts as user media. Nothing else in a response changes.
"""
import re
import urllib.parse

import flask

# Endpoints whose files the app names itself (core names: AXIOM_EXPORT.csv, AXIOM_REKORDBOX.xml, AXIOM_SET*,
# AXIOM_MISSING_KEYS_*, AXIOM_INTELLIGENCE_PACK_*, AXIOM-Beatgrid-Doctor-*, AXIOM Project.axiom.zip).
# Keys are Flask endpoint names as in the built app's url_map (see bytecode_inventory/registered_routes.json).
EXPORT_ENDPOINTS = frozenset((
    'api_export_csv',                                 # POST /api/studio/export_csv
    'api_export_xml',                                 # POST /api/studio/export_xml
    'api_export',                                     # POST /api/studio/export
    'api_export_serato_safe',                         # POST /api/studio/export_serato_safe
    'api_export_serato_crate',                        # POST /api/studio/export_serato_crate
    'api_library_export_key_analysis_batch',          # POST /api/library/export_key_analysis_batch
    'api_export_intelligence_pack',                   # GET  /api/intelligence/export
    'api_export_no_cue_points_serato',                # POST /api/library/export_no_cue_points_serato
    'api_export_year_fixes_serato',                   # POST /api/library/export_year_fixes_serato
    'api_favorites_export_serato',                    # POST /api/favorites/export_serato
    'api_health_beatgrid_doctor_mirror_preparation',  # /api/library/health/dj_transfer/mirror_* (mirror_receipt's own AXIOM- name)
    'api_health_beatgrid_doctor_library',             # GET /api/library/health/beatgrid_doctor/library_receipt (AXIOM-Beatgrid-Doctor-...-receipt.json)
    'health_metadata_batch.report',                   # /api/library/health_publish/report (AXIOM-health-... CSV)
    'studio_bundles.export_project',                  # POST /api/studio-daw/project/bundle
    'studio_bundles.download_project',                # GET  /api/studio-daw/project/bundle/<name>
))

# Only the start (and the .axiom.zip / .axiom.json ending) of a name is rewritten, never the middle.
_PREFIXES = (('AXIOM_', 'PEAK_HOUR_'), ('AXIOM-', 'PEAK-HOUR-'), ('axiom-', 'peak-hour-'))
_PROJECT = re.compile(r'^AXIOM Project(?=[ .])')  # the Studio bundle name; other "AXIOM ..." names are the user's own
_SUFFIXES = (('.axiom.zip', '.peakhour.zip'), ('.axiom.json', '.peakhour.json'))
# filename="quoted"  filename=bare  filename*=UTF-8''percent%20encoded   (name is matched whole-word)
_PARAM = re.compile(r'(?<![\w*-])(filename\*?)(\s*=\s*)("(?:[^"\\]|\\.)*"|[^;]*)', re.I)


def filename(name):
    """The PEAK HOUR form of a download file name (unchanged when it is not an AXIOM name)."""
    if not isinstance(name, str):
        return name
    for old, new in _PREFIXES:
        if name.startswith(old):
            name = new + name[len(old):]
            break
    name = _PROJECT.sub('PEAK HOUR Project', name)
    for old, new in _SUFFIXES:
        if name.endswith(old):
            name = name[:-len(old)] + new
            break
    return name


def _extended(value):
    """filename*= value: charset'language'percent-encoded-name. Unchanged when the name needs no rewrite."""
    parts = value.strip().split("'", 2)
    if len(parts) != 3:
        return value
    charset, language, encoded = parts
    try:
        decoded = urllib.parse.unquote(encoded, encoding=charset or 'utf-8', errors='strict')
    except (LookupError, UnicodeDecodeError):
        return value
    renamed = filename(decoded)
    if renamed == decoded:
        return value
    return f"{charset}'{language}'{urllib.parse.quote(renamed, safe='!#$&+-.^_`|~', encoding=charset or 'utf-8')}"


def _rewrite(match):
    key, equals, value = match.groups()
    if key.endswith('*'):
        return key + equals + _extended(value)
    if len(value) > 1 and value.startswith('"') and value.endswith('"'):
        return key + equals + '"' + filename(value[1:-1]) + '"'
    stripped = value.strip()
    return key + equals + filename(stripped) + value[len(value.rstrip()):]


def disposition(value):
    """A Content-Disposition header value with only its file names renamed."""
    return _PARAM.sub(_rewrite, value)


def install(app):
    flask_app = app.app

    @flask_app.after_request
    def _peak_hour_download_names(response):
        try:
            value = response.headers.get('Content-Disposition')
            # user files (stream, preview, artwork...) and anything not allowlisted, inline or not, keep their names
            if value and flask.request.endpoint in EXPORT_ENDPOINTS:
                renamed = disposition(value)
                if renamed != value:
                    response.headers['Content-Disposition'] = renamed
        except Exception:  # a naming bug must never turn a download into an error
            pass
        return response
