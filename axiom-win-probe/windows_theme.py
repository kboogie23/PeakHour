"""Red & platinum "urban" look for AXIOM's Windows edition.

AXIOM's colours are written directly into its stylesheets, page, scripts and
artwork (the lime #a3ff00 alone appears in hundreds of rules, plus green-tinted
blacks and greys, canvas colours in JavaScript and the green neon in the entrance
art). Rather than editing AXIOM's files, responses are recoloured as they are
served, and the result is cached:
- lime / green accents become neon red;
- green-tinted blacks become asphalt charcoal, pale greens become platinum,
  green-greys become steel;
- the day-mode blue accent becomes deep red;
- AXIOM's own artwork (entrance, marks, release art, glow) has its green neon
  shifted to red; album covers and other companies' logos are never touched.
Teal/emerald success colours, orange warnings and other hues are unchanged, so
status colours keep their meaning. windows-theme-urban.css adds the concrete
grain, red glow and platinum details on top.
"""
import colorsys
import io
import math
import re
import threading
from pathlib import Path

THEME_VERSION = 'peak-hour-90s-3'
RED_HUE = 355 / 360
# Softer brick red: saturation 58-68% and lightness held near 40% (the first 80-92% red was hard on the eyes).
RED_SAT = (0.58, 0.68)


def _red_light(l):
    return 0.40 + (l - 0.40) * 0.3 if l > 0.40 else l
GREEN = (55 / 360, 140 / 360)  # lime through green; teal/emerald (≈160°) keeps meaning "ok"
DAY_BLUE = {(0, 71, 171): (150, 28, 38)}
TEXT_TYPES = ('text/css', 'text/html', 'application/javascript', 'text/javascript', 'image/svg+xml')
ART = ('images/entrance/', 'brands/axiom-', 'assets/record-vault/glow', 'assets/record-vault/crate',
       'assets/record-vault/record', 'textures/')  # AXIOM's own art; serato-sleeves / djay-stack stay as made
ART_TOP = re.compile(r'^(axiom-[\w.-]+|release-[\w.-]+)\.(png|jpe?g|webp)$', re.I)

_HEX = re.compile(r'#([0-9a-fA-F]{8}|[0-9a-fA-F]{6})(?![0-9a-zA-Z_-])')
_HEX3 = re.compile(r'(?<=[:\s,(])#([0-9a-fA-F]{3})(?![0-9a-zA-Z_-])')
# rgb()/rgba() in comma or space syntax, with any alpha: a number, a percent, Tailwind's
# var(--tw-…-opacity, 1) or a JavaScript template value ${…}. Also an unclosed prefix inside quotes,
# as in AXIOM's [style*="rgba(163,255,0"] rules that find inline colours (recoloured the same way).
_RGB = re.compile(r'(rgba?\(\s*)(\d{1,3})(\s*[, ]\s*)(\d{1,3})(\s*[, ]\s*)(\d{1,3})'
                  r'(\s*(?:[,/]\s*(?:var\([^()]*\)|\$\{[^}]*\}|[\d.]+%?)\s*)?\)|(?=\s*["\']))')


def recolor(r, g, b):
    if (r, g, b) in DAY_BLUE:
        return DAY_BLUE[(r, g, b)]
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    if not GREEN[0] <= h <= GREEN[1] or s < 0.08:
        return r, g, b
    if l < 0.16:
        h, s = 0.0, min(s, 0.06)               # asphalt charcoal
    elif s >= 0.30 and l <= 0.92:
        h, s = RED_HUE, max(min(s, RED_SAT[1]), RED_SAT[0])  # brick red accent
        l = _red_light(l)
    elif l >= 0.80:
        h, s = 215 / 360, min(s, 0.08)         # platinum
    else:
        h, s = 220 / 360, min(s, 0.07)         # steel
    return tuple(round(c * 255) for c in colorsys.hls_to_rgb(h, l, s))


def recolor_day(r, g, b):
    """Day mode's own accent is navy/blue (in --…day… variables): it becomes deep red there."""
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    if 195 / 360 <= h <= 235 / 360 and s >= 0.35 and 0.08 <= l <= 0.75:
        return tuple(round(c * 255) for c in colorsys.hls_to_rgb(RED_HUE, min(l, 0.40), max(min(s, RED_SAT[1]), RED_SAT[0])))
    return recolor(r, g, b)


