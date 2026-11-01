"""Which browser shows PEAK HOUR's window: Microsoft Edge (the default) or Google Chrome.

Both open PEAK HOUR the same way: an app window (no tabs or address bar) with a profile of its own
in the data folder, so the user's everyday browser tabs, sign-ins and history are never mixed in.
Edge and Chrome keep separate profiles ("Window" and "Window-Chrome"): their profile formats differ,
and sharing one would damage it. Choices made inside the window (welcome tour seen, Library Type
filter, video audio-only) belong to that profile, so they start fresh after a switch; the library,
playlists and settings kept by PEAK HOUR itself are unaffected.

The choice is kept in window-browser.json and used from the next start. If the chosen browser is not
installed the other one is used, and with neither the default browser opens.
"""
import json
import os
from pathlib import Path

from flask import Blueprint, jsonify, request

BROWSERS = {
    'edge': ('Microsoft Edge', Path('Microsoft', 'Edge', 'Application', 'msedge.exe'), 'Window'),
    'chrome': ('Google Chrome', Path('Google', 'Chrome', 'Application', 'chrome.exe'), 'Window-Chrome'),
}
DEFAULT = 'edge'


def find(name):
    """The installed program file of 'edge' or 'chrome', or None."""
    for base in (os.environ.get('ProgramFiles(x86)'), os.environ.get('ProgramFiles'), os.environ.get('LOCALAPPDATA')):
        if base:
            candidate = Path(base) / BROWSERS[name][1]
            if candidate.is_file():
                return candidate
    return None


class WindowBrowser:
    def __init__(self, data_root):
        self.data_root = Path(data_root)
        self.path = self.data_root / 'window-browser.json'

    def chosen(self):
        try:
            name = json.loads(self.path.read_text(encoding='utf-8')).get('browser')
        except (OSError, ValueError, AttributeError):
            name = None
        return name if name in BROWSERS else DEFAULT

    def choose(self, name):
        if name not in BROWSERS:
            raise ValueError('Choose edge or chrome.')
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps({'browser': name}), encoding='utf-8')
        os.replace(temporary, self.path)

    def resolve(self):
        """(name, program, profile folder) to open the window with, or None for the default browser."""
        chosen = self.chosen()
        for name in (chosen, *(n for n in BROWSERS if n != chosen)):
            program = find(name)
            if program:
                return name, program, self.data_root / BROWSERS[name][2]
        return None

    def snapshot(self):
        return {'success': True, 'browser': self.chosen(),
                'installed': {name: find(name) is not None for name in BROWSERS},
                'labels': {name: info[0] for name, info in BROWSERS.items()}}


def create_browser_blueprint(window_browser, current):
    """current(): the browser name the open window is using now (None for the default browser)."""
    blueprint = Blueprint('peak_hour_window_browser', __name__)

    @blueprint.get('/api/windows/window-browser')
    def status():
        return jsonify({**window_browser.snapshot(), 'current': current()})

    @blueprint.post('/api/windows/window-browser')
    def change():
        name = (request.get_json(silent=True) or {}).get('browser')
        if name not in BROWSERS:
            return jsonify({'success': False, 'error': 'Choose Microsoft Edge or Google Chrome.'}), 400
        if find(name) is None:
            return jsonify({'success': False, 'error': f'{BROWSERS[name][0]} is not installed on this PC.'}), 409
        window_browser.choose(name)
        return jsonify({**window_browser.snapshot(), 'current': current()})

    return blueprint
