"""Stress-test report for trying PEAK HOUR on another PC (Settings > "Stress-Test Report").

One click collects, read-only, what a big library did to PEAK HOUR and saves it as one zip on the
Desktop to bring back:
- the PC: Windows version, CPU, memory, free space on the music drives, PEAK HOUR version;
- the library PEAK HOUR loaded (library_cache.json, opened read-only): songs per file type, songs
  with no BPM/key/artist/length, key-scan results and speed, songs whose file has gone;
- every file in the library folders by type, including types PEAK HOUR does not import, and very
  long or non-English file names;
- a sample of each file type opened with the media checker (windows_media_probe), with the error
  for each one that fails;
- screens and requests that took over SLOW_SECONDS, server errors and logged errors since start;
- the DJ libraries found (VirtualDJ, Serato, djay) and PEAK HOUR's own logs.
Nothing in the music or the DJ libraries is changed. Each step has a time limit, so a huge library
or a slow drive gives a partial count (marked as such) instead of a report that never finishes.
"""
import collections
import ctypes
import datetime
import json
import logging
import os
import platform
import random
import shutil
import socket
import sys
import tempfile
import threading
import time
import traceback
import zipfile
from pathlib import Path

from flask import Blueprint, g, jsonify, request

SLOW_SECONDS = 1.5
WALK_SECONDS = 240
WALK_FILE_LIMIT = 3_000_000
EXISTS_SECONDS = 90
SAMPLES_PER_TYPE = 8
PROBE_SECONDS = 180
LOG_TAIL_BYTES = 2 * 1024 * 1024
SKIP_FOLDERS = {'$recycle.bin', 'system volume information', '$windows.~bt', '$windows.~ws', 'windowsapps'}
LONG_PATH = 260


def desktop_folder():
    """The user's Desktop, wherever Windows keeps it (OneDrive moves it)."""
    buffer = ctypes.create_unicode_buffer(260)
    try:
        if ctypes.windll.shell32.SHGetFolderPathW(None, 0x10, None, 0, buffer) == 0 and buffer.value:
            return Path(buffer.value)
    except (AttributeError, OSError):
        pass
    return Path.home() / 'Desktop'


def _gb(value):
    return round(value / 1024 ** 3, 1)


def _now():
    return datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def _ext(name):
    return os.path.splitext(name)[1].lower() or '(none)'


class Activity:
    """Slow requests, server errors and logged errors since PEAK HOUR started."""

    def __init__(self, slow_seconds=SLOW_SECONDS, clock=time.perf_counter):
        self.slow_seconds, self.clock = slow_seconds, clock
        self.lock = threading.Lock()
        self.slow = collections.deque(maxlen=300)
        self.failed = collections.deque(maxlen=300)
        self.errors = collections.deque(maxlen=300)
        self.endpoints = {}
        self.requests = 0

    def install(self, web):
        @web.before_request
        def _start():
            g.peak_hour_started = self.clock()

        @web.after_request
        def _finish(response):
            started = g.get('peak_hour_started')
            if started is not None:
                self.record(request.method, request.path, response.status_code, self.clock() - started)
            return response
        handler = _Collector(self)
        handler.setLevel(logging.ERROR)
        logging.getLogger().addHandler(handler)
        return self

    def record(self, method, path, status, seconds):
        with self.lock:
            self.requests += 1
            name = f'{method} {path}'
            entry = self.endpoints.setdefault(name, {'count': 0, 'slowest': 0.0, 'total': 0.0})
            entry['count'] += 1
            entry['total'] += seconds
            entry['slowest'] = max(entry['slowest'], seconds)
            if seconds >= self.slow_seconds:
                self.slow.append({'at': _now(), 'request': name, 'seconds': round(seconds, 2), 'status': status})
            if status >= 500:
                self.failed.append({'at': _now(), 'request': name, 'status': status})

    def error(self, text):
        with self.lock:
            self.errors.append({'at': _now(), 'error': text[:4000]})

    def snapshot(self):
        with self.lock:
            slowest = sorted(self.endpoints.items(), key=lambda item: item[1]['slowest'], reverse=True)[:25]
            return {'requests': self.requests, 'slow': list(self.slow), 'server_errors': list(self.failed),
                    'logged_errors': list(self.errors),
                    'slowest_endpoints': [{'request': name, 'count': e['count'], 'slowest': round(e['slowest'], 2),
                                           'average': round(e['total'] / e['count'], 3)} for name, e in slowest]}


