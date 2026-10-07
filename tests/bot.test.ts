import { describe, expect, it } from 'vitest';
import { botAction, type BotLevel } from '../src/engine/bot';
import { DRAFTABLE, LOCKED } from '../src/engine/cards';
import { actingPlayer, applyAction, createGame } from '../src/engine/engine';
import type { GameState, PlayerIdx } from '../src/engine/types';

function duel(seed: number, levels: [BotLevel, BotLevel]): GameState {
  let s = createGame(seed * 7919, ['A', 'B'], { pool: [...DRAFTABLE, ...LOCKED] });
  for (let i = 0; i < 5000 && s.phase !== 'over'; i++) {
    const pi = actingPlayer(s);
    s = applyAction(s, pi, botAction(s, pi, levels[pi])!);
  }
  return s;
}

/** Games won by level `a` against `b`, seats alternating. */
function wins(a: BotLevel, b: BotLevel, games: number): number {
  let n = 0;
  for (let g = 0; g < games; g++) {
    const seat: PlayerIdx = g % 2 ? 1 : 0;
    const s = duel(g + 1, seat ? [b, a] : [a, b]);
    expect(s.phase).toBe('over');
    if (s.winner === seat) n++;
  }
  return n;
}

describe('bot levels', () => {
  it('each level plays legal moves to the end of the game', { timeout: 60_000 }, () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      expect(duel(3, [level, 'medium']).phase).toBe('over');
    }
  });

  it('every level drafts at random among the offered patrons', () => {
    const pool = [...DRAFTABLE, 'hunding' as const];
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const firstPicks = new Set<string>();
      for (let seed = 1; seed <= 30; seed++) {
        let s = createGame(seed, ['A', 'B'], { pool });
        s = applyAction(s, 0, { t: 'draft', patron: s.draftPool[0] });
        const a = botAction(s, 1, level)!;
        expect(a.t === 'draft' && pool.includes(a.patron)).toBe(true);
        if (a.t === 'draft') firstPicks.add(a.patron);
      }
      expect(firstPicks.size).toBeGreaterThanOrEqual(4);
    }
  });

  it('the hard bot does not change the game it looks at', () => {
    let s = createGame(4, ['A', 'B']);
    for (let i = 0; i < 30; i++) {
      const pi = actingPlayer(s);
      const before = JSON.stringify(s);
      const a = botAction(s, pi, 'hard')!;
      expect(JSON.stringify(s)).toBe(before);
      s = applyAction(s, pi, a);
    }
  });

  it('a higher level beats a lower one more often than not', { timeout: 120_000 }, () => {
    expect(wins('medium', 'easy', 10)).toBeGreaterThanOrEqual(7);
    expect(wins('hard', 'medium', 10)).toBeGreaterThanOrEqual(7);
  });
});

describe('fake coin', () => {
  it('every bot level plays it on its first turn as the second player', () => {
    for (const level of ['gentle', 'easy', 'medium', 'hard'] as BotLevel[]) {
      let s = createGame(5, ['A', 'B'], { first: 0 });
      let played = false;
      for (let i = 0; i < 400 && s.turn <= 2 && s.phase !== 'over'; i++) {
        const pi = actingPlayer(s);
        const a = botAction(s, pi, level)!;
        if (a.t === 'play' && s.players[pi].hand.find((c) => c.uid === a.uid)?.id === 'fake_coin') played = true;
        s = applyAction(s, pi, a);
      }
      expect(played, level).toBe(true);
    }
  }, 60000);
});
