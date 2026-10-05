import { cardDef } from './cards';
import { createGame } from './engine';
import type { GameState, PatronId } from './types';

/** Patrons with the plainest cards: coins, power, draws and taunting agents, in draft order. */
export const TUTORIAL_PATRONS: PatronId[] = ['crows', 'hlaalu', 'pelin', 'eagle'];
export const TUTORIAL_GOAL = 20;
export const TUTORIAL_INSTANT = 40;
/** Fixed deal whose first hand can afford a card in the tavern. */
export const TUTORIAL_SEED = 3;

/**
 * A short game against the gentle bot. The player drafts the patrons the coach points at
 * and the bot takes the rest of TUTORIAL_PATRONS, so the deal is always the same.
 */
export function createTutorialGame(name: string, seed = TUTORIAL_SEED): GameState {
  return createGame(seed, [name, 'Наставник'], { goal: TUTORIAL_GOAL, instant: TUTORIAL_INSTANT });
}

/** Coins and power the first hand gives, used to pick a friendly seed. */
export function openingValue(s: GameState) {
  let coin = 0;
  let power = 0;
  for (const c of s.players[0].hand) {
    for (const e of cardDef(c.id).play) {
      if (e.k === 'coin') coin += e.n;
      if (e.k === 'power') power += e.n;
    }
  }
  return { coin, power };
}