class _Collector(logging.Handler):
    def __init__(self, activity):
        super().__init__()
        self.activity = activity

    def emit(self, record):
        try:
            self.activity.error(f'{record.name}: {self.format(record)}')
        except Exception:
            pass


def library_summary(tracks, exists=os.path.exists, budget=EXISTS_SECONDS, clock=time.monotonic):
    by_type = collections.Counter(_ext(t.get('filename') or t.get('path') or '') for t in tracks)
    missing = {field: sum(1 for t in tracks if not t.get(key)) for field, key in
               (('bpm', 'bpm'), ('key', 'camelot'), ('artist', 'artist'), ('length', 'duration_sec'), ('year', 'year'))}
    gone, checked, deadline = [], 0, clock() + budget
    for track in tracks:
        if clock() > deadline:
            break
        checked += 1
        if track.get('path') and not exists(track['path']):
            gone.append(track['path'])
    return {'songs': len(tracks), 'by_type': dict(by_type.most_common()),
            'hours': round(sum(float(t.get('duration_sec') or 0) for t in tracks) / 3600, 1),
            'missing': missing,
            'key_scan': dict(collections.Counter(t.get('key_analysis_status') or 'not scanned' for t in tracks)),
            'key_scan_speed': key_scan_speed(tracks),
            'year_research': dict(collections.Counter(t.get('year_research_status') or 'not researched' for t in tracks)),
            'files_gone': len(gone), 'files_gone_examples': gone[:50], 'files_checked': checked,
            'files_check_complete': checked == len(tracks)}


def key_scan_speed(tracks, gap=600):
    """Seconds per song for the latest key scan, from each song's scan time (runs split at 10-minute gaps)."""
    times = []
    for track in tracks:
        try:
            times.append(datetime.datetime.fromisoformat(str(track['key_analysis_attempted_at']).replace('Z', '+00:00')).timestamp())
        except (KeyError, ValueError):
            pass
    if len(times) < 2:
        return None
    times.sort()
    start = len(times) - 1
    while start > 0 and times[start] - times[start - 1] <= gap:
        start -= 1
    run = times[start:]
    if len(run) < 2:
        return None
    return {'songs': len(run), 'minutes': round((run[-1] - run[0]) / 60, 1),
            'seconds_per_song': round((run[-1] - run[0]) / (len(run) - 1), 2)}


def library_roots(cache):
    roots = set(cache.get('folder_structure') or {})
    roots.update(t['root'] for t in cache.get('tracks') or [] if t.get('root'))
    roots = sorted({os.path.normcase(os.path.abspath(r)): r for r in roots if os.path.isdir(r)}.items())
    kept = []
    for key, root in roots:  # a folder inside another library folder is counted once
        if not any(key.startswith(k.rstrip('\\') + '\\') for k, _ in kept):
            kept.append((key, root))
    return [root for _, root in kept]


def walk_folders(roots, supported, budget=WALK_SECONDS, limit=WALK_FILE_LIMIT, samples=SAMPLES_PER_TYPE,
                 clock=time.monotonic, seed=0):
    """Every file under the library folders by type, plus a random sample of each type to open."""
    by_type, sizes = collections.Counter(), collections.Counter()
    picks, seen = collections.defaultdict(list), collections.Counter()
    chooser = random.Random(seed)
    long_names, other_alphabets, unreadable = [], [], []
    files, deadline, complete = 0, clock() + budget, True
    stack = list(roots)
    while stack:
        if clock() > deadline or files >= limit:
            complete = False
            break
        folder = stack.pop()
        try:
            entries = list(os.scandir(folder))
        except OSError as error:
            unreadable.append(f'{folder} ({error.strerror or error})')
            continue
        for entry in entries:
            try:
                if entry.is_dir(follow_symlinks=False):
                    if entry.name.lower() not in SKIP_FOLDERS:
                        stack.append(entry.path)
                    continue
                if not entry.is_file(follow_symlinks=False):
                    continue
                size = entry.stat(follow_symlinks=False).st_size
            except OSError:
                continue
            files += 1
            ext = _ext(entry.name)
            by_type[ext] += 1
            sizes[ext] += size
            if len(entry.path) >= LONG_PATH:
                long_names.append(entry.path)
            if not entry.name.isascii():
                other_alphabets.append(entry.path)
            seen[ext] += 1  # reservoir sample: every file of a type is equally likely to be opened
            if len(picks[ext]) < samples:
                picks[ext].append(entry.path)
            else:
                slot = chooser.randrange(seen[ext])
                if slot < samples:
                    picks[ext][slot] = entry.path
    media = {ext for ext in by_type if ext in supported}
    return {'folders': roots, 'files': files, 'complete': complete,
            'by_type': [{'type': ext, 'files': n, 'gb': _gb(sizes[ext]), 'imported_by_peak_hour': ext in supported}
                        for ext, n in by_type.most_common()],
            'long_paths': len(long_names), 'long_path_examples': long_names[:25],
            'non_english_names': len(other_alphabets), 'non_english_examples': other_alphabets[:25],
            'unreadable_folders': unreadable[:50],
            'samples': {ext: paths for ext, paths in picks.items() if ext in media}}


