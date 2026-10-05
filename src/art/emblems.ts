/** Patron emblems (medallions with a symbol) and the card back. */
import { background } from './background';
import { hex, mix } from './color';
import { arcPts, bayer, Draw, ERASE, H, N, W } from './pixel';
import { buildRamps, type Ramps } from './ramps';
import { compose } from './render';
import { hashStr, Rng } from './rng';
import { DRAWERS, sigil, type Ctx } from './subjects';

type Pal = { bg1: string; bg2: string; accent: string; glow: string };

function crowHead({ d, R }: Ctx): void {
  const C = R.dark;
  d.poly([50, 70, 92, 66, 100, 84, 96, 100, 86, 94, 80, 106, 70, 96, 60, 106, 56, 90], C, 'diag');
  d.ell(68, 56, 26, 24, C);
  d.poly([48, 46, 12, 62, 46, 70], [0x1a1820, 0x3a3640, 0x6c6674, 0x9a94a2], 'diag');
  d.line(14, 62, 46, 59, 0x0b0910);
  d.lines([60, 34, 72, 30, 84, 36], C[3] as number);
  for (let k = 0; k < 4; k++) d.line(60 + k * 8, 76, 64 + k * 8, 90, C[0] as number);
  d.on('fx');
  d.ell(60, 52, 4, 4, R.glow);
  d.px(59, 51, R.WHITE);
  d.on('main');
}

function owl({ d, R }: Ctx): void {
  const F = R.fur.map((c) => mix(c, R.acc[1] as number, 0.25));
  const L = d.sph(54, 50, 44, 56);
  // branch and talons
  d.cap(14, 108, 114, 104, 4, R.wood);
  // wings folded along the body
  d.poly([36, 56, 26, 80, 30, 100, 44, 108, 50, 70], F[0] as number);
  d.poly([92, 56, 102, 80, 98, 100, 84, 108, 78, 70], F[0] as number);
  d.ell(64, 80, 28, 30, F, L);
  for (let y = 70; y < 104; y += 7) for (let x = 52 + ((y / 7) % 2) * 4; x < 78; x += 8) d.lines([x - 2, y, x, y + 2, x + 2, y], F[3] as number);
  // head with ear tufts
  d.poly([38, 40, 34, 14, 52, 30], F, 'diag');
  d.poly([90, 40, 94, 14, 76, 30], F, 'diag');
  d.ell(64, 46, 30, 22, F, L);
  // facial discs
  const disc = R.bone.map((c) => mix(c, R.acc[2] as number, 0.2));
  d.ell(51, 47, 13, 12, disc, 2);
  d.ell(77, 47, 13, 12, disc, 2);
  d.poly([60, 54, 68, 54, 64, 64], R.gold, 1);
  for (const x of [57, 61, 67, 71]) d.cap(x, 106, x + (x < 64 ? -2 : 2), 112, 1.6, R.bone);
  d.on('fx');
  for (const x of [51, 77]) {
    d.ell(x, 47, 7, 7, R.glow);
    d.ell(x, 47, 3, 3, R.VOID);
    d.px(x - 2, 45, R.WHITE);
  }
  d.on('main');
}

function rajhin({ d, R }: Ctx): void {
  const M = R.gold;
  d.poly([30, 44, 26, 12, 48, 30, 80, 30, 102, 12, 98, 44, 104, 70, 92, 96, 64, 110, 36, 96, 24, 70], M, d.sph(56, 50, 50, 60));
  d.poly([32, 36, 30, 20, 44, 32], R.acc, 1);
  d.poly([96, 36, 98, 20, 84, 32], R.acc, 1);
  // eye holes slanted
  d.poly([36, 54, 56, 60, 54, 66, 40, 62], ERASE);
  d.poly([92, 54, 72, 60, 74, 66, 88, 62], ERASE);
  d.lines([34, 50, 56, 56], M[4] as number);
  d.lines([94, 50, 72, 56], M[4] as number);
  // nose
  d.poly([60, 72, 68, 72, 64, 77], R.acc[1] as number);
  // grin
  const top = arcPts(64, 70, 34, 14, 0.15, Math.PI - 0.15, 12);
  const bot = arcPts(64, 70, 30, 26, Math.PI - 0.25, 0.25, 12);
  d.poly([...top, ...bot], R.VOID);
  for (let k = 0; k < 9; k++) {
    const x = 40 + k * 6;
    const y = 70 + Math.sin(Math.acos(Math.max(-1, Math.min(1, (x - 64) / 34)))) * 14;
    d.poly([x - 2.5, y - 1, x + 2.5, y - 1, x, y + 5], R.bone[3] as number);
  }
  // whisker marks
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) d.line(64 + s * 30, 74 + k * 5, 64 + s * 42, 72 + k * 6, M[1] as number);
  d.on('fx');
  d.ell(46, 61, 2, 2, R.GLOW);
  d.ell(82, 61, 2, 2, R.GLOW);
  d.on('main');
}

