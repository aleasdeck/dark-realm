import { describe, expect, it } from 'vitest';
import { actingPlayer, applyAction, createGame, LOG_SUB } from '../src/engine/engine';
import type { GameState, PatronId } from '../src/engine/types';

function draft(patrons: PatronId[]): GameState {
  let s = createGame(13, ['A', 'B'], { pool: patrons });
  for (const patron of patrons) s = applyAction(s, actingPlayer(s), { t: 'draft', patron });
  return s;
}

/** Puts a card of the given id in player 0's hand and returns its uid. */
let next = 9000;
function give(s: GameState, id: string): number {
  const uid = next++;
  s.players[0].hand.push({ uid, id });
  return uid;
}

describe('the journal', () => {
  it('names the card played and what it gave on one line', () => {
    let s = draft(['crows', 'hlaalu', 'pelin', 'psijic']);
    s = applyAction(s, 0, { t: 'play', uid: give(s, 'gold') });
    expect(s.log.at(-1)).toBe('A разыгрывает «Золото»: +1 ●');
  });

  it('puts combos on their own indented line', () => {
    let s = draft(['crows', 'hlaalu', 'pelin', 'psijic']);
    s = applyAction(s, 0, { t: 'play', uid: give(s, 'hlaalu_obsidian') });
    s = applyAction(s, 0, { t: 'play', uid: give(s, 'hlaalu_obsidian') });
    s = applyAction(s, 0, { t: 'play', uid: give(s, 'hlaalu_obsidian') });
    // The third play sets off the combo of all three, each on a line of its own.
    expect(s.log.slice(-4)).toEqual([
      'A разыгрывает «Обсидиановая шахта»: +2 ●',
      ...Array(3).fill(`${LOG_SUB}Комбо «Обсидиановая шахта»: +4 ●`),
    ]);
  });

  it('tells what a patron call cost and gave, and the opponent losing an agent', () => {
    let s = draft(['crows', 'hlaalu', 'pelin', 'psijic']);
    s.players[0].coin = 5;
    s = applyAction(s, 0, { t: 'patron', patron: 'crows' });
    expect(s.log.at(-1)).toBe('A взывает к покровителю «Ворон»: −5 ●, +4 ⚔');
    s.players[1].agents.push({ uid: 8000, id: 'hlaalu_oathman', dmg: 0, activated: false });
    s = applyAction(s, 0, { t: 'attack', uid: 8000 });
    expect(s.log.slice(-2)).toEqual(['A атакует наймита «Присягнувший счетовод»: −2', `${LOG_SUB}B теряет наймита «Присягнувший счетовод»`]);
  });
});
