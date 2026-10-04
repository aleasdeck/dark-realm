/** Colors are packed 0xRRGGBB integers. */

export const OUT = 0x07050b; // outline
export const SHADOW_T = 0x0c0618; // purple-black, shadows drift toward it
export const LIGHT_T = 0xfff0d0; // warm white, highlights drift toward it

export function hex(s: string): number {
  let h = s.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(v) ? v : 0x808080;
}

export function toHex(c: number): string {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
}

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export function luma(c: number): number {
  return (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;
}

function rgbToHsl(c: number): [number, number, number] {
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const dd = mx - mn;
  const s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
  let h: number;
  if (mx === r) h = (g - b) / dd + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / dd + 2;
  else h = (r - g) / dd + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): number {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const f = (v: number) => Math.max(0, Math.min(255, Math.round((v + m) * 255)));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

export function shiftHue(c: number, deg: number, satMul = 1, lightAdd = 0): number {
  const [h, s, l] = rgbToHsl(c);
  return hslToRgb(h + deg, Math.min(1, s * satMul), Math.max(0, Math.min(1, l + lightAdd)));
}

/** Build a dark->light ramp around a base color (hue-shifted shadows/highlights). */
export function makeRamp(base: number, n = 4): number[] {
  if (n === 5) {
    return [
      mix(base, SHADOW_T, 0.68),
      mix(base, SHADOW_T, 0.38),
      base,
      mix(base, LIGHT_T, 0.35),
      mix(base, LIGHT_T, 0.72),
    ];
  }
  return [mix(base, SHADOW_T, 0.62), mix(base, SHADOW_T, 0.3), base, mix(base, LIGHT_T, 0.4)];
}
