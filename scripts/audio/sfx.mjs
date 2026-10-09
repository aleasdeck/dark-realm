// Three candidate sound-effect packs for Dark Realm. Each sound returns a stereo pair.
import { Mix, hz, len, reverse, eq, gain, fadeIn, fadeOut, softclip } from './dsp.mjs';
import * as I from './instruments.mjs';

const ROOM = { rt60: 0.9, size: 0.55, damp: 6500, pre: 0.006, gain: 0.8 };
const HALL = { rt60: 3.2, size: 1.3, damp: 5000, pre: 0.02, gain: 0.9 };
const CAVE = { rt60: 5.5, size: 1.7, damp: 3500, pre: 0.035, gain: 0.9 };

/** Builds one effect on a small stereo bus and trims the silent tail. */
function S(dur, build) {
  const m = new Mix(dur, { room: ROOM, hall: HALL, cave: CAVE });
  build(m);
  const [L, R] = m.render();
  let end = L.length;
  while (end > 1 && Math.abs(L[end - 1]) < 2e-4 && Math.abs(R[end - 1]) < 2e-4) end--;
  const l = L.slice(0, end + 200), r = R.slice(0, end + 200);
  fadeOut(l, 0.03); fadeOut(r, 0.03);
  return [l, r];
}

/** Reverse-reverb swell: the reverb tail played backwards, rising into the sound within `tail` seconds. */
function swell(buf, g = 1, tail = 0.45) {
  const pad = new Float32Array(buf.length + len(2));
  pad.set(buf);
  const m = new Mix(pad.length / 44100, { cave: CAVE });
  m.add(pad, 0, g, 0, { cave: 1 });
  const [L] = m.render();
  const rev = reverse(L);
  return fadeIn(rev.slice(rev.length - buf.length - len(tail)), 0.08);
}

/** Paper slide: band noise sweep with fibre crackle. */
const slide = (dur, from, to, seed) => {
  const w = I.whoosh(dur, { from, to, q: 0.9, seed, shape: 'swell' });
  const c = I.crackle(dur, { density: 900, f: 4500, q: 0.7, seed: seed + 1, env: (k) => Math.sin(Math.PI * k) });
  for (let i = 0; i < w.length; i++) w[i] += c[i] * 0.25;
  return w;
};

const coinClink = (m, t, f, g, pan, seed, send = { room: 0.6 }) =>
  m.add(I.bell(f, 0.7, { type: 'coin', strike: 0.7, seed, decay: 0.9 }), t, g, pan, send);

// ======================================================= 1. Parchment and steel (natural foley)

