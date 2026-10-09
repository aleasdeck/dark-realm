# Music and sound effects

Everything in `src/assets/audio` is synthesised here, offline, with no samples and no third-party recordings,
so there is nothing to license.

- `dsp.mjs`: filters, oscillators, reverb, mixing, seamless loops.
- `instruments.mjs`: choir, strings, lute, bells, drums, wind, crowd murmur.
- `foley.mjs`: physical models of wood, metal and coins for the effects.
- `music2.mjs`: «Склеп» (`crypt2`, the menu) and «Притон» (`den`, a match).
- `steel.mjs`: the effects pack «Пергамент и сталь 2».
- `music.mjs`, `sfx.mjs`: earlier candidates, kept for comparison.

## Regenerating the game files

Needs Node and ffmpeg with libmp3lame. From this folder:

```sh
node render.mjs ../../src/assets/audio game
```

It writes `menu.mp3`, `tavern.mp3` and `sfx/<name>.mp3`. Music is normalised to -17 LUFS and loops seamlessly;
the loop lengths are in `src/ui/music.ts` (`TRACKS`) and must match if a theme's length changes.
Effects are normalised per event to the levels in `TARGET` (`sfx.mjs`).

`node render.mjs <dir> music` and `node render.mjs <dir> sfx` render every candidate for listening.
