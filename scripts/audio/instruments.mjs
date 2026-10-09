// Instrument voices for the Dark Realm score and effects. Each returns a mono Float32Array.
import { SR, TAU, Biquad, SVF, Osc, adsr, rng, len, mul, eq, gain, softclip, noiseBuf, fadeOut } from './dsp.mjs';

// ---------------------------------------------------------------- choir

const FORMANTS = {
  soprano: {
    a: [[800, 1150, 2900, 3900, 4950], [0, -6, -32, -20, -50], [80, 90, 120, 130, 140]],
    o: [[450, 800, 2830, 3800, 4950], [0, -11, -22, -22, -50], [70, 80, 100, 130, 135]],
    u: [[325, 700, 2700, 3800, 4950], [0, -16, -35, -40, -60], [50, 60, 170, 180, 200]],
  },
  alto: {
    a: [[800, 1150, 2800, 3500, 4950], [0, -4, -20, -36, -60], [80, 90, 120, 130, 140]],
    o: [[450, 800, 2830, 3500, 4950], [0, -9, -16, -28, -55], [70, 80, 100, 130, 135]],
    u: [[325, 700, 2530, 3500, 4950], [0, -12, -30, -40, -64], [50, 60, 170, 180, 200]],
  },
  tenor: {
    a: [[650, 1080, 2650, 2900, 3250], [0, -6, -7, -8, -22], [80, 90, 120, 130, 140]],
    o: [[400, 800, 2600, 2800, 3000], [0, -10, -12, -12, -26], [40, 80, 100, 120, 120]],
    u: [[350, 600, 2700, 2900, 3300], [0, -20, -17, -14, -26], [40, 60, 100, 120, 120]],
  },
  bass: {
    a: [[600, 1040, 2250, 2450, 2750], [0, -7, -9, -9, -20], [60, 70, 110, 120, 130]],
    o: [[400, 750, 2400, 2600, 2900], [0, -11, -21, -20, -40], [40, 80, 100, 120, 120]],
    u: [[350, 600, 2400, 2675, 2950], [0, -20, -32, -28, -36], [40, 80, 100, 120, 120]],
  },
};

function voiceType(f) {
  if (f < 160) return 'bass';
  if (f < 260) return 'tenor';
  if (f < 400) return 'alto';
  return 'soprano';
}

function lerpVowel(type, v1, v2, k) {
  const A = FORMANTS[type][v1], B = FORMANTS[type][v2];
  return A.map((row, r) => row.map((x, i) => x + (B[r][i] - x) * k));
}

/** A small choir section singing one pitch: detuned glottal sources through moving formants. */
export function choir(f, dur, { vowel = 'a', to = vowel, a = 1.2, r = 2, voices = 4, vib = 0.004, seed = 1, breath = 0.06, type, shape, pitch } = {}) {
  const n = len(dur), out = new Float32Array(n);
  const vt = type ?? voiceType(f);
  const rnd = rng(seed);
  const env = shape ? shape(n) : adsr(n, { a, d: 0.5, s: 0.9, r, curve: 2 });
  for (let v = 0; v < voices; v++) {
    const osc = new Osc('saw', rnd());
    const det = 2 ** (((rnd() - 0.5) * 18) / 1200);
    const vr = 4.6 + rnd() * 1.2, vp = rnd() * TAU, vd = 0.25 + rnd() * 0.5;
    const drift = rnd() * TAU;
    const bank = [0, 1, 2, 3, 4].map(() => new Biquad('bp', 500, 5));
    const asp = new Biquad('bp', 2500, 0.8);
    const nb = noiseBuf(n, seed * 31 + v);
    const vg = 0.85 + rnd() * 0.3;
    let F = null;
    for (let i = 0; i < n; i++) {
      if (i % 64 === 0) {
        F = lerpVowel(vt, vowel, to, i / n);
        for (let k = 0; k < 5; k++) bank[k].set('bp', F[0][k] * (0.97 + 0.06 * ((v * 0.37) % 1)), F[0][k] / (F[2][k] * 1.4));
      }
      const t = i / SR;
      const vibAmt = vib * Math.min(1, Math.max(0, (t - vd) / 0.8));
      const ff = f * (pitch ? pitch(t) : 1) * det * (1 + vibAmt * Math.sin(TAU * vr * t + vp) + 0.0025 * Math.sin(0.31 * TAU * t + drift));
      const src = osc.p(ff) + asp.p(nb[i]) * breath * 4;
      let y = 0;
      for (let k = 0; k < 5; k++) y += bank[k].p(src) * 10 ** (F[1][k] / 20);
      out[i] += y * vg;
    }
  }
  eq(out, ['hp', 90, 0.7], ['lp', 6500, 0.7]);
  return mul(gain(out, 1.6 / voices), env);
}