const foley = {
  click: () => S(0.25, (m) => {
    m.add(eq(I.drum(520, { dur: 0.08, decay: 0.03, drop: 0.05, noise: 0.5, noiseF: 4000, modes: 2, click: 0.6 }), ['hp', 200, 0.7]), 0, 0.8, 0, { room: 0.4 });
  }),
  choose: () => S(1.2, (m) => {
    m.add(I.bell(hz('A5'), 1, { type: 'glass', strike: 0.1, seed: 1 }), 0, 0.5, -0.2, { room: 0.6 });
    m.add(I.bell(hz('D6'), 1, { type: 'glass', strike: 0.1, seed: 2 }), 0.11, 0.5, 0.2, { room: 0.6 });
  }),
  error: () => S(0.5, (m) => {
    m.add(I.drum(170, { dur: 0.25, decay: 0.12, drop: 0.1, noise: 0.5, noiseF: 1200, modes: 3 }), 0, 0.9, 0, { room: 0.5 });
    m.add(I.drum(150, { dur: 0.25, decay: 0.12, drop: 0.1, noise: 0.5, noiseF: 1200, modes: 3, seed: 4 }), 0.12, 0.7, 0, { room: 0.5 });
  }),
  card: () => S(0.6, (m) => {
    m.add(slide(0.2, 1200, 5000, 3), 0, 0.9, 0.15, { room: 0.4 });
    m.add(I.drum(240, { dur: 0.15, decay: 0.06, drop: 0.1, noise: 0.6, noiseF: 2500, modes: 2 }), 0.17, 0.6, 0, { room: 0.5 });
  }),
  discard: () => S(0.5, (m) => {
    m.add(slide(0.22, 5000, 1500, 7), 0, 0.8, -0.2, { room: 0.4 });
  }),
  coin: () => S(1.0, (m) => {
    coinClink(m, 0, 2900, 0.7, -0.15, 1);
    coinClink(m, 0.07, 3350, 0.55, 0.2, 2);
    coinClink(m, 0.13, 2650, 0.4, 0, 3);
    m.add(I.crackle(0.18, { density: 1500, f: 6000, q: 1, seed: 4 }), 0.05, 0.15, 0, { room: 0.4 });
  }),
  agent: () => S(1.4, (m) => {
    m.add(I.crackle(0.3, { density: 600, f: 1600, q: 0.8, seed: 5, env: (k) => Math.sin(Math.PI * k) }), 0, 0.5, -0.3, { room: 0.4 });
    m.add(I.whoosh(0.35, { from: 2500, to: 7000, q: 2, seed: 6, shape: 'rise' }), 0.05, 0.5, 0.2, { room: 0.4 });
    m.add(I.metal(1250, 1.2, { decay: 1.1, seed: 7 }), 0.38, 0.6, 0.2, { room: 0.6 });
    m.add(I.drum(110, { dur: 0.4, decay: 0.25, drop: 0.2, noise: 0.4, noiseF: 1500 }), 0.36, 0.6, 0, { room: 0.5 });
  }),
  toss: () => S(1.2, (m) => {
    coinClink(m, 0, 3600, 0.7, 0, 9);
    const spin = I.metal(2400, 0.9, { decay: 0.9, seed: 10, modes: [1, 1.59, 2.14] });
    for (let i = 0; i < spin.length; i++) spin[i] *= 0.5 + 0.5 * Math.sin((i / 44100) * 2 * Math.PI * 22 * (1 - i / spin.length / 2));
    m.add(spin, 0.05, 0.5, 0.1, { room: 0.5 });
  }),
  draft: () => S(2.2, (m) => {
    m.add(I.drum(85, { dur: 0.8, decay: 0.5, drop: 0.25, noise: 0.6, noiseF: 900 }), 0, 0.9, 0, { hall: 0.5 });
    m.add(I.metal(520, 2, { decay: 1.8, seed: 11 }), 0.01, 0.55, 0, { hall: 0.6 });
  }),
  hit: () => S(1.2, (m) => {
    m.add(I.whoosh(0.09, { from: 800, to: 4000, q: 1, seed: 12, shape: 'rise' }), 0, 0.6, -0.3, {});
    m.add(I.boom({ f: 70, dur: 0.5, crack: 0.9, tail: 0.25, seed: 13 }), 0.08, 0.8, 0, { room: 0.5 });
    m.add(I.metal(780, 0.9, { decay: 0.7, seed: 14 }), 0.08, 0.55, 0.15, { room: 0.6 });
  }),
  knockout: () => S(2.2, (m) => {
    m.add(I.boom({ f: 52, dur: 1.2, crack: 1, tail: 0.6, seed: 15 }), 0, 1, 0, { room: 0.5, hall: 0.3 });
    m.add(I.metal(430, 1.5, { decay: 1.3, seed: 16 }), 0.0, 0.5, -0.2, { hall: 0.4 });
    m.add(I.crackle(0.6, { density: 300, f: 2000, q: 0.6, seed: 17, env: (k) => 1 - k }), 0.18, 0.6, 0.3, { room: 0.5 });
    m.add(I.drum(70, { dur: 0.6, decay: 0.35, drop: 0.2, noise: 0.5, noiseF: 800 }), 0.42, 0.7, 0.1, { room: 0.5 });
  }),
  destroy: () => S(1.6, (m) => {
    m.add(I.crackle(1.0, { density: 1800, f: 2500, q: 0.6, seed: 18, env: (k) => Math.sin(Math.PI * Math.min(1, k * 1.5)) }), 0, 0.6, 0, { room: 0.4 });
    m.add(I.whoosh(0.9, { from: 200, to: 1400, q: 0.7, seed: 19, shape: 'swell' }), 0, 0.9, 0, { room: 0.4 });
    m.add(slide(0.12, 6000, 2000, 20), 0, 0.6, 0.2, {});
  }),
  patron: () => S(5, (m) => {
    m.add(I.bell(hz('D3'), 5, { strike: 0.25, seed: 21 }), 0, 0.9, -0.1, { hall: 0.7 });
    m.add(I.choir(hz('D3'), 2.5, { vowel: 'u', to: 'o', voices: 4, a: 0.4, r: 1.5, seed: 22 }), 0, 0.6, 0.2, { hall: 0.8 });
    m.add(I.drum(55, { dur: 1.5, decay: 1, drop: 0.3, noise: 0.3, noiseF: 600 }), 0, 0.5, 0, { hall: 0.5 });
  }),
  prestige: () => S(2.4, (m) => {
    ['D5', 'F5', 'A5', 'D6'].forEach((n, k) => m.add(I.bell(hz(n), 1.8, { type: 'tubular', strike: 0.15, seed: 23 + k }), k * 0.08, 0.45, -0.3 + k * 0.2, { hall: 0.6 }));
  }),
  myTurn: () => S(2.4, (m) => {
    m.add(I.brass(hz('A3'), 0.35, { seed: 24, r: 0.15 }), 0, 0.7, -0.1, { hall: 0.5 });
    m.add(I.brass(hz('D4'), 0.9, { seed: 25, r: 0.5 }), 0.3, 0.8, -0.1, { hall: 0.5 });
  }),
  theirTurn: () => S(2.4, (m) => {
    const d1 = eq(I.taiko(58, { seed: 26 }), ['lp', 900, 0.7]);
    m.add(d1, 0, 0.8, 0, { hall: 0.8 });
    m.add(eq(I.taiko(58, { seed: 27 }), ['lp', 900, 0.7]), 0.38, 0.55, 0, { hall: 0.8 });
    m.add(eq(I.brass(hz('D3'), 1, { seed: 28, bright: 0.4 }), ['lp', 1500, 0.7]), 0.05, 0.45, 0.2, { hall: 0.9 });
  }),
  win: () => S(5, (m) => {
    // D minor resolves to D major: a dark victory.
    [['D3', 0], ['A3', 0], ['D4', 0], ['F#4', 0], ['A4', 0]].forEach(([n], k) =>
      m.add(I.brass(hz(n), 2.6, { seed: 30 + k, a: 0.08, r: 1, bright: 0.9 }), 0.55, 0.45, (k - 2) * 0.25, { hall: 0.6 }));
    m.add(I.brass(hz('A3'), 0.3, { seed: 40, r: 0.08 }), 0, 0.6, 0, { hall: 0.5 });
    m.add(I.brass(hz('A3'), 0.25, { seed: 41, r: 0.08 }), 0.27, 0.6, 0, { hall: 0.5 });
    ['D4', 'F#4', 'A4'].forEach((n, k) => m.add(I.choir(hz(n), 3, { vowel: 'a', voices: 5, a: 0.3, r: 1.5, seed: 42 + k }), 0.55, 0.45, (k - 1) * 0.4, { hall: 0.8 }));
    m.add(I.taiko(60, { seed: 45 }), 0.55, 0.7, 0, { hall: 0.5 });
    m.add(I.bell(hz('D4'), 4, { type: 'tubular', seed: 46 }), 0.55, 0.4, 0.3, { hall: 0.8 });
  }),
  lose: () => S(6, (m) => {
    [['D3', 0, 0.9], ['C#3', 0.9, 0.9], ['C3', 1.8, 0.9], ['A2', 2.7, 2.2]].forEach(([n, t, d], k) =>
      m.add(I.cello(hz(n), d + 0.3, { a: 0.2, r: 0.8, seed: 50 + k, swell: 0.4 }), t, 0.7, -0.1, { hall: 0.6 }));
    m.add(I.bell(hz('D2'), 6, { strike: 0.2, seed: 55 }), 2.7, 0.7, 0.2, { cave: 0.8 });
    m.add(I.choir(hz('D3'), 3.5, { vowel: 'u', voices: 4, a: 1, r: 2, seed: 56 }), 2.7, 0.35, 0.3, { hall: 0.8 });
  }),
};

