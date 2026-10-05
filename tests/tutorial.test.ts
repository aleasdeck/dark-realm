import { describe, expect, it } from 'vitest';
import { botAction } from '../src/engine/bot';
import { cardDef } from '../src/engine/cards';
import { actingPlayer, applyAction } from '../src/engine/engine';
import { createTutorialGame, openingValue, TUTORIAL_GOAL, TUTORIAL_PATRONS } from '../src/engine/tutorial';
import { Coach } from '../src/ui/tutorial';

describe('tutorial game', () => {
  it('starts past the draft with a hand that can buy from the tavern', () => {
    const s = createTutorialGame('A');
    expect(s.phase).toBe('play');
    expect(s.current).toBe(0);
    expect(s.patrons).toEqual([...TUTORIAL_PATRONS, 'treasury']);
    const { coin, power } = openingValue(s);
    expect(power).toBeGreaterThan(0);
    expect(s.tavern.some((c) => cardDef(c.id).cost > 0 && cardDef(c.id).cost <= coin)).toBe(true);
  });

  it('ends at the short prestige goal, and the gentle bot never calls patrons or attacks', () => {
    let s = createTutorialGame('A');
    let steps = 0;
    while (s.phase !== 'over' && steps++ < 5000) {
      const pi = actingPlayer(s);
      const a = botAction(s, pi, pi === 1)!;
      if (pi === 1) expect(['patron', 'attack']).not.toContain(a.t);
      s = applyAction(s, pi, a);
    }
    expect(s.phase).toBe('over');
    const top = Math.max(...s.players.map((p) => p.prestige));
    expect(top).toBeLessThan(40);
    expect(s.winReason === 'благосклонность всех покровителей' || top >= TUTORIAL_GOAL).toBe(true);
  });
});

describe('coach', () => {
  it('walks through the first turn and follows the player', () => {
    const coach = new Coach();
    let s = createTutorialGame('A');
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
    coach.ack('tavern');
    expect(coach.hint(s, 0)?.id).toBe('patrons');
    coach.ack('patrons');
    expect(coach.hint(s, 0)?.id).toBe('end');
    s = applyAction(s, 0, { t: 'end' });
    expect(coach.hint(s, 0)?.id).toBe('their-turn');
    coach.off = true;
    expect(coach.hint(s, 0)).toBeNull();
  });
});