// ---------------------------------------------------------------- strings

const STRING_BODY = [['hp', 70, 0.7], ['peak', 280, 1.2, 4], ['peak', 520, 2, 2], ['peak', 1250, 1.5, 3], ['peak', 2600, 1, -3], ['lp', 5200, 0.8]];

/** Bowed string section: an ensemble of detuned saws, bow noise and a wooden body. */
export function strings(f, dur, { a = 0.4, d = 0.3, s = 0.85, r = 0.8, voices = 5, vib = 0.0035, bright = 3200, seed = 2, swell = 0, glide, shape } = {}) {
  const n = len(dur), out = new Float32Array(n);
  const rnd = rng(seed);
  for (let v = 0; v < voices; v++) {
    const osc = new Osc('saw', rnd());
    const det = 2 ** (((rnd() - 0.5) * (voices > 1 ? 16 : 0)) / 1200);
    const vr = 4.8 + rnd() * 1.4, vp = rnd() * TAU;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const vibAmt = vib * Math.min(1, Math.max(0, (t - 0.25) / 0.6));
      const gf = glide ? glide(t) : 1;
      out[i] += osc.p(f * gf * det * (1 + vibAmt * Math.sin(TAU * vr * t + vp)));
    }
  }
  gain(out, 1 / Math.sqrt(voices));
  // Bow noise rides on the note.
  const bn = noiseBuf(n, seed + 99), bf = new Biquad('bp', Math.min(f * 6, 5000), 1.2);
  for (let i = 0; i < n; i++) out[i] += bf.p(bn[i]) * 0.12;
  const env = shape ? shape(n) : adsr(n, { a, d, s, r, curve: 2.5 });
  // Brightness follows the envelope like a harder bow stroke.
  const lp = new SVF(bright, 0.6);
  for (let i = 0; i < n; i++) {
    if (i % 32 === 0) lp.set(bright * (0.45 + 0.55 * env[i]) * (1 + swell * Math.sin((Math.PI * i) / n)), 0.6);
    out[i] = lp.p(out[i]);
  }
  eq(out, ...STRING_BODY);
  if (swell) for (let i = 0; i < n; i++) env[i] *= 0.6 + 0.4 * Math.sin((Math.PI * i) / n);
  return mul(gain(out, 0.5), env);
}

/** Expressive solo cello (or viola/fiddle with a higher pitch). */
export function cello(f, dur, { a = 0.18, r = 0.5, vib = 0.006, seed = 3, bright = 2600, swell = 0.35 } = {}) {
  return strings(f, dur, { a, d: 0.4, s: 0.9, r, voices: 1, vib, bright, seed, swell });
}

/** Short bowed note for ostinatos. */
export function spiccato(f, { dur = 0.22, bright = 2400, seed = 4, accent = 1 } = {}) {
  return strings(f, dur + 0.15, { a: 0.006, d: 0.12, s: 0.35, r: 0.12, voices: 4, vib: 0, bright: bright * (0.8 + 0.3 * accent), seed });
}

