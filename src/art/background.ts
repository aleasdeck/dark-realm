/** Seeded dark-fantasy backdrops: dithered gradient, stars, moon, fog, ground silhouettes. */
import { mix } from './color';
import { bayer, H, N, W } from './pixel';
import type { Rng } from './rng';

export type BgColors = { bg1: number; bg2: number; accent: number; glow: number };
export type BgOpts = { moon?: 'auto' | 'never' | 'always'; ground?: boolean; fog?: boolean };

export function background(p: BgColors, r: Rng, opt: BgOpts = {}): Int32Array {
  const o = new Int32Array(N);
  // 1. vertical gradient, bayer-dithered between 10 steps
  const steps = 10;
  const tones: number[] = [];
  for (let k = 0; k <= steps; k++) tones.push(mix(p.bg1, p.bg2, k / steps));
  for (let y = 0; y < H; y++) {
    const v = (y / (H - 1)) * steps;
    const i = Math.floor(v), f = v - i;
    for (let x = 0; x < W; x++) {
      o[y * W + x] = tones[Math.min(steps, f > bayer(x, y) ? i + 1 : i)] as number;
    }
  }
  // 2. soft dithered radial light behind the subject
  const cy = 58 + r.int(-4, 4);
  const halo = mix(p.bg2, p.glow, 0.5);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - 64, (y - cy) * 1.1) / 62;
      const lv = (1 - d) * 3 + bayer(x, y) - 0.5;
      if (lv >= 1) o[y * W + x] = mix(o[y * W + x] as number, halo, Math.min(3, Math.floor(lv)) * 0.07);
    }
  }
  const set = (x: number, y: number, c: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) o[y * W + x] = c;
  };
  const get = (x: number, y: number) => o[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))] as number;

  // 3. stars
  const starC = mix(0xffffff, p.glow, 0.3);
  const ns = r.int(14, 30);
  for (let i = 0; i < ns; i++) {
    const x = r.int(2, W - 3), y = r.int(2, 70);
    const b = r.range(0.25, 0.95);
    const c = mix(get(x, y), starC, b);
    set(x, y, c);
    if (r.chance(0.12)) {
      const c2 = mix(get(x, y), starC, b * 0.5);
      set(x - 1, y, c2); set(x + 1, y, c2); set(x, y - 1, c2); set(x, y + 1, c2);
    }
  }

  // 4. moon
  const moonMode = opt.moon ?? 'auto';
  if (moonMode === 'always' || (moonMode === 'auto' && r.chance(0.45))) {
    const mr = r.int(7, 11);
    const mx = r.chance(0.5) ? r.int(14, 26) : r.int(102, 114);
    const my = r.int(13, 24);
    const moonC = mix(0xf2ecd6, p.glow, 0.22);
    const crescent = r.chance(0.6);
    const sx = mr * r.range(0.35, 0.6) * (mx < 64 ? 1 : -1), sy = -mr * 0.25;
    for (let y = my - mr - 5; y <= my + mr + 5; y++) {
      for (let x = mx - mr - 5; x <= mx + mr + 5; x++) {
        const d = Math.hypot(x + 0.5 - mx, y + 0.5 - my);
        if (d <= mr) {
          if (crescent && Math.hypot(x + 0.5 - mx - sx, y + 0.5 - my - sy) < mr * 0.92) continue;
          const nx = (x + 0.5 - mx) / mr, ny = (y + 0.5 - my) / mr;
          const l = 0.6 - 0.35 * nx - 0.35 * ny;
          const t = l > 0.75 ? 0 : l > 0.45 + (bayer(x, y) - 0.5) * 0.2 ? 0.12 : 0.3;
          set(x, y, mix(moonC, p.bg1, t));
        } else if (d <= mr + 4 && !crescent) {
          const lv = (1 - (d - mr) / 4) * 2 + bayer(x, y) - 0.5;
          if (lv >= 1) set(x, y, mix(get(x, y), moonC, 0.12 * Math.floor(lv)));
        }
      }
    }
    // craters
    if (!crescent) {
      for (let k = 0; k < 3; k++) {
        const cx = mx + r.int(-mr + 3, mr - 3), cyy = my + r.int(-mr + 3, mr - 3);
        set(cx, cyy, mix(moonC, p.bg1, 0.35));
        set(cx + 1, cyy, mix(moonC, p.bg1, 0.25));
      }
    }
  }

  // 5. fog bands
  if (opt.fog !== false) {
    const fogC = mix(mix(p.bg2, 0xc8c0d8, 0.45), p.glow, 0.2);
    const nf = r.int(1, 3);
    for (let k = 0; k < nf; k++) {
      const fy = r.int(48, 104), th = r.int(3, 7), fr = r.range(0.04, 0.09), ph = r.range(0, 6.28), amp = r.range(1, 4);
      for (let x = 0; x < W; x++) {
        const c = fy + Math.sin(x * fr + ph) * amp;
        for (let y = Math.floor(c - th); y <= Math.ceil(c + th); y++) {
          const dens = 1 - Math.abs(y - c) / th;
          if (dens * 0.85 > bayer(x, y)) set(x, y, mix(get(x, y), fogC, 0.16));
        }
      }
    }
  }

  // 6. ground silhouette + props
  if (opt.ground !== false) {
    const gC = mix(p.bg2, 0x050308, 0.72);
    const rim = mix(gC, p.glow, 0.25);
    const base = r.int(104, 110);
    const p1 = r.range(0, 6.28), p2 = r.range(0, 6.28), f1 = r.range(0.03, 0.06), f2 = r.range(0.1, 0.2);
    const hgt: number[] = [];
    for (let x = 0; x < W; x++) {
      const h = Math.round(base + Math.sin(x * f1 + p1) * 3 + Math.sin(x * f2 + p2) * 1.2);
      hgt.push(h);
      for (let y = h; y < H; y++) set(x, y, y === h ? rim : gC);
    }
    const prop = r.int(0, 3);
    const left = r.chance(0.5);
    const px = left ? r.int(6, 18) : r.int(110, 122);
    const gy = hgt[px] as number;
    if (prop === 1) {
      // dead tree
      const th = r.int(28, 40);
      for (let y = gy - th; y < gy; y++) { set(px, y, gC); set(px + 1, y, gC); if (y > gy - 6) set(px - 1, y, gC); if (y > gy - 4) set(px + 2, y, gC); }
      for (let b = 0; b < 4; b++) {
        const by = gy - th + 4 + b * 6;
        const dir = b % 2 ? 1 : -1;
        const len = r.int(5, 10);
        for (let i = 0; i < len; i++) set(px + dir * i + (dir > 0 ? 1 : 0), by - Math.floor(i * 0.6), gC);
      }
    } else if (prop === 2) {
      // gravestones / cross
      for (let g = 0; g < 2; g++) {
        const gx = px + (left ? g * 9 : -g * 9);
        const gyy = hgt[Math.max(0, Math.min(W - 1, gx))] as number;
        if (g === 0) {
          for (let y = gyy - 12; y < gyy; y++) set(gx, y, gC);
          for (let x = gx - 3; x <= gx + 3; x++) set(x, gyy - 9, gC);
        } else {
          for (let y = gyy - 8; y < gyy; y++) for (let x = gx - 3; x <= gx + 3; x++) if (!(y === gyy - 8 && Math.abs(x - gx) === 3)) set(x, y, gC);
        }
      }
    } else if (prop === 3) {
      // spiked fence
      for (let x = 0; x < W; x += 6) {
        const fx = x + (left ? 0 : 0);
        if (left ? fx > 34 : fx < 94) continue;
        const gyy = hgt[fx] as number;
        for (let y = gyy - 10; y < gyy; y++) set(fx, y, gC);
        set(fx, gyy - 11, gC);
      }
      for (let x = left ? 0 : 92; x < (left ? 36 : W); x++) set(x, (hgt[x] as number) - 7, gC);
    }
  }

  // 7. embers
  const ne = r.int(0, 7);
  for (let i = 0; i < ne; i++) {
    const x = r.int(4, W - 5), y = r.int(60, 118);
    set(x, y, mix(get(x, y), p.glow, r.range(0.5, 0.9)));
  }
  return o;
}
