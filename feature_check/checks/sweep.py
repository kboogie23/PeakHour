"""Click-through sweep and idle smoothness.

  sweep            visits every tab and clicks every visible, enabled button (one of each kind) except a deny list, with
                   prompt / alert / confirm boxes recorded instead of shown. It reports what a DJ would hit:
                     FAIL  a box or text mentioning /Volumes, Finder, the Command key, Mac App Store or macOS;
                     FAIL  an uncaught JavaScript error;  FAIL  a 5xx answer;
                     WARN  a 4xx answer, a prompt() box, console errors, a button that did nothing within 2 s.
  idle_smoothness  leaves the Library tab alone for 30 s (10 s in the quick run) and counts main-thread stalls: more
                   than 3 stalls over 200 ms is FAIL (a page that re-reads the library on every poll stutters)."""
import json
import re
import time

from feature_check.checks import ok, fail, warn, open_app, need_browser, ensure_library, shot, is_quick

MAC_WORDS = re.compile(r'/Volumes|Finder|⌘|Mac App Store|macOS')
# labels and handler names the sweep never presses (they delete, publish, pay or end the session)
DENY = ('remove', 'delete', 'reset', 'quit', 'publish', 'write to', 'clear library', 'sign out', 'purchase', 'buy',
        # also left alone: long jobs that would hold the library for later checks, and buttons that open other programs
        'purge', 'scan', 'rescan', 'fix health', 'repair', 'apply', 'archive', 'rename', 'trash', 'detox', 'merge',
        'recycle', 'move to', 'play saved', 'play recording', 'open recording', 'reveal', 'show in explorer', 'open folder', 'open backups', 'open live assist', 'live assist window', 'logout', 'sign-out')
BENIGN_4XX = ('/api/library/artwork', '/favicon.ico')   # a song without a cover answers 404
STALL_MS, STALL_LIMIT = 200, 3

TABS = [('library', '#tab-btn-library'), ('studio', '#tab-btn-studio'), ('performance', '#tab-btn-performance'),
        ('health', '#tab-btn-health'), ('playlists', None), ('settings', '#settings-toggle')]

LIST_JS = r"""((deny, limit, inSettings) => {
  const denyRe = new RegExp(deny.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  const out = [], skipped = [], kinds = new Set(), perContainer = new Map();
  document.querySelectorAll('[data-fc-sweep]').forEach(e => e.removeAttribute('data-fc-sweep'));
  const scope = inSettings ? (document.getElementById('settings-content') || document) : document;
  for (const el of scope.querySelectorAll('button,[role=button],summary,input[type=button],input[type=submit],a[href]')) {
    if (!__fc.visible(el) || __fc.disabled(el)) continue;
    if (el.closest('#axiom-sidebar,.axiom-sidebar,#update-modal,#license-modal')) continue;     // the visit itself switches tabs
    if (!inSettings && el.closest('#settings-content')) continue;
    if (el.tagName === 'A') { const h = el.getAttribute('href') || ''; if (!h.startsWith('#') && !h.startsWith('/') || el.target === '_blank' || /\/(download|api)\//.test(h)) continue; }
    const label = __fc.label(el).replace(/\s+/g, ' ').slice(0, 60);
    const handler = (el.getAttribute('onclick') || '').replace(/'[^']*'|"[^"]*"|`[^`]*`|[0-9.]+/g, '');
    const text = [label, handler.split('(')[0], el.getAttribute('aria-label') || '', el.title || ''].join(' ');
    if (denyRe.test(text)) { skipped.push(label); continue; }
    const row = el.closest('[data-path],tr,li,article');
    if (row) { const n = (perContainer.get(row.tagName + (row.className || '')) || new Set()); n.add(row); perContainer.set(row.tagName + (row.className || ''), n);
               if ([...n].indexOf(row) > 1) continue; }                                         // two rows of a list are enough
    const kind = label.replace(/[0-9]+/g, '#').toLowerCase() + '|' + handler;
    if (kinds.has(kind)) continue;
    kinds.add(kind);
    if (out.length >= limit) break;
    el.setAttribute('data-fc-sweep', String(out.length));
    out.push({i: out.length, label, handler: handler.slice(0, 50)});
  }
  return {buttons: out, skipped: skipped.slice(0, 40)};
})"""