def _subs(convert):
    def hex6(match):
        value = match.group(1)
        rgb = tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
        new = convert(*rgb)
        if new == rgb:
            return match.group(0)
        text = '#%02x%02x%02x' % new
        return text + value[6:] if len(value) == 8 else text

    def hex3(match):
        rgb = tuple(int(c * 2, 16) for c in match.group(1))
        new = convert(*rgb)
        return match.group(0) if new == rgb else '#%02x%02x%02x' % new

    def rgb(match):
        old = tuple(min(255, int(match.group(i))) for i in (2, 4, 6))
        new = convert(*old)
        if new == old:
            return match.group(0)
        # Only the three channels change; the function name, separators and alpha stay as written.
        return f'{match.group(1)}{new[0]}{match.group(3)}{new[1]}{match.group(5)}{new[2]}{match.group(7)}'
    return hex6, hex3, rgb


def recolor_daw(r, g, b):
    """Studio DAW's own accent is violet (#8e54ff and neighbours): it becomes red in the DAW's files.
    Elsewhere purple means something (genres, badges) and is left alone."""
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    if 245 / 360 <= h <= 290 / 360 and s >= 0.35 and 0.2 <= l <= 0.88:
        return tuple(round(c * 255) for c in colorsys.hls_to_rgb(RED_HUE, _red_light(l), max(min(s, RED_SAT[1]), RED_SAT[0])))
    return recolor(r, g, b)


DAW_PATHS = ('/static/css/studio-daw/', '/static/js/studio-daw/')
_PLAIN, _DAY, _DAW_SUBS = _subs(recolor), _subs(recolor_day), _subs(recolor_daw)
_DAY_DECLARATION = re.compile(r'(--[\w-]*day[\w-]*\s*:\s*)([^;{}]+)', re.I)
_BRACE = re.compile(r'[{}]')


def _apply(text, subs, css):
    hex6, hex3, rgb = subs
    text = _HEX.sub(hex6, text)
    if css:
        text = _HEX3.sub(hex3, text)
    return _RGB.sub(rgb, text)


# AXIOM tints black icons lime with CSS filter chains ("brightness(0) ... sepia(89%) saturate(1790%)
# hue-rotate(26deg) ..."). A chain only names numbers, so the colour substitutions above never see it.
# Each chain with a hue-rotate is worked out on a black icon (the Filter Effects matrices, as browsers
# apply them in sRGB) and one that comes out green gets ICON_RED, which gives the accent red exactly.
ICON_RED = ('brightness(0) saturate(100%) invert(23%) sepia(27%) saturate(1695%) hue-rotate(309deg) '
            'brightness(128%) contrast(128%)')  # rgb(184, 35, 48) = recolor(163, 255, 0)
_FILTER = re.compile(r'((?:-webkit-)?filter\s*:\s*)([^;{}"\'`!]*hue-rotate\([^)]*\)[^;{}"\'`!]*?)(\s*)(?=[;{}"\'`!]|$)')
_FILTER_STEP = re.compile(r'([a-z-]+)\(\s*([-\d.]+)(%|deg)?\s*\)')


def _clamp(values):
    return [min(1.0, max(0.0, v)) for v in values]


def _matrix(m, c):
    return _clamp([m[i][0] * c[0] + m[i][1] * c[1] + m[i][2] * c[2] for i in range(3)])


def filter_color(chain, color=(0, 0, 0)):
    """The colour a CSS filter chain gives a pixel (black by default), or None if it uses other functions."""
    c = [v / 255 for v in color]
    steps = _FILTER_STEP.findall(chain)
    if not steps or _FILTER_STEP.sub('', chain).strip():
        return None
    for name, value, unit in steps:
        a = float(value) / 100 if unit == '%' else float(value)
        if name == 'invert':
            c = _clamp([a * (1 - x) + (1 - a) * x for x in c])
        elif name == 'sepia':
            s = 1 - min(a, 1)
            c = _matrix([[0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s],
                         [0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s],
                         [0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s]], c)
        elif name == 'saturate':
            c = _matrix([[0.213 + 0.787 * a, 0.715 - 0.715 * a, 0.072 - 0.072 * a],
                         [0.213 - 0.213 * a, 0.715 + 0.285 * a, 0.072 - 0.072 * a],
                         [0.213 - 0.213 * a, 0.715 - 0.715 * a, 0.072 + 0.928 * a]], c)
        elif name == 'hue-rotate':
            t = math.radians(float(value))
            co, si = math.cos(t), math.sin(t)
            c = _matrix([[0.213 + co * 0.787 - si * 0.213, 0.715 - co * 0.715 - si * 0.715, 0.072 - co * 0.072 + si * 0.928],
                         [0.213 - co * 0.213 + si * 0.143, 0.715 + co * 0.285 + si * 0.140, 0.072 - co * 0.072 - si * 0.283],
                         [0.213 - co * 0.213 - si * 0.787, 0.715 - co * 0.715 + si * 0.715, 0.072 + co * 0.928 + si * 0.072]], c)
        elif name == 'brightness':
            c = _clamp([x * a for x in c])
        elif name == 'contrast':
            c = _clamp([(x - 0.5) * a + 0.5 for x in c])
        else:
            return None
    return tuple(round(x * 255) for x in c)


