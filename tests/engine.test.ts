import { describe, expect, it } from 'vitest';
import { botAction } from '../src/engine/bot';
import { CARDS } from '../src/engine/cards';
import { actingPlayer, applyAction, createGame } from '../src/engine/engine';
import type { GameState, PlayerIdx } from '../src/engine/types';

function draftAll(s: GameState): GameState {
  for (const patron of ['crows', 'hlaalu', 'pelin', 'eagle'] as const) {
    s = applyAction(s, actingPlayer(s), { t: 'draft', patron });
  }
  return s;
}

function playOut(seed: number, maxSteps = 20000): GameState {
  let s = createGame(seed, ['A', 'B']);
  for (let i = 0; i < maxSteps && s.phase !== 'over'; i++) {
    const pi = actingPlayer(s);
    const a = botAction(s, pi)!;
    s = applyAction(s, pi, a);
  }
  return s;
}

describe('engine', () => {
  it('drafts four patrons plus treasury and deals opening hands', () => {
    const s = draftAll(createGame(1, ['A', 'B']));
    expect(s.phase).toBe('play');
    expect(s.patrons).toEqual(['crows', 'hlaalu', 'pelin', 'eagle', 'treasury']);
    for (const p of s.players) {
      expect(p.hand).toHaveLength(5);
      expect(p.hand.length + p.deck.length).toBe(10);
    }
    expect(s.tavern).toHaveLength(5);
  });

  it('rejects moves out of turn', () => {
    const s = draftAll(createGame(2, ['A', 'B']));
    expect(() => applyAction(s, 1, { t: 'end' })).toThrow();
  });

  it('converts power to prestige at end of turn and gives the second player a coin', () => {
    let s = draftAll(createGame(3, ['A', 'B']));
    s.players[0].power = 4;
    s = applyAction(s, 0, { t: 'end' });
    expect(s.players[0].prestige).toBe(4);
    expect(s.current).toBe(1);
    expect(s.players[1].coin).toBe(1);
  });

  it('fires combos retroactively', () => {
    let s = draftAll(createGame(4, ['A', 'B']));
    const p = s.players[0];
    p.hand = [{ uid: 900, id: 'crows_toll_silver' }, { uid: 901, id: 'crows_peck' }];
    s = applyAction(s, 0, { t: 'play', uid: 900 });
    expect(s.players[0].coin).toBe(2);
    s = applyAction(s, 0, { t: 'play', uid: 901 });
    // toll silver combo 2: +1 power; peck: +1 power, combo 2: +1 coin
    expect(s.players[0].power).toBe(2);
    expect(s.players[0].coin).toBe(3);
  });

  it('patron favor moves toward the activating player', () => {
    let s = draftAll(createGame(5, ['A', 'B']));
    s.players[0].power = 2;
    s = applyAction(s, 0, { t: 'patron', patron: 'eagle' });
    expect(s.favor.eagle).toBe(0);
    expect(() => applyAction(s, 0, { t: 'patron', patron: 'crows' })).toThrow();
  });

  it('opponent discard is asked at the start of their turn', () => {
    let s = draftAll(createGame(6, ['A', 'B']));
    s.players[1].pendingDiscard = 1;
    s = applyAction(s, 0, { t: 'end' });
    expect(s.pending?.kind).toBe('discard');
    expect(s.pending?.player).toBe(1);
    s = applyAction(s, 1, { t: 'choose', picks: [s.pending!.options[0].ref] });
    expect(s.players[1].hand).toHaveLength(4);
  });

  it('wins at 40 prestige only after surviving the opponent turn', () => {
    let s = draftAll(createGame(7, ['A', 'B']));
    s.players[0].prestige = 41;
    s = applyAction(s, 0, { t: 'end' });
    expect(s.phase).toBe('play');
    s = applyAction(s, 1, { t: 'end' });
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(0);
  });

  it('every card has a known patron, art and valid stats', () => {
    for (const c of CARDS) {
      expect(c.art).toBeTruthy();
      if (c.type === 'agent' || c.type === 'contractAgent') expect(c.hp).toBeGreaterThan(0);
    }
  });

  it('bot vs bot games finish with a winner', () => {
    const wins: Record<PlayerIdx, number> = { 0: 0, 1: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      const s = playOut(seed);
      expect(s.phase).toBe('over');
      wins[s.winner!]++;
    }
    expect(wins[0] + wins[1]).toBe(40);
  });
});
