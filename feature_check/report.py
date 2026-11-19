"""Console table, report.html, report.md and results.json for a feature-check run.

`run` is a plain dict built by check_features.py:
  started, seconds, args, notes[], guard[], fingerprint_changes[], server_log_tail[],
  features[]: {id, area, name, works_means, status, seconds, budget, reason, api_only, flaky, mvp, covered_by[],
               checks[]: {kind, name, status, seconds, budget, reason, evidence{}, shots[], flaky}}
  legacy[]:   {name, status, seconds, reason, evidence{}}
"""
import html
import json
import shutil
import pathlib

ORDER = ['FAIL', 'WARN', 'PASS', 'SKIP', 'N/A']
COLOURS = {'PASS': '#1a7f37', 'FAIL': '#cf222e', 'WARN': '#9a6700', 'SKIP': '#6e7781', 'N/A': '#8c959f'}
EVIDENCE_LIMIT = 2048


def rollup(statuses):
    statuses = list(statuses)
    for status in ('FAIL', 'WARN', 'PASS', 'SKIP'):
        if status in statuses:
            return status
    return 'N/A'


def _clip(value, limit=EVIDENCE_LIMIT):
    text = value if isinstance(value, str) else json.dumps(value, indent=1, default=str)
    return text if len(text) <= limit else text[:limit] + '\n... (%d more characters)' % (len(text) - limit)


def _seconds(row):
    seconds, budget = row.get('seconds') or 0.0, row.get('budget')
    text = '%.1fs' % seconds if seconds >= 0.05 else '-'
    if budget:
        text += ' / %gs' % budget
    return text


def all_rows(run):
    """Uniform list of rows: features then legacy scripts."""
    rows = list(run.get('features', []))
    for item in run.get('legacy', []):
        rows.append({'id': 'legacy:' + item['name'], 'area': 'Existing tests', 'name': item['name'], 'status': item['status'],
                     'seconds': item.get('seconds', 0.0), 'budget': item.get('budget'), 'reason': item.get('reason', ''),
                     'api_only': False, 'flaky': False, 'checks': [], 'legacy': item, 'changed': item.get('changed', '')})
    return rows


def counts(run):
    out = {s: 0 for s in ORDER}
    for row in all_rows(run):
        out[row['status']] = out.get(row['status'], 0) + 1
    return out


# --------------------------------------------------------------------------- previous run

