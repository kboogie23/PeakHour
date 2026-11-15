r"""PEAK HOUR Setup's "Stem engine" step: the same install job the app runs (windows_stem_installer), without the app.

Setup (installer/install.ps1) runs this with the program's own Python once PEAK HOUR is in place:

    runtime\python.exe app\windows_stem_setup.py            ask, then install in a small window
    runtime\python.exe app\windows_stem_setup.py --auto     install without asking, close when done
    runtime\python.exe app\windows_stem_setup.py --skip     do nothing (also: environment variable PEAK_HOUR_SETUP_SILENT=1)
    runtime\python.exe app\windows_stem_setup.py --check    print the status as JSON; exit 0 when the engine is ready, else 1

Exit code (Setup ignores it: PEAK HOUR is installed whatever happens here, and works without stems):
    0  installed, already installed ("skipped"), skipped by the user or by --skip, or another window is installing it
    1  could not be installed (no internet, no disk space, an error) and the user skipped
    2  cancelled by the user (what was downloaded is kept; a later install continues)

Nothing is changed when the engine is already installed and complete (windows_stem_installer's own plan(): runtime and model
present): no window, no network, no files written. The engine lives in the data folder (AXIOM_RUNTIME_DIR, else
%LOCALAPPDATA%\AXIOM DJ), never in the program folder, so reinstalling or upgrading PEAK HOUR keeps it.

The window shows the running job; the app (Studio > Create Stems) sees it too: this process publishes the job's status in
<data>\stem-setup-status.json, and the cross-process lock keeps the app from starting a second install.

SetupController is the model (no window; tested headless), Window the tkinter view. tkinter ships in PEAK HOUR's own Python.
"""
import argparse
import json
import os
import sys
import threading
import time
import traceback
from pathlib import Path

if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import windows_stem_installer as W  # noqa: E402

SILENT_VARIABLE = 'PEAK_HOUR_SETUP_SILENT'
TITLE = 'PEAK HOUR — Stem engine'
ALREADY = 'Stem engine already installed — skipped'
ELSEWHERE = 'Another PEAK HOUR window is already installing the stem engine — skipped'
LATER = 'You can install it later: open Studio, click Create Stems and choose Install.'
INTRO = ('Stems split a song into vocals, melody, bass and drums in Studio. PEAK HOUR needs a one-time stem engine for that. '
         'It is too large to be inside Setup, so it is downloaded now and kept on this PC. '
         'PEAK HOUR itself is installed and works without it.')
OFFLINE_TEXT = ('PEAK HOUR could not reach the internet. Connect to the internet and press Retry, or skip this and install the '
                'stem engine later. ' + LATER)

SHOWN = {'running', 'cancelling'}  # job states the app is told about through the status file


def say(text):
    """Setup's console shows this (python.exe); under pythonw there is no console and nothing is printed."""
    stream = sys.stdout
    if stream is None:
        return
    try:
        stream.reconfigure(errors='replace')
    except (AttributeError, ValueError):
        pass
    try:
        print(text, flush=True)
    except (OSError, ValueError):
        pass


def check_online():
    """True when the download servers answer (through the PC's proxy settings, like the install itself)."""
    try:
        W.http_open(W.PIP_JSON, timeout=6).close()
        return True
    except W.urllib.error.HTTPError:
        return True  # the server answered
    except Exception:
        return False


def other_install_running(installer):
    """True when another process holds the install lock. Never creates the data folder or the lock file."""
    if not (installer.root / 'stem-engine.lock').is_file():
        return False
    try:
        handle = installer._take_process_lock()
    except W.InstallError as error:
        return error.code == 'busy'
    installer._release_process_lock(handle)
    return False


def elapsed_text(seconds):
    seconds = max(0, int(seconds or 0))
    return '%d s so far' % seconds if seconds < 60 else '%d min %02d s so far' % divmod(seconds, 60)


