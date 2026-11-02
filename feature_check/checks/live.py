"""Performance / Live Assist checks.

  follow_virtualdj  VirtualDJ is "running" (the fake process list) and the page sits on the Library tab. A song is
                    appended to VirtualDJ's History file; the page must pick it up on its own (the DJ Auto state the
                    Performance tab shows: performanceSeratoLastTrack, plus the 'VirtualDJ live: ...' toast).
                    It failed when the page only polled while the Performance tab was open.
  poll_cost         the live routes the page polls every few seconds must not re-read the whole library (46 MB on the
                    owner's PC): load_cache calls stay at 0 and the 95th percentile answer time stays under 100 ms."""
import shutil
import time
from pathlib import Path

from feature_check import media
from feature_check.checks import (ok, fail, warn, open_app, need_browser, ensure_library, shot, set_processes, p95,
                                  metrics_reset, is_quick)

FOLLOW_BUDGET = 10.0
POLL_P95_BUDGET = 0.100
COLD_WARN_S = 10.0       # the very first live answer may build the song index; more than this is worth a look
LIVE_ROUTES = ('/api/performance/dj/live', '/api/performance/live_assist/state')
STATE_JS = ("({auto:performanceSeratoEnabled===true,last:performanceSeratoLastTrack?.title||null,"
            "perfHidden:document.getElementById('tab-content-performance').classList.contains('hidden'),"
            "tab:window.axiomVisibleTab||''})")


def _local(ctx):
    return Path(ctx.sandbox) / 'AppData' / 'Local'


def _start_virtualdj(ctx, first=('Bananarama', 'Cruel Summer')):
    """A fake VirtualDJ home with one song already playing, and VirtualDJ in the fake process list."""
    ensure_library(ctx)
    home, history = media.make_vdj_home(_local(ctx), [(first[0], first[1], r'C:\Music\%s - %s.mp3' % first)], running_seconds_ago=30)
    set_processes(ctx, ['VirtualDJ'])
    return home, history


def _stop_virtualdj(ctx):
    set_processes(ctx, [])
    shutil.rmtree(_local(ctx) / 'VirtualDJ', ignore_errors=True)


def follow_virtualdj(ctx):
    browser = need_browser(ctx)
    home, history = _start_virtualdj(ctx)
    try:
        browser.run([{'op': 'navigate', 'url': '/', 'settle': 500},
                     {'op': 'eval', 'expr': "localStorage.removeItem('peakHourDjAutoUser')"}])   # no earlier "DJ Auto off" choice
        run = open_app(ctx, 'library', settle=3000, tab_wait=0.5)
        t0 = time.perf_counter()
        first = browser.run([
            {'op': 'until', 'expr': "typeof performanceSeratoEnabled!=='undefined'&&performanceSeratoEnabled===true", 'timeout': 12},
            {'op': 'until', 'expr': "performanceSeratoLastTrack?.title==='Cruel Summer'", 'timeout': FOLLOW_BUDGET},
            {'op': 'eval', 'expr': STATE_JS, 'as': 'state'}])
        before = first.vars.get('state') or {}
        evidence = {'before': before}
        if not first.steps[0].get('ok'):
            return fail('DJ Auto did not switch itself on while the page sits on the Library tab', time.perf_counter() - t0,
                        FOLLOW_BUDGET, browser.run([shot(ctx, 'live-no-auto')]).shots, **evidence)
        if not first.steps[1].get('ok'):
            return fail('the song already playing in VirtualDJ never reached the page', time.perf_counter() - t0, FOLLOW_BUDGET,
                        browser.run([shot(ctx, 'live-no-first')]).shots, **evidence)
        if not before.get('perfHidden'):
            return warn('the Performance tab is showing, so this did not test the page on another tab', **evidence)
        # a new song starts in VirtualDJ
        media.append_vdj_history(history, 'Bee Gees', 'Night Fever', r'C:\Music\Bee Gees - Night Fever.mp3')
        t1 = time.perf_counter()
        follow = browser.run([
            {'op': 'until', 'expr': "performanceSeratoLastTrack?.title==='Night Fever'", 'timeout': FOLLOW_BUDGET + 10},
            {'op': 'eval', 'expr': STATE_JS, 'as': 'state'},
            {'op': 'eval', 'expr': "document.body.innerText.includes('VirtualDJ live: Night Fever')", 'as': 'toast'},
            shot(ctx, 'live-follow')])
        seconds = time.perf_counter() - t1
        evidence.update(after=follow.vars.get('state'), toast=follow.vars.get('toast'),
                        errors=[e['text'] for e in run.errors if e['kind'] == 'exception'])
        if not follow.steps[0].get('ok'):
            return fail('a new song in VirtualDJ never reached the page while it showed the Library tab', seconds, FOLLOW_BUDGET,
                        follow.shots, **evidence)
        if seconds > FOLLOW_BUDGET:
            return fail(f'the page needed {seconds:.1f} s to follow VirtualDJ', seconds, FOLLOW_BUDGET, follow.shots, **evidence)
        return ok(seconds, FOLLOW_BUDGET, 'the page followed VirtualDJ to "Night Fever" with the Performance tab hidden',
                  follow.shots, **evidence)
    finally:
        _stop_virtualdj(ctx)