/** Tremolo high strings for tension beds. */
export function tremolo(f, dur, { rate = 12, seed = 5, a = 1.5, r = 1.5 } = {}) {
  const body = strings(f, dur, { a, r, voices: 4, vib: 0.002, bright: 4200, seed });
  for (let i = 0; i < body.length; i++) {
    const ph = ((i / SR) * rate) % 1;
    body[i] *= 0.45 + 0.55 * Math.exp(-ph * 5);
  }
  return body;
}

// ---------------------------------------------------------------- plucked

const BODIES = {
  lute: [['hp', 75, 0.7], ['peak', 110, 2, 5], ['peak', 230, 2.5, 4], ['peak', 480, 2, 2], ['peak', 2400, 1.5, 2], ['lp', 6000, 0.7]],
  harp: [['hp', 50, 0.7], ['peak', 180, 1, 3], ['lp', 9000, 0.7]],
  dulcimer: [['hp', 90, 0.7], ['peak', 300, 1.5, 3], ['peak', 3000, 1, 3]],
  none: [['hp', 30, 0.7]],
};

/** Extended Karplus-Strong plucked string. */
export function pluck(f, dur, { bright = 0.6, t60 = 2.5, pos = 0.18, body = 'lute', seed = 6, strings: nStr = 1, spread = 3 } = {}) {
  const n = len(dur), out = new Float32Array(n);
  for (let s = 0; s < nStr; s++) {
    const ff = f * 2 ** (((s - (nStr - 1) / 2) * spread) / 1200);
    const N = SR / ff;
    const S = 0.5;
    const Dt = N - S;
    const L = Math.floor(Dt - 0.1);
    const frac = Dt - L;
    const C = (1 - frac) / (1 + frac);
    const buf = new Float32Array(L + 2);
    const rho = 10 ** (-3 / (t60 * ff));
    // Excitation: filtered noise with a comb for the pluck position.
    const ex = noiseBuf(L, seed + s * 13);
    const lp = new Biquad('lp', 400 + bright * 9000, 0.6);
    for (let i = 0; i < L; i++) ex[i] = lp.p(ex[i]);
    const P = Math.max(1, Math.round(pos * L));
    for (let i = 0; i < L; i++) buf[i] = ex[i] - (i >= P ? ex[i - P] : 0) * 0.9;
    let w = 0, prev = 0, apx = 0, apy = 0;
    const Lb = buf.length - 1;
    for (let i = 0; i < n; i++) {
      const x = buf[w];
      const y = rho * ((1 - S) * x + S * prev);
      prev = x;
      // Fractional delay all-pass.
      const ap = C * y + apx - C * apy;
      apx = y; apy = ap;
      buf[w] = ap;
      w = (w + 1) % Lb;
      out[i] += x;
    }
  }
  eq(out, ...BODIES[body]);
  fadeOut(out, 0.05);
  return gain(out, 0.5 / Math.sqrt(nStr));
}

// ---------------------------------------------------------------- bells and mallets

const BELL = {
  church: { p: [0.5, 1, 1.183, 1.506, 2, 2.514, 2.662, 3.011, 4.166, 5.433, 6.796], a: [0.5, 0.9, 0.55, 0.35, 0.6, 0.3, 0.25, 0.2, 0.15, 0.08, 0.05], t: [9, 6, 4.5, 3.5, 3, 2, 1.8, 1.5, 1.1, 0.8, 0.6] },
  tubular: { p: [1, 2.76, 5.4, 8.93, 13.34], a: [1, 0.5, 0.3, 0.15, 0.06], t: [5, 3, 1.8, 1, 0.6] },
  glass: { p: [1, 2.32, 4.25, 6.63], a: [1, 0.4, 0.2, 0.08], t: [3, 1.2, 0.6, 0.3] },
  celesta: { p: [1, 2, 3.98, 8.1], a: [1, 0.2, 0.12, 0.04], t: [1.6, 0.8, 0.35, 0.12] },
  coin: { p: [1, 1.59, 2.14, 2.65, 3.16, 3.51, 4.22], a: [0.7, 1, 0.8, 0.6, 0.45, 0.35, 0.2], t: [0.5, 0.45, 0.35, 0.3, 0.2, 0.18, 0.12] },
  gong: { p: [0.5, 1, 1.47, 1.94, 2.37, 2.86, 3.31, 3.79, 4.5], a: [0.8, 1, 0.7, 0.6, 0.5, 0.4, 0.35, 0.3, 0.2], t: [6, 5, 4, 3.5, 3, 2.5, 2, 1.7, 1.2] },
};

