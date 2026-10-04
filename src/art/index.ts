/**
 * Dark Realm procedural pixel art. Every image is a 128x128 native pixel-art canvas
 * (hard pixels, limited ramps, Bayer dithering, 1px outlines). Display it with
 * `image-rendering: pixelated`.
 */
import { background } from './background';
import { hex } from './color';
import { renderCardBack, renderEmblem } from './emblems';
import { Draw, H, W } from './pixel';
import { buildRamps } from './ramps';
import { compose } from './render';
import { hashStr, Rng } from './rng';
import { BG_OPTS, DRAWERS, SUBJECTS as SUBJECT_LIST } from './subjects';

export type ArtPalette = { bg1: string; bg2: string; accent: string; glow: string };
export const SUBJECTS = SUBJECT_LIST;
export type Subject = (typeof SUBJECTS)[number];

function renderPixels(subject: Subject, palette: ArtPalette, seed: number): Uint8ClampedArray {
  const base = (hashStr(subject) ^ Math.imul(seed | 0, 2654435761)) >>> 0;
  const bg1 = hex(palette.bg1), bg2 = hex(palette.bg2), accent = hex(palette.accent), glow = hex(palette.glow);
  const R = buildRamps(accent, glow, new Rng(base ^ 0x51ed27));
  const bg = background({ bg1, bg2, accent, glow }, new Rng(base ^ 0xa5a5a5), BG_OPTS[subject] ?? {});
  const d = new Draw();
  const drawer = DRAWERS[subject] ?? DRAWERS.skull;
  drawer({ d, r: new Rng(base), R });
  return compose(bg, d, { glow: R.GLOW });
}

function toCanvas(px: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(W, H);
    img.data.set(px);
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

export function renderArt(subject: Subject, palette: ArtPalette, seed: number): HTMLCanvasElement {
  return toCanvas(renderPixels(subject, palette, seed));
}

const cache = new Map<string, string>();
function cached(key: string, make: () => Uint8ClampedArray): string {
  let u = cache.get(key);
  if (u === undefined) {
    u = toCanvas(make()).toDataURL('image/png');
    cache.set(key, u);
  }
  return u;
}
const palKey = (p: ArtPalette) => `${p.bg1}|${p.bg2}|${p.accent}|${p.glow}`;

export function artUrl(subject: Subject, palette: ArtPalette, seed: number): string {
  return cached(`a|${subject}|${palKey(palette)}|${seed}`, () => renderPixels(subject, palette, seed));
}

export function cardBackUrl(): string {
  return cached('cardback', renderCardBack);
}

export function patronEmblemUrl(patronId: string, palette: ArtPalette): string {
  return cached(`e|${patronId}|${palKey(palette)}`, () => renderEmblem(patronId, palette));
}
