/** Compositing: background + glow aura + outlined subject + fx + vignette -> RGBA bytes. */
import { mix } from './color';
import { bayer, boxBlur, Draw, H, N, outline, W } from './pixel';

export type ComposeOpts = { glow: number; glowStrength?: number; vignette?: boolean };

export function compose(bg: Int32Array, d: Draw, opt: ComposeOpts): Uint8ClampedArray {
  const body = outline(d.main.data);
  if (d.fade) {
    const [y0, y1] = d.fade;
    for (let y = Math.max(0, y0); y < H; y++) {
      const t = Math.min(1, (y - y0) / Math.max(1, y1 - y0));
      for (let x = 0; x < W; x++) if (t > bayer(x, y) * 0.999) body[y * W + x] = -1;
    }
  }
  const fx = d.fx.data, back = d.back.data;
  // glow aura from silhouette + emissive fx
  const mask = new Float32Array(N);
  for (let i = 0; i < N; i++) mask[i] = (body[i] !== -1 ? 0.75 : 0) + (fx[i] !== -1 ? 0.6 : 0);
  boxBlur(mask, 4);
  boxBlur(mask, 4);
  const gs = opt.glowStrength ?? 1;
  const out = new Int32Array(bg);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (out[i] === -1) continue;
      const a = (mask[i] as number) * gs;
      if (a < 0.03) continue;
      const lv = Math.floor(Math.min(1, a * 1.5) * 3 + bayer(x, y) - 0.35);
      if (lv > 0) out[i] = mix(out[i] as number, opt.glow, Math.min(3, lv) * 0.12);
    }
  }
  for (let i = 0; i < N; i++) {
    if (back[i] !== -1) out[i] = back[i] as number;
    if (body[i] !== -1) out[i] = body[i] as number;
    if (fx[i] !== -1) out[i] = fx[i] as number;
  }
  if (opt.vignette !== false) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (out[i] === -1) continue;
        const dd = Math.hypot((x + 0.5 - 64) / 64, (y + 0.5 - 64) / 64);
        const lv = Math.floor((dd - 0.92) * 6 + bayer(x, y));
        if (lv > 0) out[i] = mix(out[i] as number, 0x030206, Math.min(3, lv) * 0.22);
      }
    }
  }
  const px = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const c = out[i] as number;
    if (c === -1) continue;
    px[i * 4] = (c >> 16) & 255;
    px[i * 4 + 1] = (c >> 8) & 255;
    px[i * 4 + 2] = c & 255;
    px[i * 4 + 3] = 255;
  }
  return px;
}
