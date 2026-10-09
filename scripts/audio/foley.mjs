// Physical-ish foley: excitations (strikes, friction, rustle) driving modal resonators of real materials.
// Dense, randomised inharmonic modes and noisy excitations are what keep these from sounding like chiptune.
import { SR, TAU, Biquad, rng, len, eq, gain, noiseBuf, fadeOut } from './dsp.mjs';

/** Material presets: frequency range of the modes, their decay range (s) and how many. */
const MATERIALS = {
  table: { lo: 85, hi: 2600, n: 16, tLo: 0.025, tHi: 0.16, tilt: 0.55 },
  wood: { lo: 220, hi: 4200, n: 14, tLo: 0.012, tHi: 0.06, tilt: 0.45 },
  card: { lo: 700, hi: 7000, n: 10, tLo: 0.004, tHi: 0.015, tilt: 0.3 },
  leather: { lo: 250, hi: 1800, n: 8, tLo: 0.008, tHi: 0.025, tilt: 0.4 },
  coin: { lo: 2300, hi: 13000, n: 18, tLo: 0.08, tHi: 0.55, tilt: 0.2 },
  pewter: { lo: 480, hi: 7000, n: 20, tLo: 0.06, tHi: 0.45, tilt: 0.35 },
  blade: { lo: 750, hi: 10000, n: 22, tLo: 0.35, tHi: 1.6, tilt: 0.3 },
  iron: { lo: 160, hi: 5200, n: 24, tLo: 0.08, tHi: 0.7, tilt: 0.45 },
  chain: { lo: 1600, hi: 11000, n: 8, tLo: 0.02, tHi: 0.09, tilt: 0.2 },
  glass: { lo: 1200, hi: 9000, n: 8, tLo: 0.15, tHi: 0.8, tilt: 0.3 },
};

/** Random but reproducible modes for one object of a material. `scale` shifts it lower (bigger) or higher. */
export function modes(material, seed = 1, scale = 1) {
  const M = MATERIALS[material], r = rng(seed * 7919 + material.length);
  const out = [];
  for (let k = 0; k < M.n; k++) {
    const u = r();
    const f = M.lo * (M.hi / M.lo) ** u * scale;
    // Low modes ring longest; each mode gets its own random spread.
    const tau = (M.tLo + (M.tHi - M.tLo) * (1 - u) ** 1.3) * (0.6 + 0.8 * r());
    const a = (0.4 + r()) * (M.lo / f) ** M.tilt;
    out.push({ f, tau, a });
  }
  return out;
}

/** Runs an excitation through a bank of two-pole resonators. */
export function resonate(ex, ms, dur) {
  const n = len(dur), out = new Float32Array(n);
  for (const { f, tau, a } of ms) {
    if (f > SR * 0.45) continue;
    const r = Math.exp(-1 / (tau * SR)), c = 2 * r * Math.cos((TAU * f) / SR), r2 = r * r;
    const g = a * Math.sin((TAU * f) / SR) * 0.05;
    let y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const x = i < ex.length ? ex[i] : 0;
      const y = c * y1 - r2 * y2 + x;
      y2 = y1; y1 = y;
      out[i] += y * g;
      if (i > ex.length && i % 512 === 0 && Math.abs(y1) + Math.abs(y2) < 1e-7) break;
    }
  }
  return out;
}

/** A strike: short noise burst; `hard` from 0 (felt) to 1 (metal on metal). */
export function strike(hard = 0.5, seed = 1, ms = 1 + (1 - hard) * 5) {
  const n = len(ms / 1000) + 1, b = noiseBuf(n, seed);
  const lp = new Biquad('lp', 800 + hard * 12000, 0.6);
  for (let i = 0; i < n; i++) b[i] = lp.p(b[i] * Math.exp(-i / (n / 3)));
  b[0] += hard * 2;
  return b;
}

/** Stick-slip friction: an impulse train whose rate and level follow functions of k (0..1). */
export function friction(dur, { rate = (k) => 400, level = (k) => 1, jitter = 0.5, seed = 2, grit = 0.3 } = {}) {
  const n = len(dur), out = new Float32Array(n), r = rng(seed), nb = noiseBuf(n, seed + 1);
  let next = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    if (i >= next) {
      out[i] += level(k) * (0.6 + 0.8 * r()) * (r() < 0.5 ? -1 : 1);
      next = i + (SR / Math.max(1, rate(k))) * (1 + (r() - 0.5) * jitter);
    }
    out[i] += nb[i] * grit * level(k) * 0.15;
  }
  return out;
}

