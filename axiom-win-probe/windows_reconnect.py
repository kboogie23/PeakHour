"""Reconnect Music: relink songs whose files moved, by file name, inside a folder or drive the user picks.

AXIOM's Health "Missing File" repair (/api/library/remap_root) swaps a path prefix typed by hand. That cannot
handle music that moved into different folders, so on Windows the Reconnect Music buttons use this instead:

1. the user picks a folder or drive (the Windows folder chooser in windows_dialogs, through app.choose_folder_dialog);
2. a background job lists every media file under it by lower-cased name (os.scandir, junctions and symbolic links
   are not followed, the Recycle Bin and similar folders are skipped);
3. the library is read once, the songs whose file is missing are found with windows_virtualdj_library.file_checker
   (one directory listing per folder, not one call per song), and each is matched by file name:
   exactly one file with that name -> relinked; several -> left alone ("ambiguous") unless the song knows its file
   size and exactly one candidate has that size; none -> "not found";
4. the relinks are written the way AXIOM writes its library: under AXIOM's Health commit lock, re-reading the
   library first so nothing another writer saved meanwhile is lost, with a timestamped copy of library_cache.json
   kept next to it (newest 3 kept) and utils.file_ops.safe_write_json (file lock + atomic replace).

Only path, filename, folder and needs_relink change on a relinked song. Cached BPM, key, cues and every other
field stay as they were. Nothing is ever written to the music files or the chosen folder.

Routes (this PC only; /api/windows/ is already refused for laptop engines by windows_remote_hub):
  POST /api/windows/library/reconnect/choose   -> {folder} or {cancelled: true}
  POST /api/windows/library/reconnect/start    {folder} -> returns at once; the work runs in a daemon thread
  GET  /api/windows/library/reconnect/status   -> job counters, answered from memory (no library read)
  POST /api/windows/library/reconnect/cancel
"""
import glob
import logging
import ntpath
import os
import shutil
import threading
import time
import unicodedata

from flask import Blueprint, jsonify, request

from windows_paths import _LOCAL_DRIVES, _drive_type
from windows_virtualdj_library import MEDIA_EXTENSIONS, file_checker

LOG = logging.getLogger('peak-hour.reconnect')
ROUTE = '/api/windows/library/reconnect'
SKIP_FOLDERS = {'$recycle.bin', 'system volume information', '.spotlight-v100', '.trashes', '.fseventsd', '.temporaryitems'}
ACTIVE = ('indexing', 'matching', 'saving')
BUSY_STATUSES = {'running', 'queued', 'starting', 'stopping', 'paused'}  # AXIOM's job states while a job is working
SIZE_FIELDS = ('file_size', 'filesize', 'size_bytes', 'size')
BACKUPS_KEPT = 3
# A missing song whose only match is a file that already is another song in the library is left alone (counted as
# in_library): linking it would give two library rows the same path. Set True to link it anyway.
RELINK_ONTO_EXISTING_SONG = False
MAX_CANDIDATES = 50  # candidates kept per file name; more than this is ambiguous anyway


def on_laptop():
    return bool(os.environ.get('AXIOM_DEVICE_ID'))


def protected_folders():
    keys = ('SystemRoot', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'APPDATA', 'LOCALAPPDATA')
    found = set()
    for key in keys:
        value = os.environ.get(key)
        if value:
            found.add(ntpath.normcase(os.path.realpath(value)))
    return found


def folder_problem(app, value):
    """Why PEAK HOUR will not search this folder, or None when it may."""
    if not isinstance(value, str) or not value.strip():
        return 'Choose the folder or drive where your music is now.'
    value = value.strip()
    if value.startswith('\\\\') or not ntpath.isabs(value):
        return 'Choose a folder or drive on this PC.'
    if not os.path.isdir(value):
        return 'That folder was not found. Check that the drive is connected.'
    real = os.path.realpath(value)
    drive, tail = ntpath.splitdrive(real)
    if tail in ('', '\\', '/'):  # a whole drive: windows_paths.is_safe_location refuses roots, so apply its drive rule here
        if len(drive) != 2 or _drive_type(drive + '\\') not in _LOCAL_DRIVES:
            return 'Choose a drive that is connected to this PC.'
        return None
    if not app.is_safe_location(value) or not os.path.isdir(real):
        return 'PEAK HOUR will not search that folder. Choose the folder or drive where your music is.'
    return None


def media_extensions(app):
    extensions = set(MEDIA_EXTENSIONS)
    for name in ('BUILD_FOLDER_AUDIO_EXTS', 'SUPPORTED_FORMATS'):
        extensions.update(str(e).lower() for e in getattr(app, name, ()) or ())
    return extensions


