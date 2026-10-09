// "Parchment and steel", second take: every sound is a real object hit, scraped or dropped in a small wooden tavern.
import { Mix, len, eq, gain, fadeOut, rng } from './dsp.mjs';
import * as F from './foley.mjs';

const TAVERN = { rt60: 0.75, size: 0.5, damp: 4200, pre: 0.008, gain: 0.7 };
const HALL = { rt60: 2.2, size: 1.1, damp: 3500, pre: 0.02, gain: 0.6 };

function S(dur, build) {
  const m = new Mix(dur, { room: TAVERN, hall: HALL });
  build(m);
  const [L, R] = m.render();
  let end = L.length;
  while (end > 1 && Math.abs(L[end - 1]) < 1e-4 && Math.abs(R[end - 1]) < 1e-4) end--;
  const l = L.slice(0, end + 200), r = R.slice(0, end + 200);
  fadeOut(l, 0.03); fadeOut(r, 0.03);
  return [l, r];
}

const norm = (b, to = 1) => {
  let p = 0;
  for (const v of b) p = Math.max(p, Math.abs(v));
  return gain(b, to / (p || 1));
};

const tableKnock = (seed, hard = 0.45, g = 1) => {
  const a = norm(F.hit('table', { seed, hard, dur: 0.6, contact: 0.1 }));
  const w = norm(F.hit('wood', { seed: seed + 3, hard: hard + 0.2, scale: 0.8, dur: 0.4, contact: 0.3 }));
  const t = norm(F.thump(0.35, { seed, f: 85 }));
  for (let i = 0; i < a.length; i++) a[i] = (a[i] * 0.55 + (w[i] ?? 0) * 0.6 + (t[i] ?? 0) * 0.35) * g;
  // Phone speakers start around 300 Hz: keep the body, push the knock.
  return eq(a, ['hp', 70, 0.7], ['ls', 250, 0.7, -7], ['peak', 1600, 1, 5], ['peak', 3500, 1.5, 3]);
};

const tankardBang = (m, t, seed, g = 1) => {
  m.add(tableKnock(seed, 0.55), t, 0.9 * g, -0.05, { room: 0.5 });
  m.add(norm(F.hit('pewter', { seed: seed + 50, hard: 0.45, scale: 0.75, dur: 0.8 })), t + 0.004, 0.22 * g, 0.1, { room: 0.6 });
};

const coins = (m, t, seed, n = 3, g = 1) => {
  // Coins dropped onto a small pile on the table: each one rings, rebounds and settles.
  const r = rng(seed);
  let at = t;
  for (let c = 0; c < n; c++) {
    const f0 = 2900 + r() * 1300;
    const onWood = c === 0 ? 0.6 : 0.15 + r() * 0.3;
    m.add(norm(F.coinDrop(seed + c * 7, { f0, onWood, bounces: 2 + Math.floor(r() * 3), settle: c === n - 1 || r() < 0.4, dur: 1.2 })), at, (0.6 - 0.07 * c) * g, (r() - 0.5) * 0.8, { room: 0.35 });
    at += 0.045 + r() * 0.07;
  }
  m.add(norm(F.hit('table', { seed, hard: 0.6, scale: 1.4, dur: 0.15 })), t, 0.08 * g, 0, { room: 0.3 });
};

const swordDraw = (m, t, seed, g = 1) => {
  const d = 0.42;
  const ex = F.friction(d, { rate: (k) => 900 + 2500 * k, level: (k) => Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.7, jitter: 0.8, seed, grit: 0.6 });
  const scrape = norm(eq(F.resonate(ex, F.modes('blade', seed), d + 0.1), ['hp', 1200, 0.7]));
  m.add(scrape, t, 0.45 * g, 0.2, { room: 0.4 });
  m.add(norm(F.hit('blade', { seed: seed + 1, hard: 0.6, dur: 1.6, contact: 0.02 })), t + d - 0.02, 0.35 * g, 0.25, { room: 0.5, hall: 0.2 });
};