def open_samples(samples, probe, budget=PROBE_SECONDS, clock=time.monotonic):
    results, deadline, complete = {}, clock() + budget, True
    for ext, paths in sorted(samples.items()):
        row = results[ext] = {'opened': 0, 'failed': [], 'seconds': 0.0, 'codecs': collections.Counter()}
        for path in paths:
            if clock() > deadline:
                complete = False
                break
            started = clock()
            try:
                media = probe(path)
                row['opened'] += 1
                for stream in media.get('streams') or []:
                    row['codecs'][f"{stream.get('type')}:{stream.get('codec')}"] += 1
            except Exception as error:
                row['failed'].append({'file': path, 'error': str(error)[:300]})
            row['seconds'] += clock() - started
        row['seconds'] = round(row['seconds'], 2)
        row['codecs'] = dict(row['codecs'])
    return {'complete': complete, 'types': results}


def dj_libraries(app):
    found = {}
    try:
        from windows_virtualdj_library import database_paths
        found['virtualdj'] = [{'database': str(p), 'mb': round(p.stat().st_size / 1024 ** 2, 1),
                               'songs': p.read_bytes().count(b'<Song ')} for p in database_paths() if p.is_file()]
    except Exception as error:
        found['virtualdj'] = f'not checked: {error}'
    serato = Path(os.environ.get('USERPROFILE', ''), 'Music', '_Serato_')
    found['serato'] = {'folder': str(serato), 'found': serato.is_dir(),
                       'database': next((str(serato / n) for n in ('Library/root.sqlite', 'database V2') if (serato / n).is_file()), None)}
    djay = getattr(app, 'DJAY_MEDIA_LIBRARY_DB', '') or ''
    found['djay'] = {'database': str(djay) or None, 'found': bool(djay) and os.path.isfile(djay)}
    return found


def system_info(roots, version):
    from windows_scan_speed import memory_bytes, worker_capacity
    drives = {}
    for folder in list(roots) + [os.environ.get('SystemDrive', 'C:') + '\\']:
        drive = os.path.splitdrive(os.path.abspath(folder))[0] or folder
        if drive not in drives:
            try:
                usage = shutil.disk_usage(drive + '\\' if not drive.startswith('\\\\') else folder)
                drives[drive] = {'free_gb': _gb(usage.free), 'total_gb': _gb(usage.total)}
            except OSError as error:
                drives[drive] = {'error': str(error)}
    return {'peak_hour': version, 'computer': socket.gethostname(), 'windows': platform.platform(),
            'cpu': platform.processor(), 'logical_cpus': os.cpu_count(), 'memory_gb': _gb(memory_bytes()),
            'scan_workers': worker_capacity(), 'drives': drives, 'made': _now()}