/** Additive modal bell: inharmonic partials, each a slightly beating pair. */
export function bell(f, dur, { type = 'church', seed = 8, decay = 1, strike = 0.3, bright = 1 } = {}) {
  const n = len(dur), out = new Float32Array(n);
  const B = BELL[type], rnd = rng(seed);
  B.p.forEach((m, k) => {
    const fr = f * m * (1 + (rnd() - 0.5) * 0.004);
    if (fr > SR * 0.45) return;
    const beat = 0.4 + rnd() * 1.2;
    const amp = B.a[k] * (k > 2 ? bright : 1);
    const tau = (B.t[k] * decay) / 6.9;
    const ph1 = rnd() * TAU, ph2 = rnd() * TAU;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const e = Math.exp(-t / tau);
      if (e < 1e-4) break;
      out[i] += amp * e * (Math.sin(TAU * fr * t + ph1) + 0.6 * Math.sin(TAU * (fr + beat) * t + ph2));
    }
  });
  if (strike) {
    const nb = noiseBuf(len(0.03), seed + 1), bp = new Biquad('bp', Math.min(f * 4, 8000), 1);
    for (let i = 0; i < nb.length; i++) out[i] += bp.p(nb[i]) * strike * (1 - i / nb.length) * 2;
  }
  // Soft attack so the onset is a strike, not a click.
  for (let i = 0; i < 40; i++) out[i] *= i / 40;
  return gain(out, 0.25);
}

// ---------------------------------------------------------------- winds and drones

/** Breathy wooden flute. */
export function flute(f, dur, { a = 0.08, r = 0.25, vib = 0.005, breath = 0.18, seed = 9, swell = 0.25 } = {}) {
  const n = len(dur), out = new Float32Array(n);
  const rnd = rng(seed);
  const vr = 5 + rnd(), vp = rnd() * TAU;
  let ph = 0;
  const nb = noiseBuf(n, seed), bp = new Biquad('bp', f * 2, 2), hp = new Biquad('hp', 800, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const vibAmt = vib * Math.min(1, Math.max(0, (t - 0.2) / 0.5));
    ph += (f * (1 + vibAmt * Math.sin(TAU * vr * t + vp))) / SR;
    const tone = Math.sin(TAU * ph) + 0.22 * Math.sin(2 * TAU * ph) + 0.08 * Math.sin(3 * TAU * ph);
    const chiff = t < 0.06 ? (1 - t / 0.06) * 1.5 : 0;
    out[i] = tone + (bp.p(nb[i]) * 2 + hp.p(nb[i]) * 0.3) * (breath + chiff);
  }
  const env = adsr(n, { a, d: 0.2, s: 0.85, r, curve: 2 });
  if (swell) for (let i = 0; i < n; i++) env[i] *= 1 - swell + swell * Math.sin((Math.PI * i) / n);
  eq(out, ['lp', 7000, 0.7]);
  return mul(gain(out, 0.3), env);
}

/** Hurdy-gurdy style drone: buzzing bowed strings with a nasal body. */
export function gurdy(f, dur, { a = 0.6, r = 1, buzz = [], seed = 10 } = {}) {
  const n = len(dur), out = new Float32Array(n);
  const o1 = new Osc('saw'), o2 = new Osc('saw', 0.3), o3 = new Osc('square', 0.6);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const wob = 1 + 0.0015 * Math.sin(TAU * 0.7 * t);
    out[i] = o1.p(f * wob) + 0.7 * o2.p(f * 1.5 * wob * 1.001) + 0.25 * o3.p(f * 0.5);
  }
  // Rhythmic "trompette" buzz at the given times.
  const nb = noiseBuf(n, seed);
  for (const bt of buzz) {
    const s = len(bt), e = Math.min(n, s + len(0.14));
    for (let i = s; i < e; i++) {
      const k = (i - s) / (e - s);
      out[i] += Math.sign(Math.sin(TAU * f * 2 * (i / SR))) * 0.6 * (1 - k) * (0.6 + 0.4 * nb[i]);
    }
  }
  eq(out, ['hp', 60, 0.7], ['peak', 900, 2.5, 6], ['peak', 2200, 2, 3], ['lp', 4200, 0.7]);
  return mul(gain(out, 0.22), adsr(n, { a, d: 0.1, s: 1, r }));
}

