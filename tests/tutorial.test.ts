import { afterEach, describe, expect, it, vi } from 'vitest';
import { botAction, choose } from '../src/engine/bot';
import { cardDef } from '../src/engine/cards';
import { actingPlayer, applyAction, attackable } from '../src/engine/engine';
import { BOT_PLAN, createTutorialGame, LESSONS, suggestBuy } from '../src/engine/tutorial';
import type { Action, GameState, PatronId, ScriptId } from '../src/engine/types';
import { BotController } from '../src/ui/controller';
import { Coach, type Hint } from '../src/ui/tutorial';

/** What a player who does just what the vagrant says does next. */
function follow(s: GameState, h: Hint | null): Action {
  const p = s.players[0];
  const patron = h?.target?.match(/data-patron="(\w+)"/)?.[1] as PatronId | undefined;
  if (s.phase === 'draft') return { t: 'draft', patron: patron ?? s.draftPool[0] };
  if (s.pending) return choose(s, s.pending);
  const curse = p.hand.find((c) => cardDef(c.id).type === 'curse');
  if (p.hand.length) return { t: 'play', uid: (curse ?? p.hand[0]).uid };
  const ready = p.agents.find((a) => !a.activated);
  if (ready) return { t: 'activate', uid: ready.uid };
  if (patron) return { t: 'patron', patron };
  const card = h?.target?.match(/data-card="(\w+)"/)?.[1];
  const buy = (id: string | undefined) => s.tavern.find((c) => c.id === id && cardDef(c.id).cost <= p.coin);
  if (buy(card)) return { t: 'buy', uid: buy(card)!.uid };
  if (h?.target === '.opp-agents' && attackable(s, 0).length) return { t: 'attack', uid: attackable(s, 0)[0].uid };
  if (h?.target === '.tavern') {
    const c = s.tavern.find((c) => cardDef(c.id).cost > 0 && cardDef(c.id).cost <= p.coin && /hlaalu_(exchange|market)/.test(c.id));
    const any = c ?? s.tavern.find((c) => cardDef(c.id).cost > 0 && cardDef(c.id).cost <= p.coin);
    if (any) return { t: 'buy', uid: any.uid };
  }
  if (!h) {
    const tip = buy(suggestBuy(s, 0) ?? undefined);
    if (tip) return { t: 'buy', uid: tip.uid };
  }
  return { t: 'end' };
}

/** Plays a lesson through, the player following every hint; returns the game and the hints in order. */
function playLesson(lesson: ScriptId) {
  const coach = new Coach(lesson);
  let s = createTutorialGame('Я', lesson);
  const seen: string[] = [];
  for (let n = 0; n < 4000 && s.phase !== 'over'; n++) {
    const pi = actingPlayer(s);
    const h = coach.hint(s, 0);
    if (h && seen[seen.length - 1] !== h.id) seen.push(h.id);
    if (h?.ok) {
      coach.ack(h.id);
      continue;
    }
    if (pi === 1) {
      const a = botAction(s, 1, 'gentle')!;
      if (lesson === 'basic') expect(['patron', 'attack']).not.toContain(a.t);
      s = applyAction(s, 1, a);
    } else s = applyAction(s, 0, follow(s, h));
  }
  return { s, seen };
}

describe('the basics', () => {
  it('opens on the table with the lesson patrons, tavern and hand', () => {
    const s = createTutorialGame('Я', 'basic');
    expect(s.phase).toBe('play');
    expect(s.patrons.filter((p) => p !== 'treasury').sort()).toEqual([...LESSONS.basic.patrons].sort());
    expect(s.tavern.map((c) => c.id)).toEqual(LESSONS.basic.tavern);
    expect(s.players[0].hand.map((c) => c.id).sort()).toEqual(['eagle_starter', 'gold', 'gold', 'gold', 'pelin_starter']);
    expect(s.log.some((l) => l.includes('выбирает владыку'))).toBe(false);
  });

  it('is won on the fifth turn by the player who follows the hints, the contract closing the gap', () => {
    const { s, seen } = playLesson('basic');
    expect(s.winner).toBe(0);
    expect(s.turn).toBeLessThanOrEqual(11);
    expect(seen.slice(0, 4)).toEqual(['intro-1', 'intro-2', 'intro-3', 'hand']);
    for (const id of ['discard', 'combo', 'crow', 'contract']) expect(seen).toContain(id);
    expect(s.players[1].prestige).toBeLessThan(LESSONS.basic.goal);
  });

  it('gives the vagrant a plan only of purchases', () => {
    for (const steps of Object.values(BOT_PLAN.basic)) for (const st of steps) expect('buy' in st).toBe(true);
  });
});

describe('the advanced lesson', () => {
  it('starts with the draft of its own four patrons', () => {
    const s = createTutorialGame('Я', 'advanced');
    expect(s.phase).toBe('draft');
    expect([...s.draftPool].sort()).toEqual([...LESSONS.advanced.patrons].sort());
  });

  it('walks through its lessons to a win, the vagrant getting his reply', () => {
    const { s, seen } = playLesson('advanced');
    expect(s.winner).toBe(0);
    expect(s.turn).toBeLessThanOrEqual(17);
    for (const id of ['adv-intro', 'draft-rat', 'draft-eagle', 'chest', 'bonfire', 'curse', 'chest-morok', 'hunter', 'taunt', 'favor-fight', 'rat', 'response'])
      expect(seen).toContain(id);
  });
});

describe('normal games', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('have no lesson', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 });
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const c = new BotController('Я', level);
      expect(c.tutorial).toBe(false);
      expect(c.state!.script).toBeUndefined();
    }
  });
});
