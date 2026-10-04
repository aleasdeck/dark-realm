/**
 * Pixel primitives for 128x128 native-resolution pixel art.
 * Layers hold packed 0xRRGGBB colors, -1 = transparent. No anti-aliasing anywhere:
 * every shape is sampled at pixel centers, shading picks discrete ramp tones with
 * ordered (Bayer) dithering at tone boundaries.
 */
import { OUT } from './color';

export const W = 128;
export const H = 128;
export const N = W * H;
export const ERASE = -2;

export type Ramp = readonly number[];
/** A ramp (shaded) or a single solid color / ERASE. */
export type Paint = Ramp | number;
/** Light function in screen coords, returns 0..1. */
export type LightFn = (x: number, y: number) => number;
/** Shading mode: named, fixed ramp index, or custom light function. */
export type Mode = 'sphere' | 'cylx' | 'cyly' | 'diag' | 'vgrad' | 'flat' | 'tube' | number | LightFn;

const LL = Math.hypot(-0.5, -0.62, 0.6);
const LX = -0.5 / LL, LY = -0.62 / LL, LZ = 0.6 / LL;
const LXZ = Math.hypot(LX, LZ), LYZ = Math.hypot(LY, LZ);

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function bayer(x: number, y: number): number {
  return ((BAYER4[((y & 3) << 2) | (x & 3)] as number) + 0.5) / 16;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Pick a ramp tone for light level l, dithering only near the boundary between tones. */
export function tone(l: number, ramp: Ramp, x: number, y: number): number {
  const n = ramp.length;
  if (n === 1) return ramp[0] as number;
  const v = clamp01(l) * (n - 1);
  let i = Math.floor(v);
  const f = v - i;
  if ((f - 0.5) * 2.4 + 0.5 > bayer(x, y)) i++;
  return ramp[i >= n ? n - 1 : i] as number;
}

/** Lambert-ish wrap lighting for a normal given by its screen-plane components. */
export function sphereL(nx: number, ny: number): number {
  let d = nx * nx + ny * ny;
  if (d > 1) {
    const k = 1 / Math.sqrt(d);
    nx *= k;
    ny *= k;
    d = 1;
  }
  const nz = Math.sqrt(1 - d);
  const dot = nx * LX + ny * LY + nz * LZ;
  return clamp01((dot + 0.32) / 1.3);
}

function boxLight(mode: Mode, x0: number, y0: number, x1: number, y1: number): LightFn {
  if (typeof mode === 'function') return mode;
  const w = Math.max(1e-3, x1 - x0), h = Math.max(1e-3, y1 - y0);
  switch (mode) {
    case 'sphere':
    case 'tube':
      return (x, y) => sphereL(((x - x0) / w) * 2 - 1, ((y - y0) / h) * 2 - 1);
    case 'cylx':
      return (x) => {
        const nx = Math.max(-1, Math.min(1, ((x - x0) / w) * 2 - 1));
        const nz = Math.sqrt(1 - nx * nx);
        return clamp01(((nx * LX + nz * LZ) / LXZ + 0.3) / 1.25);
      };
    case 'cyly':
      return (_x, y) => {
        const ny = Math.max(-1, Math.min(1, ((y - y0) / h) * 2 - 1));
        const nz = Math.sqrt(1 - ny * ny);
        return clamp01(((ny * LY + nz * LZ) / LYZ + 0.3) / 1.25);
      };
    case 'diag':
      return (x, y) => 0.98 - 0.85 * (((x - x0) / w) * 0.45 + ((y - y0) / h) * 0.55);
    case 'vgrad':
      return (_x, y) => 0.95 - 0.85 * ((y - y0) / h);
    case 'flat':
      return () => 0.62;
    default:
      return () => 0.5;
  }
}

export class Layer {
  data: Int32Array;
  constructor() {
    this.data = new Int32Array(N).fill(-1);
  }
  get(x: number, y: number): number {
    return x < 0 || y < 0 || x >= W || y >= H ? -1 : (this.data[y * W + x] as number);
  }
}

export type LayerName = 'back' | 'main' | 'fx';

/** Rotate+translate helper: local points (around 0,0) -> logical coords. */
export function xf(cx: number, cy: number, ang: number) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const pt = (x: number, y: number): [number, number] => [cx + x * c - y * s, cy + x * s + y * c];
  const pts = (p: readonly number[]): number[] => {
    const o: number[] = [];
    for (let i = 0; i < p.length; i += 2) {
      const [a, b] = pt(p[i] as number, p[i + 1] as number);
      o.push(a, b);
    }
    return o;
  };
  return { pt, pts, ang };
}