/** Warm evolving synth pad (modern hybrid score bed). */
export function pad(f, dur, { a = 2, r = 3, voices = 6, cutoff = 900, lfo = 0.08, seed = 11, wave = 'saw', shape } = {}) {
  const n = len(dur), out = new Float32Array(n);
  const rnd = rng(seed);
  for (let v = 0; v < voices; v++) {
    const osc = new Osc(wave, rnd());
    const det = 2 ** (((rnd() - 0.5) * 24) / 1200) * (v % 3 === 2 ? 0.5 : 1);
    for (let i = 0; i < n; i++) out[i] += osc.p(f * det);
  }
  const svf = new SVF(cutoff, 0.9), ph = rnd() * TAU;
  for (let i = 0; i < n; i++) {
    if (i % 32 === 0) svf.set(cutoff * (1 + 0.5 * Math.sin(ph + (TAU * lfo * i) / SR)), 0.9);
    out[i] = svf.p(out[i]);
  }
  eq(out, ['hp', 50, 0.7]);
  return mul(gain(out, 0.6 / Math.sqrt(voices)), shape ? shape(n) : adsr(n, { a, d: 1, s: 0.9, r, curve: 2 }));
}

export function sub(f, dur, { a = 2, r = 3 } = {}) {
  const n = len(dur), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2 * f * t + 0.3);
  }
  return mul(gain(out, 0.5), adsr(n, { a, d: 1, s: 1, r, curve: 2 }));
}

/** Moving wind: band-passed noise with slow gusts. */
export function wind(dur, { seed = 12, center = 500, q = 2.5, depth = 0.8, rate = 0.07 } = {}) {
  const n = len(dur), nb = noiseBuf(n, seed), out = new Float32Array(n);
  const svf = new SVF(center, q), rnd = rng(seed), p1 = rnd() * TAU, p2 = rnd() * TAU;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const g = 0.5 + 0.5 * Math.sin(p1 + TAU * rate * t) * Math.sin(p2 + TAU * rate * 0.37 * t);
    if (i % 32 === 0) svf.set(center * (1 + depth * (g - 0.5)), q);
    svf.p(nb[i]);
    out[i] = svf.bp * (0.2 + g);
  }
  return gain(out, 0.25);
}

// ---------------------------------------------------------------- drums and impacts

const MEMBRANE = [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.16];

/** Membrane drum: modal partials with a pitch drop and a skin noise attack. */
export function drum(f, { dur = 1.2, decay = 0.6, drop = 0.35, noise = 0.4, noiseF = 1800, modes = 4, seed = 13, click = 0.2 } = {}) {
  const n = len(dur), out = new Float32Array(n), rnd = rng(seed);
  for (let k = 0; k < modes; k++) {
    const m = MEMBRANE[k], amp = [1, 0.5, 0.35, 0.25, 0.18, 0.12, 0.1][k];
    const tau = (decay / (1 + k * 0.9)) / 6.9;
    let ph = rnd();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const e = Math.exp(-t / tau);
      if (e < 1e-4) break;
      const fr = f * m * (1 + drop * Math.exp(-t / 0.04));
      ph += fr / SR;
      out[i] += amp * e * Math.sin(TAU * ph);
    }
  }
  const nb = noiseBuf(len(0.12), seed + 3), lp = new Biquad('lp', noiseF, 0.8), hp = new Biquad('bp', 3500, 1);
  for (let i = 0; i < nb.length; i++) {
    const t = i / SR;
    out[i] += lp.p(nb[i]) * noise * Math.exp(-t / 0.02) + hp.p(nb[i]) * click * Math.exp(-t / 0.004);
  }
  for (let i = 0; i < 20; i++) out[i] *= i / 20;
  return gain(out, 0.6);
}

