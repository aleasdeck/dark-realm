import { describe, expect, it } from 'vitest';
import { botAction } from '../src/engine/bot';
import { cardDef } from '../src/engine/cards';
import { actingPlayer, applyAction } from '../src/engine/engine';
import { createTutorialGame, openingValue, TUTORIAL_GOAL, TUTORIAL_PATRONS } from '../src/engine/tutorial';
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

  it('drafts the tutorial patrons into a hand that can buy from the tavern', () => {
    const s = draft(createTutorialGame('A'));
    expect(s.phase).toBe('play');
    expect(s.current).toBe(0);
    expect(s.patrons).toEqual([...TUTORIAL_PATRONS, 'treasury']);
    const { coin, power } = openingValue(s);
    expect(power).toBeGreaterThan(0);
    expect(s.tavern.some((c) => cardDef(c.id).cost > 0 && cardDef(c.id).cost <= coin)).toBe(true);
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
    expect(s.winReason === 'благосклонность всех покровителей' || top >= TUTORIAL_GOAL).toBe(true);
  });
});

describe('coach', () => {
  it('walks through the draft and the first turn and follows the player', () => {
    const coach = new Coach();
    let s = draft(createTutorialGame('A'), coach);
    expect(coach.hint(s, 0)?.id).toBe('goal');
    coach.ack('goal');
    expect(coach.hint(s, 0)?.id).toBe('hand');
    s = applyAction(s, 0, { t: 'play', uid: s.players[0].hand[0].uid });
    expect(coach.hint(s, 0)?.id).toBe('resources');
    coach.ack('resources');
    expect(coach.hint(s, 0)?.id).toBe('play-all');
    while (s.players[0].hand.length) {
      s = applyAction(s, 0, s.pending ? { t: 'choose', picks: [s.pending.options[0].ref] } : { t: 'play', uid: s.players[0].hand[0].uid });
    }
    expect(coach.hint(s, 0)?.id).toBe('tavern');
    // The tavern hint has no "OK": it waits for a purchase.
    coach.ack('tavern');
    expect(coach.hint(s, 0)?.id).toBe('tavern');
    const coin = s.players[0].coin;
    const buy = s.tavern.find((c) => cardDef(c.id).cost > 0 && cardDef(c.id).cost <= coin)!;
    s = applyAction(s, 0, { t: 'buy', uid: buy.uid });
    while (s.pending) s = applyAction(s, 0, { t: 'choose', picks: s.pending.options.slice(0, s.pending.min).map((o) => o.ref) });
    expect(coach.hint(s, 0)?.id).toBe('patrons');
    coach.ack('patrons');
    expect(coach.hint(s, 0)?.id).toBe('end');
    s = applyAction(s, 0, { t: 'end' });
    expect(coach.hint(s, 0)?.id).toBe('their-turn');
    coach.off = true;
    expect(coach.hint(s, 0)).toBeNull();
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
