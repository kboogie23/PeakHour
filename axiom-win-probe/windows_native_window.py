"""PEAK HOUR in its own native window (pywebview on the WebView2 engine) instead of an Edge/Chrome app window.

    pythonw windows_native_window.py --url http://127.0.0.1:8080/ --title "PEAK HOUR" --profile "...\\AXIOM DJ\\NativeWindow"

Started by axiom_windows_launcher when windows_window_mode.choose_window says 'native' (opt-in: PEAKHOUR_WINDOW=native).
A separate process because pywebview owns the main thread. It never shows the old Internet Explorer engine (MSHTML).

Exit codes (the launcher opens the Edge window for ANY non-zero code, at any time; only 0 means the user closed the window):
    0  the window was closed normally
    2  bad arguments (including a --profile that is the Edge/Chrome window profile)
    3  the WebView2 renderer is not available, did not start, or could not be made safe
    6  crash, or WebView2's browser process died / its page process kept dying
    other non-zero  crash

Files, all under the folder above --profile (the AXIOM DJ data folder):
    NativeWindow\\        the WebView2 user-data folder (a new folder; the Edge profile "Window" is never touched)
    native-window.json   size, position and maximised state, written when the main window closes
    native-window.log    a short log, cut back when it passes 200 KB (user folders and name scrubbed; no addresses or file names)
    native-control.json  {pid, port, token, loaded}: where the launcher's control socket is (the process listens from the start;
                         commands wait for the page) and, with loaded=true, that the page is up. Removed when the window ends.
"""
import argparse
import ctypes
import json
import os
import sys
import threading
import time
import traceback
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

EXIT_OK, EXIT_BAD_ARGS, EXIT_NO_RENDERER, EXIT_ERROR = 0, 2, 3, 6
APP_ID = 'PeakHour.App'
LOAD_TIMEOUT = 25  # seconds until the first page reports loaded; a blank window is worse than the Edge fallback
LOG_LIMIT = 200 * 1024
DEFAULT_SIZE, MIN_SIZE = (1440, 900), (1024, 640)
FIXED_PROFILE_NAMES = ('window', 'window-chrome')  # the Edge / Chrome app-window profiles: never used here
HERE = Path(__file__).resolve().parent

# Same switches as axiom_windows_launcher.KEEP_AWAKE: a minimised or covered window must keep polling the DJ software.
KEEP_AWAKE = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding',
              '--disable-backgrounding-occluded-windows']
# For the app's own origin only (plus every MIDI kind, see Host.allowed). MultipleAutomaticDownloads: a second export in a row;
# Autoplay: playback that Edge would also let through. Everything else is denied.
ALLOWED_PERMISSIONS = ('Microphone', 'ClipboardRead', 'MultipleAutomaticDownloads', 'Autoplay')
EXTERNAL_SCHEMES = ('http', 'https', 'mailto')
CONTROL_COMMANDS = ('focus', 'live_assist', 'mini', 'manual')  # what the launcher may ask for (see Host.serve_control)
EXTERNAL_BURST = (5, 10.0)  # at most 5 opens in the system browser per 10 seconds, whatever the address
RELOADS_PER_MINUTE = 2  # a web page process that keeps dying is not reloaded forever
EXIT_BROWSER_DIED = 6


def scrub(text):
    """Text for the log without the user's name or folders: the usual profile folders become %NAME%."""
    text = str(text)
    names = []
    for var in ('LOCALAPPDATA', 'APPDATA', 'USERPROFILE'):
        value = os.environ.get(var)
        if value and len(value) > 3:
            names.append((value, '%' + var + '%'))
    for value, name in sorted(names, key=lambda pair: -len(pair[0])):
        text = text.replace(value, name).replace(value.replace('\\', '/'), name)
        text = text.replace(value.lower(), name).replace(value.upper(), name)
    user = os.environ.get('USERNAME')
    if user and len(user) > 2:
        text = text.replace(user, '<user>')
    return text


def describe(exc):
    """The exception's type and its path-scrubbed message (for the log)."""
    return '%s: %s' % (type(exc).__name__, scrub(exc))


class LogSink:
    """stdout/stderr of a window-less process (pythonw): pywebview's own logging goes through here, scrubbed, into the log."""

    def __init__(self, path):
        self.path = path

    def write(self, text):
        try:
            if text.strip():
                with open(self.path, 'a', encoding='utf-8') as f:
                    f.write(scrub(text).rstrip() + '\n')
        except Exception:
            pass
        return len(text)

    def flush(self):
        pass

    def isatty(self):
        return False


