/**
 * Sound effects: short recordings-like files rendered offline by scripts/audio (see its README),
 * decoded once at the loading screen and played through Web Audio.
 */

const FILES = import.meta.glob<string>('../assets/audio/sfx/*.mp3', { eager: true, query: '?url', import: 'default' });
const URLS: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.mp3'.length), url]),
);

export type SoundName =
  | 'click' | 'card' | 'agent' | 'coin' | 'toss' | 'hit' | 'knockout' | 'patron' | 'prestige'
  | 'destroy' | 'discard' | 'myTurn' | 'theirTurn' | 'choose' | 'draft' | 'error' | 'win' | 'lose';

const OLD_KEY = 'dark-realm-sound';
const KEY = 'dark-realm-sound-volume';
let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let volume = readVolume(KEY, OLD_KEY, 80);
const buffers = new Map<string, AudioBuffer>();

/** A saved volume 0..100; before volumes existed there was only an on/off switch, and «off» stays silent. */
export function readVolume(key: string, oldKey: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    if (v !== null && Number.isFinite(Number(v))) return Math.max(0, Math.min(100, Number(v)));
    return localStorage.getItem(oldKey) === 'off' ? 0 : fallback;
  } catch {
    return fallback;
  }
}

export function saveVolume(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* storage unavailable */
  }
}

/** Slider position to gain: the ear hears loudness roughly by the square. */
export const volumeGain = (v: number) => (v / 100) ** 2;

export function soundVolume() {
  return volume;
}

export function setSoundVolume(v: number) {
  volume = Math.max(0, Math.min(100, Math.round(v)));
  saveVolume(KEY, volume);
  const c = audioContext();
  if (c && out) out.gain.setTargetAtTime(volumeGain(volume), c.currentTime, 0.02);
}

/** The shared audio context, created on first use; effects and music both play through it. */
export function audioContext(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = volumeGain(volume);
    out.connect(ctx.destination);
  }
  return ctx;
}

/** Browsers only start audio after a gesture, so the context is resumed on the first tap. */
export function unlock() {
  const c = audioContext();
  if (c?.state === 'suspended') void c.resume();
}

/** Fetches and decodes one file; works with Safari's older callback-only decodeAudioData too. */
export async function decode(url: string): Promise<AudioBuffer> {
  const c = audioContext();
  if (!c) throw new Error('no Web Audio');
  const data = await (await fetch(url)).arrayBuffer();
  return new Promise((ok, fail) => {
    const p = c.decodeAudioData(data, ok, fail);
    if (p) p.then(ok, fail);
  });
}

/** One promise per effect, for the loading screen. */
export function loadSounds(): Promise<unknown>[] {
  return Object.entries(URLS).map(([name, url]) => decode(url).then((b) => buffers.set(name, b)));
}

export function play(name: SoundName) {
  if (!volume || !ctx || !out || ctx.state !== 'running') return;
  const b = buffers.get(name);
  if (!b) return;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.connect(out);
  src.start();
}