// ======================================================= 2. Dark magic (arcane, ethereal)

const sparkle = (m, t, n, seed, g = 0.12, base = 2200) => {
  for (let i = 0; i < n; i++) {
    const f = base * 2 ** (((seed * 7 + i * 5) % 24) / 12);
    m.add(I.bell(f, 0.8, { type: 'glass', strike: 0, seed: seed + i }), t + i * 0.035, g, ((i * 0.37) % 1) * 1.6 - 0.8, { hall: 1 });
  }
};

const magic = {
  click: () => S(0.6, (m) => {
    m.add(I.bell(2350, 0.25, { type: 'glass', strike: 0.2, seed: 1, decay: 0.3 }), 0, 0.6, 0, { room: 0.4, hall: 0.3 });
  }),
  choose: () => S(1.8, (m) => {
    m.add(I.bell(hz('D6'), 1.4, { type: 'glass', strike: 0.05, seed: 2 }), 0, 0.5, -0.3, { hall: 0.9 });
    m.add(I.bell(hz('A6'), 1.4, { type: 'glass', strike: 0.05, seed: 3 }), 0.12, 0.45, 0.3, { hall: 0.9 });
  }),
  error: () => S(0.8, (m) => {
    const b = I.sub(110, 0.35, { a: 0.01, r: 0.2 }), c = I.sub(116.5, 0.35, { a: 0.01, r: 0.2 });
    for (let i = 0; i < b.length; i++) b[i] += c[i];
    m.add(softclip(b, 2), 0, 0.6, 0, { room: 0.5 });
  }),
  card: () => S(1.2, (m) => {
    m.add(I.whoosh(0.3, { from: 500, to: 3500, q: 1.4, seed: 4 }), 0, 0.8, -0.2, { hall: 0.4 });
    sparkle(m, 0.12, 4, 5, 0.1);
  }),
  discard: () => S(1.2, (m) => {
    m.add(I.whoosh(0.35, { from: 3500, to: 700, q: 1.4, seed: 6, shape: 'decay' }), 0, 0.7, 0.2, { hall: 0.5 });
    sparkle(m, 0, 3, 7, 0.06, 1500);
  }),
  coin: () => S(1.6, (m) => {
    m.add(I.bell(hz('E6'), 1.4, { type: 'glass', strike: 0.2, seed: 8 }), 0, 0.5, -0.2, { hall: 0.7 });
    m.add(I.bell(hz('B6'), 1.4, { type: 'glass', strike: 0.2, seed: 9 }), 0.06, 0.4, 0.2, { hall: 0.7 });
    sparkle(m, 0.08, 3, 10, 0.06, 3000);
  }),
  agent: () => S(2.6, (m) => {
    const sw = swell(I.choir(hz('D3'), 0.5, { vowel: 'o', voices: 4, a: 0.02, r: 0.2, seed: 11 }));
    m.add(sw, 0, 0.9, 0, {});
    const at = sw.length / 44100;
    m.add(I.boom({ f: 60, dur: 0.8, crack: 0.3, tail: 0.4, seed: 12 }), at, 0.6, 0, { hall: 0.5 });
    m.add(I.bell(hz('A4'), 2, { type: 'tubular', strike: 0.1, seed: 13 }), at, 0.35, 0.2, { hall: 0.8 });
  }),
  toss: () => S(1.8, (m) => {
    m.add(I.whoosh(0.6, { from: 800, to: 6000, q: 2, seed: 14, shape: 'rise' }), 0, 0.5, 0, { hall: 0.5 });
    sparkle(m, 0.05, 6, 15, 0.07, 2600);
    m.add(I.bell(hz('D7'), 1, { type: 'glass', strike: 0.2, seed: 16 }), 0.55, 0.4, 0, { hall: 0.6 });
  }),
  draft: () => S(4, (m) => {
    const sw = swell(I.whoosh(0.2, { from: 300, to: 2000, q: 1, seed: 17 }), 0.8, 0.3);
    m.add(sw, 0, 0.7, 0, {});
    const at = sw.length / 44100;
    m.add(I.bell(hz('D2'), 3.5, { type: 'gong', strike: 0.3, seed: 18 }), at, 0.8, 0, { hall: 0.7 });
    m.add(I.choir(hz('D3'), 2.2, { vowel: 'u', voices: 4, a: 0.1, r: 1.6, seed: 19 }), at, 0.45, 0.2, { cave: 0.8 });
  }),
  hit: () => S(1.6, (m) => {
    const suck = swell(I.whoosh(0.06, { from: 800, to: 3000, q: 1, seed: 20 }), 0.6, 0.12);
    m.add(suck, 0, 0.5, 0, {});
    const at = suck.length / 44100;
    m.add(I.boom({ f: 62, dur: 0.7, crack: 0.8, tail: 0.35, seed: 21 }), at, 0.9, 0, { hall: 0.4 });
    m.add(softclip(I.crackle(0.3, { density: 2500, f: 1200, q: 0.5, seed: 22, env: (k) => 1 - k }), 3), at, 0.4, 0.2, { hall: 0.4 });
  }),
  knockout: () => S(3.2, (m) => {
    m.add(I.boom({ f: 48, dur: 1.4, crack: 1, tail: 0.8, seed: 23 }), 0, 1, 0, { hall: 0.5 });
    for (let i = 0; i < 14; i++) {
      m.add(I.bell(1800 + ((i * 937) % 4000), 0.9, { type: 'glass', strike: 0.4, seed: 30 + i, decay: 0.6 }), 0.01 + i * 0.012 + ((i * 13) % 7) * 0.008, 0.16, ((i * 0.41) % 1) * 1.6 - 0.8, { hall: 0.8 });
    }
  }),
  destroy: () => S(2.6, (m) => {
    m.add(I.crackle(1.2, { density: 1400, f: 1800, q: 0.6, seed: 45, env: (k) => (1 - k) ** 1.5 }), 0, 0.5, 0, { hall: 0.4 });
    m.add(I.whoosh(1.2, { from: 2500, to: 150, q: 1.2, seed: 46, shape: 'decay' }), 0, 0.8, 0, { hall: 0.6 });
    m.add(I.choir(hz('A2'), 1.4, { vowel: 'o', to: 'u', voices: 3, a: 0.05, r: 1, seed: 47, breath: 0.4 }), 0.05, 0.35, 0, { cave: 0.7 });
  }),
  patron: () => S(5.5, (m) => {
    [['D3', -0.4], ['A3', 0], ['F4', 0.4], ['D4', 0.2]].forEach(([n, p], k) => m.add(I.choir(hz(n), 3, { vowel: 'a', to: 'o', voices: 5, a: 0.25, r: 2, seed: 48 + k }), 0, 0.5, p, { cave: 0.9 }));
    m.add(I.bell(hz('D2'), 5, { type: 'gong', strike: 0.3, seed: 52 }), 0, 0.6, 0, { hall: 0.6 });
    m.add(I.sub(hz('D1'), 2.5, { a: 0.05, r: 1.5 }), 0, 0.5, 0, {});
  }),
  prestige: () => S(3, (m) => {
    ['D5', 'F5', 'A5', 'D6', 'F6'].forEach((n, k) => m.add(I.bell(hz(n), 1.6, { type: 'celesta', strike: 0.05, seed: 53 + k }), k * 0.07, 0.5, -0.4 + k * 0.2, { hall: 0.8 }));
    m.add(I.choir(hz('A5'), 1.8, { vowel: 'a', voices: 4, a: 0.2, r: 1.2, seed: 58 }), 0.25, 0.3, 0, { hall: 0.9 });
  }),
  myTurn: () => S(4, (m) => {
    m.add(I.bell(hz('D3'), 3.5, { type: 'gong', strike: 0.2, seed: 59, decay: 0.7 }), 0, 0.5, 0, { hall: 0.6 });
    [['D4', -0.3], ['F4', 0.3], ['A4', 0]].forEach(([n, p], k) => m.add(I.choir(hz(n), 1.8, { vowel: 'a', voices: 4, a: 0.12, r: 1.2, seed: 60 + k }), 0.02, 0.45, p, { hall: 0.8 }));
  }),
  theirTurn: () => S(3.5, (m) => {
    [['D2', 'bass'], ['A2', 'bass']].forEach(([n, type], k) => m.add(I.choir(hz(n) * 2, 2, { vowel: 'u', voices: 4, a: 0.3, r: 1.2, seed: 63 + k, type, breath: 0.25 }), 0, 0.5, k ? 0.3 : -0.3, { cave: 0.8 }));
    m.add(swell(I.whoosh(0.3, { from: 1500, to: 400, q: 1, seed: 66 }), 0.5), 0, 0.3, 0, {});
  }),
  win: () => S(6, (m) => {
    [['D3', -0.5], ['A3', -0.2], ['D4', 0.2], ['F#4', 0.5], ['A4', 0]].forEach(([n, p], k) => m.add(I.choir(hz(n), 4, { vowel: 'o', to: 'a', voices: 6, a: 0.6, r: 2, seed: 70 + k }), 0, 0.5, p, { cave: 0.8 }));
    ['A5', 'F#5', 'D5', 'A5', 'D6', 'F#6'].forEach((n, k) => m.add(I.bell(hz(n), 2.5, { type: 'celesta', strike: 0.05, seed: 80 + k }), 0.4 + k * 0.16, 0.35, -0.5 + k * 0.2, { hall: 0.8 }));
    m.add(I.bell(hz('D2'), 5, { type: 'gong', strike: 0.2, seed: 90 }), 0, 0.4, 0, { hall: 0.6 });
  }),
  lose: () => S(6, (m) => {
    [['D3', 'F3', 'A3'], ['C#3', 'E3', 'G3'], ['D3', 'F3', 'Bb3']].forEach((ch, c) => ch.forEach((n, k) =>
      m.add(I.choir(hz(n), 2, { vowel: 'u', voices: 4, a: 0.4, r: 1.4, seed: 91 + c * 3 + k }), c * 1.2, 0.4, (k - 1) * 0.4, { cave: 0.8 })));
    m.add(I.bell(hz('D2'), 5, { type: 'gong', strike: 0.2, seed: 99, decay: 1.2 }), 2.4, 0.6, 0, { cave: 0.7 });
    m.add(I.wind(5, { seed: 100, center: 400 }), 0.5, 0.6, 0, {});
  }),
};