# ---------------------------------------------------------------------------------------------- saved window state
def state_path(data_root):
    return Path(data_root) / 'native-window.json'


def load_state(data_root):
    """The saved window rectangle (logical pixels) or None: a missing, unreadable or odd file is ignored."""
    try:
        s = json.loads(state_path(data_root).read_text(encoding='utf-8'))
        if all(type(s.get(k)) is int for k in ('x', 'y', 'width', 'height')) and s['width'] >= 200 and s['height'] >= 150:
            s['maximized'] = bool(s.get('maximized'))
            return s
    except (OSError, ValueError, AttributeError):
        pass
    return None


def save_state(data_root, state):
    """Atomic: write a sibling file, then replace."""
    path = state_path(data_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(state), encoding='utf-8')
    os.replace(temporary, path)


def clamp_rect(x, y, w, h, vx, vy, vw, vh):
    """Pull the rectangle inside the desktop rectangle (vx, vy, vw, vh); too big shrinks to the desktop."""
    w, h = min(w, vw), min(h, vh)
    x = min(max(x, vx), vx + vw - w)
    y = min(max(y, vy), vy + vh - h)
    return x, y, w, h


class _RECT(ctypes.Structure):
    _fields_ = [('l', ctypes.c_long), ('t', ctypes.c_long), ('r', ctypes.c_long), ('b', ctypes.c_long)]


def system_scale():
    try:
        return ctypes.windll.user32.GetDpiForSystem() / 96 or 1.0
    except Exception:
        return 1.0


def virtual_desktop():
    """(x, y, width, height) of all monitors together, in physical pixels (this process is DPI aware)."""
    g = ctypes.windll.user32.GetSystemMetrics
    return g(76), g(77), g(78), g(79)


def on_a_monitor(x, y, w, h):
    """True when the (physical pixel) rectangle touches a monitor: a screen that was unplugged must not hide the window."""
    return bool(ctypes.windll.user32.MonitorFromRect(ctypes.byref(_RECT(x, y, x + w, y + h)), 0))  # 0 = MONITOR_DEFAULTTONULL


def start_geometry(saved, scale):
    """(width, height, x, y, maximized) in logical pixels for the main window: the saved rectangle clamped to the
    visible desktop, or the default size (shrunk to fit a small screen) with the operating system choosing the place."""
    vx, vy, vw, vh = virtual_desktop()
    width, height = DEFAULT_SIZE
    x = y = None
    maximized = False
    if saved:
        width, height, x, y, maximized = saved['width'], saved['height'], saved['x'], saved['y'], saved['maximized']
    px, py, pw, ph = clamp_rect(0 if x is None else round(x * scale), 0 if y is None else round(y * scale),
                                round(width * scale), round(height * scale), vx, vy, vw, vh)
    if x is not None and not on_a_monitor(px, py, pw, ph):
        x = y = None  # fell in a gap between monitors
        maximized = False
    width, height = max(round(pw / scale), 400), max(round(ph / scale), 300)
    if x is not None:
        x, y = round(px / scale), round(py / scale)
    return width, height, x, y, maximized


