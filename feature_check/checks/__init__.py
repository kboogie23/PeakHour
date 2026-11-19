"""Checks for the feature catalogue. Each check is a function check(ctx) -> Result that watches what a user sees
(the real page in headless Edge, or the same HTTP routes the page calls) and says PASS / FAIL / WARN / SKIP / N/A.

This module holds what they share: the app is opened the way a user opens it, a library of a known size is in the
sandbox, and results are built the same way everywhere.
"""
import json
import os
import time
from pathlib import Path

from feature_check.api import Result, CheckFailed, CheckSkipped  # noqa: F401  (re-exported for the check modules)
from feature_check import synthetic_library

QUICK_TRACKS = 400       # a library big enough to have real rows, small enough to build in a second
QUICK_REAL = 40
TAB_BUTTONS = {'library': '#tab-btn-library', 'studio': '#tab-btn-studio', 'performance': '#tab-btn-performance',
               'health': '#tab-btn-health', 'playlists': '#tab-btn-playlists', 'export': '#tab-btn-export'}


# ------------------------------------------------------------------ results
def ok(seconds=0.0, budget=None, reason='', shots=None, **evidence):
    return Result('PASS', seconds, budget, reason, evidence, list(shots or []))


def warn(reason, seconds=0.0, budget=None, shots=None, **evidence):
    return Result('WARN', seconds, budget, reason, evidence, list(shots or []))


def fail(reason, seconds=0.0, budget=None, shots=None, **evidence):
    return Result('FAIL', seconds, budget, reason, evidence, list(shots or []))


def not_applicable(reason, shots=None, **evidence):
    return Result('N/A', 0.0, None, reason, evidence, list(shots or []))


def over_budget(seconds, budget):
    return budget is not None and seconds > budget


def p95(values):
    values = sorted(values)
    if not values:
        return 0.0
    return values[min(len(values) - 1, int(round(0.95 * (len(values) - 1) + 0.4999)))]


# ------------------------------------------------------------------ the browser and the app
def need_browser(ctx):
    if getattr(ctx, 'browser', None) is None:
        ctx.skip('no browser: Microsoft Edge and node.js are needed for page checks')
    return ctx.browser


def run_ok(run, what):
    """Raise CheckFailed with the first thing that went wrong when the browser steps did not all work."""
    bad = [s for s in run.steps if not s.get('ok')]
    if bad:
        raise CheckFailed(f'{what}: {bad[0].get("op")} - {bad[0].get("error", "failed")}', {'steps': run.steps[-6:]})
    return run


def shots_dir(ctx):
    folder = Path(getattr(ctx.sandbox, 'shots', None) or Path(ctx.sandbox) / 'shots')
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def shot(ctx, name):
    """A screenshot step (the file lands in the sandbox; the report links it)."""
    return {'op': 'screenshot', 'path': str(shots_dir(ctx) / (name + '.png'))}


def library_info(ctx):
    return synthetic_library.current(ctx.sandbox)


def is_real(ctx):
    """True under check_features.py --real: the app runs on the owner's actual data (the runner backs it up and restores it)."""
    return bool(getattr(ctx, 'real', False))


def real_local():
    return Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local')


def cache_path(ctx):
    """The library cache the server reads: the owner's own file under --real, the sandbox's otherwise."""
    if is_real(ctx):
        return real_local() / 'AXIOM DJ' / 'data' / 'library_cache.json'
    return Path(ctx.sandbox) / 'AppData' / 'Local' / 'AXIOM DJ' / 'data' / 'library_cache.json'


_TRACKS = {}


def library_tracks(ctx):
    """The library's songs, read (never written) from the cache file; kept until the file changes."""
    path = cache_path(ctx)
    stat = path.stat()
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    if _TRACKS.get('key') != key:
        _TRACKS['key'] = key
        _TRACKS['tracks'] = json.loads(path.read_text(encoding='utf-8')).get('tracks', [])
    return _TRACKS['tracks']


def ensure_library(ctx, tracks=QUICK_TRACKS, real=QUICK_REAL):
    """A library of at least `tracks` songs in the sandbox (the one the scale run installed, a real copy, or a new
    synthetic one). Returns {'library': 'synthetic'|'real copy'|'real', 'tracks': n, ...}.
    Under --real nothing is ever written: the owner's library is what it is."""
    if is_real(ctx):
        return {'library': 'real', 'tracks': len(library_tracks(ctx))}
    info = library_info(ctx)
    if info and info.get('tracks', 0) >= tracks:
        return info
    if info and info.get('library') == 'real copy':
        return info
    return synthetic_library.install(ctx.sandbox, count=tracks, real=min(real, tracks))


def open_app(ctx, tab='library', settle=2500, extra_steps=(), tab_wait=1.5):
    """Load the app fresh and open a tab the way a user does: skip the first-run tour, click the sidebar button.
    Dialogs are recorded (never shown), errors and network are recorded. Returns the browser Run."""
    browser = need_browser(ctx)
    steps = [{'op': 'stub_dialogs'}, {'op': 'collect_errors'}, {'op': 'collect_network'},
             {'op': 'navigate', 'url': '/', 'settle': settle, 'required': True},
             # the page is ready when the document is complete and the sidebar is drawn (a slow PC or a cold Edge takes a while)
             {'op': 'until', 'timeout': 60, 'expr': "document.readyState==='complete'&&!!document.getElementById('tab-btn-library')"
                                                    "&&document.getElementById('tab-btn-library').getClientRects().length>0"},
             {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 2}]       # only there on a first run
    if tab:
        steps += [{'op': 'click', 'selector': TAB_BUTTONS[tab], 'required': True, 'timeout': 20}, {'op': 'sleep', 'seconds': tab_wait}]
    steps += list(extra_steps)
    run = browser.run(steps)
    for step in run.steps:
        if not step.get('ok') and step['op'] != 'click_text':
            raise CheckFailed(f'could not open the {tab or "start"} page: {step.get("op")} - {step.get("error")}', {'steps': run.steps})
    return run


def metrics_reset(ctx):
    try:
        ctx.get('/api/_featurecheck/metrics?reset=1')
    except OSError:
        pass


def route_seconds(metrics, fragment, method='GET'):
    """(max_seconds, count) the server spent in routes whose rule contains `fragment`."""
    top, n = 0.0, 0
    for key, row in (metrics.get('routes') or {}).items():
        if key.startswith(method + ' ') and fragment in key and isinstance(row, dict):
            top, n = max(top, float(row.get('max_s', 0))), n + int(row.get('count', 0))
    return top, n


def write_json(path, value):
    Path(path).write_text(json.dumps(value), encoding='utf-8')


def set_processes(ctx, names):
    """The fake process list the boot server reads (a list of running program names, e.g. ['VirtualDJ'])."""
    write_json(Path(ctx.sandbox) / 'processes.json', list(names))


def set_dialog_answers(ctx, **answers):
    """What the faked Windows file/folder choosers answer next: folder=..., serato=..., vdj_database=..., cancel=True."""
    write_json(Path(ctx.sandbox) / 'dialogs.json', answers)


def wait_for(fn, seconds, every=0.25):
    """Poll fn() until it returns something truthy; returns (value, seconds_taken) - value is None on timeout."""
    start = time.perf_counter()
    while time.perf_counter() - start < seconds:
        value = fn()
        if value:
            return value, time.perf_counter() - start
        time.sleep(every)
    return None, time.perf_counter() - start


def is_quick(ctx):
    """True for the short run (check_features.py --quick): checks that need minutes use their short form."""
    import os
    return bool(getattr(ctx, 'quick', False) or os.environ.get('FEATURE_CHECK_QUICK') == '1')
