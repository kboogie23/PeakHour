"""Red & platinum Windows theme: colour rules, artwork allow-list, and recolouring of served CSS, HTML,
JavaScript and AXIOM artwork (album art, other brands and JSON untouched), with the disk cache."""
import io, sys, pathlib, uuid, json, time, traceback
root = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(root / 'axiom-win-probe'))
try:
    import numpy as np
    from PIL import Image
    from flask import Flask, jsonify
    import windows_theme as T
    assert T.recolor_text('#a3ff00') != '#a3ff00' and 'a0' < T.recolor_text('#a3ff00')[1:3] < 'd0' and T.recolor_text('#a3ff00')[3:5] < '40'  # lime -> soft brick red
    assert T.recolor_text('#071005') == '#0b0a0a'                       # green-black -> asphalt
    assert T.recolor_text('#edf4e9') == '#edeef0'                       # pale green -> platinum
    for keep in ('#10b981', '#ff8a1f', '#22a7ff', '#ffffff', '#050505', '#f43f5e'):
        assert T.recolor_text(keep) == keep, keep                        # status colours keep their meaning
    assert T.recolor_text('#0047ab') == '#961c26'                       # day-mode blue accent -> deep red
    css = T.recolor_text('a{box-shadow:0 0 9px rgba(163,255,0,.28);color:#9f0} #abc{x:1}', css=True)
    assert 'rgba(163' not in css and '#9f0' not in css and '#abc{' in css  # ids are not colours
    assert T.recolor_text("id='#abc'") == "id='#abc'"                   # 3-digit hex only in CSS
    day = T.recolor_text('@media x{body.light-mode #p>b{background:#0b2f63}} .info{color:#0b2f63} :root{--day-accent-blue:#0047ab}', css=True)
    assert 'background:#0b2f63' not in day and '.info{color:#0b2f63}' in day and '--day-accent-blue:#0047ab' not in day  # day accent only
    daw = T.recolor_text('.play{background:#8e54ff;box-shadow:0 0 9px rgba(142,84,255,.4)}', css=True, daw=True)
    assert '#8e54ff' not in daw and 'rgba(142,84,255' not in daw          # DAW violet -> red in the DAW's files
    assert T.recolor_text('.genre{color:#c084fc}', css=True) == '.genre{color:#c084fc}'  # purple elsewhere keeps its meaning
    assert T.DAW_PATHS == ('/static/css/studio-daw/', '/static/js/studio-daw/')
    tailwind = T.recolor_text('.bg{background-color:rgb(163 255 0/var(--tw-bg-opacity,1))}', css=True)
    assert 'rgb(163 255 0' not in tailwind and '/var(--tw-bg-opacity,1))' in tailwind
    assert 'rgba(163,255,0' not in T.recolor_text('[style*="rgba(163,255,0"]{x:1} `rgba(163,255,0,${a})`', css=True)
    big = ('<div class="x">' + 'word ' * 40 + '</div>\n') * 4000 + '<style>body.light-mode .p{color:#0b2f63}</style>'
    started = time.perf_counter(); themed = T.recolor_text(big)
    assert time.perf_counter() - started < 1.0 and '#0b2f63' not in themed  # linear on large pages (no backtracking)
    assert [T.is_art(p) for p in ('images/entrance/doors-clean.png', 'axiom-pro-mark.png', 'brands/axiom-studio-tools.png',
                                  'brands/djay-wordmark.png', 'assets/library-review/rain.png', 'release-sonic-hero-20261009.png')] == \
        [True, True, True, False, False, True]

    folder = root / 'fixtures' / 'theme' / uuid.uuid4().hex
    static = folder / 'static'; (static / 'images' / 'entrance').mkdir(parents=True); (static / 'brands').mkdir()
    (static / 'site.css').write_text('.x{color:#a3ff00;background:#071005}', encoding='utf-8')
    (static / 'app.js').write_text("ctx.strokeStyle='#a3ff00';", encoding='utf-8')
    lime = Image.new('RGBA', (8, 8), (163, 255, 0, 200)); grey = Image.new('RGB', (8, 8), (120, 120, 120))
    for img, path in ((lime, static / 'images' / 'entrance' / 'glow.png'), (lime, static / 'brands' / 'djay-wordmark.png'),
                      (grey, static / 'images' / 'entrance' / 'grey.png')):
        img.save(path)
    app = Flask('t', static_folder=str(static))

    @app.get('/')
    def page():
        return '<html><body style="background:#071005"><b style="color:#a3ff00">AXIOM</b></body></html>'

    @app.get('/api/data')
    def data():
        return jsonify(color='#a3ff00')
    T.install(app, folder / 'cache', static)
    c = app.test_client()
    assert '#a3ff00' not in c.get('/static/site.css').get_data(as_text=True)
    assert '#a3ff00' not in c.get('/static/app.js').get_data(as_text=True)
    page_html = c.get('/').get_data(as_text=True); assert '#a3ff00' not in page_html and '#071005' not in page_html
    assert c.get('/api/data').get_json() == {'color': '#a3ff00'}       # data is never recoloured
    r = c.get('/static/images/entrance/glow.png'); px = np.array(Image.open(io.BytesIO(r.data)))[0, 0]
    assert r.headers['X-Axiom-Theme'] and px[0] > 180 and px[1] < 40 and px[3] == 200, px  # red, alpha kept
    px = np.array(Image.open(io.BytesIO(c.get('/static/brands/djay-wordmark.png').data)))[0, 0]
    assert tuple(px) == (163, 255, 0, 200)                               # other brands untouched
    px = np.array(Image.open(io.BytesIO(c.get('/static/images/entrance/grey.png').data)))[0, 0]
    assert tuple(px[:3]) == (120, 120, 120)                              # neutral pixels untouched
    assert any((folder / 'cache').iterdir())                             # cached on disk
    (static / 'brand').mkdir(); Image.new('RGBA', (4, 4), (1, 2, 3, 255)).save(static / 'brand' / 'peak-hour-mark-512.png')
    Image.new('RGBA', (4, 4), (163, 255, 0, 255)).save(static / 'axiom-mark.png')
    Image.new('RGBA', (16, 16), (1, 2, 3, 255)).save(static / 'brand' / 'favicon.ico')
    app2 = Flask('t2', static_folder=str(static)); T.install(app2, folder / 'cache2', static); c2 = app2.test_client()
    px = np.array(Image.open(io.BytesIO(c2.get('/static/axiom-mark.png').data)))[0, 0]
    assert tuple(px) == (1, 2, 3, 255)                                   # PEAK HOUR logo served in place of AXIOM's mark
    assert c2.get('/favicon.ico').status_code == 200
    import threading, time
    race = T.ThemeCache(folder / 'race'); calls, errors = [], []
    def make():
        calls.append(1); time.sleep(0.3); return b'x' * 1000
    def worker():
        try:
            assert race.get('same-key', make) == b'x' * 1000
        except Exception as exc:
            errors.append(exc)
    threads = [threading.Thread(target=worker) for _ in range(12)]
    [t.start() for t in threads]; [t.join() for t in threads]
    assert not errors and len(calls) == 1 and not list((folder / 'race').glob('*.tmp'))  # warm-up vs page load: made once
    # Lime icon tints made with filter chains become the accent red; blue, orange and other filters stay
    lime = 'brightness(0) saturate(100%) invert(91%) sepia(89%) saturate(1790%) hue-rotate(26deg) brightness(108%) contrast(103%)'
    assert T.filter_color(lime) == (162, 255, 14) and T.filter_color(T.ICON_RED) == T.recolor(163, 255, 0)
    css = f'.a{{filter:{lime}!important}}.b{{-webkit-filter: invert(87%) sepia(95%) saturate(1237%) hue-rotate(26deg);}}'
    assert T.recolor_text(css, css=True) == f'.a{{filter:{T.ICON_RED}!important}}.b{{-webkit-filter: {T.ICON_RED};}}'
    for keep in ('.c{filter: brightness(0) saturate(100%) invert(22%) sepia(99%) saturate(2459%) hue-rotate(205deg) brightness(79%) contrast(110%) !important}',
                 '.d{filter: invert(77%) sepia(46%) saturate(940%) hue-rotate(331deg) brightness(106%)}', '.e{filter: blur(2px) hue-rotate(30deg)}'):
        assert T.recolor_text(keep, css=True) == keep, keep
    # Conditional requests: the ETag the client receives is the one it is compared with, so revalidation gets a 304
    for url in ('/static/site.css', '/static/app.js', '/static/images/entrance/glow.png'):
        first = c.get(url); tag = first.headers['ETag']
        assert first.status_code == 200 and tag.strip('"').startswith(T.THEME_VERSION), (url, tag)
        again = c.get(url, headers={'If-None-Match': tag})
        assert again.status_code == 304 and not again.data and again.headers['ETag'] == tag, (url, again.status_code)
        assert c.get(url, headers={'If-None-Match': '"other"'}).status_code == 200
    swapped = c2.get('/static/axiom-mark.png'); assert swapped.status_code == 200
    assert c2.get('/static/axiom-mark.png', headers={'If-None-Match': swapped.headers['ETag']}).status_code == 304
    # Dynamic pages are recoloured once per distinct content, then served from memory
    big_page = ('<div style="color:#a3ff00;background:#071005">' + 'word ' * 40 + '</div>\n') * 4000
    app3 = Flask('t3', static_folder=str(static)); app3.add_url_rule('/big', 'big', lambda: big_page); T.install(app3, folder / 'cache3', static)
    c3 = app3.test_client(); timings = []
    for _ in range(4):
        started = time.perf_counter(); body = c3.get('/big').get_data(as_text=True); timings.append(time.perf_counter() - started)
        assert '#a3ff00' not in body and '#071005' not in body
    assert timings[1] < timings[0] / 3, timings
    print('theme timings: first %.1f ms (recolour), repeats %s ms (cached); revalidation of 3 static assets returned 304' %
          (timings[0] * 1000, ['%.1f' % (t * 1000) for t in timings[1:]]))
    print('PASS: red & platinum theme recolours AXIOM styles, pages, scripts and artwork; data, other brands and status colours untouched')
except BaseException:
    traceback.print_exc(); sys.exit(1)
