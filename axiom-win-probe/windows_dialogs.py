"""Native Windows folder and file selection for AXIOM.

AXIOM's server opens these dialogs while the user is working in AXIOM's Edge
window, which owns the foreground. Windows does not let a background process
bring its own window to the front, so a plain dialog opens behind AXIOM and the
request appears to hang. The dialog's owner window is therefore brought to the
front by briefly sharing input with the foreground window (AttachThreadInput),
the documented way to hand over focus between cooperating windows.
"""
import ctypes
import os
import threading
import tkinter as tk
from ctypes import wintypes
from tkinter import filedialog

_user32 = ctypes.WinDLL('user32', use_last_error=True)
_kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
_user32.GetForegroundWindow.restype = wintypes.HWND
_user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
_user32.GetWindowThreadProcessId.restype = wintypes.DWORD
_user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
_user32.SetForegroundWindow.argtypes = [wintypes.HWND]
_user32.BringWindowToTop.argtypes = [wintypes.HWND]
_user32.SetFocus.argtypes = [wintypes.HWND]
_kernel32.GetCurrentThreadId.restype = wintypes.DWORD
_ENUM_WINDOWS_PROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
_user32.EnumWindows.argtypes = [_ENUM_WINDOWS_PROC, wintypes.LPARAM]
_user32.EnumWindows.restype = wintypes.BOOL
_user32.IsWindowVisible.argtypes = [wintypes.HWND]
_user32.IsWindowVisible.restype = wintypes.BOOL
_user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
_user32.GetClassNameW.restype = ctypes.c_int
_user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
_user32.SetWindowPos.restype = wintypes.BOOL
_user32.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
_user32.GetWindow.restype = wintypes.HWND
_GW_OWNER = 4


class _FLASHWINFO(ctypes.Structure):
    _fields_ = [('cbSize', wintypes.UINT), ('hwnd', wintypes.HWND), ('dwFlags', wintypes.DWORD),
                ('uCount', wintypes.UINT), ('dwTimeout', wintypes.DWORD)]


_user32.FlashWindowEx.argtypes = [ctypes.POINTER(_FLASHWINFO)]
_user32.FlashWindowEx.restype = wintypes.BOOL
_ONE_DIALOG = threading.Lock()
_DIALOG_CLASS = '#32770'  # the class of the standard Windows dialogs, which Tk's folder and file choosers are
_HWND_TOPMOST = -1
_SWP_NOSIZE, _SWP_NOMOVE, _SWP_SHOWWINDOW = 0x0001, 0x0002, 0x0040
_FLASHW_ALL, _FLASHW_TIMERNOFG = 0x00000003, 0x0000000C
_RAISE_SECONDS, _RAISE_STEP = 5.0, 0.1


def bring_to_front(hwnd):
    """Make hwnd the foreground window; returns True when it is."""
    foreground = _user32.GetForegroundWindow()
    mine = _kernel32.GetCurrentThreadId()
    theirs = _user32.GetWindowThreadProcessId(foreground, None) if foreground else 0
    attached = bool(theirs and theirs != mine and _user32.AttachThreadInput(mine, theirs, True))
    try:
        _user32.BringWindowToTop(hwnd)
        _user32.SetForegroundWindow(hwnd)
        _user32.SetFocus(hwnd)
    finally:
        if attached:
            _user32.AttachThreadInput(mine, theirs, False)
    return _user32.GetForegroundWindow() == hwnd


def find_dialog_window(owner=None):
    """The first visible top-level dialog window (class #32770) of this process, or None. With an owner (the
    window handle of the invisible window the dialog was opened for), only a dialog owned by it counts, so an
    unrelated dialog of this process is left alone. Without one, any such dialog counts."""
    me = os.getpid()
    found = []

    def visit(hwnd, _lparam):
        pid = wintypes.DWORD(0)
        _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value == me and _user32.IsWindowVisible(hwnd):
            name = ctypes.create_unicode_buffer(64)
            _user32.GetClassNameW(hwnd, name, 64)
            if name.value == _DIALOG_CLASS and (not owner or _user32.GetWindow(hwnd, _GW_OWNER) == owner):
                found.append(hwnd)
                return False
        return True

    _user32.EnumWindows(_ENUM_WINDOWS_PROC(visit), 0)
    return found[0] if found else None


