/** Retro sound effects synthesized with Web Audio; no audio files. */

const KEY = 'dark-realm-sound';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let enabled = readEnabled();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function soundOn() {
  return enabled;
}

export function setSound(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
  if (on) {
    unlock();
    play('click');
  }
}

/** The shared audio context, created on first use; effects and music both play through it. */
export function audioContext(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return ctx;
}

/** Browsers only start audio after a gesture, so the context is created on the first tap. */
export function unlock() {
  if (!enabled) return;
  const c = audioContext();
  if (c?.state === 'suspended') void c.resume();
}

type Wave = OscillatorType;

/** One enveloped oscillator note. `to` slides the pitch. */
function tone(freq: number, start: number, dur: number, wave: Wave = 'square', vol = 0.5, to?: number) {
  const c = ctx!;
  const t = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = wave;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Filtered noise burst for hits and swishes. */
function noise(start: number, dur: number, freq: number, vol = 0.5, q = 1, type: BiquadFilterType = 'bandpass', to?: number) {
  const c = ctx!;
  const t = c.currentTime + start;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t);
  src.stop(t + dur + 0.02);
}

const SOUNDS = {
  click: () => tone(660, 0, 0.05, 'square', 0.15),
  card: () => {
    noise(0, 0.14, 1800, 0.35, 0.8, 'bandpass', 4200);
    tone(330, 0.02, 0.09, 'triangle', 0.3, 520);
  },
  agent: () => {
    noise(0, 0.12, 1200, 0.3, 0.8);
    tone(196, 0.03, 0.18, 'square', 0.22, 294);
    tone(294, 0.12, 0.16, 'square', 0.18);
  },
  coin: () => {
    tone(988, 0, 0.07, 'square', 0.22);
    tone(1319, 0.07, 0.22, 'square', 0.22);
  },
  toss: () => {
    tone(1568, 0, 0.05, 'square', 0.12);
    tone(2093, 0.05, 0.12, 'triangle', 0.14);
    noise(0.02, 0.35, 900, 0.18, 1.5, 'bandpass', 3200);
  },
  hit: () => {
    noise(0, 0.18, 900, 0.7, 0.6, 'lowpass', 200);
    tone(140, 0, 0.16, 'square', 0.35, 55);
  },
  knockout: () => {
    noise(0, 0.35, 600, 0.7, 0.5, 'lowpass', 120);
    tone(220, 0, 0.4, 'sawtooth', 0.3, 40);
  },
  patron: () => {
    tone(110, 0, 0.9, 'triangle', 0.5);
    tone(165, 0.05, 0.85, 'sine', 0.3);
    tone(220, 0.1, 0.8, 'triangle', 0.18);
    noise(0, 0.5, 300, 0.2, 2, 'bandpass', 900);
  },
  prestige: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.06, 0.18, 'square', 0.16)),
  destroy: () => {
    noise(0, 0.3, 3000, 0.4, 1, 'highpass', 300);
    tone(392, 0, 0.25, 'sawtooth', 0.15, 98);
  },
  discard: () => noise(0, 0.12, 2400, 0.3, 1, 'bandpass', 900),
  myTurn: () => [392, 523, 659].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle', 0.35)),
  theirTurn: () => [330, 262, 196].forEach((f, i) => tone(f, i * 0.12, 0.26, 'triangle', 0.3)),
  choose: () => {
    tone(784, 0, 0.08, 'square', 0.18);
    tone(784, 0.12, 0.08, 'square', 0.18);
  },
  draft: () => {
    tone(262, 0, 0.3, 'triangle', 0.35);
    tone(392, 0.05, 0.3, 'triangle', 0.25);
  },
  error: () => tone(160, 0, 0.18, 'square', 0.2, 110),
  win: () =>
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.13, i === 5 ? 0.6 : 0.16, 'square', 0.2)),
  lose: () => [392, 370, 349, 262].forEach((f, i) => tone(f, i * 0.22, i === 3 ? 0.8 : 0.24, 'triangle', 0.35)),
};

export type SoundName = keyof typeof SOUNDS;

export function play(name: SoundName) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  SOUNDS[name]();
}