/** Hit an object: excitation into its modes, plus a little of the raw contact noise. */
export function hit(material, { seed = 1, hard = 0.5, scale = 1, dur = 1.2, contact = 0.15 } = {}) {
  const ex = strike(hard, seed);
  const y = resonate(ex, modes(material, seed, scale), dur);
  for (let i = 0; i < ex.length; i++) y[i] += ex[i] * contact;
  fadeOut(y, 0.02);
  return y;
}

/** Several small bounces of the same object, e.g. a coin settling or a dropped tankard. */
export function bounces(material, { seed = 3, count = 5, gap = 0.09, shrink = 0.7, hard = 0.8, scale = 1, dur = 1.5, decay = 0.6 } = {}) {
  const n = len(dur), out = new Float32Array(n), r = rng(seed), ms = modes(material, seed, scale);
  let t = 0, a = 1, g = gap;
  for (let c = 0; c < count; c++) {
    const y = resonate(strike(hard, seed + c * 3), ms.map((m) => ({ ...m, a: m.a * (0.5 + r()) })), Math.max(0.05, dur - t));
    const o = len(t);
    for (let i = 0; i < y.length && o + i < n; i++) out[o + i] += y[i] * a;
    t += g * (0.7 + 0.6 * r());
    g *= shrink; a *= decay;
  }
  fadeOut(out, 0.02);
  return out;
}

/** Paper or cloth rustle: band-limited noise with a grainy, uneven envelope. */
export function rustle(dur, { lo = 1800, hi = 7000, grain = 60, seed = 4, env = (k) => Math.sin(Math.PI * k) } = {}) {
  const n = len(dur), nb = noiseBuf(n, seed), out = new Float32Array(n), r = rng(seed + 9);
  const hp = new Biquad('hp', lo, 0.7), lp = new Biquad('lp', hi, 0.7);
  let g = 0, target = 0;
  for (let i = 0; i < n; i++) {
    if (i % Math.round(SR / grain) === 0) target = r() ** 2;
    g += (target - g) * 0.004;
    out[i] = lp.p(hp.p(nb[i])) * g * env(i / n);
  }
  return gain(out, 2);
}

/** Muffled low thump of something heavy landing on wood. */
export function thump(dur = 0.4, { f = 70, seed = 5, depth = 1 } = {}) {
  const n = len(dur), out = new Float32Array(n), nb = noiseBuf(n, seed);
  const lp = new Biquad('lp', 220, 0.9), bp = new Biquad('bp', f, 2.5);
  for (let i = 0; i < n; i++) {
    const e = Math.exp(-i / SR / (0.05 * depth));
    out[i] = (lp.p(nb[i]) * 0.6 + bp.p(nb[i]) * 3) * e;
  }
  return gain(out, 2);
}

/** Wooden creak: slow stick-slip glide through a plank's modes. */
export function creak(dur = 0.7, { from = 45, to = 28, seed = 6, scale = 1 } = {}) {
  const ex = friction(dur, { rate: (k) => from + (to - from) * k, level: (k) => Math.sin(Math.PI * k) ** 0.6, jitter: 0.15, seed, grit: 0.2 });
  return eq(resonate(ex, modes('table', seed, scale), dur + 0.2), ['hp', 120, 0.7]);
}

/** Fire in a hearth: soft roar plus sparse sharp pops. */
export function fire(dur, { seed = 7, pops = 5 } = {}) {
  const n = len(dur), out = new Float32Array(n), r = rng(seed), nb = noiseBuf(n, seed);
  const lp = new Biquad('lp', 380, 0.7), hp = new Biquad('hp', 60, 0.7);
  let roar = 0.5;
  for (let i = 0; i < n; i++) {
    if (i % 2048 === 0) roar = 0.35 + 0.3 * r();
    out[i] = hp.p(lp.p(nb[i])) * roar * 1.5;
  }
  const popB = new Biquad('bp', 2500, 0.7);
  let next = 0;
  for (let i = 0; i < n; i++) {
    let x = 0;
    if (i >= next) {
      x = (r() - 0.5) * (r() < 0.15 ? 3 : 1);
      // Pops come in little clusters.
      next = i + (r() < 0.3 ? SR * 0.02 * r() : (SR / pops) * (0.3 + 1.4 * r()));
    }
    out[i] += popB.p(x) * 0.8;
  }
  return out;
}

