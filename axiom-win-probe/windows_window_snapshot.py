r"""Window data snapshot: the page's own data (Studio drafts in IndexedDB, settings in localStorage) saved by the app itself.

The window's browser profile is not a safe thing to copy (Edge --app profile today, a native window with another profile
folder tomorrow, a random port = another origin when 8080 is busy). So the page reads its data and uploads it here, and a
fresh profile reads it back (static/js/shared/windows-window-snapshot.js).

    <data>\window-data-snapshot\
        snap-<time>-<id>\             a COMPLETE snapshot (only ever created by renaming a finished building folder)
            manifest.json             schema version, origin, created, per-store counts, per-record sha256 + size, total bytes
            records\<sha256>.rec      one file per IndexedDB record, named by the SHA-256 of its own bytes
            localstorage.json         the localStorage map
            schema.json               databases, object stores, indexes (to recreate what the app has not created yet)
            verify.json               the page's post-import report (not part of the manifest)
        building-<id>\                an upload in progress; removed when stale; never counted as a snapshot
        status.json                   last failure, kept across restarts

A snapshot is complete only when manifest.json exists and every file it lists is present with the listed size (a deep check
also re-hashes). The previous complete snapshot stays until a new one is committed; then at most 2 older ones are kept.
Nothing outside the snapshot folder is ever deleted, and no name from the page is used as a path (ids and hashes are
matched against fixed patterns).

A record file is: b'PHR1' + uint32 BE header length + header JSON + the binary parts the header lists (blobs, buffers).
The server treats it as opaque bytes: it streams the body to disk in 1 MB blocks, hashing as it goes, and refuses a body whose
SHA-256 differs from the one the page announced."""
import base64
import errno
import hashlib
import json
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path

SCHEMA_VERSION = 1
FOLDER = 'window-data-snapshot'
MAX_RECORD = 1 << 30            # one record (a draft, or a take with its audio): 1 GiB
MAX_TOTAL = 16 << 30            # one snapshot: 16 GiB
MAX_RECORDS = 200000
MAX_SMALL = 32 << 20            # localStorage map, schema, commit list
MAX_META = 16 << 10
KEEP_OLD = 2
STALE_BUILDING_SECONDS = 600
BLOCK = 1 << 20
SPARE_BYTES = 256 << 20         # always leave this much free on the disk

ID = re.compile(r'^[0-9a-f]{16}$')
SHA = re.compile(r'^[0-9a-f]{64}$')
SNAP = re.compile(r'^snap-\d{16}-[0-9a-f]{16}$')
BUILDING = re.compile(r'^building-[0-9a-f]{16}$')


class SnapshotError(Exception):
    def __init__(self, message, status=400, code='bad_request'):
        super().__init__(message)
        self.status = status
        self.code = code


def long_path(path):
    """The extended-length form on Windows, so a long user name or data folder cannot push a record's path past 260 characters."""
    prefix = '\\\\?\\'
    path = os.path.abspath(str(path))
    if os.name != 'nt' or path.startswith(prefix):
        return Path(path)
    return Path(prefix + 'UNC\\' + path[2:]) if path.startswith('\\\\') else Path(prefix + path)


def disk_full(error):
    return isinstance(error, OSError) and (error.errno == errno.ENOSPC or getattr(error, 'winerror', None) in (112, 39))


FULL_MESSAGE = 'The disk is full, so PEAK HOUR could not save the backup of your Studio drafts. Free some space and try again.'


def _sha_file(path, block=BLOCK):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        while True:
            data = stream.read(block)
            if not data:
                return digest.hexdigest()
            digest.update(data)


def _write_json_atomic(path, data):
    path = Path(path)
    temp = path.with_name(path.name + '.%s.tmp' % uuid.uuid4().hex[:8])
    try:
        with open(temp, 'w', encoding='utf-8') as stream:
            json.dump(data, stream, separators=(',', ':'))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    except BaseException:
        try:
            temp.unlink()
        except OSError:
            pass
        raise


def _remove_tree(folder, root):
    """Delete a folder only when it is a direct, non-link child of the snapshot folder."""
    folder = Path(folder)
    if folder.parent != Path(root) or folder.is_symlink() or not (SNAP.match(folder.name) or BUILDING.match(folder.name)):
        return
    shutil.rmtree(folder, ignore_errors=True)


def identity(db, store, key):
    return json.dumps([db, store, key], separators=(',', ':'), sort_keys=True, ensure_ascii=False)


