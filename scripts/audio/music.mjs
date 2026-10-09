// Four candidate background themes for Dark Realm, all in D minor so they can share stingers.
import { Mix, foldLoop, hz, nm, mtof, rng } from './dsp.mjs';
import * as I from './instruments.mjs';

const HALL = { rt60: 5, size: 1.5, damp: 4500, pre: 0.03, gain: 0.9 };
const ROOM = { rt60: 1.4, size: 0.7, damp: 6000, pre: 0.01, gain: 0.8 };
const TAVERN = { rt60: 1.8, size: 0.8, damp: 5000, pre: 0.012, gain: 0.7 };

const CH = {
  Dm: ['D', 'F', 'A'], Bb: ['Bb', 'D', 'F'], Gm: ['G', 'Bb', 'D'], A: ['A', 'C#', 'E'], C: ['C', 'E', 'G'],
  F: ['F', 'A', 'C'], Am: ['A', 'C', 'E'], Eb: ['Eb', 'G', 'Bb'], A7: ['A', 'C#', 'G'],
};
const at = (name, oct) => nm(name + oct);

// ------------------------------------------------------------- 1. Crypt: dark ambient

export function crypt() {
  const BAR = 8, bars = 12, loop = BAR * bars;
  const m = new Mix(loop + 12, { hall: { ...HALL, rt60: 6.5, size: 1.7 } });
  const r = rng(101);
  // Choir voicings (bass, tenor, alto) per chord.
  const prog = [
    ['D2', 'A2', 'F3', 'D4'], ['D2', 'Bb2', 'F3', 'D4'], ['D2', 'Bb2', 'G3', 'D4'], ['C#2', 'A2', 'E3', 'C#4'],
    ['D2', 'A2', 'F3', 'D4'], ['C2', 'A2', 'F3', 'C4'], ['Bb1', 'F2', 'D3', 'Bb3'], ['A1', 'E2', 'D3', 'A3'],
    ['D2', 'A2', 'F3', 'D4'], ['D2', 'Bb2', 'G3', 'Eb4'], ['Bb1', 'G2', 'D3', 'Bb3'], ['A1', 'E2', 'C#3', 'A3'],
  ];
  // Bar 7 is A sus4 resolving: last voice moves D3 -> C#3 halfway.
  prog.forEach((ch, b) => {
    const t = b * BAR;
    ch.forEach((note, k) => {
      const f = hz(note);
      if (k === 0) {
        m.add(I.choir(f * 2, BAR + 3, { vowel: 'u', voices: 3, a: 2.5, r: 3, seed: b * 7 + k, type: 'bass' }), t, 0.55, -0.2, { hall: 0.5 });
      } else {
        const vowel = b % 4 === 3 ? 'a' : 'o';
        m.add(I.choir(f * 2, BAR + 3, { vowel: 'u', to: vowel, voices: 4, a: 2.5, r: 3, seed: b * 7 + k }), t, 0.42, (k - 2) * 0.45, { hall: 0.8 });
      }
    });
    if (b === 7) m.add(I.choir(hz('C#4'), BAR / 2 + 3, { vowel: 'o', voices: 4, a: 1.5, r: 3, seed: 900 }), t + BAR / 2, 0.42, 0.45, { hall: 0.8 });
    // Low pad doubles the root.
    m.add(I.pad(hz(ch[0]), BAR + 4, { a: 3, r: 4, cutoff: 380, seed: 40 + b }), t, 0.6, 0, { hall: 0.3 });
  });
  // Sub drone for the whole loop (rendered as two overlapping halves so it folds smoothly).
  for (const t of [0, loop / 2]) m.add(I.sub(hz('D1'), loop / 2 + 8, { a: 4, r: 4 }), t, 0.2, 0, {});
  // Soprano lament over the second half of the loop.
  const lament = [['A4', 4], ['Bb4', 4], ['A4', 6], ['G4', 2], ['F4', 4], ['E4', 4], ['D4', 8], ['F4', 4], ['G4', 4], ['Eb4', 6], ['D4', 2], ['C#4', 8]];
  let t = 4 * BAR;
  for (const [note, d] of lament) {
    m.add(I.choir(hz(note), d + 2.5, { vowel: 'a', to: 'o', voices: 5, a: 0.9, r: 2.2, vib: 0.006, seed: Math.round(t * 3) }), t, 0.55, 0.1, { hall: 1 });
    t += d;
  }
  // Funeral bell every two chords, deep in the hall.
  for (let b = 0; b < bars; b += 2) m.add(I.bell(hz('D3'), 10, { strike: 0.2, seed: b }), b * BAR + 0.05, 0.42, -0.35, { hall: 1.2 });
  m.add(I.bell(hz('A2'), 10, { strike: 0.2, seed: 77 }), 7 * BAR + 0.05, 0.35, 0.35, { hall: 1.2 });
  // Glassy sparks high above.
  const sparks = ['D6', 'F6', 'A6', 'C7', 'E6', 'D7'];
  for (let i = 0; i < 22; i++) {
    const tt = r() * loop;
    m.add(I.bell(hz(sparks[Math.floor(r() * sparks.length)]), 4, { type: 'glass', strike: 0, seed: i }), tt, 0.09, r() * 1.6 - 0.8, { hall: 2 });
  }
  // Distant war drums every 16 s.
  for (let b = 1; b < bars; b += 2) {
    m.add(I.taiko(52, { seed: b }), b * BAR, 0.32, 0, { hall: 1.2 });
    m.add(I.taiko(52, { seed: b + 50 }), b * BAR + 0.42, 0.18, 0, { hall: 1.2 });
  }
  m.add(I.wind(loop + 10, { seed: 3, center: 420, rate: 0.05 }), 0, 0.5, -0.6, { hall: 0.2 });
  m.add(I.wind(loop + 10, { seed: 4, center: 900, rate: 0.04, q: 3 }), 0, 0.35, 0.6, { hall: 0.2 });
  return foldLoop(m.render(), loop);
}

