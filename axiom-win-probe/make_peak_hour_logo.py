"""Draws the PEAK HOUR "Vinyl Peak" logo (static/brand/peak-hour-mark.svg) as PNG files.

Same geometry and colours as the SVG (256-unit canvas), drawn at 2048 px and scaled down for smooth
edges. Writes static/brand/peak-hour-mark-{1024,512,256,64}.png and favicon.ico.
Usage: python make_peak_hour_logo.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

BIG = 2048
S = BIG / 256
OUT = Path(__file__).with_name('static') / 'brand'
WAVE = [(26, 150), (52, 150), (62, 138), (72, 160), (84, 132), (96, 150), (106, 150), (128, 40), (150, 150),
        (160, 150), (172, 132), (184, 160), (194, 138), (204, 150), (230, 150)]
PEAK = [(106, 150), (128, 40), (150, 150)]


def stops(t, points):
    """Linear interpolation of colour stops [(offset, (r, g, b))] for an array of offsets."""
    offsets = [p[0] for p in points]
    channels = [np.interp(t, offsets, [p[1][i] for p in points]) for i in range(3)]
    return np.stack(channels, axis=-1)


def circle_mask(radius):
    mask = Image.new('L', (BIG, BIG), 0)
    c = 128 * S
    ImageDraw.Draw(mask).ellipse((c - radius * S, c - radius * S, c + radius * S, c + radius * S), fill=255)
    return mask


def fill(image, colors, mask):
    layer = Image.fromarray(colors.astype(np.uint8), 'RGB').convert('RGBA')
    image.paste(layer, (0, 0), mask)


def line(draw, points, color, width):
    scaled = [(x * S, y * S) for x, y in points]
    draw.line(scaled, fill=color, width=int(width * S), joint='curve')
    r = width * S / 2
    for x, y in (scaled[0], scaled[-1]):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


def draw_logo():
    image = Image.new('RGBA', (BIG, BIG), (0, 0, 0, 0))
    y, x = np.mgrid[0:BIG, 0:BIG] / BIG
    platinum = stops((x + y) / 2, [(0, (255, 255, 255)), (.35, (217, 216, 214)), (.55, (143, 147, 152)),
                                   (.8, (229, 228, 226)), (1, (169, 173, 178))])
    fill(image, platinum, circle_mask(118))
    radius = np.hypot(x - .5, y - .5) / (108 / 256)
    fill(image, stops(np.clip(radius, 0, 1), [(0, (28, 26, 26)), (1, (5, 5, 5))]), circle_mask(108))
    draw = ImageDraw.Draw(image)
    c = 128 * S
    for groove in (98, 88, 78, 68, 58):
        r = groove * S
        draw.ellipse((c - r, c - r, c + r, c + r), outline=(42, 39, 39, 255), width=max(1, int(1.5 * S)))
    label = stops((y - (128 - 36) / 256) / (72 / 256), [(0, (255, 51, 70)), (1, (168, 0, 22))])
    fill(image, label, circle_mask(36))
    draw = ImageDraw.Draw(image)
    draw.ellipse((c - 5 * S, c - 5 * S, c + 5 * S, c + 5 * S), fill=(13, 12, 12, 255))
    line(draw, WAVE, (255, 255, 255, 255), 8)
    glow = Image.new('RGBA', (BIG, BIG), (0, 0, 0, 0))
    line(ImageDraw.Draw(glow), PEAK, (255, 51, 70, 255), 8)
    image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(4 * S)))
    image.alpha_composite(glow)
    return image


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    logo = draw_logo()
    for size in (1024, 512, 256, 64):
        logo.resize((size, size), Image.LANCZOS).save(OUT / f'peak-hour-mark-{size}.png', optimize=True)
    logo.resize((256, 256), Image.LANCZOS).save(OUT / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('wrote', sorted(p.name for p in OUT.iterdir()))


if __name__ == '__main__':
    main()
