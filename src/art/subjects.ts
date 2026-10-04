/** One drawer per subject. All draw in logical 128x128 space, centred, large. */
import { mix } from './color';
import { arcPts, bayer, Draw, ERASE, smooth, sphereL, xf } from './pixel';
import type { Ramps } from './ramps';
import type { Rng } from './rng';

export const SUBJECTS = [
  'skull', 'crow', 'dagger', 'sword', 'axe', 'coin', 'coins', 'chest', 'scroll', 'book',
  'eye', 'hooded', 'knight', 'shield', 'tower', 'castle', 'flame', 'candle', 'chalice', 'potion',
  'moon', 'ship', 'serpent', 'wolf', 'cat', 'spider', 'ghost', 'hand', 'key', 'crown',
  'banner', 'altar', 'gem', 'bones', 'mask', 'rune', 'eagle', 'bow', 'hammer', 'lantern',
  'rat', 'tentacle', 'portal', 'chain', 'heart', 'feather', 'mage', 'assassin', 'priest', 'merchant',
  'beast', 'scales', 'cauldron', 'throne', 'gate', 'grave',
] as const;
export type SubjectName = (typeof SUBJECTS)[number];

export type Ctx = { d: Draw; r: Rng; R: Ramps };
export type Drawer = (c: Ctx) => void;

// ---------- shared helpers ----------

/** Teardrop flame outline: round bottom at (cx, by), tip h above, leaning. */
export function flamePts(cx: number, by: number, r: number, h: number, lean = 0): number[] {
  const cy = by - r;
  const o = arcPts(cx, cy, r, r, 0, Math.PI, 10);
  const tx = cx + lean, ty = cy - h;
  const q = (x0: number, y0: number, qx: number, qy: number, x1: number, y1: number) => {
    const pts: number[] = [];
    for (let i = 1; i <= 8; i++) {
      const t = i / 8, u = 1 - t;
      pts.push(u * u * x0 + 2 * u * t * qx + t * t * x1, u * u * y0 + 2 * u * t * qy + t * t * y1);
    }
    return pts;
  };
  o.push(...q(cx - r, cy, cx - r * 0.9 + lean * 0.2, cy - h * 0.55, tx, ty));
  o.push(...q(tx, ty, cx + r * 0.95 + lean * 0.2, cy - h * 0.45, cx + r, cy));
  return o;
}

/** Layered flame on the fx layer (no outline). */
function fire(d: Draw, R: Ramps, cx: number, by: number, r: number, h: number, lean = 0): void {
  const prev = d.target;
  d.on('fx');
  d.poly(flamePts(cx, by, r, h, lean), R.fire[1] as number);
  d.poly(flamePts(cx, by - r * 0.05, r * 0.72, h * 0.72, lean * 0.7), R.fire[2] as number);
  d.poly(flamePts(cx, by - r * 0.12, r * 0.42, h * 0.42, lean * 0.4), R.fire[3] as number);
  d.target = prev;
}

function boneShape(d: Draw, R: Ramps, x0: number, y0: number, x1: number, y1: number, r: number): void {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const nx = -Math.sin(a) * r * 0.75, ny = Math.cos(a) * r * 0.75;
  const ex = Math.cos(a) * r * 0.5, ey = Math.sin(a) * r * 0.5;
  for (const [x, y, s] of [[x0, y0, -1], [x1, y1, 1]] as const) {
    d.ell(x + nx + ex * s, y + ny + ey * s, r * 1.05, r * 1.05, R.bone);
    d.ell(x - nx + ex * s, y - ny + ey * s, r * 1.05, r * 1.05, R.bone);
  }
  d.cap(x0, y0, x1, y1, r * 0.75, R.bone);
}

/** Small runic glyphs as line segments on a 0..4 x 0..6 grid. */
const GLYPHS: number[][] = [
  [2, 0, 2, 6, 2, 2, 0, 0, 2, 2, 4, 0], // algiz
  [0, 0, 0, 6, 0, 1, 3, 3, 0, 5], // thurisaz
  [0, 0, 0, 6, 0, 0, 4, 2, 0, 3], // wunjo-ish
  [0, 0, 4, 6, 4, 0, 0, 6], // gebo
  [2, 0, 2, 6, 0, 2, 4, 4], // nauthiz
  [0, 6, 2, 0, 4, 6, 1, 3, 3, 3], // a-sigil
  [0, 0, 4, 3, 0, 6, 0, 0], // kaun/dagaz-ish
  [2, 0, 0, 3, 2, 6, 4, 3, 2, 0], // ingwaz diamond
];
function glyph(d: Draw, g: number[], x: number, y: number, sc: number, c: number, thick = 1): void {
  for (let i = 0; i + 3 < g.length; i += 2) {
    // treat pairs as a connected polyline except gebo/nauthiz which are segments
    const x0 = x + (g[i] as number) * sc, y0 = y + (g[i + 1] as number) * sc;
    const x1 = x + (g[i + 2] as number) * sc, y1 = y + (g[i + 3] as number) * sc;
    if (thick > 1) d.cap(x0, y0, x1, y1, thick / 2, c);
    else d.line(x0, y0, x1, y1, c);
  }
}

/** Generic sigil: circle + inscribed triangle + centre dot. */
export function sigil(d: Draw, cx: number, cy: number, r: number, c: number): void {
  d.ring(cx, cy, r, r, Math.max(1, r * 0.14), c, 'flat');
  const p = arcPts(cx, cy, r * 0.85, r * 0.85, -Math.PI / 2, Math.PI * 1.5, 3);
  d.lines(p, c);
  d.ell(cx, cy, r * 0.18, r * 0.18, c);
}

function stars(d: Draw, r: Rng, n: number, c: number, area: [number, number, number, number]): void {
  for (let i = 0; i < n; i++) d.spark(r.int(area[0], area[2]), r.int(area[1], area[3]), c, r.chance(0.3));
}

/** Blade along local -y from base y=0 to tip y=-len, bevel-shaded (light left, mid right). */
function blade(d: Draw, t: ReturnType<typeof xf>, len: number, w: number, R: Ramps, tipLen = 0.2): void {
  const tl = len * (1 - tipLen);
  d.poly(t.pts([0, -len, -w, -tl, -w, 0, 0, 0]), R.steel, 3);
  d.poly(t.pts([0, -len, w, -tl, w, 0, 0, 0]), R.steel, 2);
  d.poly(t.pts([0, -len + 4, 0.6, -len + 6, 0.6, -2, -0.6, -2, -0.6, -len + 6]), R.steel, 1);
}

// ---------- drawers ----------

const skull: Drawer = ({ d, r, R }) => {
  const L = d.sph(60, 52, 40, 46);
  d.ell(64, 48, 34, 31, R.bone, L);
  d.poly([38, 54, 90, 54, 86, 80, 80, 88, 48, 88, 42, 80], R.bone, L);
  d.ell(44, 70, 8, 7, R.bone, L);
  d.ell(84, 70, 8, 7, R.bone, L);
  // jaw
  d.poly([46, 88, 82, 88, 80, 102, 72, 108, 56, 108, 48, 102], R.bone, L);
  // temples
  d.poly([34, 56, 40, 52, 42, 72, 38, 70], R.bone, 1);
  d.poly([94, 56, 88, 52, 86, 72, 90, 70], R.bone, 0);
  // sockets
  d.ell(51, 64, 10, 9, R.VOID, 'flat', 0.25);
  d.ell(77, 64, 10, 9, R.VOID, 'flat', -0.25);
  d.poly([64, 72, 59, 83, 64, 85, 69, 83], R.VOID);
  // teeth
  d.rect(51, 87, 26, 7, R.bone[3] as number);
  d.rect(53, 95, 22, 6, R.bone[2] as number);
  d.line(50, 94, 78, 94, R.VOID);
  for (let x = 54; x < 77; x += 5) { d.line(x, 87, x, 93, R.bone[1] as number); d.line(x + 2, 95, x + 2, 100, R.bone[0] as number); }
  // brow shadow
  d.line(42, 54, 60, 57, R.bone[1] as number);
  d.line(68, 57, 86, 54, R.bone[1] as number);
  // crack
  let x = 64 + r.int(-14, 14), y = 18;
  for (let i = 0; i < 9; i++) {
    const nx = x + r.int(-3, 3), ny = y + r.int(2, 4);
    d.line(x, y, nx, ny, R.bone[0] as number);
    x = nx; y = ny;
  }
  d.on('fx');
  d.ell(52, 65, 3, 3, R.glow);
  d.ell(76, 65, 3, 3, R.glow);
  d.px(51, 64, R.WHITE); d.px(75, 64, R.WHITE);
  d.on('main');
};

const crow: Drawer = ({ d, r, R }) => {
  const C = R.dark;
  d.cap(10, 104, 118, 96, 4, R.wood);
  d.cap(92, 98, 108, 86, 2, R.wood, 'tube', 1);
  // tail
  d.poly([74, 74, 104, 104, 98, 110, 88, 108, 66, 86], C, 1);
  d.lines([78, 82, 98, 106], C[0] as number);
  // body
  d.ell(66, 70, 27, 18, C, 'sphere', 0.5);
  const tilt = r.range(-4, 4);
  d.ell(44, 46 + tilt, 14, 13, C);
  d.ell(54, 58, 12, 12, C);
  // beak
  d.poly([34, 42 + tilt, 12, 50 + tilt, 32, 54 + tilt], [0x1a1820, 0x3a3640, 0x6c6674, 0x9a94a2], 'diag');
  d.line(14, 50 + tilt, 32, 49 + tilt, 0x0b0910);
  // wing
  d.poly([50, 60, 86, 62, 102, 92, 84, 90, 62, 82], C, 'diag');
  for (let i = 0; i < 4; i++) d.line(66 + i * 7, 72 + i * 2, 84 + i * 5, 90, C[0] as number);
  d.lines([52, 62, 84, 64], C[3] as number);
  // legs
  d.line(60, 86, 58, 99, R.bone[1] as number);
  d.line(70, 86, 70, 98, R.bone[1] as number);
  d.line(55, 100, 62, 99, R.bone[1] as number);
  d.line(67, 99, 74, 98, R.bone[1] as number);
  d.on('fx');
  d.ell(41, 44 + tilt, 2.5, 2.5, R.glow);
  d.px(40, 43 + tilt, R.WHITE);
  d.on('main');
};

const dagger: Drawer = ({ d, r, R }) => {
  const t = xf(64, 70, Math.PI / 4 + r.range(-0.1, 0.1));
  blade(d, t, 54, 9, R, 0.3);
  d.poly(t.pts([-24, 2, 24, 2, 28, -4, 26, 8, -26, 8, -28, -4]), R.gold, 'cyly');
  d.cap(...t.pt(0, 10), ...t.pt(0, 34), 4.5, R.cloth);
  for (let k = 12; k < 34; k += 4) d.line(...t.pt(-4, k), ...t.pt(4, k + 2), R.cloth[0] as number);
  const [px, py] = t.pt(0, 41);
  d.ell(px, py, 7, 7, R.gold);
  d.ell(px, py, 3.5, 3.5, R.acc);
  d.on('fx');
  const [sx, sy] = t.pt(-4, -38);
  d.spark(sx, sy, R.WHITE, true);
  d.on('main');
};

const sword: Drawer = ({ d, r, R }) => {
  const tt = xf(64, 86, r.range(-0.16, 0.16));
  blade(d, tt, 76, 7, R, 0.12);
  d.poly(tt.pts([-6, 0, 6, 0, 0, -10]), R.gold, 'diag');
  d.poly(tt.pts([-30, -2, -22, 0, 22, 0, 30, -2, 32, -8, 28, 6, -28, 6, -32, -8]), R.gold, 'cyly');
  d.ell(...tt.pt(0, 3), 4.5, 4.5, R.acc);
  d.cap(...tt.pt(0, 8), ...tt.pt(0, 26), 3.5, R.wood);
  for (let k = 10; k < 26; k += 3) d.line(...tt.pt(-3, k), ...tt.pt(3, k + 1), R.wood[0] as number);
  d.ell(...tt.pt(0, 31), 6, 6, R.gold);
  d.ell(...tt.pt(0, 31), 2, 2, R.acc);
  d.on('fx');
  const g = r.pick(GLYPHS);
  for (let k = 0; k < 3; k++) {
    const [gx, gy] = tt.pt(-1.5, -22 - k * 14);
    glyph(d, g, gx, gy, 0.8, R.GLOW);
  }
  const [sx, sy] = tt.pt(-4, -60);
  d.spark(sx, sy, R.WHITE, true);
  d.on('main');
};

