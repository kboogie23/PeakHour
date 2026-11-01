"""Page backgrounds from the region covers, without their title lettering.

The covers (static/brand/regions/<region>-cover.jpg, 1254x1254) carry the region
name and "90s HIP-HOP" across the top. Each is cropped below that lettering,
softened slightly so the page's own text reads over it, and written as
static/brand/regions/<region>-bg.jpg. A contact sheet goes to the scratch path
given as the first argument, if any.
Usage: python make_region_backgrounds.py [contact_sheet.jpg]
"""
import sys
from pathlib import Path

from PIL import Image, ImageFilter

FOLDER = Path(__file__).with_name('static') / 'brand' / 'regions'
# First row below each cover's title and "90s HIP-HOP" line (measured on the 1254 px covers).
CROP_TOP = {'east': 430, 'west': 400, 'south': 365, 'texas': 365, 'midwest': 445}
EDGE = 34  # the covers' worn sleeve border on the sides and bottom
BLUR = 1.6


def main():
    sheet_parts = []
    for name, top in CROP_TOP.items():
        cover = Image.open(FOLDER / f'{name}-cover.jpg').convert('RGB')
        background = cover.crop((EDGE, top, cover.width - EDGE, cover.height - EDGE)).filter(ImageFilter.GaussianBlur(BLUR))
        background.save(FOLDER / f'{name}-bg.jpg', quality=86, optimize=True)
        sheet_parts.append(background.resize((420, round(420 * background.height / background.width))))
        print(name, background.size)
    if len(sys.argv) > 1:
        width = sum(p.width for p in sheet_parts) + 10 * (len(sheet_parts) - 1)
        sheet = Image.new('RGB', (width, max(p.height for p in sheet_parts)), (20, 20, 20))
        x = 0
        for part in sheet_parts:
            sheet.paste(part, (x, 0))
            x += part.width + 10
        sheet.save(sys.argv[1], quality=85)


if __name__ == '__main__':
    main()