// ---------------------------------------------------------------- coins

// Free-edge thin circular plate: mode ratios relative to the lowest (2,0) mode, and how well each radiates.
const PLATE = [[1, 1], [1.73, 0.45], [2.33, 0.8], [3.91, 0.4], [4.11, 0.7], [6.3, 0.55], [6.71, 0.35], [7.34, 0.3], [8.95, 0.35], [9.6, 0.2], [11.9, 0.2]];

/** Modes of one coin: each plate mode is a slightly split pair (a real coin is never perfectly round), so it shimmers. */
export function coinModes(seed = 1, { f0 = 3400, ring = 0.45 } = {}) {
  const r = rng(seed * 104729 + 17), out = [];
  const pos = r(); // where it was struck changes which modes speak
  PLATE.forEach(([ratio, rad], k) => {
    const f = f0 * ratio * (1 + (r() - 0.5) * 0.01);
    const a = rad * (0.25 + 0.75 * Math.abs(Math.sin((k + 1) * Math.PI * pos + r())));
    const tau = (ring * (0.6 + 0.6 * r())) / (1 + 0.22 * k);
    const split = 1 + 0.0015 + r() * 0.006;
    out.push({ f, tau, a }, { f: f * split, tau: tau * 0.9, a: a * (0.5 + 0.5 * r()) });
  });
  return out;
}

/** Metal-on-metal (or metal-on-wood) contact: a sub-millisecond click. */
function contact(seed, hard = 1) {
  const n = 12, b = noiseBuf(n, seed);
  for (let i = 0; i < n; i++) b[i] *= Math.exp(-i / (1.5 + (1 - hard) * 4));
  b[0] += 1.5 * hard;
  return b;
}

/**
 * One coin landing: a first impact that rings, then quick rebounds that each ring a little,
 * ending in the chattering wobble of a coin settling flat. `onWood` damps the ring.
 */
export function coinDrop(seed = 1, { f0 = 3400, onWood = 0.3, bounces: nb = 3, settle = true, dur = 1.2, ring = 0.45 } = {}) {
  const n = len(dur), r = rng(seed * 31 + 5);
  const ex = new Float32Array(n);
  const put = (t, a, s) => { const c = contact(s, 0.7 + 0.3 * a); const o = len(t); for (let i = 0; i < c.length && o + i < n; i++) ex[o + i] += c[i] * a; };
  let t = 0, a = 1, gap = 0.05 + r() * 0.04;
  put(0, 1, seed);
  for (let b = 0; b < nb; b++) {
    t += gap * (0.8 + 0.4 * r()); a *= 0.45 + 0.2 * r(); gap *= 0.62;
    put(t, a, seed + b + 1);
  }
  if (settle) {
    // Euler's-disk wobble: faster and fainter taps as the coin rolls flat.
    let rate = 25 + r() * 15, s = t + 0.03;
    for (let k = 0; k < 14 && s < dur - 0.05; k++) {
      put(s, a * 0.35 * (1 - k / 14), seed + 50 + k);
      s += 1 / rate; rate *= 1.18;
    }
  }
  const ms = coinModes(seed, { f0, ring: ring * (1 - onWood * 0.7) });
  const y = resonate(ex, ms, dur);
  // A little of the raw click, high-passed: the "tick" of the contact itself.
  const hp = new Biquad('hp', 5000, 0.7);
  for (let i = 0; i < n; i++) y[i] += hp.p(ex[i]) * 0.015;
  fadeOut(y, 0.03);
  return y;
}

/** Coin flicked into the air: a sharp ting that rings freely, wobbling as the spinning coin turns. */
export function coinFlick(seed = 1, { f0 = 3600, dur = 1.1, spin = 18 } = {}) {
  const n = len(dur), ex = contact(seed, 1);
  const y = resonate(ex, coinModes(seed, { f0, ring: 0.9 }), dur);
  const r = rng(seed);
  const ph = r() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // A spinning plate radiates in lobes: the ring pulses at twice the spin rate, slowing slightly.
    y[i] *= 0.55 + 0.45 * Math.abs(Math.cos(ph + Math.PI * 2 * spin * t * (1 - 0.15 * t)));
  }
  fadeOut(y, 0.05);
  return y;
}
