import { describe, expect, it } from 'vitest';
import { cardDef } from '../src/engine/cards';
import { actingPlayer, applyAction, createGame } from '../src/engine/engine';
import type { GameState } from '../src/engine/types';
import { cardMoves, agentHits } from '../src/ui/moves';

function drafted(): GameState {
  let s = createGame(7, ['A', 'B']);
  while (s.phase === 'draft') s = applyAction(s, actingPlayer(s), { t: 'draft', patron: s.draftPool[0] });
  return s;
}

describe('card moves for the animations', () => {
  it('a played card goes from the hand to the played column', () => {
    const s = drafted();
    const c = s.players[0].hand.find((x) => cardDef(x.id).type !== 'agent')!;
    const moves = cardMoves(s, applyAction(s, 0, { t: 'play', uid: c.uid }));
    expect(moves).toContainEqual({ uid: c.uid, id: c.id, from: expect.objectContaining({ zone: 'hand', p: 0 }), to: expect.objectContaining({ zone: 'played', p: 0 }) });
  });

  it('a purchase leaves the tavern and a new card comes out of the tavern deck', () => {
    const s = drafted();
    s.players[0].coin = 99;
    const buy = s.tavern.find((x) => !cardDef(x.id).type.startsWith('contract'))!;
    const next = applyAction(s, 0, { t: 'buy', uid: buy.uid });
    const moves = cardMoves(s, next);
    expect(moves.find((m) => m.uid === buy.uid)).toMatchObject({ from: { zone: 'tavern' }, to: { zone: 'cd', p: 0 } });
    expect(moves.some((m) => m.from.zone === 'tdeck' && m.to.zone === 'tavern')).toBe(true);
  });

  it('the end of the turn empties the hand and draws a new one', () => {
    const s = drafted();
    const next = applyAction(s, 0, { t: 'end' });
    const moves = cardMoves(s, next);
    for (const c of s.players[0].hand) expect(moves.find((m) => m.uid === c.uid)?.from.zone).toBe('hand');
    expect(moves.filter((m) => m.to.zone === 'hand' && m.to.p === 0)).toHaveLength(5);
  });

  it('nothing moves when nothing changed', () => {
    const s = drafted();
    expect(cardMoves(s, s)).toEqual([]);
  });

  it('lists the agents an attack hits', () => {
    const s = drafted();
    const cur = s.current;
    s.players[1 - cur].agents.push({ uid: 904, id: 'rajhin_jeering', dmg: 0, activated: false });
    s.players[cur].power = 1;
    expect(agentHits(s, applyAction(s, cur, { t: 'attack', uid: 904 }))).toEqual([{ uid: 904, n: 1, out: false }]);
    s.players[cur].power = 5;
    expect(agentHits(s, applyAction(s, cur, { t: 'attack', uid: 904 }))).toEqual([{ uid: 904, n: 2, out: true }]);
  });

  it('the end of a turn lists the hits of leftover power on taunting agents, in order', () => {
    const s = drafted();
    const cur = s.current;
    const foe = s.players[1 - cur];
    foe.agents.push({ uid: 901, id: 'pelin_bearer', dmg: 2, activated: false });
    foe.agents.push({ uid: 902, id: 'rajhin_jeering', dmg: 0, activated: false });
    foe.agents.push({ uid: 903, id: 'pelin_sentries', dmg: 0, activated: false });
    s.players[cur].power = 5;
    expect(agentHits(s, applyAction(s, cur, { t: 'end' }))).toEqual([
      { uid: 901, n: 3, out: true },
      { uid: 903, n: 2, out: false },
    ]);
    s.players[cur].power = 0;
    expect(agentHits(s, applyAction(s, cur, { t: 'end' }))).toEqual([]);
  });
});
