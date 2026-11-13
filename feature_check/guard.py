r"""Safety net for feature-check runs: an audit hook that keeps a Python process inside its sandbox.

Environment (all set by sandbox.py / check_features.py):
  FEATURE_CHECK_GUARD      'enforce' (default) or 'log'.
                           enforce: a write, create, delete or rename outside the allowed folders raises PermissionError,
                                    and a socket connect to a non-loopback address raises PermissionError.
                           log:     the same events are only recorded.
                           'off' (or '0') disables the hook.
  FEATURE_CHECK_SANDBOX    the sandbox folder (always writable).
  FEATURE_CHECK_ALLOW      extra writable folders, separated by os.pathsep (legacy tests write under the project's fixtures folder).
  FEATURE_CHECK_ALLOW_TMP  folder inside which direct children named tmp* may be written (tempfile.TemporaryDirectory(dir=root)).
  FEATURE_CHECK_GUARD_LOG  JSON-lines file every process appends its violations to; the report reads it.

Real-data mode (check_features.py --real, FEATURE_CHECK_REAL=1) changes the rules:
  FEATURE_CHECK_ALLOW      read-write roots: the backed-up files and folders (they are restored afterwards);
  FEATURE_CHECK_NEWONLY    create-only roots (export / output folders): a file may be created there, an existing file may not be
                           changed, and only a file made since FEATURE_CHECK_RUN_START may be removed or renamed;
  FEATURE_CHECK_VOLATILE   read-write roots that are not restored (logs, preview cache);
  FEATURE_CHECK_MEDIA_EXEMPT  folders where audio / video files may still be written (sandbox, preview cache);
  audio / video files (mp3 m4a aac flac wav aif aiff ogg opus wma mp4 m4v mov avi mkv vob mpg mpeg) can never be written,
  removed or renamed anywhere else: the event is logged as kind 'media-write' and checks report SKIP "would modify music files".
Created files: in real mode every create the guard allows under a read-write or create-only root is recorded in the guard log as
kind 'created' / 'created-dir' (blocked false). The restore removes only those recorded paths, and only into quarantine.
Never writable, in any mode: anything under fixtures\\feature-check\\real-backup-* (the owner's backups).
Always writable (normal mode): the sandbox, the project's fixtures\feature-check folder, anything under a __pycache__ folder,
device names (NUL, CON, \\.\pipe\...). Reads are never restricted.
Limits: Python-level only (a child program such as ffmpeg or Edge is not hooked, only its launcher is), and it
is a safety net against mistakes, not a security boundary.
"""
import os
import sys
import json
import time

_STATE = {'installed': False}
WRITE_FLAGS = getattr(os, 'O_WRONLY', 1) | getattr(os, 'O_RDWR', 2) | getattr(os, 'O_CREAT', 0x100) | getattr(os, 'O_APPEND', 8) | getattr(os, 'O_TRUNC', 0x200)
LOOPBACK = ('127.', '::1', 'localhost', '0.0.0.0', '::', '')
DEVICE_PREFIX = '\\\\.\\pipe\\'  # only named pipes; \\.\C:\... raw volume paths are not exempt
_STATE['check'] = None


def check_path(path, kind='write'):
    """For wrappers around writes the audit hook cannot see (ctypes shell calls): raises PermissionError like the hook would."""
    if _STATE['check'] is not None:
        _STATE['check'](path, kind)


def _norm(path):
    return os.path.normcase(os.path.abspath(path))


def _inside(path, roots):
    for root in roots:
        if path == root or path.startswith(root.rstrip('\\/') + os.sep):
            return True
    return False