def index_folder(root, extensions, skip, cancelled, progress):
    """{file name key: [full paths]} for the media files under root. Junctions and symbolic links are not entered
    (other reparse points, such as OneDrive placeholder folders, are ordinary folders and are searched)."""
    names, stack = {}, [root]
    while stack:
        if cancelled():
            return None
        folder = stack.pop()
        try:
            with os.scandir(folder) as entries:
                for entry in entries:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            if (entry.is_junction() or entry.is_symlink()
                                    or entry.name.lower() in SKIP_FOLDERS or ntpath.normcase(entry.path) in skip):
                                continue
                            stack.append(entry.path)
                        elif entry.is_file(follow_symlinks=False) and ntpath.splitext(entry.name)[1].lower() in extensions:
                            found = names.setdefault(name_key(entry.name), [])
                            if len(found) < MAX_CANDIDATES:
                                found.append(entry.path)
                            progress()
                    except OSError:
                        continue
        except OSError:
            continue  # a folder that cannot be listed (permissions, removed meanwhile) is skipped
    return names


def name_key(name):
    """How file names are compared: NFC (a macOS library may hold decomposed accents, NTFS keeps names as written), lower-cased."""
    return unicodedata.normalize('NFC', name).lower()


def track_name(track):
    """The file name a song is looked up by: its path's last part, or its filename when the path is a folder."""
    path = str(track.get('path') or '')
    name = ntpath.basename(path)
    if ntpath.splitext(name)[1] == '' and ntpath.splitext(str(track.get('filename') or ''))[1]:
        name = str(track.get('filename'))
    return name_key(name)


def known_size(track):
    for field in SIZE_FIELDS:
        value = track.get(field)
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            return value
    return None


def pick_by_size(track, candidates):
    size = known_size(track)
    if size is None:
        return None
    same = []
    for path in candidates:
        try:
            if os.stat(path).st_size == size:
                same.append(path)
        except OSError:
            continue
    return same[0] if len(same) == 1 else None


def relink_fields(track, new_path):
    track['path'] = new_path
    track['filename'] = ntpath.basename(new_path)
    track['folder'] = ntpath.basename(ntpath.dirname(new_path))
    track['needs_relink'] = False


