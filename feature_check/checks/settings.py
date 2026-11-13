"""Settings-area checks: day (light) mode is readable, and no update popup appears while updates are off.

  day_mode_readable  presses the Day / Night button, then measures the contrast of every piece of visible text in the
                     sidebar, the Library list, Studio and Performance. Under 3:1 is unreadable (FAIL).
  no_update_popup    loads the app and watches ten seconds: no update window may open, and the update route must say
                     updates are not configured (PEAK HOUR has no Mac App Store / AXIOM update feed)."""
from feature_check.checks import (ok, fail, warn, open_app, need_browser, ensure_library, shot, route_seconds, metrics_reset)
from feature_check.js_contrast import SCAN, parse_colour, worst_ratio

MIN_CONTRAST = 3.0
REGIONS = [  # (name, tab, element to measure)
    ('sidebar', 'library', '#axiom-sidebar'),
    ('library list', 'library', '#tab-content-library'),
    ('studio', 'studio', '#tab-content-studio'),
    ('performance', 'performance', '#tab-content-performance'),
]
LIGHT = "document.body.classList.contains('light-mode')"


def _really_unreadable(browser, failure):
    """The CSS says this text is hard to read; measure the picture: hide the text, look at what is drawn behind it."""
    l, t, r, b = failure['box']
    box = [max(0, l - 3), max(0, t - 3), r + 3, b + 3]
    mark = '[data-fc-scan="%s"]' % failure['n']
    hide = ("(()=>{const e=document.querySelector(%r);if(!e)return false;e.dataset.fcStyle=e.getAttribute('style')||'';"
            "e.style.cssText+=';color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important';return true})()" % mark)
    show = "(()=>{const e=document.querySelector(%r);if(e)e.setAttribute('style',e.dataset.fcStyle||'')})()" % mark
    run = browser.run([{'op': 'eval', 'expr': hide}, {'op': 'region_colors', 'box': box, 'as': 'palette'}, {'op': 'eval', 'expr': show}])
    palette = run.vars.get('palette')
    if not palette:
        return True                       # cannot look: keep the CSS verdict
    fill = failure.get('fill') or ''
    colour = parse_colour(fill if fill and 'rgba(0, 0, 0, 0)' not in fill else failure['color'])
    measured = worst_ratio(colour, palette)
    failure['css_ratio'] = failure['ratio']
    failure['ratio'] = round(measured, 2)
    failure['background'] = 'rgb(%d,%d,%d)' % tuple(round(x) for x in palette[0]['color'])
    return measured < MIN_CONTRAST


def day_mode_readable(ctx):
    ensure_library(ctx)
    browser = need_browser(ctx)
    open_app(ctx, 'library')
    try:
        # the Day / Night button, as a user presses it (core's toggleTheme: the same call color-laws.js and the app share)
        steps = []
        if browser.eval(LIGHT):
            steps += [{'op': 'click', 'selector': '#theme-toggle'}, {'op': 'sleep', 'seconds': 0.5}]     # start from night
        steps += [{'op': 'click', 'selector': '#theme-toggle', 'required': True}, {'op': 'sleep', 'seconds': 1},
                  {'op': 'until', 'expr': LIGHT, 'timeout': 5}]
        run = browser.run(steps)
        if not run.steps[-1].get('ok'):
            return fail('the Day / Night button did not switch to day mode', shots=run.shots)
        problems, evidence, shots, checked = [], {}, [], 0
        for name, tab, selector in REGIONS:
            run = browser.run([{'op': 'click', 'selector': {'library': '#tab-btn-library', 'studio': '#tab-btn-studio',
                                                            'performance': '#tab-btn-performance'}[tab], 'required': True},
                               {'op': 'sleep', 'seconds': 1.5},
                               {'op': 'eval', 'expr': f'({SCAN})({selector!r}, {{}})', 'as': 'scan'},
                               shot(ctx, 'day-' + name.replace(' ', '-'))])
            shots += run.shots
            scan = run.vars.get('scan') or {'error': (run.failed() or ['no result'])[0]}
            if scan.get('error'):
                return warn(f'could not measure the {name}: {scan["error"]}', shots=shots, **evidence)
            checked += scan['checked']
            confirmed = [f for f in scan['failures'] if _really_unreadable(browser, f)]       # check the drawn pixels, not just the CSS
            evidence[name] = {'texts': scan['checked'], 'unreadable': len(confirmed), 'unmeasured': scan['unknown'],
                              'css_suspects': scan['failure_count']}
            for f in confirmed:
                problems.append((name, f))
        if checked == 0:
            return warn('no visible text was measured', shots=shots, **evidence)
        if problems:
            sample = problems[:8]
            evidence['unreadable_text'] = [dict(region=n, **f) for n, f in sample]
            name, worst = problems[0]
            return fail(f'{len(problems)} pieces of text are under {MIN_CONTRAST}:1 in day mode; worst: "{worst["text"]}" in the {name} '
                        f'({worst["ratio"]}:1, {worst["color"]} on {worst["background"]})', 0.0, None, shots, **evidence)
        return ok(0.0, None, f'day mode: {checked} pieces of text measured, all at {MIN_CONTRAST}:1 or better', shots, **evidence)
    finally:
        try:
            if browser.eval(LIGHT):
                browser.run([{'op': 'click', 'selector': '#theme-toggle'}])        # leave the profile in night mode
        except Exception:
            pass


def no_update_popup(ctx):
    browser = need_browser(ctx)
    metrics_reset(ctx)
    run = browser.run([{'op': 'stub_dialogs'}, {'op': 'collect_errors'}, {'op': 'collect_network'},
                       {'op': 'navigate', 'url': '/', 'settle': 500},
                       {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 2},
                       # ten seconds in which an update window must not open
                       {'op': 'until', 'timeout': 10, 'expr': "document.getElementById('update-modal')?.classList.contains('active')===true"
                                                              "||[...document.querySelectorAll('dialog[open],[role=dialog]')].some(d=>__fc.visible(d)&&/update/i.test(d.innerText||''))"},
                       {'op': 'eval', 'expr': "({modal:document.getElementById('update-modal')?.classList.contains('active')===true,"
                                              "text:document.getElementById('update-modal')?.innerText?.slice(0,160)||''})", 'as': 'modal'},
                       shot(ctx, 'updates')])
    popup = run.steps[5].get('ok')
    status, _, body = ctx.get('/api/app/check_update')
    metrics = ctx.metrics()
    _, asked = route_seconds(metrics, '/api/app/check_update')
    evidence = {'update_route': {k: body.get(k) for k in ('updates_configured', 'update_available')} if isinstance(body, dict) else body,
                'page_asked_for_updates': asked, 'dialogs': [d['text'][:80] for d in run.dialogs]}
    if popup or (run.vars.get('modal') or {}).get('modal'):
        return fail('an update window opened within 10 s of loading: ' + (run.vars.get('modal') or {}).get('text', '')[:100],
                    shots=run.shots, **evidence)
    if run.dialogs:
        return fail('a %s box appeared on load: %s' % (run.dialogs[0]['kind'], run.dialogs[0]['text'][:100]), shots=run.shots, **evidence)
    if status != 200 or not isinstance(body, dict) or body.get('updates_configured') is not False:
        return fail('the update route does not say updates are off (updates_configured should be false)', shots=run.shots, **evidence)
    return ok(10.0, None, 'no update window in 10 s; the update route says updates are not configured', run.shots, **evidence)