// ======================================================= 3. Cinematic (heavy hybrid)

const cinema = {
  click: () => S(0.3, (m) => {
    const t = I.sub(140, 0.05, { a: 0.001, r: 0.03 });
    m.add(t, 0, 0.8, 0, {});
    m.add(I.rim({ seed: 1 }), 0, 0.25, 0, { room: 0.3 });
  }),
  choose: () => S(1.6, (m) => {
    m.add(I.bell(hz('A5'), 1.4, { type: 'tubular', strike: 0.15, seed: 2, decay: 0.5 }), 0, 0.55, 0, { hall: 0.5 });
  }),
  error: () => S(0.6, (m) => {
    m.add(eq(I.braam(hz('D2'), 0.3, { a: 0.005, r: 0.15, open: 0.05, peakF: 500, seed: 3 }), ['lp', 1200, 0.7]), 0, 0.8, 0, { room: 0.4 });
  }),
  card: () => S(0.8, (m) => {
    m.add(I.whoosh(0.16, { from: 600, to: 3000, q: 1, seed: 4, shape: 'rise' }), 0, 0.7, -0.2, {});
    m.add(I.boom({ f: 85, dur: 0.35, crack: 0.4, tail: 0.15, seed: 5 }), 0.14, 0.6, 0, { room: 0.4 });
  }),
  discard: () => S(0.6, (m) => {
    m.add(reverse(I.whoosh(0.2, { from: 4000, to: 900, q: 1, seed: 6, shape: 'decay' })), 0, 0.7, 0.2, { room: 0.3 });
  }),
  coin: () => S(1.4, (m) => {
    coinClink(m, 0, 2500, 0.7, -0.1, 7, { hall: 0.4 });
    coinClink(m, 0.05, 3700, 0.5, 0.15, 8, { hall: 0.4 });
    m.add(I.boom({ f: 95, dur: 0.3, crack: 0.2, tail: 0.12, seed: 9 }), 0, 0.5, 0, {});
  }),
  agent: () => S(1.6, (m) => {
    m.add(I.whoosh(0.25, { from: 2000, to: 9000, q: 2.5, seed: 10, shape: 'rise' }), 0, 0.5, 0.2, {});
    m.add(I.metal(1700, 1.3, { decay: 1.2, seed: 11 }), 0.24, 0.5, 0.2, { hall: 0.4 });
    m.add(I.taiko(75, { seed: 12, decay: 0.6 }), 0.24, 0.8, 0, { hall: 0.3 });
  }),
  toss: () => S(1.3, (m) => {
    m.add(I.whoosh(0.4, { from: 600, to: 5000, q: 1.5, seed: 13, shape: 'rise' }), 0, 0.5, 0, {});
    coinClink(m, 0.02, 3900, 0.6, 0, 14, { hall: 0.4 });
    m.add(I.metal(3100, 0.8, { decay: 0.8, seed: 15, modes: [1, 2.32, 4.25] }), 0.02, 0.3, 0, { hall: 0.3 });
  }),
  draft: () => S(3, (m) => {
    m.add(I.taiko(55, { seed: 16 }), 0, 1, 0, { hall: 0.5 });
    m.add(I.boom({ f: 42, dur: 1.5, crack: 0.3, tail: 0.8, seed: 17 }), 0, 0.6, 0, {});
    m.add(I.metal(640, 2.4, { decay: 2.2, seed: 18 }), 0, 0.45, 0, { hall: 0.6 });
  }),
  hit: () => S(1.4, (m) => {
    m.add(I.boom({ f: 58, dur: 0.8, crack: 1, tail: 0.35, seed: 19 }), 0, 1, 0, { room: 0.4, hall: 0.2 });
    m.add(I.metal(900, 0.8, { decay: 0.6, seed: 20 }), 0, 0.45, 0.2, { hall: 0.3 });
    m.add(I.taiko(70, { seed: 21, decay: 0.5 }), 0, 0.6, 0, {});
  }),
  knockout: () => S(3.5, (m) => {
    m.add(I.boom({ f: 40, dur: 2, crack: 1, tail: 1.2, seed: 22 }), 0, 1, 0, { hall: 0.4 });
    m.add(I.braam(hz('D1'), 1.6, { a: 0.005, r: 1, open: 0.08, peakF: 900, seed: 23 }), 0, 0.6, 0, { hall: 0.4 });
    m.add(I.crackle(0.9, { density: 500, f: 2500, q: 0.6, seed: 24, env: (k) => (1 - k) ** 2 }), 0.05, 0.5, 0, { hall: 0.4 });
  }),
  destroy: () => S(2.2, (m) => {
    m.add(I.whoosh(0.5, { from: 150, to: 2500, q: 0.8, seed: 25, shape: 'swell' }), 0, 1, 0, { hall: 0.4 });
    m.add(I.crackle(1.2, { density: 1600, f: 2200, q: 0.5, seed: 26, env: (k) => (1 - k) }), 0.15, 0.6, 0, { hall: 0.3 });
    m.add(I.boom({ f: 60, dur: 0.8, crack: 0.6, tail: 0.4, seed: 27 }), 0.18, 0.7, 0, { hall: 0.3 });
  }),
  patron: () => S(5.5, (m) => {
    m.add(I.braam(hz('D1'), 4, { a: 0.02, r: 2.5, open: 0.3, peakF: 1500, seed: 28 }), 0, 0.8, 0, { hall: 0.5 });
    m.add(I.taiko(52, { seed: 29 }), 0, 0.9, 0, { hall: 0.5 });
    [['D4', -0.3], ['A4', 0.3]].forEach(([n, p], k) => m.add(I.choir(hz(n), 2, { vowel: 'a', voices: 6, a: 0.05, r: 1.5, seed: 30 + k }), 0, 0.4, p, { hall: 0.8 }));
  }),
  prestige: () => S(3, (m) => {
    m.add(I.whoosh(0.5, { from: 300, to: 8000, q: 1.2, seed: 32, shape: 'rise' }), 0, 0.5, 0, {});
    ['D5', 'A5', 'D6'].forEach((n, k) => m.add(I.bell(hz(n), 2.4, { type: 'tubular', strike: 0.2, seed: 33 + k }), 0.48, 0.4, (k - 1) * 0.4, { hall: 0.6 }));
    m.add(I.boom({ f: 70, dur: 0.6, crack: 0.2, tail: 0.3, seed: 36 }), 0.48, 0.4, 0, {});
  }),
  myTurn: () => S(3.2, (m) => {
    m.add(I.taiko(60, { seed: 37 }), 0, 0.8, 0, { hall: 0.4 });
    m.add(I.taiko(60, { seed: 38 }), 0.2, 0.6, 0, { hall: 0.4 });
    m.add(I.braam(hz('D2'), 1.8, { a: 0.01, r: 1.2, open: 0.15, peakF: 1200, seed: 39 }), 0.2, 0.55, 0, { hall: 0.5 });
  }),
  theirTurn: () => S(3, (m) => {
    m.add(eq(I.taiko(50, { seed: 40 }), ['lp', 700, 0.7]), 0, 0.9, 0, { hall: 0.6 });
    m.add(I.pad(hz('D2'), 1.8, { a: 0.3, r: 1.2, cutoff: 300, seed: 41 }), 0, 0.6, 0, { hall: 0.5 });
  }),
  win: () => S(6, (m) => {
    m.add(I.braam(hz('D2'), 4.5, { a: 0.02, r: 2.5, open: 0.4, peakF: 2000, seed: 42 }), 0, 0.6, 0, { hall: 0.5 });
    [['D4', -0.5], ['F#4', 0], ['A4', 0.5]].forEach(([n, p], k) => {
      m.add(I.brass(hz(n), 3.5, { seed: 43 + k, a: 0.1, r: 1.5 }), 0, 0.4, p, { hall: 0.6 });
      m.add(I.choir(hz(n), 3.5, { vowel: 'a', voices: 5, a: 0.2, r: 1.8, seed: 46 + k }), 0, 0.35, -p, { hall: 0.8 });
    });
    [0, 0.15, 0.3].forEach((t, k) => m.add(I.taiko(58 + k * 8, { seed: 50 + k }), t, 0.7, 0, { hall: 0.4 }));
    m.add(I.bell(hz('D5'), 3, { type: 'tubular', seed: 53 }), 0.3, 0.35, 0.3, { hall: 0.7 });
  }),
  lose: () => S(6.5, (m) => {
    m.add(I.boom({ f: 38, dur: 3, crack: 0.5, tail: 1.6, seed: 54 }), 0, 0.9, 0, { hall: 0.4 });
    m.add(I.braam(hz('D1'), 4.5, { a: 0.02, r: 3, open: 0.5, peakF: 800, seed: 55 }), 0, 0.6, 0, { hall: 0.5 });
    m.add(I.pad(hz('F2'), 4.5, { a: 0.4, r: 2.5, cutoff: 500, seed: 56 }), 0, 0.4, -0.3, { hall: 0.5 });
    [0.9, 3].forEach((t, k) => m.add(I.bell(hz('D2'), 5, { strike: 0.2, seed: 57 + k }), t, 0.5, 0.2, { cave: 0.8 }));
  }),
};

export const PACKS = { foley, magic, cinema };

/** Loudness targets per event (dB, loudest 400 ms): small UI ticks sit well under the big moments. */
export const TARGET = {
  click: -27, choose: -24, error: -24, card: -22, discard: -24, coin: -22, agent: -21, toss: -22, draft: -20,
  hit: -19, knockout: -18, destroy: -20, patron: -18, prestige: -20, myTurn: -19, theirTurn: -21, win: -17, lose: -18,
};

void gain;
