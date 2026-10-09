// Offline DSP toolkit for Dark Realm audio: everything is synthesized here, no samples.
// Mono note renderers return Float32Array; Mix places them on a stereo bus with reverb sends.

export const SR = 44100;
export const TAU = Math.PI * 2;

export function rng(seed = 1) {
  let x = (seed * 2654435761) >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'D#4' -> 63 */
export function nm(s) {
  if (typeof s === 'number') return s;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  if (!m) throw new Error('bad note ' + s);
  return NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}
export const hz = (s) => mtof(nm(s));
export const len = (sec) => Math.max(1, Math.round(sec * SR));
export const dbToGain = (db) => 10 ** (db / 20);

export class Biquad {
  constructor(type, f, q = 0.707, db = 0) {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(type, f, q, db);
  }
  set(type, f, q = 0.707, db = 0) {
    const w = (TAU * Math.min(Math.max(f, 5), SR * 0.49)) / SR;
    const cs = Math.cos(w), sn = Math.sin(w), a = sn / (2 * q), A = 10 ** (db / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lp': b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + a; a1 = -2 * cs; a2 = 1 - a; break;
      case 'hp': b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + a; a1 = -2 * cs; a2 = 1 - a; break;
      case 'bp': b0 = a; b1 = 0; b2 = -a; a0 = 1 + a; a1 = -2 * cs; a2 = 1 - a; break;
      case 'notch': b0 = 1; b1 = -2 * cs; b2 = 1; a0 = 1 + a; a1 = -2 * cs; a2 = 1 - a; break;
      case 'peak': b0 = 1 + a * A; b1 = -2 * cs; b2 = 1 - a * A; a0 = 1 + a / A; a1 = -2 * cs; a2 = 1 - a / A; break;
      case 'ls': {
        const s2 = 2 * Math.sqrt(A) * a;
        b0 = A * (A + 1 - (A - 1) * cs + s2); b1 = 2 * A * (A - 1 - (A + 1) * cs); b2 = A * (A + 1 - (A - 1) * cs - s2);
        a0 = A + 1 + (A - 1) * cs + s2; a1 = -2 * (A - 1 + (A + 1) * cs); a2 = A + 1 + (A - 1) * cs - s2; break;
      }
      case 'hs': {
        const s2 = 2 * Math.sqrt(A) * a;
        b0 = A * (A + 1 + (A - 1) * cs + s2); b1 = -2 * A * (A - 1 + (A + 1) * cs); b2 = A * (A + 1 + (A - 1) * cs - s2);
        a0 = A + 1 - (A - 1) * cs + s2; a1 = 2 * (A - 1 - (A + 1) * cs); a2 = A + 1 - (A - 1) * cs - s2; break;
      }
      default: throw new Error(type);
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  p(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
  run(b) { for (let i = 0; i < b.length; i++) b[i] = this.p(b[i]); return b; }
}

/** Chain of biquads given as [type, f, q, db] tuples, applied in place. */
export function eq(buf, ...bands) {
  for (const [t, f, q, db] of bands) new Biquad(t, f, q, db).run(buf);
  return buf;
}

/** Zero-delay-feedback state variable filter; cheap to modulate per sample. */
export class SVF {
  constructor(f = 1000, q = 0.707) { this.ic1 = 0; this.ic2 = 0; this.set(f, q); }
  set(f, q = this.q) {
    this.q = q;
    const g = Math.tan((Math.PI * Math.min(Math.max(f, 10), SR * 0.45)) / SR);
    this.k = 1 / q; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  p(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    this.bp = v1; this.hp = x - this.k * v1 - v2;
    return (this.lp = v2);
  }
}

function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** Band-limited oscillator with a per-sample frequency function. */
export class Osc {
  constructor(type = 'saw', phase = 0) { this.type = type; this.ph = phase; }
  p(f) {
    const dt = f / SR;
    let p = this.ph, y;
    switch (this.type) {
      case 'sine': y = Math.sin(TAU * p); break;
      case 'saw': y = 2 * p - 1 - blep(p, dt); break;
      case 'square': {
        let q = p + 0.5; if (q >= 1) q -= 1;
        y = (2 * p - 1 - blep(p, dt)) - (2 * q - 1 - blep(q, dt));
        break;
      }
      case 'tri': y = 1 - 4 * Math.abs(p - 0.5); break;
    }
    p += dt; if (p >= 1) p -= 1;
    this.ph = p;
    return y;
  }
}

/** Exponential-ish ADSR over n samples; release starts at `gate` seconds. */
export function adsr(n, { a = 0.01, d = 0.1, s = 0.7, r = 0.3, gate, curve = 3 } = {}) {
  const out = new Float32Array(n);
  const g = gate ?? n / SR - r;
  const A = a * SR, D = d * SR, G = g * SR, R = r * SR;
  let lvl = 0;
  for (let i = 0; i < n; i++) {
    if (i < G) {
      if (i < A) lvl = (i / A) ** (curve > 1 ? 1.4 : 1);
      else if (i < A + D) lvl = s + (1 - s) * Math.exp((-curve * (i - A)) / D);
      else lvl = s + (1 - s) * Math.exp(-curve);
      out[i] = lvl;
    } else {
      const k = (i - G) / R;
      out[i] = k >= 1 ? 0 : out[Math.max(0, Math.floor(G) - 1)] * Math.exp(-curve * 1.6 * k) * (1 - k);
    }
  }
  return out;
}

export function noiseBuf(n, seed = 7) {
  const r = rng(seed), b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = r() * 2 - 1;
  return b;
}

export function softclip(buf, drive = 1) {
  const k = Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * drive) / k;
  return buf;
}

export function mul(buf, env) { for (let i = 0; i < buf.length; i++) buf[i] *= env[i] ?? 0; return buf; }
export function gain(buf, g) { for (let i = 0; i < buf.length; i++) buf[i] *= g; return buf; }
export function addInto(dst, src, at = 0, g = 1) {
  const o = Math.round(at);
  for (let i = 0; i < src.length; i++) { const j = i + o; if (j >= 0 && j < dst.length) dst[j] += src[i] * g; }
  return dst;
}
export function fadeOut(buf, sec = 0.02) {
  const n = Math.min(buf.length, len(sec));
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i] *= i / n;
  return buf;
}
export function fadeIn(buf, sec = 0.005) {
  const n = Math.min(buf.length, len(sec));
  for (let i = 0; i < n; i++) buf[i] *= i / n;
  return buf;
}
export function reverse(buf) { return Float32Array.from(buf).reverse(); }

/** Linear ramp / exponential glide helpers that return a function of time (s). */
export const ramp = (pts) => (t) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return pts[pts.length - 1][1];
};
export const expRamp = (pts) => (t) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
      return v0 * (v1 / v0) ** ((t - t0) / (t1 - t0));
    }
  }
  return pts[pts.length - 1][1];
};

