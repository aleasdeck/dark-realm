import { cardDef } from './cards';
import { actingPlayer, applyAction, createGame } from './engine';
import type { GameState, PatronId } from './types';

/** Patrons with the plainest cards: power, coins and taunting agents. */
export const TUTORIAL_PATRONS: PatronId[] = ['crows', 'hlaalu', 'pelin', 'eagle'];
export const TUTORIAL_GOAL = 15;
export const TUTORIAL_INSTANT = 30;
/** Fixed deal whose first hand can afford a card in the tavern. */
export const TUTORIAL_SEED = 29;

/** A short game against the gentle bot, already past the patron draft. */
export function createTutorialGame(name: string, seed = TUTORIAL_SEED): GameState {
  let s = createGame(seed, [name, 'Наставник'], { goal: TUTORIAL_GOAL, instant: TUTORIAL_INSTANT });
  for (const patron of TUTORIAL_PATRONS) s = applyAction(s, actingPlayer(s), { t: 'draft', patron });
  s.events = [];
  return s;
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
