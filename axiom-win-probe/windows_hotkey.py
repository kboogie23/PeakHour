"""Ctrl+F in the DJ software brings up Live Assist (Windows version of AXIOM's Command-F).

On the Mac, AXIOM's app used macOS Accessibility to notice Command-F inside Serato or djay and
restore its Live Assist panel, so suggestions are on screen while the DJ searches. Here a small
thread reads the keyboard state (GetAsyncKeyState) about 40 times a second. When Ctrl+F goes down
while Serato, VirtualDJ, djay, rekordbox or Traktor is the front window, Live Assist is shown
above it without taking the focus, so the search keeps typing into the DJ software. If Live
Assist is not open, it is opened. Nothing is hooked, blocked or recorded: only Ctrl and F are read,
and only their up/down state. The choice (on by default) is kept in the data folder.
"""
import ctypes
import json
import ntpath
import threading
import time
from ctypes import wintypes
from pathlib import Path

from flask import Blueprint, jsonify, request

DJ_PROGRAMS = {'serato dj pro.exe', 'serato dj lite.exe', 'virtualdj.exe', 'virtualdj8.exe', 'djayapp.exe',
               'djay pro.exe', 'djay.exe', 'rekordbox.exe', 'traktor.exe'}
LIVE_ASSIST_TITLES = ('PEAK HOUR Live Assist', 'AXIOM Live Assist')
VK_CONTROL, VK_F = 0x11, 0x46
POLL_SECONDS = 0.025
user32 = ctypes.WinDLL('user32', use_last_error=True)
kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
user32.GetAsyncKeyState.restype = ctypes.c_short
EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
HWND_TOPMOST, HWND_NOTOPMOST = wintypes.HWND(-1), wintypes.HWND(-2)
SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE, SWP_SHOWWINDOW = 0x1, 0x2, 0x10, 0x40
SW_SHOWNOACTIVATE = 4


def key_down(code):
    return bool(user32.GetAsyncKeyState(code) & 0x8000)


def foreground_program():
    """Executable name of the front window's process ('' if unknown)."""
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return ''
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    process = kernel32.OpenProcess(0x1000, False, pid.value)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not process:
        return ''
    try:
        size = wintypes.DWORD(1024)
        buffer = ctypes.create_unicode_buffer(size.value)
        if not kernel32.QueryFullProcessImageNameW(process, 0, buffer, ctypes.byref(size)):
            return ''
        return ntpath.basename(buffer.value).lower()
    finally:
        kernel32.CloseHandle(process)


def find_live_assist():
    """Handle of an open Live Assist window, or None."""
    found = []

    def visit(hwnd, _):
        length = user32.GetWindowTextLengthW(hwnd)
        if length:
            title = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, title, length + 1)
            if title.value.startswith(LIVE_ASSIST_TITLES):
                found.append(hwnd)
                return False
        return True
    user32.EnumWindows(EnumWindowsProc(visit), 0)
    return found[0] if found else None


def raise_without_focus(hwnd):
    """Show the window above the others but leave the keyboard focus where it is."""
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, SW_SHOWNOACTIVATE)
    flags = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_SHOWWINDOW
    user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, flags)
    user32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, flags)


class LiveAssistHotkey:
    def __init__(self, settings_path, opener=None, *, key=key_down, front=foreground_program,
                 find=find_live_assist, show=raise_without_focus, poll=POLL_SECONDS):
        self.settings_path = Path(settings_path)
        self.opener = opener
        self._key, self._front, self._find, self._show, self._poll = key, front, find, show, poll
        self._stop = threading.Event()
        self._thread = None
        self._lock = threading.Lock()
        self.status = {'enabled': self._load(), 'active': False, 'last_trigger': None, 'last_program': '',
                       'last_result': ''}

    def _load(self):
        try:
            return json.loads(self.settings_path.read_text(encoding='utf-8')).get('enabled', True) is not False
        except (OSError, ValueError, AttributeError):
            return True

    def set_enabled(self, enabled):
        with self._lock:
            self.status['enabled'] = bool(enabled)
            self.settings_path.parent.mkdir(parents=True, exist_ok=True)
            stage = self.settings_path.with_name(self.settings_path.name + '.tmp')
            stage.write_text(json.dumps({'enabled': bool(enabled)}), encoding='utf-8')
            stage.replace(self.settings_path)
        return self.snapshot()

    def snapshot(self):
        with self._lock:
            return dict(self.status)

    def trigger(self, program=''):
        """Bring Live Assist up beside the DJ software (or open it)."""
        hwnd = self._find()
        if hwnd:
            self._show(hwnd)
            result = 'shown'
        elif self.opener:
            self.opener()
            result = 'opened'
        else:
            result = 'not_open'
        with self._lock:
            self.status.update(last_trigger=time.time(), last_program=program, last_result=result)
        return result

    def step(self, was_down):
        """One poll: returns whether F (with Ctrl) is down now; triggers on the moment it goes down."""
        down = self._key(VK_CONTROL) and self._key(VK_F)
        if down and not was_down and self.status['enabled']:
            program = self._front()
            if program in DJ_PROGRAMS:
                threading.Thread(target=self.trigger, args=(program,), name='axiom-live-assist-raise', daemon=True).start()
        return down

    def _run(self):
        down = False
        with self._lock:
            self.status['active'] = True
        try:
            while not self._stop.wait(self._poll):
                try:
                    down = self.step(down)
                except OSError:
                    down = False
        finally:
            with self._lock:
                self.status['active'] = False

    def start(self):
        if self._thread is None or not self._thread.is_alive():
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, name='axiom-live-assist-hotkey', daemon=True)
            self._thread.start()
        return self

    def stop(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)


def create_hotkey_blueprint(watcher):
    bp = Blueprint('windows_hotkey', __name__)

    @bp.get('/api/windows/live-assist-hotkey')
    def status():
        return jsonify(success=True, **watcher.snapshot())

    @bp.post('/api/windows/live-assist-hotkey')
    def update():
        if request.remote_addr not in ('127.0.0.1', '::1'):
            return jsonify(success=False, error='This setting can only be changed on this PC.'), 403
        data = request.get_json(silent=True) or {}
        if not isinstance(data.get('enabled'), bool):
            return jsonify(success=False, error='Choose on or off.'), 400
        return jsonify(success=True, **watcher.set_enabled(data['enabled']))
    return bp
