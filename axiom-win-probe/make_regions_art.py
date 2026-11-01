"""Region wall art for PEAK HOUR's inner pages (90s hip-hop regions), drawn procedurally.

east.jpg     Library      East Coast   dark subway tile with a wheat-tan stripe and red tag drips
west.jpg     Studio       West Coast   sunset sky over palm trees and a low skyline
south.jpg    Performance  Dirty South  speaker-cone wall in gold on black
texas.jpg    Playlists    Texas        candy-purple metal flake with a chrome lone star
midwest.jpg  Health       Midwest      steel diamond plate with rivets
All 1600x1000, dark enough for the page's own panels to sit on top. Writes static/brand/regions/.
Usage: python make_regions_art.py
"""
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1600, 1000
OUT = Path(__file__).with_name('static') / 'brand' / 'regions'


def to_image(array):
    return Image.fromarray(np.clip(array, 0, 255).astype(np.uint8), 'RGB')


def noise(rng, amount):
    return rng.normal(0, amount, (H, W, 1))


def east(rng):
    tile_w, tile_h, grout = 96, 40, 4
    wall = np.full((H, W, 3), (58, 60, 58), float)  # grout
    for row, top in enumerate(range(0, H, tile_h)):
        for left in range((tile_w // 2) * (row % 2) - tile_w, W, tile_w):
            x0, y0, x1, y1 = max(left + grout, 0), top + grout, min(left + tile_w - grout, W), min(top + tile_h - grout, H)
            if x1 > x0 and y1 > y0:
                shade = rng.uniform(26, 38)
                wall[y0:y1, x0:x1] = (shade, shade + 2, shade + 1)
                wall[y0:y0 + 3, x0:x1] += 22  # glaze highlight on each tile
    wall[int(H * .58):int(H * .58) + 44] = (150, 112, 62)  # wheat-tan band
    img = to_image(wall + noise(rng, 5))
    draw = ImageDraw.Draw(img)
    for _ in range(40):
        x, y = rng.integers(0, W), rng.integers(int(H * .62), H - 40)
        draw.line((x, y, x, y + rng.integers(20, 120)), fill=(190, 12, 30), width=int(rng.integers(2, 5)))
    return img


def west(rng):
    y = np.linspace(0, 1, H)[:, None, None]
    sky = (np.array([46, 12, 64]) * (1 - y) + np.array([214, 86, 38]) * y)  # purple to sunset orange
    img = to_image(np.repeat(sky, W, axis=1) + noise(rng, 3))
    draw = ImageDraw.Draw(img)
    draw.ellipse((W * .62, H * .52, W * .62 + 260, H * .52 + 260), fill=(255, 150, 60))  # the sun
    horizon = int(H * .78)
    for x in range(0, W, 46):  # low skyline
        h = rng.integers(20, 120)
        draw.rectangle((x, horizon - h, x + 40, H), fill=(14, 8, 18))
    draw.rectangle((0, horizon, W, H), fill=(10, 6, 12))
    for base_x in (160, 420, 1180, 1430):  # palm trees
        top_x, top_y = base_x + rng.integers(-60, 60), int(H * .28) + rng.integers(-40, 40)
        draw.line((base_x, H, top_x, top_y), fill=(8, 4, 10), width=14)
        for k in range(9):  # drooping fronds: an arc out and down, leaflets along it
            direction = -1 if k % 2 else 1
            spread = 40 + 22 * (k // 2)
            length = rng.uniform(150, 210)
            path = [(top_x + direction * length * t, top_y - spread * math.sin(math.pi * t) * 0.9 + 70 * t * t + (k - 4) * 6)
                    for t in np.linspace(0, 1, 14)]
            draw.line(path, fill=(8, 4, 10), width=7)
            for (px, py), t in zip(path[2:], np.linspace(0.15, 1, 12)):
                draw.line((px, py, px + direction * 10, py + 26 * (1.1 - t)), fill=(8, 4, 10), width=4)
    return Image.fromarray((np.array(img, float) * 0.62).astype(np.uint8))


def south(rng):
    img = to_image(np.full((H, W, 3), 12.0) + noise(rng, 4))
    draw = ImageDraw.Draw(img)
    size = 200
    for row, cy in enumerate(range(size // 2, H + size, size)):
        for cx in range((size // 2) * (row % 2), W + size, size):
            for r, color in ((92, (110, 86, 30)), (84, (22, 20, 16)), (60, (40, 36, 26)), (34, (156, 122, 40)), (22, (24, 22, 18))):
                draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color)
            for k in range(6):  # bolts on the speaker ring
                a = k * math.pi / 3
                bx, by = cx + 88 * math.cos(a), cy + 88 * math.sin(a)
                draw.ellipse((bx - 4, by - 4, bx + 4, by + 4), fill=(212, 175, 55))
    return img.filter(ImageFilter.GaussianBlur(0.6))


def texas(rng):
    y, x = np.mgrid[0:H, 0:W] / max(W, H)
    base = np.array([60, 16, 92]) * (0.6 + 0.6 * np.exp(-((x - .55) ** 2 + (y - .35) ** 2) * 6))[..., None]
    flake = (rng.random((H, W, 1)) > 0.985) * rng.uniform(60, 140, (H, W, 1))
    img = to_image(base + flake + noise(rng, 6))
    draw = ImageDraw.Draw(img)
    cx, cy, outer, inner = W * .78, H * .42, 230, 92
    points = [(cx + (outer if k % 2 == 0 else inner) * math.sin(k * math.pi / 5),
               cy - (outer if k % 2 == 0 else inner) * math.cos(k * math.pi / 5)) for k in range(10)]
    draw.polygon(points, outline=(214, 214, 220), width=10)
    return img


def midwest(rng):
    plate = np.full((H, W, 3), (62, 70, 78), float) + noise(rng, 6)
    img = to_image(plate)
    draw = ImageDraw.Draw(img)
    step = 40
    for row, y in enumerate(range(0, H + step, step)):
        for x in range((step // 2) * (row % 2), W + step, step):  # raised diamond tread
            draw.line((x - 10, y + 6, x + 10, y - 6), fill=(118, 128, 138), width=6)
            draw.line((x - 9, y + 8, x + 11, y - 4), fill=(36, 40, 46), width=2)
    for y in range(30, H, 250):  # riveted seams
        draw.line((0, y, W, y), fill=(30, 34, 38), width=4)
        for x in range(30, W, 120):
            draw.ellipse((x - 7, y + 10, x + 7, y + 24), fill=(150, 158, 166))
    return Image.fromarray((np.array(img, float) * 0.55).astype(np.uint8))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, make, seed in (('east', east, 1), ('west', west, 2), ('south', south, 3), ('texas', texas, 4), ('midwest', midwest, 5)):
        make(np.random.default_rng(seed)).save(OUT / f'{name}.jpg', quality=86)
    print('wrote', sorted(p.name for p in OUT.iterdir()))


if __name__ == '__main__':
    main()
