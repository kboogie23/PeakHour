"""90s urban artwork for PEAK HOUR (Windows edition), drawn procedurally.

- doors-brick.jpg (1473x1068): night-time brick alley wall with a streetlight pool, red spray-paint
  drips and a wet sidewalk; replaces AXIOM's futuristic entrance doors.
- fresh-set-paint.jpg (1983x793): brick wall with a red spray-painted panel on the left (where the
  card's dark text sits) running into bare brick; replaces the neon-tile card art.
- brick-tile.png (240x176): small dark brick tile for the sidebar background.
Writes into static/brand/90s/. Usage: python make_90s_art.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).with_name('static') / 'brand' / '90s'
MORTAR = np.array([38, 34, 33], float)


def bricks(width, height, rng, brick=(96, 44), joint=6, tone=1.0):
    """Running-bond brick wall as an RGB float array."""
    bw, bh = brick
    wall = np.empty((height, width, 3), float)
    wall[:] = MORTAR
    for row, top in enumerate(range(-bh // 2, height, bh)):
        offset = (bw // 2) * (row % 2) - bw
        for left in range(offset, width, bw):
            x0, y0 = max(left + joint // 2, 0), max(top + joint // 2, 0)
            x1, y1 = min(left + bw - joint // 2, width), min(top + bh - joint // 2, height)
            if x1 <= x0 or y1 <= y0:
                continue
            base = np.array([rng.uniform(105, 150), rng.uniform(40, 62), rng.uniform(32, 48)]) * rng.uniform(0.7, 1.08) * tone
            wall[y0:y1, x0:x1] = base
    grain = rng.normal(0, 9, (height, width, 1)) + rng.normal(0, 4, (height, width, 3))
    blotch = np.array(Image.fromarray(rng.integers(0, 255, (height // 24 + 1, width // 24 + 1), dtype=np.uint8))
                      .resize((width, height), Image.BICUBIC), float)[..., None] / 255
    return wall * (0.82 + 0.3 * blotch) + grain


def light(width, height, cx, cy, radius, strength, floor):
    y, x = np.mgrid[0:height, 0:width]
    d = np.hypot((x - cx) / radius, (y - cy) / (radius * 1.25))
    return floor + strength * np.exp(-d ** 2)


def drips(draw, rng, x, y, length, color, width):
    draw.line((x, y, x, y + length), fill=color, width=width)
    draw.ellipse((x - width, y + length - width, x + width, y + length + width), fill=color)


def entrance(rng):
    w, h = 1473, 1068
    ground = int(h * 0.80)
    wall = bricks(w, ground, rng, tone=0.72)
    wall *= light(w, ground, w / 2, ground * 0.12, w * 0.34, 1.15, 0.12)[..., None]
    image = np.zeros((h, w, 3), float)
    image[:ground] = wall
    # wet sidewalk: concrete slabs reflecting the light and the wall
    sidewalk = np.full((h - ground, w, 3), 46.0) + rng.normal(0, 6, (h - ground, w, 1))
    sidewalk *= light(w, h - ground, w / 2, 0, w * 0.35, 0.9, 0.35)[..., None]
    reflection = wall[::-1][: h - ground] * 0.22
    image[ground:] = sidewalk + reflection
    img = Image.fromarray(np.clip(image, 0, 255).astype(np.uint8), 'RGB')
    draw = ImageDraw.Draw(img)
    for x in range(0, w, 300):
        draw.line((x + 40, ground + 4, x - 120, h), fill=(26, 24, 24), width=3)  # slab joints
    draw.rectangle((0, ground - 6, w, ground + 2), fill=(30, 27, 27))  # curb line
    paint = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    pdraw = ImageDraw.Draw(paint)
    for x0, x1, y in ((60, 420, 120), (1060, 1410, 160)):
        for _ in range(2600):  # a sprayed band: soft overlapping paint dots, denser in the middle
            px, py = rng.uniform(x0, x1), y + 17 + rng.normal(0, 9)
            r = rng.uniform(2, 7)
            pdraw.ellipse((px - r, py - r, px + r, py + r), fill=(200, 10, 30, int(rng.integers(40, 110))))
        for _ in range(9):
            drips(pdraw, rng, rng.integers(x0, x1), y + 26, rng.integers(30, 160), (185, 8, 28, 190), int(rng.integers(3, 6)))
    img = Image.alpha_composite(img.convert('RGBA'), paint.filter(ImageFilter.GaussianBlur(1.6))).convert('RGB')
    vignette = light(w, h, w / 2, h * 0.35, w * 0.6, 0.65, 0.32)
    return Image.fromarray(np.clip(np.array(img, float) * vignette[..., None], 0, 255).astype(np.uint8))


def fresh_set(rng):
    w, h = 1983, 793
    wall = bricks(w, h, rng, brick=(120, 54), joint=8)
    x = np.arange(w)[None, :, None]
    edge = 1 - np.clip((x - 980) / 220, 0, 1)  # painted panel fades out with uneven spray edge
    edge = edge * (0.9 + 0.1 * rng.random((h, 1, 1)))
    red = np.array([214, 18, 36], float)
    painted = red * (0.78 + 0.22 * (wall / 140)) * 0.95
    image = wall * 0.55 * (1 - edge) + painted * edge
    img = Image.fromarray(np.clip(image, 0, 255).astype(np.uint8), 'RGB')
    draw = ImageDraw.Draw(img)
    for _ in range(26):
        drips(draw, rng, rng.integers(880, 1190), rng.integers(40, h - 200), rng.integers(40, 220), (196, 14, 32), int(rng.integers(3, 7)))
    return img


def tile(rng):
    wall = bricks(240, 176, rng, brick=(80, 44), joint=5, tone=0.5)
    return Image.fromarray(np.clip(wall * 0.55, 0, 255).astype(np.uint8))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    entrance(np.random.default_rng(1990)).save(OUT / 'doors-brick.jpg', quality=90)
    fresh_set(np.random.default_rng(1994)).save(OUT / 'fresh-set-paint.jpg', quality=90)
    tile(np.random.default_rng(1996)).save(OUT / 'brick-tile.png')
    print('wrote', sorted(p.name for p in OUT.iterdir()))


if __name__ == '__main__':
    main()
