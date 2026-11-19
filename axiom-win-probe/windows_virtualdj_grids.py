"""Beatgrid Doctor check for VirtualDJ (read-only).

AXIOM's Beatgrid Doctor checks djay and Serato grids against the audio with
utils.beatgrid_engine.BeatgridEngine. VirtualDJ stores a song's grid in its
database.xml: seconds per beat in <Scan Bpm="..."> and the first beat in
<Poi Type="beatgrid" Pos="..."/> (a later beatgrid Poi may carry its own Bpm).
This turns that grid into the beat list the engine audits (as the engine does
for Serato in health_source_track), runs AXIOM's engine on the actual audio,
and reports clean / review / repair per song. The check writes nothing to
VirtualDJ: the page can put the songs that need attention into a new VirtualDJ
list, and a straight repair grid is kept with each result so that
windows_virtualdj_write can put it into VirtualDJ when the user asks.

Songs without a stored grid are reported as "no grid" (analyse them in
VirtualDJ first); VirtualDJ cue points are not passed to the engine, so the
cue-label checks the Doctor runs for djay do not apply here.
"""
import json
import math
import ntpath
import os
import threading
import time
from pathlib import Path

from flask import Blueprint, jsonify, request

from windows_virtualdj_database import read_database, VirtualDJDatabaseError
from windows_virtualdj_library import database_paths, MEDIA_EXTENSIONS

TEST_SIZE = 10
SAVE_EVERY = 25  # songs between progress saves; the finished rows are appended, never rewritten
AUDIO_EXTENSIONS = {'.mp3', '.wav', '.aif', '.aiff', '.flac', '.m4a', '.aac', '.ogg'}
ISSUE_TEXT = {
    'audio_drift': 'The beats drift away from the audio later in the song.',
    'alignment_not_proven': 'Not enough clear beats to confirm the grid (quiet, live or beatless audio).',
    'start_off_beat': 'The grid starts off the beat.',
    'start_origin_or_bar': 'Beat 1 / bar start may be in the wrong place.',
    'missing_stored_grid': 'VirtualDJ has no grid for this song.',
    'sync_ready': 'Close enough for sync, but not visually locked.',
}


def _section(track, name):
    entries = track.get('source_sections', {}).get(name) or []
    return [entry.get('attributes', {}) for entry in entries]


def stored_grid(track):
    """(first_beat_seconds, seconds_per_beat, segments) from a VirtualDJ song, or None without a grid."""
    scans = _section(track, 'Scan')
    try:
        spb = float(scans[0].get('Bpm')) if len(scans) == 1 else 0.0
    except (TypeError, ValueError):
        spb = 0.0
    points = []
    for poi in _section(track, 'Poi'):
        if poi.get('Type') != 'beatgrid':
            continue
        try:
            pos = float(poi.get('Pos'))
            own = float(poi['Bpm']) if poi.get('Bpm') else None
        except (TypeError, ValueError):
            continue
        if math.isfinite(pos):
            points.append((pos, own if own and math.isfinite(own) and own > 0 else None))
    if not math.isfinite(spb) or not 0.15 <= spb <= 3.0 or not points:
        return None
    return sorted(points), spb


def beat_anchors(points, spb, duration):
    """Engine beat anchors (beat index, seconds) covering the song from the stored grid."""
    first = points[0][0]
    while first < 0:  # VirtualDJ allows a first beat slightly before the file start
        first += spb
    anchors, beat, seconds, step = [{'beat': 0, 'seconds': round(first, 6)}], 0, first, points[0][1] or spb
    for pos, own in points[1:]:
        if pos <= seconds:
            continue
        beat += max(1, round((pos - seconds) / step))
        seconds, step = pos, own or spb
        anchors.append({'beat': beat, 'seconds': round(pos, 6)})
    remaining = math.floor((duration - seconds) / step) if duration and duration > seconds else 0
    if remaining > 0:
        anchors.append({'beat': beat + remaining, 'seconds': round(seconds + remaining * step, 6)})
    return anchors


