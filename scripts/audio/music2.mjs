// Second round: the menu theme "Crypt" reworked, and a slow, grim tavern for the match itself.
import { Mix, foldLoopAt, hz, nm, mtof, rng, xfade, eq } from './dsp.mjs';
import * as I from './instruments.mjs';
import * as F from './foley.mjs';

const OFF = 3; // seconds rendered before the loop starts, so the first notes can fade in

const BED = 4; // overlap of continuous beds (wind, fire, crowd) across the loop seam

/** Fades a continuous bed in and out, so its end cross-fades into its own start at the loop seam. */
const bed = (b) => {
  const e = xfade(BED)(b.length);
  for (let i = 0; i < b.length; i++) b[i] *= e[i];
  return b;
};

const scaleBy = (b, g) => { for (let i = 0; i < b.length; i++) b[i] *= g; return b; };

/** Wraps an envelope with a slow breathing swell, so long chords are alive but never pump. */
const breathe = (shape, rate, seed) => (n) => {
  const e = shape(n);
  for (let i = 0; i < n; i++) e[i] *= 1 + 0.1 * Math.sin(seed * 1.7 + (2 * Math.PI * rate * i) / 44100);
  return e;
};

/** Singer's phrasing: swell into each long note and ease off before the next. */
const phrase = (steps, total) => (n) => {
  const e = xfade(2, 2.5)(n);
  for (let i = 0; i < n; i++) {
    const t = i / 44100;
    let k = 0;
    while (k + 1 < steps.length && steps[k + 1][0] <= t) k++;
    const st = steps[k][0], en = k + 1 < steps.length ? steps[k + 1][0] : total;
    const u = (t - st) / (en - st);
    e[i] *= 0.82 + 0.18 * Math.sin(Math.PI * Math.min(1, u * 1.15));
  }
  return e;
};

/** Pitch ratio over time for a singer moving through [time, midi] steps with a short glide between them. */
function glideTo(steps, ref, g) {
  return (t) => {
    let i = 0;
    while (i + 1 < steps.length && steps[i + 1][0] <= t) i++;
    let m = steps[i][1];
    if (i > 0 && t - steps[i][0] < g) {
      const k = (t - steps[i][0]) / g, s = k * k * (3 - 2 * k);
      m = steps[i - 1][1] + (m - steps[i - 1][1]) * s;
    }
    return mtof(m) / ref;
  };
}

// ------------------------------------------------------------- Crypt, reworked for the menu

