import menuUrl from '../assets/audio/menu.mp3?url';
import tavernUrl from '../assets/audio/tavern.mp3?url';
import { audioContext, decode, readVolume, saveVolume, volumeGain } from './sound';

/**
 * Background music: «Склеп» (a choir in a crypt) in the menu and «Притон» (a grim tavern) during a match.
 * Both are seamless loops rendered by scripts/audio. They load after the menu is up, so the loading
 * screen stays short, and the two cross-fade when a match starts or ends.
 */

export type Scene = 'menu' | 'game';

/** Loop length of each file in seconds, as rendered; the decoded file can be a little longer (MP3 padding). */
const TRACKS: Record<Scene, { url: string; loop: number }> = {
  menu: { url: menuUrl, loop: 96 },
  game: { url: tavernUrl, loop: 81.6 },
};
/** Music sits under the effects: the files are mastered loud, this is the level at 100%. */
const LEVEL = 0.5;
/** Samples of silence an MP3 encoder puts in front (LAME), when the browser does not trim them. */
const MP3_DELAY = 1105;

const OLD_KEY = 'dark-realm-music';
const KEY = 'dark-realm-music-volume';
let volume = readVolume(KEY, OLD_KEY, 60);
let scene: Scene = 'menu';
let out: GainNode | null = null;
let playing: { scene: Scene; src: AudioBufferSourceNode; gain: GainNode } | null = null;
const loading: Partial<Record<Scene, Promise<AudioBuffer | null>>> = {};
const buffers: Partial<Record<Scene, AudioBuffer>> = {};

export function musicVolume() {
  return volume;
}

export function setMusicVolume(v: number) {
  volume = Math.max(0, Math.min(100, Math.round(v)));
  saveVolume(KEY, volume);
  const c = audioContext();
  if (c && out) out.gain.setTargetAtTime(volumeGain(volume) * LEVEL, c.currentTime, 0.05);
  sync();
}

/** Which theme should play; switching cross-fades. */
export function setMusicScene(s: Scene) {
  scene = s;
  sync();
}

/** Starts the music after a user gesture, if it is not turned all the way down. */
export function unlockMusic() {
  const c = audioContext();
  if (c?.state === 'suspended') void c.resume().then(sync);
  else sync();
}

/** Fetches both themes in the background, the current one first. */
export function preloadMusic() {
  void load(scene).then(() => load(scene === 'menu' ? 'game' : 'menu'));
}

function load(s: Scene): Promise<AudioBuffer | null> {
  loading[s] ??= decode(TRACKS[s].url)
    .then((b) => (buffers[s] = b))
    .catch(() => null);
  return loading[s]!;
}

function output(c: AudioContext): GainNode {
  if (!out) {
    out = c.createGain();
    out.gain.value = volumeGain(volume) * LEVEL;
    out.connect(c.destination);
  }
  return out;
}

function sync() {
  const c = audioContext();
  if (!c || c.state !== 'running') return;
  if (!volume) return fadeOut(c, 1);
  if (playing?.scene === scene) return;
  const want = scene;
  const b = buffers[want];
  if (!b) {
    void load(want).then(() => want === scene && sync());
    return;
  }
  fadeOut(c, 2.5);
  const src = c.createBufferSource();
  src.buffer = b;
  src.loop = true;
  // A browser that keeps the encoder's leading silence would put a gap in the loop: skip it.
  const loopLen = TRACKS[want].loop;
  const extra = b.length - Math.round(loopLen * b.sampleRate);
  const start = extra >= MP3_DELAY ? MP3_DELAY / b.sampleRate : 0;
  if (b.duration >= start + loopLen - 0.01) {
    src.loopStart = start;
    src.loopEnd = start + loopLen;
  }
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(1, c.currentTime + 3);
  src.connect(gain).connect(output(c));
  src.start(c.currentTime, start);
  playing = { scene: want, src, gain };
}

function fadeOut(c: AudioContext, sec: number) {
  if (!playing) return;
  const { src, gain } = playing;
  const t = c.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + sec);
  src.stop(t + sec + 0.05);
  playing = null;
}

// Pause everything while the tab is hidden; nobody needs music from a background tab.
document.addEventListener('visibilitychange', () => {
  const c = audioContext();
  if (!c || !playing) return;
  if (document.hidden) void c.suspend();
  else void c.resume();
});