def _open_tab(browser, ctx, tab, selector):
    """Fresh page on the tab; True when it opened."""
    steps = [{'op': 'navigate', 'url': '/', 'settle': 2000}, {'op': 'click_text', 'text': 'Skip Tour', 'timeout': 1.5}]
    if tab == 'playlists':
        steps.append({'op': 'eval', 'expr': "typeof showTab==='function'&&(showTab('playlists'),true)"})   # the Playlists menu has no tab button of its own
    else:
        steps.append({'op': 'click', 'selector': selector})
    steps.append({'op': 'sleep', 'seconds': 1.8})
    run = browser.run(steps)
    return run.steps[2].get('ok'), run


def _bump(table, key, **row):
    entry = table.setdefault(key, dict(row, count=0))
    entry['count'] += 1
    return entry


def sweep(ctx):
    ensure_library(ctx)
    browser = need_browser(ctx)
    quick = is_quick(ctx)
    per_tab = 5 if quick else 40
    wait_ms = 1000 if quick else 2000
    t0 = time.perf_counter()
    mac, js_errors, console, server_errors, client_errors, dead, dialogs = {}, {}, {}, {}, {}, [], {}
    visited, clicked, skipped_labels, unopened = {}, 0, [], []
    for tab, selector in TABS:
        opened, run = _open_tab(browser, ctx, tab, selector)
        if not opened:
            unopened.append(tab)
            continue
        listing = browser.run([{'op': 'stub_dialogs'}, {'op': 'collect_errors'}, {'op': 'collect_network'},
                               {'op': 'eval', 'expr': f'({LIST_JS})({json.dumps(list(DENY))}, {per_tab}, {json.dumps(tab == "settings")})', 'as': 'list'}])
        found = listing.vars.get('list') or {'buttons': [], 'skipped': []}
        skipped_labels += found['skipped']
        # text already on the page before any click
        base = browser.run([{'op': 'eval', 'expr': "(()=>{const re=/\\/Volumes|Finder|\\u2318|Mac App Store|macOS/g;const t=document.body.innerText||'';const o=[];let m;while((m=re.exec(t))&&o.length<5)o.push({match:m[0],context:t.slice(Math.max(0,m.index-50),m.index+60).replace(/\\s+/g,' ')});return o})()", 'as': 'hits'}])
        for h in base.vars.get('hits') or []:
            _bump(mac, (tab, h['match'], h['context']), where=tab, source='page text', text=h['context'])
        visited[tab] = len(found['buttons'])
        pending = list(found['buttons'])
        while pending:
            batch, pending = pending[:8], pending[8:]
            steps = [{'op': 'probe_click', 'selector': f'[data-fc-sweep="{b["i"]}"]', 'timeout': 1.5, 'wait_ms': wait_ms, 'after_ms': 250,
                      'noise_ms': 250} for b in batch]
            result = browser.run(steps, timeout=300)
            clicked += len(batch)
            lost = False
            for button, step in zip(batch, result.steps):
                label = button['label'] or button['handler'] or '(no label)'
                if not step.get('ok'):
                    if 'covered' in str(step.get('error')) or 'not found' in str(step.get('error')):
                        lost = True       # the page changed under us (a menu, a modal or another tab): not a fault of the button
                    continue
                if step.get('changed') is False:
                    dead.append(f'{tab}: {label}')
                for d in step.get('dialogs') or []:
                    _bump(dialogs, (tab, label, d['kind'], d['text']), where=tab, button=label, kind=d['kind'], text=d['text'])
                    if MAC_WORDS.search(d['text']):
                        _bump(mac, (tab, label, d['text']), where=tab, button=label, source='%s box' % d['kind'], text=d['text'])
                for h in step.get('hits') or []:
                    _bump(mac, (tab, label, h['match']), where=tab, button=label, source='page text', text=h['context'])
                for e in step.get('new_errors') or []:
                    table = js_errors if e['kind'] == 'exception' else console
                    _bump(table, (tab, label, e['text'][:120]), where=tab, button=label, text=e['text'][:200])
            for n in result.network:
                path = n['url'].split('?')[0].replace('http://127.0.0.1:%d' % ctx.port, '')
                if n['status'] >= 500:
                    _bump(server_errors, (n['method'], path, n['status']), where=tab, route=path, status=n['status'])
                elif n['status'] >= 400 and not path.startswith(BENIGN_4XX):
                    _bump(client_errors, (n['method'], path, n['status']), where=tab, route=path, status=n['status'])
            if lost and pending:
                reopened, _ = _open_tab(browser, ctx, tab, selector)      # start again on the tab, then carry on with the rest
                if not reopened:
                    break
                browser.run([{'op': 'stub_dialogs'}, {'op': 'eval', 'expr': f'({LIST_JS})({json.dumps(list(DENY))}, {per_tab}, {json.dumps(tab == "settings")})'}])
        shots = browser.run([shot(ctx, 'sweep-' + tab)]).shots
        visited[tab] = {'buttons': visited[tab], 'shot': shots[0] if shots else ''}
    seconds = time.perf_counter() - t0
    # runtime errors from the opening of the pages themselves
    boot = browser.run([{'op': 'collect_errors'}])
    for e in (boot.steps[0].get('value') or []):
        if e['kind'] == 'exception':
            _bump(js_errors, ('page', '', e['text'][:120]), where='page load', button='', text=e['text'][:200])
    evidence = {'tabs': visited, 'buttons_pressed': clicked, 'left_alone': sorted(set(skipped_labels))[:25],
                'could_not_open': unopened,
                'mac_text': list(mac.values())[:12], 'js_errors': list(js_errors.values())[:12], 'server_5xx': list(server_errors.values())[:10],
                'client_4xx': list(client_errors.values())[:15], 'boxes': list(dialogs.values())[:15],
                'console_errors': list(console.values())[:10], 'did_nothing': dead[:20]}
    problems = []
    if mac:
        first = next(iter(mac.values()))
        problems.append('%d Mac wording hit%s, e.g. %s: "%s"' % (len(mac), '' if len(mac) == 1 else 's', first.get('button') or first['where'], first['text'][:80]))
    if js_errors:
        first = next(iter(js_errors.values()))
        problems.append('%d uncaught JavaScript error%s, e.g. "%s"' % (len(js_errors), '' if len(js_errors) == 1 else 's', first['text'][:90]))
    if server_errors:
        first = next(iter(server_errors.values()))
        problems.append('%d route%s answered 5xx, e.g. %s %s' % (len(server_errors), '' if len(server_errors) == 1 else 's', first['status'], first['route']))
    if problems:
        return fail('; '.join(problems), seconds, None, [v['shot'] for v in visited.values() if isinstance(v, dict) and v.get('shot')], **evidence)
    notes = []
    if client_errors:
        notes.append('%d route%s answered 4xx' % (len(client_errors), '' if len(client_errors) == 1 else 's'))
    if dialogs:
        notes.append('%d dialog box%s appeared' % (len(dialogs), '' if len(dialogs) == 1 else 'es'))
    if console:
        notes.append('%d console error%s' % (len(console), '' if len(console) == 1 else 's'))
    if dead:
        notes.append('%d button%s did nothing within %d s' % (len(dead), '' if len(dead) == 1 else 's', wait_ms // 1000))
    if unopened:
        notes.append('could not open: ' + ', '.join(unopened))
    shots = [v['shot'] for v in visited.values() if isinstance(v, dict) and v.get('shot')]
    if notes:
        return warn('; '.join(notes), seconds, None, shots, **evidence)
    return ok(seconds, None, f'{clicked} buttons pressed on {len(visited)} tabs: no Mac wording, no JS errors, no 4xx/5xx', shots, **evidence)


def idle_smoothness(ctx):
    ensure_library(ctx)
    browser = need_browser(ctx)
    seconds = 10 if is_quick(ctx) else 30
    open_app(ctx, 'library')
    run = browser.run([{'op': 'sleep', 'seconds': 2}, {'op': 'longtasks', 'seconds': seconds, 'timeout': 60}], timeout=seconds + 60)
    stalls = run.steps[1].get('value') or []
    big = [s for s in stalls if s['ms'] > STALL_MS]
    evidence = {'watched_seconds': seconds, 'stalls_over_50ms': len(stalls), 'stalls_over_200ms': len(big),
                'longest_ms': max((s['ms'] for s in stalls), default=0), 'tasks': big[:10]}
    if len(big) > STALL_LIMIT:
        return fail(f'{len(big)} stalls over {STALL_MS} ms in {seconds} s of doing nothing on the Library tab (limit {STALL_LIMIT})',
                    seconds, None, **evidence)
    return ok(seconds, None, f'{len(big)} stalls over {STALL_MS} ms in {seconds} s idle (limit {STALL_LIMIT}); longest {evidence["longest_ms"]} ms', **evidence)
