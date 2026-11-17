r"""Health apply answers say what went wrong in plain words, not as "[Errno 9] Bad file descriptor".

The compiled server puts the operating system's own message in the answers of DJ Metadata Publish
(/api/library/metadata_publish/...), the year publish, /api/library/health_publish/... and the Title/Artist Cleanup
(/api/library/utility_metadata_cleanup and _preview): per song `reason`, `error`, `message`, `detail`. The page shows
those words as they are.

An after_request hook walks the JSON of those routes and, for a string under error, reason, message or detail that
carries "Errno" / "WinError" (friendly() then picks the sentence by the code or a known phrase), writes a plain sentence instead and keeps the original
words in sibling keys: `technical_detail` (the first one reworded in that object) and `technical_detail_<key>` (each
one). Only a string that itself carries the code is reworded. Nothing else changes. On any error the answer the server made goes through.
"""
import json
import re

PREFIXES = ('/api/library/metadata_publish/', '/api/library/year_publish/', '/api/library/health_publish/')
EXACT = ('/api/library/utility_metadata_cleanup', '/api/library/utility_metadata_preview')
KEYS = ('error', 'reason', 'message', 'detail')
CODE = re.compile(r'\[(Errno|WinError) -?\d+\]')

RULES = (
    (('[WinError 32]', 'being used by another process'),
     'This file is open in another program. Close your DJ software and try again.'),
    (('[Errno 13]', '[WinError 5]', 'Permission denied', 'Access is denied'),
     'This file is read-only or protected.'),
    (('[Errno 2]', '[WinError 2]', '[WinError 3]', 'No such file'),
     'This file could not be found. Check that its drive is connected.'),
    (('[Errno 28]', '[WinError 112]', 'No space left'),
     'The drive is full. Free some space and try again.'),
    (('[WinError 206]', '[Errno 36]'),
     "This file's folder path is too long for Windows."),
    (('[Errno 9]', 'Bad file descriptor'),
     'Windows did not let PEAK HOUR finish saving this file.'),
)
OTHER = 'This file could not be changed.'


def friendly(text):
    if not isinstance(text, str):
        return text
    for needles, words in RULES:
        if any(needle in text for needle in needles):
            return words
    if CODE.search(text):
        return OTHER
    return text


def rewrite(value):
    """Walk the JSON value; returns how many strings were replaced."""
    changed = 0
    if isinstance(value, dict):
        for key in list(value):
            item = value[key]
            if key in KEYS and isinstance(item, str):
                if 'Errno' not in item and 'WinError' not in item:
                    continue  # only a value that itself carries the code is reworded, not one that merely sounds alike
                words = friendly(item)
                if words != item:
                    value[key] = words
                    value.setdefault('technical_detail', item)  # the first original; each one is also kept under its own key
                    value['technical_detail_' + key] = item
                    changed += 1
            else:
                changed += rewrite(item)
    elif isinstance(value, list):
        for item in value:
            changed += rewrite(item)
    return changed


def make_after_request():
    from flask import request

    def after(response):
        try:
            path = request.path
            if not (path.startswith(PREFIXES) or path in EXACT):
                return response
            if response.mimetype != 'application/json' or response.direct_passthrough or response.is_streamed:
                return response
            text = response.get_data(as_text=True)
            if 'Errno' not in text and 'WinError' not in text:
                return response
            data = json.loads(text)
            if not rewrite(data):
                return response
            response.set_data(json.dumps(data))
            response.headers['Content-Length'] = str(len(response.get_data()))
        except Exception:
            return response  # whatever went wrong, the answer the server made is what the page gets
        return response
    return after


def install(app):
    flask_app = app.app
    if getattr(flask_app, '_windows_apply_wording', False):
        return
    flask_app.after_request(make_after_request())
    flask_app._windows_apply_wording = True
