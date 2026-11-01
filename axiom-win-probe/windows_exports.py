"""Windows fixes for AXIOM's file exports.

rekordbox XML (/api/studio/export_xml, app.api_export_xml):
- A track with no key/year/etc. reaches ElementTree as None and the whole
  export fails with a 500 ("cannot serialize None"). Missing values are sent
  to AXIOM as empty strings instead.
- AXIOM builds Location as "file://localhost/" + quote(path). On Windows quote
  yields the djay-style "C:%5CUsers%5C..." (windows_djay); rekordbox expects
  "file://localhost/C:/Users/...", so the separators are rewritten.
"""
import re

XML_ENDPOINT = 'api_export_xml'
_LOCATION = re.compile(rb'(Location="file://localhost/)([A-Za-z]:)([^"]*)(")')


def fill_missing(payload):
    """Replace None values in each exported track with empty strings (in place)."""
    tracks = payload.get('playlist') if isinstance(payload, dict) else None
    if isinstance(tracks, list):
        for track in tracks:
            if isinstance(track, dict):
                for key, value in list(track.items()):
                    if value is None:
                        track[key] = ''
    return payload


def rekordbox_locations(body):
    """Rewrite Location="file://localhost/C:%5Cx%5Cy.mp3" to ".../C:/x/y.mp3"."""
    return _LOCATION.sub(lambda m: m.group(1) + m.group(2) + m.group(3).replace(b'%5C', b'/').replace(b'%5c', b'/') + m.group(4), body)


def install(app):
    from flask import request
    flask_app = app.app

    @flask_app.before_request
    def _fill_export_values():
        if request.endpoint == XML_ENDPOINT and request.is_json:
            fill_missing(request.get_json(silent=True))  # Flask caches the parsed body for the view

    @flask_app.after_request
    def _rekordbox_paths(response):
        if request.endpoint == XML_ENDPOINT and response.status_code == 200:
            response.direct_passthrough = False  # AXIOM sends the XML as a file; read it to rewrite
            response.set_data(rekordbox_locations(response.get_data()))
        return response
