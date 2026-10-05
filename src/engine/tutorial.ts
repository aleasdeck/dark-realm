import { cardDef } from './cards';
import { createGame } from './engine';
import type { GameState, PatronId } from './types';

/** Patrons with the plainest cards: coins, power, draws and taunting agents, in draft order. */
export const TUTORIAL_PATRONS: PatronId[] = ['crows', 'hlaalu', 'pelin', 'eagle'];
export const TUTORIAL_GOAL = 20;
export const TUTORIAL_INSTANT = 40;
/**
 * Fixed deal: the first hand pays for the Chest (2 coins) and still buys a card in the tavern,
 * and the second hand has the 2 power the Eagle asks for.
 */
export const TUTORIAL_SEED = 11;
/**
 * The tavern opens with plain cards of the tutorial patrons. The first three cost at most the
 * 3 coins left after the Chest: power, coins, coins with a combo. The bought one goes on top of
 * the deck, so it is in the next hand.
 */
/** Three affordable actions, plus an agent and a contract to show the card types (both too dear for now). */
export const TUTORIAL_TAVERN = ['pelin_portcullis', 'hlaalu_exports', 'pelin_reinforce', 'hlaalu_hireling', 'crows_law'];

/**
 * A short game against the gentle bot. Only the tutorial patrons are offered: the player drafts
 * the ones the coach points at and the bot takes the rest, so the deal is always the same.
 */
export function createTutorialGame(name: string, seed = TUTORIAL_SEED): GameState {
  return createGame(seed, [name, 'Наставник'], {
    goal: TUTORIAL_GOAL,
    instant: TUTORIAL_INSTANT,
    pool: TUTORIAL_PATRONS,
    tavernTop: TUTORIAL_TAVERN,
    buyOnTop: 1,
  });
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
