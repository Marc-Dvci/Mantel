"""Draw the launcher banner, the app icon and the store icon from the product's own font and colours.

    .media-venv/Scripts/python tools/media/draw_brand.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / "tools/media/atkinson-700.ttf"
RES = ROOT / "android/app/src/main/res"
BG_TOP, BG_BOTTOM = (28, 39, 53), (19, 26, 36)
INK, ACCENT = (247, 241, 230), (242, 181, 107)


def gradient(w: int, h: int) -> Image.Image:
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)))
    return im


def shelf(d: ImageDraw.ImageDraw, cx: int, y: int, w: int, s: float) -> None:
    """The mark: a mantel shelf with a clock face and a photo frame standing on it."""
    d.rounded_rectangle([cx - w // 2, y, cx + w // 2, y + int(7 * s)], radius=int(3 * s), fill=ACCENT)
    r = int(17 * s)
    ccx, ccy = cx - r - int(3 * s), y - r - int(3 * s)
    d.ellipse([ccx - r, ccy - r, ccx + r, ccy + r], outline=INK, width=max(2, int(3.2 * s)))
    d.line([ccx, ccy, ccx, ccy - int(r * 0.6)], fill=INK, width=max(2, int(3 * s)))
    d.line([ccx, ccy, ccx + int(r * 0.45), ccy], fill=INK, width=max(2, int(3 * s)))
    fw, fh = int(26 * s), int(32 * s)
    fx = cx + fw // 2 + int(3 * s)
    d.rounded_rectangle([fx - fw // 2, y - fh - int(3 * s), fx + fw // 2, y - int(3 * s)], radius=int(3 * s), outline=INK, width=max(2, int(3.2 * s)))


def banner() -> None:
    w, h, s = 320, 180, 1.0
    im = gradient(w, h)
    d = ImageDraw.Draw(im)
    shelf(d, 72, 104, 96, 1.0)
    font = ImageFont.truetype(str(FONT), 46)
    d.text((136, 64), "Mantel", font=font, fill=INK)
    small = ImageFont.truetype(str(FONT), 15)
    d.text((138, 118), "in your family's words", font=small, fill=ACCENT)
    (RES / "drawable").mkdir(parents=True, exist_ok=True)
    im.save(RES / "drawable/banner.png")


def icon(size: int, path: Path) -> None:
    im = gradient(size, size)
    d = ImageDraw.Draw(im)
    s = size / 96
    shelf(d, size // 2, int(size * 0.66), int(size * 0.72), s * 0.95)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path)


if __name__ == "__main__":
    banner()
    icon(96, RES / "mipmap-xhdpi/ic_launcher.png")
    icon(512, ROOT / "docs/img/icon-512.png")
    print("drew banner and icons")