def describe(result):
    """Plain-language verdict and suggestion from an engine audit."""
    issues = [i if isinstance(i, str) else str(i.get('code', i)) for i in result.get('issues') or []]
    text = [ISSUE_TEXT.get(code, code.replace('_', ' ').capitalize() + '.') for code in issues]
    windows = [w for w in result.get('before_audio') or [] if isinstance(w, dict) and w.get('checked')]
    off = [w for w in windows if w.get('status') != 'aligned']
    detail = '; '.join(f"{w.get('label', '')} at {w.get('seconds', 0):.0f}s: {w.get('reason', '')}" for w in off[:2])
    grid = result.get('grid') if isinstance(result.get('grid'), dict) else {}
    suggestion = ''
    if result.get('status') == 'repair':
        if grid.get('mode') == 'fluid':
            suggestion = 'Needs a variable-tempo grid; fix it in VirtualDJ\'s grid editor.'
        elif grid.get('bpm') and result.get('before_bpm') and abs(grid['bpm'] - result['before_bpm']) > 0.05:
            suggestion = f"BPM {result['before_bpm']:.2f} → {grid['bpm']:.2f}."
        shifts = [w.get('recommended_shift_seconds') for w in windows if w.get('recommended_shift_seconds')]
        if shifts and not suggestion:
            suggestion = f'Move the grid by about {round(1000 * sorted(shifts)[len(shifts) // 2])} ms.'
    return {'issues': issues, 'issue_text': text, 'detail': detail, 'suggestion': suggestion}


def repair_grid(result):
    """{'spb', 'first'} for VirtualDJ from the engine's straight repair grid, or None.

    The engine's anchors count beats from a downbeat (beat 0), so the first
    beat is projected back to beat 0 and then moved by whole bars to sit at or
    after the file start. Variable-tempo (fluid) repairs are not written."""
    grid = result.get('grid') if isinstance(result.get('grid'), dict) else {}
    anchors = [a for a in grid.get('beat_anchors') or [] if isinstance(a, dict)]
    try:
        bpm = float(grid.get('bpm'))
        terminal = float(grid.get('terminal_bpm') or bpm)
        beat, seconds = int(anchors[0]['beat']), float(anchors[0]['seconds'])
    except (TypeError, ValueError, KeyError, IndexError):
        return None
    if grid.get('mode') == 'fluid' or not (math.isfinite(bpm) and 20 <= bpm <= 400) or abs(terminal - bpm) > 0.01:
        return None
    spb = 60.0 / bpm
    first = seconds - beat * spb
    while first < 0:
        first += 4 * spb
    return {'spb': round(spb, 6), 'first': round(first, 6), 'bpm': round(bpm, 3)} if math.isfinite(first) else None


