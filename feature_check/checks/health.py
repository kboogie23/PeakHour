"""Health checks: the Health page opens with its counts, and "Reconnect Music" opens the Windows reconnect window
(it used to re-run Health, or open Mac prompt() boxes asking for a /Volumes path), takes a folder and reconnects songs."""
import json
import re
import time
from pathlib import Path

from feature_check import synthetic_library
from feature_check.checks import (ok, fail, warn, open_app, need_browser, ensure_library, run_ok, shot, set_dialog_answers)

OPEN_BUDGET = 10.0
TRACKS_JS = "(document.getElementById('health-cockpit-metric-tracks')?.textContent||'').trim()"
COUNT_READY = "(()=>{const e=document.getElementById('health-cockpit-metric-tracks');return !!e&&__fc.visible(e)&&/^[0-9,]+$/.test(e.textContent.trim())&&e.textContent.trim()!=='0'})()"
SHOWN_JS = ("({tracks:" + TRACKS_JS + ",repairs:(document.getElementById('health-cockpit-metric-repairs')?.textContent||'').trim(),"
            "missing:(document.getElementById('health-approved-task-count')?.textContent||'').trim(),"
            "reconnect_buttons:[...document.querySelectorAll('button')].filter(b=>__fc.visible(b)&&__fc.label(b)==='Reconnect Music').length})")
RECONNECT_DIALOG = 'dialog.axiom-reconnect'
RECONNECT_FILES = 25


def _num(text):
    digits = re.sub(r'[^0-9]', '', text or '')
    return int(digits) if digits else None


def health_open(ctx):
    info = ensure_library(ctx)
    browser = need_browser(ctx)
    open_app(ctx, tab=None)
    run = browser.run([
        {'op': 'click', 'selector': '#tab-btn-health', 'required': True},
        {'op': 'until', 'expr': COUNT_READY, 'timeout': 60},
        {'op': 'eval', 'expr': SHOWN_JS, 'as': 'ui'},
        shot(ctx, 'health-open')])
    if not run.steps[0].get('ok'):
        return fail('could not open the Health tab: ' + run.steps[0].get('error', 'the click failed'), shots=run.shots)
    seconds = run.steps[0].get('seconds', 0) + run.steps[1].get('seconds', 0)
    ui = run.vars.get('ui') or {}
    evidence = {'shown': ui, 'library': info.get('library'), 'tracks_in_library': info.get('tracks'),
                'errors': [e['text'] for e in run.errors if e['kind'] == 'exception']}
    if not run.steps[1].get('ok'):
        return fail('Health did not show its counts (tracks checked: "%s") after %.0f s' % (ui.get('tracks', ''), seconds),
                    seconds, OPEN_BUDGET, run.shots, **evidence)
    status, _, stats = ctx.get('/api/library/stats')
    if status == 200 and isinstance(stats, dict) and stats.get('library_total_tracks') is not None:
        evidence['stats_total'] = stats['library_total_tracks']
        if _num(ui.get('tracks')) != stats['library_total_tracks']:
            return fail(f'Health says {ui.get("tracks")} tracks checked but the library has {stats["library_total_tracks"]}',
                        seconds, OPEN_BUDGET, run.shots, **evidence)
    if seconds > OPEN_BUDGET:
        return fail(f'Health took {seconds:.1f} s to show its counts', seconds, OPEN_BUDGET, run.shots, **evidence)
    return ok(seconds, OPEN_BUDGET, f'Health shows {ui.get("tracks")} tracks checked, {ui.get("repairs")} repairs', run.shots, **evidence)


def _missing_names(ctx, limit):
    """File names of the first `limit` library songs whose files are missing (short, unique names)."""
    cache = Path(ctx.sandbox) / 'AppData' / 'Local' / 'AXIOM DJ' / 'data' / 'library_cache.json'
    tracks = json.loads(cache.read_text(encoding='utf-8')).get('tracks', [])
    counts = {}
    for t in tracks:
        counts[(t.get('filename') or '').lower()] = counts.get((t.get('filename') or '').lower(), 0) + 1
    names = []
    for t in tracks:
        name = t.get('filename') or ''
        if t.get('needs_relink') and name and len(name) < 90 and counts[name.lower()] == 1 and not re.search(r'[<>:"/\\|?*]', name):
            names.append(name)
            if len(names) >= limit:
                break
    return names


