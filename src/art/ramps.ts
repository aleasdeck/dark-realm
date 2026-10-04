/** Color ramps shared by all drawers: palette-derived plus fixed material ramps. */
import { luma, makeRamp, mix, shiftHue } from './color';
import type { Rng } from './rng';

export type Ramps = {
  acc: number[];
  acc5: number[];
  glow: number[];
  cloth: number[];
  dcloth: number[];
  fire: number[];
  bone: number[];
  steel: number[];
  gold: number[];
  wood: number[];
  stone: number[];
  dark: number[];
  flesh: number[];
  ghoul: number[];
  parch: number[];
  blood: number[];
  fur: number[];
  brown: number[];
  glass: number[];
  iron: number[];
  spirit: number[];
  VOID: number;
  EYE: number;
  GLOW: number;
  WHITE: number;
};

export function buildRamps(accent: number, glow: number, r: Rng): Ramps {
  const acc = shiftHue(accent, r.range(-12, 12), r.range(0.9, 1.1));
  // keep the accent readable on dark backgrounds
  const accB = luma(acc) < 0.28 ? mix(acc, 0xffffff, 0.25) : acc;
  const gl = shiftHue(glow, r.range(-6, 6));
  const glowB = luma(gl) < 0.45 ? mix(gl, 0xffffff, 0.3) : gl;
  return {
    acc: makeRamp(accB),
    acc5: makeRamp(accB, 5),
    glow: [mix(glowB, 0x100818, 0.45), glowB, mix(glowB, 0xffffff, 0.45), mix(glowB, 0xffffff, 0.8)],
    cloth: makeRamp(mix(accB, 0x1a1424, 0.45)),
    dcloth: [0x0b0910, 0x17131f, mix(0x2a2236, accB, 0.15), mix(0x423852, accB, 0.25)],
    fire: [mix(accB, 0x200008, 0.35), mix(accB, glowB, 0.35), glowB, mix(glowB, 0xffffff, 0.7)],
    bone: [0x3d3328, 0x7d6c55, 0xbcab88, 0xe8dcbc],
    steel: [0x1f222b, 0x434a5c, 0x77829a, 0xb3bdd0, 0xe6ecf4],
    gold: [0x3a2208, 0x7a4a12, 0xc08a24, 0xf0c850, 0xfff2a8],
    wood: [0x24140c, 0x4a2c18, 0x75482a, 0xa06c40],
    stone: [0x1c1b22, 0x37353f, 0x5a5764, 0x8a8694],
    dark: [0x0b0a10, 0x1b1925, mix(0x2c2a3c, accB, 0.18), mix(0x4c4a66, accB, 0.3)],
    flesh: [0x3e2620, 0x7e5446, 0xc08c70, 0xecc4a2],
    ghoul: [0x26262a, 0x4e5450, 0x8a9484, 0xc4cbb6],
    parch: [0x4a3a22, 0x8c7448, 0xc9b07a, 0xeedcae],
    blood: [0x2a0508, 0x5e0c12, 0x9a1a1e, 0xd8403a],
    fur: [0x16161e, 0x30303c, 0x565664, 0x8a8a9a],
    brown: [0x2a1a10, 0x5a3a20, 0x8a5a30, 0xc08a50],
    glass: [0x141a28, 0x2a3650, 0x4c5c7a, 0x8a9cb8],
    iron: [0x0e0e14, 0x1f1f2a, 0x363646, 0x5a5a6e],
    spirit: [mix(glowB, 0x101020, 0.55), mix(glowB, 0xd8dcf0, 0.35), mix(glowB, 0xf0f4ff, 0.65), 0xf8faff],
    VOID: 0x0d070c,
    EYE: mix(glowB, 0xffffff, 0.35),
    GLOW: glowB,
    WHITE: 0xfffaf0,
  };
}