// ---------------------------------------------------------------- reverb

class Allpass {
  constructor(n, g) { this.b = new Float32Array(n); this.i = 0; this.g = g; }
  p(x) {
    const d = this.b[this.i];
    const v = x + this.g * d;
    this.b[this.i] = v;
    this.i = (this.i + 1) % this.b.length;
    return d - this.g * v;
  }
}

/** 8-line feedback delay network with input diffusion and modulated lines. Returns the wet signal only. */
export function reverb(inL, inR, { rt60 = 3, damp = 6000, size = 1, pre = 0.02, low = 120, seed = 3 } = {}) {
  const n = inL.length;
  const L = new Float32Array(n), R = new Float32Array(n);
  const base = [1931, 2213, 2437, 2687, 2909, 3163, 3407, 3631].map((d) => Math.round(d * size));
  const lines = base.map((d) => new Float32Array(d + 64));
  const idx = base.map(() => 0);
  const gains = base.map((d) => 10 ** ((-3 * d) / (rt60 * SR)));
  const lp = base.map(() => 0);
  const dc = Math.exp((-TAU * damp) / SR);
  const r = rng(seed);
  const lfoRate = base.map(() => 0.1 + r() * 0.5), lfoPh = base.map(() => r() * TAU);
  const difL = [142, 107, 379, 277].map((d) => new Allpass(Math.round(d * size), 0.7));
  const difR = [151, 113, 397, 263].map((d) => new Allpass(Math.round(d * size), 0.7));
  const preN = len(pre);
  const hpL = new Biquad('hp', low, 0.7), hpR = new Biquad('hp', low, 0.7);
  const y = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    let xl = i >= preN ? inL[i - preN] : 0;
    let xr = i >= preN ? inR[i - preN] : 0;
    xl = hpL.p(xl); xr = hpR.p(xr);
    for (const a of difL) xl = a.p(xl);
    for (const a of difR) xr = a.p(xr);
    let sum = 0;
    for (let k = 0; k < 8; k++) {
      const buf = lines[k], N = buf.length;
      const mod = 6 * Math.sin(lfoPh[k] + (TAU * lfoRate[k] * i) / SR) + 8;
      const pos = idx[k] - base[k] - mod + 64;
      let p = Math.floor(pos), f = pos - p;
      p = ((p % N) + N) % N;
      const a = buf[p], b = buf[(p + 1) % N];
      let v = a + (b - a) * f;
      lp[k] = v * (1 - dc) + lp[k] * dc;
      v = lp[k] * gains[k];
      y[k] = v; sum += v;
    }
    const h = (2 / 8) * sum;
    for (let k = 0; k < 8; k++) {
      const buf = lines[k];
      const inp = k < 4 ? xl : xr;
      buf[idx[k]] = y[k] - h + inp * 0.35;
      idx[k] = (idx[k] + 1) % buf.length;
    }
    L[i] = y[0] - y[2] + y[4] - y[6] + 0.5 * (y[1] - y[5]);
    R[i] = y[1] - y[3] + y[5] - y[7] + 0.5 * (y[2] - y[6]);
  }
  return [L, R];
}