def install(mode=None):
    if _STATE['installed']:
        return
    mode = (mode or os.environ.get('FEATURE_CHECK_GUARD') or 'enforce').strip().lower()
    if mode in ('off', '0', 'none'):
        return
    enforce = mode != 'log'
    roots = []
    for value in [os.environ.get('FEATURE_CHECK_SANDBOX', '')] + os.environ.get('FEATURE_CHECK_ALLOW', '').split(os.pathsep):
        if value.strip():
            roots.append(_norm(value))
    project = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    roots.append(_norm(os.path.join(project, 'fixtures', 'feature-check')))
    tmp_parent = os.environ.get('FEATURE_CHECK_ALLOW_TMP', '')
    tmp_parent = _norm(tmp_parent) if tmp_parent.strip() else None
    log_path = os.environ.get('FEATURE_CHECK_GUARD_LOG', '')
    log_fd = None
    if log_path:
        try:
            log_fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
        except OSError:
            log_fd = None
    real = os.environ.get('FEATURE_CHECK_REAL') == '1'

    def roots_of(name):
        return [_norm(v) for v in os.environ.get(name, '').split(os.pathsep) if v.strip()]

    rw_roots = roots_of('FEATURE_CHECK_ALLOW') + roots_of('FEATURE_CHECK_VOLATILE') if real else []
    new_roots = roots_of('FEATURE_CHECK_NEWONLY') if real else []
    media_exempt = [_norm(os.environ['FEATURE_CHECK_SANDBOX'])] if os.environ.get('FEATURE_CHECK_SANDBOX') else []
    media_exempt += roots_of('FEATURE_CHECK_MEDIA_EXEMPT')
    try:
        run_start = float(os.environ.get('FEATURE_CHECK_RUN_START', '0'))
    except ValueError:
        run_start = 0.0
    backups_root = _norm(os.path.join(project, 'fixtures', 'feature-check'))
    created_here = set()
    media_ext = ('.mp3', '.m4a', '.aac', '.flac', '.wav', '.aif', '.aiff', '.ogg', '.opus', '.wma', '.mp4', '.m4v', '.mov', '.avi', '.mkv', '.vob', '.mpg', '.mpeg')
    pid = os.getpid()
    counts = {}

    def in_backup(full):
        if not _inside(full, [backups_root]):
            return False
        rest = full[len(backups_root):].lstrip('\\/').split(os.sep)[0]
        return rest.startswith('real-backup-')

    def refusal(path, kind):
        """None when the operation is fine, else the label to record ('media-write' or the kind). Real mode only."""
        if isinstance(path, int) or path is None:
            return None
        if isinstance(path, bytes):
            path = os.fsdecode(path)
        path = os.fspath(path)
        if path.lower().startswith(DEVICE_PREFIX) or path.upper() in ('NUL', 'CON', 'CONIN$', 'CONOUT$'):
            return None
        full = _norm(path)
        if in_backup(full):
            return 'backup-write'
        if full.endswith(media_ext) and kind not in ('mkdir', 'rmdir') and not _inside(full, media_exempt):
            return 'media-write'
        if '__pycache__' in full.split(os.sep) or _inside(full, roots) or _inside(full, rw_roots):
            return None
        if _inside(full, new_roots):
            if kind in ('mkdir', 'dst'):
                return None if not os.path.exists(full) else kind
            if not os.path.exists(full):
                return None  # a create (or an operation that fails by itself)
            if full in created_here:
                return None
            try:
                return None if os.path.getmtime(full) >= run_start - 2 else kind + '-old'
            except OSError:
                return None
        return kind

    def allowed(path, kind='write'):
        if real:
            return refusal(path, kind) is None
        return plain_allowed(path)

    def plain_allowed(path):
        if isinstance(path, int) or path is None:
            return True
        if isinstance(path, bytes):
            path = os.fsdecode(path)
        path = os.fspath(path)
        if path.lower().startswith(DEVICE_PREFIX) or path.upper() in ('NUL', 'CON', 'CONIN$', 'CONOUT$'):
            return True
        full = _norm(path)
        if in_backup(full):
            return False
        if '__pycache__' in full.split(os.sep) or _inside(full, roots):
            return True
        if tmp_parent and _inside(full, [tmp_parent]):
            first = full[len(tmp_parent):].lstrip('\\/').split(os.sep)[0]
            if first.startswith('tmp'):
                return True
        return False

    def record(kind, detail):
        key = (kind, detail)
        counts[key] = counts.get(key, 0) + 1
        if counts[key] > 3 or log_fd is None:
            return
        line = json.dumps({'t': round(time.time(), 3), 'pid': pid, 'argv': ' '.join(sys.argv)[:120], 'mode': 'enforce' if enforce else 'log',
                           'kind': kind, 'detail': detail, 'blocked': enforce}) + '\n'
        try:
            os.write(log_fd, line.encode('utf-8'))
        except OSError:
            pass

    watched = (roots_of('FEATURE_CHECK_ALLOW') + roots_of('FEATURE_CHECK_NEWONLY')) if real else []

    def note_create(path, kind):
        """Real mode: remember (in the log, for every process) a file or folder this run is about to create in a watched root."""
        if not real or isinstance(path, int) or path is None:
            return
        try:
            full = _norm(os.fsdecode(os.fspath(path)))
            if not _inside(full, watched) or os.path.exists(full):
                return
            created_here.add(full)
            if log_fd is not None:
                os.write(log_fd, (json.dumps({'t': round(time.time(), 3), 'pid': pid, 'kind': kind, 'detail': os.path.abspath(os.fsdecode(os.fspath(path))),
                                              'blocked': False}) + '\n').encode('utf-8'))
        except Exception:
            pass

    def violate(kind, detail):
        if real and kind in ('write', 'remove', 'rmdir', 'mkdir', 'truncate', 'rename-from', 'dst'):
            label = refusal(detail, {'write': 'write'}.get(kind, kind))
            kind = label or kind
        record(kind, detail)
        if enforce:
            raise PermissionError('feature-check guard blocked %s: %s' % (kind, detail))

    def hook(event, args):
        try:
            if event == 'open':
                path, mode_, flags = (list(args) + [None, None])[:3]
                if isinstance(path, int):
                    return
                writing = isinstance(mode_, str) and any(c in mode_ for c in 'wax+')
                if isinstance(flags, int) and flags & WRITE_FLAGS:
                    writing = True
                if writing and not allowed(path, 'write'):
                    violate('write', str(path))
                elif writing:
                    note_create(path, 'created')
            elif event in ('os.remove', 'os.rmdir', 'os.mkdir', 'os.truncate', 'os.utime', 'os.chmod'):
                kind = {'utime': 'write', 'chmod': 'write'}.get(event[3:], event[3:])
                if not allowed(args[0], kind):
                    violate(kind, str(args[0]))
                elif event == 'os.mkdir':
                    note_create(args[0], 'created-dir')
            elif event in ('os.rename', 'os.link', 'shutil.move', 'shutil.copyfile', 'shutil.copy', 'shutil.copy2'):
                src, dst = args[0], args[1]
                if event in ('os.rename', 'shutil.move') and not allowed(src, 'rename-from'):
                    violate('rename-from', str(src))
                if not allowed(dst, 'dst' if event in ('os.rename', 'shutil.move', 'os.link') else 'write'):
                    violate('dst' if event in ('os.rename', 'shutil.move', 'os.link') else 'write', str(dst))
                else:
                    note_create(dst, 'created')
            elif event == 'os.symlink':
                if not allowed(args[1]):
                    violate('symlink', str(args[1]))
            elif event == 'sqlite3.connect':
                db = str(args[0])
                if db != ':memory:' and not db.startswith('file::memory') and 'mode=ro' not in db and 'immutable=1' not in db:
                    if db.startswith('file:'):
                        from urllib.parse import unquote, urlsplit
                        parts = urlsplit(db)          # file:///C:/x%20y.db -> C:/x y.db (as sqlite itself reads it)
                        db = unquote(parts.path)
                        if len(db) > 2 and db[0] == '/' and db[2] == ':':
                            db = db[1:]
                        if parts.netloc and parts.netloc != 'localhost':
                            db = '//' + parts.netloc + db
                    if db and not allowed(db):
                        violate('sqlite', db)
            elif event == 'socket.connect':
                address = args[1]
                if not isinstance(address, tuple) or not address:
                    return  # pipe-style address
                host = address[0]
                if isinstance(host, bytes):
                    host = host.decode('ascii', 'replace')
                if not any(host == p or (p.endswith('.') and host.startswith(p)) for p in LOOPBACK):
                    violate('network', '%s:%s' % (host, address[1] if len(address) > 1 else ''))
        except PermissionError:
            raise
        except Exception:
            pass  # a hook bug must never break the program under test

    def explicit_check(path, kind='write'):
        if not allowed(path, kind):
            violate(kind, str(path))
        elif kind in ('write', 'dst'):
            note_create(path, 'created')

    _STATE['check'] = explicit_check
    sys.addaudithook(hook)
    _STATE['installed'] = True


def read_log(path):
    """Violations recorded in a guard log file (list of dicts)."""
    out = []
    try:
        with open(path, encoding='utf-8') as handle:
            for line in handle:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        pass
    return out

