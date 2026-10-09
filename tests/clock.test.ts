import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actingPlayer, applyAction, createGame } from '../src/engine/engine';
import type { GameState, PatronId } from '../src/engine/types';
import { formatClock, GameClock } from '../src/ui/clock';
import { journalHtml } from '../src/ui/journal';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

function drafted(): GameState {
  const patrons: PatronId[] = ['crows', 'hlaalu', 'pelin', 'psijic'];
  let s = createGame(13, ['A', 'B'], { pool: patrons });
  for (const patron of patrons) s = applyAction(s, actingPlayer(s), { t: 'draft', patron });
  return s;
}

describe('the game clock', () => {
  let t = 0;
  const now = () => t;
  beforeEach(() => {
    t = 0;
    vi.stubGlobal('localStorage', fakeStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads like a clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(42_900)).toBe('0:42');
    expect(formatClock((14 * 60 + 37) * 1000)).toBe('14:37');
    expect(formatClock((3600 + 2 * 60 + 5) * 1000)).toBe('1:02:05');
  });

  it('stands in the draft and starts on the first turn', () => {
    const c = new GameClock(null, now);
    const draft = createGame(1, ['A', 'B']);
    c.track(draft, true);
    t = 30_000;
    expect(c.elapsed()).toBe(0);
    const s = drafted();
    c.track(s, true);
    expect(c.turnStart(1)).toBe(0);
    t = 90_000;
    expect(c.elapsed()).toBe(60_000);
  });

  it('notes when each turn began and stands while the page is hidden', () => {
    const c = new GameClock(null, now);
    let s = drafted();
    c.track(s, true);
    t = 20_000;
    c.track(s, false);
    t = 500_000;
    c.track(s, true);
    t = 510_000;
    s = applyAction(s, s.current, { t: 'end' });
    c.track(s, true);
    expect(s.turn).toBe(2);
    expect(c.turnStart(2)).toBe(30_000);
    // seeing the same turn again doesn't move its start
    t = 600_000;
    c.track(s, true);
    expect(c.turnStart(2)).toBe(30_000);
  });

  it('stops when the game ends', () => {
    const c = new GameClock(null, now);
    const s = drafted();
    c.track(s, true);
    t = 5_000;
    c.track({ ...s, phase: 'over' }, true);
    t = 99_000;
    expect(c.elapsed()).toBe(5_000);
  });

  it('keeps the time of a game that can be picked up again', () => {
    vi.spyOn(performance, 'now').mockImplementation(now);
    const s = drafted();
    const c = GameClock.open('bot', false);
    c.track(s, true);
    t = 75_000;
    c.stop();
    t = 1_000_000;
    const again = GameClock.open('bot', true);
    expect(again.elapsed()).toBe(75_000);
    expect(again.turnStart(1)).toBe(0);
    // a new game starts from zero
    expect(GameClock.open('bot', false).elapsed()).toBe(0);
    vi.restoreAllMocks();
  });

  it('starts from zero for another network match', () => {
    vi.spyOn(performance, 'now').mockImplementation(now);
    const c = GameClock.open('guest', false);
    c.track({ ...drafted(), match: 'one' }, true);
    t = 40_000;
    c.stop();
    const back = GameClock.open('guest', true);
    back.track({ ...drafted(), match: 'one' }, true);
    expect(back.elapsed()).toBe(40_000);
    back.track({ ...drafted(), match: 'two' }, true);
    expect(back.elapsed()).toBe(0);
    vi.restoreAllMocks();
  });

  it('shows in the journal on each turn heading', () => {
    const c = new GameClock(null, now);
    const s = drafted();
    c.track(s, true);
    t = 61_000;
    const html = journalHtml(s, 0, (n) => c.turnStart(n));
    expect(html).toContain('<span class="log-time">0:00</span>');
    expect(journalHtml(s, 0)).not.toContain('log-time');
  });
});