export const taiko = (f = 62, o = {}) => drum(f, { dur: 1.6, decay: 1.1, drop: 0.45, noise: 0.5, noiseF: 1200, ...o });
export const frame = (f = 110, o = {}) => drum(f, { dur: 0.7, decay: 0.45, drop: 0.2, noise: 0.35, noiseF: 2500, modes: 3, ...o });
export const rim = (o = {}) => drum(420, { dur: 0.2, decay: 0.08, drop: 0.1, noise: 0.25, noiseF: 5000, modes: 2, click: 0.8, ...o });

/** Cinematic "braam": low brassy saws with an opening filter and saturation. */
export function braam(f, dur, { a = 0.05, r = 2.5, open = 0.35, peakF = 1600, seed = 14, drive = 2.2 } = {}) {
  const n = len(dur), out = new Float32Array(n), rnd = rng(seed);
  const freqs = [f, f * 1.003, f * 0.997, f * 2, f * 2.004, f * 1.5];
  for (const fr of freqs) {
    const o = new Osc('saw', rnd());
    for (let i = 0; i < n; i++) out[i] += o.p(fr);
  }
  const svf = new SVF(200, 2.2);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (i % 16 === 0) {
      const k = t < open ? t / open : Math.exp(-(t - open) / 1.2);
      svf.set(150 + peakF * k, 2.2);
    }
    out[i] = svf.p(out[i] * 0.3);
  }
  softclip(out, drive);
  eq(out, ['hp', 35, 0.7], ['peak', 120, 1, 3]);
  return mul(gain(out, 0.5), adsr(n, { a, d: 0.6, s: 0.6, r, curve: 2 }));
}

/** Deep cinematic hit: sub drop plus a body thump and a noise crack. */
export function boom({ f = 48, dur = 2.5, crack = 0.5, seed = 15, tail = 1 } = {}) {
  const n = len(dur), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const fr = f * (1 + 2.5 * Math.exp(-t / 0.03));
    ph += fr / SR;
    out[i] = Math.sin(TAU * ph) * Math.exp(-t / (0.5 * tail));
  }
  const nb = noiseBuf(len(0.6), seed), lp = new SVF(4000, 0.7);
  for (let i = 0; i < nb.length; i++) {
    const t = i / SR;
    if (i % 16 === 0) lp.set(300 + 5000 * Math.exp(-t / 0.03), 0.7);
    out[i] += lp.p(nb[i]) * crack * Math.exp(-t / 0.09);
  }
  softclip(out, 1.5);
  return gain(out, 0.7);
}

/** Filtered noise sweep (whoosh). */
export function whoosh(dur, { from = 400, to = 4000, q = 1.2, seed = 16, shape = 'swell', vol = 1 } = {}) {
  const n = len(dur), nb = noiseBuf(n, seed), out = new Float32Array(n), svf = new SVF(from, q);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    if (i % 16 === 0) svf.set(from * (to / from) ** k, q);
    svf.p(nb[i]);
    const e = shape === 'swell' ? Math.sin(Math.PI * k) ** 2 : shape === 'decay' ? (1 - k) ** 2 : k ** 2;
    out[i] = svf.bp * e;
  }
  return gain(out, vol);
}

/** Crackle: sparse random impulses through a band, e.g. fire or tearing paper. */
export function crackle(dur, { density = 400, f = 3000, q = 1, seed = 17, env } = {}) {
  const n = len(dur), out = new Float32Array(n), rnd = rng(seed), bp = new Biquad('bp', f, q);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const d = density * (env ? env(k) : 1);
    const x = rnd() < d / SR ? (rnd() * 2 - 1) * (0.5 + rnd()) : 0;
    out[i] = bp.p(x);
  }
  return gain(out, 2);
}

