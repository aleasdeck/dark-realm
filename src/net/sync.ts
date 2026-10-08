import type { GameState } from '../engine/types';

/*
 * Network moves in lockstep: the engine is pure and its dice live in the state, so a move
 * applied to the same state gives the same result on both sides. The host sends each move
 * with the number it got and a fingerprint of the state after it; the guest plays it on its
 * own copy and checks the fingerprint, and asks for the whole state only when they differ.
 */

/** Version of the move protocol a guest says it speaks in its hello. */
export const LOCKSTEP = 2;

/** Fingerprint of a state: cyrb53 of its JSON, without the events of the last move. */
export function stateHash(s: GameState): number {
  const { events: _events, ...rest } = s;
  const str = JSON.stringify(rest);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