const axe: Drawer = ({ d, r, R }) => {
  const t = xf(64, 64, r.range(-0.25, -0.1));
  d.cap(...t.pt(4, -48), ...t.pt(4, 48), 4, R.wood);
  d.cap(...t.pt(4, 30), ...t.pt(4, 44), 4.6, R.cloth);
  // blade (bearded)
  const bl = t.pts([2, -40, -14, -42, -30, -54, -38, -40, -42, -22, -40, -6, -32, 10, -20, -2, -6, -16, 2, -18]);
  d.poly(bl, R.steel, 'diag');
  // edge highlight
  const e = t.pts([-30, -52, -37, -40, -41, -22, -39, -6, -32, 8]);
  d.lines(e, R.steel[4] as number);
  // back spike
  d.poly(t.pts([8, -38, 34, -30, 8, -22]), R.steel, 'cyly');
  d.poly(t.pts([0, -44, 8, -44, 9, -14, 0, -14]), R.iron, 'cylx');
  d.ell(...t.pt(4, -29), 2, 2, R.gold);
  d.ell(...t.pt(4, 52), 5, 5, R.gold);
};

const coin: Drawer = ({ d, r, R }) => {
  d.ell(68, 64, 36, 40, R.gold, 1);
  d.ell(64, 64, 35, 40, R.gold, 'diag');
  d.ring(64, 64, 29, 34, 2, R.gold, 1);
  d.ring(64, 64, 28, 33, 1, R.gold[4] as number);
  const kind = r.int(0, 2);
  const emb = (ox: number, oy: number, c: number) => {
    if (kind === 0) {
      d.ell(64 + ox, 58 + oy, 12, 11, c);
      d.rect(57 + ox, 64 + oy, 14, 10, c);
    } else if (kind === 1) {
      d.poly([46 + ox, 74 + oy, 46 + ox, 52 + oy, 55 + ox, 62 + oy, 64 + ox, 46 + oy, 73 + ox, 62 + oy, 82 + ox, 52 + oy, 82 + ox, 74 + oy], c);
    } else {
      const st: number[] = [];
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? 7 : 17;
        st.push(64 + ox + Math.cos(a) * rr, 64 + oy + Math.sin(a) * rr);
      }
      d.poly(st, c);
    }
  };
  emb(1, 1, R.gold[4] as number);
  emb(0, 0, R.gold[1] as number);
  if (kind === 0) {
    d.ell(59, 58, 3, 3, R.gold[0] as number);
    d.ell(69, 58, 3, 3, R.gold[0] as number);
  }
  for (let a = 0; a < 24; a++) {
    const p = arcPts(64, 64, 33, 38, (a / 24) * Math.PI * 2, 0, 0);
    d.px(p[0] as number, p[1] as number, R.gold[1] as number);
  }
  d.on('fx');
  d.spark(44, 36, R.WHITE, true);
  d.on('main');
};

function flatCoin(d: Draw, R: Ramps, x: number, y: number, rx = 12): void {
  d.ell(x, y + 2, rx, rx * 0.42, R.gold, 1);
  d.ell(x, y, rx, rx * 0.42, R.gold, 'diag');
  d.ring(x, y, rx * 0.7, rx * 0.3, 1, R.gold[1] as number);
}

const coins: Drawer = ({ d, r, R }) => {
  const rows = [[104, 30, 98, 13], [96, 36, 92, 13], [88, 42, 86, 13], [80, 50, 78, 14], [72, 58, 70, 14]];
  for (const [y, x0, x1, st] of rows) {
    for (let x = x0 as number; x <= (x1 as number); x += st as number) flatCoin(d, R, x + r.int(-2, 2), (y as number) + r.int(-1, 1));
  }
  // stack
  const sx = r.chance(0.5) ? 94 : 34;
  for (let i = 0; i < 6; i++) flatCoin(d, R, sx, 100 - i * 6, 11);
  // upright coins
  d.ell(60, 54, 12, 14, R.gold, 'diag');
  d.ring(60, 54, 9, 11, 1, R.gold[1] as number);
  d.ell(75, 58, 5, 13, R.gold, 'cylx');
  // gems
  d.ell(44, 84, 4, 4, R.acc);
  d.ell(84, 76, 3, 3, R.glow);
  d.on('fx');
  stars(d, r, 4, R.WHITE, [30, 50, 98, 100]);
  d.on('main');
};

const chest: Drawer = ({ d, r, R }) => {
  // body
  d.rect(22, 62, 84, 44, R.wood, 'cylx');
  for (let y = 72; y < 106; y += 10) d.line(23, y, 105, y, R.wood[0] as number);
  // lid
  d.clipped((_x, y) => y < 62, () => d.ell(64, 63, 42, 26, R.wood, 'cyly'));
  d.line(28, 50, 100, 50, R.wood[0] as number);
  // straps
  for (const x of [32, 90]) {
    d.clipped((x2, y) => y < 62 && ((x2 - 64) / 42) ** 2 + ((y - 63) / 26) ** 2 <= 1, () => d.rect(x, 30, 7, 34, R.gold, 'cylx'));
    d.rect(x, 62, 7, 44, R.gold, 'cylx');
    d.ell(x + 3.5, 80, 1.5, 1.5, R.gold[4] as number);
    d.ell(x + 3.5, 96, 1.5, 1.5, R.gold[4] as number);
  }
  d.rect(22, 59, 84, 6, R.gold, 'cyly');
  // lock
  d.rect(56, 58, 16, 18, R.gold, 'diag');
  d.ell(64, 65, 2.5, 2.5, R.VOID);
  d.rect(63, 66, 3, 5, R.VOID);
  // feet
  d.rect(22, 104, 10, 6, R.iron);
  d.rect(96, 104, 10, 6, R.iron);
  d.on('fx');
  if (r.chance(0.7)) {
    for (let x = 24; x < 104; x++) if ((x & 1) === 0 || x > 50) d.px(x, 61, R.GLOW);
  }
  stars(d, r, 2, R.WHITE, [30, 30, 98, 60]);
  d.on('main');
  flatCoin(d, R, 38, 112, 8);
  flatCoin(d, R, 92, 113, 7);
};

const scroll: Drawer = ({ d, r, R }) => {
  d.rect(36, 28, 56, 74, R.parch, 'cylx');
  // ragged side edges
  for (let y = 30; y < 100; y += 3) { d.px(36, y + r.int(0, 2), ERASE); d.px(91, y + r.int(0, 2), ERASE); }
  d.cap(30, 26, 98, 26, 7, R.parch);
  d.ell(28, 26, 5, 8, R.wood); d.ell(100, 26, 5, 8, R.wood);
  d.cap(30, 104, 98, 104, 7, R.parch);
  d.ell(28, 104, 5, 8, R.wood); d.ell(100, 104, 5, 8, R.wood);
  d.line(31, 31, 97, 31, R.parch[1] as number);
  for (let y = 40; y < 88; y += 6) {
    let x = 44 + (y === 40 ? 6 : 0);
    const end = y === 82 ? 64 : r.int(70, 84);
    while (x < end) {
      const w = r.int(2, 6);
      d.line(x, y, Math.min(end, x + w), y, R.parch[0] as number);
      if (r.chance(0.4)) d.px(x + 1, y - 1, R.parch[0] as number);
      x += w + 2;
    }
  }
  // seal
  d.poly([70, 92, 66, 112, 72, 108, 76, 114, 78, 94], R.acc, 2);
  d.ell(76, 90, 8, 8, R.blood);
  d.ell(76, 90, 4, 4, R.blood[1] as number);
};

const book: Drawer = ({ d, r, R }) => {
  d.rect(94, 26, 7, 80, R.parch, 'cylx');
  for (let y = 30; y < 104; y += 3) d.line(95, y, 100, y, R.parch[1] as number);
  d.rect(32, 106, 66, 5, R.parch, 'cyly');
  d.rect(30, 20, 66, 88, R.cloth, 'diag');
  d.rect(24, 20, 10, 88, R.cloth, 'cylx');
  for (const y of [30, 50, 78, 98]) d.rect(24, y, 10, 3, R.gold, 'cylx');
  // border
  d.ring(63, 64, 28, 38, 1, R.gold[2] as number, 'flat');
  // corners
  for (const [cx, cy, sx, sy] of [[96, 20, -1, 1], [96, 108, -1, -1]] as const) d.poly([cx, cy, cx + sx * 14, cy, cx, cy + sy * 14], R.gold, 'diag');
  // emblem: eye or sigil
  if (r.chance(0.5)) {
    d.poly([42, 64, 52, 54, 64, 50, 76, 54, 86, 64, 76, 74, 64, 78, 52, 74], R.gold, 'diag');
    d.ell(64, 64, 9, 9, R.VOID);
    d.on('fx');
    d.ell(64, 64, 6, 6, R.glow);
    d.ell(64, 64, 2, 4, R.VOID);
    d.on('main');
  } else {
    d.on('fx');
    sigil(d, 64, 64, 18, R.GLOW);
    d.on('main');
  }
  // clasp
  d.rect(90, 58, 10, 12, R.gold, 'cyly');
};

const eye: Drawer = ({ d, r, R }) => {
  const top = (x: number) => 64 - 34 * Math.sin(Math.PI * Math.max(0, Math.min(1, (x - 14) / 100)));
  const bot = (x: number) => 64 + 28 * Math.sin(Math.PI * Math.max(0, Math.min(1, (x - 14) / 100)));
  const outer: number[] = [], inner: number[] = [];
  for (let x = 6; x <= 122; x += 4) outer.push(x, 64 - 44 * Math.sin((Math.PI * (x - 6)) / 116));
  for (let x = 122; x >= 6; x -= 4) outer.push(x, 64 + 36 * Math.sin((Math.PI * (x - 6)) / 116));
  for (let x = 14; x <= 114; x += 4) inner.push(x, top(x));
  for (let x = 114; x >= 14; x -= 4) inner.push(x, bot(x));
  d.poly(outer, R.ghoul, d.sph(64, 60, 60, 44));
  d.poly(inner, [0x6e6258, 0xb4a894, 0xe0d6c4, 0xfaf4e8], d.sph(60, 56, 50, 34));
  const inEye = (x: number, y: number) => x > 14 && x < 114 && y > top(x) && y < bot(x);
  d.clipped(inEye, () => {
    for (let i = 0; i < 6; i++) {
      let x = r.chance(0.5) ? 18 : 110, y = 64 + r.int(-8, 8);
      const dir = x < 64 ? 1 : -1;
      for (let k = 0; k < 6; k++) {
        const nx = x + dir * r.int(2, 4), ny = y + r.int(-2, 2);
        d.line(x, y, nx, ny, R.blood[2] as number);
        x = nx; y = ny;
      }
    }
    const ix = 64 + r.int(-6, 6);
    d.ell(ix, 62, 22, 22, R.acc5);
    d.ring(ix, 62, 22, 22, 2, R.acc5[0] as number, 'flat');
    for (let a = 0; a < 16; a++) {
      const p = arcPts(ix, 62, 18, 18, (a / 16) * Math.PI * 2, 0, 0);
      d.line(ix, 62, p[0] as number, p[1] as number, R.acc5[a % 2 ? 1 : 3] as number);
    }
    d.ell(ix, 62, 4, 15, R.VOID);
    d.ell(ix, 62, 2, 11, 0x000000);
  });
  // lid crease lines
  d.lines(smooth([14, 60, 40, 36, 64, 28, 88, 36, 114, 60], 4), R.ghoul[0] as number);
  // lashes
  for (let k = 0; k < 9; k++) {
    const x = 26 + k * 10;
    const y = top(x);
    d.line(x, y, x + (x - 64) * 0.18, y - 8, 0x0b0910);
  }
  d.on('fx');
  d.ell(54, 52, 4, 3, R.WHITE);
  d.px(73, 70, R.WHITE);
  d.on('main');
};