class ReconnectJob:
    def __init__(self, app, chooser=None):
        self.app = app
        self.chooser = chooser
        self.lock = threading.Lock()
        self.cancel = threading.Event()
        self.thread = None
        self.reset()

    def reset(self, **values):
        self.state = {'state': 'idle', 'folder': '', 'files_indexed': 0, 'checked': 0, 'total': 0, 'missing': 0, 'relinked': 0,
                      'ambiguous': 0, 'not_found': 0, 'in_library': 0, 'message': '', 'error': ''}
        self.state.update(values)

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def set(self, **values):
        with self.lock:
            self.state.update(values)

    def busy_reason(self):
        """Why the library cannot be changed right now, or None."""
        app = self.app
        with self.lock:
            if self.state['state'] in ACTIVE:
                return 'PEAK HOUR is already reconnecting your music.'
        if str(getattr(app, 'UNIFIED_HEALTH_JOB', {}).get('status') or '').lower() in BUSY_STATUSES:
            return 'A Health check is running. Wait for it to finish or stop it, then reconnect your music.'
        if getattr(app, '_library_reset_in_progress', lambda: False)():
            return 'The library is being reset. Try again when that has finished.'
        lock = getattr(app, 'ADD_FOLDER_JOBS_LOCK', None)
        jobs = getattr(app, 'ADD_FOLDER_JOBS', {})
        serato = getattr(app, 'SERATO_CONNECT_JOBS', {})
        for table, table_lock in ((jobs, lock), (serato, getattr(app, 'SERATO_CONNECT_JOBS_LOCK', None))):
            with (table_lock or threading.Lock()):
                if any(str(j.get('status') or '').lower() in BUSY_STATUSES for j in list(table.values()) if isinstance(j, dict)):
                    return 'Music is being added to PEAK HOUR. Wait for it to finish, then reconnect your music.'
        return None

    def start(self, folder):
        """Returns (ok, message). Validates, then runs the job in a daemon thread."""
        if on_laptop():
            return False, 'Reconnect Music runs on the PC that holds the library.'
        problem = folder_problem(self.app, folder)
        if problem:
            return False, problem
        reason = self.busy_reason()
        if reason:
            return False, reason
        folder = os.path.normpath(os.path.abspath(folder.strip()))
        with self.lock:
            if self.state['state'] in ACTIVE:  # two clicks at once: the second is refused
                return False, 'PEAK HOUR is already reconnecting your music.'
            self.cancel.clear()
            self.reset(state='indexing', folder=folder, message='Looking through the folder')
            self.thread = threading.Thread(target=self.run, args=(folder,), name='peak-hour-reconnect', daemon=True)
        self.thread.start()
        return True, ''

    def request_cancel(self):
        self.cancel.set()
        with self.lock:
            if self.state['state'] in ('indexing', 'matching'):
                self.state['message'] = 'Stopping'
            return self.state['state']

    def run(self, folder):
        try:
            self.work(folder)
        except Exception as error:  # a background thread must report, not vanish
            LOG.exception('Reconnect Music failed')
            text = str(error) if isinstance(error, RuntimeError) else 'Reconnect Music stopped before it finished (%s). Your library was not changed.' % (error,)
            self.set(state='failed', error=text, message='')

    def stopped(self):
        self.set(state='cancelled', message='Stopped. Your library was not changed.')

    def work(self, folder):
        app = self.app
        counter = [0]

        def progress():
            counter[0] += 1
            if counter[0] % 200 == 0:
                self.state['files_indexed'] = counter[0]  # plain store: the status route only reads

        names = index_folder(folder, media_extensions(app), protected_folders(), self.cancel.is_set, progress)
        if names is None:
            return self.stopped()
        self.set(files_indexed=counter[0], state='matching', message='Matching your songs by file name')
        cache = app.load_cache(app.CACHE_PATH)
        tracks = cache.get('tracks') or []
        self.set(total=len(tracks))
        isfile = file_checker()
        moves, counts = {}, {'missing': 0, 'ambiguous': 0, 'not_found': 0, 'in_library': 0}
        present = set()
        missing = []
        for number, track in enumerate(tracks):
            if number % 500 == 0:
                if self.cancel.is_set():
                    return self.stopped()
                self.set(checked=number)
            path = track.get('path') if isinstance(track, dict) else None
            if not isinstance(path, str) or not path:
                continue
            if isfile(path):
                present.add(ntpath.normcase(path))
            else:
                missing.append(track)
        self.set(checked=len(tracks))
        counts['missing'] = len(missing)
        claims, picks = {}, []
        for track in missing:
            candidates = names.get(track_name(track)) or []
            chosen = candidates[0] if len(candidates) == 1 else pick_by_size(track, candidates) if candidates else None
            if not candidates:
                counts['not_found'] += 1
            elif chosen is None:
                counts['ambiguous'] += 1
            elif not RELINK_ONTO_EXISTING_SONG and ntpath.normcase(chosen) in present:
                counts['in_library'] += 1  # that file is already a song in the library: do not add a second entry for it
            else:
                picks.append((track['path'], chosen))
                claims.setdefault(ntpath.normcase(chosen), set()).add(track['path'])
        for old, new in picks:
            if len(claims[ntpath.normcase(new)]) > 1:
                counts['ambiguous'] += 1  # two missing songs name the same file: which one it is cannot be told
            else:
                moves[old] = new
        self.set(missing=counts['missing'], ambiguous=counts['ambiguous'], not_found=counts['not_found'], in_library=counts['in_library'])
        relinked = 0
        if moves:
            if self.cancel.is_set():
                return self.stopped()
            self.set(state='saving', message='Saving your library')
            relinked = self.commit(moves)
        self.set(state='done', relinked=relinked, message=self.summary(relinked))

    def commit(self, moves):
        """Apply {old path: new path} to a fresh copy of the library; returns songs relinked.

        Locks, in the order Health's own cache commit takes them: AXIOM's commit lock, then the read-modify-write
        lock file_lock(CACHE_PATH + '.edit') that add-folder, metadata edits and Health removals also hold while they
        re-read and save, so nothing they save can fall between this re-read and the write.
        AXIOM's search snapshot needs no reset: it keys itself on os.stat(CACHE_PATH) (mtime and size), which the
        write changes."""
        app = self.app
        lock = getattr(app, 'UNIFIED_HEALTH_COMMIT_LOCK', None) or threading.RLock()
        with lock, app.file_lock(app.CACHE_PATH + '.edit'):
            reason = self.busy_reason_for_commit()
            if reason:
                raise RuntimeError(reason)
            cache = app.load_cache(app.CACHE_PATH)  # re-read: another writer may have saved since the first read
            tracks = [t for t in cache.get('tracks') or [] if isinstance(t, dict)]
            isfile = file_checker()
            taken = {ntpath.normcase(t['path']) for t in tracks if isinstance(t.get('path'), str)}
            allowed = {}
            for old, new in moves.items():  # things may have changed since the first look
                if isfile(old) or not isfile(new) or (not RELINK_ONTO_EXISTING_SONG and ntpath.normcase(new) in taken):
                    continue
                allowed[old] = new
            changed = 0
            for track in tracks:
                new_path = allowed.get(track.get('path'))
                if new_path:
                    relink_fields(track, new_path)
                    changed += 1
            if changed:
                self.backup()
                app.safe_write_json(app.CACHE_PATH, cache, make_backup=False)  # file lock + atomic replace; the copy above is the backup
            return changed

    def busy_reason_for_commit(self):
        status = str(getattr(self.app, 'UNIFIED_HEALTH_JOB', {}).get('status') or '').lower()
        if status in BUSY_STATUSES:
            return 'A Health check started while PEAK HOUR was reconnecting. Nothing was changed. Try again when it has finished.'
        return None

    def backup(self):
        path = self.app.CACHE_PATH
        if not os.path.exists(path):
            return
        stamp = time.strftime('%Y%m%d_%H%M%S')
        base = os.path.join(os.path.dirname(path), 'library_cache.reconnect_backup.')
        target, number = '%s%s.json' % (base, stamp), 1
        while os.path.exists(target):  # two reconnects in one second
            number += 1
            target = '%s%s_%d.json' % (base, stamp, number)
        partial = target + '.part'
        try:
            with self.app.file_lock(path):  # no writer is mid-save while the copy is made; released before the real write
                shutil.copyfile(path, partial)
            os.replace(partial, target)
        finally:
            if os.path.exists(partial):
                os.remove(partial)
        old = sorted(glob.glob(glob.escape(base) + '*.json'), key=lambda p: (os.path.getmtime(p), p), reverse=True)
        for stale in old[BACKUPS_KEPT:]:
            try:
                os.remove(stale)
            except OSError:
                LOG.warning('Could not remove old backup %s', stale)

    def summary(self, relinked):
        state = self.snapshot()
        parts = ['Reconnected %s song%s.' % (format(relinked, ','), '' if relinked == 1 else 's')]
        if state['ambiguous']:
            parts.append('%s could not be matched (same name in several places).' % format(state['ambiguous'], ','))
        if state['in_library']:
            parts.append('%s %s already in your library at the new location.' % (format(state['in_library'], ','), 'is' if state['in_library'] == 1 else 'are'))
        if state['not_found']:
            parts.append('%s %s not in this folder.' % (format(state['not_found'], ','), 'is' if state['not_found'] == 1 else 'are'))
        return ' '.join(parts)


