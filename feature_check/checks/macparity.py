"""Mac-only features must not show on Windows (windows-hide-mac.js). There is nothing to "work" here: the check is that
each Mac-only control is hidden where a user would look for it, and FAIL if one is on screen.

  accessibility   "Allow access" for Command-F through macOS Accessibility: Settings, Performance and Live Assist
  app_store_updates  Check For Updates (Mac App Store) in Settings
  quit            Quit AXIOM (the Mac app's native bridge) in Settings
  lite_import     AXIOM Lite import in Settings
  account         Account & License in Settings, the licence window and the first sign-in window

A hidden control is reported N/A ("hidden: confirmed"): there is nothing to run, and nothing visible to confuse a DJ."""
import json

from feature_check.checks import ok, fail, warn, not_applicable, open_app, need_browser, shot

SETTINGS_OPEN = "[...document.querySelectorAll('#settings-content .settings-item')].some(__fc.visible)"
# how an element is hidden, or why it shows: [{where, visible, how, text}]
PROBE = r"""((selector, closest) => [...document.querySelectorAll(selector)].map(e => {
  const target = (closest && e.closest(closest)) || e;
  const s = getComputedStyle(target);
  const how = target.classList.contains('ph-hidden') ? 'ph-hidden' : target.hidden ? 'hidden attribute' : target.classList.contains('hidden') ? 'hidden class'
            : s.display === 'none' ? 'display none' : '';
  return {visible: __fc.visible(target) && !how, how: how || (__fc.visible(target) ? 'shown' : 'not drawn'), text: __fc.label(target).slice(0, 60), id: target.id || ''};
}))"""


def _open_settings(ctx, browser):
    run = browser.run([{'op': 'click', 'selector': '#settings-toggle', 'required': True},
                       {'op': 'until', 'expr': SETTINGS_OPEN, 'timeout': 8}, {'op': 'sleep', 'seconds': 1}])
    return run.steps[-2].get('ok')


def _verdict(ctx, name, found, shots):
    """found: list of (where, selector, [probe rows])."""
    rows = [(where, row) for where, selector, probes in found for row in probes]
    shown = [(w, r) for w, r in rows if r['visible']]
    evidence = {'looked_in': [w for w, _, _ in found], 'elements': [{'where': w, **r} for w, r in rows]}
    if shown:
        w, r = shown[0]
        return fail(f'{name} is visible on Windows in {w}: "{r["text"]}"', shots=shots, **evidence)
    if not rows:
        return not_applicable(f'{name}: not in the page at all', shots, **evidence)
    return not_applicable('hidden: confirmed (%s)' % ', '.join(sorted({r['how'] for _, r in rows})), shots, **evidence)


def _settings_probe(ctx, name, selector, closest=None):
    browser = need_browser(ctx)
    open_app(ctx, 'library')
    if not _open_settings(ctx, browser):
        return warn('the Settings panel did not open, so %s could not be looked for' % name)
    found = [('Settings', selector, _probe(browser, selector, closest))]
    shots = browser.run([shot(ctx, 'mac-' + name.split()[0].lower())]).shots
    browser.run([{'op': 'press', 'key': 'Escape'}])
    return _verdict(ctx, name, found, shots)


def _probe(browser, selector, closest=None):
    run = browser.run([{'op': 'eval', 'expr': f"({PROBE})({json.dumps(selector)}, {json.dumps(closest)})", 'as': 'p'}])
    if not run.steps[0].get('ok'):
        raise RuntimeError('could not look for %s: %s' % (selector, run.steps[0].get('error')))
    return run.vars.get('p') or []


def accessibility(ctx):
    browser = need_browser(ctx)
    open_app(ctx, 'performance')
    found = [('Performance', '#performance-search-access', _probe(browser, '#performance-search-access'))]
    shots = browser.run([shot(ctx, 'mac-accessibility')]).shots
    if _open_settings(ctx, browser):
        found.append(('Settings', '#settings-performance-accessibility', _probe(browser, '#settings-performance-accessibility')))
        browser.run([{'op': 'press', 'key': 'Escape'}])
    else:
        return warn('the Settings panel did not open, so its Command-F access item could not be looked for')
    browser.run([{'op': 'navigate', 'url': '/live_assist_window?popup=1', 'settle': 2500}])
    found.append(('Live Assist window', '#assist-search-access', _probe(browser, '#assist-search-access')))
    return _verdict(ctx, 'Command-F through macOS Accessibility', found, shots)


def app_store_updates(ctx):
    return _settings_probe(ctx, 'Check For Updates (Mac App Store)', '[onclick^="checkForAxiomUpdate"]', '.settings-item')


def quit_button(ctx):
    return _settings_probe(ctx, 'Quit AXIOM (the Mac app bridge)', '[onclick^="quitAxiomApp"]', '.settings-item')


def lite_import(ctx):
    return _settings_probe(ctx, 'AXIOM Lite import', '#lite-migration-settings-item')


def account(ctx):
    browser = need_browser(ctx)
    open_app(ctx, 'library')
    if not _open_settings(ctx, browser):
        return warn('the Settings panel did not open, so Account & License could not be looked for')
    found = [('Settings heading', 'Account & License', [r for r in _probe(browser, '#settings-content h3') if r['text'] == 'Account & License']),
             ('licence / sign-in windows', '#license-modal, #first-login-preview', _probe(browser, '#license-modal, #first-login-preview'))]
    shots = browser.run([shot(ctx, 'mac-account')]).shots
    browser.run([{'op': 'press', 'key': 'Escape'}])
    return _verdict(ctx, 'Account & Licence', found, shots)