const hooded: Drawer = ({ d, r, R }) => {
  const C = R.dcloth;
  d.poly([64, 34, 100, 74, 112, 118, 16, 118, 28, 74], C, d.sph(56, 60, 70, 70));
  // sleeves
  d.poly([30, 74, 50, 70, 60, 96, 40, 100], C, 1);
  d.poly([98, 74, 78, 70, 68, 96, 88, 100], C, 2);
  for (const x of [44, 56, 72, 84]) d.line(x, 100, x + (x - 64) * 0.2, 118, C[0] as number);
  // hood
  d.poly([64, 10, 90, 40, 92, 66, 64, 76, 36, 66, 38, 40], C, d.sph(58, 44, 34, 40));
  d.ell(64, 52, 15, 18, C[0] as number);
  d.ell(64, 54, 12, 15, R.VOID);
  d.lines([50, 40, 64, 34, 78, 40], C[3] as number);
  // hands / held item
  if (r.chance(0.5)) {
    d.ell(64, 94, 9, 6, R.ghoul);
    d.on('fx');
    d.ell(64, 86, 5, 5, R.glow);
    d.px(63, 85, R.WHITE);
    d.on('main');
  } else {
    d.ell(58, 96, 6, 5, R.ghoul);
    d.ell(70, 96, 6, 5, R.ghoul);
  }
  d.on('fx');
  const ey = 54 + r.int(-1, 1);
  for (const x of [58, 69]) { d.px(x, ey, R.EYE); d.px(x + 1, ey, R.EYE); d.px(x, ey + 1, R.GLOW); d.px(x + 1, ey + 1, R.GLOW); }
  d.on('main');
};

const knight: Drawer = ({ d, r, R }) => {
  const S = R.steel;
  d.rect(30, 92, 68, 36, S, 'cylx');
  d.rect(46, 96, 36, 32, R.acc, 'cylx');
  d.poly([64, 102, 70, 110, 64, 120, 58, 110], R.gold, 'diag');
  d.ell(32, 94, 20, 14, S, 'sphere');
  d.ell(96, 94, 20, 14, S, 'sphere');
  d.line(16, 96, 46, 92, S[1] as number); d.line(82, 92, 112, 96, S[1] as number);
  d.rect(46, 80, 36, 14, S, 'cylx');
  // helm
  d.rect(40, 34, 48, 52, S, 'cylx');
  d.clipped((_x, y) => y < 36, () => d.ell(64, 36, 24, 18, S, d.cylx(40, 88)));
  d.rect(62, 22, 4, 62, S[3] as number);
  d.rect(42, 54, 44, 5, R.VOID);
  d.rect(61, 59, 6, 14, R.VOID);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { d.px(50 + j * 4, 66 + i * 4, R.VOID); d.px(76 + j * 4, 66 + i * 4, R.VOID); }
  d.line(40, 84, 88, 84, S[0] as number);
  // crest
  if (r.chance(0.5)) {
    d.poly([62, 22, 66, 22, 80, 6, 96, 4, 90, 12, 98, 14, 84, 22, 70, 30], R.acc, 'diag');
  } else {
    d.path(smooth([42, 40, 30, 30, 26, 14, 30, 4], 3), 5, 1, R.bone);
    d.path(smooth([86, 40, 98, 30, 102, 14, 98, 4], 3), 5, 1, R.bone);
  }
  d.on('fx');
  for (let x = 46; x < 82; x++) if (x < 58 || x > 70) d.px(x, 56, (x & 1) ? R.GLOW : R.EYE);
  d.on('main');
};

const shield: Drawer = ({ d, r, R }) => {
  const outer = [22, 18, 106, 18, 106, 56, 98, 84, 64, 114, 30, 84, 22, 56];
  const inner = [30, 25, 98, 25, 98, 56, 91, 80, 64, 105, 37, 80, 30, 56];
  d.poly(outer, R.steel, 'diag');
  d.poly(inner, R.acc, d.sph(52, 40, 60, 80));
  const charge = r.int(0, 2);
  d.clipped((x, y) => {
    // inside inner polygon approx
    return y > 25 && x > 30 && x < 98 && y < 105;
  }, () => {
    if (charge === 0) {
      d.poly([30, 74, 64, 44, 98, 74, 98, 86, 64, 56, 30, 86], R.gold, 'diag');
    } else if (charge === 1) {
      d.rect(58, 25, 12, 80, R.gold, 'cylx');
      d.rect(30, 46, 68, 12, R.gold, 'cyly');
    } else {
      d.scaled(0.42, 64, 62, () => skull({ d, r, R }));
    }
  });
  for (const [x, y] of [[26, 22], [102, 22], [26, 54], [102, 54], [64, 108]]) d.ell(x as number, y as number, 2, 2, R.gold);
  d.lines([24, 20, 104, 20], R.steel[4] as number);
  for (let i = 0; i < 3; i++) {
    const x = r.int(40, 84), y = r.int(32, 80);
    d.line(x, y, x + r.int(3, 7), y + r.int(-3, 3), R.acc[0] as number);
  }
};

function bricks(d: Draw, x0: number, y0: number, x1: number, y1: number, c: number): void {
  for (let y = y0; y < y1; y += 6) {
    d.line(x0, y, x1, y, c);
    const off = ((y - y0) / 6) % 2 ? 4 : 0;
    for (let x = x0 + off; x < x1; x += 8) d.line(x, y, x, y + 5, c);
  }
}

const tower: Drawer = ({ d, r, R }) => {
  const S = R.stone;
  d.rect(44, 42, 40, 76, S, 'cylx');
  d.rect(38, 34, 52, 10, S, 'cylx');
  bricks(d, 44, 48, 84, 116, S[1] as number);
  for (let x = 38; x < 90; x += 8) d.rect(x + 4, 34, 4, 4, ERASE);
  d.poly([36, 36, 92, 36, 64, 2], R.cloth, d.cylx(36, 92));
  d.lines([64, 2, 64, -6], R.wood[1] as number);
  d.poly([64, -2, 74, 1, 64, 4], R.acc, 2);
  // windows
  for (const [x, y] of [[61, 50], [52, 72], [70, 86]]) {
    d.rect(x as number, y as number, 7, 10, R.VOID);
    d.ell((x as number) + 3.5, y as number, 3.5, 3, R.VOID);
  }
  // door
  d.rect(56, 102, 16, 16, R.wood, 'cylx');
  d.clipped((_x, y) => y < 103, () => d.ell(64, 103, 8, 8, R.wood, 'cylx'));
  d.line(64, 96, 64, 118, R.wood[0] as number);
  d.on('fx');
  for (const [x, y] of [[61, 50], [52, 72], [70, 86]]) {
    d.rect((x as number) + 1, (y as number) + 1, 5, 8, R.glow, 'vgrad');
    d.ell((x as number) + 3.5, (y as number) + 1, 2.5, 2, R.GLOW);
  }
  // bats
  for (let i = 0; i < r.int(1, 3); i++) {
    const bx = r.int(16, 110), by = r.int(10, 30);
    if (bx > 30 && bx < 98) continue;
    d.lines([bx - 3, by - 1, bx - 1, by, bx, by - 1, bx + 1, by, bx + 3, by - 1], 0x0b0910);
  }
  d.on('main');
};

const castle: Drawer = ({ d, r, R }) => {
  const S = R.stone;
  // back keep
  d.rect(46, 34, 36, 50, S, 'cylx');
  d.poly([42, 36, 86, 36, 64, 8], R.cloth, d.cylx(42, 86));
  // side towers
  for (const x of [16, 88]) {
    d.rect(x, 42, 24, 76, S, 'cylx');
    d.rect(x - 3, 38, 30, 8, S, 'cylx');
    for (let k = 0; k < 4; k++) d.rect(x - 3 + 3 + k * 7, 38, 3, 3, ERASE);
    d.poly([x - 4, 40, x + 28, 40, x + 12, 14], R.cloth, d.cylx(x - 4, x + 28));
    d.line(x + 12, 14, x + 12, 6, R.wood[1] as number);
    d.poly([x + 12, 6, x + 20, 8, x + 12, 10], R.acc, 2);
  }
  // wall
  d.rect(38, 66, 52, 52, S, 'diag');
  for (let k = 0; k < 7; k++) d.rect(38 + k * 8, 62, 5, 5, S, 'flat');
  bricks(d, 38, 72, 90, 118, S[1] as number);
  bricks(d, 16, 50, 40, 118, S[1] as number);
  bricks(d, 88, 50, 112, 118, S[1] as number);
  // gate
  d.rect(54, 94, 20, 24, R.VOID);
  d.ell(64, 94, 10, 10, R.VOID);
  for (let x = 56; x < 74; x += 4) d.line(x, 88, x, 117, R.steel[1] as number);
  for (let y = 92; y < 118; y += 5) d.line(54, y, 73, y, R.steel[1] as number);
  d.on('fx');
  const wins = [[27, 60], [27, 84], [99, 60], [99, 84], [62, 44], [62, 72]];
  for (const [x, y] of wins) if (r.chance(0.8)) d.rect(x as number, y as number, 3, 6, R.glow, 'vgrad');
  d.on('main');
};

/** Organic fire: per-pixel field with peaked tongues, banded into the fire ramp (fx layer). */
function fireField(d: Draw, R: Ramps, r: Rng, cx: number, by: number, hw: number, h: number): void {
  const ph = r.range(0, 6.28), ph2 = r.range(0, 6.28), fq = r.range(3.6, 5);
  const prev = d.target;
  d.on('fx');
  for (let y = Math.floor(by - h * 1.1); y <= by; y++) {
    for (let x = Math.floor(cx - hw * 1.3); x <= cx + hw * 1.3; x++) {
      const v0 = (by - y) / h;
      let u = (x - cx) / hw;
      u += Math.sin(y * 0.16 + ph2) * 0.1 * v0;
      if (Math.abs(u) >= 1) continue;
      const peak = 1 - Math.abs(Math.sin(u * fq + ph));
      const env = Math.pow(1 - u * u, 0.6) * (0.5 + 0.5 * peak) * (1 - 0.15 * Math.abs(Math.sin(u * fq * 2.3 + ph2)));
      const v = v0 / Math.max(0.05, env);
      if (v > 1) continue;
      const inten = (1 - v) * 0.75 + (1 - Math.abs(u)) * 0.45 - 0.15 + (Math.floor(x) % 2 === 0 ? 0 : 0);
      const sx = Math.floor(d.X(x)), sy = Math.floor(d.Y(y));
      const k = inten + (bayer(sx, sy) - 0.5) * 0.14;
      const c = k > 0.78 ? R.fire[3] : k > 0.52 ? R.fire[2] : k > 0.28 ? R.fire[1] : R.fire[0];
      d.px(x, y, c as number);
    }
  }
  d.target = prev;
}

const flame: Drawer = ({ d, r, R }) => {
  d.cap(30, 110, 98, 98, 6, R.wood);
  d.cap(30, 98, 98, 110, 6, R.wood);
  d.ell(30, 98, 4, 6, R.wood[3] as number);
  d.ell(98, 98, 4, 6, R.wood[3] as number);
  fireField(d, R, r, 64, 106, 40, 100);
  d.on('fx');
  for (let i = 0; i < 12; i++) d.px(r.int(24, 104), r.int(6, 40), r.chance(0.5) ? R.GLOW : R.EYE);
  d.on('main');
};

const candle: Drawer = ({ d, r, R }) => {
  d.ell(64, 108, 34, 8, R.gold, 'diag');
  d.ell(64, 105, 30, 6, R.gold, 3);
  d.ell(64, 105, 24, 4, R.gold, 1);
  d.path([94, 104, 104, 96, 106, 88], 2.5, 2, R.gold);
  const side = r.chance(0.6);
  d.rect(50, 42, 28, 62, R.bone, 'cylx');
  d.ell(64, 42, 14, 4, R.bone, 3);
  for (let i = 0; i < 4; i++) {
    const x = r.int(52, 76), len = r.int(6, 22);
    d.cap(x, 42, x, 42 + len, 2.2, R.bone);
  }
  d.line(64, 34, 64, 41, R.VOID);
  if (side) {
    d.rect(26, 72, 14, 32, R.bone, 'cylx');
    d.ell(33, 72, 7, 2, R.bone, 3);
    d.line(33, 66, 33, 71, R.VOID);
    fire(d, R, 33, 70, 4, 12, r.range(-2, 2));
  }
  fire(d, R, 64, 40, 7, 26, r.range(-3, 3));
};

