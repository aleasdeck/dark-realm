// Renders the candidate themes and effect packs to WAV, then to loudness-matched MP3 via ffmpeg.
// Usage: node render.mjs <outDir> [music|sfx|game] [name...]
import fs from 'fs';
import { execFileSync } from 'child_process';
import { writeWav, limit, peak, scale, loudness } from './dsp.mjs';

const [, , OUT, what = 'all', ...only] = process.argv;
fs.mkdirSync(OUT, { recursive: true });

function encode(wav, mp3, { lufs, kbps = 128 }) {
  let filter = `loudnorm=I=${lufs}:TP=-1.5:LRA=14`;
  // Two-pass linear normalisation keeps the dynamics intact.
  const err = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${wav}" -af "${filter}:print_format=json" -f null - 2>&1`]).toString();
  const j = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
  filter += `:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-af', filter + ',aresample=44100', '-c:a', 'libmp3lame', '-b:a', kbps + 'k', mp3]);
  return j;
}

if (what === 'all' || what === 'music') {
  const { THEMES: T1 } = await import('./music.mjs');
  const { THEMES2 } = await import('./music2.mjs');
  const THEMES = { ...T1, ...THEMES2 };
  for (const [name, fn] of Object.entries(THEMES)) {
    if (only.length && !only.includes(name)) continue;
    const t0 = Date.now();
    let st = fn();
    const p = peak(st);
    st = scale(st, 0.7 / p);
    st = limit(st, 0.9);
    const wav = `${OUT}/music-${name}.wav`;
    writeWav(wav, st, fs);
    const j = encode(wav, `${OUT}/music-${name}.mp3`, { lufs: -17, kbps: 128 });
    console.log(name, `${((Date.now() - t0) / 1000).toFixed(1)}s`, 'rawPeak', p.toFixed(2), 'I', j.input_i, 'TP', j.input_tp, 'LRA', j.input_lra, 'len', (st[0].length / 44100).toFixed(1));
  }
}

if (what === 'all' || what === 'sfx') {
  const { PACKS: OLD, TARGET } = await import('./sfx.mjs');
  const { steel } = await import('./steel.mjs');
  const PACKS = { ...OLD, steel };
  for (const [pack, sounds] of Object.entries(PACKS)) {
    if (only.length && !only.includes(pack)) continue;
    for (const [name, fn] of Object.entries(sounds)) {
      let st = fn();
      const p = peak(st);
      st = scale(st, 0.5 / p);
      const l = loudness(st);
      st = scale(st, 10 ** ((TARGET[name] - l) / 20));
      st = limit(st, 0.9, 0.05);
      const wav = `${OUT}/sfx-${pack}-${name}.wav`;
      writeWav(wav, st, fs);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '128k', `${OUT}/sfx-${pack}-${name}.mp3`]);
      console.log(pack, name, (st[0].length / 44100).toFixed(2) + 's', 'peak', peak(st).toFixed(2));
    }
  }
}

// The files the game ships: node render.mjs <outDir> game  (outDir = src/assets/audio)
if (what === 'game') {
  const { crypt2, den } = await import('./music2.mjs');
  const { steel } = await import('./steel.mjs');
  const { TARGET } = await import('./sfx.mjs');
  fs.mkdirSync(`${OUT}/sfx`, { recursive: true });
  for (const [name, fn] of [['menu', crypt2], ['tavern', den]]) {
    let st = fn();
    st = limit(scale(st, 0.7 / peak(st)), 0.9);
    const wav = `${OUT}/${name}.wav`;
    writeWav(wav, st, fs);
    encode(wav, `${OUT}/${name}.mp3`, { lufs: -17, kbps: 128 });
    fs.rmSync(wav);
    console.log(name, (st[0].length / 44100).toFixed(2) + 's');
  }
  for (const [name, fn] of Object.entries(steel)) {
    let st = fn();
    st = scale(st, 0.5 / peak(st));
    st = scale(st, 10 ** ((TARGET[name] - loudness(st)) / 20));
    st = limit(st, 0.9, 0.05);
    const wav = `${OUT}/sfx/${name}.wav`;
    writeWav(wav, st, fs);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '128k', `${OUT}/sfx/${name}.mp3`]);
    fs.rmSync(wav);
  }
}