# --------------------------------------------------------------------------------------------------------- the host
class Host:
    def __init__(self, args):
        self.args = args
        self.data_root = Path(args.profile).parent
        self.origin = '{0.scheme}://{0.netloc}'.format(urlparse(args.url))
        self.port = urlparse(args.url).port
        self.started = time.time()
        self.main = None
        self.forms = []  # windows of this process that are not pywebview's: popups from window.open and Live Assist, Mini, manual
        self.last_external = (None, 0.0)
        self.external_times = []  # when the last opens in the system browser happened
        self.dropped_external = 0
        self.reloads = []  # when a dead web page process was last reloaded
        self.kind_forms = {}  # 'live_assist' | 'mini' | 'manual' -> its form, so a second request brings it forward
        self.scale = 1.0
        self.devtools = os.environ.get('PEAKHOUR_DEVTOOLS') == '1'
        # Test hooks (a browser stub, a download folder) only with PEAKHOUR_TEST=1 and never on the real port 8080; the
        # launcher removes every PEAKHOUR_TEST* variable from the environment of the window it starts.
        self.testing = os.environ.get('PEAKHOUR_TEST') == '1' and self.port != 8080
        self.loaded = threading.Event()  # the main page has loaded
        self.control_token = None
        self.control_port = None
        self.log_path = self.data_root / 'native-window.log'
        self.control_path = self.data_root / 'native-control.json'

    # ---- log (never the user's name or folders: scrub)
    def note(self, text):
        try:
            if self.log_path.exists() and self.log_path.stat().st_size > LOG_LIMIT:
                self.log_path.write_text('(log cut back at 200 KB)\n', encoding='utf-8')
            with open(self.log_path, 'a', encoding='utf-8') as f:
                f.write('%s +%.2fs %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), time.time() - self.started, scrub(text)))
        except Exception:
            pass

    # ---- the control file: how the launcher finds the control socket and learns the page is up (atomic)
    def write_control(self, loaded):
        if not self.control_token:
            return
        try:
            temporary = self.control_path.with_name(self.control_path.name + '.tmp')
            temporary.write_text(json.dumps({'pid': os.getpid(), 'port': self.control_port, 'token': self.control_token,
                                             'loaded': bool(loaded)}), encoding='utf-8')
            os.replace(temporary, self.control_path)
        except OSError as e:
            self.note('could not write the control file: %s' % describe(e))

    def remove_control(self):
        if self.control_token:
            try:
                if json.loads(self.control_path.read_text(encoding='utf-8')).get('token') == self.control_token:
                    self.control_path.unlink()
            except (OSError, ValueError, AttributeError):
                pass

    # ---- decisions
    def same_origin(self, uri):
        uri = str(uri)
        return uri == 'about:blank' or uri == self.origin or uri.startswith(self.origin + '/')

    def allowed(self, uri, kind):
        """Microphone, MIDI (with or without sysex), clipboard reading, automatic downloads and autoplay for this app's own
        origin; nothing else."""
        if not self.same_origin(uri) or str(uri) == 'about:blank':
            return False
        return kind in ALLOWED_PERMISSIONS or 'Midi' in kind

    def open_external(self, uri):
        """Anything that is not PEAK HOUR goes to the user's own browser. (Tests: PEAKHOUR_TEST_BROWSER_LOG records the
        address in a file instead, only with PEAKHOUR_TEST=1 and never on the real port 8080.)"""
        uri = str(uri)
        scheme = urlparse(uri).scheme.lower()
        if scheme not in EXTERNAL_SCHEMES:
            self.note('blocked a %s: address' % scheme)
            return
        if self.last_external[0] == uri and time.time() - self.last_external[1] < 3:
            return  # one click can ask twice (window.open, then location.assign); open it once
        now = time.time()
        self.external_times = [t for t in self.external_times if now - t < EXTERNAL_BURST[1]]
        if len(self.external_times) >= EXTERNAL_BURST[0]:
            self.dropped_external += 1
            self.note('too many browser opens at once: dropped %d so far' % self.dropped_external)  # a count, never the address
            return
        self.external_times.append(now)
        self.last_external = (uri, now)
        record = os.environ.get('PEAKHOUR_TEST_BROWSER_LOG')
        if record and self.testing:
            with open(record, 'a', encoding='utf-8') as f:
                f.write(uri + '\n')
            return
        self.note('opened a %s address in the default browser' % scheme)
        webbrowser.open(uri)

    # ---- runs on the UI thread, for the main window and every popup
    def configure_core(self, core, form, browser=None):
        """Make a WebView2 safe and quiet. The handlers that matter (pywebview's own removed; new windows, navigation, permissions,
        downloads) are attached FIRST and any failure there raises: the caller exits with code 3 (main window: the launcher then
        opens Edge) or closes the popup. The settings that follow are tried one by one; one failing does not stop the rest."""
        from Microsoft.Web.WebView2.Core import CoreWebView2PermissionState as State, CoreWebView2WebResourceContext as Context
        host = self

        if browser is not None:  # pywebview's own handlers (main window only)
            core.NewWindowRequested -= browser.on_new_window_request  # it opens every popup in the default browser
            core.DownloadStarting -= browser.on_download_starting     # it asks with a modal Save dialog

        def on_new_window(sender, a):
            uri = str(a.Uri)
            if not host.same_origin(uri):
                a.Handled = True
                host.note('new window for another origin: external')
                host.open_external(uri)
                return
            try:
                host.open_popup(core, a)
            except Exception as e:
                host.note('real popup failed, using a separate window: %s' % describe(e))
                a.Handled = True  # the opener gets null from window.open in this case
                f = a.WindowFeatures
                host.open_own('popup%d' % len(host.forms), uri, f.Width if f.HasSize else 900, f.Height if f.HasSize else 700)
        core.NewWindowRequested += on_new_window

        def on_navigating(sender, a):
            # A PEAK HOUR window has no address bar or back button: a page that sends it to another website (the update link
            # asks window.open(noopener) and, because that returns null, also location.assign) must not strand the user there.
            uri = str(a.Uri)
            if urlparse(uri).scheme.lower() in ('http', 'https') and not host.same_origin(uri):
                a.Cancel = True
                host.note('navigation to another site diverted to the browser: host %s' % urlparse(uri).hostname)
                host.open_external(uri)
        core.NavigationStarting += on_navigating

        def on_permission(sender, a):
            kind = str(a.PermissionKind)
            ok = host.allowed(str(a.Uri), kind)
            a.State = State.Allow if ok else State.Deny
            a.SavesInProfile = False
            host.note('permission %s from %s: %s' % (kind, host.origin if host.same_origin(a.Uri) else 'other origin', 'allow' if ok else 'deny'))
        core.PermissionRequested += on_permission

        def on_download(sender, a):
            host.note('download started')
            folder = os.environ.get('PEAKHOUR_TEST_DOWNLOAD_DIR')
            if folder and host.testing:  # tests only: save into a temp folder, no download bubble
                a.ResultFilePath = os.path.join(folder, Path(str(a.ResultFilePath)).name)
                a.Handled = True
            # otherwise WebView2's own download UI decides and shows the progress
        core.DownloadStarting += on_download

        def optional(what, action):
            try:
                action()
            except Exception as e:
                host.note('%s failed: %s' % (what, describe(e)))

        if browser is not None:  # pywebview copies every request and response of the page into Python; nothing here uses that
            def detach_copying():
                core.RemoveWebResourceRequestedFilter('*', Context.All)
                core.WebResourceRequested -= browser.on_web_resource_request
                core.WebResourceResponseReceived -= browser.on_web_resource_response
            optional('detaching the request copying', detach_copying)

        s = core.Settings
        for name, value in (('IsZoomControlEnabled', False),  # no page zoom by the host; the page handles Ctrl+wheel (pinch stays on)
                            ('IsStatusBarEnabled', False), ('IsGeneralAutofillEnabled', False), ('IsPasswordAutosaveEnabled', False),
                            ('IsSwipeNavigationEnabled', False), ('AreDevToolsEnabled', self.devtools),
                            # F5, Ctrl+R/P/F/J/U, F12, Alt+Left ... off; typing, copy, cut, paste and select-all in text fields
                            # are not accelerators in this sense and keep working. The keys still reach the page's own JavaScript.
                            ('AreBrowserAcceleratorKeysEnabled', self.devtools),
                            ('AreDefaultContextMenusEnabled', True)):  # needed for Cut/Copy/Paste; trimmed below
            optional('setting ' + name, lambda name=name, value=value: setattr(s, name, value))
        self.note('settings applied: zoom=%s accelerator_keys=%s devtools=%s status_bar=%s pinch=%s' % (
            getattr(s, 'IsZoomControlEnabled', 'n/a'), getattr(s, 'AreBrowserAcceleratorKeysEnabled', 'n/a'),
            getattr(s, 'AreDevToolsEnabled', 'n/a'), getattr(s, 'IsStatusBarEnabled', 'n/a'),
            getattr(s, 'IsPinchZoomEnabled', 'n/a')))  # read back from WebView2, not what we meant to set

        keep = {'cut', 'copy', 'paste', 'selectAll'}

        def on_context_menu(sender, a):
            if host.devtools:
                return
            items = a.MenuItems
            for i in range(items.Count - 1, -1, -1):
                if str(items[i].Name) not in keep:
                    items.RemoveAt(i)
            while items.Count and str(items[0].Kind) == 'Separator':
                items.RemoveAt(0)
            if items.Count == 0:
                a.Handled = True  # nothing worth showing: no menu at all
        def subscribe_menu():
            core.ContextMenuRequested += on_context_menu
        optional('context menu handler', subscribe_menu)

        def title_changed(sender, _):  # pywebview does not follow <title>; the Mini window is found by its title
            form.Text = str(core.DocumentTitle)
        def subscribe_title():
            core.DocumentTitleChanged += title_changed
        optional('title handler', subscribe_title)

        def process_failed(sender, a):
            kind = str(a.ProcessFailedKind)
            host.note('web content process failed: %s' % kind)
            host.on_process_failed(core, kind)
        def subscribe_failed():
            core.ProcessFailed += process_failed
        optional('process-failed handler', subscribe_failed)

        def close_requested(sender, _):  # window.close() from the page
            if form is not host.main_form():
                form.Close()
        def subscribe_close():
            core.WindowCloseRequested += close_requested
        optional('close handler', subscribe_close)

    def on_process_failed(self, core, kind):
        """The browser process died: nothing here can go on, exit so the launcher opens Edge. A page process died: reload once;
        at most RELOADS_PER_MINUTE a minute, then give up the same way."""
        if kind == 'BrowserProcessExited':
            self.finish(EXIT_BROWSER_DIED)
        elif kind == 'RenderProcessExited':
            now = time.time()
            self.reloads = [t for t in self.reloads if now - t < 60]
            if len(self.reloads) >= RELOADS_PER_MINUTE:
                self.note('the page process keeps dying: giving up')
                self.finish(EXIT_BROWSER_DIED)
            self.reloads.append(now)
            core.Reload()

    def main_form(self):
        return getattr(self.main, 'native', None)

    def new_form(self, width, height, outer, x=None, y=None):
        """A bare WinForms window holding a WebView2 control (UI thread). width/height are logical pixels: the page area for a
        popup (what window.open asks for), the whole window for an app window (what Edge's --window-size means)."""
        import clr  # noqa: F401
        import System.Windows.Forms as WF
        from System.Drawing import Size, Icon, Point
        from Microsoft.Web.WebView2.WinForms import WebView2
        scale = self.scale
        vx, vy, vw, vh = virtual_desktop()
        width, height = min(max(int(width), 200), int(vw / scale)), min(max(int(height), 150), int(vh / scale))
        form = WF.Form()
        form.Text = 'PEAK HOUR'
        size = Size(round(width * scale), round(height * scale))
        if outer:
            form.Size = size
        else:
            form.ClientSize = size
        form.MinimumSize = Size(round(300 * scale), round(200 * scale))
        if x is not None and y is not None:
            px, py, _, _ = clamp_rect(round(x * scale), round(y * scale), size.Width, size.Height, vx, vy, vw, vh)
            form.StartPosition = WF.FormStartPosition.Manual
            form.Location = Point(px, py)
        if self.args.icon:
            try:
                form.Icon = Icon(self.args.icon)
            except Exception:
                pass
        control = WebView2()
        control.Dock = WF.DockStyle.Fill
        form.Controls.Add(control)

        def closed(sender, e):
            if form in self.forms:
                self.forms.remove(form)
            control.Dispose()
        form.FormClosed += closed
        self.forms.append(form)
        return form, control

    def open_popup(self, core, a):
        """A same-origin window.open / target=_blank as a real WebView2 popup, so the opener gets a usable window object
        (Live Assist checks it, then focuses it). Sized as the page asked (900x700 when it did not say). UI thread."""
        f = a.WindowFeatures
        form, control = self.new_form(f.Width if f.HasSize else 900, f.Height if f.HasSize else 700, False,
                                      f.Left if f.HasPosition else None, f.Top if f.HasPosition else None)
        deferral = a.GetDeferral()
        finished = []
        host = self

        def complete():  # the deferral is completed exactly once, whatever happens
            if not finished:
                finished.append(True)
                deferral.Complete()

        def ready(sender, e):
            try:
                if e.IsSuccess:
                    try:
                        host.configure_core(control.CoreWebView2, form)  # handlers first; a failure closes the popup
                    except Exception as err:
                        host.note('popup could not be made safe, closed: %s' % describe(err))
                        a.Handled = True
                        form.Close()
                        return
                    a.NewWindow = control.CoreWebView2
                    a.Handled = True
                else:
                    host.note('popup WebView2 failed: %s' % scrub(e.InitializationException))
                    a.Handled = True
                    form.Close()
            finally:
                complete()
        control.CoreWebView2InitializationCompleted += ready
        try:
            form.Show()
            control.EnsureCoreWebView2Async(core.Environment)
        except Exception:
            complete()
            form.Close()
            raise
        self.note('popup window opened (same origin)')

    def open_own(self, kind, url, width, height):
        """An app window of this process (Live Assist, Mini, the manual) at `url`, same user-data folder. If this kind is
        already open it is brought forward instead. UI thread; the form is shown, the page loads after."""
        known = self.kind_forms.get(kind)
        if known is not None and known in self.forms and not known.IsDisposed:
            self.bring_forward(known)
            return
        form, control = self.new_form(width, height, True)
        self.kind_forms[kind] = form
        host = self

        def ready(sender, e):
            if e.IsSuccess:
                try:
                    host.configure_core(control.CoreWebView2, form)  # handlers first; a failure closes the window
                except Exception as err:
                    host.note('%s window could not be made safe, closed: %s' % (kind, describe(err)))
                    form.Close()
                    return
                control.CoreWebView2.Navigate(url)
            else:
                host.note('%s window: WebView2 failed: %s' % (kind, scrub(e.InitializationException)))
                form.Close()
        control.CoreWebView2InitializationCompleted += ready
        form.Show()
        control.EnsureCoreWebView2Async(self.main_form().browser.webview.CoreWebView2.Environment)
        self.note('%s window opened' % kind)

    def bring_forward(self, form):
        """Restore and raise a window of this process (Windows may refuse to give it the keyboard focus from the background;
        it then still comes to the front)."""
        import clr  # noqa: F401
        import System.Windows.Forms as WF
        if form.WindowState == WF.FormWindowState.Minimized:
            form.WindowState = WF.FormWindowState.Normal
        form.Show()
        form.BringToFront()
        try:
            user32 = ctypes.windll.user32
            handle = form.Handle.ToInt64()
            user32.SetWindowPos(ctypes.c_void_p(handle), ctypes.c_void_p(-1), 0, 0, 0, 0, 0x13)  # topmost, no move/size/activate
            user32.SetWindowPos(ctypes.c_void_p(handle), ctypes.c_void_p(-2), 0, 0, 0, 0, 0x13)  # and straight back: raised only
            user32.SetForegroundWindow(ctypes.c_void_p(handle))
        except Exception:
            pass
        form.Activate()

    # ---- the control channel: the launcher asks for Live Assist, Mini, the manual or the main window
    def command(self, name):
        """Do one command from CONTROL_COMMANDS (runs on the UI thread). Every address is built here from --url."""
        origin = self.origin
        if name == 'focus':
            self.bring_forward(self.main_form())
        elif name == 'live_assist':  # what open_live_assist starts in Edge: --window-size=438,690
            self.open_own('live_assist', '%s/live_assist_window?popup=1&open=%d' % (origin, time.time() * 1000), 438, 690)
        elif name == 'mini':  # --window-size=380,560; the page pins itself on top (windows_live_assist_mini.py finds it by title)
            self.open_own('mini', origin + '/static/windows-live-assist-mini.html', 380, 560)
        elif name == 'manual':
            self.open_own('manual', origin + '/static/manual/index.html', 1000, 800)

    def serve_control(self, token):
        """Loopback socket for the launcher, listening from the start of run() (before the window exists). A web page cannot use
        it: the first line must be JSON with the secret token (an HTTP request starts with a method), only fixed commands exist,
        and the token travels in the environment, not on a page. The port is the system's choice (port 0, exclusive); it and the
        token go into native-control.json (atomically), rewritten with loaded=true when the page is up. Commands that arrive
        before the page has loaded wait for it. Returns False when there is no channel."""
        import hmac
        import socket
        try:
            if len(token) < 16:
                raise ValueError('short token')
            server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            server.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)  # nobody else can bind this port
            server.bind(('127.0.0.1', 0))
            server.listen(4)
        except Exception as e:
            self.note('no control channel: %s' % describe(e))
            return False
        self.control_token, self.control_port = token, server.getsockname()[1]
        self.write_control(False)
        host = self

        def handle(conn):
            with conn:
                conn.settimeout(2)
                data = b''
                while not data.endswith(b'\n') and len(data) < 300:
                    chunk = conn.recv(100)
                    if not chunk:
                        return
                    data += chunk
                try:
                    message = json.loads(data.decode('ascii'))
                    command, given = message['command'], message['token']
                    if not (isinstance(given, str) and hmac.compare_digest(given.encode('ascii'), token.encode('ascii'))):
                        return
                    if command not in CONTROL_COMMANDS:
                        conn.sendall(b'{"ok": false}\n')
                        return
                except Exception:
                    return  # not ours (or wrong token): no answer
                done = threading.Event()
                result = {'ok': True}

                def work():
                    try:
                        self.loaded.wait(LOAD_TIMEOUT)  # queued until the main page is up
                        import clr  # noqa: F401
                        from System import Action
                        host.main_form().Invoke(Action(lambda: host.command(command)))
                    except Exception as e:
                        result['ok'] = False
                        host.note('command %s failed: %s' % (command, describe(e)))
                    finally:
                        done.set()
                threading.Thread(target=work, daemon=True).start()
                done.wait(1.5)  # the launcher waits 2 s; a command still waiting for the page counts as accepted
                conn.sendall(b'{"ok": true}\n' if result['ok'] else b'{"ok": false}\n')

        def loop():
            while True:
                try:
                    conn, _ = server.accept()
                except OSError:
                    return
                threading.Thread(target=handle, args=(conn,), daemon=True).start()
        threading.Thread(target=loop, name='control', daemon=True).start()
        self.note('control channel ready')
        return True

    # ---- pywebview windows
    def hook_window(self, window, remember=False):
        import clr  # noqa: F401  pythonnet must be loaded before any 'from System import ...'
        from System import Action

        def before_show():
            form = window.native
            form.Invoke(Action(lambda: self.setup_form(form, window)))
        window.events.before_show += before_show

        if remember:
            def closing():
                try:
                    import System.Windows.Forms as WF
                    form = window.native
                    scale = form._scale
                    b = form.Bounds if form.WindowState == WF.FormWindowState.Normal else form.RestoreBounds
                    save_state(self.data_root, {'x': int(b.X / scale), 'y': int(b.Y / scale), 'width': int(b.Width / scale),
                                                'height': int(b.Height / scale),
                                                'maximized': form.WindowState == WF.FormWindowState.Maximized})
                except Exception as e:
                    self.note('could not save the window state: %r' % (e,))
            window.events.closing += closing

    def setup_form(self, form, window):
        control = form.browser.webview
        browser = form.browser
        if window is self.main:
            try:
                self.scale = form._scale
            except Exception:
                pass

        def configure(core):
            try:
                self.configure_core(core, form, browser)
            except Exception as e:  # fail closed: a window whose handlers could not be set is not shown
                self.note('could not make the window safe: %s' % describe(e))
                if window is self.main:
                    self.finish(EXIT_NO_RENDERER)  # the launcher opens Edge
                form.Close()

        if control.CoreWebView2 is not None:
            configure(control.CoreWebView2)
            return

        def ready(sender, a):  # subscribed after pywebview's own handler, so this runs after it
            if a.IsSuccess:
                configure(sender.CoreWebView2)
            else:
                # pywebview only logs this and leaves a blank window: fail fast so the launcher can fall back to Edge
                self.note('WebView2 failed to start: %s' % scrub(a.InitializationException))
                if window is self.main:
                    self.finish(EXIT_NO_RENDERER)
        control.CoreWebView2InitializationCompleted += ready

    def finish(self, code):
        self.note('exit %d' % code)
        self.remove_control()
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
        os._exit(code)

    def close_others(self):
        """The main window is gone: close the popups too, so the process ends. (Must return None: pywebview collects
        handler return values in a set.)"""
        import webview
        for w in list(webview.windows):
            if w is not self.main:
                try:
                    w.destroy()
                except Exception:
                    pass

    # ---- run
    def run(self):
        a = self.args
        self.data_root.mkdir(parents=True, exist_ok=True)
        if self.log_path.exists() and self.log_path.stat().st_size > LOG_LIMIT:
            self.log_path.write_text('(log cut back at 200 KB)\n', encoding='utf-8')
        self.note('start; window mode check')
        from windows_window_mode import failed_probes, LABELS
        missing = failed_probes()
        if missing:
            self.note('cannot run: ' + '; '.join(LABELS[n] for n in missing))
            return EXIT_NO_RENDERER

        os.environ.pop('WEBVIEW2_USER_DATA_FOLDER', None)  # never inherit one; --profile decides
        control = os.environ.pop('PEAKHOUR_NATIVE_CONTROL', '')  # the secret token from the launcher; not passed on to WebView2
        if control:
            self.serve_control(control)  # listening before anything else starts; commands wait for the page
        extra = ' '.join(KEEP_AWAKE)
        os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = (os.environ.get('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', '') + ' ' + extra).strip()

        try:
            ctypes.windll.user32.SetProcessDPIAware()  # pywebview does the same; needed first so pixel maths here agree
        except Exception:
            pass
        import webview
        webview.settings['ALLOW_DOWNLOADS'] = True
        webview.settings['OPEN_EXTERNAL_LINKS_IN_BROWSER'] = True
        webview.settings['ALLOW_FILE_URLS'] = False  # the app only ever loads http://127.0.0.1

        scale = system_scale()
        saved = load_state(self.data_root) if a.x is None else None
        width, height, x, y, maximized = start_geometry(saved, scale)
        if a.width:
            width, height = a.width, a.height or height
        if a.x is not None:
            x, y, maximized = a.x, a.y, False
        elif saved is None and not a.minimized:
            maximized = True  # first run: maximised, like the Edge window (the launcher starts Edge with --start-maximized)
        try:
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)  # its own taskbar identity, not python's
        except Exception:
            pass

        main = webview.create_window(a.title, a.url, width=width, height=height, x=x, y=y, min_size=MIN_SIZE, maximized=maximized,
                                     text_select=True,   # pywebview's default injects user-select:none (breaks inputs, copy)
                                     zoomable=True,      # False makes pywebview swallow multi-touch (pinch) the DAW timeline needs
                                     draggable=True,     # False makes pywebview cancel dragstart on every <img>/<a>
                                     easy_drag=False, confirm_close=False, minimized=a.minimized, focus=not a.nofocus)
        self.main = main
        self.hook_window(main, remember=True)
        def page_loaded():
            self.note('page loaded')
            if not self.loaded.is_set():
                self.loaded.set()
                self.write_control(True)  # the launcher's "window is up" signal
        main.events.loaded += page_loaded
        main.events.closed += self.close_others

        def watchdog():
            if not main.events.loaded.wait(LOAD_TIMEOUT):
                self.note('the page did not load in %d s' % LOAD_TIMEOUT)
                self.finish(EXIT_NO_RENDERER)
        threading.Thread(target=watchdog, daemon=True).start()

        def after_start():
            if webview.renderer != 'edgechromium':
                self.note('wrong engine %r' % (webview.renderer,))  # pywebview silently drops to MSHTML; never run in that
                self.finish(EXIT_NO_RENDERER)
            self.note('engine edgechromium')

        webview.start(after_start, gui='edgechromium', private_mode=False,  # keep localStorage / IndexedDB between runs
                      storage_path=str(Path(a.profile)), icon=a.icon, debug=False)
        self.note('window closed')
        self.remove_control()
        return EXIT_OK


