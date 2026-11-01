"""PEAK HOUR names on downloaded files.

The compiled core still names its downloads AXIOM_EXPORT.csv, AXIOM_REKORDBOX.xml, AXIOM_SET...,
AXIOM_MISSING_KEYS_..., AXIOM_INTELLIGENCE_PACK_... and AXIOM-Beatgrid-Doctor-.... filename() maps
such a name to its PEAK HOUR form (same rules as the browser side) and install() applies it to the
filename= / filename*= parts of every Content-Disposition header. Nothing else in a response changes.
"""
import re
import urllib.parse

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
            if value:
                renamed = disposition(value)
                if renamed != value:
                    response.headers['Content-Disposition'] = renamed
        except Exception:  # a naming bug must never turn a download into an error
            pass
        return response
