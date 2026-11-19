"""Library checks: a song plays when you press its play button, and clicking a song opens Track Information quickly.

What they watch is what the owner sees:
  play preview   click the play button on a song's artwork, then ask the audio engine (GET /api/audio/status, the same
                 route the page polls) whether that file is now playing;
  Track Information   click a song, wait until the window stops saying "Checking Source File..." (on a 50,000-song
                 external-drive library it used to hang there for minutes)."""
import json
import os
import re
import time

from feature_check.checks import (ok, fail, warn, open_app, need_browser, ensure_library, run_ok, shot, route_seconds,
                                  metrics_reset, library_info, library_tracks, is_real)

PLAY_BUDGET = 3.0        # seconds from the click to "playing"
INFO_BUDGET = 5.0        # seconds from the click to the end of "Checking Source File..."
SEARCH_REAL = {'op': 'type', 'selector': '#main-search', 'text': 'real song', 'clear': True,
               'mutation_selector': '#search-results'}
CONNECTED_ROW = '#search-results .library-track-card:not(.library-track-missing-file)'


def _has_real_songs(ctx):
    info = library_info(ctx)
    return bool(info and info.get('library') == 'synthetic')


AUDIO_EXTENSIONS = ('.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.aif', '.aiff')


def _real_candidates(ctx, count=4):
    """Real library songs whose file exists on this PC (checked here, read only), with an audio extension and a title that is
    unique in the library - so searching for the title finds exactly that song."""
    tracks = library_tracks(ctx)
    titles = {}
    for t in tracks:
        key = (t.get('title') or '').strip().lower()
        titles[key] = titles.get(key, 0) + 1
    found = []
    for t in tracks:
        path = t.get('path') or ''
        title = (t.get('title') or '').strip()
        if (path.lower().endswith(AUDIO_EXTENSIONS) and not t.get('needs_relink') and 4 <= len(title) <= 40 and re.fullmatch(r'[A-Za-z0-9 ]+', title) and titles.get(title.lower()) == 1
                and os.path.isfile(path)):
            found.append((path, title))
            if len(found) >= count:
                break
    return found


def play_preview(ctx):
    ensure_library(ctx)
    browser = need_browser(ctx)
    real = is_real(ctx)
    budget = 8.0 if real else PLAY_BUDGET      # a real file on an external drive may wake the disk first
    candidates = _real_candidates(ctx) if real else []
    if real and not candidates:
        ctx.skip('no song in the real library has an audio file that exists on this PC')
    wanted, shown = None, None
    for path, title in (candidates or [(None, None)]):
        steps = [SEARCH_REAL] if _has_real_songs(ctx) else []
        if real:
            steps = [{'op': 'type', 'selector': '#main-search', 'text': title, 'clear': True, 'mutation_selector': '#search-results'}]
        run = open_app(ctx, 'library', extra_steps=steps)
        if not real:
            break
        row = ("[...document.querySelectorAll('#search-results .library-track-card')].find(r=>(r.dataset.path||'').toLowerCase()==="
               + json.dumps(path.lower()) + ")")
        got = browser.run([{'op': 'until', 'expr': f"!!({row})", 'timeout': 20},
                           {'op': 'eval', 'expr': f"(()=>{{const r={row};if(r)r.setAttribute('data-fc-pick','1');return !!r}})()", 'as': 'tagged'}])
        if got.vars.get('tagged'):
            wanted, shown = path, title
            break
    if real and not wanted:
        shots = browser.run([shot(ctx, 'play-real-not-found')]).shots
        return fail('searched for the titles of %d real songs that exist on this PC, and none showed in the Library list' % len(candidates),
                    shots=shots, tried=[t for _, t in candidates])
    pick = '#search-results .library-track-card[data-fc-pick="1"]' if real else CONNECTED_ROW
    # a song whose file is on this PC (the rest of the library lives on an unplugged drive)
    found = browser.run([{'op': 'until', 'expr': f"!!document.querySelector('{pick} .library-artwork')", 'timeout': 10},
                         {'op': 'eval', 'expr': f"document.querySelector('{pick}')?.dataset.path || ''", 'as': 'path'}])
    path = found.vars.get('path')
    if not found.steps[0].get('ok') or not path:
        shots = browser.run([shot(ctx, 'play-no-song')]).shots
        return warn('no song in the library list has its file on this PC, so nothing could be played', shots=shots)
    metrics_reset(ctx)
    ctx.post('/api/audio/stop', json={'reason': 'feature_check'})
    start = time.perf_counter()
    click = browser.run([{'op': 'click', 'selector': f'{pick} .library-artwork', 'required': True}])
    run_ok(click, 'pressing play on a song')
    status, deadline = {}, start + 10
    while time.perf_counter() < deadline:
        _, _, status = ctx.get('/api/audio/status')
        if isinstance(status, dict) and status.get('playing') and str(status.get('path', '')).lower() == path.lower():
            break
        if isinstance(status, dict) and status.get('error'):
            break
        time.sleep(0.1)
    seconds = time.perf_counter() - start
    playing = isinstance(status, dict) and bool(status.get('playing')) and str(status.get('path', '')).lower() == path.lower()
    shots = browser.run([shot(ctx, 'play-preview')]).shots
    ctx.post('/api/audio/stop', json={'reason': 'feature_check'})
    evidence = {'file': path, 'audio_status': status, 'dialogs': [d['text'] for d in run.dialogs]}
    if not playing:
        reason = (status.get('error') if isinstance(status, dict) and status.get('error') else
                  'the song did not start playing after pressing its play button')
        return fail(reason, seconds, budget, shots, **evidence)
    if seconds > budget:
        return fail(f'play took {seconds:.1f} s to start', seconds, budget, shots, **evidence)
    return ok(seconds, budget, 'the song is playing', shots, **evidence)