def describe(plan):
    """(what is being installed, the facts line) for the plan windows_stem_installer made for this PC."""
    items = []
    if not plan['runtime_ready']:
        if plan['gpu_checking']:
            items.append('Checking this PC for an NVIDIA graphics card (a few seconds).')
        elif plan['flavour'] == 'cuda':
            items.append('PyTorch with NVIDIA GPU support (CUDA 12.4)%s: stems separate in seconds.'
                         % (' for your ' + plan['gpu'] if plan['gpu'] else ''))
        else:
            items.append('PyTorch for the CPU (no NVIDIA GPU was found): stems separate more slowly, about a minute for a short clip.')
        items.append('Demucs 4.0.1 and the small audio libraries it needs.')
    if not plan['model_ready']:
        items.append('The separation model (htdemucs, %s), checked against its official checksum.' % W.human(W.MODEL_SIZE))
    facts = 'Download: about %s. Free disk space needed while installing: about %s' % (plan['download_text'], plan['disk_text'])
    if not plan['runtime_ready'] and not plan['gpu_checking']:
        facts += ' (about %s stay on the disk afterwards)' % W.human(W.SIZES[plan['flavour']]['unpacked'])
    facts += '. From: %s. Nothing from your music leaves this PC.' % ', '.join(plan['sources'])
    return items, facts


