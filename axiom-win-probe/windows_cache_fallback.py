r"""Studio DAW cache folders that this PC cannot use are replaced by PEAK HOUR's own.

studio_daw keeps rebuildable data in folders under ~/.cache. Every one the compiled package writes is listed in CACHES
(found by reading the string constants of every studio_daw module):
  axiom-stretch-managed-v1   prepared_cache.STRETCH_ROOT (also imported by stretch and audio_units); its .lock is opened
  axiom-audio-units          audio_units.ROOT; <ROOT>\managed-v1\.lock is opened
  axiom-stems                stems.ROOT; its jobs live in <ROOT>\outputs-managed-v1, whose .lock is the part that gets checked
  axiom-waveforms            create_waveform_blueprint(root=None) -> ~/.cache/axiom-waveforms
  axiom-steady-timing-v1     create_steady_timing_blueprint(root=None) -> ~/.cache/axiom-steady-timing-v1
  axiom-daw                  create_bundle_blueprint(root=None) -> ~/.cache/axiom-daw
  axiom-daw/imports          create_import_blueprint(root=None) -> ~/.cache/axiom-daw/imports (the app passes its own data
                             folder, so this one only matters when a caller leaves root out)
  axiom-daw/analysis-numba   drum_analysis_process makes ~/.cache/axiom-daw/analysis-numba for its Numba cache
The prefixes axiom-snap-, axiom-source-probe, axiom-pulse, axiom-mix, axiom-drum-pattern-, axiom-stem-warmup and
axiom-daw-bundle are temporary folders under the system temp, not ~/.cache, and are not cache roots.
A module takes its folder in one of three ways, so there are three ways to redirect it (all before app is imported,
because the blueprints read their folders when app is imported):
  constants  module attributes (STRETCH_ROOT, ROOT);
  factories  create_*_blueprint(root=None) defaults to Path.home() / ".cache" / name, so the function is wrapped to pass the
             fallback as root whenever the caller gives none (an explicit root is left alone);
  home       a module that spells Path.home() / ".cache/..." inside a function gets a Path whose home() is the fallback home.

A folder left behind by another process (a sandboxed tool, a different account, an ACL set by hand) can deny this
user even listing it: opening <folder>\.lock then raised "[Errno 13] Permission denied" and every stretched clip
paused. install() creates and opens a file inside each folder (and its .lock where the core opens one); one that fails is
replaced by <data root>\cache\<same folder name> (home kind: <data root>\cache\home\.cache\<name>). The unusable folder is
never touched, listed again or given new permissions. Python 3.12's mkdir ignores mode on Windows, so this code never
produces such an ACL itself (checked in the test).
"""
import functools
import inspect
import logging
import os
import time
import uuid
from pathlib import Path

RETRY_WAIT = 0.5  # seconds before a failed probe is repeated once

# (folder under ~/.cache, how the core reaches it, sub-folders whose .lock the core opens)
#   ('constants', ((module, attribute), ...))   ('factories', ((module, function), ...))   ('home', (module, ...))
CACHES = (
    ('axiom-stretch-managed-v1', ('constants', (('studio_daw.prepared_cache', 'STRETCH_ROOT'), ('studio_daw.stretch', 'STRETCH_ROOT'),
                                                ('studio_daw.audio_units', 'STRETCH_ROOT'))), ('.',)),
    ('axiom-audio-units', ('constants', (('studio_daw.audio_units', 'ROOT'),)), ('managed-v1',)),
    # stems keep their jobs in <ROOT>\outputs-managed-v1, and that sub-folder is where an ACL left behind by another process
    # denies the user (ROOT itself stays usable): probing ROOT alone missed it and Create Stems failed with "[Errno 13]".
    ('axiom-stems', ('constants', (('studio_daw.stems', 'ROOT'),)), ('outputs-managed-v1',)),
    ('axiom-waveforms', ('factories', (('studio_daw.waveforms', 'create_waveform_blueprint'),)), ()),
    ('axiom-steady-timing-v1', ('factories', (('studio_daw.steady_timing', 'create_steady_timing_blueprint'),)), ()),
    ('axiom-daw', ('factories', (('studio_daw.bundles', 'create_bundle_blueprint'),)), ()),
    ('axiom-daw/imports', ('factories', (('studio_daw.imports', 'create_import_blueprint'),)), ()),
    ('axiom-daw/analysis-numba', ('home', ('studio_daw.drum_analysis_process',)), ()),
)

