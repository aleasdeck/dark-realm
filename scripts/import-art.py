#!/usr/bin/env python3
"""
Turns hand-drawn PNGs into the game's art files.

    python3 scripts/import-art.py "<folder with drawings>"

A file named after a card (as in src/engine/cards.ts, case and ё/е don't
matter) or after its id becomes src/assets/cards/<card id>.webp, 512×512.
A file named «Эмблема покровителя <Имя>» (or a patron id) becomes
src/assets/patrons/<patron id>.webp, 256×256 with a transparent backdrop:
a plain black backdrop is keyed out, and the medallion is scaled to fit the
round frame it is shown in. The game picks the files up by name
(src/art/custom.ts); cards without a file keep the generated pixel art.

Needs Pillow (python3 -m pip install pillow).
"""
import math
import re
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
CARD_SIZE, EMBLEM_SIZE = 512, 256


def norm(s: str) -> str:
    return re.sub(r'\s+', ' ', s.lower().replace('ё', 'е')).strip()


def load_names():
    src = (ROOT / 'src/engine/cards.ts').read_text(encoding='utf-8')
    cards = {}
    for cid, name, patron in re.findall(r"id: '([a-z0-9_]+)', name: '([^']+)', patron: '([a-z]+)'", src):
        cards[cid] = (name, patron)
    patrons = dict(re.findall(r"\n  ([a-z]+): \{\n    id: '[a-z]+',\n    name: '([^']+)'", src))
    return cards, patrons


def cover(im: Image.Image, size: int) -> Image.Image:
    w, h = im.size
    side = min(w, h)
    box = ((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2)
    return im.crop(box).resize((size, size), Image.LANCZOS)


def emblem(im: Image.Image) -> Image.Image:
    if im.mode in ('RGBA', 'LA') and im.getchannel('A').getextrema()[0] < 250:
        rgba = im.convert('RGBA')
    else:
        rgb = im.convert('RGB')
        gray = rgb.convert('L')
        # flood the backdrop from a corner over near-black pixels only, so dark paint inside stays opaque
        bg = gray.point(lambda v: 255 if v <= 1 else 0)
        ImageDraw.floodfill(bg, (0, 0), 128)
        bg = bg.point(lambda v: 255 if v == 128 else 0)
        # along the silhouette, fade dark fringe pixels by brightness instead of a hard cut
        band = bg.filter(ImageFilter.MaxFilter(7))
        fade = gray.point(lambda v: min(255, v * 8))
        alpha = Image.composite(fade, Image.new('L', rgb.size, 255), band)
        alpha = Image.composite(Image.new('L', rgb.size, 0), alpha, bg).filter(ImageFilter.GaussianBlur(0.8))
        rgba = rgb.copy()
        rgba.putalpha(alpha)
    # the game clips emblems to a circle: size the crop so the farthest opaque pixel fits inside it
    a = rgba.getchannel('A')
    bb = a.point(lambda v: 255 if v > 20 else 0).getbbox()
    if not bb:
        return cover(rgba, EMBLEM_SIZE)
    cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
    px, r = a.load(), 0.0
    for y in range(bb[1], bb[3], 2):
        for x in range(bb[0], bb[2], 2):
            if px[x, y] > 20:
                r = max(r, math.hypot(x - cx, y - cy))
    r = int(r * 1.02) + 2
    canvas = Image.new('RGBA', (2 * r, 2 * r), (0, 0, 0, 0))
    canvas.paste(rgba.crop((int(cx - r), int(cy - r), int(cx + r), int(cy + r))), (0, 0))
    return canvas.resize((EMBLEM_SIZE, EMBLEM_SIZE), Image.LANCZOS)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    folder = Path(sys.argv[1])
    cards, patrons = load_names()
    by_card = {norm(n): cid for cid, (n, _) in cards.items()} | {cid: cid for cid in cards}
    by_patron = {norm(n): pid for pid, n in patrons.items()} | {pid: pid for pid in patrons}
    out_cards, out_patrons = ROOT / 'src/assets/cards', ROOT / 'src/assets/patrons'
    out_cards.mkdir(parents=True, exist_ok=True)
    out_patrons.mkdir(parents=True, exist_ok=True)
    unmatched, decks = [], set()
    for f in sorted(folder.iterdir()):
        if f.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp'):
            continue
        key = norm(f.stem)
        m = re.match(r'эмблема(?: покровителя)? (.+)$', key)
        if m and m.group(1) in by_patron or key in patrons:
            pid = by_patron[m.group(1) if m else key]
            emblem(Image.open(f)).save(out_patrons / f'{pid}.webp', 'WEBP', quality=88, method=6)
            print(f'emblem  {f.name} -> patrons/{pid}.webp')
            decks.add(pid)
        elif key in by_card:
            cid = by_card[key]
            cover(Image.open(f).convert('RGB'), CARD_SIZE).save(out_cards / f'{cid}.webp', 'WEBP', quality=84, method=6)
            print(f'card    {f.name} -> cards/{cid}.webp')
            decks.add(cards[cid][1])
        else:
            unmatched.append(f.name)
    for name in unmatched:
        print(f'NO MATCH {name}')
    have = {p.stem for p in out_cards.glob('*.webp')}
    for pid in sorted(decks):
        missing = [n for cid, (n, p) in cards.items() if p == pid and cid not in have]
        if missing:
            print(f'{pid}: still without art: ' + ', '.join(missing))


if __name__ == '__main__':
    main()