export function crypt2() {
  const BAR = 8, loop = BAR * 12;
  const m = new Mix(loop + OFF + 12, { hall: { rt60: 6.5, size: 1.7, damp: 4200, pre: 0.03, gain: 0.85 } });
  const r = rng(111);
  // Four-part voicings with smooth voice leading; every chord is plain and consonant.
  const prog = [
    ['Dm', ['D3', 'A3', 'F4', 'A4']], ['Bb', ['D3', 'Bb3', 'F4', 'Bb4']], ['Gm', ['D3', 'Bb3', 'G4', 'Bb4']], ['A', ['C#3', 'A3', 'E4', 'A4']],
    ['Dm', ['D3', 'A3', 'F4', 'A4']], ['F', ['C3', 'A3', 'F4', 'A4']], ['Bb', ['Bb2', 'F3', 'D4', 'F4']], ['A', ['A2', 'E3', 'C#4', 'E4']],
    ['Dm', ['D3', 'A3', 'F4', 'A4']], ['Gm', ['Bb2', 'G3', 'D4', 'G4']], ['Dm', ['A2', 'A3', 'D4', 'F4']], ['A', ['A2', 'E3', 'C#4', 'E4']],
  ];
  const ROOT = { Dm: 'D2', Bb: 'Bb1', Gm: 'G1', A: 'A1', F: 'F1' };
  const TONES = { Dm: ['D', 'F', 'A'], Bb: ['Bb', 'D', 'F'], Gm: ['G', 'Bb', 'D'], A: ['A', 'C#', 'E'], F: ['F', 'A', 'C'] };
  const X = 1.2; // short cross-fade for the low pad and sub
  const len2 = loop + 4;
  // Each choir part is one singer line that glides to the next chord, so chords never overlap.
  for (let k = 0; k < 4; k++) {
    const steps = prog.map(([, v], b) => [b * BAR, nm(v[k])]);
    steps.push([loop, nm(prog[0][1][k])]);
    const ref = mtof(steps[0][1]);
    const type = k === 0 ? 'bass' : k === 1 ? 'tenor' : 'alto';
    const [l, rr] = I.choirSmooth(ref, len2, { vowel: k === 3 ? 'u' : 'o', seed: 10 + k, vib: 0.003, type, pitch: glideTo(steps, ref, 0.7), shape: breathe(xfade(4), 0.06 + k * 0.013, k) });
    const g = k === 0 ? 0.55 : 0.42, p = [-0.2, -0.5, 0.45, 0.15][k];
    m.add2(scaleBy(l, g * (1 - p * 0.5)), scaleBy(rr, g * (1 + p * 0.5)), OFF, 1, { hall: 0.8 });
  }
  prog.forEach(([name], b) => {
    const t = OFF + b * BAR - X / 2;
    // Root follows the harmony in the bass, so nothing grinds against it.
    m.add(I.sub(hz(ROOT[name]), BAR + X, { a: 0.01, r: 0.01 }).map((v, i, a) => v * Math.sin((Math.PI / 2) * Math.min(1, i / (X * 44100), (a.length - i) / (X * 44100)))), t, 0.22, 0, {});
    // Glass sparks use only the notes of the current chord.
    for (let s = 0; s < 2; s++) {
      if (r() < 0.35) continue;
      const tone = TONES[name][Math.floor(r() * 3)];
      m.add(I.bell(hz(tone + (r() < 0.5 ? '6' : '5')), 5, { type: 'glass', strike: 0, seed: b * 2 + s }), OFF + b * BAR + 1 + r() * 6, 0.07, r() * 1.4 - 0.7, { hall: 2 });
    }
  });
  // Lament: legato soprano, every long note a tone of its chord.
  const lament = [['A4', 6], ['G4', 2], ['F4', 8], ['Bb4', 6], ['A4', 2], ['A4', 4], ['E4', 4], ['F4', 6], ['E4', 2], ['D4', 4], ['G4', 4], ['A4', 6], ['G4', 2], ['E4', 4], ['C#4', 4]];
  const lsteps = [];
  let lt = 0;
  for (const [note, d] of lament) { lsteps.push([lt, nm(note)]); lt += d; }
  const lref = mtof(lsteps[0][1]);
  const [ll, lr] = I.choirSmooth(lref, lt, { vowel: 'a', to: 'o', vib: 0.0055, seed: 70, type: 'soprano', pitch: glideTo(lsteps, lref, 0.35), shape: phrase(lsteps, lt) });
  m.add2(scaleBy(ll, 0.45), scaleBy(lr, 0.45), OFF + 4 * BAR, 1, { hall: 1 });
  // Funeral bell every other chord (never under the A chords), deep in the hall.
  for (const b of [0, 2, 4, 6, 8, 10]) m.add(I.bell(hz('D3'), 10, { strike: 0.12, seed: b }), OFF + b * BAR, 0.3, -0.35, { hall: 1.3 });
  // Distant drums: muffled, mostly reverb.
  for (const b of [1, 5, 9]) {
    m.add(eq(I.taiko(50, { seed: b }), ['lp', 500, 0.7]), OFF + b * BAR, 0.12, 0, { hall: 1.4 });
    m.add(eq(I.taiko(50, { seed: b + 50 }), ['lp', 500, 0.7]), OFF + b * BAR + 0.5, 0.07, 0, { hall: 1.4 });
  }
  m.add(bed(I.wind(loop + BED, { seed: 3, center: 420, rate: 0.05 })), OFF - BED / 2, 0.45, -0.6, { hall: 0.2 });
  m.add(bed(I.wind(loop + BED, { seed: 4, center: 900, rate: 0.04, q: 3 })), OFF - BED / 2, 0.3, 0.6, { hall: 0.2 });
  return foldLoopAt(m.render(), OFF, loop);
}

// ------------------------------------------------------------- The den: a slow, grim tavern for the match