// ---------------------------------------------------------------- mixing

/** Stereo bus with named reverb sends. */
export class Mix {
  constructor(sec, reverbs = {}) {
    this.n = len(sec);
    this.L = new Float32Array(this.n);
    this.R = new Float32Array(this.n);
    this.sends = {};
    this.reverbs = reverbs;
    for (const k of Object.keys(reverbs)) this.sends[k] = [new Float32Array(this.n), new Float32Array(this.n)];
  }
  /** Place a mono buffer at time t (s). pan -1..1, send = {name: amount}. */
  add(buf, t, g = 1, pan = 0, send = {}) {
    const o = Math.round(t * SR);
    const gl = g * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
    const gr = g * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
    const targets = [[this.L, this.R, 1]];
    for (const [k, amt] of Object.entries(send)) if (amt && this.sends[k]) targets.push([...this.sends[k], amt]);
    for (const [l, r, a] of targets) {
      for (let i = 0; i < buf.length; i++) {
        const j = i + o;
        if (j < 0) continue;
        if (j >= this.n) break;
        const v = buf[i] * a;
        l[j] += v * gl; r[j] += v * gr;
      }
    }
  }
  /** Add an already-stereo pair. */
  add2(l, r, t, g = 1, send = {}) {
    const o = Math.round(t * SR);
    const targets = [[this.L, this.R, 1]];
    for (const [k, amt] of Object.entries(send)) if (amt && this.sends[k]) targets.push([...this.sends[k], amt]);
    for (const [L, R, a] of targets) {
      for (let i = 0; i < l.length; i++) {
        const j = i + o;
        if (j < 0) continue;
        if (j >= this.n) break;
        L[j] += l[i] * g * a; R[j] += r[i] * g * a;
      }
    }
  }
  render() {
    const L = Float32Array.from(this.L), R = Float32Array.from(this.R);
    for (const [k, opts] of Object.entries(this.reverbs)) {
      const [sl, sr] = this.sends[k];
      const [wl, wr] = reverb(sl, sr, opts);
      const g = opts.gain ?? 1;
      for (let i = 0; i < this.n; i++) { L[i] += wl[i] * g; R[i] += wr[i] * g; }
    }
    return [L, R];
  }
}