const chalice: Drawer = ({ d, r, R }) => {
  const G = R.gold;
  d.ell(64, 106, 28, 8, G, 'diag');
  d.poly([42, 104, 86, 104, 72, 90, 56, 90], G, d.cylx(42, 86));
  d.cap(64, 90, 64, 68, 5, G);
  d.ell(64, 80, 10, 5, G);
  d.clipped((_x, y) => y >= 36, () => d.ell(64, 36, 36, 34, G, d.cylx(28, 100)));
  d.ell(64, 36, 36, 8, G, 2);
  d.ell(64, 36, 32, 6, R.blood, 1);
  d.ell(64, 37, 30, 4.5, R.acc, 'diag');
  for (const x of [42, 64, 86]) d.ell(x, 52 + (x === 64 ? 2 : 0), 4, 4, x === 64 ? R.glow : R.acc);
  d.line(30, 46, 98, 46, G[1] as number);
  // drip
  const dx = r.int(36, 50);
  d.cap(dx, 40, dx, 40 + r.int(8, 16), 2, R.acc);
  d.on('fx');
  for (let i = 0; i < 6; i++) d.px(r.int(40, 88), r.int(14, 30), R.GLOW);
  d.spark(86, 30, R.WHITE);
  d.on('main');
};

const potion: Drawer = ({ d, r, R }) => {
  const shape = r.int(0, 1);
  const cy = 78;
  if (shape === 0) d.ell(64, cy, 34, 34, R.glass);
  else d.poly([30, 112, 98, 112, 90, 60, 76, 46, 52, 46, 38, 60], R.glass, d.sph(56, 70, 50, 50));
  const level = 70 + r.int(-6, 8);
  d.clipped((_x, y) => y > level, () => {
    if (shape === 0) d.ell(64, cy, 31, 31, R.acc5);
    else d.poly([33, 110, 95, 110, 87, 61, 74, 49, 54, 49, 41, 61], R.acc5, d.sph(56, 74, 50, 50));
  });
  d.line(34, level + 1, 94, level + 1, R.acc5[4] as number);
  d.clipped((_x, y) => y > level - 1 && y < level + 2, () => { if (shape === 0) d.ring(64, cy, 34, 34, 3, R.glass, 'tube'); });
  d.rect(54, 24, 20, 26, R.glass, 'cylx');
  d.rect(50, 22, 28, 6, R.glass, 'cylx');
  d.rect(56, 8, 16, 16, R.wood, 'cylx');
  d.ell(64, 8, 8, 2, R.wood[3] as number);
  // label
  d.rect(48, 84, 32, 16, R.parch, 'flat');
  d.scaled(0.18, 64, 92, () => skull({ d, r, R }));
  d.on('fx');
  d.lines(arcPts(64, cy, 26, 26, Math.PI * 1.05, Math.PI * 1.4, 6), R.WHITE);
  d.rect(58, 28, 2, 16, mix(R.glass[3] as number, 0xffffff, 0.5));
  for (let i = 0; i < 5; i++) {
    const bx = r.int(44, 84), by = r.int(level + 4, 104);
    if (bx > 46 && bx < 82 && by > 82 && by < 102) continue;
    d.ring(bx, by, 2, 2, 1, R.acc5[4] as number, 'flat');
  }
  d.on('main');
};

const moon: Drawer = ({ d, r, R }) => {
  const M = [mix(R.GLOW, 0x302a40, 0.6), mix(R.GLOW, 0xc8c2b0, 0.55), mix(R.GLOW, 0xeee8d4, 0.75), 0xfffaf0];
  const crescent = r.chance(0.5);
  d.ell(64, 60, 42, 42, M);
  for (let i = 0; i < 9; i++) {
    const a = r.range(0, 6.28), rr = r.range(4, 34);
    const cx = 64 + Math.cos(a) * rr, cy = 60 + Math.sin(a) * rr;
    const s = r.range(2.5, 7);
    d.ell(cx, cy, s, s * 0.85, M[1] as number);
    d.ell(cx + 0.8, cy + 0.8, s * 0.75, s * 0.6, M[0] as number);
  }
  if (crescent) d.ell(86, 48, 38, 40, ERASE);
  // clouds
  const cloud = R.dark;
  const cy = 96 + r.int(-6, 6);
  for (let i = 0; i < 7; i++) d.ell(10 + i * 18 + r.int(-3, 3), cy + 4 + r.int(-2, 4), r.int(10, 15), r.int(5, 8), cloud, 'cyly');
  for (let i = 0; i < 4; i++) d.ell(26 + i * 26 + r.int(-4, 4), cy - 2 + r.int(-3, 2), r.int(9, 13), r.int(6, 9), cloud, 'cyly');
};

const ship: Drawer = ({ d, r, R }) => {
  const sails = [mix(R.bone[0] as number, R.GLOW, 0.2), mix(R.bone[1] as number, R.GLOW, 0.2), mix(R.bone[2] as number, R.GLOW, 0.15), R.bone[3] as number];
  d.cap(46, 14, 46, 84, 2, R.wood);
  d.cap(80, 24, 80, 84, 2, R.wood);
  const sail = (x0: number, y0: number, w: number, h: number) => {
    const pts = [x0, y0, x0 + w, y0 - 2];
    const steps = 6;
    for (let i = steps; i >= 0; i--) pts.push(x0 + (w * i) / steps + 2, y0 + h + (i % 2 ? -4 : 0) + r.int(-2, 2));
    d.poly(pts, sails, d.cylx(x0, x0 + w));
    for (let k = 0; k < 2; k++) d.ell(x0 + r.int(6, w - 6), y0 + r.int(8, h - 8), r.int(2, 3), r.int(2, 4), ERASE);
  };
  sail(28, 22, 36, 30);
  sail(30, 58, 34, 20);
  sail(66, 32, 30, 34);
  // hull
  d.poly([12, 72, 30, 78, 98, 80, 116, 70, 104, 100, 26, 100], R.wood, 'diag');
  for (let y = 84; y < 100; y += 5) d.line(20, y, 108, y, R.wood[0] as number);
  for (let x = 36; x < 100; x += 12) d.rect(x, 86, 4, 3, R.VOID);
  d.poly([106, 74, 124, 62, 122, 66, 110, 78], R.wood, 2);
  // waves
  const wy = (x: number) => 102 + Math.sin(x * 0.18 + r.range(0, 1)) * 2.5;
  const wv: number[] = [];
  for (let x = 0; x <= 128; x += 4) wv.push(x, wy(x));
  wv.push(128, 128, 0, 128);
  d.poly(wv, [0x0c1220, 0x1a2840, mix(0x2c4060, R.GLOW, 0.2), mix(0x6080a0, R.GLOW, 0.3)], 'vgrad');
  d.on('fx');
  for (let x = 2; x < 126; x += r.int(3, 8)) d.px(x, Math.round(wy(x)) - 1, mix(0xffffff, R.GLOW, 0.4));
  d.lines([46, 14, 12, 72], R.wood[1] as number);
  d.lines([46, 14, 80, 24, 116, 70], R.wood[1] as number);
  d.poly([46, 8, 58, 11, 46, 14], R.acc[2] as number);
  d.ell(18, 70, 3, 3, R.glow);
  d.ell(110, 66, 2, 2, R.glow);
  d.on('main');
};

const serpent: Drawer = ({ d, r, R }) => {
  const S = R.acc;
  const raw = [112, 110, 84, 114, 52, 112, 28, 102, 30, 86, 54, 80, 82, 76, 96, 62, 90, 46, 70, 40, 56, 34];
  const p = smooth(raw.map((v, i) => v + (i > 1 ? r.int(-2, 2) : 0)), 8);
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const rad = 3 + Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.85) * 8;
    d.ell(p[i * 2] as number, p[i * 2 + 1] as number, rad, rad, S);
  }
  // scale pattern / belly stripes
  for (let i = 4; i < n - 6; i += 5) {
    const x = p[i * 2] as number, y = p[i * 2 + 1] as number;
    d.ell(x - 1, y - 2, 2.5, 2, S[0] as number);
    d.px(x - 2, y - 3, S[3] as number);
  }
  // head
  const hx = 48, hy = 30;
  d.ell(hx, hy, 15, 11, S, 'sphere', -0.3);
  d.poly([hx - 8, hy - 6, hx - 26, hy + 2, hx - 22, hy + 8, hx - 6, hy + 8], S, d.sph(hx, hy, 20, 14));
  // open mouth with fangs
  d.poly([hx - 24, hy + 5, hx - 6, hy + 6, hx - 20, hy + 14], R.VOID);
  d.poly([hx - 18, hy + 6, hx - 16, hy + 12, hx - 14, hy + 6], R.bone[3] as number);
  d.lines([hx - 22, hy + 9, hx - 32, hy + 12, hx - 36, hy + 10], R.blood[3] as number);
  d.lines([hx - 32, hy + 12, hx - 36, hy + 15], R.blood[3] as number);
  d.on('fx');
  d.ell(hx - 4, hy - 4, 3, 2.5, R.glow);
  d.line(hx - 4, hy - 6, hx - 4, hy - 2, R.VOID);
  d.on('main');
};

const wolf: Drawer = ({ d, r, R }) => {
  const F = R.fur;
  const L = d.sph(56, 50, 56, 66);
  d.path(smooth([96, 106, 108, 108, 118, 102, 124, 94], 3), 6, 2.5, F);
  d.ell(84, 90, 22, 22, F, L);
  d.poly([50, 30, 66, 30, 84, 62, 96, 84, 74, 104, 52, 100, 42, 70, 40, 44], F, L);
  d.ell(80, 110, 13, 4, F, L);
  d.cap(52, 86, 50, 108, 5, F, L);
  d.cap(62, 88, 62, 108, 5, F, L);
  d.ell(48, 110, 6, 3, F, L);
  d.ell(60, 110, 6, 3, F, L);
  d.line(56, 92, 56, 110, F[0] as number);
  d.lines(smooth([76, 76, 90, 72, 100, 84, 96, 100], 3), F[0] as number);
  // head (muzzle raised, mouth open in a howl)
  d.poly([60, 22, 68, 8, 70, 30], F, L);
  d.poly([63, 20, 67, 12, 68, 24], F[0] as number);
  d.ell(54, 32, 14, 12, F, L);
  d.poly([50, 22, 24, 6, 20, 12, 38, 28], F, L);
  d.poly([44, 40, 22, 22, 26, 18, 44, 30], F, L);
  d.poly([38, 30, 22, 14, 24, 19, 42, 34], R.VOID);
  d.ell(21, 8, 2.5, 2.5, R.VOID);
  // chest ruff
  for (let y = 46; y < 84; y += 6) d.lines([42, y, 46, y + 3, 43, y + 6], F[3] as number);
  d.lines([24, 6, 36, 14, 48, 22], F[3] as number);
  d.on('fx');
  d.px(50, 26, R.EYE); d.px(51, 26, R.GLOW);
  for (let i = 0; i < 5; i++) d.px(16 - i * 3 + r.int(-1, 1), 10 - i * 2 + r.int(-1, 1), mix(R.GLOW, 0xffffff, 0.3));
  d.on('main');
};

const cat: Drawer = ({ d, r, R }) => {
  const C = R.dark;
  d.path(smooth([86, 110, 106, 108, 112, 92, 104, 80, 108, 70], 4), 4, 3, C);
  d.ell(64, 88, 28, 26, C);
  d.poly([40, 112, 88, 112, 84, 96, 44, 96], C, 1);
  d.ell(64, 52, 22, 18, C);
  d.poly([44, 46, 42, 22, 58, 38], C, 'diag');
  d.poly([84, 46, 86, 22, 70, 38], C, 'diag');
  d.poly([46, 40, 45, 28, 54, 37], R.acc[0] as number);
  d.poly([82, 40, 83, 28, 74, 37], R.acc[0] as number);
  d.line(58, 92, 56, 112, C[0] as number);
  d.line(70, 92, 72, 112, C[0] as number);
  d.ell(58, 112, 6, 3, C, 2); d.ell(70, 112, 6, 3, C, 2);
  d.poly([62, 58, 66, 58, 64, 61], mix(R.acc[2] as number, 0xe090a0, 0.6));
  d.on('fx');
  const slit = r.chance(0.5) ? 1 : 2;
  for (const x of [55, 73]) {
    d.ell(x, 51, 5, 3.5, R.glow);
    d.rect(x - slit / 2, 48, slit, 7, R.VOID);
    d.px(x - 2, 49, R.WHITE);
  }
  const wc = mix(0xffffff, R.GLOW, 0.4);
  d.lines([60, 60, 42, 58], wc); d.lines([60, 62, 42, 64], wc);
  d.lines([68, 60, 86, 58], wc); d.lines([68, 62, 86, 64], wc);
  d.on('main');
};