const EMBLEMS: Record<string, (c: Ctx) => void> = {
  crows: crowHead,
  hlaalu: (c) => c.d.scaled(0.9, 64, 64, () => DRAWERS.rat(c)),
  pelin: (c) => c.d.scaled(0.84, 66, 70, () => DRAWERS.wolf(c)),
  psijic: owl,
  rajhin,
  eagle: (c) => c.d.scaled(0.9, 64, 66, () => DRAWERS.eagle(c)),
  treasury: (c) => c.d.scaled(0.78, 64, 66, () => DRAWERS.chest(c)),
  alma: (c) => c.d.scaled(0.9, 64, 64, () => DRAWERS.spider(c)),
  hunding: (c) => c.d.scaled(0.9, 64, 64, () => DRAWERS.sword(c)),
  druid: (c) => c.d.scaled(0.86, 64, 66, () => DRAWERS.rune(c)),
  mora: (c) => c.d.scaled(0.86, 64, 66, () => DRAWERS.tentacle(c)),
  alessia: (c) => c.d.scaled(0.86, 64, 66, () => DRAWERS.beast(c)),
  orgnum: (c) => c.d.scaled(0.86, 64, 66, () => DRAWERS.serpent(c)),
};

function genericSigil({ d, r, R }: Ctx): void {
  d.ring(64, 64, 34, 34, 5, R.acc);
  d.on('fx');
  sigil(d, 64, 64, 24, R.GLOW);
  d.on('main');
  void r;
}

export function renderEmblem(patronId: string, pal: Pal): Uint8ClampedArray {
  const seed = hashStr('emblem:' + patronId);
  const r = new Rng(seed);
  const bg1 = hex(pal.bg1), bg2 = hex(pal.bg2), accent = hex(pal.accent), glow = hex(pal.glow);
  const R: Ramps = buildRamps(accent, glow, new Rng(seed ^ 0x9e3779b9));
  // medallion background (transparent outside)
  const full = background({ bg1, bg2, accent, glow }, new Rng(seed), { moon: 'never', ground: false, fog: false });
  const bg = new Int32Array(N).fill(-1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dd = Math.hypot(x + 0.5 - 64, y + 0.5 - 64);
    if (dd <= 61) bg[y * W + x] = full[y * W + x] as number;
  }
  const d = new Draw();
  d.on('back');
  const rim = [mix(accent, 0x0c0618, 0.7), mix(accent, 0x0c0618, 0.4), mix(accent, 0xf0c850, 0.45), mix(accent, 0xfff0d0, 0.7)];
  d.ring(64, 64, 63, 63, 6, rim, 'tube');
  d.ring(64, 64, 57, 57, 1, rim[0] as number, 'flat');
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    d.ell(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60, 1.5, 1.5, rim[3] as number);
  }
  d.on('main');
  // keep wide subjects (the spider's web) inside the medallion
  d.clipped((x, y) => Math.hypot(x + 0.5 - 64, y + 0.5 - 64) <= 56, () =>
    d.scaled(0.86, 64, 64, () => (EMBLEMS[patronId] ?? genericSigil)({ d, r, R })));
  return compose(bg, d, { glow: R.GLOW, vignette: false });
}

export function renderCardBack(): Uint8ClampedArray {
  const R = buildRamps(0x7a3aa0, 0xb070ff, new Rng(7));
  const bg = new Int32Array(N);
  const c1 = 0x1a0d24, c2 = 0x06030a, lat = 0x2a1838;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = Math.hypot(x - 64, y - 64) / 90;
    const v = t * 5;
    const i = Math.floor(v), f = v - i;
    let c = mix(c1, c2, Math.min(1, (f > bayer(x, y) ? i + 1 : i) / 5));
    if ((x + y) % 16 === 0 || (x - y + 128) % 16 === 0) c = mix(c, lat, 0.7);
    bg[y * W + x] = c;
  }
  const d = new Draw();
  const G = R.gold;
  d.on('back');
  // borders
  for (const [ins, col] of [[3, G[2]], [8, G[1]]] as const) {
    d.rect(ins, ins, 128 - ins * 2, 2, col as number);
    d.rect(ins, 126 - ins, 128 - ins * 2, 2, col as number);
    d.rect(ins, ins, 2, 128 - ins * 2, col as number);
    d.rect(126 - ins, ins, 2, 128 - ins * 2, col as number);
  }
  for (const [x, y] of [[9, 9], [119, 9], [9, 119], [119, 119]]) {
    d.poly([x as number, (y as number) - 7, (x as number) + 7, y as number, x as number, (y as number) + 7, (x as number) - 7, y as number], G, 'diag');
    d.ell(x as number, y as number, 2, 2, R.acc);
  }
  for (const [x, y] of [[64, 6], [64, 122], [6, 64], [122, 64]]) d.poly([x as number, (y as number) - 4, (x as number) + 4, y as number, x as number, (y as number) + 4, (x as number) - 4, y as number], G, 'diag');
  d.on('main');
  // central diamond with eye and crescent
  d.poly([64, 18, 104, 64, 64, 110, 24, 64], G, 'diag');
  d.poly([64, 25, 97, 64, 64, 103, 31, 64], [0x120818, 0x1e1028, 0x2c1a3a, 0x3c2650], d.sph(56, 56, 40, 46));
  d.scaled(0.42, 64, 70, () => DRAWERS.eye({ d, r: new Rng(3), R }));
  d.clipped((x, y) => Math.hypot(x - 70, y - 38) > 9, () => d.ell(64, 41, 10, 10, R.bone));
  d.on('fx');
  d.spark(64, 92, R.GLOW, true);
  d.on('main');
  return compose(bg, d, { glow: R.GLOW, glowStrength: 0.8 });
}