/** Fold everything after `loopSec` back onto the start, so the file loops without a seam. */
export function foldLoop([L, R], loopSec) {
  const n = len(loopSec);
  const l = L.slice(0, n), r = R.slice(0, n);
  for (let i = n; i < L.length; i++) { l[(i - n) % n] += L[i]; r[(i - n) % n] += R[i]; }
  return [l, r];
}

/** Look-ahead peak limiter on a stereo pair. */
export function limit([L, R], ceiling = 0.89, releaseSec = 0.12, lookSec = 0.004) {
  const n = L.length, look = len(lookSec), rel = Math.exp(-1 / (releaseSec * SR));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pk = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    need[i] = pk > ceiling ? ceiling / pk : 1;
  }
  // Minimum over the look-ahead window, then smooth release.
  const g = new Float32Array(n);
  let cur = 1;
  for (let i = 0; i < n; i++) {
    let m = 1;
    for (let k = 0; k <= look && i + k < n; k += 4) m = Math.min(m, need[i + k]);
    if (i + look < n) m = Math.min(m, need[i + look]);
    cur = m < cur ? cur + (m - cur) * 0.5 : m + (cur - m) * rel;
    g[i] = cur;
  }
  for (let i = 0; i < n; i++) { L[i] *= g[i]; R[i] *= g[i]; }
  return [L, R];
}

export function peak([L, R]) {
  let p = 0;
  for (let i = 0; i < L.length; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
  return p;
}

export function scale([L, R], g) { gain(L, g); gain(R, g); return [L, R]; }

/** Rough loudness: K-ish weighted RMS in dB over the loudest window. */
export function loudness([L, R], winSec = 0.4) {
  const w = (b) => eq(Float32Array.from(b), ['hp', 60, 0.5], ['hs', 1500, 0.7, 4]);
  const l = w(L), r = w(R);
  const win = Math.min(len(winSec), l.length);
  let s = 0, best = 0;
  for (let i = 0; i < l.length; i++) {
    s += l[i] * l[i] + r[i] * r[i];
    if (i >= win) s -= l[i - win] ** 2 + r[i - win] ** 2;
    if (i >= win - 1) best = Math.max(best, s);
  }
  return 10 * Math.log10(best / win / 2 + 1e-12);
}

export function writeWav(path, [L, R], fs) {
  const n = L.length, data = Buffer.alloc(n * 8);
  for (let i = 0; i < n; i++) { data.writeFloatLE(L[i], i * 8); data.writeFloatLE(R[i], i * 8 + 4); }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 8, 28); h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path, Buffer.concat([h, data]));
}

/** Equal-power fade in over `fin` s and out over the last `fout` s; overlapping notes cross-fade without a dip. */
export const xfade = (fin, fout = fin) => (n) => {
  const out = new Float32Array(n), a = len(fin), b = len(fout);
  for (let i = 0; i < n; i++) {
    let g = 1;
    if (i < a) g *= Math.sin((Math.PI / 2) * (i / a));
    if (i > n - b) g *= Math.sin((Math.PI / 2) * ((n - i) / b));
    out[i] = g;
  }
  return out;
};

/** Like foldLoop, but the loop starts `startSec` into the render (so notes may begin before it). */
export function foldLoopAt([L, R], startSec, loopSec) {
  const n = len(loopSec), s = len(startSec);
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < L.length; i++) {
    const j = (((i - s) % n) + n) % n;
    l[j] += L[i]; r[j] += R[i];
  }
  return [l, r];
}
