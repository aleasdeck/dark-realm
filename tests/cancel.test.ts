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

  it('in the tutorial the coach asks for the Chest again after backing out', () => {
    let s = createTutorialGame('A', 'advanced');
    const coach = new Coach('advanced');
    for (const patron of ['hlaalu', 'pelin', 'rajhin', 'eagle'] as const) s = applyAction(s, actingPlayer(s), { t: 'draft', patron });
    while (s.players[0].hand.length) s = applyAction(s, 0, { t: 'play', uid: s.players[0].hand[0].uid });
    // Read the hints that only need an "OK" up to the Chest.
    for (let h = coach.hint(s, 0); h?.ok; h = coach.hint(s, 0)) coach.ack(h.id);
    expect(coach.hint(s, 0)?.id).toBe('chest');
    s = applyAction(s, 0, { t: 'patron', patron: 'treasury' });
    expect(coach.hint(s, 0)?.id).toBe('chest-pick');
    s = applyAction(s, 0, { t: 'cancel' });
    expect(coach.hint(s, 0)?.id).toBe('chest');
  });
});

describe('taking back a card from its choice', () => {
  const base = () => draft(['hunding', 'hlaalu', 'psijic', 'crows']);

  it('puts a Mantis card back in hand with everything as before', () => {
    let before = base();
    before.players[0].hand.push({ uid: 990, id: 'hunding_conquest' });
    before = applyAction(before, 0, { t: 'play', uid: before.players[0].hand[0].uid });
    const s = applyAction(before, 0, { t: 'play', uid: 990 });
    expect(s.pending?.kind).toBe('choice');
    expect(canCancel(s, 0)).toBe(true);
    expect(canCancel(s, 1)).toBe(false);
    const back = applyAction(s, 0, { t: 'cancel' });
    const { log: l0, events: e0, ...was } = before;
    const { log: l1, events: e1, ...now } = back;
    expect(now).toEqual(was);
    expect(back.log.at(-1)).toBe('A передумывает разыгрывать «Завоевание»');
    expect(back.events).toEqual([{ k: 'unplay', p: 0, card: 'hunding_conquest', act: 'play' }]);
    // Played again, it opens the same choice and goes through.
    const again = applyAction(back, 0, { t: 'play', uid: 990 });
    const done = applyAction(again, 0, { t: 'choose', picks: [0] });
    expect(done.players[0].played.map((c) => c.uid)).toContain(990);
  });

  it('can still be taken back from the tavern pick its choice led to', () => {
    const before = base();
    before.players[0].hand.push({ uid: 990, id: 'hunding_conquest' });
    let s = applyAction(before, 0, { t: 'play', uid: 990 });
    s = applyAction(s, 0, { t: 'choose', picks: [1] });
    expect(s.pending?.kind).toBe('acquire');
    expect(canCancel(s, 0)).toBe(true);
    s = applyAction(s, 0, { t: 'cancel' });
    expect(s.pending).toBeNull();
    expect(s.players[0].hand.map((c) => c.uid)).toContain(990);
    expect(s.tavern).toEqual(before.tavern);
  });

  it('takes back an agent used from the table', () => {
    const before = base();
    before.players[0].agents.push({ uid: 990, id: 'hunding_herald', dmg: 0, activated: false });
    before.players[0].cooldown.push({ uid: 991, id: 'gold' });
    const s = applyAction(before, 0, { t: 'activate', uid: 990 });
    expect(s.pending?.kind).toBe('returnTop');
    const back = applyAction(s, 0, { t: 'cancel' });
    expect(back.players).toEqual(before.players);
    expect(back.events).toEqual([{ k: 'unplay', p: 0, card: 'hunding_herald', act: 'activate' }]);
  });

  it('is not offered once the card showed hidden cards', () => {
    const s0 = base();
    s0.players[0].hand.push({ uid: 990, id: 'psijic_globe' });
    const s = applyAction(s0, 0, { t: 'play', uid: 990 });
    expect(s.pending?.kind).toBe('toss');
    expect(canCancel(s, 0)).toBe(false);
    expect(() => applyAction(s, 0, { t: 'cancel' })).toThrow(RuleError);
  });

  it('is not offered after a choice that drew cards', () => {
    const s0 = base();
    s0.players[0].hand.push({ uid: 990, id: 'alma_lesson' });
    s0.turnPlays.push({ id: 'alma_plate', patron: 'alma', fired: [] }, { id: 'alma_plate', patron: 'alma', fired: [] });
    let s = applyAction(s0, 0, { t: 'play', uid: 990 });
    expect(s.pending?.kind).toBe('donate');
    expect(canCancel(s, 0)).toBe(true);
    s = applyAction(s, 0, { t: 'choose', picks: [s.pending!.options[0].ref] });
    expect(s.pending?.kind).toBe('donate');
    expect(canCancel(s, 0)).toBe(false);
  });
});