const spider: Drawer = ({ d, r, R }) => {
  d.on('back');
  const wc = mix(0x9a98a8, R.GLOW, 0.2);
  const wx = 64, wy = 48;
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.2;
    d.line(wx, wy, wx + Math.cos(a) * 90, wy + Math.sin(a) * 90, wc);
  }
  for (let ring = 12; ring < 90; ring += 12) d.lines(arcPts(wx, wy, ring, ring, 0.2, 0.2 + Math.PI * 2, 10), wc);
  d.on('fx');
  d.line(64, 0, 64, 40, wc);
  d.on('main');
  const L = R.dark;
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) {
      const bx = 64 + s * 8, by = 56 + i * 4;
      const kx = 64 + s * (30 + i * 2), ky = 34 + i * 14 - (i === 0 ? 6 : 0);
      const fx = 64 + s * (44 + (i % 2) * 6), fy = 54 + i * 18;
      d.cap(bx, by, kx, ky, 2.5, L, 'tube', 2);
      d.cap(kx, ky, fx, fy, 2, L, 'tube', 1);
    }
  }
  d.ell(64, 82, 22, 24, L);
  d.ell(64, 56, 12, 11, L);
  // marking
  d.poly([58, 72, 70, 72, 64, 82], R.blood[2] as number);
  d.poly([64, 82, 58, 92, 70, 92], R.blood[2] as number);
  d.poly([60, 64, 62, 70, 64, 66], R.bone[2] as number);
  d.poly([68, 64, 66, 70, 64, 66], R.bone[2] as number);
  d.on('fx');
  for (const [x, y] of [[60, 52], [68, 52], [57, 55], [71, 55], [62, 49], [66, 49]]) d.px(x as number, y as number, R.EYE);
  d.px(60, 53, R.GLOW); d.px(68, 53, R.GLOW);
  d.on('main');
  void r;
};

const ghost: Drawer = ({ d, r, R }) => {
  const G = R.spirit;
  const L = d.sph(56, 50, 44, 60);
  d.ell(64, 44, 28, 28, G, L);
  const bot: number[] = [36, 44, 92, 44, 96, 80];
  for (let i = 0; i <= 6; i++) bot.push(96 - i * 10, 104 + (i % 2 ? -8 : 4) + r.int(-2, 2));
  bot.push(32, 80);
  d.poly(bot, G, L);
  // arms
  d.path([40, 58, 30, 66, 26, 72], 7, 3.5, G);
  d.path([88, 58, 98, 66, 102, 72], 7, 3.5, G);
  d.ell(53, 44, 6, 8, R.VOID);
  d.ell(75, 44, 6, 8, R.VOID);
  d.ell(64, 64, 6, 8, R.VOID);
  d.fade = [86, 112];
  d.on('fx');
  d.px(53, 44, R.EYE); d.px(75, 44, R.EYE);
  for (let i = 0; i < 6; i++) d.px(r.int(30, 98), r.int(100, 120), G[2] as number);
  d.on('main');
};

const hand: Drawer = ({ d, r, R }) => {
  const F = R.ghoul;
  d.rect(48, 96, 32, 32, F, 'cylx');
  const L = d.sph(60, 70, 34, 34);
  d.poly([42, 66, 86, 64, 86, 92, 78, 104, 50, 104, 42, 90], F, L);
  const fingers: number[][] = [
    [48, 66, 44, 46, 42, 28],
    [58, 64, 58, 40, 58, 18],
    [68, 64, 70, 40, 72, 20],
    [79, 66, 84, 46, 88, 30],
  ];
  const curl = r.range(-3, 3);
  for (const f of fingers) {
    d.cap(f[0] as number, f[1] as number, f[2] as number, f[3] as number, 5, F);
    d.cap(f[2] as number, f[3] as number, (f[4] as number) + curl, f[5] as number, 4, F, 'tube', 3);
    d.ell((f[4] as number) + curl, (f[5] as number) - 2, 2.5, 3, R.bone);
    d.line((f[2] as number) - 3, f[3] as number, (f[2] as number) + 3, (f[3] as number) + 1, F[1] as number);
  }
  d.cap(44, 86, 30, 70, 6, F);
  d.cap(30, 70, 26, 56, 4.5, F, 'tube', 3.5);
  d.ell(26, 53, 2.5, 3, R.bone);
  // wrist rags
  d.rect(46, 108, 36, 8, R.dcloth, 'cylx');
  d.on('fx');
  sigil(d, 64, 82, 10, R.GLOW);
  d.on('main');
};

const key: Drawer = ({ d, r, R }) => {
  const M = r.chance(0.6) ? R.gold : R.steel;
  const t = xf(64, 64, -Math.PI / 4 + r.range(-0.1, 0.1));
  const [bx, by] = t.pt(0, -36);
  d.ring(bx, by, 20, 20, 7, M);
  d.ring(bx, by, 11, 11, 3, M);
  d.ell(bx, by, 3, 3, M);
  d.cap(...t.pt(0, -16), ...t.pt(0, 52), 4.5, M);
  d.ell(...t.pt(0, -14), 7, 7, M);
  d.ell(...t.pt(0, 4), 5.5, 5.5, M);
  d.poly(t.pts([3, 32, 22, 32, 22, 38, 16, 38, 16, 42, 22, 42, 22, 52, 3, 52]), M, 'diag');
  d.ell(bx, by, 0.1, 0.1, M);
  d.ell(...t.pt(0, -36), 2, 2, R.acc);
  d.on('fx');
  d.spark(...t.pt(-12, -44), R.WHITE, true);
  d.on('main');
};

const crown: Drawer = ({ d, r, R }) => {
  const G = R.gold;
  d.ell(64, 64, 34, 18, R.acc, 'cyly');
  const tips = [[26, 40], [45, 30], [64, 18], [83, 30], [102, 40]];
  const pts: number[] = [24, 80, 24, 40];
  for (let i = 0; i < tips.length; i++) {
    const [x, y] = tips[i] as number[];
    pts.push(x as number, y as number);
    if (i < tips.length - 1) pts.push((x as number) + 9.5, 58);
  }
  pts.push(104, 40, 104, 80);
  d.poly(pts, G, d.cylx(24, 104));
  for (const [x, y] of tips) d.ell(x as number, (y as number) - 3, 4, 4, G);
  d.clipped((_x, y) => y > 70, () => d.ell(64, 70, 42, 26, G, d.cylx(22, 106)));
  d.rect(22, 70, 84, 16, G, d.cylx(22, 106));
  d.lines(smooth([22, 86, 64, 96, 106, 86], 6), G[1] as number);
  d.line(22, 72, 106, 72, G[4] as number);
  d.ell(64, 82, 7, 7, R.acc5);
  d.ell(40, 80, 5, 5, R.glow);
  d.ell(88, 80, 5, 5, R.glow);
  d.ell(64, 40, 4, 5, R.acc5);
  for (let x = 28; x < 104; x += 6) if (Math.abs(x - 64) > 10 && Math.abs(x - 40) > 7 && Math.abs(x - 88) > 7) d.ell(x, 79, 1.5, 1.5, R.bone[3] as number);
  d.on('fx');
  stars(d, r, 3, R.WHITE, [26, 20, 102, 60]);
  d.on('main');
};

const banner: Drawer = ({ d, r, R }) => {
  d.cap(30, 12, 30, 122, 3, R.wood);
  d.ell(30, 9, 5, 5, R.gold);
  d.cap(26, 24, 104, 24, 2.5, R.wood);
  d.ell(104, 24, 3.5, 3.5, R.gold);
  const ph = r.range(0, 6);
  const folds = (x: number, y: number) => 0.55 + 0.35 * Math.sin((x - 34) * 0.22 + ph) - (y - 28) * 0.002;
  d.poly([36, 26, 98, 26, 98, 108, 67, 90, 36, 108], R.acc, folds);
  for (let i = 0; i < 3; i++) d.ell(r.int(42, 92), r.int(70, 96), r.int(1, 3), r.int(1, 3), ERASE);
  d.rect(36, 26, 62, 4, R.gold, 'cyly');
  for (let x = 38; x < 98; x += 4) d.line(x, 30, x, 32, R.gold[2] as number);
  const emb = r.int(0, 2);
  if (emb === 0) d.scaled(0.38, 67, 60, () => skull({ d, r, R }));
  else if (emb === 1) d.scaled(0.4, 67, 60, () => crow({ d, r, R }));
  else {
    d.on('fx');
    sigil(d, 67, 60, 14, R.GLOW);
    d.on('main');
  }
  for (const x of [36, 98]) d.line(x, 108, x, 114, R.gold[3] as number);
};

const altar: Drawer = ({ d, r, R }) => {
  const S = R.stone;
  d.rect(30, 70, 68, 40, S, 'cylx');
  d.rect(22, 108, 84, 10, S, 'cyly');
  d.rect(18, 60, 92, 12, S, 'cyly');
  d.line(18, 61, 109, 61, S[3] as number);
  d.rect(40, 76, 48, 28, S[1] as number);
  // candles
  for (const x of [26, 100]) {
    d.rect(x - 4, 40, 8, 20, R.bone, 'cylx');
    d.line(x, 34, x, 39, R.VOID);
    fire(d, R, x, 38, 3.5, 12, r.range(-2, 2));
  }
  d.scaled(0.45, 64, 42, () => skull({ d, r, R }));
  // blood drips
  for (let i = 0; i < 3; i++) {
    const x = r.int(24, 104);
    d.cap(x, 70, x, 72 + r.int(4, 14), 1.5, R.blood);
  }
  d.on('fx');
  sigil(d, 64, 90, 11, R.GLOW);
  d.on('main');
};

const gem: Drawer = ({ d, r, R }) => {
  const G = R.acc5;
  const A = [40, 24], B = [88, 24], C = [108, 46], Dd = [64, 112], E = [20, 46];
  const a = [52, 30], b = [76, 30], gl = [42, 46], gr = [86, 46];
  const P = (...p: number[][]) => p.flat();
  d.poly(P(A, B, b, a), G, 4);
  d.poly(P(A, a, gl, E), G, 3);
  d.poly(P(a, b, gr, gl), G, 3);
  d.poly(P(B, C, gr, b), G, 2);
  d.poly(P(E, gl, Dd), G, 2);
  d.poly(P(gl, gr, Dd), G, 1);
  d.poly(P(gr, C, Dd), G, 0);
  d.line(52, 34, 70, 34, G[4] as number);
  d.on('fx');
  d.lines(P(A, B), G[4] as number);
  d.lines(P(E, gl, gr, C), G[3] as number);
  d.spark(48, 34, R.WHITE, true);
  if (r.chance(0.5)) d.spark(90, 60, R.WHITE);
  for (let i = 0; i < 4; i++) d.px(r.int(16, 112), r.int(10, 30), R.GLOW);
  d.on('main');
};

const bones: Drawer = ({ d, r, R }) => {
  const j = () => r.int(-3, 3);
  boneShape(d, R, 28 + j(), 30 + j(), 100 + j(), 98 + j(), 7);
  boneShape(d, R, 100 + j(), 30 + j(), 28 + j(), 98 + j(), 7);
  boneShape(d, R, 20, 108, 52, 104, 4);
  boneShape(d, R, 80, 110, 110, 104, 3.5);
  d.on('fx');
  for (let i = 0; i < 4; i++) d.px(r.int(30, 98), r.int(20, 100), R.GLOW);
  d.on('main');
};