class VirtualDJGridCheck:
    def __init__(self, app, results_path, databases=database_paths, engine=None):
        self.app = app
        self.results_path = Path(results_path)
        self.databases = databases
        self._engine = engine
        self._lock = threading.Lock()
        self._cancel = threading.Event()
        self._thread = None
        self._saved_rows = 0
        self.state = self._load()

    @property
    def rows_path(self):
        return self.results_path.with_name(self.results_path.name + '.rows')

    def _load(self):
        try:
            saved = json.loads(self.results_path.read_text(encoding='utf-8'))
            if isinstance(saved, dict) and saved.get('kind') == 'axiom_virtualdj_grid_check':
                if saved.get('status') == 'running':
                    saved['status'] = 'interrupted'
                    if 'results' not in saved:  # a check that closed mid-run: the rows saved so far
                        saved['results'] = self._load_rows()
                        saved['done'] = len(saved['results'])
                saved.setdefault('results', [])
                return saved
        except (OSError, ValueError):
            pass
        return {'kind': 'axiom_virtualdj_grid_check', 'status': 'idle', 'results': [], 'total': 0, 'done': 0}

    def _load_rows(self):
        rows = []
        try:
            with open(self.rows_path, encoding='utf-8') as handle:
                for line in handle:
                    try:
                        row = json.loads(line)
                    except ValueError:
                        break  # a line cut short by the app closing
                    if isinstance(row, dict) and 'status' in row:
                        rows.append(row)
        except OSError:
            pass
        return rows

    def _write(self, state):
        self.results_path.parent.mkdir(parents=True, exist_ok=True)
        stage = self.results_path.with_name(self.results_path.name + '.tmp')
        stage.write_text(json.dumps(state), encoding='utf-8')
        os.replace(stage, self.results_path)

    def _save(self):
        """Everything, results included: at the start and the end of a check."""
        self._write(self.state)
        self._saved_rows = len(self.state['results'])
        if self.state['status'] != 'running':
            try:
                self.rows_path.unlink()
            except OSError:
                pass

    def _save_progress(self):
        """Counters in the main file and only the rows finished since the last save appended to the rows file."""
        rows = self.state['results'][self._saved_rows:]
        with open(self.rows_path, 'a', encoding='utf-8') as handle:
            handle.writelines(json.dumps(row) + '\n' for row in rows)
        self._saved_rows += len(rows)
        self._write({k: v for k, v in self.state.items() if k != 'results'})

    def engine(self):
        if self._engine is None:
            from utils.beatgrid_engine import BeatgridEngine
            self._engine = BeatgridEngine(self.app)
        return self._engine

    def songs(self, scope='full', folder=''):
        """VirtualDJ songs in scope: (inventory track, database path), first database wins per file."""
        found, seen, errors = [], set(), []
        prefix = ntpath.normcase(ntpath.normpath(folder)).rstrip('\\') + '\\' if scope == 'folder' else None
        for database in self.databases():
            try:
                inventory = read_database(database)
            except VirtualDJDatabaseError as exc:
                errors.append(f'{database}: {exc}')
                continue
            for track in inventory['tracks']:
                path = track.get('path', '')
                key = ntpath.normcase(ntpath.normpath(path)) if track.get('path_kind') == 'windows_absolute' else ''
                if (not key or key in seen or ntpath.splitext(key)[1] not in MEDIA_EXTENSIONS
                        or (prefix and not key.startswith(prefix))):
                    continue
                seen.add(key)
                found.append(track)
        if scope == 'test':
            found = [t for t in found if stored_grid(t) and os.path.isfile(t['path'])][:TEST_SIZE]
        return found, errors

    def check_one(self, track):
        path = track['path']
        tags = (_section(track, 'Tags') or [{}])[0]
        row = {'path': path, 'title': tags.get('Title') or ntpath.basename(path), 'artist': tags.get('Author', ''),
               'bpm': track.get('bpm'), 'issues': [], 'issue_text': [], 'detail': '', 'suggestion': ''}
        if ntpath.splitext(path)[1].lower() not in AUDIO_EXTENSIONS:
            return dict(row, status='skipped', detail='Video and other formats are not grid-checked.')
        if not os.path.isfile(path):
            return dict(row, status='missing', detail='The file is offline or missing.')
        grid = stored_grid(track)
        if grid is None:
            return dict(row, status='no_grid', detail='No VirtualDJ grid yet. Analyse the song in VirtualDJ first.')
        points, spb = grid
        try:
            from djay_beatgrid_publisher import _expanded_beat_times
            duration = self.app._beatgrid_doctor_audio_duration_seconds(path)
            times, first = _expanded_beat_times({'beat_anchors': beat_anchors(points, spb, duration)})
            result = self.engine().audit({'path': path, 'cues': [], 'edits': {}, 'djay_bpm': 60.0 / spb,
                                          'analysis': {'variants': {'detected': {'times': times, 'firstDownBeatIndex': first}}}})
        except Exception as exc:  # one unreadable song must not stop the check
            return dict(row, status='error', detail=f'Could not check this song: {exc}'[:300])
        status = result.get('status') if result.get('status') in ('clean', 'review', 'repair') else 'error'
        row = dict(row, status=status, bpm=round(60.0 / spb, 2), **describe(result))
        repair = repair_grid(result) if status == 'repair' and len(points) == 1 else None
        if repair:  # windows_virtualdj_write can put this into VirtualDJ if the stored grid is still as checked
            row.update(repair_grid=repair, checked_grid={'first': points[0][0], 'spb': spb})
        return row

    def start(self, scope='full', folder=''):
        if scope not in ('full', 'test', 'folder') or (scope == 'folder' and not Path(folder or '').is_dir()):
            raise ValueError('Choose the whole VirtualDJ library, a 10-song test or a music folder.')
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                raise RuntimeError('A VirtualDJ grid check is already running.')
            songs, errors = self.songs(scope, folder)
            if not songs:
                raise ValueError('No VirtualDJ songs were found for this check.' + (' ' + errors[0] if errors else ''))
            self._cancel.clear()
            self.state = {'kind': 'axiom_virtualdj_grid_check', 'status': 'running', 'scope': scope, 'folder': folder,
                          'started_at': time.time(), 'total': len(songs), 'done': 0, 'results': [],
                          'database_errors': errors}
            self._saved_rows = 0
            try:
                self.rows_path.unlink()
            except OSError:
                pass
            self._write({k: v for k, v in self.state.items() if k != 'results'})
            self._thread = threading.Thread(target=self._run, args=(songs,), name='axiom-vdj-grids', daemon=True)
            self._thread.start()
        return self.snapshot()

    def _run(self, songs):
        try:
            for track in songs:
                if self._cancel.is_set():
                    break
                row = self.check_one(track)
                with self._lock:
                    self.state['results'].append(row)
                    self.state['done'] += 1
                    if self.state['done'] % SAVE_EVERY == 0:
                        self._save_progress()
            with self._lock:
                self.state['status'] = 'cancelled' if self._cancel.is_set() else 'complete'
                self.state['finished_at'] = time.time()
                self._save()
        except Exception as exc:
            with self._lock:
                self.state.update(status='failed', error=str(exc)[:300])
                self._save()

    def cancel(self):
        self._cancel.set()
        return self.snapshot()

    def snapshot(self, include_results=False):
        with self._lock:
            state = dict(self.state)
            results = list(state.get('results') or [])
        counts = {}
        for row in results:
            counts[row['status']] = counts.get(row['status'], 0) + 1
        state['counts'] = counts
        if include_results:
            order = {'repair': 0, 'review': 1, 'error': 2, 'no_grid': 3, 'missing': 4, 'skipped': 5, 'clean': 6}
            state['results'] = sorted(results, key=lambda r: (order.get(r['status'], 9), r['artist'].casefold(), r['title'].casefold()))
        else:
            state.pop('results', None)
        state['dj_library_untouched'] = True
        return state


def create_grid_blueprint(checker, license_guard, choose_folder):
    bp = Blueprint('windows_virtualdj_grids', __name__)

    @bp.get('/api/windows/virtualdj/grids/status')
    def status():
        return jsonify(success=True, **checker.snapshot(include_results=request.args.get('results') == '1'))

    @bp.post('/api/windows/virtualdj/grids/start')
    def start():
        gate = license_guard('VirtualDJ beat grid check')
        if gate:
            return gate
        data = request.get_json(silent=True) or {}
        folder = ''
        try:
            if data.get('scope') == 'folder':
                folder, cancelled = choose_folder('Choose a music folder to check in VirtualDJ')
                if cancelled:
                    return jsonify(success=False, cancelled=True)
            return jsonify(success=True, **checker.start(data.get('scope', 'full'), folder))
        except (ValueError, RuntimeError, OSError) as exc:
            return jsonify(success=False, error=str(exc)), 400

    @bp.post('/api/windows/virtualdj/grids/cancel')
    def cancel():
        return jsonify(success=True, **checker.cancel())
    return bp