def _raise_dialog(stop_event, owner=None):
    """Watches for the folder or file dialog and puts it on top of everything, so it cannot open behind AXIOM's
    window. If Windows still keeps the foreground away from it, its taskbar button flashes. owner: the handle of the
    invisible window the dialog belongs to; without it any dialog of this process is taken."""
    try:
        waited = 0.0
        while waited < _RAISE_SECONDS and not stop_event.is_set():
            try:
                hwnd = find_dialog_window(owner)
            except TypeError:  # a stand-in that takes no owner
                hwnd = find_dialog_window()
            if hwnd:
                _user32.SetWindowPos(hwnd, _HWND_TOPMOST, 0, 0, 0, 0, _SWP_NOSIZE | _SWP_NOMOVE | _SWP_SHOWWINDOW)
                bring_to_front(hwnd)
                if _user32.GetForegroundWindow() != hwnd:
                    info = _FLASHWINFO(ctypes.sizeof(_FLASHWINFO), hwnd, _FLASHW_ALL | _FLASHW_TIMERNOFG, 0, 0)
                    _user32.FlashWindowEx(ctypes.byref(info))
                return
            stop_event.wait(_RAISE_STEP)
            waited += _RAISE_STEP
    except Exception:
        pass  # best effort: the dialog is still usable


def _dialog(choose, **options):
    with _ONE_DIALOG:
        root = tk.Tk()
        stop_event = threading.Event()
        watcher = None
        try:
            # A tiny, invisible, topmost owner window in the foreground, so the
            # dialog it owns opens in front of AXIOM's window.
            root.overrideredirect(True)
            root.attributes('-alpha', 0.0)
            root.attributes('-topmost', True)
            root.geometry('1x1+%d+%d' % (root.winfo_screenwidth() // 2, root.winfo_screenheight() // 2))
            root.update()
            owner = None  # the window the dialog belongs to; unknown means any dialog of this process is watched for
            try:
                owner = int(root.wm_frame(), 16)
                bring_to_front(owner)
            except (TypeError, ValueError, tk.TclError, OSError):
                pass  # best effort: the dialog still opens, possibly behind AXIOM
            watcher = threading.Thread(target=_raise_dialog, args=(stop_event, owner), name='peak-hour-raise-dialog', daemon=True)
            watcher.start()
            result = choose(parent=root, **options)
            if not result:
                return '', True
            return os.path.normpath(os.path.abspath(result)), False
        finally:
            stop_event.set()
            if watcher is not None:
                watcher.join(1.0)
            try:
                root.destroy()
            except tk.TclError:
                pass  # already closed

def choose_folder_dialog(prompt='Choose your music folder'):
    return _dialog(filedialog.askdirectory, title=prompt, mustexist=True)

def choose_serato_database_dialog():
    return _dialog(filedialog.askopenfilename, title='Select Serato database V2',
                   filetypes=[('Serato database', 'database V2'), ('All files', '*')])

def choose_virtualdj_xml(kind):
    if kind not in ('database','list'):
        raise ValueError('Choose a VirtualDJ database or list')
    label = 'Select VirtualDJ database.xml' if kind == 'database' else 'Select a VirtualDJ list'
    filetypes = ([('XML files', '*.xml'), ('All files', '*')] if kind == 'database' else
                 [('VirtualDJ lists', '*.vdjfolder *.xml'), ('All files', '*')])
    return _dialog(filedialog.askopenfilename, title=label, filetypes=filetypes)
