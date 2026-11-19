"""The in-page script that measures how readable the visible text is (WCAG contrast ratio), used by the day-mode check."""

SCAN = r"""
((rootSelector, options) => {
  options = options || {};
  const root = document.querySelector(rootSelector);
  if (!root) return {error: 'no element ' + rootSelector};
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const g = canvas.getContext('2d', {willReadFrequently: true});
  const cache = new Map();
  const rgba = value => {
    if (cache.has(value)) return cache.get(value);
    g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = value; g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    // canvas premultiplies: read the colour back at full alpha by drawing on white and black
    g.clearRect(0, 0, 1, 1); g.fillStyle = '#fff'; g.fillRect(0, 0, 1, 1); g.fillStyle = value; g.fillRect(0, 0, 1, 1);
    const w = g.getImageData(0, 0, 1, 1).data;
    g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillRect(0, 0, 1, 1); g.fillStyle = value; g.fillRect(0, 0, 1, 1);
    const b = g.getImageData(0, 0, 1, 1).data;
    const a = 1 - (w[0] - b[0]) / 255;               // alpha from how much the white and black backdrops differ
    const out = a <= 0.001 ? [0, 0, 0, 0] : [Math.round(b[0] / a), Math.round(b[1] / a), Math.round(b[2] / a), Math.min(1, a)];
    cache.set(value, out); return out;
  };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (top, bottom) => { const a = top[3] + bottom[3] * (1 - top[3]); if (a <= 0) return [0, 0, 0, 0];
    return [0, 1, 2].map(i => Math.round((top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a)).concat([a]); };
  const gradientColours = image => (image.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/gi) || []).map(rgba).filter(c => c[3] > 0.05);
  // the colour behind an element: [r,g,b] list of possible backdrops (a gradient gives several) or null when it is a picture
  const backdrop = el => {
    const layers = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const s = getComputedStyle(e);
      const bg = rgba(s.backgroundColor);
      const image = s.backgroundImage;
      layers.push({bg, image});
      if (bg[3] >= 0.99 && image === 'none') break;
    }
    let pictures = false, bases = [[255, 255, 255, 1]];       // the page itself is white
    for (let i = layers.length - 1; i >= 0; i--) {
      const {bg, image} = layers[i];
      bases = bases.map(base => over(bg, base));
      if (image && image !== 'none') {
        if (/url\(/.test(image)) { pictures = true; continue; }
        const cols = gradientColours(image);
        if (cols.length) bases = bases.flatMap(base => cols.map(c => over(c, base)));
      }
    }
    return {bases, pictures};
  };
  const inView = r => r.width > 0 && r.height > 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set(), failures = [], unknown = [];
  let checked = 0, node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue.replace(/\s+/g, ' ').trim();
    if (!/[A-Za-z0-9]/.test(text)) continue;
    const el = node.parentElement;
    if (!el || seen.has(el) || /^(SCRIPT|STYLE|NOSCRIPT|OPTION)$/.test(el.tagName)) continue;
    seen.add(el);
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (!inView(rect)) continue;
    let opacity = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) opacity *= +getComputedStyle(e).opacity;
    if (opacity < 0.5) continue;                      // faded out / mid-animation
    if (el.closest('[aria-hidden="true"],[hidden],.hidden,.sr-only,.ph-hidden')) continue;
    if (parseFloat(s.fontSize) < 8) continue;
    // the part of the text that is really on screen: cut by every clipping ancestor and by the window
    let box = {l: Math.max(rect.left, 0), t: Math.max(rect.top, 0), r: Math.min(rect.right, innerWidth), b: Math.min(rect.bottom, innerHeight)};
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const o = getComputedStyle(e);
      if (e !== el && /(hidden|clip|auto|scroll)/.test(o.overflowX + o.overflowY)) {
        const r = e.getBoundingClientRect();
        box = {l: Math.max(box.l, r.left), t: Math.max(box.t, r.top), r: Math.min(box.r, r.right), b: Math.min(box.b, r.bottom)};
      }
    }
    if (box.r - box.l < 2 || box.b - box.t < 2) continue;      // clipped away, off screen: nobody can read it
    const hit = document.elementFromPoint((box.l + box.r) / 2, (box.t + box.b) / 2);
    if (!hit || !(hit === el || el.contains(hit) || (hit.contains(el) && s.pointerEvents === 'none'))) continue;     // something else is drawn on top
    let fg = rgba(s.webkitTextFillColor && s.webkitTextFillColor !== 'rgba(0, 0, 0, 0)' ? s.webkitTextFillColor : s.color);
    if (s.webkitTextFillColor === 'rgba(0, 0, 0, 0)' || fg[3] < 0.05) {
      if (/text/.test(s.webkitBackgroundClip || s.backgroundClip)) { unknown.push({text: text.slice(0, 40), why: 'gradient lettering'}); continue; }
      fg = rgba(s.color);
    }
    const {bases, pictures} = backdrop(el);
    checked++;
    if (pictures && bases.every(b => b[3] < 0.99 || (b[0] === 255 && b[1] === 255 && b[2] === 255))) { unknown.push({text: text.slice(0, 40), why: 'over a picture'}); continue; }
    let worst = 99, worstBg = null;
    for (const b of bases) {
      const colour = fg[3] < 1 ? over(fg, b) : fg;
      const r = ratio(colour, b);
      if (r < worst) { worst = r; worstBg = b; }
    }
    if (worst < (options.min || 3)) {
      const id = el.id ? '#' + el.id : '';
      el.setAttribute('data-fc-scan', String(failures.length));
      failures.push({n: failures.length, box: [box.l, box.t, box.r, box.b].map(Math.round), text: text.slice(0, 50), ratio: Math.round(worst * 100) / 100, color: s.color, fill: s.webkitTextFillColor,
                     background: 'rgb(' + worstBg.slice(0, 3).join(',') + ')', element: el.tagName.toLowerCase() + id + '.' + String(el.className).trim().split(/\s+/).slice(0, 2).join('.')});
    }
  }
  failures.sort((a, b) => a.ratio - b.ratio);
  return {checked, failures: failures.slice(0, 25), failure_count: failures.length, unknown: unknown.length, unknown_samples: unknown.slice(0, 5)};
})
"""


def parse_colour(text):
    """'rgb(1, 2, 3)' / 'rgba(1, 2, 3, 0.5)' -> (r, g, b, a)"""
    import re
    nums = [float(x) for x in re.findall(r'[0-9.]+', text or '')]
    if len(nums) < 3:
        return (0, 0, 0, 1.0)
    return (nums[0], nums[1], nums[2], nums[3] if len(nums) > 3 else 1.0)


def luminance(rgb):
    def f(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])


def ratio(a, b):
    x, y = luminance(a), luminance(b)
    return (max(x, y) + 0.05) / (min(x, y) + 0.05)


def worst_ratio(text_rgba, palette, min_share=0.12):
    """Lowest contrast between the text colour and any background colour that fills at least min_share of the box."""
    r, g, b, a = text_rgba
    worst = 99.0
    for entry in palette:
        if entry['share'] < min_share:
            continue
        bg = entry['color']
        fg = (r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a))
        worst = min(worst, ratio(fg, bg))
    return worst
