"""Scale checks: the same things a DJ does, on a library as big as the owner's (about 49,000 songs, most on an external
drive that is not plugged in). Budgets:

  first load to the Library list    < 8 s        Track Information          < 5 s
  Health opens                      < 10 s       live poll p95              < 100 ms, no library re-read
  VirtualDJ connect (49k songs)     < 30 s       a keystroke in the search  < 2 s
  Reconnect Music (49k missing, a folder of 1,000 files)   < 60 s

Every result says which library it ran on: "synthetic" (made by synthetic_library.py) or "real copy" (a copy of the
owner's cache that the runner put in the sandbox; the runner writes {"library": "real copy", "tracks": n} to scale.json)."""
import json
import re
import shutil
import time
from pathlib import Path

from feature_check import synthetic_library, media
from feature_check.api import Result
from feature_check.checks import (ok, fail, warn, open_app, need_browser, run_ok, shot, ensure_library, library_info,
                                  set_dialog_answers, set_processes)
from feature_check.checks import health as health_checks
from feature_check.checks import library as library_checks
from feature_check.checks import live as live_checks

LOAD_BUDGET = 8.0
VDJ_BUDGET = 30.0
KEYSTROKE_BUDGET = 2.0
RECONNECT_BUDGET = 60.0
RECONNECT_FILES = 1000


def _real_cache_in(path):
    """library_cache.json inside a file / folder the owner pointed --scale at (a copy of the real library), or None."""
    path = Path(path)
    for candidate in (path, path / 'library_cache.json', path / 'data' / 'library_cache.json', path / 'AXIOM DJ' / 'data' / 'library_cache.json'):
        if candidate.is_file() and candidate.suffix.lower() == '.json':
            return candidate
    return None


def _install_real_copy(ctx, source):
    """Copy the owner's library cache (read only) into the sandbox so the scale checks run on real data."""
    root = Path(ctx.sandbox)
    target = root / 'AppData' / 'Local' / 'AXIOM DJ' / 'data' / 'library_cache.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    count = len(json.loads(target.read_text(encoding='utf-8')).get('tracks', []))
    info = {'library': 'real copy', 'tracks': count, 'source': str(source), 'cache': str(target), 'cache_mb': round(target.stat().st_size / 1048576, 1)}
    (root / synthetic_library.LABEL_FILE).write_text(json.dumps(info), encoding='utf-8')
    return info