// ------------------------------------------------------------- 2. Shadow tavern: dark folk in 6/8

export function tavern() {
  const E = 0.3, BAR = 6 * E;
  const phraseA = ['Dm', 'C', 'Dm', 'Am', 'Bb', 'C', 'Dm', 'Dm'];
  const phraseB = ['F', 'C', 'Dm', 'Bb', 'Gm', 'A', 'Dm', 'A'];
  const form = [
    ...['Dm', 'Dm', 'C', 'Dm'].map((c) => ({ c, part: 'intro' })),
    ...phraseA.map((c) => ({ c, part: 'A' })),
    ...phraseA.map((c) => ({ c, part: 'A2' })),
    ...phraseB.map((c) => ({ c, part: 'B' })),
    ...phraseA.map((c) => ({ c, part: 'A3' })),
    ...['Dm', 'C', 'Bb', 'A'].map((c) => ({ c, part: 'outro' })),
  ];
  const loop = form.length * BAR;
  const m = new Mix(loop + 6, { room: TAVERN, hall: { ...HALL, rt60: 3.2, gain: 0.5 } });
  const r = rng(202);
  // Hurdy-gurdy drone across the whole piece, two halves.
  const buzz = [];
  form.forEach((b, i) => { if (b.part !== 'intro' && b.part !== 'outro') { buzz.push(i * BAR, i * BAR + 3 * E); } });
  const half = loop / 2;
  for (const t0 of [0, half]) {
    m.add(I.gurdy(hz('D3'), half + 3, { a: 1.5, r: 2, buzz: buzz.filter((x) => x >= t0 && x < t0 + half).map((x) => x - t0), seed: t0 ? 2 : 1 }), t0, 0.32, -0.25, { room: 0.4 });
  }
  form.forEach((b, i) => {
    const t = i * BAR;
    const [root, third, fifth] = CH[b.c];
    // Lute arpeggio: root low, fifth, octave, third, octave, fifth.
    const lowOct = ['A', 'Bb', 'C'].includes(root) ? 2 : 2;
    const notes = [at(root, lowOct), at(fifth, 3) < at(root, lowOct) ? at(fifth, 4) : at(fifth, 3), at(root, 3), at(third, 4) - (at(third, 4) - at(root, 3) > 12 ? 12 : 0), at(root, 3), at(fifth, 3)];
    notes.forEach((nn, k) => {
      const f = mtof(nn);
      const acc = k === 0 ? 1 : k === 3 ? 0.8 : 0.6;
      m.add(I.pluck(f, 2.4, { bright: 0.45 + 0.2 * acc, t60: 2.2, seed: i * 6 + k }), t + k * E + (r() - 0.5) * 0.012, 0.55 * acc, k % 2 ? 0.3 : 0.15, { room: 0.5 });
    });
    // Frame drum: boom on 1 and 4, ghost taps between.
    if (b.part !== 'intro') {
      const full = b.part !== 'outro';
      m.add(I.frame(95, { seed: i }), t, 0.6, -0.1, { room: 0.5 });
      if (full) m.add(I.frame(118, { seed: i + 300, decay: 0.3 }), t + 3 * E, 0.45, -0.1, { room: 0.5 });
      if (full && b.part !== 'A') {
        m.add(I.rim({ seed: i }), t + 2 * E, 0.25, 0.3, { room: 0.6 });
        m.add(I.rim({ seed: i + 1 }), t + 5 * E, 0.22, 0.3, { room: 0.6 });
        if (i % 4 === 3) m.add(I.rim({ seed: i + 2 }), t + 5.5 * E, 0.15, 0.3, { room: 0.6 });
      }
    }
  });
  // Melodies.
  const melA = [
    [['A4', 3], ['D5', 2], ['E5', 1]], [['F5', 2], ['E5', 1], ['D5', 2], ['C5', 1]], [['D5', 3], ['A4', 3]], [['C5', 2], ['Bb4', 1], ['A4', 3]],
    [['F5', 3], ['D5', 2], ['Bb4', 1]], [['C5', 2], ['E5', 1], ['G5', 3]], [['F5', 2], ['E5', 1], ['D5', 2], ['C#5', 1]], [['D5', 6]],
  ];
  const melB = [
    [['F4', 2], ['A4', 1], ['C5', 3]], [['E5', 2], ['D5', 1], ['C5', 3]], [['D5', 2], ['F5', 1], ['A5', 3]], [['G5', 2], ['F5', 1], ['D5', 3]],
    [['Bb4', 2], ['D5', 1], ['G5', 2], ['F5', 1]], [['E5', 3], ['C#5', 3]], [['D5', 2], ['E5', 1], ['F5', 2], ['E5', 1]], [['E5', 3], ['A4', 3]],
  ];
  const counterA = ['F4', 'E4', 'F4', 'E4', 'D4', 'E4', 'F4', 'F4'];
  const play = (mel, startBar, voice, oct = 0, g = 1) => {
    mel.forEach((bar, bi) => {
      let e = 0;
      for (const [note, d] of bar) {
        const t = (startBar + bi) * BAR + e * E;
        const f = hz(note) * 2 ** oct;
        const dur = d * E + 0.25;
        if (voice === 'flute') m.add(I.flute(f, dur, { seed: Math.round(t * 10), breath: 0.14 }), t, 0.5 * g, 0.2, { room: 0.5, hall: 0.4 });
        else m.add(I.cello(f, dur + 0.1, { a: 0.07, r: 0.3, seed: Math.round(t * 10), bright: 3600, swell: 0.3 }), t, 0.42 * g, -0.3, { room: 0.5, hall: 0.4 });
        e += d;
      }
    });
  };
  const startOf = (part) => form.findIndex((b) => b.part === part);
  play(melA, startOf('A'), 'flute');
  play(melA, startOf('A2'), 'flute');
  counterA.forEach((note, bi) => {
    const t = (startOf('A2') + bi) * BAR;
    m.add(I.cello(hz(note), BAR + 0.3, { a: 0.4, r: 0.4, seed: bi + 70, swell: 0.5 }), t, 0.35, -0.35, { room: 0.5, hall: 0.4 });
  });
  play(melB, startOf('B'), 'fiddle');
  play(melB.map((bar) => bar.map(([n, d]) => [n, d])), startOf('B'), 'flute', -1, 0.45);
  play(melA, startOf('A3'), 'flute');
  play(melA, startOf('A3'), 'fiddle', -1, 0.9);
  return foldLoop(m.render(), loop);
}

