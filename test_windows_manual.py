"""User manual: every picture it shows exists, every picture is used, every chapter link has its chapter,
each shot in manual_shots.py has its picture, and Settings opens the manual."""
import re, sys, traceback
from pathlib import Path

WORK = Path(__file__).resolve().parent
MANUAL = WORK / 'axiom-win-probe' / 'static' / 'manual'
try:
    sys.path.insert(0, str(WORK))
    from manual_shots import SHOTS
    page = (MANUAL / 'index.html').read_text(encoding='utf-8')
    shown = set(re.findall(r'src="img/([\w-]+)\.jpg"', page))
    files = {p.stem for p in (MANUAL / 'img').glob('*.jpg')}
    assert shown and shown <= files, f'pictures missing: {sorted(shown - files)}'
    assert files <= shown, f'pictures not used: {sorted(files - shown)}'
    assert {s['name'] for s in SHOTS} == files, 'manual_shots.py and the pictures differ'
    links = set(re.findall(r'href="#([\w-]+)"', page))
    ids = set(re.findall(r'id="([\w-]+)"', page))
    assert links <= ids, f'chapter links without a chapter: {sorted(links - ids)}'
    assert re.search(r'Last updated \d{1,2} \w+ 20\d\d', page), 'the manual has no Last updated date'
    assert 'id="whats-new"' in page
    template = (WORK / 'axiom-win-probe' / 'templates' / 'index.html').read_text(encoding='utf-8')
    assert "window.open('/static/manual/index.html'" in template and 'id="settings-user-manual"' in template
    print(f'PASS: user manual has {len(shown)} pictures, {len(links)} working chapter links, and opens from Settings')
except BaseException:
    traceback.print_exc(); sys.exit(1)