def previous_results(report_root, current_name):
    """results.json of the newest earlier run next to this one (None if there is none)."""
    root = pathlib.Path(report_root)
    if not root.is_dir():
        return None
    for folder in sorted((p for p in root.iterdir() if p.is_dir() and p.name < current_name), reverse=True):
        try:
            return json.loads((folder / 'results.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
    return None


def mark_changes(run, previous):
    """Set row['changed'] = 'was X' (or 'new') on rows whose status differs from the previous run."""
    old = {}
    if previous:
        for row in all_rows(previous):
            old[row['id']] = row['status']
    for group in ('features', 'legacy'):
        for item in run.get(group, []):
            key = item['id'] if group == 'features' else 'legacy:' + item['name']
            if not previous:
                item['changed'] = ''
            elif key not in old:
                item['changed'] = 'new'
            elif old[key] != item['status']:
                item['changed'] = 'was ' + old[key]
            else:
                item['changed'] = ''


# --------------------------------------------------------------------------- console

def _cell(text, width):
    text = str(text).replace('\n', ' ')
    return text if len(text) <= width else text[:width - 3] + '...'


def console_table(run, width=118):
    rows = all_rows(run)
    area_w = min(max([len('Area')] + [len(r['area']) for r in rows]), 18)
    name_w = min(max([len('Feature')] + [len(r['name']) + (11 if r.get('api_only') else 0) for r in rows]), 44)
    res_w, time_w = 6, 12
    reason_w = max(20, width - area_w - name_w - res_w - time_w - 12)
    line = '-' * (area_w + name_w + res_w + time_w + reason_w + 12)
    out = ['%-*s  %-*s  %-*s  %-*s  %s' % (area_w, 'Area', name_w, 'Feature', res_w, 'Result', time_w, 'Time/budget', 'Reason'), line]
    for r in sorted(rows, key=lambda r: (r['area'] == 'Existing tests', r['area'], ORDER.index(r['status']) if r['status'] in ORDER else 9)):
        name = r['name'] + (' (API only)' if r.get('api_only') else '')
        status = r['status'] + ('*' if r.get('flaky') else '')
        reason = r.get('reason') or ''
        if r.get('changed'):
            reason = '[%s] %s' % (r['changed'], reason)
        out.append('%-*s  %-*s  %-*s  %-*s  %s' % (area_w, _cell(r['area'], area_w), name_w, _cell(name, name_w), res_w + 1, status,
                                                    time_w, _cell(_seconds(r), time_w), _cell(reason, reason_w)))
    out.append(line)
    c = counts(run)
    out.append('  '.join('%s %d' % (s, c[s]) for s in ORDER if c.get(s)) + '   total %.0fs' % run.get('seconds', 0))
    if any(r.get('flaky') for r in rows):
        out.append('* flaky: failed once, passed on retry')
    return '\n'.join(out)


# --------------------------------------------------------------------------- failure detail

def failure_blocks(run):
    """[(title, [(label, text)], shots)] for every failing or warning feature check and legacy script."""
    blocks = []
    for row in run.get('features', []):
        for check in row.get('checks', []):
            if check['status'] not in ('FAIL', 'WARN'):
                continue
            ev = check.get('evidence') or {}
            parts = [('Step', '%s [%s]' % (check['name'], check['kind'])), ('Why', check.get('reason', ''))]
            for label, key in (('Request', 'last_request'), ('Request', 'request'), ('Response', 'response')):
                if key in ev:
                    parts.append((label, _clip(ev[key])))
            if ev.get('js_errors'):
                parts.append(('JavaScript errors', _clip(ev['js_errors'])))
            rest = {k: v for k, v in ev.items() if k not in ('last_request', 'request', 'response', 'js_errors', 'server_log')}
            if rest:
                parts.append(('Evidence', _clip(rest)))
            if ev.get('server_log'):
                parts.append(('Last server log lines', '\n'.join(ev['server_log'][-40:])))
            blocks.append(('%s / %s' % (row['name'], check['name']), parts, check.get('shots', [])))
    for item in run.get('legacy', []):
        if item['status'] in ('FAIL', 'WARN'):
            ev = item.get('evidence') or {}
            parts = [('Step', item['name']), ('Why', item.get('reason', '')), ('Output (end)', ev.get('stdout_tail', '')),
                     ('Errors (end)', ev.get('stderr_tail', ''))]
            if ev.get('guard'):
                parts.append(('Guard', '\n'.join(ev['guard'])))
            blocks.append((item['name'], [p for p in parts if p[1]], []))
    return blocks


# --------------------------------------------------------------------------- markdown / html / json

def to_markdown(run):
    c = counts(run)
    lines = ['# PEAK HOUR feature check', '', 'Run: %s, %.0fs. %s' % (run.get('started', ''), run.get('seconds', 0),
                                                                    ', '.join('%s %d' % (s, c[s]) for s in ORDER if c.get(s))), '']
    for note in run.get('notes', []):
        lines.append('- NOTE: ' + note)
    if run.get('fingerprint_changes'):
        lines += ['', '## HARNESS ERROR: real files changed'] + ['- ' + x for x in run['fingerprint_changes']]
    real = run.get('real')
    if real:
        lines += ['', '## REAL DATA (%s)' % ('restored' if real['state'] == 'restored' else 'NOT RESTORED'), '',
                  'Backed up %d file(s), %.1f MB, in `%s`. Restored %d, moved %d new file(s) to quarantine.' % (
                      real['backup']['files'], real['backup']['bytes'] / 1e6, real['backup']['folder'], len(real['restored']), len(real['quarantined'])),
                  '', 'Backed-up roots: ' + '; '.join(real['backup']['roots']), '', 'Watched output folders: ' + '; '.join(real['backup']['watched']),
                  '', '### Changes made during the run (then reverted)'] + (['- %s: %s' % (c['kind'], c['path']) for c in real['changes']] or ['- none'])
        if real['left_behind']:
            lines += ['', '### Left behind (newer than the run, not touched)'] + ['- ' + x for x in real['left_behind']]
    lines += ['', '| Area | Feature | Result | Time / budget | Changed | Reason |', '|---|---|---|---|---|---|']
    for r in sorted(all_rows(run), key=lambda r: (r['area'] == 'Existing tests', r['area'])):
        name = r['name'] + (' (API only)' if r.get('api_only') else '')
        lines.append('| %s | %s | %s | %s | %s | %s |' % (r['area'], name, r['status'] + (' (flaky)' if r.get('flaky') else ''), _seconds(r),
                                                          r.get('changed', ''), (r.get('reason') or '').replace('|', '/').replace('\n', ' ')))
    blocks = failure_blocks(run)
    if blocks:
        lines += ['', '## Failures and warnings']
        for title, parts, shots in blocks:
            lines += ['', '### ' + title]
            for label, text in parts:
                lines += ['**%s**' % label, '```', str(text), '```']
            for shot in shots:
                lines.append('![screenshot](%s)' % shot)
    if run.get('guard'):
        lines += ['', '## Guard log (%d)' % len(run['guard'])] + ['- %s %s (%s)' % (g.get('kind'), g.get('detail'), 'blocked' if g.get('blocked') else 'logged') for g in run['guard'][:50]]
    return '\n'.join(lines) + '\n'


CSS = """
body{font:14px/1.45 Segoe UI,Arial,sans-serif;margin:24px auto;max-width:1200px;color:#1f2328;background:#fff;padding:0 16px}
h1{margin:0 0 4px}h2{margin-top:32px;border-bottom:1px solid #d0d7de;padding-bottom:4px}
.sum span{display:inline-block;margin:4px 8px 4px 0;padding:3px 10px;border-radius:12px;color:#fff;font-weight:600}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eaeef2;vertical-align:top}
th{background:#f6f8fa}.badge{display:inline-block;padding:1px 8px;border-radius:10px;color:#fff;font-weight:600;font-size:12px}
.tag{font-size:11px;background:#ddf4ff;color:#0550ae;border-radius:8px;padding:1px 6px;margin-left:6px}
.warn{background:#fff8c5;border:1px solid #d4a72c;padding:8px 12px;border-radius:6px;margin:8px 0}
.err{background:#ffebe9;border:1px solid #cf222e;padding:8px 12px;border-radius:6px;margin:8px 0}
pre{background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:8px;overflow:auto;max-height:320px;white-space:pre-wrap;word-break:break-word}
.fail{border-left:4px solid #cf222e;padding-left:12px;margin:16px 0}.small{color:#57606a;font-size:12px}
img.shot{max-width:480px;border:1px solid #d0d7de;margin:4px 8px 4px 0}details summary{cursor:pointer}
"""


def _badge(status, flaky=False):
    return '<span class="badge" style="background:%s">%s%s</span>' % (COLOURS.get(status, '#666'), html.escape(status), ' (flaky)' if flaky else '')


def to_html(run):
    e = html.escape
    c = counts(run)
    out = ['<!doctype html><html><head><meta charset="utf-8"><title>PEAK HOUR feature check</title><style>%s</style></head><body>' % CSS,
           '<h1>PEAK HOUR feature check</h1>',
           '<div class="small">Run %s, %.0f seconds. Arguments: %s</div>' % (e(str(run.get('started', ''))), run.get('seconds', 0), e(' '.join(run.get('args', [])) or '(none)')),
           '<div class="sum">%s</div>' % ''.join('<span style="background:%s">%s %d</span>' % (COLOURS[s], s, c[s]) for s in ORDER if c.get(s))]
    if run.get('fingerprint_changes'):
        out.append('<div class="err"><b>HARNESS ERROR: real files changed during the run</b><ul>%s</ul></div>' % ''.join('<li>%s</li>' % e(x) for x in run['fingerprint_changes']))
    real = run.get('real')
    if real:
        ok = real['state'] == 'restored'
        out.append('<div class="%s"><b>REAL DATA (%s)</b><br>Backed up %d file(s), %.1f MB, in %s. Restored %d file(s), moved %d new file(s) to quarantine.'
                   '<br><span class="small">Backed-up roots: %s<br>Watched output folders: %s</span>' % (
                       'warn' if ok else 'err', 'restored' if ok else 'NOT RESTORED - run: ' + e(real['restore_command']), real['backup']['files'],
                       real['backup']['bytes'] / 1e6, e(real['backup']['folder']), len(real['restored']), len(real['quarantined']),
                       e('; '.join(real['backup']['roots'])), e('; '.join(real['backup']['watched']))))
        out.append('<details><summary>Changes made during the run, then reverted (%d)</summary><ul>%s</ul></details></div>' % (
            len(real['changes']), ''.join('<li>%s: %s</li>' % (e(c['kind']), e(c['path'])) for c in real['changes']) or '<li>none</li>'))
        if real['left_behind']:
            out.append('<div class="warn">Left behind (newer than the run, not touched):<ul>%s</ul></div>' % ''.join('<li>%s</li>' % e(x) for x in real['left_behind']))
    for note in run.get('notes', []):
        out.append('<div class="warn">%s</div>' % e(note))
    out.append('<h2>Features</h2><table><tr><th>Area</th><th>Feature</th><th>Result</th><th>Time / budget</th><th>Changed</th><th>What it means / reason</th></tr>')
    for r in sorted(all_rows(run), key=lambda r: (r['area'] == 'Existing tests', r['area'])):
        tag = '<span class="tag">API only</span>' if r.get('api_only') else ''
        tag += '<span class="tag">MVP</span>' if r.get('mvp') else ''
        means = '<div class="small">%s</div>' % e(r['works_means']) if r.get('works_means') else ''
        checks = ''
        if r.get('checks'):
            checks = '<details><summary class="small">%d check(s)</summary><table>%s</table></details>' % (
                len(r['checks']), ''.join('<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>' % (
                    e(k['kind']), e(k['name']), _badge(k['status'], k.get('flaky')), e(k.get('reason', ''))) for k in r['checks']))
        out.append('<tr><td>%s</td><td><b>%s</b>%s%s%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>' % (
            e(r['area']), e(r['name']), tag, means, checks, _badge(r['status'], r.get('flaky')), e(_seconds(r)), e(r.get('changed', '')), e(r.get('reason') or '')))
    out.append('</table>')
    blocks = failure_blocks(run)
    if blocks:
        out.append('<h2>Failures and warnings</h2>')
        for title, parts, shots in blocks:
            out.append('<div class="fail"><h3>%s</h3>' % e(title))
            for label, text in parts:
                out.append('<b>%s</b><pre>%s</pre>' % (e(label), e(str(text))))
            for shot in shots:
                out.append('<a href="%s"><img class="shot" src="%s" alt="screenshot"></a>' % (e(shot), e(shot)))
            out.append('</div>')
    if run.get('server_log_tail'):
        out.append('<h2>Server log (last lines)</h2><pre>%s</pre>' % e('\n'.join(run['server_log_tail'])))
    if run.get('guard'):
        out.append('<h2>Guard log</h2><p class="small">Writes or connections outside the sandbox, recorded by guard.py.</p><pre>%s</pre>' % e(
            '\n'.join('%s %s (%s, pid %s)' % (g.get('kind'), g.get('detail'), 'blocked' if g.get('blocked') else 'logged', g.get('pid')) for g in run['guard'][:100])))
    out.append('</body></html>')
    return '\n'.join(out)


def write_reports(run, outdir, previous=None):
    """Copies screenshots next to the report, then writes results.json, report.md and report.html. Returns outdir."""
    outdir = pathlib.Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    mark_changes(run, previous)
    shots_dir = outdir / 'shots'
    n = 0
    for row in run.get('features', []):
        for check in row.get('checks', []):
            kept = []
            for shot in check.get('shots', []):
                source = pathlib.Path(shot)
                if source.is_file():
                    n += 1
                    shots_dir.mkdir(exist_ok=True)
                    target = shots_dir / ('%03d-%s' % (n, source.name))
                    shutil.copy2(source, target)
                    kept.append('shots/' + target.name)
                elif not source.is_absolute():
                    kept.append(shot)
            check['shots'] = kept
    (outdir / 'results.json').write_text(json.dumps(run, indent=1, default=str), encoding='utf-8')
    (outdir / 'report.md').write_text(to_markdown(run), encoding='utf-8')
    (outdir / 'report.html').write_text(to_html(run), encoding='utf-8')
    return outdir
