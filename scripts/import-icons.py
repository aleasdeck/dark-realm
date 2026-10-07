#!/usr/bin/env python3
"""
Turns hand-drawn interface icons into the game's icon files.

    python3 scripts/import-icons.py "<folder with ui/*.png>" [app icon.png]

Each <id>.png from the folder's ui/ (or the folder itself) becomes
src/assets/icons/<id>.webp: trimmed to the drawing, centered on a square
transparent canvas and scaled to three times the size it is shown at
(the sizes from the icon sheet, see SIZES). favicon.png becomes the browser
tab icon and the optional second argument (or ui/app_icon.png) the home
screen icon, both in src/assets/app/. The game picks the icons up by name
(src/ui/icons.ts); a missing one leaves the old glyph in its place.

Needs Pillow (python3 -m pip install pillow).
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src/assets/icons'
APP = ROOT / 'src/assets/app'

BIG = {'tavern_marked': 144, 'win': 192, 'lose': 192, 'coin_sun': 384, 'coin_moon': 384}
SMALL = 48  # resources, piles, card marks, effects
BUTTON = 72
SMALL_IDS = {
    'res_prestige', 'res_power', 'res_coin', 'pile_deck', 'pile_discard',
    'kind_action', 'kind_agent', 'kind_contract', 'kind_curse', 'combo', 'trigger', 'lock',
}
# the price coin and the shields carry a number, so they keep their whole frame
FRAMES = {'cost', 'hp', 'hp_taunt'}


def size_of(name: str) -> int:
    if name in BIG:
        return BIG[name]
    return SMALL if name in SMALL_IDS or name.startswith('fx_') else BUTTON


def fit(im: Image.Image, size: int, margin: float) -> Image.Image:
    im = im.convert('RGBA')
    box = im.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox() or (0, 0, *im.size)
    im = im.crop(box)
    side = round(max(im.size) * (1 + 2 * margin))
    canvas = Image.new('RGBA', (side, side))
    canvas.alpha_composite(im, ((side - im.width) // 2, (side - im.height) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    if (src / 'ui').is_dir():
        src = src / 'ui'
    OUT.mkdir(parents=True, exist_ok=True)
    APP.mkdir(parents=True, exist_ok=True)
    done = []
    for f in sorted(src.glob('*.png')):
        name = f.stem.lower()
        im = Image.open(f)
        if name == 'app_icon':
            continue
        if name == 'favicon':
            fit(im, 64, 0.02).save(APP / 'favicon.png', optimize=True)
            done.append('favicon')
            continue
        size = size_of(name)
        fit(im, size, 0 if name in FRAMES else 0.03).save(OUT / f'{name}.webp', quality=90, method=6)
        done.append(name)
    app = Path(sys.argv[2]) if len(sys.argv) > 2 else src / 'app_icon.png'
    if app.exists():
        Image.open(app).convert('RGB').resize((180, 180), Image.LANCZOS).save(APP / 'app-icon.png', optimize=True)
        done.append('app-icon')
    print(f'{len(done)} icons: {", ".join(done)}')


if __name__ == '__main__':
    main()