def text_report(report):
    """The same findings as report.json, written to be read."""
    s, lib, disk, opened = report['system'], report['library'], report['folders'], report['opened']
    out = [f"PEAK HOUR STRESS-TEST REPORT  {s['made']}", '',
           f"PC: {s['computer']}  |  {s['windows']}", f"CPU: {s['cpu']} ({s['logical_cpus']} threads, {s['scan_workers']} scan workers)  |  Memory: {s['memory_gb']} GB",
           f"PEAK HOUR {s['peak_hour']}", 'Drives: ' + ', '.join(f"{d} {v.get('free_gb', '?')} GB free of {v.get('total_gb', '?')}" for d, v in s['drives'].items()), '',
           f"LIBRARY IN PEAK HOUR: {lib['songs']} songs, {lib['hours']} hours",
           '  By type: ' + ', '.join(f'{k} {v}' for k, v in lib['by_type'].items()),
           '  Missing: ' + ', '.join(f'{k} {v}' for k, v in lib['missing'].items()),
           '  Key scan: ' + ', '.join(f'{k} {v}' for k, v in lib['key_scan'].items())]
    speed = lib.get('key_scan_speed')
    if speed:
        out.append(f"  Latest key scan: {speed['songs']} songs in {speed['minutes']} min ({speed['seconds_per_song']} s per song)")
    out.append(f"  Files gone from disk: {lib['files_gone']}" + ('' if lib['files_check_complete'] else f" (checked {lib['files_checked']} of {lib['songs']}, time limit)"))
    out += [f"  - {p}" for p in lib['files_gone_examples'][:15]]
    out += ['', f"FILES IN THE LIBRARY FOLDERS: {disk['files']}" + ('' if disk['complete'] else ' (partial: time or size limit reached)')]
    out += [f"  {r['type']:<8} {r['files']:>8} files {r['gb']:>8} GB  {'imported' if r['imported_by_peak_hour'] else 'NOT imported by PEAK HOUR'}" for r in disk['by_type'][:40]]
    out += [f"  Paths of {LONG_PATH}+ characters: {disk['long_paths']}", f"  Non-English file names: {disk['non_english_names']}"]
    out += [f"  Could not open folder: {f}" for f in disk['unreadable_folders'][:15]]
    out += ['', 'SAMPLE FILES OPENED' + ('' if opened['complete'] else ' (partial: time limit reached)')]
    for ext, row in opened['types'].items():
        out.append(f"  {ext:<8} {row['opened']} opened, {len(row['failed'])} failed, {row['seconds']} s  " + ', '.join(row['codecs']))
        out += [f"      FAILED {f['file']}: {f['error']}" for f in row['failed']]
    act = report['activity']
    out += ['', f"SLOW SCREENS AND REQUESTS (over {SLOW_SECONDS} s, of {act['requests']} requests)"]
    out += [f"  {e['at']}  {e['seconds']:>7} s  {e['request']}  ({e['status']})" for e in act['slow'][-40:]] or ['  none']
    out += ['', 'SERVER ERRORS'] + ([f"  {e['at']}  {e['status']}  {e['request']}" for e in act['server_errors'][-40:]] or ['  none'])
    out += ['', 'LOGGED ERRORS'] + ([f"  {e['at']}  {e['error'].splitlines()[0][:300]}" for e in act['logged_errors'][-40:]] or ['  none'])
    out += ['', 'DJ LIBRARIES FOUND', '  ' + json.dumps(report['dj_libraries'], indent=1).replace('\n', '\n  '), '']
    return '\n'.join(out)


