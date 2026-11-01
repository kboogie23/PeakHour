"""Progress for "Adding your music" on Windows: a real total, percentage and time left.

AXIOM's add-folder job walks the folder and indexes each file as it goes, so its status only ever has a
running count ("20,275 tracks indexed") and the import window shows "LIVE" with no percentage. The job
runs twice: step 1 lists every music file (the library is usable after it), step 2 reads each file's
details (BPM, key, year, length).

While the job runs, a second thread counts the music files in the same folder from the directory
listing alone (no file is opened; on Windows the listing already says which entries are folders, so
this is quick even on USB and network drives). The finished count is written to the job as `total`,
which AXIOM's own window already turns into a percentage. /api/windows/import-progress reports the
latest job for the Windows window and top meter (static/js/shared/windows-intake.js): which step,
files found, percentage, files per second and time left.
"""
import collections
import contextlib
import ntpath
import os
import threading
import time

from flask import Blueprint, jsonify

SKIP_FOLDERS = {'$recycle.bin', 'system volume information'}


def count_music(folder, extensions, sidecar=lambda name: False, excluded=(), report=None, every=500, stop=lambda: False):
    """Music files under folder as AXIOM's scanner sees them (os.walk: links are not followed, junctions are).
    Returns (count, complete)."""
    excluded = {os.path.normcase(os.path.abspath(path)) for path in excluded}
    total, stack = 0, [folder]
    while stack:
        if stop():
            return total, False
        current = stack.pop()
        if os.path.normcase(os.path.abspath(current)) in excluded:
            continue
        try:
            entries = os.scandir(current)
        except OSError:
            continue
        with entries:
            for entry in entries:
                try:
                    if entry.is_dir() and not entry.is_symlink():
                        if entry.name.lower() not in SKIP_FOLDERS:
                            stack.append(entry.path)
                    elif os.path.splitext(entry.name)[1].lower() in extensions and not sidecar(entry.name):
                        total += 1
                        if report and total % every == 0:
                            report(total)
                except OSError:
                    continue
    return total, True


def progress(job, now=None):
    """What the Windows window shows for one add-folder job."""
    now = time.time() if now is None else now
    status = job.get('status') or 'running'
    ready = job.get('library_ready') is True
    total = int(job.get('total') or 0)
    processed = int(job.get('processed') or 0)
    step = 2 if ready else 1
    started = job.get('step_started_at') or job.get('started_at') or job.get('created_at') or now
    elapsed = max(0.0, now - float(started))
    rate = processed / elapsed if elapsed >= 3 and processed else 0.0
    percent = min(100, int(processed * 100 / total)) if total else None
    left = round((total - processed) / rate) if total and rate and processed < total else None
    return {'active': status in ('queued', 'running'), 'status': status, 'step': step, 'library_ready': ready,
            'counting': bool(job.get('counting')), 'files_found': int(job.get('files_found') or 0),
            'total': total, 'processed': min(processed, total) if total else processed, 'percent': percent,
            'files_per_second': round(rate, 1), 'seconds_left': left, 'elapsed_seconds': round(elapsed),
            'folder': os.path.basename(str(job.get('folder_path') or '').rstrip('\\/')) or 'Music Library',
            'error': job.get('error') if status == 'failed' else None}