export function arcPts(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number): number[] {
  const o: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    o.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return o;
}

/** Catmull-Rom smoothing of a flat point list. */
export function smooth(p: readonly number[], seg = 6): number[] {
  const n = p.length / 2;
  const o: number[] = [];
  const P = (i: number, k: number) => p[Math.max(0, Math.min(n - 1, i)) * 2 + k] as number;
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < seg; s++) {
      const t = s / seg, t2 = t * t, t3 = t2 * t;
      for (let k = 0; k < 2; k++) {
        const p0 = P(i - 1, k), p1 = P(i, k), p2 = P(i + 1, k), p3 = P(i + 2, k);
        o.push(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3));
      }
    }
  }
  o.push(P(n - 1, 0), P(n - 1, 1));
  return o;
}

/**
 * Drawing context. Coordinates are "logical" 128-space coordinates, mapped through
 * an optional scale/offset transform (used to reuse drawers at smaller sizes).
 */
export class Draw {
  back = new Layer();
  main = new Layer();
  fx = new Layer();
  target: Layer;
  clip: ((x: number, y: number) => boolean) | null = null;
  s = 1;
  ox = 0;
  oy = 0;
  /** After outlining, dither-fade main layer between these screen rows. */
  fade: [number, number] | null = null;

  constructor() {
    this.target = this.main;
  }

  on(name: LayerName): this {
    this.target = this[name];
    return this;
  }

  X(x: number): number {
    return (x - 64) * this.s + 64 + this.ox;
  }
  Y(y: number): number {
    return (y - 64) * this.s + 64 + this.oy;
  }

  /** Light function from a sphere in logical coords (for multi-part shapes sharing light). */
  sph(cx: number, cy: number, rx: number, ry: number): LightFn {
    const X = this.X(cx), Y = this.Y(cy), a = rx * this.s, b = ry * this.s;
    return (x, y) => sphereL((x - X) / a, (y - Y) / b);
  }
  /** Light function: cylinder along y axis spanning logical x0..x1. */
  cylx(x0: number, x1: number): LightFn {
    return boxLight('cylx', this.X(x0), 0, this.X(x1), 1);
  }
  cyly(y0: number, y1: number): LightFn {
    return boxLight('cyly', 0, this.Y(y0), 1, this.Y(y1));
  }

  put(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    if (this.clip && !this.clip(x + 0.5, y + 0.5)) return;
    this.target.data[y * W + x] = c === ERASE ? -1 : c;
  }

  /** Single logical pixel. */
  px(x: number, y: number, c: number): void {
    this.put(Math.floor(this.X(x)), Math.floor(this.Y(y)), c);
  }