def reconnect_music(ctx):
    info = ensure_library(ctx)
    browser = need_browser(ctx)
    names = _missing_names(ctx, RECONNECT_FILES)
    if len(names) < 5:
        ctx.skip('the library has too few missing songs to try Reconnect Music')
    folder = Path(ctx.sandbox) / 'Music Now'
    synthetic_library.make_named_files(ctx.sandbox, folder, names)
    set_dialog_answers(ctx, folder=str(folder))
    try:
        open_app(ctx, tab=None)
        run = browser.run([
            {'op': 'click', 'selector': '#tab-btn-health', 'required': True},
            {'op': 'until', 'expr': COUNT_READY, 'timeout': 60, 'required': True},
            {'op': 'until', 'expr': "[...document.querySelectorAll('button')].some(b=>__fc.visible(b)&&__fc.label(b)==='Reconnect Music')", 'timeout': 20},
            {'op': 'eval', 'expr': SHOWN_JS, 'as': 'ui'}])
        if not run.steps[0].get('ok') or not run.steps[1].get('ok'):
            run_ok(run, 'opening Health')
        if not (run.vars.get('ui') or {}).get('reconnect_buttons'):
            return fail('Health lists missing files but shows no "Reconnect Music" button', shown=run.vars.get('ui'))
        t0 = time.perf_counter()
        run = browser.run([
            {'op': 'click_text', 'text': 'Missing Files', 'exact': False, 'tags': 'summary', 'required': True},   # open the "03 Missing Files" row
            {'op': 'click_text', 'text': 'Reconnect Music', 'required': True},
            {'op': 'until', 'expr': f"document.querySelector('{RECONNECT_DIALOG}')?.open===true", 'timeout': 6},
            {'op': 'eval', 'expr': f"document.querySelector('{RECONNECT_DIALOG} h2')?.textContent||''", 'as': 'title'},
            {'op': 'eval', 'expr': f"document.querySelector('{RECONNECT_DIALOG}')?.innerText||''", 'as': 'text'},
            shot(ctx, 'reconnect-open')])
        for step in run.steps[:2]:
            if not step.get('ok'):
                return fail('could not press Reconnect Music: ' + step.get('error', ''), shots=run.shots)
        prompts = [d for d in run.dialogs]
        if prompts:
            return fail('Reconnect Music opened a %s box ("%s") instead of its own window' % (prompts[0]['kind'], prompts[0]['text'][:80]),
                        shots=run.shots, dialogs=prompts)
        if not run.steps[2].get('ok'):
            return fail('pressing Reconnect Music did not open a window (it only re-ran Health)', shots=run.shots)
        text = run.vars.get('text', '')
        if '/Volumes' in text or 'Finder' in text:
            return fail('the Reconnect Music window talks about Mac folders: ' + text[:120], shots=run.shots)
        done = browser.run([
            {'op': 'click_text', 'text': 'Choose folder or drive', 'within': RECONNECT_DIALOG, 'required': True},
            {'op': 'until', 'expr': "(document.querySelector('.axiom-reconnect-chosen strong')?.textContent||'').length>0", 'timeout': 10},
            {'op': 'eval', 'expr': "document.querySelector('.axiom-reconnect-chosen strong')?.textContent||''", 'as': 'chosen'},
            {'op': 'click_text', 'text': 'Start', 'within': RECONNECT_DIALOG, 'required': True},
            {'op': 'until', 'timeout': 90, 'expr': "(()=>{const r=document.querySelector('.axiom-reconnect-result');return !!r&&!r.hidden&&r.textContent.length>0})()"},
            {'op': 'eval', 'expr': "document.querySelector('.axiom-reconnect-result')?.textContent||''", 'as': 'summary'},
            shot(ctx, 'reconnect-done')])
        seconds = time.perf_counter() - t0
        evidence = {'library': info.get('library'), 'folder': str(folder), 'files_in_folder': len(names),
                    'chosen': done.vars.get('chosen'), 'summary': done.vars.get('summary')}
        shots = run.shots + done.shots
        if done.dialogs:
            return fail('a %s box appeared while reconnecting' % done.dialogs[0]['kind'], seconds, shots=shots, **evidence)
        bad = [s for s in done.steps[:6] if not s.get('ok')]
        if bad:
            return fail('Reconnect Music stopped at "%s": %s' % (bad[0]['op'], bad[0].get('error')), seconds, shots=shots, **evidence)
        if str(folder).lower() != str(done.vars.get('chosen', '')).lower():
            return fail('the window shows %r after choosing, expected %r' % (done.vars.get('chosen'), str(folder)), seconds, shots=shots, **evidence)
        summary = done.vars.get('summary', '')
        match = re.match(r'Reconnected ([0-9,]+) song', summary)
        if not match:
            return fail('the summary does not say how many songs were reconnected: %r' % summary, seconds, shots=shots, **evidence)
        reconnected = int(match.group(1).replace(',', ''))
        evidence['reconnected'] = reconnected
        _, _, status = ctx.get('/api/windows/library/reconnect/status')
        if isinstance(status, dict):
            evidence['status'] = {k: status.get(k) for k in ('state', 'missing', 'relinked', 'ambiguous', 'not_found')}
        browser.run([{'op': 'click_text', 'text': 'Close', 'within': RECONNECT_DIALOG}])
        if reconnected < len(names):
            return fail(f'only {reconnected} of {len(names)} songs found in the chosen folder were reconnected', seconds, shots=shots, **evidence)
        return ok(seconds, None, f'Reconnect Music chose the folder and reconnected {reconnected} songs, no prompt() box', shots, **evidence)
    finally:
        set_dialog_answers(ctx)