def _wait_for_source_check(browser, click_steps, ctx, name):
    """Click, wait for the Track Information window and for 'Checking Source File...' to go. Returns (seconds, text, run)."""
    steps = click_steps + [
        {'op': 'until', 'expr': "!!document.getElementById('library-track-prep-modal')", 'timeout': 20},
        {'op': 'until', 'timeout': 40, 'expr': "(()=>{const b=document.getElementById('library-track-prep-scan-all');"
                                               "return !!b&&!/Checking Source File/i.test(b.textContent)})()"},
        {'op': 'eval', 'expr': "document.getElementById('library-track-prep-scan-all')?.textContent||''", 'as': 'button'},
        {'op': 'eval', 'expr': "document.getElementById('library-track-prep-status')?.textContent||''", 'as': 'status'},
        shot(ctx, name)]
    run = browser.run(steps)
    n = len(click_steps)
    seconds = sum(s.get('seconds', 0) for s in run.steps[:n + 2])
    return seconds, run


def track_info(ctx):
    info = ensure_library(ctx)
    browser = need_browser(ctx)
    open_app(ctx, 'library')
    metrics_reset(ctx)
    cases = []
    # 1. a song whose file is not there (the drive is unplugged): the case that hung
    missing_sel = '#search-results .library-track-missing-file .library-track-main'
    probe = browser.run([{'op': 'eval', 'expr': f"!!document.querySelector('{missing_sel}')", 'as': 'has'}])
    if probe.vars.get('has'):
        seconds, run = _wait_for_source_check(browser, [{'op': 'click', 'selector': missing_sel, 'required': True}], ctx, 'track-info-missing')
        cases.append(('song on a missing drive', seconds, run))
        browser.run([{'op': 'click', 'selector': '.library-track-prep-close'}, {'op': 'sleep', 'seconds': 0.4}])
    # 2. a song whose file is there: its Key button opens the same window
    if _has_real_songs(ctx):
        browser.run([SEARCH_REAL, {'op': 'until', 'expr': f"!!document.querySelector('{CONNECTED_ROW}')", 'timeout': 10}])
    probe = browser.run([{'op': 'eval', 'expr': f"!!document.querySelector('{CONNECTED_ROW} .camelot-pill')", 'as': 'has'}])
    if probe.vars.get('has'):
        seconds, run = _wait_for_source_check(browser, [{'op': 'click', 'selector': f'{CONNECTED_ROW} .camelot-pill', 'required': True}],
                                              ctx, 'track-info-connected')
        cases.append(('song with its file', seconds, run))
        browser.run([{'op': 'click', 'selector': '.library-track-prep-close'}])
    if not cases:
        return warn('there is no song row to click in the Library list')
    metrics = ctx.metrics()
    server_s, calls = route_seconds(metrics, '/api/library/track')
    evidence = {'library': info.get('library'), 'tracks': info.get('tracks'), 'server_slowest_track_route_s': round(server_s, 3),
                'track_route_calls': calls}
    shots, worst = [], 0.0
    for name, seconds, run in cases:
        worst = max(worst, seconds)
        shots += run.shots
        failed = [i for i, s in enumerate(run.steps[:3]) if not s.get('ok')]
        if failed:
            why = {0: run.steps[0].get('error', 'the click did not work'), 1: 'the Track Information window never opened',
                   2: 'still showing "Checking Source File..." after %.0f s' % seconds}[failed[0]]
            return fail(f'{name}: {why}', seconds, INFO_BUDGET, shots, **evidence)
        if seconds > INFO_BUDGET:
            return fail(f'{name}: Track Information needed {seconds:.1f} s before "Checking Source File..." went away',
                        seconds, INFO_BUDGET, shots, **evidence)
    return ok(worst, INFO_BUDGET, 'Track Information is ready: ' + ', '.join('%s %.1f s' % (n, s) for n, s, _ in cases), shots, **evidence)