def _big(ctx):
    """The big library: a real copy (--scale PATH points at a library_cache.json or a folder holding one), else a synthetic one
    of --synthetic N songs (default 49,000)."""
    current = library_info(ctx)
    path = getattr(ctx, 'scale_path', None)
    wanted = getattr(ctx, 'synthetic', None)
    if current and current.get('library') == 'real copy':
        return current
    if path and not (current and current.get('tracks', 0) >= synthetic_library.DEFAULT_COUNT // 2):
        source = _real_cache_in(path)
        if source:
            return _install_real_copy(ctx, source)
    count = int(wanted) if isinstance(wanted, (int, str)) and not isinstance(wanted, bool) and str(wanted).isdigit() else synthetic_library.DEFAULT_COUNT
    return ensure_library(ctx, count, min(synthetic_library.DEFAULT_REAL, count))


def _label(result, info):
    """Say which library the result came from (the report shows it in the reason)."""
    tag = '[%s, %s songs] ' % (info.get('library', 'synthetic'), format(info.get('tracks', 0), ','))
    if isinstance(result, Result):
        result.reason = tag + (result.reason or '')
        result.evidence.setdefault('library', info.get('library'))
        result.evidence.setdefault('library_tracks', info.get('tracks'))
    return result


def library_load(ctx):
    info = _big(ctx)
    browser = need_browser(ctx)
    run = browser.run([{'op': 'stub_dialogs'}, {'op': 'collect_errors'}, {'op': 'collect_network'}, {'op': 'navigate', 'url': '/', 'settle': 0, 'required': True},
                       {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 2}])
    load = run.steps[3].get('seconds', 0)
    run = browser.run([{'op': 'click', 'selector': '#tab-btn-library', 'required': True},
                       {'op': 'until', 'expr': "document.querySelectorAll('#search-results .library-track-card').length>0", 'timeout': 90},
                       {'op': 'eval', 'expr': "({rows:document.querySelectorAll('#search-results .library-track-card').length,"
                                              "header:(document.querySelector('#axiom-sidebar')?.innerText||'').match(/[0-9,]+\\s+TRACKS/i)?.[0]||''})", 'as': 'ui'},
                       shot(ctx, 'scale-library')])
    seconds = load + run.steps[0].get('seconds', 0) + run.steps[1].get('seconds', 0)
    evidence = {'page_load_s': round(load, 2), 'shown': run.vars.get('ui')}
    if not run.steps[1].get('ok'):
        return _label(fail('the Library list never showed songs', seconds, LOAD_BUDGET, run.shots, **evidence), info)
    if seconds > LOAD_BUDGET:
        return _label(fail(f'the Library list needed {seconds:.1f} s after opening the app', seconds, LOAD_BUDGET, run.shots, **evidence), info)
    return _label(ok(seconds, LOAD_BUDGET, f'the Library list showed songs {seconds:.1f} s after opening the app', run.shots, **evidence), info)


def track_info(ctx):
    info = _big(ctx)
    return _label(library_checks.track_info(ctx), info)


def health_open(ctx):
    info = _big(ctx)
    return _label(health_checks.health_open(ctx), info)


def live_poll(ctx):
    info = _big(ctx)
    return _label(live_checks.poll_cost(ctx), info)


def search_keystroke(ctx):
    info = _big(ctx)
    browser = need_browser(ctx)
    open_app(ctx, 'library')
    word = 'night'
    steps = [{'op': 'type', 'selector': '#main-search', 'text': ch, 'clear': i == 0, 'mutation_selector': '#search-results',
              'settle_ms': 400, 'timeout_ms': 15000} for i, ch in enumerate(word)]
    run = browser.run(steps + [shot(ctx, 'scale-search')])
    worst, rows = 0.0, []
    for ch, step in zip(word, run.steps):
        settled = (step.get('last_mutation_ms') or 0) / 1000.0
        rows.append({'typed': ch, 'first_change_ms': step.get('first_mutation_ms'), 'settled_ms': step.get('last_mutation_ms'),
                     'main_thread_stall_ms': step.get('longtask_ms')})
        worst = max(worst, settled)
    count = browser.run([{'op': 'eval', 'expr': "document.querySelectorAll('#search-results .library-track-card').length", 'as': 'n'}]).vars.get('n')
    evidence = {'keystrokes': rows, 'rows_after': count}
    if not any(r['first_change_ms'] is not None for r in rows):
        return _label(fail('the results list never changed while typing in the search box', worst, KEYSTROKE_BUDGET, run.shots, **evidence), info)
    if worst > KEYSTROKE_BUDGET:
        return _label(fail(f'a keystroke took {worst:.1f} s before the list settled', worst, KEYSTROKE_BUDGET, run.shots, **evidence), info)
    return _label(ok(worst, KEYSTROKE_BUDGET, f'slowest keystroke settled in {worst:.2f} s', run.shots, **evidence), info)


def _library_tracks(ctx):
    cache = Path(ctx.sandbox) / 'AppData' / 'Local' / 'AXIOM DJ' / 'data' / 'library_cache.json'
    return json.loads(cache.read_text(encoding='utf-8')).get('tracks', [])


def _real_virtualdj_databases():
    """VirtualDJ databases on this PC's drives (PEAK HOUR looks for a VirtualDJ folder at the top of every local drive)."""
    import os
    import string
    return [p for p in (letter + ':' + os.sep + 'VirtualDJ' + os.sep + 'database.xml' for letter in string.ascii_uppercase) if os.path.isfile(p)]


def vdj_connect(ctx):
    import os
    info = _big(ctx)
    real = _real_virtualdj_databases()
    if real and os.environ.get('FEATURE_CHECK_VDJ_ROOTS_FAKED') != '1':
        ctx.skip('this PC has a VirtualDJ database outside the sandbox (%s) and the connect would read it; '
                 'the runner must fake the drive list first (set FEATURE_CHECK_VDJ_ROOTS_FAKED=1 once it does)' % real[0])
    local = Path(ctx.sandbox) / 'AppData' / 'Local'
    tracks = _library_tracks(ctx)
    home, _ = media.make_vdj_home(local, [])
    t = time.perf_counter()
    synthetic_library.write_database(home / 'database.xml', tracks)
    made = time.perf_counter() - t
    set_processes(ctx, [])
    try:
        start = time.perf_counter()
        status, _, body = ctx.post('/api/windows/virtualdj/connect_library', json={}, timeout=300)
        seconds = time.perf_counter() - start
    finally:
        shutil.rmtree(home, ignore_errors=True)
    evidence = {'database_mb': round((len(tracks) * 280) / 1048576, 1), 'status': status,
                'answer': {k: body.get(k) for k in ('success', 'scanned_count', 'added_count', 'updated_count', 'total_tracks', 'error')}
                if isinstance(body, dict) else str(body)[:200], 'database_written_s': round(made, 1)}
    if status != 200 or not isinstance(body, dict) or not body.get('success'):
        return _label(fail('VirtualDJ connect did not finish: %s' % (body.get('error') if isinstance(body, dict) else status), seconds, VDJ_BUDGET, **evidence), info)
    if seconds > VDJ_BUDGET:
        return _label(fail(f'VirtualDJ connect took {seconds:.1f} s for {body.get("scanned_count")} songs', seconds, VDJ_BUDGET, **evidence), info)
    return _label(ok(seconds, VDJ_BUDGET, f'connected {body.get("scanned_count"):,} VirtualDJ songs in {seconds:.1f} s', **evidence), info)


def reconnect(ctx):
    info = _big(ctx)
    tracks = _library_tracks(ctx)
    counts = {}
    for track in tracks:
        counts[(track.get('filename') or '').lower()] = counts.get((track.get('filename') or '').lower(), 0) + 1
    names = [t['filename'] for t in tracks if t.get('needs_relink') and t.get('filename') and counts[t['filename'].lower()] == 1
             and len(t['filename']) < 90 and not re.search(r'[<>:"/\\|?*]', t['filename'])][:RECONNECT_FILES]
    missing = sum(1 for t in tracks if t.get('needs_relink'))
    if len(names) < 50:
        ctx.skip('the library has too few missing songs with unique names to build a reconnect folder')
    folder = Path(ctx.sandbox) / 'Music Back'
    synthetic_library.make_named_files(ctx.sandbox, folder, names)
    for _ in range(60):                       # a job from an earlier check may still be settling
        status, _, state = ctx.get('/api/windows/library/reconnect/status')
        if not (isinstance(state, dict) and state.get('state') in ('indexing', 'matching', 'saving')):
            break
        time.sleep(0.5)
    start = time.perf_counter()
    status, _, body = ctx.post('/api/windows/library/reconnect/start', json={'folder': str(folder)})
    if status != 200:
        return _label(fail('Reconnect Music did not start: %s' % (body.get('error') if isinstance(body, dict) else status)), info)
    state = body
    while time.perf_counter() - start < RECONNECT_BUDGET + 60:
        _, _, state = ctx.get('/api/windows/library/reconnect/status')
        if isinstance(state, dict) and state.get('state') in ('done', 'failed', 'cancelled'):
            break
        time.sleep(0.5)
    seconds = time.perf_counter() - start
    evidence = {'missing_songs': missing, 'files_in_folder': len(names),
                'job': {k: state.get(k) for k in ('state', 'missing', 'relinked', 'ambiguous', 'not_found', 'files_indexed', 'message', 'error')}}
    if state.get('state') != 'done':
        return _label(fail('Reconnect Music ended as "%s": %s' % (state.get('state'), state.get('error') or state.get('message')), seconds, RECONNECT_BUDGET, **evidence), info)
    if state.get('relinked', 0) < len(names):
        return _label(fail(f'only {state.get("relinked")} of the {len(names)} files in the folder were reconnected', seconds, RECONNECT_BUDGET, **evidence), info)
    if seconds > RECONNECT_BUDGET:
        return _label(fail(f'Reconnect Music took {seconds:.1f} s with {missing:,} missing songs', seconds, RECONNECT_BUDGET, **evidence), info)
    return _label(ok(seconds, RECONNECT_BUDGET, f'reconnected {state.get("relinked")} of {missing:,} missing songs in {seconds:.1f} s', **evidence), info)
