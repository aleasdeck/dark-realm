import { describe, expect, it } from 'vitest';
import { botAction } from '../src/engine/bot';
import { cardDef } from '../src/engine/cards';
import { actingPlayer, applyAction, patronAvailable } from '../src/engine/engine';
import { createTutorialGame, openingValue, TUTORIAL_GOAL, TUTORIAL_PATRONS, TUTORIAL_TAVERN } from '../src/engine/tutorial';
import type { GameState } from '../src/engine/types';
import { Coach } from '../src/ui/tutorial';

/** The player takes the patrons the coach points at, the gentle bot takes its own. */
function draft(s: GameState, coach?: Coach): GameState {
  const seen: string[] = [];
  while (s.phase === 'draft') {
    const pi = actingPlayer(s);
    if (coach) seen.push(coach.hint(s, 0)!.id);
    const a = pi === 0 ? { t: 'draft' as const, patron: TUTORIAL_PATRONS[s.draftStep] } : botAction(s, 1, 'gentle')!;
    s = applyAction(s, pi, a);
  }
  if (coach) expect([...new Set(seen)]).toEqual(['draft-0', 'draft-bot', 'draft-1']);
  return s;
}

describe('tutorial game', () => {
  it('offers only the tutorial patrons in the draft', () => {
    expect(createTutorialGame('A').draftPool).toEqual(TUTORIAL_PATRONS);
  });

  it('drafts the tutorial patrons into a hand that pays for the Chest and a card in the tavern', () => {
    const s = draft(createTutorialGame('A'));
    expect(s.phase).toBe('play');
    expect(s.current).toBe(0);
    expect(s.patrons).toEqual([...TUTORIAL_PATRONS, 'treasury']);
    const { coin } = openingValue(s);
    // The Chest costs 2 coins; what is left still buys something.
    expect(s.tavern.some((c) => cardDef(c.id).cost > 0 && cardDef(c.id).cost <= coin - 2)).toBe(true);
  });

  it('ends at the short prestige goal, and the gentle bot never calls patrons or attacks', () => {
    let s = draft(createTutorialGame('A'));
    let steps = 0;
    while (s.phase !== 'over' && steps++ < 5000) {
      const pi = actingPlayer(s);
      const a = botAction(s, pi, pi === 1 ? 'gentle' : 'medium')!;
      if (pi === 1) expect(['patron', 'attack']).not.toContain(a.t);
      s = applyAction(s, pi, a);
    }
    expect(s.phase).toBe('over');
    const top = Math.max(...s.players.map((p) => p.prestige));
    expect(top).toBeLessThan(80);
    expect(s.winReason === 'благосклонность всех владык' || top >= TUTORIAL_GOAL).toBe(true);
  });
});

