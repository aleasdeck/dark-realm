import { describe, expect, it } from 'vitest';
import { actingPlayer, applyAction, canCancel, createGame, patronAvailable, RuleError } from '../src/engine/engine';
import { createTutorialGame } from '../src/engine/tutorial';
import type { GameState, PatronId } from '../src/engine/types';
import { Coach } from '../src/ui/tutorial';

function draft(patrons: PatronId[]): GameState {
  let s = createGame(13, ['A', 'B'], { pool: patrons });
  for (const patron of patrons) s = applyAction(s, actingPlayer(s), { t: 'draft', patron });
  return s;
}

describe('calling off a patron', () => {
  it('backs out of the Chest: the coins come back and the call is still there', () => {
    const before = draft(['crows', 'hlaalu', 'pelin', 'psijic']);
    expect(before.current).toBe(0);
    before.players[0].coin = 5;
    let s = applyAction(before, 0, { t: 'patron', patron: 'treasury' });
    expect(s.pending?.kind).toBe('treasury');
    expect(s.players[0].coin).toBe(before.players[0].coin - 2);
    expect(canCancel(s, 0)).toBe(true);
    expect(canCancel(s, 1)).toBe(false);

    s = applyAction(s, 0, { t: 'cancel' });
    expect(s.pending).toBeNull();
    expect(s.players[0]).toEqual(before.players[0]);
    expect(s.patronCalls).toBe(before.patronCalls);
    expect(s.patronsUsed).toEqual(before.patronsUsed);
    expect(s.events).toEqual([{ k: 'cancel', p: 0, patron: 'treasury' }]);
    expect(patronAvailable(s, 0, 'treasury')).toBe(true);

    // The Chest can be called again, and that call goes through as usual.
    s = applyAction(s, 0, { t: 'patron', patron: 'treasury' });
    s = applyAction(s, 0, { t: 'choose', picks: [s.pending!.options[0].ref] });
    expect(s.players[0].cooldown.map((c) => c.id)).toContain('writ');
  });

  it('gives back power and favor for the other patrons that open a choice', () => {
    let s = draft(['crows', 'hlaalu', 'pelin', 'psijic']);
    const p = s.players[0];
    p.power = 5;
    p.coin = 6;
    p.played = [{ uid: 990, id: 'hlaalu_market' }];
    p.cooldown = [{ uid: 991, id: 'crows_brigand' }];
    s.players[1].agents = [{ uid: 992, id: 'hlaalu_hireling', dmg: 0, activated: false }];
    s.favor.pelin = 1;
    const before = structuredClone(s);
    for (const pid of ['hlaalu', 'pelin', 'psijic'] as const) {
      const called = applyAction(s, 0, { t: 'patron', patron: pid });
      expect(canCancel(called, 0)).toBe(true);
      const back = applyAction(called, 0, { t: 'cancel' });
      expect(back.players).toEqual(before.players);
      expect(back.favor).toEqual(before.favor);
      expect(back.patronCalls).toBe(before.patronCalls);
      expect(back.patronsUsed).toEqual([]);
    }
  });

  it('refuses to call off a choice a card made', () => {
    let s = draft(['crows', 'hlaalu', 'pelin', 'psijic']);
    s.players[0].hand.push({ uid: 990, id: 'treasury_ragpicker' });
    s = applyAction(s, 0, { t: 'play', uid: 990 });
    expect(s.pending?.kind).toBe('destroy');
    expect(canCancel(s, 0)).toBe(false);
    expect(() => applyAction(s, 0, { t: 'cancel' })).toThrow(RuleError);
  });

  it('in the tutorial the coach asks for the Chest again after backing out', () => {
    let s = createTutorialGame('A');
    const coach = new Coach();
    while (s.phase === 'draft') {
      const pi = actingPlayer(s);
      s = applyAction(s, pi, { t: 'draft', patron: s.draftPool[0] });
    }
    while (s.players[0].hand.length) {
      s = s.pending
        ? applyAction(s, 0, { t: 'choose', picks: s.pending.options.slice(0, Math.max(1, s.pending.min)).map((o) => o.ref) })
        : applyAction(s, 0, { t: 'play', uid: s.players[0].hand[0].uid });
    }
    // Read the hints that only need an "OK" up to the Chest.
    for (let h = coach.hint(s, 0); h?.ok; h = coach.hint(s, 0)) coach.ack(h.id);
    expect(coach.hint(s, 0)?.id).toBe('treasury');
    s = applyAction(s, 0, { t: 'patron', patron: 'treasury' });
    expect(coach.hint(s, 0)?.id).toBe('choice');
    s = applyAction(s, 0, { t: 'cancel' });
    expect(coach.hint(s, 0)?.id).toBe('treasury');
  });
});