  private shape(bx0: number, by0: number, bx1: number, by1: number, inside: (x: number, y: number) => boolean, paint: Paint, light: LightFn, idx: number): void {
    const xa = Math.max(0, Math.floor(bx0)), xb = Math.min(W - 1, Math.ceil(bx1));
    const ya = Math.max(0, Math.floor(by0)), yb = Math.min(H - 1, Math.ceil(by1));
    const solid = typeof paint === 'number';
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const sx = x + 0.5, sy = y + 0.5;
        if (!inside(sx, sy)) continue;
        let c: number;
        if (solid) c = paint;
        else if (idx >= 0) c = paint[Math.min(paint.length - 1, idx)] as number;
        else c = tone(light(sx, sy), paint, x, y);
        this.put(x, y, c);
      }
    }
  }

  private resolve(mode: Mode, x0: number, y0: number, x1: number, y1: number): [LightFn, number] {
    if (typeof mode === 'number') return [() => 0, mode];
    return [boxLight(mode, x0, y0, x1, y1), -1];
  }

  rect(x: number, y: number, w: number, h: number, paint: Paint, mode: Mode = 'flat'): void {
    const x0 = Math.round(this.X(x)), y0 = Math.round(this.Y(y));
    const x1 = Math.round(this.X(x + w)), y1 = Math.round(this.Y(y + h));
    const [l, i] = this.resolve(mode, x0, y0, x1, y1);
    this.shape(x0, y0, x1 - 1, y1 - 1, (sx, sy) => sx >= x0 && sx < x1 && sy >= y0 && sy < y1, paint, l, i);
  }

  ell(cx: number, cy: number, rx: number, ry: number, paint: Paint, mode: Mode = 'sphere', ang = 0): void {
    const X = this.X(cx), Y = this.Y(cy);
    const a = Math.max(0.5, rx * this.s), b = Math.max(0.5, ry * this.s);
    const co = Math.cos(ang), si = Math.sin(ang);
    const R = ang ? Math.max(a, b) : 0;
    const bx0 = ang ? X - R : X - a, bx1 = ang ? X + R : X + a;
    const by0 = ang ? Y - R : Y - b, by1 = ang ? Y + R : Y + b;
    const inside = (x: number, y: number) => {
      const dx = x - X, dy = y - Y;
      const u = dx * co + dy * si, v = -dx * si + dy * co;
      return (u * u) / (a * a) + (v * v) / (b * b) <= 1;
    };
    let light: LightFn, idx = -1;
    if (mode === 'sphere' || mode === 'tube') {
      light = (x, y) => {
        const dx = x - X, dy = y - Y;
        const u = (dx * co + dy * si) / a, v = (-dx * si + dy * co) / b;
        return sphereL(u * co - v * si, u * si + v * co);
      };
    } else [light, idx] = this.resolve(mode, bx0, by0, bx1, by1);
    this.shape(bx0, by0, bx1, by1, inside, paint, light, idx);
  }

  /** Elliptical ring of thickness t. Mode 'tube' shades it as a round torus. */
  ring(cx: number, cy: number, rx: number, ry: number, t: number, paint: Paint, mode: Mode = 'tube', ang = 0): void {
    const X = this.X(cx), Y = this.Y(cy);
    const a = rx * this.s, b = ry * this.s, ts = t * this.s;
    const ai = Math.max(0.01, a - ts), bi = Math.max(0.01, b - ts);
    const co = Math.cos(ang), si = Math.sin(ang);
    const R = Math.max(a, b);
    const loc = (x: number, y: number) => {
      const dx = x - X, dy = y - Y;
      return [dx * co + dy * si, -dx * si + dy * co] as const;
    };
    const inside = (x: number, y: number) => {
      const [u, v] = loc(x, y);
      return (u * u) / (a * a) + (v * v) / (b * b) <= 1 && (u * u) / (ai * ai) + (v * v) / (bi * bi) > 1;
    };
    let light: LightFn, idx = -1;
    if (mode === 'tube') {
      const avg = (a + b) / 2;
      const mid = 1 - ts / avg / 2, half = ts / avg / 2;
      light = (x, y) => {
        const [u, v] = loc(x, y);
        const e = Math.sqrt((u * u) / (a * a) + (v * v) / (b * b));
        const p = Math.max(-1, Math.min(1, (e - mid) / half));
        const dx = x - X, dy = y - Y, dl = Math.hypot(dx, dy) || 1;
        return sphereL((dx / dl) * p, (dy / dl) * p);
      };
    } else [light, idx] = this.resolve(mode, X - R, Y - R, X + R, Y + R);
    this.shape(X - R, Y - R, X + R, Y + R, inside, paint, light, idx);
  }

  poly(pts: readonly number[], paint: Paint, mode: Mode = 'diag'): void {
    const n = pts.length / 2;
    const P: number[] = [];
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    for (let i = 0; i < n; i++) {
      const x = this.X(pts[i * 2] as number), y = this.Y(pts[i * 2 + 1] as number);
      P.push(x, y);
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x);
      by0 = Math.min(by0, y); by1 = Math.max(by1, y);
    }
    const inside = (x: number, y: number) => {
      let c = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = P[i * 2] as number, yi = P[i * 2 + 1] as number;
        const xj = P[j * 2] as number, yj = P[j * 2 + 1] as number;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const [l, i] = this.resolve(mode, bx0, by0, bx1, by1);
    this.shape(bx0, by0, bx1, by1, inside, paint, l, i);
  }

  /** Capsule (thick segment, round caps), optionally tapered r0 -> r1. Tube-shaded by default. */
  cap(x0: number, y0: number, x1: number, y1: number, r0: number, paint: Paint, mode: Mode = 'tube', r1 = r0): void {
    const ax = this.X(x0), ay = this.Y(y0), bx = this.X(x1), by = this.Y(y1);
    const ra = r0 * this.s, rb = r1 * this.s;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-6;
    const near = (x: number, y: number) => {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      return [ax + dx * t, ay + dy * t, ra + (rb - ra) * t] as const;
    };
    const inside = (x: number, y: number) => {
      const [px, py, r] = near(x, y);
      return (x - px) ** 2 + (y - py) ** 2 <= r * r;
    };
    const R = Math.max(ra, rb);
    const bx0 = Math.min(ax, bx) - R, bx1 = Math.max(ax, bx) + R, by0 = Math.min(ay, by) - R, by1 = Math.max(ay, by) + R;
    let light: LightFn, idx = -1;
    if (mode === 'tube') {
      light = (x, y) => {
        const [px, py, r] = near(x, y);
        return sphereL((x - px) / r, (y - py) / r);
      };
    } else [light, idx] = this.resolve(mode, bx0, by0, bx1, by1);
    this.shape(bx0, by0, bx1, by1, inside, paint, light, idx);
  }

  /** Tube along a polyline with radius interpolated r0 -> r1. */
  path(pts: readonly number[], r0: number, r1: number, paint: Paint, mode: Mode = 'tube'): void {
    const n = pts.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const ta = i / (n - 1), tb = (i + 1) / (n - 1);
      this.cap(pts[i * 2] as number, pts[i * 2 + 1] as number, pts[i * 2 + 2] as number, pts[i * 2 + 3] as number, r0 + (r1 - r0) * ta, paint, mode, r0 + (r1 - r0) * tb);
    }
  }

  /** 1px Bresenham line in a solid color. */
  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    let ax = Math.floor(this.X(x0)), ay = Math.floor(this.Y(y0));
    const bx = Math.floor(this.X(x1)), by = Math.floor(this.Y(y1));
    const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 1000; guard++) {
      this.put(ax, ay, c);
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; ax += sx; }
      if (e2 <= dx) { err += dx; ay += sy; }
    }
  }

  /** 1px polyline. */
  lines(pts: readonly number[], c: number): void {
    for (let i = 0; i + 3 < pts.length; i += 2) this.line(pts[i] as number, pts[i + 1] as number, pts[i + 2] as number, pts[i + 3] as number, c);
  }

  /** Small 4-point sparkle. */
  spark(x: number, y: number, c: number, big = false): void {
    this.px(x, y, c);
    this.px(x - 1, y, c); this.px(x + 1, y, c); this.px(x, y - 1, c); this.px(x, y + 1, c);
    if (big) { this.px(x - 2, y, c); this.px(x + 2, y, c); this.px(x, y - 2, c); this.px(x, y + 2, c); }
  }

  /** Run fn with a temporary clip predicate (logical coords). */
  clipped(pred: (x: number, y: number) => boolean, fn: () => void): void {
    const prev = this.clip;
    const s = this.s, ox = this.ox, oy = this.oy;
    this.clip = (x, y) => (prev ? prev(x, y) : true) && pred((x - 64 - ox) / s + 64, (y - 64 - oy) / s + 64);
    fn();
    this.clip = prev;
  }

  /** Run fn with a temporary scale/offset transform (nested). */
  scaled(s: number, cx: number, cy: number, fn: () => void): void {
    const ps = this.s, pox = this.ox, poy = this.oy;
    // logical point (64,64) of the inner drawer maps to logical (cx,cy) of the outer one
    const ncx = this.X(cx), ncy = this.Y(cy);
    this.s = ps * s;
    this.ox = ncx - 64;
    this.oy = ncy - 64;
    fn();
    this.s = ps; this.ox = pox; this.oy = poy;
  }
}

/** 1px outline (4-neighbour) around every filled pixel. */
export function outline(src: Int32Array, color = OUT): Int32Array {
  const o = new Int32Array(src);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (src[i] !== -1) continue;
      if ((x > 0 && src[i - 1] !== -1) || (x < W - 1 && src[i + 1] !== -1) || (y > 0 && src[i - W] !== -1) || (y < H - 1 && src[i + W] !== -1)) o[i] = color;
    }
  }
  return o;
}

/** Separable box blur, in place, radius r. */
export function boxBlur(a: Float32Array, r: number): void {
  const tmp = new Float32Array(N);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += a[y * W + Math.max(0, Math.min(W - 1, x))] as number;
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc * inv;
      acc += (a[y * W + Math.min(W - 1, x + r + 1)] as number) - (a[y * W + Math.max(0, x - r)] as number);
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.max(0, Math.min(H - 1, y)) * W + x] as number;
    for (let y = 0; y < H; y++) {
      a[y * W + x] = acc * inv;
      acc += (tmp[Math.min(H - 1, y + r + 1) * W + x] as number) - (tmp[Math.max(0, y - r) * W + x] as number);
    }
  }
}