def poll_cost(ctx):
    info = ensure_library(ctx)
    seconds_total = 15 if is_quick(ctx) else 60
    _start_virtualdj(ctx)
    try:
        if ctx.browser is not None:   # no page open: only this check's own requests reach the server
            ctx.browser.run([{'op': 'navigate', 'url': 'about:blank', 'settle': 0}])
        # the first answer may have to read the library once (it is kept afterwards); time it on its own
        warm = {}
        for route in LIVE_ROUTES:
            t = time.perf_counter()
            ctx.get(route, timeout=600)
            warm[route.rsplit('/', 1)[-1]] = round(time.perf_counter() - t, 2)
        metrics_reset(ctx)
        times = {route: [] for route in LIVE_ROUTES}
        bad = []
        end = time.perf_counter() + seconds_total
        while time.perf_counter() < end:
            tick = time.perf_counter()
            for route in LIVE_ROUTES:
                t = time.perf_counter()
                status, _, body = ctx.get(route)
                times[route].append(time.perf_counter() - t)
                if status >= 400:
                    bad.append((route, status))
            time.sleep(max(0.0, 1.0 - (time.perf_counter() - tick)))
        metrics = ctx.metrics()
        loads = metrics.get('load_cache_calls', 0)
        worst = max((p95(v) for v in times.values()), default=0.0)
        evidence = {'library': info.get('library'), 'tracks': info.get('tracks'), 'seconds_polled': seconds_total,
                    'load_cache_calls': loads, 'first_answer_s': warm,
                    'p95_ms': {r.rsplit('/', 1)[-1]: round(p95(v) * 1000, 1) for r, v in times.items()},
                    'slowest_ms': round(max(max(v) for v in times.values()) * 1000, 1),
                    'requests': sum(len(v) for v in times.values()), 'bad_status': bad[:3]}
        if bad:
            return fail('live route %s answered with status %s' % bad[0], worst, POLL_P95_BUDGET, **evidence)
        if loads:
            return fail(f'polling the live routes re-read the whole library {loads} times in {seconds_total} s',
                        worst, POLL_P95_BUDGET, **evidence)
        if worst > POLL_P95_BUDGET:
            return fail(f'live poll p95 is {worst * 1000:.0f} ms (limit {POLL_P95_BUDGET * 1000:.0f} ms)',
                        worst, POLL_P95_BUDGET, **evidence)
        if max(warm.values()) > COLD_WARN_S:
            return warn(f'polls are fast after the first answer, but the first one needed {max(warm.values()):.0f} s to read the library '
                        f'(p95 afterwards {worst * 1000:.0f} ms)', worst, POLL_P95_BUDGET, **evidence)
        return ok(worst, POLL_P95_BUDGET,
                  f'{evidence["requests"]} polls in {seconds_total} s: no library re-read, p95 {worst * 1000:.0f} ms', **evidence)
    finally:
        _stop_virtualdj(ctx)
