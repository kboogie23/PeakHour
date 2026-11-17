"""PEAK HOUR Mini: a small always-on-top window with what Live Assist shows (static/windows-live-assist-mini.html).

The page only reads /api/performance/live_assist/state, which the main window publishes whether or not Live Assist
is open. An Edge app window cannot pin itself, so these routes find the window by its title and pin it with
SetWindowPos.
"""
import ctypes
import threading
import time
from ctypes import wintypes

from flask import Blueprint, jsonify, request

TITLE = 'PEAK HOUR Mini'
HWND_TOPMOST, HWND_NOTOPMOST = -1, -2
SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE = 0x1, 0x2, 0x10
SW_RESTORE = 9
OPEN_GRACE_SECONDS = 20  # how long a started window may take to appear before it counts as closed
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


DWMWA_WINDOW_CORNER_PREFERENCE, DWMWA_BORDER_COLOR = 33, 34
DWMWCP_DONOTROUND, DWMWA_COLOR_NONE = 1, 0xFFFFFFFE


def remove_border(hwnd):
    """No DWM outline and square corners on the Mini window (Windows 11; older Windows ignores it). The frame and title
    bar of an Edge --app window are Edge's own and stay, so the window can still be moved and closed. True when the
    outline was removed."""
    try:
        dwm = ctypes.WinDLL('dwmapi')
        dwm.DwmSetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
        none, square = wintypes.DWORD(DWMWA_COLOR_NONE), wintypes.DWORD(DWMWCP_DONOTROUND)
        dwm.DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ctypes.byref(square), 4)
        return dwm.DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ctypes.byref(none), 4) == 0
    except (OSError, AttributeError):
        return False


def create_blueprint(opener, finder=find_window, pinner=set_on_top, forward=bring_forward, styler=remove_border,
                     clock=time.monotonic):
    blueprint = Blueprint('windows_live_assist_mini', __name__)
    lock = threading.Lock()  # the server is threaded: two requests must not both open a window
    # seen: the window was found open; suppressed: it was then closed by the DJ; opened_at: when we last started it
    state = {'seen': False, 'suppressed': False, 'opened_at': 0.0}

    @blueprint.post('/api/windows/live-assist-mini/open')
    def open_window():
        auto = bool((request.get_json(silent=True) or {}).get('auto'))
        with lock:
            hwnd = finder()
            if auto:  # a song was noticed: open once, never raise or steal focus from the DJ software, and stay closed once closed
                quiet = jsonify(success=True, opened=False, auto=True)
                if hwnd:
                    state['seen'] = True
                    try:  # the page's pin calls may have failed, so the border is removed here too
                        styler(hwnd)
                    except Exception:
                        pass
                    return quiet
                if state['suppressed']:
                    return quiet
                # the window process is started before its window exists: wait for it instead of opening a second one
                if state['opened_at'] and clock() - state['opened_at'] < OPEN_GRACE_SECONDS:
                    return quiet
                if state['seen'] or state['opened_at']:  # it was up (or was started) and is gone: the DJ closed it
                    state['suppressed'] = True
                    return quiet
                state['opened_at'] = clock()
                opener()
                return jsonify(success=True, opened=True, auto=True)
            state['suppressed'] = state['seen'] = False  # the Mini button: a deliberate open starts over
            if hwnd:
                state['seen'] = True
                forward(hwnd)
                return jsonify(success=True, opened=False)
            state['opened_at'] = clock()
            opener()
            return jsonify(success=True, opened=True)

    @blueprint.post('/api/windows/live-assist-mini/pin')
    def pin():
        on = bool((request.get_json(silent=True) or {}).get('on'))
        hwnd = finder()
        if hwnd:
            with lock:
                state['seen'] = True
            try:
                styler(hwnd)
            except Exception:
                pass
        return jsonify(success=bool(hwnd and pinner(hwnd, on)), on=on)

    return blueprint