// ------------------------------------------------------------- 3. Battle: hybrid cinematic

export function battle() {
  const BEAT = 0.625, BAR = 4 * BEAT, S = BEAT / 4, bars = 32, loop = bars * BAR;
  const m = new Mix(loop + 8, { hall: { ...HALL, rt60: 3.8, gain: 0.8 }, room: ROOM });
  const r = rng(303);
  const progA = ['Dm', 'Bb', 'Gm', 'A'], progB = ['Dm', 'Bb', 'C', 'A'];
  const chordOf = (b) => (Math.floor(b / 4) % 2 ? progB : progA)[b % 4];
  const ROOT = { Dm: 'D2', Bb: 'Bb1', Gm: 'G1', A: 'A1', C: 'C2' };
  const OST = [0, 0, 0, 12, 0, 0, 7, 0, 0, 0, 0, 12, 0, 0, 3, 5];
  const ACC = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  for (let b = 0; b < bars; b++) {
    const t = b * BAR, ch = chordOf(b), root = nm(ROOT[ch]);
    const sec = b < 4 ? 'intro' : b < 8 ? 'drums' : b < 16 ? 'theme' : b < 24 ? 'full' : b < 28 ? 'break' : 'build';
    // Ostinato.
    const ostG = sec === 'break' ? 0.35 : sec === 'intro' ? 0.7 : 1;
    OST.forEach((o, k) => {
      const off = ch === 'A' && o === 3 ? 4 : ch === 'Bb' || ch === 'C' ? (o === 3 ? 4 : o) : o;
      m.add(I.spiccato(mtof(root + 12 + off), { seed: b * 16 + k, accent: ACC[k], bright: sec === 'break' ? 1200 : 2200 }), t + k * S, (0.32 + 0.18 * ACC[k]) * ostG, k % 2 ? 0.25 : -0.25, { room: 0.4, hall: 0.15 });
    });
    // Pad and sub on every bar.
    const tones = CH[ch].map((n, k) => at(n, 3) + (k && at(n, 3) < at(CH[ch][0], 3) ? 12 : 0));
    for (const nn of tones) m.add(I.pad(mtof(nn), BAR + 2, { a: 0.6, r: 1.8, cutoff: sec === 'full' ? 1600 : 900, seed: b * 3 + nn }), t, 0.22, (nn % 3 - 1) * 0.4, { hall: 0.5 });
    m.add(I.sub(mtof(root), BAR + 0.6, { a: 0.05, r: 0.5 }), t, 0.45, 0, {});
    // Drums.
    if (sec === 'drums' || sec === 'theme' || sec === 'full' || sec === 'build') {
      const big = sec === 'full' ? 1 : 0.75;
      [[0, 1], [6, 0.7], [8, 0.55], [10, 0.85]].forEach(([s, v]) => m.add(I.taiko(58, { seed: b * 10 + s }), t + s * S, 0.55 * v * big, 0, { hall: 0.35, room: 0.3 }));
      if (b % 4 === 3 || sec === 'build') [12, 13, 14, 15].forEach((s, k) => m.add(I.taiko(96, { seed: b * 10 + s, decay: 0.5 }), t + s * S, (0.2 + 0.1 * k) * big, (k % 2 ? 0.3 : -0.3), { hall: 0.3, room: 0.3 }));
      if (sec === 'full') [2, 5, 9, 13].forEach((s) => m.add(I.rim({ seed: b * 4 + s }), t + s * S, 0.18, 0.4, { room: 0.5 }));
    }
    if (sec === 'build') {
      const k = (b - 28) / 4;
      for (let s = 0; s < 16; s += 2) m.add(I.frame(140, { seed: b * 16 + s }), t + s * S, 0.15 + 0.3 * k, 0.2, { room: 0.4 });
    }
  }
  // Braams at the big entrances.
  for (const b of [8, 16, 20]) m.add(I.braam(hz('D1'), 5, { seed: b }), b * BAR, 0.55, 0, { hall: 0.6 });
  m.add(I.boom({ seed: 2 }), 16 * BAR, 0.5, 0, { hall: 0.6 });
  m.add(I.whoosh(BAR * 2, { from: 200, to: 6000, q: 1.5, shape: 'rise', seed: 9 }), 30 * BAR, 0.5, 0, { hall: 0.5 });
  // Low choir bed from bar 4.
  for (let b = 4; b < 24; b++) {
    const ch = chordOf(b);
    [at(CH[ch][0], 3), at(CH[ch][2], 3) - (at(CH[ch][2], 3) > at(CH[ch][0], 3) + 9 ? 12 : 0)].forEach((nn, k) =>
      m.add(I.choir(mtof(nn), BAR + 2, { vowel: 'o', voices: 3, a: 0.8, r: 1.6, seed: b * 2 + k }), b * BAR, 0.35, k ? 0.4 : -0.4, { hall: 0.8 }));
  }
  // Cello theme bars 8-15, repeated an octave higher by the choir and cellos in 16-23.
  const theme = [
    [['D3', 2], ['F3', 1], ['A3', 1]], [['Bb3', 3], ['A3', 1]], [['G3', 2], ['Bb3', 1], ['D4', 1]], [['C#4', 2], ['A3', 2]],
    [['D4', 3], ['E4', 1]], [['F4', 2], ['D4', 2]], [['E4', 2], ['C4', 2]], [['C#4', 4]],
  ];
  const playTheme = (startBar, oct, inst, g) => theme.forEach((bar, bi) => {
    let bt = 0;
    for (const [note, d] of bar) {
      const t = (startBar + bi) * BAR + bt * BEAT, f = hz(note) * 2 ** oct;
      if (inst === 'cello') m.add(I.cello(f, d * BEAT + 0.3, { a: 0.12, r: 0.5, seed: Math.round(t * 7), swell: 0.4 }), t, g, -0.15, { hall: 0.5 });
      else m.add(I.choir(f, d * BEAT + 1, { vowel: 'a', voices: 6, a: 0.25, r: 1.2, vib: 0.006, seed: Math.round(t * 7) }), t, g, 0.15, { hall: 0.9 });
      bt += d;
    }
  });
  playTheme(8, 0, 'cello', 0.6);
  playTheme(16, 0, 'cello', 0.55);
  playTheme(16, 1, 'choir', 0.6);
  // High tremolo strings through the full section.
  for (let b = 16; b < 24; b++) {
    const ch = chordOf(b);
    m.add(I.tremolo(hz(CH[ch][0] + '5'), BAR + 0.5, { seed: b, a: 0.3, r: 0.6 }), b * BAR, 0.16, 0.5, { hall: 0.6 });
  }
  // Break: bells and a lone choir.
  for (let b = 24; b < 28; b++) {
    m.add(I.bell(mtof(at(CH[chordOf(b)][0], 4)), 5, { type: 'tubular', seed: b }), b * BAR, 0.35, -0.3, { hall: 1 });
    m.add(I.choir(mtof(at(CH[chordOf(b)][1], 4)), BAR + 1.5, { vowel: 'u', voices: 4, a: 1, r: 1.5, seed: b * 5 }), b * BAR, 0.4, 0.3, { hall: 1 });
  }
  void r;
  return foldLoop(m.render(), loop);
}