class StressReport:
    STAGES = ('PC details', 'Library', 'Files in the library folders', 'Opening sample files', 'DJ libraries', 'Saving')

    def __init__(self, app, activity, *, cache_path, log_folder, version, output=desktop_folder, probe=None):
        self.app, self.activity, self.cache_path, self.log_folder = app, activity, Path(cache_path), Path(log_folder)
        self.version, self.output, self.probe = version, output, probe
        self.lock = threading.Lock()
        self.state = {'state': 'idle', 'stage': '', 'percent': 0, 'path': None, 'error': None}

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def _set(self, **values):
        with self.lock:
            self.state.update(values)

    def start(self):
        with self.lock:
            if self.state['state'] == 'running':
                return dict(self.state)
            self.state = {'state': 'running', 'stage': self.STAGES[0], 'percent': 0, 'path': None, 'error': None}
        threading.Thread(target=self._run, name='peak-hour-stress-report', daemon=True).start()
        return self.snapshot()

    def _stage(self, index):
        self._set(stage=self.STAGES[index], percent=int(index * 100 / len(self.STAGES)))

    def _probe(self):
        if self.probe:
            return self.probe
        from windows_media_probe import probe_media, SUPPORTED_MEDIA
        scratch = Path(tempfile.gettempdir())

        def probe(path):
            if _ext(path) not in SUPPORTED_MEDIA:
                raise ValueError('the media checker does not open this type')
            return probe_media(path, scratch_dir=scratch)
        return probe

    def _supported(self):
        try:
            import scanner
            return {e.lower() for e in scanner.SUPPORTED_FORMATS}
        except Exception:
            return {'.mp3', '.wav', '.aiff', '.flac', '.m4a', '.aac'}

    def build(self):
        self._stage(0)
        try:
            with open(self.cache_path, encoding='utf-8') as handle:
                cache = json.load(handle)
        except (OSError, ValueError):
            cache = {}
        roots = library_roots(cache)
        report = {'system': system_info(roots, self.version)}
        self._stage(1)
        report['library'] = library_summary(cache.get('tracks') or [])
        self._stage(2)
        folders = walk_folders(roots, self._supported())
        samples = folders.pop('samples')
        report['folders'] = folders
        self._stage(3)
        report['opened'] = open_samples(samples, self._probe())
        self._stage(4)
        report['dj_libraries'] = dj_libraries(self.app)
        report['activity'] = self.activity.snapshot()
        report['threads'] = thread_snapshot()
        self._stage(5)
        return report

    def save(self, report):
        folder = Path(self.output())
        folder.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.now().strftime('%Y-%m-%d %H%M')
        target = folder / f"PEAK HOUR Stress Report {report['system']['computer']} {stamp}.zip"
        partial = target.with_suffix('.zip.part')
        with zipfile.ZipFile(partial, 'w', zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr('report.txt', text_report(report))
            bundle.writestr('report.json', json.dumps(report, indent=1, default=str))
            for log in sorted(self.log_folder.glob('*.log')) if self.log_folder.is_dir() else []:
                try:
                    with open(log, 'rb') as handle:
                        handle.seek(max(0, log.stat().st_size - LOG_TAIL_BYTES))
                        bundle.writestr(f'logs/{log.name}', handle.read())
                except OSError:
                    pass
        os.replace(partial, target)
        return target

    def _run(self):
        try:
            target = self.save(self.build())
            self._set(state='done', stage='Saved', percent=100, path=str(target))
        except Exception as error:
            logging.getLogger(__name__).exception('Stress-test report failed')
            self._set(state='error', error=f'The report could not be made: {error}')


def thread_snapshot(sample_seconds=1.0, samples=5):
    """What each server thread is doing: its stack, sampled a few times (a thread busy in the same place
    every time is the one using the processor). Includes PEAK HOUR's own code paths only, no data."""
    me = threading.get_ident()
    names = {t.ident: t.name for t in threading.enumerate()}
    seen = collections.defaultdict(collections.Counter)
    for i in range(samples):
        for ident, frame in sys._current_frames().items():
            if ident != me:
                stack = traceback.extract_stack(frame)[-6:]
                seen[ident]['  <- '.join(f'{Path(f.filename).name}:{f.lineno} {f.name}' for f in reversed(stack))] += 1
        if i < samples - 1:
            time.sleep(sample_seconds / samples)
    return [{'thread': names.get(ident, str(ident)), 'stacks': [{'times': n, 'stack': st} for st, n in counter.most_common(3)]}
            for ident, counter in seen.items()]


def create_stress_report_blueprint(report, reveal):
    bp = Blueprint('windows_stress_report', __name__)

    def local():
        return request.remote_addr in ('127.0.0.1', '::1')

    @bp.get('/api/windows/stress-report')
    def status():
        return jsonify(success=True, **report.snapshot())

    @bp.post('/api/windows/stress-report')
    def start():
        if not local():
            return jsonify(success=False, error='Make the report on the PC running PEAK HOUR.'), 403
        return jsonify(success=True, **report.start())

    @bp.get('/api/windows/threads')
    def threads():
        if not local():
            return jsonify(success=False, error='This needs this PC.'), 403
        return jsonify(success=True, threads=thread_snapshot(float(request.args.get('seconds', 2)), 10))

    @bp.post('/api/windows/stress-report/reveal')
    def show():
        if not local():
            return jsonify(success=False, error='This needs this PC.'), 403
        path = report.snapshot().get('path')
        if not path or not os.path.isfile(path):
            return jsonify(success=False, error='Make a report first.'), 404
        reveal(path)
        return jsonify(success=True)
    return bp