class FastRealpath:
    """os.path.realpath for the add-folder job thread, without opening every file.

    AXIOM's import resolves each file's real path 3-4 times per step. On Windows realpath opens the file
    to ask for its final path; on a USB drive formatted exFAT with 20,283 videos in one folder that took
    about 13 ms a file (exFAT searches the whole folder for each open), so step 1 sat at "Finalizing" for
    15 minutes or more. For a plain file the answer is always the folder's real path plus the file's name
    exactly as the folder listing stores it. So in the job thread each folder is resolved once and listed
    once, and the files are answered from the listing. Anything else gets the real realpath: links and
    other reparse points, names not in the listing, bytes or relative inputs that fail, other threads.

    `islink` answers os.path.islink from the same listing (no file ID involved, so it is exact everywhere).
    `stat` does the same for os.stat in threads started with active(stat=True): a plain file's size and
    times come from the listing. The listing has no file ID (st_ino, st_dev and st_nlink are 0), so it is
    used only where nothing reads those: the Health count (windows_performance), never the import, whose
    track identities are built from them.

    Outside an import (any thread) realpath is answered from a shared cache: AXIOM's library routes (opening
    Track Information resolves all 50,000 tracks) call it for every track, 31 ms each on an exFAT drive, which
    took 15 minutes. A folder asked about repeatedly (SHARED_AFTER calls) is resolved and listed once, kept for
    SHARED_TTL seconds, and its files are answered from that listing as above. A name missing from a listed
    folder is the folder's real path plus the name as given, which is what Windows' realpath returns. A folder
    that cannot be listed (missing drive), links, odd names and `..` get Windows' realpath. Never stat.
    os.path.realpath is patched for every caller (pathlib.resolve(strict=...) passes extra arguments and falls
    back); windows_paths' protected-path check may see answers up to SHARED_TTL old.
    """
    REPARSE_POINT = 0x400
    SHARED_TTL = 5.0  # seconds a folder's listing and real path are trusted
    SHARED_AFTER = 3  # calls for one folder before it is listed (a lone call keeps Windows' realpath)
    SHARED_FOLDERS = 4096  # folders kept
    SHARED_ENTRIES = 150000  # listed names kept

    def __init__(self, realpath=None, stat=None):
        self.original = realpath or ntpath.realpath
        self.original_stat = stat or os.stat
        self.original_islink = ntpath.islink
        self.local = threading.local()
        self.shared, self.shared_entries, self.shared_lock = collections.OrderedDict(), 0, threading.Lock()

    @contextlib.contextmanager
    def active(self, stat=False):
        self.local.folders, self.local.listings, self.local.stat = {}, {}, stat
        try:
            yield
        finally:
            self.local.folders = self.local.listings = None
            self.local.stat = False

    def _listing(self, folder):
        key = ntpath.normcase(folder)
        listing = self.local.listings.get(key)
        if listing is None:
            listing = {}
            try:
                with os.scandir(folder) as entries:
                    for entry in entries:
                        try:
                            plain = not entry.is_symlink() and not entry.stat(follow_symlinks=False).st_file_attributes & self.REPARSE_POINT
                        except OSError:
                            plain = False
                        listing[ntpath.normcase(entry.name)] = (entry.name, plain, entry)
            except OSError:
                pass
            self.local.listings[key] = listing
        return listing

    def _folder(self, folder):
        key = ntpath.normcase(folder)
        if key not in self.local.folders:
            self.local.folders[key] = self.original(folder)
        return self.local.folders[key]

    def _shared_drop(self, key):
        entry = self.shared.pop(key, None)
        if entry:
            self.shared_entries -= entry['count']

    def _shared_entry(self, folder, now):
        key = ntpath.normcase(folder)
        with self.shared_lock:
            entry = self.shared.get(key)
            if entry is None or now - entry['at'] > self.SHARED_TTL:
                self._shared_drop(key)
                while self.shared:  # oldest first: expired entries go, then the oldest live ones if still full
                    oldest = next(iter(self.shared))
                    if now - self.shared[oldest]['at'] <= self.SHARED_TTL and len(self.shared) < self.SHARED_FOLDERS                             and self.shared_entries < self.SHARED_ENTRIES:
                        break
                    self._shared_drop(oldest)
                entry = self.shared[key] = {'at': now, 'hits': 0, 'listing': None, 'real': None, 'count': 0,
                                            'lock': threading.Lock()}
            entry['hits'] += 1
            return entry

    def _shared_realpath(self, path, args, kwargs):
        """realpath for a thread outside an import, or None to use Windows' realpath."""
        if args or kwargs or not isinstance(path, (str, os.PathLike)):
            return None
        text = os.fspath(path)
        if not isinstance(text, str) or '..' in text:
            return None
        folder, name = ntpath.split(ntpath.abspath(text))
        if not name or name.endswith(('.', ' ')) or any(c in name for c in ':*?<>"|~'):
            return None
        entry = self._shared_entry(folder, time.monotonic())
        if entry['hits'] < self.SHARED_AFTER:
            return None
        with entry['lock']:
            if entry['listing'] is None:
                listing = {}
                try:
                    with os.scandir(folder) as entries:
                        for item in entries:
                            try:
                                plain = not item.is_symlink() and not item.stat(follow_symlinks=False).st_file_attributes & self.REPARSE_POINT
                            except OSError:
                                plain = False
                            listing[ntpath.normcase(item.name)] = (item.name, plain)
                    entry['real'] = self.original(folder)
                except OSError:
                    entry['real'], listing = None, {}
                entry['listing'] = listing
                with self.shared_lock:
                    if self.shared.get(ntpath.normcase(folder)) is entry:  # not evicted or replaced meanwhile
                        entry['count'] = len(listing)
                        self.shared_entries += entry['count']
        if entry['real'] is None:
            return None  # missing or unreadable folder: Windows' realpath (instant for a missing drive)
        found = entry['listing'].get(ntpath.normcase(name))
        if not found:
            if not name.isascii():
                return None  # Windows' case rules for other letters are its own
            return ntpath.join(entry['real'], name)  # a missing file: the folder's real path plus the name as given
        return ntpath.join(entry['real'], found[0]) if found[1] else None

    def __call__(self, path, *args, **kwargs):
        if getattr(self.local, 'folders', None) is None:
            try:
                shared = self._shared_realpath(path, args, kwargs)
            except (OSError, ValueError, TypeError):
                shared = None
            return self.original(path, *args, **kwargs) if shared is None else shared
        if not isinstance(path, (str, os.PathLike)):
            return self.original(path, *args, **kwargs)
        try:
            full = ntpath.abspath(os.fspath(path))
            folder, name = ntpath.split(full)
            if not name or not isinstance(full, str):
                return self.original(path, *args, **kwargs)
            found = self._listing(folder).get(ntpath.normcase(name))
            if not found or not found[1]:
                return self.original(path, *args, **kwargs)
            return ntpath.join(self._folder(folder), found[0])
        except (OSError, ValueError, TypeError):
            return self.original(path, *args, **kwargs)

    def islink(self, path):
        """os.path.islink in an active thread: whether the listing marks the entry as a symbolic link (the same
        answer as lstat; junctions are not links in either). AXIOM's library saves check every track twice."""
        if getattr(self.local, 'folders', None) is None or not isinstance(path, str):
            return self.original_islink(path)
        try:
            folder, name = ntpath.split(ntpath.abspath(path))
            found = self._listing(folder).get(ntpath.normcase(name)) if name else None
            if found:
                return found[2].is_symlink()
        except (OSError, ValueError, TypeError):
            pass
        return self.original_islink(path)

    def stat(self, path, *args, **kwargs):
        if args or kwargs or not getattr(self.local, 'stat', False) or not isinstance(path, str):
            return self.original_stat(path, *args, **kwargs)  # dir_fd / follow_symlinks / bytes / fd: as asked
        try:
            folder, name = ntpath.split(ntpath.abspath(path))
            found = self._listing(folder).get(ntpath.normcase(name)) if name else None
            if found and found[1] and not found[2].is_dir(follow_symlinks=False):
                return found[2].stat(follow_symlinks=False)
        except (OSError, ValueError, TypeError):
            pass
        return self.original_stat(path)