const mask: Drawer = ({ d, r, R }) => {
  const P = [0xa49a96, 0xd6ccc6, 0xf0e8e2, 0xfffaf6];
  d.path(smooth([24, 60, 14, 74, 18, 96], 3), 2.5, 1.5, R.acc);
  d.path(smooth([104, 60, 114, 74, 110, 96], 3), 2.5, 1.5, R.acc);
  const L = d.sph(58, 52, 40, 54);
  d.poly([64, 14, 86, 22, 98, 44, 96, 70, 86, 94, 64, 112, 42, 94, 32, 70, 30, 44, 42, 22], P, L);
  if (r.chance(0.5)) d.clipped((x) => x >= 64, () => d.poly([64, 14, 86, 22, 98, 44, 96, 70, 86, 94, 64, 112, 64, 14], R.dark, L));
  // eye holes
  d.poly([40, 54, 48, 46, 58, 48, 60, 56, 48, 58], ERASE);
  d.poly([88, 54, 80, 46, 70, 48, 68, 56, 80, 58], ERASE);
  d.lines([38, 44, 48, 40, 58, 44], R.gold[3] as number);
  d.lines([90, 44, 80, 40, 70, 44], R.gold[3] as number);
  d.lines([64, 60, 62, 76, 66, 76], P[0] as number);
  d.poly([54, 88, 64, 84, 74, 88, 64, 94], R.blood, 2);
  d.line(55, 88, 73, 88, R.blood[0] as number);
  d.ell(64, 26, 4, 4, R.acc);
  d.lines([48, 58, 47, 66, 49, 74, 48, 80], R.acc[2] as number);
  d.on('fx');
  d.px(48, 52, R.EYE); d.px(79, 52, R.EYE);
  d.on('main');
};

const rune: Drawer = ({ d, r, R }) => {
  const S = R.stone;
  d.poly([36, 118, 34, 56, 44, 24, 66, 12, 88, 26, 96, 64, 94, 118], S, d.sph(54, 46, 60, 80));
  for (let i = 0; i < 3; i++) {
    let x = r.int(42, 88), y = r.int(30, 100);
    for (let k = 0; k < 4; k++) { const nx = x + r.int(-3, 3), ny = y + r.int(2, 5); d.line(x, y, nx, ny, S[0] as number); x = nx; y = ny; }
  }
  const moss = mix(0x3a5a2a, R.acc[2] as number, 0.25);
  for (let i = 0; i < 40; i++) { const x = r.int(36, 94), y = r.int(96, 116); d.px(x, y, (x + y) % 3 ? moss : mix(moss, 0xc0e080, 0.3)); }
  d.on('fx');
  const g = r.pick(GLYPHS);
  glyph(d, g, 54, 42, 5, R.GLOW, 3);
  glyph(d, g, 54, 42, 5, R.EYE, 1);
  for (let i = 0; i < 3; i++) glyph(d, r.pick(GLYPHS), r.chance(0.5) ? r.int(8, 22) : r.int(100, 114), r.int(20, 80), 1.5, R.GLOW);
  d.on('main');
};

const eagle: Drawer = ({ d, r, R }) => {
  const B = R.brown.map((c) => mix(c, R.acc[2] as number, 0.12));
  const wing = (s: number) => {
    const m = (x: number) => 64 + (x - 64) * s;
    const pts = [m(56), 56, m(42), 42, m(26), 32, m(8), 28, m(12), 38, m(4), 44, m(12), 52, m(6), 58, m(16), 64, m(12), 72, m(24), 74, m(30), 84, m(40), 80, m(56), 78];
    d.poly(pts, B, s < 0 ? 'diag' : (x, y) => 0.75 - (y - 28) / 80 - (x - 64) / 200);
    for (let k = 0; k < 5; k++) d.line(m(18 + k * 6), 44 + k * 2, m(14 + k * 4), 66 + k * 2, B[0] as number);
    d.lines([m(56), 58, m(42), 46, m(26), 38], B[3] as number);
  };
  wing(1);
  wing(-1);
  d.poly([54, 92, 74, 92, 84, 114, 64, 108, 44, 114], B, 'cylx');
  d.ell(64, 72, 14, 24, B);
  for (let y = 62; y < 92; y += 6) d.lines([58, y, 64, y + 3, 70, y], B[1] as number);
  d.ell(64, 44, 11, 11, R.bone);
  d.poly([60, 46, 68, 46, 66, 56, 62, 52], R.gold, 'diag');
  d.cap(56, 92, 54, 100, 2, R.gold);
  d.cap(72, 92, 74, 100, 2, R.gold);
  d.on('fx');
  d.px(59, 42, R.EYE); d.px(69, 42, R.EYE);
  d.on('main');
  void r;
};

const bow: Drawer = ({ d, r, R }) => {
  const pull = r.int(12, 18);
  const pts: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16 * 2 - 1;
    const x = 66 - 30 * (1 - t * t) + (Math.abs(t) > 0.8 ? (Math.abs(t) - 0.8) * 30 : 0);
    pts.push(x, 64 + t * 50);
  }
  for (let i = 0; i < 16; i++) {
    const t = Math.abs(i / 16 * 2 - 1);
    d.cap(pts[i * 2] as number, pts[i * 2 + 1] as number, pts[i * 2 + 2] as number, pts[i * 2 + 3] as number, 4.2 - t * 2, R.wood);
  }
  d.rect(34, 56, 8, 16, R.cloth, 'cylx');
  const nx = 72 + pull;
  // arrow
  d.cap(18, 64, nx, 64, 1.5, R.parch);
  d.poly([8, 64, 22, 57, 19, 64, 22, 71], R.steel, 'diag');
  d.poly([nx - 14, 64, nx - 4, 64, nx + 2, 57, nx - 8, 57], R.acc, 2);
  d.poly([nx - 14, 64, nx - 4, 64, nx + 2, 71, nx - 8, 71], R.acc, 1);
  d.on('fx');
  const sc = mix(R.bone[3] as number, 0xffffff, 0.3);
  d.line(70, 14, nx, 64, sc);
  d.line(nx, 64, 70, 114, sc);
  d.on('main');
};

const hammer: Drawer = ({ d, r, R }) => {
  const t = xf(64, 64, r.range(0.2, 0.4));
  d.cap(...t.pt(0, -30), ...t.pt(0, 54), 4, R.wood);
  d.cap(...t.pt(0, 34), ...t.pt(0, 52), 4.6, R.cloth);
  d.ell(...t.pt(0, 56), 5, 5, R.gold);
  d.poly(t.pts([-30, -48, 26, -48, 26, -22, -30, -22]), R.steel, 'diag');
  d.poly(t.pts([-36, -50, -30, -50, -30, -20, -36, -20]), R.steel, 1);
  d.poly(t.pts([26, -44, 46, -35, 26, -26]), R.steel, 'cyly');
  d.poly(t.pts([-8, -50, 4, -50, 4, -20, -8, -20]), R.gold, 'cylx');
  d.lines(t.pts([-30, -47, 26, -47]), R.steel[4] as number);
  d.on('fx');
  const g = r.pick(GLYPHS);
  const [gx, gy] = t.pt(-22, -42);
  glyph(d, g, gx, gy, 2, R.GLOW);
  d.on('main');
};

const lantern: Drawer = ({ d, r, R }) => {
  const M = R.iron;
  d.line(64, 0, 64, 8, M[2] as number);
  d.ring(64, 12, 6, 6, 2, M);
  d.poly([50, 18, 78, 18, 90, 34, 38, 34], M, d.cylx(38, 90));
  d.ell(64, 18, 6, 3, M);
  d.rect(42, 34, 44, 52, [mix(R.GLOW, 0x301810, 0.4), R.GLOW, mix(R.GLOW, 0xffffff, 0.5), mix(R.GLOW, 0xffffff, 0.8)], (x, y) => sphereL((x - 64) / 30, (y - 66) / 34) * 0.4 + 0.55);
  for (const x of [42, 62, 82]) d.rect(x, 34, 4, 52, M, 'cylx');
  d.rect(40, 32, 48, 4, M, 'cyly');
  d.poly([36, 86, 92, 86, 82, 98, 46, 98], M, d.cylx(36, 92));
  d.ell(64, 100, 14, 4, M);
  fire(d, R, 54, 76, 4, 14, r.range(-2, 2));
  d.on('fx');
  d.rect(66, 46, 2, 30, mix(R.GLOW, 0xffffff, 0.85));
  d.on('main');
};

const rat: Drawer = ({ d, r, R }) => {
  const F = R.fur.map((c) => mix(c, 0x6a4a30, 0.35));
  const pink = [0x4a2028, 0x8a4a54, 0xc87a84, 0xf0b0b0];
  d.path(smooth([100, 92, 112, 84, 116, 70, 108, 58, 116, 46], 4), 3, 1, pink);
  d.ell(74, 82, 32, 22, F);
  d.poly([50, 68, 18, 84, 22, 90, 50, 96], F, d.sph(44, 78, 30, 20));
  d.ell(48, 78, 14, 14, F);
  d.ell(54, 62, 7, 8, F);
  d.ell(54, 62, 4, 5, pink, 2);
  d.ell(18, 87, 3, 3, pink);
  for (const x of [52, 82, 96]) d.cap(x, 98, x - 4, 106, 2.5, F);
  for (const x of [48, 78, 92]) d.line(x - 2, 107, x - 7, 107, pink[2] as number);
  // fur tufts on back
  for (let x = 58; x < 100; x += 6) d.line(x, 60 + Math.abs(x - 78) * 0.25, x + 3, 58 + Math.abs(x - 78) * 0.25, F[3] as number);
  d.on('fx');
  d.ell(38, 76, 2.5, 2, R.glow);
  d.px(38, 76, R.WHITE);
  const wc = mix(0xffffff, R.GLOW, 0.3);
  d.lines([22, 84, 10, 78], wc); d.lines([22, 86, 8, 88], wc); d.lines([24, 85, 12, 94], wc);
  d.on('main');
  void r;
};

const tentacle: Drawer = ({ d, r, R }) => {
  const T = R.acc;
  const suck = [mix(T[1] as number, 0xffc0d0, 0.2), mix(T[3] as number, 0xffe0e0, 0.5)];
  const one = (x0: number, len: number, curl: number, r0: number, shade: number) => {
    let x = x0, y = 124, a = -Math.PI / 2 + r.range(-0.2, 0.2);
    const pts: number[] = [];
    const n = Math.floor(len / 2);
    for (let i = 0; i < n; i++) {
      pts.push(x, y);
      const t = i / n;
      a += curl * (0.01 + t * t * 0.12) + Math.sin(t * 6) * 0.02;
      x += Math.cos(a) * 2; y += Math.sin(a) * 2;
    }
    const ramp = T.map((c) => mix(c, 0x0b0910, shade));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const rad = r0 * (1 - t * 0.85);
      d.ell(pts[i * 2] as number, pts[i * 2 + 1] as number, rad, rad, ramp);
    }
    for (let i = 3; i < n - 4; i += 4) {
      const t = i / n;
      const rad = r0 * (1 - t * 0.85);
      const px = pts[i * 2] as number, py = pts[i * 2 + 1] as number;
      const qx = pts[i * 2 + 2] as number, qy = pts[i * 2 + 3] as number;
      const ang = Math.atan2(qy - py, qx - px) + (curl > 0 ? -Math.PI / 2 : Math.PI / 2);
      const sx = px + Math.cos(ang) * rad * 0.6, sy = py + Math.sin(ang) * rad * 0.6;
      d.ell(sx, sy, Math.max(1, rad * 0.35), Math.max(1, rad * 0.35), suck[1] as number);
      d.px(sx, sy, suck[0] as number);
    }
  };
  one(26, 110, 1, 10, 0.4);
  one(100, 110, -1, 10, 0.4);
  one(60 + r.int(-6, 6), 140, r.sign(), 13, 0);
};

const portal: Drawer = ({ d, r, R }) => {
  const ph = r.range(0, 6.28);
  const swirl = (x: number, y: number) => {
    const dx = (x - d.X(64)) / 32, dy = (y - d.Y(62)) / 44;
    const rr = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    return 0.4 + 0.35 * Math.sin(rr * 9 - a * 2 + ph) + (1 - rr) * 0.5;
  };
  d.ell(64, 62, 32, 44, [R.acc5[0] as number, R.acc5[1] as number, R.GLOW, mix(R.GLOW, 0xffffff, 0.5), 0xffffff], swirl);
  d.ring(64, 62, 42, 54, 11, R.stone, 'tube');
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    d.line(64 + Math.cos(a) * 31, 62 + Math.sin(a) * 43, 64 + Math.cos(a) * 42, 62 + Math.sin(a) * 54, R.stone[0] as number);
  }
  d.rect(14, 108, 100, 12, R.stone, 'cyly');
  d.line(14, 109, 113, 109, R.stone[3] as number);
  d.on('fx');
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    glyph(d, r.pick(GLYPHS), 64 + Math.cos(a) * 36 - 2, 62 + Math.sin(a) * 48 - 3, 1, R.GLOW);
  }
  for (let i = 0; i < 6; i++) d.px(r.int(40, 88), r.int(30, 100), 0xffffff);
  d.on('main');
};

