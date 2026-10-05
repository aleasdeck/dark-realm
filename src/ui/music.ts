import { audioContext } from './sound';

/**
 * Dark ambient background score, synthesized with Web Audio; no audio files.
 * A low drone, a slow choir-like pad over a D minor progression, sparse bells
 * and a faint heartbeat, all sent through a generated reverb.
 */

const KEY = 'dark-realm-music';
const BAR = 8; // seconds per chord
const VOLUME = 0.16;

// D minor with a raised seventh (C#) and a Neapolitan Eb for the darker turns.
const PROGRESSION: number[][] = [
  [50, 53, 57], // Dm
  [46, 50, 53], // Bb
  [43, 46, 50], // Gm
  [45, 49, 52], // A
  [50, 53, 57], // Dm
  [51, 55, 58], // Eb
  [48, 52, 55], // C
  [45, 49, 52], // A
];
const BELLS = [74, 76, 77, 79, 81, 82, 85, 86]; // D harmonic minor, upper register

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

let enabled = readEnabled();
let out: GainNode | null = null;
let wet: ConvolverNode | null = null;
let drone: { stop: (t: number) => void } | null = null;
let timer = 0;
let nextBar = 0;
let bar = 0;

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function musicOn() {
  return enabled;
}

export function setMusic(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
  if (on) unlockMusic();
  else stop();
}

/** Starts the score after a user gesture, if it is switched on. */
export function unlockMusic() {
  if (!enabled) return;
  const c = audioContext();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  if (!timer) start(c);
}

function reverb(c: AudioContext): ConvolverNode {
  const len = Math.floor(c.sampleRate * 4);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  const conv = c.createConvolver();
  conv.buffer = ir;
  return conv;
}

function start(c: AudioContext) {
  const t = c.currentTime;
  out = c.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(VOLUME, t + 5);
  out.connect(c.destination);
  wet = reverb(c);
  const wetGain = c.createGain();
  wetGain.gain.value = 0.9;
  wet.connect(wetGain).connect(out);
  drone = startDrone(c, out);
  nextBar = t + 0.2;
  bar = 0;
  tick();
  timer = window.setInterval(tick, 500);
}

function stop() {
  window.clearInterval(timer);
  timer = 0;
  const c = audioContext();
  if (!c || !out) return;
  const t = c.currentTime;
  const g = out;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  drone?.stop(t + 1.6);
  setTimeout(() => g.disconnect(), 1800);
  out = null;
  wet = null;
  drone = null;
}

/** Schedules the next bars slightly ahead, so timer jitter never causes gaps. */
function tick() {
  const c = audioContext();
  if (!c || !out) return;
  if (nextBar < c.currentTime) nextBar = c.currentTime + 0.1;
  while (nextBar < c.currentTime + 1.5) {
    scheduleBar(c, nextBar, PROGRESSION[bar % PROGRESSION.length]);
    nextBar += BAR;
    bar++;
  }
}

function startDrone(c: AudioContext, dest: AudioNode) {
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 260;
  filter.Q.value = 5;
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.05;
  const depth = c.createGain();
  depth.gain.value = 140;
  lfo.connect(depth).connect(filter.frequency);
  const g = c.createGain();
  g.gain.value = 0.5;
  filter.connect(g).connect(dest);
  const oscs = [midi(26), midi(26) * 1.004, midi(33)].map((f) => {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.connect(filter);
    return o;
  });
  const all = [lfo, ...oscs];
  all.forEach((o) => o.start());
  return { stop: (t: number) => all.forEach((o) => o.stop(t)) };
}

function scheduleBar(c: AudioContext, t: number, chord: number[]) {
  // Choir-like pad: two detuned saws per voice through a soft low-pass, slow swell.
  const pad = c.createBiquadFilter();
  pad.type = 'lowpass';
  pad.frequency.value = 900;
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.09, t + 3);
  env.gain.setValueAtTime(0.09, t + BAR - 1);
  env.gain.exponentialRampToValueAtTime(0.0001, t + BAR + 3);
  pad.connect(env);
  env.connect(out!);
  env.connect(wet!);
  for (const n of chord) {
    for (const cents of [-8, 8]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midi(n);
      o.detune.value = cents;
      o.connect(pad);
      o.start(t);
      o.stop(t + BAR + 3.1);
    }
  }
  // Faint heartbeat on the downbeat.
  heartbeat(c, t);
  heartbeat(c, t + 0.32, 0.6);
  // Sparse bells, mostly into the reverb.
  for (let beat = 1; beat < BAR; beat++) {
    if (Math.random() < 0.22) bell(c, t + beat + Math.random() * 0.3, midi(BELLS[Math.floor(Math.random() * BELLS.length)]));
  }
}

function heartbeat(c: AudioContext, t: number, vol = 1) {
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(70, t);
  o.frequency.exponentialRampToValueAtTime(32, t + 0.25);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35 * vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(out!);
  o.start(t);
  o.stop(t + 0.32);
}

function bell(c: AudioContext, t: number, f: number) {
  // Inharmonic partials give a tolling, slightly cracked bell.
  [1, 2.76, 5.4].forEach((m, k) => {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * m;
    const g = c.createGain();
    const dur = 5 / (k + 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 / (k + 1), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(wet!);
    if (k === 0) g.connect(out!);
    o.start(t);
    o.stop(t + dur + 0.05);
  });
}

// Pause everything while the tab is hidden; nobody needs a drone from a background tab.
document.addEventListener('visibilitychange', () => {
  if (!timer) return;
  const c = audioContext();
  if (document.hidden) void c?.suspend();
  else void c?.resume();
});