class Snapshots:
    def __init__(self, root_provider):
        self._root = root_provider
        self.lock = threading.RLock()
        self.active = {}        # building id -> {'dir', 'bytes', 'records': {sha: meta}, 'touched', 'origin'}

    # ---------------------------------------------------------------- places
    def root(self):
        root = long_path(Path(self._root()) / FOLDER)
        root.mkdir(parents=True, exist_ok=True)
        if root.is_symlink():
            raise SnapshotError('The snapshot folder is not a normal folder.', 500, 'bad_folder')
        return root

    def _status_file(self):
        return self.root() / 'status.json'

    def _read_status(self):
        try:
            return json.loads(self._status_file().read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return {}

    def _write_status(self, **changes):
        data = self._read_status()
        data.update(changes)
        try:
            _write_json_atomic(self._status_file(), data)
        except OSError:
            pass

    # ---------------------------------------------------------------- reading what exists
    def _manifest(self, folder):
        try:
            data = json.loads((Path(folder) / 'manifest.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) and data.get('version') == SCHEMA_VERSION and isinstance(data.get('records'), list) else None

    def check(self, folder, deep=False):
        """(manifest, problems): a snapshot is complete when problems is empty."""
        folder = Path(folder)
        manifest = self._manifest(folder)
        if manifest is None:
            return None, ['manifest.json is missing or unreadable']
        problems = []
        for record in manifest['records']:
            path = folder / 'records' / (record['sha256'] + '.rec')
            try:
                size = path.stat().st_size
            except OSError:
                problems.append('missing ' + record['sha256'])
                continue
            if size != record['size']:
                problems.append('size ' + record['sha256'])
            elif deep and _sha_file(path) != record['sha256']:
                problems.append('hash ' + record['sha256'])
        for name in ('localstorage', 'schema'):
            entry = (manifest.get('parts') or {}).get(name)
            if not entry:
                problems.append(name + ' is not listed')
                continue
            path = folder / (name + '.json')
            try:
                size = path.stat().st_size
            except OSError:
                problems.append('missing ' + name)
                continue
            if size != entry['size']:
                problems.append('size ' + name)
            elif deep and _sha_file(path) != entry['sha256']:
                problems.append('hash ' + name)
        return manifest, problems

    def snapshots(self):
        """Folders of committed snapshots, newest first (by name: it starts with the commit time)."""
        root = self.root()
        folders = [p for p in root.iterdir() if SNAP.match(p.name) and p.is_dir() and not p.is_symlink()]
        return sorted(folders, key=lambda p: p.name, reverse=True)

    def latest_complete(self, deep=False):
        for folder in self.snapshots():
            manifest, problems = self.check(folder, deep)
            if not problems:
                return folder, manifest
        return None, None

    def summary(self, folder, manifest):
        stores = {}
        for record in manifest['records']:
            name = record['db'] + '/' + record['store']
            stores[name] = stores.get(name, 0) + 1
        try:
            verify = json.loads((folder / 'verify.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            verify = None
        return {'id': folder.name, 'created': manifest.get('created'), 'origin': manifest.get('origin'), 'records': len(manifest['records']),
                'stores': stores, 'total_bytes': manifest.get('total_bytes', 0), 'local_storage_keys': manifest.get('local_storage_keys', 0),
                'databases': manifest.get('databases', []), 'verify': verify}

    def status(self):
        with self.lock:
            folder, manifest = self.latest_complete()
            stored = self._read_status()
            return {'complete': bool(folder), 'snapshot': self.summary(folder, manifest) if folder else None,
                    'last_failure': stored.get('last_failure'), 'building': len(self.active), 'snapshots_kept': len(self.snapshots()),
                    'schema': SCHEMA_VERSION}

    # ---------------------------------------------------------------- writing a new one
    def begin(self, origin, estimate):
        if not isinstance(origin, str) or not origin or len(origin) > 200:
            raise SnapshotError('The page did not say which address it is running at.')
        estimate = estimate if isinstance(estimate, int) and not isinstance(estimate, bool) and estimate >= 0 else 0
        if estimate > MAX_TOTAL:
            raise SnapshotError('Your Studio data is %.1f GB, more than the %d GB a backup can hold.' % (estimate / 1e9, MAX_TOTAL >> 30), 413, 'too_big')
        with self.lock:
            root = self.root()
            now = time.time()
            for folder in root.iterdir():  # interrupted uploads: only ever building-* folders, only when nothing touched them lately
                if BUILDING.match(folder.name) and folder.is_dir() and folder.name[9:] not in self.active:
                    try:
                        age = now - folder.stat().st_mtime
                    except OSError:
                        continue
                    if age > STALE_BUILDING_SECONDS:
                        _remove_tree(folder, root)
            for key, job in list(self.active.items()):
                if now - job['touched'] > STALE_BUILDING_SECONDS:
                    self.active.pop(key)
                    _remove_tree(job['dir'], root)
            free = shutil.disk_usage(root).free
            if free < estimate + SPARE_BYTES:
                raise SnapshotError(FULL_MESSAGE + ' (%.1f GB needed, %.1f GB free.)' % ((estimate + SPARE_BYTES) / 1e9, free / 1e9), 507, 'disk_full')
            snapshot_id = uuid.uuid4().hex[:16]
            folder = root / ('building-' + snapshot_id)
            try:
                (folder / 'records').mkdir(parents=True)
            except OSError as error:
                raise SnapshotError(FULL_MESSAGE if disk_full(error) else 'The snapshot folder could not be created: %s' % error, 507 if disk_full(error) else 500, 'disk_full' if disk_full(error) else 'io')
            self.active[snapshot_id] = {'dir': folder, 'bytes': 0, 'records': {}, 'touched': now, 'origin': origin, 'small': {}}
            previous, manifest = self.latest_complete()
            known = [{'db': r['db'], 'store': r['store'], 'key': r['key'], 'sha256': r['sha256'], 'size': r['size'], 'fp': r.get('fp')}
                     for r in manifest['records']] if manifest else []
            return {'snapshot_id': snapshot_id, 'previous': {'id': previous.name, 'records': known} if previous else None}

    def _job(self, snapshot_id):
        job = self.active.get(snapshot_id) if isinstance(snapshot_id, str) and ID.match(snapshot_id) else None
        if job is None:
            raise SnapshotError('This backup is not in progress any more. Start it again.', 404, 'unknown_snapshot')
        job['touched'] = time.time()
        return job

    def put_record(self, snapshot_id, meta, stream, length):
        """Stream the request body into the building folder. Never holds the body in memory."""
        with self.lock:
            job = self._job(snapshot_id)
        if length is None or length < 8:
            raise SnapshotError('A record needs a Content-Length.', 411, 'length_required')
        if length > MAX_RECORD:
            raise SnapshotError('One saved item is %.0f MB, more than the %d MB a backup can hold.' % (length / 1e6, MAX_RECORD >> 20), 413, 'too_big')
        announced = meta.get('sha256')
        if not isinstance(announced, str) or not SHA.match(announced):
            raise SnapshotError('The record did not say its SHA-256.')
        for field in ('db', 'store'):
            if not isinstance(meta.get(field), str) or not 0 < len(meta[field]) <= 512:
                raise SnapshotError('The record did not name its %s.' % field)
        if 'key' not in meta:
            raise SnapshotError('The record did not give its key.')
        with self.lock:
            if len(job['records']) >= MAX_RECORDS:
                raise SnapshotError('Too many saved items for one backup.', 413, 'too_big')
            if job['bytes'] + length > MAX_TOTAL:
                raise SnapshotError('The backup would be larger than %d GB.' % (MAX_TOTAL >> 30), 413, 'too_big')
            if shutil.disk_usage(job['dir']).free < length + SPARE_BYTES:
                raise SnapshotError(FULL_MESSAGE, 507, 'disk_full')
        part = job['dir'] / ('up-%s.part' % uuid.uuid4().hex[:12])
        digest = hashlib.sha256()
        received = 0
        try:
            with open(part, 'wb') as out:
                while received < length:
                    block = stream.read(min(BLOCK, length - received))
                    if not block:
                        break
                    now = time.time()
                    if now - job['touched'] > 5:  # a slow upload is still alive: a second window's begin must not sweep it
                        job['touched'] = now
                    out.write(block)
                    digest.update(block)
                    received += len(block)
            if received != length:
                raise SnapshotError('The upload stopped before the whole item arrived.', 400, 'short_body')
            if digest.hexdigest() != announced:
                raise SnapshotError('The item changed on its way (SHA-256 differs), so it was not kept.', 422, 'hash_mismatch')
            final = job['dir'] / 'records' / (announced + '.rec')
            os.replace(part, final)
        except OSError as error:
            if disk_full(error):
                raise SnapshotError(FULL_MESSAGE, 507, 'disk_full')
            raise SnapshotError('The item could not be written: %s' % error, 500, 'io')
        finally:
            try:
                part.unlink()
            except OSError:
                pass
        with self.lock:
            if announced not in job['records']:
                job['bytes'] += length
            job['records'][announced] = {'db': meta['db'], 'store': meta['store'], 'key': meta['key'], 'sha256': announced, 'size': length,
                                         'fp': meta.get('fp') if isinstance(meta.get('fp'), str) and len(meta['fp']) <= 200 else None}
        return {'sha256': announced, 'size': length}

    def put_small(self, snapshot_id, name, data):
        if name not in ('localstorage', 'schema'):
            raise SnapshotError('Unknown part.', 404)
        with self.lock:
            job = self._job(snapshot_id)
            path = job['dir'] / (name + '.json')
            try:
                path.write_bytes(data)
            except OSError as error:
                if disk_full(error):
                    raise SnapshotError(FULL_MESSAGE, 507, 'disk_full')
                raise SnapshotError('Could not write: %s' % error, 500, 'io')
            job['small'][name] = {'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}
        return job['small'][name]

    def commit(self, snapshot_id, listed, databases, local_storage_keys):
        """listed: every record of the new snapshot, as the page sees it. Unchanged ones are linked from the previous complete one."""
        with self.lock:
            job = self._job(snapshot_id)
            root = self.root()
            previous, old_manifest = self.latest_complete()
            old = {r['sha256']: r for r in old_manifest['records']} if old_manifest else {}
            records, missing, seen, total = [], [], set(), 0
            for item in listed:
                sha = item.get('sha256') if isinstance(item, dict) else None
                if not isinstance(sha, str) or not SHA.match(sha):
                    raise SnapshotError('The commit list has a bad entry.')
                entry = job['records'].get(sha)
                target = job['dir'] / 'records' / (sha + '.rec')
                if entry is None:
                    source = old.get(sha)
                    if source is None or previous is None or not (previous / 'records' / (sha + '.rec')).is_file():
                        missing.append(sha)
                        continue
                    try:
                        try:
                            os.link(previous / 'records' / (sha + '.rec'), target)
                        except OSError:
                            shutil.copyfile(previous / 'records' / (sha + '.rec'), target)
                    except OSError as error:
                        if disk_full(error):
                            raise SnapshotError(FULL_MESSAGE, 507, 'disk_full')
                        missing.append(sha)
                        continue
                    entry = {k: source.get(k) for k in ('db', 'store', 'key', 'sha256', 'size', 'fp')}
                if sha in seen:
                    continue
                seen.add(sha)
                try:
                    if target.stat().st_size != entry['size']:
                        missing.append(sha)
                        continue
                except OSError:
                    missing.append(sha)
                    continue
                records.append(entry)
                total += entry['size']
            for name in ('localstorage', 'schema'):
                if name not in job['small']:
                    raise SnapshotError('The backup has no %s part, so it was not finished.' % name, 409, 'incomplete')
            if missing:
                raise SnapshotError('%d saved items were never uploaded, so the backup was not finished.' % len(missing), 409, 'incomplete')
            total += sum(job['small'][n]['size'] for n in ('localstorage', 'schema'))
            records.sort(key=lambda r: (r['db'], r['store'], identity(r['db'], r['store'], r['key'])))
            counts = {}
            for record in records:
                name = record['db'] + '/' + record['store']
                counts[name] = counts.get(name, 0) + 1
            created = time.time()
            manifest = {'version': SCHEMA_VERSION, 'snapshot_id': snapshot_id, 'origin': job['origin'], 'created': created,
                        'created_text': time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(created)) + 'Z', 'counts': counts,
                        'records': records, 'total_bytes': total, 'parts': dict(job['small']),
                        'local_storage_keys': int(local_storage_keys) if isinstance(local_storage_keys, int) else 0,
                        'databases': databases if isinstance(databases, list) else []}
            return self._finish(job, snapshot_id, manifest, root)

    def _finish(self, job, snapshot_id, manifest, root):
        try:
            _write_json_atomic(job['dir'] / 'manifest.json', manifest)
            folder = root / ('snap-%016d-%s' % (int(manifest['created'] * 1e6), snapshot_id))
            os.replace(job['dir'], folder)
        except OSError as error:
            if disk_full(error):
                raise SnapshotError(FULL_MESSAGE, 507, 'disk_full')
            raise SnapshotError('The backup could not be finished: %s' % error, 500, 'io')
        self.active.pop(snapshot_id, None)
        self._write_status(last_failure=None)
        kept = self.snapshots()
        # The newest few, and always the fullest one: a run of near-empty snapshots must not push out the only full backup.
        fullest = max(kept, key=lambda p: (len((self._manifest(p) or {}).get('records') or []), p.name), default=None)
        for old in kept[1 + KEEP_OLD:]:
            if old != fullest:
                _remove_tree(old, root)
        return self.summary(folder, self._manifest(folder))

    def abort(self, snapshot_id):
        with self.lock:
            job = self.active.pop(snapshot_id, None) if isinstance(snapshot_id, str) and ID.match(snapshot_id) else None
            if job:
                _remove_tree(job['dir'], self.root())
        return {'aborted': bool(job)}

    # ---------------------------------------------------------------- reading for import and checking
    def snapshot_dir(self, snapshot_id):
        if not isinstance(snapshot_id, str) or not SNAP.match(snapshot_id):
            raise SnapshotError('No such snapshot.', 404, 'unknown_snapshot')
        folder = self.root() / snapshot_id
        if not folder.is_dir() or folder.is_symlink():
            raise SnapshotError('No such snapshot.', 404, 'unknown_snapshot')
        return folder

    def verify(self, snapshot_id, report):
        """The page's post-import report: how many records per store it found again, and the SHA-256 of each one it re-read."""
        folder = self.snapshot_dir(snapshot_id)
        manifest, problems = self.check(folder, deep=bool(report.get('deep')))
        if manifest is None:
            raise SnapshotError('That snapshot has no readable manifest.', 409, 'incomplete')
        corrupt = [p.split(' ', 1)[1] for p in problems if p.split(' ', 1)[0] in ('hash', 'size', 'missing')]
        result = {'snapshot_id': snapshot_id, 'complete': not problems, 'corrupt': corrupt, 'at': time.time()}
        listed = report.get('hashes')
        if isinstance(listed, list):
            got = {h for h in listed if isinstance(h, str)}
            expected = {r['sha256'] for r in manifest['records']}
            result['expected_records'] = len(expected)
            result['found_records'] = len(expected & got)
            result['missing'] = len(expected - got)
            result['unexpected'] = len(got - expected)
            result['ok'] = not problems and not result['missing'] and not result['unexpected']
            if report.get('local_storage_missing'):
                try:
                    result['local_storage_missing'] = int(report['local_storage_missing'])
                except (TypeError, ValueError, KeyError):
                    result['local_storage_missing'] = 0
                result['ok'] = False
        else:
            result['ok'] = not problems
        if isinstance(report.get('origin'), str):
            result['imported_into'] = report['origin'][:200]
        if report.get('imported') is not None:
            result['imported'] = bool(report['imported'])
        try:
            _write_json_atomic(folder / 'verify.json', result)
        except OSError:
            pass
        if not result['ok']:
            self._write_status(last_failure={'at': result['at'], 'snapshot_id': snapshot_id, 'missing': result.get('missing', 0) + len(corrupt),
                                             'message': 'A check of the Studio data backup found %d items missing or damaged.' % (result.get('missing', 0) + len(corrupt))})
        return result


# ---------------------------------------------------------------- HTTP

def create_blueprint(snapshots=None):
    from flask import Blueprint, Response, jsonify, request, send_file
    blueprint = Blueprint('windows_window_snapshot', __name__, url_prefix='/api/windows/window-snapshot')
    store = snapshots or Snapshots(lambda: __import__('windows_cache_fallback').data_root())

    def local_only():
        """Same rule as the stem installer's POST routes: this PC only, this app's own host, a same-origin request.
        Reads need no Origin header (a same-origin GET carries none) but a cross-site one is refused."""
        origin = request.headers.get('Origin')
        site = request.headers.get('Sec-Fetch-Site')
        bad = (request.remote_addr not in ('127.0.0.1', '::1') or request.host.split(':')[0] not in ('127.0.0.1', 'localhost')
               or (site is not None and site not in ('same-origin', 'none')))
        if request.method not in ('GET', 'HEAD'):
            bad = bad or not origin or origin.rstrip('/') != request.host_url.rstrip('/')
        elif origin is not None:
            bad = bad or origin.rstrip('/') != request.host_url.rstrip('/')
        return (jsonify(success=False, error='The Studio data backup only answers PEAK HOUR itself.', code='forbidden'), 403) if bad else None

    def guarded(function):
        def wrapper(*args, **kwargs):
            refused = local_only()
            if refused:
                return refused
            try:
                return function(*args, **kwargs)
            except SnapshotError as error:
                return jsonify(success=False, error=str(error), code=error.code), error.status
            except OSError as error:
                if disk_full(error):
                    return jsonify(success=False, error=FULL_MESSAGE, code='disk_full'), 507
                return jsonify(success=False, error='The backup folder could not be used: %s' % error, code='io'), 500
        wrapper.__name__ = function.__name__
        return wrapper

    def small_body():
        length = request.content_length
        if length is None or length > MAX_SMALL:
            raise SnapshotError('That part is too large (limit %d MB).' % (MAX_SMALL >> 20), 413, 'too_big')
        return request.get_data(cache=False)

    def json_body():
        try:
            data = json.loads(small_body().decode('utf-8'))
        except ValueError:
            raise SnapshotError('The request was not valid JSON.')
        if not isinstance(data, dict):
            raise SnapshotError('The request was not a JSON object.')
        return data

    @blueprint.get('/status')
    @guarded
    def status():
        return jsonify(success=True, **store.status())

    @blueprint.post('/begin')
    @guarded
    def begin():
        data = json_body()
        return jsonify(success=True, **store.begin(data.get('origin'), data.get('estimate')))

    @blueprint.post('/record/<snapshot_id>')
    @guarded
    def record(snapshot_id):
        raw = request.headers.get('X-PH-Meta', '')
        if not raw or len(raw) > MAX_META:
            raise SnapshotError('The record description is missing or too long.')
        try:
            meta = json.loads(base64.urlsafe_b64decode(raw + '=' * (-len(raw) % 4)).decode('utf-8'))
        except ValueError:
            raise SnapshotError('The record description is not valid.')
        if not isinstance(meta, dict):
            raise SnapshotError('The record description is not valid.')
        return jsonify(success=True, **store.put_record(snapshot_id, meta, request.stream, request.content_length))

    @blueprint.post('/part/<snapshot_id>/<name>')
    @guarded
    def part(snapshot_id, name):
        return jsonify(success=True, **store.put_small(snapshot_id, name, small_body()))

    @blueprint.post('/commit/<snapshot_id>')
    @guarded
    def commit(snapshot_id):
        data = json_body()
        listed = data.get('records')
        if not isinstance(listed, list):
            raise SnapshotError('The commit has no record list.')
        return jsonify(success=True, snapshot=store.commit(snapshot_id, listed, data.get('databases'), data.get('local_storage_keys')))

    @blueprint.post('/abort/<snapshot_id>')
    @guarded
    def abort(snapshot_id):
        return jsonify(success=True, **store.abort(snapshot_id))

    @blueprint.get('/snapshot/<snapshot_id>/manifest')
    @guarded
    def manifest(snapshot_id):
        folder = store.snapshot_dir(snapshot_id)
        data, problems = store.check(folder)
        if problems:
            raise SnapshotError('That snapshot is not complete (%d problems).' % len(problems), 409, 'incomplete')
        return send_file(folder / 'manifest.json', mimetype='application/json', conditional=False, max_age=0)

    @blueprint.get('/snapshot/<snapshot_id>/part/<name>')
    @guarded
    def read_part(snapshot_id, name):
        if name not in ('localstorage', 'schema'):
            raise SnapshotError('Unknown part.', 404)
        return send_file(store.snapshot_dir(snapshot_id) / (name + '.json'), mimetype='application/json', conditional=False, max_age=0)

    @blueprint.get('/snapshot/<snapshot_id>/record/<sha>')
    @guarded
    def read_record(snapshot_id, sha):
        if not SHA.match(sha):
            raise SnapshotError('Unknown record.', 404)
        path = store.snapshot_dir(snapshot_id) / 'records' / (sha + '.rec')
        if not path.is_file():
            raise SnapshotError('Unknown record.', 404)
        return send_file(path, mimetype='application/octet-stream', conditional=False, max_age=0)

    @blueprint.post('/verify/<snapshot_id>')
    @guarded
    def verify(snapshot_id):
        return jsonify(success=True, **store.verify(snapshot_id, json_body()))

    return blueprint


def install(app, snapshots=None):
    """app is AXIOM's app module (flask app in app.app)."""
    flask_app = app.app
    if getattr(flask_app, '_windows_window_snapshot', False):
        return
    flask_app.register_blueprint(create_blueprint(snapshots))
    flask_app._windows_window_snapshot = True
