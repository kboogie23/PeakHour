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
_ONE_DIALOG = threading.Lock()


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


def _dialog(choose, **options):
    with _ONE_DIALOG:
        root = tk.Tk()
        try:
            # A tiny, invisible, topmost owner window in the foreground, so the
            # dialog it owns opens in front of AXIOM's window.
            root.overrideredirect(True)
            root.attributes('-alpha', 0.0)
            root.attributes('-topmost', True)
            root.geometry('1x1+%d+%d' % (root.winfo_screenwidth() // 2, root.winfo_screenheight() // 2))
            root.update()
            try:
                bring_to_front(int(root.wm_frame(), 16))
            except (TypeError, ValueError, tk.TclError, OSError):
                pass  # best effort: the dialog still opens, possibly behind AXIOM
            result = choose(parent=root, **options)
            if not result:
                return '', True
            return os.path.normpath(os.path.abspath(result)), False
        finally:
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
