r"""Studio DAW cache folders that this PC cannot use are replaced by PEAK HOUR's own.

studio_daw keeps rebuildable audio in folders under ~/.cache: axiom-stretch-managed-v1 (prepared_cache.STRETCH_ROOT,
also imported by stretch and audio_units), axiom-audio-units (audio_units.ROOT) and axiom-stems (stems.ROOT).
Each is a module constant that the blueprints read when app is imported (create_stretch_blueprint(root=None)
falls back to STRETCH_ROOT, stems and audio_units read ROOT), so install() must run before app is imported.

A folder left behind by another process (a sandboxed tool, a different account, an ACL set by hand) can deny this
user even listing it: opening <folder>\.lock then raised "[Errno 13] Permission denied" and every stretched clip
paused. install() creates and opens a file inside each folder; one that fails is replaced by
<data root>\cache\<same folder name>. The unusable folder is never touched, listed again or given new permissions.
Python 3.12's mkdir ignores mode on Windows, so this code never produces such an ACL itself (checked in the test).
"""
import logging
import os
import time
import uuid
from pathlib import Path

RETRY_WAIT = 0.5  # seconds before a failed probe is repeated once

# (folder name, [(module, attribute), ...] holding that path, sub-folders whose .lock the core opens)
CACHES = (
    ('axiom-stretch-managed-v1', (('studio_daw.prepared_cache', 'STRETCH_ROOT'), ('studio_daw.stretch', 'STRETCH_ROOT'),
                                  ('studio_daw.audio_units', 'STRETCH_ROOT')), ('.',)),
    ('axiom-audio-units', (('studio_daw.audio_units', 'ROOT'),), ('managed-v1',)),
    ('axiom-stems', (('studio_daw.stems', 'ROOT'),), ()),
)


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
        finally:
            os.close(fd)
        os.unlink(name)
        return None
    except OSError as error:
        return error


def install(root=None, log=None):
    """Redirect each unusable cache folder; returns {folder name: replacement path}. Safe to call again."""
    import importlib
    log = log or logging.getLogger('peak_hour.cache').warning
    base = Path(root) if root else data_root() / 'cache'
    moved = {}
    for name, places, locks in CACHES:
        modules = [(importlib.import_module(module), attribute) for module, attribute in places]
        current = Path(getattr(modules[0][0], modules[0][1]))
        if current.parent == base:  # already redirected
            continue
        error = probe(current, locks)
        if error is not None:  # one stray failure (an antivirus scan holding the file) must not move the cache
            time.sleep(RETRY_WAIT)
            error = probe(current, locks)
        if error is None:
            continue
        fallback = base / name
        again = probe(fallback, locks)
        if again is not None:
            log('PEAK HOUR: audio cache %s is not usable (%s) and neither is %s (%s); Studio audio stays unavailable'
                % (current, error, fallback, again))
            continue
        for module, attribute in modules:
            setattr(module, attribute, fallback)
        moved[name] = fallback
        log('PEAK HOUR: audio cache %s is not usable (%s, failed twice); using %s instead. The old folder was left untouched.'
            % (current, error, fallback))
    return moved