REDIRECTED = {}  # folder name -> replacement path, for what install() moved (a second call with the same base does nothing)


def data_root():
    return Path(os.environ.get('AXIOM_RUNTIME_DIR') or Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local') / 'AXIOM DJ')


def probe(folder, lock_folders=()):
    """None when files can be created and opened in folder (and in lock_folders, where .lock is opened); else the error."""
    folder = Path(folder)
    try:
        for sub in lock_folders:
            target = folder / sub if sub != '.' else folder
            target.mkdir(parents=True, exist_ok=True)
            os.close(os.open(target / '.lock', os.O_CREAT | os.O_RDWR | getattr(os, 'O_BINARY', 0), 0o600))
        folder.mkdir(parents=True, exist_ok=True)
        name = folder / ('.peak-hour-probe-%d-%s' % (os.getpid(), uuid.uuid4().hex[:8]))
        fd = os.open(name, os.O_CREAT | os.O_EXCL | os.O_RDWR | getattr(os, 'O_BINARY', 0), 0o600)
        try:
            os.write(fd, b'x')
        except OSError:
            os.close(fd)
            fd = None
            try:
                os.unlink(name)
            except OSError:
                pass
            raise
        finally:
            if fd is not None:
                os.close(fd)
        # Creating, writing and closing worked: the folder is usable. A virus scanner may still hold the file for a moment, so
        # removing it is best effort (one retry) and never a reason to redirect the cache.
        for attempt in (0, 1):
            try:
                os.unlink(name)
                break
            except OSError:
                if attempt == 0:
                    time.sleep(0.05)
        return None
    except OSError as error:
        return error


def _wrap_factory(module, function, fallback):
    """create_*_blueprint(..., root=None): pass the fallback as root when the caller gives none (an explicit root stays)."""
    original = getattr(module, function)
    if hasattr(original, '_peak_hour_root'):
        original = original.__wrapped__  # install() again with another base: wrap the real function, not our wrapper
    signature = inspect.signature(original)

    @functools.wraps(original)
    def wrapper(*args, **kwargs):
        if signature.bind_partial(*args, **kwargs).arguments.get('root') is None:
            kwargs['root'] = wrapper._peak_hour_root
        return original(*args, **kwargs)
    wrapper._peak_hour_root = fallback
    setattr(module, function, wrapper)


def _home_path(path_class, home):
    """A Path like path_class whose home() is the fallback home; every other Path behaviour is unchanged."""
    home = Path(home)
    return type('PeakHourPath', (type(path_class()),), {'home': classmethod(lambda cls: cls(home))})


def install(root=None, log=None):
    """Redirect each unusable cache folder; returns {folder name: replacement path}. Safe to call again."""
    import importlib
    log = log or logging.getLogger('peak_hour.cache').warning
    base = Path(root) if root else data_root() / 'cache'
    moved = {}
    for name, (kind, places), locks in CACHES:
        if kind == 'constants':
            modules = [(importlib.import_module(module), attribute) for module, attribute in places]
            current = Path(getattr(modules[0][0], modules[0][1]))
            if current.parent == base:  # already redirected
                continue
        else:
            current = Path.home() / '.cache' / name
            if name in REDIRECTED and REDIRECTED[name].is_relative_to(base):
                continue
        error = probe(current, locks)
        if error is not None:  # one stray failure (an antivirus scan holding the file) must not move the cache
            time.sleep(RETRY_WAIT)
            error = probe(current, locks)
        if error is None:
            continue
        fallback = base / 'home' / '.cache' / name if kind == 'home' else base / name
        again = probe(fallback, locks)
        if again is not None:
            log('PEAK HOUR: audio cache %s is not usable (%s) and neither is %s (%s); Studio audio stays unavailable'
                % (current, error, fallback, again))
            continue
        if kind == 'constants':
            for module, attribute in modules:
                setattr(module, attribute, fallback)
        elif kind == 'factories':
            for module, function in places:
                _wrap_factory(importlib.import_module(module), function, fallback)
        else:
            for module in places:
                module = importlib.import_module(module)
                module.Path = _home_path(module.Path, base / 'home')
        REDIRECTED[name] = moved[name] = fallback
        log('PEAK HOUR: audio cache %s is not usable (%s, failed twice); using %s instead. The old folder was left untouched.'
            % (current, error, fallback))
    return moved