describe('coach', () => {
  it('walks through the draft and the first two turns and follows the player', () => {
    const coach = new Coach();
    const pickFirst = (s: GameState) => applyAction(s, 0, { t: 'choose', picks: s.pending!.options.slice(0, Math.max(1, s.pending!.min)).map((o) => o.ref) });
    let s = draft(createTutorialGame('A'), coach);
    expect(coach.hint(s, 0)?.id).toBe('goal');
    coach.ack('goal');
    expect(coach.hint(s, 0)?.id).toBe('hand');
    s = applyAction(s, 0, { t: 'play', uid: s.players[0].hand[0].uid });
    expect(coach.hint(s, 0)?.id).toBe('resources');
    coach.ack('resources');
    expect(coach.hint(s, 0)?.id).toBe('play-all');
    while (s.players[0].hand.length) s = s.pending ? pickFirst(s) : applyAction(s, 0, { t: 'play', uid: s.players[0].hand[0].uid });

    // The Chest has no "OK": the player has to call it.
    expect(coach.hint(s, 0)?.id).toBe('treasury');
    coach.ack('treasury');
    expect(coach.hint(s, 0)?.id).toBe('treasury');
    s = applyAction(s, 0, { t: 'patron', patron: 'treasury' });
    expect(coach.hint(s, 0)?.id).toBe('choice');
    s = pickFirst(s);

    // Card types are explained on the tavern, which shows an agent and a contract.
    expect(coach.hint(s, 0)?.id).toBe('card-types');
    const types = s.tavern.map((c) => cardDef(c.id).type);
    expect(types).toContain('action');
    expect(types).toContain('agent');
    expect(types).toContain('contractAction');
    coach.ack('card-types');

    // Neither has the tavern: it waits for a purchase.
    expect(coach.hint(s, 0)?.id).toBe('tavern');
    coach.ack('tavern');
    expect(coach.hint(s, 0)?.id).toBe('tavern');
    const coin = s.players[0].coin;
    // The tavern opens with the tutorial's cards; the first ones fit the coins left after the Chest.
    expect(s.tavern.map((c) => c.id)).toEqual(TUTORIAL_TAVERN);
    const buy = s.tavern.find((c) => cardDef(c.id).cost > 0 && cardDef(c.id).cost <= coin && !cardDef(c.id).type.includes('gent'))!;
    expect(buy.id).toBe('pelin_portcullis');
    s = applyAction(s, 0, { t: 'buy', uid: buy.uid });
    expect(coach.hint(s, 0)?.id).toBe('patrons');
    while (s.pending) s = pickFirst(s);
    coach.ack('patrons');
    expect(coach.hint(s, 0)?.id).toBe('end');
    s = applyAction(s, 0, { t: 'end' });
    expect(coach.hint(s, 0)?.id).toBe('their-turn');
    while (actingPlayer(s) === 1) s = applyAction(s, 1, botAction(s, 1, 'gentle')!);
    while (s.pending) s = pickFirst(s);

    // Second turn: play the hand, then call a patron.
    expect(coach.hint(s, 0)?.id).toBe('play-2');
    // The card bought in the tavern comes straight into this hand.
    expect(s.players[0].hand.map((c) => c.uid)).toContain(buy.uid);
    while (s.players[0].hand.length) s = s.pending ? pickFirst(s) : applyAction(s, 0, { t: 'play', uid: s.players[0].hand[0].uid });
    if (coach.hint(s, 0)?.id === 'combo') coach.ack('combo');
    expect(coach.hint(s, 0)?.id).toBe('patron-call');
    expect(patronAvailable(s, 0, 'eagle')).toBe(true);
    s = applyAction(s, 0, { t: 'patron', patron: 'eagle' });
    expect(coach.hint(s, 0)?.id).toBe('free');
    coach.ack('free');
    expect(coach.hint(s, 0)).toBeNull();
  });

  it.each(['pelin_portcullis', 'hlaalu_exports', 'pelin_reinforce'])('after buying %s the card is in the next hand and a patron can be called', (id) => {
    const pickFirst = (s: GameState) => applyAction(s, 0, { t: 'choose', picks: s.pending!.options.slice(0, Math.max(1, s.pending!.min)).map((o) => o.ref) });
    let s = draft(createTutorialGame('A'));
    while (s.players[0].hand.length) s = s.pending ? pickFirst(s) : applyAction(s, 0, { t: 'play', uid: s.players[0].hand[0].uid });
    s = pickFirst(applyAction(s, 0, { t: 'patron', patron: 'treasury' }));
    const card = s.tavern.find((c) => c.id === id)!;
    expect(cardDef(id).cost).toBeLessThanOrEqual(s.players[0].coin);
    s = applyAction(s, 0, { t: 'buy', uid: card.uid });
    s = applyAction(s, 0, { t: 'end' });
    while (actingPlayer(s) === 1) s = applyAction(s, 1, botAction(s, 1, 'gentle')!);
    while (s.pending) s = pickFirst(s);
    expect(s.players[0].hand.map((c) => c.uid)).toContain(card.uid);
    while (s.players[0].hand.length) s = s.pending ? pickFirst(s) : applyAction(s, 0, { t: 'play', uid: s.players[0].hand[0].uid });
    expect(TUTORIAL_PATRONS.some((p) => patronAvailable(s, 0, p))).toBe(true);
  });

  it('points at the tavern for picks made in it and keeps the choice hint for the rest', () => {
    const coach = new Coach();
    let s = draft(createTutorialGame('A'));
    coach.hint(s, 0);
    const card = s.tavern[0];
    const acquire = { ...s, pending: { player: 0 as const, kind: 'acquire' as const, prompt: '', options: [{ label: '', ref: card.uid }], min: 0, max: 1 } };
    expect(coach.hint(acquire, 0)?.id).toBe('tavern-pick');
    expect(coach.hint(acquire, 0)?.target).toContain('.tavern');
    s = { ...s, pending: { player: 0, kind: 'choice', prompt: '', options: [{ label: 'a', ref: 0 }, { label: 'b', ref: 1 }], min: 1, max: 1 } };
    expect(coach.hint(s, 0)?.id).toBe('choice');
  });
});