def default_icon():
    icon = HERE / 'static' / 'brand' / 'favicon.ico'
    return str(icon) if icon.is_file() else None


def parse(argv):
    p = argparse.ArgumentParser()
    p.add_argument('--url', required=True)
    p.add_argument('--title', default='PEAK HOUR')
    p.add_argument('--profile', required=True, help='the WebView2 user-data folder (AXIOM DJ\\NativeWindow)')
    p.add_argument('--icon', default=default_icon())
    # harness only:
    p.add_argument('--x', type=int)
    p.add_argument('--y', type=int)
    p.add_argument('--width', type=int)
    p.add_argument('--height', type=int)
    p.add_argument('--minimized', action='store_true')
    p.add_argument('--nofocus', action='store_true')
    return p.parse_args(argv)


def main(argv=None):
    try:
        args = parse(argv)
    except SystemExit:
        return EXIT_BAD_ARGS
    if Path(args.profile).name.lower() in FIXED_PROFILE_NAMES:
        return EXIT_BAD_ARGS
    if sys.stdout is None or sys.stderr is None:  # pythonw: send anything pywebview prints to the log instead of nowhere
        Path(args.profile).parent.mkdir(parents=True, exist_ok=True)
        sink = LogSink(Path(args.profile).parent / 'native-window.log')  # scrubbed, so pywebview's own logging is safe too
        sys.stdout = sys.stdout or sink
        sys.stderr = sys.stderr or sink
    host = Host(args)
    try:
        return host.run()
    except Exception:
        host.note('crashed:\n' + traceback.format_exc())  # note() scrubs the user's folders and name
        host.remove_control()
        return EXIT_ERROR


if __name__ == '__main__':
    code = main()
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    except Exception:
        pass
    os._exit(code)  # do not wait for the .NET runtime or helper threads