/** Metallic ring for blades and armour: a few inharmonic modes. */
export function metal(f, dur, { decay = 0.6, seed = 18, modes = [1, 1.47, 2.09, 2.56, 3.39, 4.12, 5.3] } = {}) {
  const n = len(dur), out = new Float32Array(n), rnd = rng(seed);
  modes.forEach((m, k) => {
    const fr = f * m * (1 + (rnd() - 0.5) * 0.01), tau = decay / (1 + k * 0.5) / 6.9, ph = rnd() * TAU, a = 1 / (1 + k * 0.4);
    for (let i = 0; i < n; i++) {
      const e = Math.exp(-i / SR / tau);
      if (e < 1e-4) break;
      out[i] += a * e * Math.sin(TAU * fr * (i / SR) + ph);
    }
  });
  for (let i = 0; i < 10; i++) out[i] *= i / 10;
  return gain(out, 0.2);
}

/** Brass (horn) note: lip scoop, brightness that follows loudness, nasal formant. */
export function brass(f, dur, { a = 0.06, r = 0.4, vib = 0.004, bright = 1, seed = 19, scoop = 40, voices = 2 } = {}) {
  const n = len(dur), out = new Float32Array(n), rnd = rng(seed);
  const env = adsr(n, { a, d: 0.25, s: 0.8, r, curve: 2.5 });
  for (let v = 0; v < voices; v++) {
    const o = new Osc('saw', rnd()), det = 2 ** (((rnd() - 0.5) * 10) / 1200), vp = rnd() * TAU;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const sc = 2 ** ((-scoop * Math.exp(-t / 0.05)) / 1200);
      const vb = vib * Math.min(1, Math.max(0, (t - 0.3) / 0.4)) * Math.sin(TAU * 5.2 * t + vp);
      out[i] += o.p(f * det * sc * (1 + vb));
    }
  }
  const svf = new SVF(800, 0.8);
  for (let i = 0; i < n; i++) {
    if (i % 16 === 0) svf.set(Math.min(f * 1.2 + 3500 * bright * env[i] ** 1.5, 9000), 0.8);
    out[i] = svf.p(out[i]);
  }
  eq(out, ['hp', 60, 0.7], ['peak', 700, 1.4, 4], ['peak', 1400, 2, 2], ['lp', 7000, 0.7]);
  softclip(gain(out, 0.6 / Math.sqrt(voices)), 1.3);
  return mul(out, env);
}

// ---------------------------------------------------------------- crowd

const SPEECH = { a: [700, 1150, 2500], o: [450, 800, 2500], u: [330, 700, 2400], e: [450, 1750, 2550], i: [300, 2100, 2800] };
const VOWELS = Object.keys(SPEECH);

/** One muffled talker: phrases of syllables with falling intonation, separated by pauses. */
export function talker(dur, { seed = 21, f0 = 110, rate = 4.2, talk = 0.5 } = {}) {
  const n = len(dur), out = new Float32Array(n), r = rng(seed);
  // Build the syllable plan.
  const env = new Float32Array(n), pitch = new Float32Array(n), vowel = new Int8Array(n);
  let t = r() * 2;
  while (t < dur) {
    const phrase = 0.8 + r() * 3 * talk + 0.5;
    const end = Math.min(dur, t + phrase);
    const loud = 0.6 + 0.6 * r();
    let s = t;
    while (s < end) {
      const sl = (0.6 + 0.8 * r()) / rate;
      const v = Math.floor(r() * VOWELS.length);
      const a = len(s), b = Math.min(n, len(s + sl));
      for (let i = a; i < b; i++) {
        const k = (i - a) / (b - a);
        env[i] = loud * Math.sin(Math.PI * k) ** 0.8;
        pitch[i] = f0 * (1.12 - 0.22 * ((s - t) / phrase)) * (1 + 0.04 * Math.sin(TAU * k));
        vowel[i] = v;
      }
      s += sl;
    }
    t = end + 0.4 + r() * 2.5 / talk;
  }
  const osc = new Osc('saw', r()), bank = [0, 1, 2].map(() => new Biquad('bp', 500, 6));
  const F = [500, 1500, 2500], nb = noiseBuf(n, seed + 5);
  let p = f0;
  for (let i = 0; i < n; i++) {
    if (i % 32 === 0) {
      const tgt = SPEECH[VOWELS[vowel[i]]];
      for (let k = 0; k < 3; k++) { F[k] += (tgt[k] - F[k]) * 0.25; bank[k].set('bp', F[k], F[k] / (80 + 40 * k)); }
    }
    if (pitch[i]) p += (pitch[i] - p) * 0.01;
    const src = osc.p(p) + nb[i] * 0.08;
    out[i] = (bank[0].p(src) + 0.5 * bank[1].p(src) + 0.2 * bank[2].p(src)) * env[i];
  }
  // Heard through the room: no highs, no rumble.
  return eq(gain(out, 1.2), ['hp', 140, 0.7], ['lp', 1300, 0.6], ['lp', 2200, 0.7]);
}