FAST_REALPATH = FastRealpath()


def install(app):
    if getattr(app, '_windows_intake_installed', False):
        return
    if os.path.realpath is not FAST_REALPATH:
        FAST_REALPATH.original = os.path.realpath
        os.path.realpath = FAST_REALPATH  # os.path is ntpath: the same function for every caller
    if getattr(os.path.islink, '__self__', None) is not FAST_REALPATH:
        FAST_REALPATH.original_islink = os.path.islink
        os.path.islink = FAST_REALPATH.islink
    import scanner
    original = app._run_add_folder_job
    sidecar = getattr(scanner, 'is_metadata_sidecar', lambda name: False)
    latest = {'job': None}

    def update(job_id, **values):
        app._set_add_folder_job(job_id, **values)

    def count(job_id, folder_path):
        try:
            excluded = app.get_excluded_folders() or []
        except Exception:
            excluded = []
        extensions = {ext.lower() for ext in scanner.SUPPORTED_FORMATS}
        update(job_id, counting=True, files_found=0)
        found, _ = count_music(folder_path, extensions, sidecar, excluded,
                               report=lambda n: update(job_id, files_found=n))
        update(job_id, counting=False, files_found=found, total=found)

    def run_add_folder_job(job_id, folder_path, *args, **kwargs):
        latest['job'] = job_id
        threading.Thread(target=count, args=(job_id, folder_path), name='peak-hour-import-count', daemon=True).start()
        with FAST_REALPATH.active():
            return original(job_id, folder_path, *args, **kwargs)

    original_set = app._set_add_folder_job

    def set_add_folder_job(job_id, **values):
        if values.get('library_ready') is True:  # step 2 restarts the file count: time it from here
            with app.ADD_FOLDER_JOBS_LOCK:
                first = not app.ADD_FOLDER_JOBS.get(job_id, {}).get('library_ready')
            if first:
                values.setdefault('step_started_at', time.time())
        return original_set(job_id, **values)

    app._run_add_folder_job = run_add_folder_job
    app._set_add_folder_job = set_add_folder_job

    bp = Blueprint('windows_intake', __name__)

    @bp.get('/api/windows/import-progress')
    def import_progress():
        job_id = latest['job']
        with app.ADD_FOLDER_JOBS_LOCK:
            job = dict(app.ADD_FOLDER_JOBS.get(job_id) or {}) if job_id else {}
        if not job:
            return jsonify(success=True, active=False)
        return jsonify(success=True, job_id=job_id, **progress(job))
    app.app.register_blueprint(bp)
    app._windows_intake_installed = True