class SetupController:
    """The step's logic without a window: what to say, which buttons, what the job is doing. A view calls act() for a button
    and poll() every few hundred milliseconds."""

    def __init__(self, installer=None, online=check_online):
        self.installer = installer or W.INSTALLER
        self.online = online
        self.state = 'ask'  # ask checking running cancelling done failed offline cancelled skipped elsewhere
        self.failure = None  # why it could not be installed (kept when the user then skips)
        self.error = ''
        self.installed = self.cancelled = False
        self._attempt = 0
        self._cancel_asked = False
        self._sharing = False

    # -- what the user does
    def act(self, name):
        if name in ('install', 'retry', 'continue'):
            self.begin()
        elif name == 'cancel':
            self.cancel()
        elif name == 'skip':
            if self.state in ('ask', 'checking', 'failed', 'offline'):
                self.state = 'skipped'
        elif name == 'close':
            if self.state in ('done', 'cancelled', 'elsewhere', 'skipped'):
                self.state = 'closed'

    def begin(self):
        if self.state in ('running', 'cancelling', 'checking'):
            return
        self._attempt += 1
        self.state, self.error, self.failure, self._cancel_asked, self.cancelled = 'checking', '', None, False, False
        threading.Thread(target=self._go, args=(self._attempt,), name='peak-hour-stem-setup', daemon=True).start()

    def _go(self, attempt):
        reachable = self.online()
        if attempt != self._attempt or self.state != 'checking':
            return  # skipped or cancelled meanwhile
        if not reachable:
            self.state, self.failure = 'offline', OFFLINE_TEXT
            return
        if self._cancel_asked:
            return
        _, started = self.installer.start()
        self.state = 'running' if started else 'elsewhere'

    def cancel(self):
        if self.state == 'checking':
            self._cancel_asked = True
            self.state, self.cancelled = 'cancelled', True
        elif self.state == 'running':
            self.state = 'cancelling'
            self.installer.cancel()

    @property
    def busy(self):
        return self.state in ('checking', 'running', 'cancelling')

    @property
    def exit_code(self):
        if self.installed:
            return 0
        if self.failure:
            return 1
        return 2 if self.cancelled else 0

    # -- what the window shows
    def poll(self):
        status = self.installer.status()
        if self.state in ('running', 'cancelling'):
            job = status['state']
            if job == 'done':
                self.state, self.installed = 'done', True
            elif job == 'failed':
                if status.get('error_code') == 'busy':
                    self.state = 'elsewhere'
                else:
                    self.state, self.error = 'failed', status.get('error') or 'The install failed.'
                    self.failure = self.error
            elif job == 'cancelled':
                self.state, self.cancelled = 'cancelled', True
        self._publish(status)
        return self.view(status)

    def _publish(self, status):
        """Tell the app (Studio > Create Stems) what this window is doing while it does it, and once more when it ends."""
        active = self.state in ('checking', 'running', 'cancelling')
        if active:
            share = {'state': 'cancelling' if self.state == 'cancelling' else 'running'}
            if self.state == 'checking':
                share.update(phase='space', detail='Checking the internet connection.', percent=0, elapsed_seconds=0, idle_seconds=0,
                             stalled=False, stall_text='')
            else:
                share.update({key: status.get(key) for key in ('phase', 'detail', 'percent', 'elapsed_seconds', 'idle_seconds',
                                                               'stalled', 'stall_text')})
        elif self._sharing:
            share = {'state': self.state}  # not running any more: the app reads the engine's own state again
        else:
            return
        self._sharing = active
        W.write_setup_status(self.installer.root, share)

    def view(self, status=None):
        status = status or self.installer.status()
        state = self.state
        items, facts = describe(status)
        percent = max(0, min(100, int(status.get('percent') or 0)))
        view = {'title': TITLE, 'heading': 'Install the stem engine', 'text': INTRO, 'items': items, 'facts': facts,
                'bar': False, 'percent': 0, 'phase': '', 'elapsed': '', 'stall': '', 'error': '', 'buttons': [], 'default': None}
        later = LATER
        if state == 'ask':
            view['buttons'] = [('install', 'Install now', not status['gpu_checking'] or status['runtime_ready']), ('skip', 'Skip for now', True)]
            view['default'] = 'install'
            view['phase'] = later
        elif state == 'checking':
            view.update(bar=True, phase='Checking the internet connection.')
            view['buttons'] = [('cancel', 'Cancel', True)]
        elif state in ('running', 'cancelling'):
            detail = status.get('detail') or 'Working...'
            view.update(bar=True, percent=percent, elapsed=elapsed_text(status.get('elapsed_seconds')),
                        phase='%s (%d%%)%s' % (detail, percent, ' ' + status['notice'] if status.get('notice') else ''),
                        stall=status.get('stall_text') if status.get('stalled') else '')
            view['buttons'] = [('cancel', 'Cancel', state == 'running')]
            if state == 'running':
                view['phase'] += '  Cancel keeps what is downloaded; a later install continues from there.'
        elif state == 'done':
            view.update(heading='The stem engine is installed', percent=100, phase='Stems are ready in Studio.')
            view['items'], view['facts'] = [], ''
            view['buttons'], view['default'] = [('close', 'Close', True)], 'close'
        elif state in ('failed', 'offline'):
            view.update(heading='The stem engine could not be installed', error=self.failure or self.error, phase=later)
            view['buttons'], view['default'] = [('retry', 'Retry', True), ('skip', 'Skip', True)], 'retry'
        elif state == 'cancelled':
            view.update(heading='Install cancelled', phase='What is already downloaded is kept. ' + later)
            view['buttons'], view['default'] = [('continue', 'Continue install', True), ('close', 'Close', True)], 'continue'
        elif state == 'elsewhere':
            view.update(heading='Already being installed', phase=ELSEWHERE)
            view['items'], view['facts'] = [], ''
            view['buttons'], view['default'] = [('close', 'Close', True)], 'close'
        return view