def create_blueprint(job):
    bp = Blueprint('windows_reconnect', __name__)

    @bp.post(ROUTE + '/choose')
    def choose():
        if on_laptop():
            return jsonify(success=False, error='Reconnect Music runs on the PC that holds the library.'), 403
        chooser = job.chooser or job.app.choose_folder_dialog
        try:
            result = chooser('Choose the folder or drive where your music is now')
        except Exception:
            LOG.exception('Folder chooser failed')
            return jsonify(success=False, error='The folder chooser could not open.'), 500
        folder, cancelled = result if isinstance(result, tuple) else (result, not result)
        if cancelled or not folder:
            return jsonify(success=True, cancelled=True)
        return jsonify(success=True, folder=str(folder))

    @bp.post(ROUTE + '/start')
    def start():
        data = request.get_json(silent=True) or {}
        ok, message = job.start(data.get('folder') if isinstance(data, dict) else None)
        if not ok:
            return jsonify(success=False, error=message), 409 if 'already' in message or 'running' in message else 400
        return jsonify(success=True, **job.snapshot())

    @bp.get(ROUTE + '/status')
    def status():
        return jsonify(success=True, **job.snapshot())

    @bp.post(ROUTE + '/cancel')
    def cancel():
        return jsonify(success=True, state=job.request_cancel())
    return bp


def install(app, chooser=None, job_factory=ReconnectJob):
    if getattr(app, '_windows_reconnect_installed', False):
        return app.WINDOWS_RECONNECT
    app.WINDOWS_RECONNECT = job_factory(app, chooser)
    app.app.register_blueprint(create_blueprint(app.WINDOWS_RECONNECT))
    app._windows_reconnect_installed = True
    return app.WINDOWS_RECONNECT
