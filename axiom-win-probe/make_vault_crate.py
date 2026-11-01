"""PEAK HOUR's crate for the "Adding your music" window: AXIOM's record-vault crate in the red theme with
the AXIOM "A / PRO" plate replaced by the PEAK HOUR mark. Writes static/brand/vault-crate.png."""
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from windows_theme import recolor_image

HERE = Path(__file__).resolve().parent
PLATE = (708, 728, 922, 1000)  # inside the crate's front label frame (1254 px image)


def main():
    crate = Image.open(BytesIO(recolor_image((HERE / 'static/assets/record-vault/crate.png').read_bytes()))).convert('RGBA')
    left, top, right, bottom = PLATE
    width, height = right - left, bottom - top
    panel = Image.new('RGBA', (width, height))
    shade = ImageDraw.Draw(panel)
    for y in range(height):  # dark plastic, a little lighter at the top like the rest of the crate
        tone = int(30 - 14 * y / height)
        shade.line([(0, y), (width, y)], fill=(tone, tone, tone + 1, 255))
    mask = Image.new('L', (width, height))
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, height - 1), radius=16, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))
    crate.paste(panel, (left, top), mask)
    mark = Image.open(HERE / 'static/brand/peak-hour-mark-512.png').convert('RGBA')
    size = int(width * 0.82)
    mark = mark.resize((size, size), Image.LANCZOS)
    glow = Image.new('RGBA', mark.size, (226, 40, 52, 0))
    glow.putalpha(mark.getchannel('A').filter(ImageFilter.GaussianBlur(14)).point(lambda a: a * 0.55))
    x, y = left + (width - size) // 2, top + (height - size) // 2
    crate.alpha_composite(glow, (x, y))
    crate.alpha_composite(mark, (x, y))
    out = HERE / 'static/brand/vault-crate.png'
    crate.save(out, optimize=True)
    print(out, crate.size)


if __name__ == '__main__':
    main()