class Window:
    """The tkinter view of a SetupController. show=False builds it without putting it on screen (tests)."""

    def __init__(self, controller, auto=False, show=True):
        import tkinter as tk
        from tkinter import ttk
        self.tk, self.ttk, self.controller, self.auto = tk, ttk, controller, auto
        try:  # sharp text on a scaled display
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass
        self.root = tk.Tk()
        self.root.withdraw()
        self.root.title(TITLE)
        self.root.resizable(False, False)
        icon = Path(__file__).resolve().parent / 'static' / 'brand' / 'favicon.ico'
        try:
            self.root.iconbitmap(str(icon))
        except Exception:
            pass
        body = ttk.Frame(self.root, padding=18)
        body.pack(fill='both', expand=True)
        wrap = 520
        self.heading = ttk.Label(body, font=('Segoe UI', 13, 'bold'), wraplength=wrap)
        self.text = ttk.Label(body, wraplength=wrap, justify='left')
        self.items = ttk.Label(body, wraplength=wrap, justify='left')
        self.facts = ttk.Label(body, wraplength=wrap, justify='left', foreground='#444444')
        self.bar = ttk.Progressbar(body, length=wrap, maximum=100, mode='determinate')
        self.phase = ttk.Label(body, wraplength=wrap, justify='left')
        self.elapsed = ttk.Label(body, foreground='#444444')
        self.stall = ttk.Label(body, wraplength=wrap, justify='left', foreground='#9a5b00')
        self.error = ttk.Label(body, wraplength=wrap, justify='left', foreground='#b00020')
        self.row = ttk.Frame(body)
        for index, widget in enumerate((self.heading, self.text, self.items, self.facts, self.bar, self.phase, self.elapsed,
                                        self.stall, self.error, self.row)):
            widget.grid(row=index, column=0, sticky='w', pady=(0, 8))
        self.row.grid_configure(sticky='e', pady=(8, 0))
        body.columnconfigure(0, weight=1)
        self.buttons, self.signature = {}, None
        self.closing = False
        self.root.protocol('WM_DELETE_WINDOW', self.on_close)
        self.render(controller.poll())
        self._place()
        if show:
            self.root.deiconify()
            self.root.lift()
            self.root.attributes('-topmost', True)  # Setup started this window: do not hide behind the console
            self.root.after(800, lambda: self.root.attributes('-topmost', False))
            self.root.focus_force()
        if auto:
            controller.begin()
        self.root.after(400, self.tick)

    def _place(self):
        self.root.update_idletasks()
        width, height = self.root.winfo_reqwidth(), self.root.winfo_reqheight()
        self.root.geometry('+%d+%d' % (max(0, (self.root.winfo_screenwidth() - width) // 2),
                                       max(0, (self.root.winfo_screenheight() - height) // 3)))

    def render(self, view):
        def put(widget, text):
            widget.configure(text=text)
            if text:
                widget.grid()
            else:
                widget.grid_remove()
        put(self.heading, view['heading'])
        put(self.text, view['text'] if view['items'] or view['buttons'] and view['buttons'][0][0] == 'install' else '')
        put(self.items, '\n'.join('• ' + item for item in view['items']))
        put(self.facts, view['facts'])
        put(self.phase, view['phase'])
        put(self.elapsed, view['elapsed'])
        put(self.stall, view['stall'])
        put(self.error, view['error'])
        if view['bar']:
            self.bar.grid()
            self.bar.configure(mode='determinate' if view['percent'] else 'indeterminate')
            if view['percent']:
                self.bar.stop()
                self.bar['value'] = view['percent']
            else:
                self.bar.start(25)
        elif view['percent']:
            self.bar.grid()
            self.bar.stop()
            self.bar.configure(mode='determinate')
            self.bar['value'] = view['percent']
        else:
            self.bar.stop()
            self.bar.grid_remove()
        signature = tuple(view['buttons'])
        if signature != self.signature:
            for button in self.buttons.values():
                button.destroy()
            self.buttons = {}
            for name, label, enabled in view['buttons']:
                button = self.ttk.Button(self.row, text=label, command=lambda n=name: self.press(n))
                button.pack(side='left', padx=(8, 0))
                self.buttons[name] = button
            self.signature = signature
            default = view['default']
            if default in self.buttons:
                self.buttons[default].focus_set()
                self.root.bind('<Return>', lambda event, n=default: self.press(n))
            else:
                self.root.unbind('<Return>')
        for name, label, enabled in view['buttons']:
            self.buttons[name].state(['!disabled'] if enabled else ['disabled'])

    def press(self, name):
        self.controller.act(name)
        self.render(self.controller.poll())

    def on_close(self):
        """The window's X: the same as the safe button for where the step is."""
        state = self.controller.state
        if state in ('running', 'checking'):
            self.closing = True  # leave once the job has stopped (what was downloaded is kept)
            self.controller.cancel()
        elif state in ('cancelling',):
            self.closing = True
        elif state in ('ask', 'failed', 'offline'):
            self.controller.act('skip')
        else:
            self.controller.act('close')
        self.render(self.controller.poll())

    def tick(self):
        try:
            self.render(self.controller.poll())
        except self.tk.TclError:
            return
        c = self.controller
        done_for_good = c.state in ('skipped', 'closed') or (self.closing and not c.busy)
        if c.state == 'done' and (self.auto or self.closing):
            self._leave_at = getattr(self, '_leave_at', None) or time.monotonic() + 1.5  # long enough to read "installed"
            done_for_good = time.monotonic() >= self._leave_at
        if done_for_good:
            self.root.destroy()
        else:
            self.root.after(400, self.tick)

    def run(self):
        self.root.mainloop()


def run_window(controller, auto=False):
    Window(controller, auto=auto).run()


def parse(argv):
    parser = argparse.ArgumentParser(description="PEAK HOUR Setup: install the stem engine (Studio > Stems), unless it is installed.")
    parser.add_argument('--auto', action='store_true', help='start installing without asking; close the window when done')
    parser.add_argument('--skip', action='store_true', help='do nothing')
    parser.add_argument('--check', action='store_true', help='print the status as JSON; exit 0 when the engine is ready, 1 when not')
    return parser.parse_args(argv)


def silent():
    return os.environ.get(SILENT_VARIABLE, '').strip().lower() not in ('', '0', 'false', 'no')


def main(argv=None, installer=None, online=check_online, window=run_window):
    args = parse(sys.argv[1:] if argv is None else argv)
    installer = installer or W.INSTALLER
    if args.check:
        plan = installer.plan()
        say(json.dumps({'ready': plan['ready'], 'runtime_ready': plan['runtime_ready'], 'model_ready': plan['model_ready'],
                        'flavour': plan['flavour'], 'download_text': plan['download_text'], 'disk_text': plan['disk_text'],
                        'busy': other_install_running(installer), 'data': str(installer.root)}))
        return 0 if plan['ready'] else 1
    if args.skip or silent():
        say('Stem engine step skipped (unattended). ' + LATER)
        return 0
    plan = installer.plan()
    if plan['ready']:  # nothing written, nothing downloaded, no window
        say(ALREADY)
        return 0
    if other_install_running(installer):
        say(ELSEWHERE)
        return 0
    W.start_gpu_detection()
    controller = SetupController(installer, online)
    try:
        window(controller, auto=args.auto)
    except Exception:  # no window (no display, a broken Tk): PEAK HOUR is installed; the app can install the engine itself
        try:
            installer.root.mkdir(parents=True, exist_ok=True)
            (installer.root / 'stem-setup-error.log').write_text(traceback.format_exc(), 'utf-8')
        except OSError:
            pass
        if controller.busy:
            controller.cancel()
        say('The stem engine step could not open its window. ' + LATER)
        return 1
    if controller.busy:  # the window was closed in some other way: stop the job, keep what was downloaded
        controller.cancel()
        installer.wait(60)
    controller.poll()
    say({0: 'Stem engine installed.', 1: 'The stem engine was not installed. ' + LATER,
         2: 'The stem engine install was cancelled. ' + LATER}[controller.exit_code])
    return controller.exit_code


if __name__ == '__main__':
    sys.exit(main())
