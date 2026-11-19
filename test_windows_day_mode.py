"""Day (light) mode: windows-theme-urban.css styles only night mode where the style is night-only (brick sidebar and
plate, tinted library list, transparent Studio wrapper), resets the chrome lettering in day mode, and keeps the
Performance 'Currently Playing' text dark. Parses the stylesheet text; the cache-buster in index.html must have moved."""
import sys, re, pathlib, traceback
root = pathlib.Path(__file__).resolve().parent
css_path = root / 'axiom-win-probe' / 'static' / 'css' / 'windows-theme-urban.css'
try:
    css = re.sub(r'/\*.*?\*/', '', css_path.read_text(encoding='utf-8'), flags=re.S)
    rules = [(' '.join(sel.split()), body) for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css)]
    night = 'html body:not(.light-mode) '

    def rules_for(fragment):
        found = [(sel, body) for sel, body in rules if fragment in sel]
        assert found, fragment
        return found

    def selectors(fragment):
        return [part.strip() for sel, _ in rules_for(fragment) for part in sel.split(',') if fragment in part]

    # 1-3. Night-only rules: every selector part is scoped to body:not(.light-mode)
    for fragment in ('aside#axiom-sidebar', '.library-results-column', '#studio-active-view'):
        for part in selectors(fragment):
            assert part.startswith(night), f'{fragment}: not night-only: {part}'
            assert 'light-mode' not in part.replace(':not(.light-mode)', ''), part
    brick = [b for s, b in rules_for('aside#axiom-sidebar.axiom-sidebar.axiom-sidebar')]
    assert any('brick-tile.png' in b for b in brick)                    # the brick sidebar is still there for night
    assert any('rgba(9, 8, 8, .66)' in b for _, b in rules_for('.library-results-column'))
    assert any('color: #f4f4f4' in b for s, b in rules_for('.axiom-sidebar-nav-item.axiom-sidebar-nav-item span'))
    # No selector anywhere in the file may style the sidebar/library/studio wrapper in day mode with night colours
    for sel, body in rules:
        if 'light-mode' in sel.replace(':not(.light-mode)', ''):
            assert 'brick-tile' not in body and '#f4f4f4' not in body, sel

    # 4. Chrome lettering: still chrome in night (unscoped, as before), reset in day
    chrome = [b for s, b in rules if s.startswith('h1:not(:has(*))')]
    assert chrome and '-webkit-text-fill-color: transparent' in chrome[0]
    day_heads = [(s, b) for s, b in rules if s.startswith('html body.light-mode h1:not(:has(*))')]
    assert day_heads and '.axiom-start-wordmark-main' in day_heads[0][0], day_heads
    body = day_heads[0][1]
    for want in ('background: none !important', '-webkit-text-fill-color: currentColor !important',
                 '-webkit-text-stroke: 0 !important', 'filter: none !important'):
        assert want in body, want
    logo = [b for s, b in rules if s == 'html body.light-mode .axiom-start-wordmark-main']
    assert logo and 'color: #07111f !important' in logo[0] and 'transparent' not in logo[0]  # logo stays legible in day

    # 5. Performance: Currently Playing text is dark in day (AXIOM sets #f4f6ef !important)
    perf = [b for s, b in rules if s.startswith('html body.light-mode #tab-content-performance.performance-cockpit .performance-current-panel')]
    assert perf and '.performance-track-title' in [s for s, _ in rules if 'performance-current-panel' in s and 'light-mode' in s][0]
    assert 'color: #07111f !important' in perf[0]
    assert any('.performance-session-menu > summary' in s and 'color: #07111f !important' in b for s, b in rules)

    # The stylesheet link was versioned past v13 so existing installs reload it
    html = (root / 'axiom-win-probe' / 'templates' / 'index.html').read_text(encoding='utf-8')
    version = re.search(r'windows-theme-urban\.css\?v=(\d+)', html)
    assert version and int(version.group(1)) >= 14, version
except Exception:
    traceback.print_exc()
    sys.exit(1)
print('PASS: day mode: night-only sidebar, plate, library list and Studio wrapper are scoped to night; chrome headings reset and Performance text dark in day')