/**
 * Smooth choir: additive harmonics shaped by vowel formants. Each harmonic is a single partial with its own
 * slow pitch jitter, so the section shimmers without the volume pumping of beating detuned oscillators.
 * Returns a stereo pair (the two sides use different jitter).
 */
export function choirSmooth(f, dur, { vowel = 'o', to = vowel, type, pitch, shape, vib = 0.004, seed = 1, breath = 0.05, jitter = 0.0018, a = 1, r = 1.5 } = {}) {
  const n = len(dur), vt = type ?? voiceType(f);
  const env = shape ? shape(n) : adsr(n, { a, d: 0.5, s: 0.9, r, curve: 2 });
  const sides = [0, 1].map((side) => {
    const out = new Float32Array(n), rnd = rng(seed * 13 + side * 101);
    const H = Math.max(1, Math.floor(5200 / (f * 0.8)));
    const ph = Array.from({ length: H }, () => rnd());
    const jit = Array.from({ length: H }, () => 0), jv = Array.from({ length: H }, () => 0);
    const amp = new Float64Array(H);
    const vr = 4.8 + rnd(), vp = rnd() * TAU;
    let F0 = f;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if (i % 256 === 0) {
        F0 = f * (pitch ? pitch(t) : 1);
        const [Fq, Fa, Fb] = lerpVowel(vt, vowel, to, i / n);
        for (let h = 0; h < H; h++) {
          const fh = F0 * (h + 1);
          let e = 0.004;
          for (let k = 0; k < 5; k++) e += 10 ** (Fa[k] / 20) / (1 + ((fh - Fq[k]) / (Fb[k] * 0.9)) ** 2);
          amp[h] = fh > 7000 ? 0 : e / Math.sqrt(h + 1);
          // Slow random walk of each harmonic's pitch, the "many singers" shimmer.
          jv[h] = jv[h] * 0.97 + (rnd() - 0.5) * jitter * 0.12;
          jit[h] = Math.max(-jitter, Math.min(jitter, jit[h] + jv[h]));
        }
      }
      const vibAmt = vib * Math.min(1, t / 1.2);
      const base = F0 * (1 + vibAmt * Math.sin(TAU * vr * t + vp));
      let y = 0;
      for (let h = 0; h < H; h++) {
        if (!amp[h]) continue;
        ph[h] += (base * (h + 1) * (1 + jit[h])) / SR;
        y += amp[h] * Math.sin(TAU * ph[h]);
      }
      out[i] = y;
    }
    // Breath: a whisper of noise through the first two formants.
    const nb = noiseBuf(n, seed * 7 + side), b1 = new Biquad('bp', FORMANTS[vt][vowel][0][1], 2);
    for (let i = 0; i < n; i++) out[i] += b1.p(nb[i]) * breath;
    return mul(gain(out, 0.35), env);
  });
  return sides;
}