export const steel = {
  click: () => S(0.25, (m) => {
    m.add(norm(eq(F.hit('wood', { seed: 1, hard: 0.9, scale: 2.2, dur: 0.08, contact: 0.6 }), ['hp', 700, 0.7])), 0, 0.8, 0, { room: 0.3 });
  }),
  choose: () => S(0.9, (m) => {
    m.add(norm(eq(F.hit('wood', { seed: 2, hard: 0.55, scale: 1.1, dur: 0.25, contact: 0.3 }), ['hp', 300, 0.7])), 0, 0.6, -0.15, { room: 0.5 });
    m.add(norm(eq(F.hit('wood', { seed: 2, hard: 0.5, scale: 1.1, dur: 0.25, contact: 0.3 }), ['hp', 300, 0.7])), 0.14, 0.5, -0.15, { room: 0.5 });
  }),
  error: () => S(0.6, (m) => {
    m.add(tableKnock(3, 0.15), 0, 0.9, 0, { room: 0.4 });
  }),
  card: () => S(0.6, (m) => {
    m.add(F.rustle(0.13, { lo: 2200, hi: 9000, grain: 120, seed: 4, env: (k) => Math.sin(Math.PI * k) ** 0.5 * (1 - 0.5 * k) }), 0, 0.5, 0.1, { room: 0.3 });
    m.add(norm(F.hit('card', { seed: 5, hard: 0.95, dur: 0.08, contact: 0.5 })), 0.12, 0.6, 0.05, { room: 0.4 });
    m.add(norm(F.hit('table', { seed: 6, hard: 0.35, dur: 0.3 })), 0.121, 0.3, 0, { room: 0.4 });
  }),
  discard: () => S(0.5, (m) => {
    m.add(F.rustle(0.2, { lo: 1500, hi: 7000, grain: 90, seed: 7, env: (k) => (1 - k) ** 1.5 }), 0, 0.55, -0.2, { room: 0.35 });
    m.add(norm(F.hit('card', { seed: 8, hard: 0.6, dur: 0.06, contact: 0.3 })), 0.17, 0.25, -0.2, { room: 0.4 });
  }),
  coin: () => S(1.1, (m) => coins(m, 0, 9, 3)),
  toss: () => S(1.3, (m) => {
    // Thumbnail flick, then the coin rings and wobbles as it spins in the air.
    m.add(norm(F.thump(0.05, { seed: 10, f: 300, depth: 0.3 })), 0, 0.15, 0, {});
    m.add(norm(F.coinFlick(11, { f0: 3500, dur: 1.1, spin: 17 })), 0.003, 0.6, 0, { room: 0.35 });
  }),
  agent: () => S(1.8, (m) => {
    const ex = F.friction(0.25, { rate: () => 70, level: (k) => Math.sin(Math.PI * k), jitter: 0.6, seed: 12, grit: 0.4 });
    m.add(norm(F.resonate(ex, F.modes('leather', 12), 0.3)), 0, 0.35, -0.2, { room: 0.4 });
    m.add(F.rustle(0.25, { lo: 600, hi: 4000, grain: 40, seed: 13 }), 0, 0.25, -0.2, { room: 0.3 });
    swordDraw(m, 0.12, 14);
  }),
  draft: () => S(1.8, (m) => {
    m.add(tableKnock(15, 0.5), 0, 0.8, 0, { room: 0.5 });
    m.add(norm(F.hit('iron', { seed: 16, hard: 0.6, scale: 0.9, dur: 1.4, contact: 0.05 })), 0.003, 0.45, 0.1, { room: 0.5, hall: 0.2 });
  }),
  hit: () => S(1.3, (m) => {
    m.add(F.rustle(0.09, { lo: 400, hi: 3000, grain: 200, seed: 17, env: (k) => k ** 2 }), 0, 0.5, -0.3, {});
    m.add(norm(F.hit('iron', { seed: 18, hard: 1, scale: 0.8, dur: 1, contact: 0.3 })), 0.09, 0.65, 0.1, { room: 0.5 });
    m.add(norm(F.hit('blade', { seed: 19, hard: 1, dur: 1, contact: 0.05 })), 0.09, 0.3, 0.2, { room: 0.5 });
    m.add(norm(F.thump(0.3, { seed: 20, f: 75 })), 0.09, 0.6, 0, { room: 0.3 });
  }),
  knockout: () => S(2, (m) => {
    m.add(norm(F.thump(0.7, { seed: 21, f: 60, depth: 2.2 })), 0, 1, 0, { room: 0.4 });
    m.add(norm(F.hit('table', { seed: 22, hard: 0.3, scale: 0.6, dur: 0.8 })), 0, 0.6, 0, { room: 0.5 });
    m.add(norm(F.bounces('chain', { seed: 23, count: 9, gap: 0.03, shrink: 0.9, decay: 0.8, hard: 0.8, dur: 0.7 })), 0.02, 0.3, 0.3, { room: 0.4 });
    m.add(norm(F.bounces('iron', { seed: 24, count: 3, gap: 0.16, shrink: 0.6, decay: 0.45, hard: 0.7, scale: 1.3, dur: 1.4 })), 0.08, 0.35, -0.25, { room: 0.5 });
  }),
  destroy: () => S(1.4, (m) => {
    const d = 0.45;
    const ex = F.friction(d, { rate: (k) => 2200 - 1400 * k, level: (k) => Math.sin(Math.PI * k) ** 0.4, jitter: 1, seed: 25, grit: 1 });
    m.add(norm(eq(F.resonate(ex, F.modes('card', 25), d + 0.05), ['hp', 900, 0.7])), 0, 0.5, 0.15, { room: 0.4 });
    m.add(F.rustle(0.9, { lo: 150, hi: 1400, grain: 25, seed: 26, env: (k) => Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - k) }), 0.15, 0.8, 0, { room: 0.4 });
    m.add(eq(F.fire(1, { seed: 27, pops: 14 }), ['hp', 600, 0.7]), 0.2, 0.5, -0.1, { room: 0.4 });
  }),
  patron: () => S(4, (m) => {
    m.add(norm(F.hit('iron', { seed: 28, hard: 0.55, scale: 0.32, dur: 3.8, contact: 0.02 })), 0, 0.5, 0, { room: 0.4, hall: 0.5 });
    m.add(norm(F.hit('iron', { seed: 128, hard: 0.75, scale: 0.75, dur: 3, contact: 0.05 })), 0.002, 0.7, 0.15, { room: 0.4, hall: 0.5 });
    m.add(norm(F.thump(0.8, { seed: 29, f: 55, depth: 2.5 })), 0, 0.8, 0, { room: 0.4, hall: 0.3 });
  }),
  prestige: () => S(1.6, (m) => {
    m.add(norm(eq(F.hit('pewter', { seed: 30, hard: 1, scale: 1.4, dur: 1.2, contact: 0.2 }), ['hp', 900, 0.7])), 0, 0.55, -0.2, { room: 0.5 });
    m.add(norm(eq(F.hit('pewter', { seed: 31, hard: 1, scale: 1.55, dur: 1.2, contact: 0.2 }), ['hp', 900, 0.7])), 0.006, 0.5, 0.2, { room: 0.5 });
  }),
  myTurn: () => S(1.2, (m) => {
    tankardBang(m, 0, 32);
    tankardBang(m, 0.24, 33, 0.85);
  }),
  theirTurn: () => S(1.6, (m) => {
    m.add(norm(eq(F.creak(0.65, { seed: 34, from: 38, to: 24, scale: 1.6 }), ['hp', 220, 0.7])), 0, 0.4, 0.3, { room: 0.5 });
    m.add(tableKnock(35, 0.35), 0.55, 0.6, -0.1, { room: 0.6 });
  }),
  win: () => S(3, (m) => {
    tankardBang(m, 0, 36);
    tankardBang(m, 0.22, 37, 0.9);
    tankardBang(m, 0.44, 38, 1.05);
    coins(m, 0.62, 39, 3, 0.9);
    coins(m, 0.75, 49, 3, 0.7);
    m.add(norm(F.hit('pewter', { seed: 40, hard: 0.8, dur: 1.4 })), 1.05, 0.5, -0.2, { room: 0.5 });
    m.add(norm(F.hit('pewter', { seed: 41, hard: 0.8, scale: 1.1, dur: 1.4 })), 1.056, 0.45, 0.2, { room: 0.5 });
  }),
  lose: () => S(3.2, (m) => {
    m.add(norm(eq(F.creak(0.9, { seed: 42, from: 30, to: 20, scale: 1.3 }), ['hp', 200, 0.7])), 0, 0.45, -0.3, { room: 0.5 });
    m.add(norm(F.bounces('pewter', { seed: 43, count: 6, gap: 0.22, shrink: 0.72, decay: 0.55, hard: 0.6, scale: 0.8, dur: 2.4 })), 0.7, 0.55, 0.2, { room: 0.5 });
    m.add(norm(F.thump(0.6, { seed: 44, f: 60, depth: 2 })), 0.7, 0.5, 0, { room: 0.5 });
  }),
};

void len;