const chain: Drawer = ({ d, r, R }) => {
  const M = R.steel;
  const ang = Math.PI / 4 + r.range(-0.1, 0.1);
  const t = xf(64, 64, ang - Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const [cx, cy] = t.pt(0, -60 + i * 22);
    if (i % 2 === 0) d.ring(cx, cy, 11, 16, 5, M, 'tube', ang - Math.PI / 2);
    else {
      d.cap(...t.pt(0, -60 + i * 22 - 12), ...t.pt(0, -60 + i * 22 + 12), 4, M);
      d.line(...t.pt(0, -60 + i * 22 - 9), ...t.pt(0, -60 + i * 22 + 9), M[0] as number);
    }
  }
  // padlock at the end
  const [lx, ly] = t.pt(0, 74);
  if (r.chance(0.5)) {
    d.ring(lx, ly - 12, 9, 10, 4, M);
    d.rect(lx - 13, ly - 6, 26, 22, R.gold, 'diag');
    d.ell(lx, ly + 2, 2.5, 2.5, R.VOID);
    d.rect(lx - 1, ly + 3, 2, 6, R.VOID);
  }
};

const heart: Drawer = ({ d, r, R }) => {
  const B = R.blood.map((c) => mix(c, R.acc[2] as number, 0.2));
  // vessels
  d.cap(56, 34, 52, 12, 6, B, 'tube', 5);
  d.cap(70, 34, 78, 14, 5, B, 'tube', 4);
  d.ell(52, 10, 5, 3, B[0] as number);
  d.ell(78, 12, 4, 3, B[0] as number);
  const L = d.sph(60, 58, 46, 50);
  d.ell(46, 50, 24, 22, B, L);
  d.ell(82, 50, 24, 22, B, L);
  d.poly([23, 56, 105, 56, 96, 76, 64, 112, 32, 76], B, L);
  for (let i = 0; i < 3; i++) {
    let x = r.int(36, 92), y = r.int(40, 60);
    for (let k = 0; k < 6; k++) { const nx = x + r.int(-3, 3), ny = y + r.int(2, 5); d.line(x, y, nx, ny, B[0] as number); x = nx; y = ny; }
  }
  if (r.chance(0.5)) {
    const t = xf(70, 64, Math.PI * 0.8);
    blade(d, t, 52, 5, R, 0.25);
    d.poly(t.pts([-14, 2, 14, 2, 14, 7, -14, 7]), R.gold, 'cyly');
    d.cap(...t.pt(0, 8), ...t.pt(0, 26), 3.5, R.wood);
  } else {
    // stitches
    for (let k = 0; k < 5; k++) d.line(48 + k * 7, 72 + k * 2, 52 + k * 7, 66 + k * 2, R.bone[2] as number);
  }
  d.on('fx');
  d.spark(40, 40, R.WHITE);
  d.cap(64, 112, 64, 118, 1.5, B[2] as number);
  d.on('main');
};

const feather: Drawer = ({ d, r, R }) => {
  const V = r.chance(0.5) ? R.acc : R.dark;
  const t = xf(64, 64, Math.PI / 5 + r.range(-0.1, 0.1));
  const left = [0, -58, -8, -48, -14, -28, -16, -6, -14, 16, -8, 32, 0, 36];
  const right = [0, -58, 7, -48, 12, -28, 13, -6, 11, 16, 6, 32, 0, 36];
  d.poly(t.pts(left), V, 3);
  d.poly(t.pts(right), V, 1);
  for (let y = -46; y < 30; y += 5) {
    d.line(...t.pt(0, y), ...t.pt(-12 + Math.abs(y + 6) * 0.08, y + 6), V[2] as number);
    d.line(...t.pt(0, y), ...t.pt(10 - Math.abs(y + 6) * 0.06, y + 5), V[0] as number);
  }
  // splits
  for (const [x, y] of [[-15, -10], [12, 6], [-13, 18]]) d.poly(t.pts([x as number, y as number, (x as number) * 0.4, (y as number) + 2, x as number, (y as number) + 3]), ERASE);
  d.cap(...t.pt(0, -52), ...t.pt(0, 54), 1.6, R.bone, 'tube', 2);
  d.ell(...t.pt(0, 56), 2, 2, R.VOID);
  for (let k = 0; k < 4; k++) d.line(...t.pt(-2, 38 + k * 3), ...t.pt(-5, 40 + k * 3), V[2] as number);
  d.on('fx');
  const [ix, iy] = t.pt(0, 60);
  d.ell(ix, iy + 3, 1.5, 2, R.VOID);
  d.on('main');
};

const mage: Drawer = ({ d, r, R }) => {
  const C = R.cloth;
  d.poly([64, 44, 98, 120, 30, 120], C, d.sph(56, 70, 60, 70));
  for (const x of [52, 76]) d.line(x, 90, x + (x - 64) * 0.3, 120, C[0] as number);
  d.cap(96, 22, 94, 124, 2.5, R.wood);
  d.cap(54, 64, 46, 96, 7, C, 'tube', 8);
  d.cap(76, 64, 90, 84, 7, C, 'tube', 7);
  d.ell(94, 84, 6, 5, R.flesh);
  d.ell(46, 100, 5, 4, R.flesh);
  d.ell(64, 54, 10, 10, R.flesh.map((c) => mix(c, 0x0b0910, 0.25)));
  d.poly([54, 58, 74, 58, 72, 80, 64, 96, 56, 80], R.bone, d.sph(60, 64, 18, 30));
  for (let y = 66; y < 92; y += 5) d.line(61, y, 63, y + 3, R.bone[1] as number);
  d.path([64, 60, 54, 62, 50, 58], 1.8, 1, R.bone);
  d.path([64, 60, 74, 62, 78, 58], 1.8, 1, R.bone);
  const tip = r.int(-4, 6);
  d.poly([42, 46, 86, 46, 72, 18, 84 + tip, 2, 62, 16], C, d.cylx(42, 86));
  d.ell(64, 46, 30, 6, C, 'cyly');
  d.rect(47, 40, 34, 4, R.gold, 'cyly');
  d.on('fx');
  d.px(60, 52, R.EYE); d.px(68, 52, R.EYE);
  d.ell(96, 16, 7, 7, R.glow);
  d.px(94, 13, R.WHITE);
  stars(d, r, 3, R.gold[4] as number, [52, 22, 76, 36]);
  d.on('main');
};

const assassin: Drawer = ({ d, r, R }) => {
  const C = R.dcloth;
  d.poly([10, 124, 26, 84, 64, 72, 102, 84, 118, 124], C, d.sph(56, 90, 70, 50));
  d.poly([64, 8, 90, 36, 92, 62, 80, 80, 48, 80, 36, 62, 38, 36], C, d.sph(56, 40, 34, 44));
  d.ell(64, 54, 15, 18, C[0] as number);
  d.ell(64, 56, 12, 15, R.VOID);
  d.clipped((_x, y) => y > 55, () => d.ell(64, 56, 12, 15, R.cloth, 'cylx'));
  d.lines([52, 55, 64, 58, 76, 55], R.cloth[3] as number);
  d.lines([58, 62, 62, 68], R.cloth[0] as number);
  d.lines([70, 62, 66, 68], R.cloth[0] as number);
  // crossed daggers
  for (const s of [-1, 1]) {
    const t = xf(64 + s * 26, 112, s * -0.85);
    blade(d, t, 46, 4.5, R, 0.3);
    d.poly(t.pts([-10, 0, 10, 0, 11, 5, -11, 5]), R.gold, 'cyly');
    d.cap(...t.pt(0, 6), ...t.pt(0, 16), 3, R.wood);
  }
  d.on('fx');
  const ey = 50 + r.int(0, 1);
  for (const x of [56, 68]) { d.px(x, ey, R.GLOW); d.px(x + 1, ey, R.EYE); d.px(x + 2, ey, R.EYE); d.px(x + 3, ey, R.GLOW); }
  d.on('main');
};

const priest: Drawer = ({ d, r, R }) => {
  const Wr = [0x6a6070, 0xa8a0a8, 0xdcd4d0, 0xf8f4ee];
  d.on('back');
  d.ring(64, 38, 24, 24, 3, R.GLOW, 'flat');
  d.ring(64, 38, 19, 19, 1, mix(R.GLOW, 0xffffff, 0.4), 'flat');
  d.on('main');
  d.poly([64, 46, 100, 120, 28, 120], Wr, d.sph(56, 70, 60, 70));
  d.rect(56, 60, 16, 60, R.acc, 'cylx');
  for (let y = 70; y < 118; y += 16) { d.rect(62, y, 4, 10, R.gold, 2); d.rect(59, y + 3, 10, 3, R.gold, 2); }
  d.poly([40, 72, 52, 66, 54, 92, 42, 96], Wr, 1);
  d.poly([88, 72, 76, 66, 74, 92, 86, 96], Wr, 2);
  d.ell(64, 50, 10, 11, R.flesh);
  d.poly([56, 56, 72, 56, 70, 64, 64, 70, 58, 64], R.bone, 'diag');
  d.poly([50, 42, 52, 20, 64, 6, 76, 20, 78, 42], Wr, d.cylx(50, 78));
  d.rect(61, 12, 6, 30, R.gold, 'cylx');
  d.rect(53, 22, 22, 5, R.gold, 'cyly');
  d.rect(50, 38, 28, 5, R.gold, 'cyly');
  // censer
  const cx = r.chance(0.5) ? 28 : 100;
  d.line(cx < 64 ? 44 : 84, 94, cx, 104, R.gold[3] as number);
  d.ell(cx, 108, 7, 6, R.gold);
  d.on('fx');
  d.rect(59, 50, 3, 1, R.VOID); d.rect(67, 50, 3, 1, R.VOID);
  for (let i = 0; i < 8; i++) d.px(cx + Math.round(Math.sin(i) * 3), 100 - i * 3, mix(R.GLOW, 0xffffff, 0.4));
  d.on('main');
};

const merchant: Drawer = ({ d, r, R }) => {
  const C = R.cloth;
  d.ell(64, 104, 38, 30, C);
  d.rect(26, 100, 76, 6, R.gold, 'cyly');
  d.ell(64, 103, 5, 4, R.acc);
  d.ell(64, 60, 18, 18, R.flesh);
  // hat
  d.ell(64, 44, 34, 7, R.acc, 'cyly');
  d.clipped((_x, y) => y < 44, () => d.ell(64, 44, 18, 20, R.acc, d.cylx(46, 82)));
  d.rect(46, 38, 36, 4, R.gold, 'cyly');
  // face
  d.lines(smooth([50, 70, 56, 68, 62, 70], 3), R.wood[1] as number);
  d.lines(smooth([66, 70, 72, 68, 78, 70], 3), R.wood[1] as number);
  d.path([62, 70, 52, 72, 46, 68], 2, 1, R.wood);
  d.path([66, 70, 76, 72, 82, 68], 2, 1, R.wood);
  d.lines(smooth([56, 76, 64, 80, 72, 76], 3), R.VOID);
  d.ell(64, 66, 3, 3, R.flesh);
  // coin sack
  d.ell(100, 100, 18, 16, R.parch);
  d.poly([92, 84, 108, 84, 104, 78, 96, 78], R.parch, 1);
  d.line(92, 86, 108, 86, R.wood[0] as number);
  d.scaled(0.25, 100, 104, () => coin({ d, r, R }));
  // raised coin
  d.ell(30, 82, 7, 7, R.flesh);
  d.ell(28, 70, 8, 9, R.gold, 'diag');
  d.ring(28, 70, 5, 6, 1, R.gold[1] as number);
  d.on('fx');
  d.rect(56, 60, 3, 2, R.VOID); d.rect(70, 60, 3, 2, R.VOID);
  d.spark(24, 64, R.WHITE);
  d.on('main');
};

