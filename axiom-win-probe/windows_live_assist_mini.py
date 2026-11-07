"""PEAK HOUR Mini: a small always-on-top window with what Live Assist shows (static/windows-live-assist-mini.html).

The page only reads /api/performance/live_assist/state, which the main window publishes whether or not Live Assist
is open. An Edge app window cannot pin itself, so these routes find the window by its title and pin it with
SetWindowPos.
"""
import ctypes
from ctypes import wintypes

from flask import Blueprint, jsonify, request

TITLE = 'PEAK HOUR Mini'
HWND_TOPMOST, HWND_NOTOPMOST = -1, -2
SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE = 0x1, 0x2, 0x10
SW_RESTORE = 9
_ENUM = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


def _user32():
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    user32.EnumWindows.argtypes = [_ENUM, wintypes.LPARAM]
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    return user32


def find_window():
    """The Mini window's handle, or None."""
    user32, found, text = _user32(), [], ctypes.create_unicode_buffer(256)

    def visit(hwnd, _):
        if user32.IsWindowVisible(hwnd) and user32.GetWindowTextW(hwnd, text, 256) and text.value.startswith(TITLE):
            found.append(hwnd)
            return False
        return True
    user32.EnumWindows(_ENUM(visit), 0)
    return found[0] if found else None


def set_on_top(hwnd, on):
    return bool(_user32().SetWindowPos(hwnd, HWND_TOPMOST if on else HWND_NOTOPMOST, 0, 0, 0, 0,
                                       SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE))


def bring_forward(hwnd):
    user32 = _user32()
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, SW_RESTORE)
    user32.SetForegroundWindow(hwnd)


def create_blueprint(opener, finder=find_window, pinner=set_on_top, forward=bring_forward):
    blueprint = Blueprint('windows_live_assist_mini', __name__)

    @blueprint.post('/api/windows/live-assist-mini/open')
    def open_window():
        hwnd = finder()
        if hwnd:
            forward(hwnd)
            return jsonify(success=True, opened=False)
        opener()
        return jsonify(success=True, opened=True)

    @blueprint.post('/api/windows/live-assist-mini/pin')
    def pin():
        on = bool((request.get_json(silent=True) or {}).get('on'))
        hwnd = finder()
        return jsonify(success=bool(hwnd and pinner(hwnd, on)), on=on)

    return blueprint