// ------------------------------------------------------------- 4. Raven's lullaby: melancholic waltz

export function lullaby() {
  const BEAT = 0.833, BAR = 3 * BEAT, E = BEAT / 2, loop = 32 * BAR;
  const m = new Mix(loop + 8, { hall: { ...HALL, rt60: 4.2, size: 1.3, gain: 0.85 } });
  const r = rng(404);
  const prog1 = [['D2', 'Dm'], ['D2', 'Gm'], ['C#2', 'A7'], ['D2', 'Dm'], ['Bb1', 'Bb'], ['G1', 'Gm'], ['Eb2', 'Eb'], ['A1', 'A']];
  const prog2 = [['D2', 'Dm'], ['C2', 'F'], ['Bb1', 'Bb'], ['G1', 'Gm'], ['Eb2', 'Eb'], ['D2', 'Bb'], ['A1', 'A'], ['A1', 'A7']];
  const progAt = (b) => ((b % 16) < 8 ? prog1 : prog2)[b % 8];
  for (let b = 0; b < 32; b++) {
    const t = b * BAR, [bass, ch] = progAt(b);
    const [r0, th, fi] = CH[ch];
    // Harp: bass on 1, then a rising-falling broken chord in eighths.
    const up = [nm(bass), at(fi, 3), at(r0, 4) > at(th, 4) ? at(r0, 3) : at(r0, 4), at(th, 4), at(fi, 4), at(th, 4)];
    up.forEach((nn, k) => m.add(I.pluck(mtof(nn), 3.5, { body: 'harp', t60: k ? 3 : 5, bright: 0.35, seed: b * 6 + k }), t + k * E + (r() - 0.5) * 0.01, k ? 0.32 : 0.45, -0.3 + k * 0.1, { hall: 0.6 }));
    // Soft string bed.
    for (const nn of [at(r0, 3), at(th, 3), at(fi, 3)]) m.add(I.strings(mtof(nn), BAR + 1.5, { a: 1.2, r: 1.5, voices: 3, bright: 1500, seed: b * 3 + nn }), t, 0.12, (nn % 3 - 1) * 0.5, { hall: 0.7 });
  }
  const mel1 = [
    [['A4', 2], ['F4', 1]], [['G4', 2], ['Bb4', 1]], [['A4', 1.5], ['G4', 0.5], ['E4', 1]], [['F4', 2], ['D4', 1]],
    [['D5', 2], ['C5', 1]], [['Bb4', 2], ['G4', 1]], [['G4', 1], ['Bb4', 1], ['Eb5', 1]], [['D5', 1], ['C#5', 2]],
  ];
  const mel2 = [
    [['A4', 2], ['D5', 1]], [['C5', 2], ['A4', 1]], [['Bb4', 1.5], ['A4', 0.5], ['G4', 1]], [['G4', 2], ['Bb4', 1]],
    [['G4', 2], ['F4', 1]], [['F4', 2], ['D4', 1]], [['E4', 2], ['C#4', 1]], [['A3', 3]],
  ];
  const play = (mel, startBar, inst, oct, g) => mel.forEach((bar, bi) => {
    let bt = 0;
    for (const [note, d] of bar) {
      const t = (startBar + bi) * BAR + bt * BEAT, f = hz(note) * 2 ** oct;
      if (inst === 'box') {
        m.add(I.bell(f * 2, 3, { type: 'celesta', strike: 0.04, seed: Math.round(t * 11) }), t, g, 0.25, { hall: 0.7 });
        m.add(I.bell(f, 3, { type: 'celesta', strike: 0, seed: Math.round(t * 13) }), t, g * 0.35, 0.25, { hall: 0.7 });
      } else m.add(I.cello(f, d * BEAT + 0.4, { a: 0.2, r: 0.6, seed: Math.round(t * 7), swell: 0.5, vib: 0.007 }), t, g, -0.1, { hall: 0.6 });
      bt += d;
    }
  });
  play(mel1, 0, 'box', 0, 0.5);
  play(mel2, 8, 'box', 0, 0.5);
  play(mel1, 16, 'cello', -1, 0.55);
  play(mel2, 24, 'cello', -1, 0.55);
  // Music box answers the cello with high chord tones.
  for (let b = 16; b < 32; b++) {
    if (b % 2) continue;
    const [, ch] = progAt(b);
    m.add(I.bell(mtof(at(CH[ch][1], 6)), 2.5, { type: 'celesta', strike: 0.03, seed: b }), b * BAR + 2 * BEAT, 0.22, 0.5, { hall: 1 });
  }
  // A far bell at the turn of each half.
  for (const b of [0, 16]) m.add(I.bell(hz('D3'), 9, { strike: 0.15, seed: b }), b * BAR, 0.25, -0.5, { hall: 1.4 });
  m.add(I.wind(loop + 6, { seed: 8, center: 600, rate: 0.04 }), 0, 0.25, 0, { hall: 0.2 });
  return foldLoop(m.render(), loop);
}

export const THEMES = { crypt, tavern, battle, lullaby };