def _icon_filter(match):
    tinted = filter_color(match.group(2))
    if tinted is None or recolor(*tinted) == tinted:
        return match.group(0)
    return match.group(1) + ICON_RED + match.group(3)


def recolor_text(text, css=False, daw=False):
    text = _DAY_DECLARATION.sub(lambda m: m.group(1) + _apply(m.group(2), _DAY, True), text)
    text = _day_rules(text)
    text = _FILTER.sub(_icon_filter, text)
    return _apply(text, _DAW_SUBS if daw else _PLAIN, css)


def _day_rules(text):
    """Recolour the declarations of rules whose selector names light/day mode, in one pass over the
    braces (a regex like [^{}]*light-mode[^{}]*\\{ backtracks quadratically on large pages)."""
    if 'light-mode' not in text and 'day-mode' not in text:
        return text
    out, last, boundary = [], 0, 0
    for brace in _BRACE.finditer(text):
        position = brace.start()
        if brace.group() == '{':
            selector = text[boundary:position].lower()
            end = text.find('}', position)
            inner_open = text.find('{', position + 1)
            if end != -1 and (inner_open == -1 or end < inner_open) and ('light-mode' in selector or 'day-mode' in selector):
                out.append(text[last:position + 1])
                out.append(_apply(text[position + 1:end], _DAY, True))
                last = end
        boundary = position + 1
    out.append(text[last:])
    return ''.join(out)


def is_art(static_path):
    path = static_path.replace('\\', '/').lstrip('/')
    return path.startswith(ART) or bool(ART_TOP.match(path))


def recolor_image(data):
    """Shift the green neon in AXIOM artwork to red; everything else keeps its colour."""
    import numpy as np
    from PIL import Image
    image = Image.open(io.BytesIO(data))
    fmt = image.format or 'PNG'
    alpha = image.getchannel('A') if image.mode in ('RGBA', 'LA', 'PA') or 'transparency' in image.info else None
    hsv = np.array(image.convert('RGB').convert('HSV'), dtype=np.int16)
    h, s = hsv[..., 0], hsv[..., 1]
    # Every green-tinted pixel turns red (on near-grey pixels the change is a faint warm tint), and
    # only vivid ones get a gentle saturation lift, so glows and fog fade smoothly without edges.
    mask = (h >= int(GREEN[0] * 255)) & (h <= int(GREEN[1] * 255)) & (s >= 8)
    lift = np.clip((s - 40) / 80.0, 0, 1) * 0.12
    hsv[..., 0] = np.where(mask, round(RED_HUE * 255), h)
    hsv[..., 1] = np.where(mask, np.minimum(255, s + (255 - s) * lift).astype(np.int16), s)
    out = Image.fromarray(hsv.astype(np.uint8), 'HSV').convert('RGB')
    if alpha is not None:
        out.putalpha(alpha.convert('L'))
    buffer = io.BytesIO()
    if fmt.upper() in ('JPEG', 'JPG'):
        out.convert('RGB').save(buffer, 'JPEG', quality=92)
    else:
        out.save(buffer, 'WEBP' if fmt.upper() == 'WEBP' else 'PNG', optimize=False)
    return buffer.getvalue()


class ThemeCache:
    """Recoloured files in memory and on disk. Each key is made once: concurrent requests for the
    same file (the start-up warm-up and a page load) wait for the first instead of racing."""

    def __init__(self, folder):
        self.folder = Path(folder)
        self.lock = threading.Lock()
        self.memory = {}
        self.key_locks = {}

    def get(self, key, make):
        with self.lock:
            if key in self.memory:
                return self.memory[key]
            key_lock = self.key_locks.setdefault(key, threading.Lock())
        with key_lock:
            with self.lock:
                if key in self.memory:
                    return self.memory[key]
            name = re.sub(r'[^\w.-]', '_', key)[-180:]
            disk = self.folder / name
            data = None
            if disk.is_file():
                try:
                    data = disk.read_bytes()
                except OSError:
                    data = None
            if data is None:
                data = make()
                try:
                    self.folder.mkdir(parents=True, exist_ok=True)
                    stage = disk.with_name(f'{disk.name}.{threading.get_ident()}.tmp')
                    stage.write_bytes(data)
                    stage.replace(disk)
                except OSError:
                    pass  # the recoloured file is still served; it is simply made again next time
            with self.lock:
                if len(self.memory) > 400:
                    self.memory.clear()
                self.memory[key] = data
                self.key_locks.pop(key, None)
            return data


IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp'}
# PEAK HOUR artwork served in place of AXIOM's (paths relative to static/); AXIOM's files stay as they are.
SWAPS = {
    '/static/axiom-mark.png': 'brand/peak-hour-mark-512.png',
    '/static/axiom-pro-mark.png': 'brand/peak-hour-mark-1024.png',
    '/static/axiom-release-mark.png': 'brand/peak-hour-mark-1024.png',
    '/static/axiom-release-mark-transparent-v1.png': 'brand/peak-hour-mark-1024.png',
    # 90s urban: a brick alley and a spray-painted wall in place of the futuristic doors and neon tiles
    '/static/images/entrance/doors-clean.png': 'brand/90s/doors-brick.jpg',
    '/static/images/entrance/fresh-set-hd.png': 'brand/90s/fresh-set-paint.jpg',
}


def _key(static_root, file):
    stat = file.stat()
    return f'{THEME_VERSION}-{stat.st_mtime_ns}-{stat.st_size}-/static/{file.relative_to(static_root).as_posix()}'


def warm(cache, static_root):
    """Recolour AXIOM's artwork in the background so the first page load does not wait for it."""
    for file in sorted(static_root.rglob('*')):
        relative = file.relative_to(static_root).as_posix()
        if file.suffix.lower() in IMAGE_SUFFIXES and file.is_file() and is_art(relative):
            try:
                cache.get(_key(static_root, file), lambda f=file: recolor_image(f.read_bytes()))
            except (OSError, ValueError):
                pass  # an unreadable image is served unchanged


def install(flask_app, cache_folder, static_root):
    cache = ThemeCache(cache_folder)
    static_root = Path(static_root).resolve()
    threading.Thread(target=warm, args=(cache, static_root), name='axiom-theme-warm', daemon=True).start()

    favicon = static_root / 'brand' / 'favicon.ico'
    if favicon.is_file():
        def windows_favicon():
            from flask import send_file
            return send_file(favicon, mimetype='image/x-icon')
        flask_app.add_url_rule('/favicon.ico', 'windows_favicon', windows_favicon)

    @flask_app.after_request
    def windows_theme(response):
        if response.status_code != 200 or response.headers.get('X-Axiom-Theme'):
            return response
        from flask import request
        path = request.path
        swap = SWAPS.get(path)
        if swap and (static_root / swap).is_file():  # PEAK HOUR artwork in place of AXIOM's
            replacement = static_root / swap
            response.direct_passthrough = False
            response.set_data(replacement.read_bytes())
            response.mimetype = 'image/png' if replacement.suffix == '.png' else 'image/jpeg'
            response.headers['X-Axiom-Theme'] = THEME_VERSION
            response.set_etag(f'{THEME_VERSION}-{replacement.stat().st_mtime_ns}-{replacement.stat().st_size}')
            return response
        mimetype = response.mimetype or ''
        is_static = path.startswith('/static/')
        art = is_static and mimetype.startswith('image/') and mimetype != 'image/svg+xml' and is_art(path[len('/static/'):])
        if not (mimetype in TEXT_TYPES or art):
            return response
        response.direct_passthrough = False
        data = response.get_data()
        if is_static:
            file = (static_root / path[len('/static/'):]).resolve()
            key = _key(static_root, file) if file.is_relative_to(static_root) and file.is_file() else f'{THEME_VERSION}-{hash(data)}-{path}'
            if art:
                data = cache.get(key, lambda: recolor_image(data))
            else:
                data = cache.get(key, lambda: recolor_text(data.decode('utf-8', 'replace'), css=mimetype == 'text/css', daw=path.startswith(DAW_PATHS)).encode('utf-8'))
        else:
            data = recolor_text(data.decode('utf-8', 'replace')).encode('utf-8')
        response.set_data(data)
        response.headers['X-Axiom-Theme'] = THEME_VERSION
        etag = response.get_etag()[0]
        if etag:
            response.set_etag(f'{THEME_VERSION}-{etag}')
        return response