const beast: Drawer = ({ d, r, R }) => {
  const F = R.fur.map((c) => mix(c, R.acc[1] as number, 0.3));
  const horn = (s: number) => {
    const m = (x: number) => 64 + (x - 64) * s;
    d.path(smooth([m(46), 44, m(30), 36, m(18), 20, m(20), 6], 4), 7, 1.5, R.bone);
    for (let k = 0; k < 3; k++) d.line(m(38 - k * 6), 38 - k * 6, m(30 - k * 6), 44 - k * 8, R.bone[1] as number);
  };
  horn(1); horn(-1);
  // spiky cheeks
  d.poly([30, 50, 14, 62, 30, 66, 12, 78, 34, 80, 24, 94, 44, 90], F, 1);
  d.poly([98, 50, 114, 62, 98, 66, 116, 78, 94, 80, 104, 94, 84, 90], F, 1);
  d.poly([40, 40, 34, 18, 52, 34], F, 2);
  d.poly([88, 40, 94, 18, 76, 34], F, 2);
  const L = d.sph(60, 58, 40, 48);
  d.ell(64, 60, 32, 32, F, L);
  d.ell(64, 88, 20, 18, F, L);
  d.poly([40, 52, 62, 56, 64, 60, 66, 56, 88, 52, 84, 46, 44, 46], F[0] as number);
  // eyes
  d.poly([44, 54, 60, 58, 58, 62, 46, 60], R.VOID);
  d.poly([84, 54, 68, 58, 70, 62, 82, 60], R.VOID);
  // nose & mouth
  d.ell(64, 78, 7, 4, R.VOID);
  d.poly([48, 90, 80, 90, 74, 104, 54, 104], R.VOID);
  for (const x of [50, 56, 72, 78]) d.poly([x - 2, 90, x + 2, 90, x, x === 56 || x === 72 ? 99 : 95], R.bone[3] as number);
  for (const x of [56, 64, 72]) d.poly([x - 2, 104, x + 2, 104, x, 98], R.bone[2] as number);
  d.on('fx');
  d.poly([47, 56, 57, 59, 56, 61, 48, 59], R.GLOW);
  d.poly([81, 56, 71, 59, 72, 61, 80, 59], R.GLOW);
  d.px(52, 58, R.WHITE); d.px(76, 58, R.WHITE);
  d.on('main');
  void r;
};

const scales: Drawer = ({ d, r, R }) => {
  const G = R.gold;
  const tilt = r.range(-0.18, 0.18);
  const lx = 64 - 42 * Math.cos(tilt), ly = 30 - 42 * Math.sin(tilt);
  const rx = 64 + 42 * Math.cos(tilt), ry = 30 + 42 * Math.sin(tilt);
  d.poly([42, 116, 86, 116, 76, 104, 52, 104], G, d.cylx(42, 86));
  d.ell(64, 104, 12, 3, G, 2);
  d.cap(64, 26, 64, 104, 3.2, G);
  d.cap(lx, ly, rx, ry, 2.6, G);
  d.ell(64, 30, 5, 5, G);
  d.ell(64, 20, 4, 6, R.glow);
  const pan = (px: number, py: number) => {
    const by = py + 44;
    d.on('fx');
    d.line(px, py, px - 16, by, G[3] as number);
    d.line(px, py, px + 16, by, G[3] as number);
    d.on('main');
    d.clipped((_x, y) => y >= by, () => d.ell(px, by, 20, 10, G, d.cylx(px - 20, px + 20)));
    d.ell(px, by, 20, 3, G[1] as number);
    d.ell(px, py, 2.5, 2.5, G);
    return by;
  };
  const lb = pan(lx, ly);
  const rb = pan(rx, ry);
  flatCoin(d, R, lx - 6, lb - 2, 7);
  flatCoin(d, R, lx + 5, lb - 3, 7);
  flatCoin(d, R, lx, lb - 7, 7);
  if (r.chance(0.5)) d.scaled(0.22, rx, rb - 10, () => heart({ d, r, R }));
  else d.scaled(0.25, rx, rb - 12, () => feather({ d, r, R }));
};

const cauldron: Drawer = ({ d, r, R }) => {
  const M = R.iron;
  for (const x of [40, 64, 88]) d.cap(x, 96, x + (x - 64) * 0.2, 114, 3, M);
  fire(d, R, 52, 116, 6, 14, -3);
  fire(d, R, 76, 116, 6, 14, 3);
  d.ring(22, 64, 8, 8, 3, M);
  d.ring(106, 64, 8, 8, 3, M);
  d.ell(64, 78, 40, 28, M);
  d.ring(64, 56, 40, 9, 5, M);
  const Lq = R.acc5;
  d.ell(64, 56, 35, 6, Lq, 'diag');
  d.on('fx');
  for (let i = 0; i < 6; i++) d.ring(r.int(40, 88), r.int(53, 59), 2, 2, 1, Lq[4] as number, 'flat');
  const steam = mix(Lq[3] as number, 0xffffff, 0.2);
  for (let k = 0; k < 3; k++) {
    let x = 46 + k * 18 + r.int(-3, 3);
    for (let y = 46; y > 6; y -= 2) {
      x += Math.sin(y * 0.2 + k) * 1.2;
      if ((y / 2) % 3 !== 0) d.px(x, y, steam);
    }
  }
  d.on('main');
};

const throne: Drawer = ({ d, r, R }) => {
  const S = r.chance(0.5) ? R.stone : R.wood;
  // back with spikes
  const back = [32, 72, 32, 30, 38, 14, 44, 26, 52, 8, 58, 22, 64, 2, 70, 22, 76, 8, 84, 26, 90, 14, 96, 30, 96, 72];
  d.poly(back, S, d.cylx(32, 96));
  d.rect(42, 26, 44, 44, R.acc, 'cylx');
  d.ring(64, 48, 22, 24, 2, R.gold, 'flat');
  // armrests & seat
  d.rect(22, 66, 14, 44, S, 'cylx');
  d.rect(92, 66, 14, 44, S, 'cylx');
  d.rect(36, 72, 56, 12, R.acc, 'cyly');
  d.rect(34, 84, 60, 26, S, 'diag');
  d.rect(40, 88, 48, 18, S[1] as number);
  d.scaled(0.22, 29, 64, () => skull({ d, r, R }));
  d.scaled(0.22, 99, 64, () => skull({ d, r, R }));
  d.rect(20, 110, 88, 6, S, 'cyly');
  d.on('fx');
  d.scaled(0.4, 64, 48, () => {
    const p = [46, 70, 46, 46, 55, 58, 64, 40, 73, 58, 82, 46, 82, 70];
    d.lines(p.concat([46, 70]), R.GLOW);
  });
  d.on('main');
};

const gate: Drawer = ({ d, r, R }) => {
  const S = R.stone;
  d.rect(12, 40, 104, 80, S, 'diag');
  d.clipped((_x, y) => y < 40, () => d.ell(64, 44, 52, 40, S, 'diag'));
  bricks(d, 12, 42, 116, 120, S[1] as number);
  // door opening
  const inDoor = (x: number, y: number) => (y >= 50 && x > 32 && x < 96) || (x - 64) ** 2 / 32 ** 2 + (y - 50) ** 2 / 30 ** 2 <= 1;
  d.clipped(inDoor, () => {
    d.rect(30, 18, 68, 102, R.wood, 'cylx');
    for (let x = 38; x < 96; x += 8) d.line(x, 18, x, 120, R.wood[0] as number);
    for (const y of [60, 90]) d.rect(30, y, 68, 5, R.iron, 'cyly');
    for (let x = 36; x < 96; x += 8) { d.px(x, 62, R.steel[3] as number); d.px(x, 92, R.steel[3] as number); }
    d.rect(63, 18, 2, 102, R.VOID);
  });
  for (let k = 0; k <= 10; k++) {
    const a = Math.PI + (k / 10) * Math.PI;
    d.line(64 + Math.cos(a) * 32, 50 + Math.sin(a) * 30, 64 + Math.cos(a) * 42, 50 + Math.sin(a) * 40, S[0] as number);
  }
  d.ring(54, 78, 4, 4, 1.5, R.gold);
  d.ring(74, 78, 4, 4, 1.5, R.gold);
  d.on('fx');
  const open = r.chance(0.6);
  if (open) {
    d.rect(63, 24, 2, 96, R.EYE);
    for (let y = 118; y < 128; y++) for (let x = 64 - (y - 112) * 2; x <= 64 + (y - 112) * 2; x++) if ((x + y) % 2 === 0 && y % 2 === 0) d.px(x, y, mix(R.GLOW, R.dark[1] as number, 0.5));
  }
  d.on('main');
};

const grave: Drawer = ({ d, r, R }) => {
  const S = R.stone;
  const t = xf(64, 70, r.range(-0.12, 0.12));
  const pts = t.pts([-24, 36, -24, -20, ...arcPts(0, -20, 24, 22, Math.PI, Math.PI * 2, 10), 24, 36]);
  d.poly(pts, S, d.sph(56, 50, 40, 60));
  d.lines(t.pts([-20, -22, ...arcPts(0, -20, 20, 18, Math.PI, Math.PI * 1.5, 5)]), S[3] as number);
  const mark = r.int(0, 1);
  if (mark === 0) {
    d.poly(t.pts([-3, -26, 3, -26, 3, -16, 12, -16, 12, -10, 3, -10, 3, 12, -3, 12, -3, -10, -12, -10, -12, -16, -3, -16]), S[0] as number);
  } else {
    // R I P
    const c = S[0] as number;
    const L = (a: number[]) => d.lines(t.pts(a), c);
    L([-14, -10, -14, 2]); L([-14, -10, -9, -10, -8, -7, -9, -4, -14, -4]); L([-11, -4, -8, 2]);
    L([0, -10, 0, 2]);
    L([7, -10, 7, 2]); L([7, -10, 12, -10, 13, -7, 12, -4, 7, -4]);
  }
  for (let i = 0; i < 2; i++) {
    let [x, y] = t.pt(r.int(-16, 16), r.int(-30, 0));
    for (let k = 0; k < 5; k++) { const nx = x + r.int(-2, 2), ny = y + r.int(2, 4); d.line(x, y, nx, ny, S[0] as number); x = nx; y = ny; }
  }
  d.clipped((_x, y) => y < 118, () => d.ell(64, 118, 50, 16, [0x0e0a0c, 0x1c1418, 0x2e2224, 0x46363a], 'sphere'));
  for (let i = 0; i < 40; i++) { const x = r.int(20, 108), y = r.int(104, 117); d.px(x, y, (x + y) % 2 ? 0x1c1418 : 0x46363a); }
  d.on('fx');
  const grass = mix(0x4a5a3a, R.GLOW, 0.12);
  for (let x = 18; x < 110; x += r.int(4, 9)) { const gy = 118 - Math.sqrt(Math.max(0, 1 - ((x - 64) / 50) ** 2)) * 16; d.line(x, gy + 1, x + r.int(-2, 2), gy - r.int(3, 6), grass); }
  if (r.chance(0.6)) {
    const wx = r.chance(0.5) ? 24 : 104;
    d.ell(wx, 54, 4, 4, R.glow);
    d.px(wx, 53, R.WHITE);
  }
  d.on('main');
};

export const DRAWERS: Record<SubjectName, Drawer> = {
  skull, crow, dagger, sword, axe, coin, coins, chest, scroll, book,
  eye, hooded, knight, shield, tower, castle, flame, candle, chalice, potion,
  moon, ship, serpent, wolf, cat, spider, ghost, hand, key, crown,
  banner, altar, gem, bones, mask, rune, eagle, bow, hammer, lantern,
  rat, tentacle, portal, chain, heart, feather, mage, assassin, priest, merchant,
  beast, scales, cauldron, throne, gate, grave,
};

/** Backdrop tweaks per subject. */
export const BG_OPTS: Partial<Record<SubjectName, { moon?: 'auto' | 'never' | 'always'; ground?: boolean; fog?: boolean }>> = {
  moon: { moon: 'never', ground: false },
  wolf: { moon: 'always' },
  ship: { ground: false },
  ghost: { ground: true },
  portal: { moon: 'never' },
  tower: { moon: 'always' },
};