export function den({ room = true } = {}) {
  const BEAT = 0.85, BAR = 3 * BEAT, bars = 32, loop = bars * BAR;
  const m = new Mix(loop + OFF + 8, {
    room: { rt60: 1.1, size: 0.65, damp: 3800, pre: 0.01, gain: 0.75 },
    far: { rt60: 2.4, size: 1.2, damp: 2500, pre: 0.025, gain: 0.7 },
  });
  const r = rng(222);
  const CH = { Dm: ['D', 'F', 'A'], Gm: ['G', 'Bb', 'D'], Bb: ['Bb', 'D', 'F'], A: ['A', 'C#', 'E'] };
  const P1 = ['Dm', 'Dm', 'Gm', 'Dm', 'Bb', 'Gm', 'A', 'A'], P2 = ['Dm', 'Bb', 'Gm', 'Dm', 'Gm', 'Bb', 'A', 'A'];
  const chords = [...P1, ...P2, ...P1, ...P2];
  const T = (bar, beat = 0) => OFF + bar * BAR + beat * BEAT;
  const tuneOf = (k) => 2 ** (((r() - 0.5) * 12) / 1200) * k; // a careless player's lute

  // Low bowed drone on D and A, breathing slowly.
  for (const [note, pan, seed] of [['D2', -0.3, 1], ['A2', 0.3, 2]]) {
    for (const start of [0, loop / 2]) {
      m.add(I.strings(hz(note), loop / 2 + 6, { voices: 1, bright: 700, vib: 0, seed, swell: 0.4, shape: xfade(6) }), OFF + start - 3, 0.18, pan, { room: 0.4 });
    }
  }
  // Lute: bass on one, a rolled dyad on two, sometimes a lone high note on three.
  chords.forEach((c, b) => {
    const [root, third, fifth] = CH[c];
    const bass = nm(root + '2') < nm('G2') ? nm(root + '3') : nm(root + '2');
    const late = () => (r() - 0.3) * 0.05;
    const v = () => 0.75 + r() * 0.25;
    m.add(I.pluck(tuneOf(mtof(bass)), 3, { bright: 0.3, t60: 2.4, seed: b * 7 }), T(b) + late(), 0.33 * v(), -0.1, { room: 0.45 });
    if (b % 8 !== 7 || r() < 0.5) {
      const dy = [nm(third + '3'), nm(fifth + '3')].map((x) => (x < bass + 3 ? x + 12 : x));
      dy.forEach((x, k) => m.add(I.pluck(tuneOf(mtof(x)), 2.5, { bright: 0.28, t60: 2, seed: b * 7 + 1 + k }), T(b, 1) + k * 0.035 + late(), 0.24 * v(), 0.15, { room: 0.45 }));
    }
    if (r() < 0.45) m.add(I.pluck(tuneOf(hz(root + '4')), 2, { bright: 0.35, t60: 1.6, seed: b * 7 + 5 }), T(b, 2) + late(), 0.17 * v(), 0.25, { room: 0.5 });
  });
  // Fiddle: a tired, mournful tune in the second and fourth phrases.
  const tune1 = [[['A4', 2], ['F4', 1]], [['D4', 3]], [['G4', 1.5], ['A4', 0.5], ['Bb4', 1]], [['A4', 3]], [['F4', 2], ['D4', 1]], [['G4', 2], ['D4', 1]], [['E4', 2], ['C#4', 1]], [['E4', 3]]];
  const tune2 = [[['D5', 2], ['C5', 1]], [['Bb4', 2], ['A4', 1]], [['G4', 3]], [['F4', 2], ['E4', 1]], [['D4', 2], ['G4', 1]], [['F4', 3]], [['E4', 1.5], ['F4', 0.5], ['E4', 1]], [['C#4', 3]]];
  const fiddle = (tune, start) => tune.forEach((bar, bi) => {
    let bt = 0;
    for (const [note, d] of bar) {
      m.add(I.cello(hz(note), d * BEAT + 0.35, { a: 0.32, r: 0.5, vib: 0.0045, bright: 1450, swell: 0.55, seed: start * 10 + bi * 3 + bt * 2 }), T(start + bi, bt), 0.2, -0.2, { room: 0.5, far: 0.45 });
      bt += d;
    }
  });
  fiddle(tune1, 8);
  fiddle(tune2, 24);
  // A muffled frame drum like a slow heartbeat.
  for (let b = 8; b < 32; b++) {
    if (b < 24 && b % 2) continue;
    m.add(eq(I.frame(78, { seed: b, decay: 0.5 }), ['lp', 700, 0.7]), T(b), 0.3, 0, { room: 0.5 });
  }
  // The room: a hearth, a few grim drinkers mumbling, mugs and creaking benches.
  if (!room) return foldLoopAt(m.render(), OFF, loop);
  m.add(bed(F.fire(loop + BED, { seed: 5, pops: 3 })), OFF - BED / 2, 0.48, -0.6, { room: 0.3 });
  const talkers = [[95, -0.7], [118, 0.6], [86, -0.2], [132, 0.35], [104, 0.8], [180, -0.45]];
  talkers.forEach(([f0, pan], k) => m.add(bed(I.talker(loop + BED, { seed: 300 + k, f0, rate: 3.4, talk: 0.3 })), OFF - BED / 2, 0.26, pan, { far: 0.6 }));
  for (let i = 0; i < 9; i++) {
    const t = OFF + r() * loop;
    m.add(eq(F.hit('pewter', { seed: 400 + i, hard: 0.5, scale: 1 + r() * 0.5, dur: 0.8, contact: 0.1 }), ['hp', 500, 0.7]), t, 0.08, r() * 1.6 - 0.8, { far: 0.7 });
    if (r() < 0.5) m.add(eq(F.hit('pewter', { seed: 450 + i, hard: 0.5, scale: 1.2, dur: 0.8 }), ['hp', 500, 0.7]), t + 0.006, 0.07, r() * 1.6 - 0.8, { far: 0.7 });
  }
  for (let i = 0; i < 5; i++) m.add(eq(F.creak(0.6 + r() * 0.5, { seed: 500 + i, from: 35 + r() * 15, to: 22, scale: 1.4 }), ['hp', 200, 0.7]), OFF + r() * loop, 0.095, r() * 1.6 - 0.8, { far: 0.6 });
  for (let i = 0; i < 3; i++) m.add(eq(F.hit('table', { seed: 600 + i, hard: 0.5, dur: 0.5 }), ['hp', 150, 0.7]), OFF + r() * loop, 0.032, r() - 0.5, { far: 0.8 });
  return foldLoopAt(m.render(), OFF, loop);
}

/** The same den without the crowd and room noises, music only. */
export const denQuiet = () => den({ room: false });

export const THEMES2 = { crypt2, den, denQuiet };
