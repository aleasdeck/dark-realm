import { beforeEach, describe, expect, it } from 'vitest';
import { loadRatingScript, type RatingScript } from './gas';

const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);
const KEY_C = 'c'.repeat(32);

const report = (match: string, name: string, key: string, opp: string, won: boolean, turns = 12) => ({ match, name, key, opp, won, turns });

describe('rating web app (server/rating.gs)', () => {
  let gs: RatingScript;
  beforeEach(() => {
    gs = loadRatingScript();
  });

  it('counts a game once both players report it', () => {
    expect(gs.post(report('match-0001', 'Аня', KEY_A, 'Боря', true))).toEqual({ ok: true, status: 'pending' });
    expect(gs.get({ match: 'match-0001', name: 'Аня' })).toEqual({ ok: true, status: 'pending' });
    expect(gs.get().players).toEqual([]);
    expect(gs.post(report('match-0001', 'Боря', KEY_B, 'Аня', false))).toEqual({ ok: true, status: 'done', rating: 984, delta: -16 });
    expect(gs.get({ match: 'match-0001', name: 'аня' })).toEqual({ ok: true, status: 'done', rating: 1016, delta: 16 });
    expect(gs.get().players).toEqual([
      { name: 'Аня', rating: 1016, wins: 1, losses: 0 },
      { name: 'Боря', rating: 984, wins: 0, losses: 1 },
    ]);
    expect(gs.book.get('Заявки')!.rows).toHaveLength(1);
    expect(gs.book.get('Партии')!.rows).toHaveLength(2);
  });

  it('does not count a game twice', () => {
    gs.post(report('match-0001', 'Аня', KEY_A, 'Боря', true));
    gs.post(report('match-0001', 'Боря', KEY_B, 'Аня', false));
    expect(gs.post(report('match-0001', 'Аня', KEY_A, 'Боря', true))).toMatchObject({ status: 'done', rating: 1016 });
    expect(gs.post(report('match-0001', 'Боря', KEY_B, 'Аня', false))).toMatchObject({ status: 'done', rating: 984 });
    expect(gs.book.get('Партии')!.rows).toHaveLength(2);
  });

  it('keeps a name for the device that first played under it', () => {
    gs.post(report('match-0001', 'Аня', KEY_A, 'Боря', true));
    expect(gs.post(report('match-0002', 'АНЯ', KEY_C, 'Боря', true))).toEqual({ ok: false, error: 'name-taken' });
    // Clearing the key in the sheet frees the name.
    gs.book.get('Рейтинг')!.rows[1][6] = '';
    expect(gs.post(report('match-0002', 'Аня', KEY_C, 'Боря', true))).toEqual({ ok: true, status: 'pending' });
  });

  it('does not count a game both sides claim', () => {
    gs.post(report('match-0001', 'Аня', KEY_A, 'Боря', true));
    expect(gs.post(report('match-0001', 'Боря', KEY_B, 'Аня', true))).toEqual({ ok: true, status: 'conflict' });
    expect(gs.get({ match: 'match-0001', name: 'Аня' })).toEqual({ ok: true, status: 'conflict' });
    expect(gs.get().players).toEqual([]);
  });

  it('does not count a game the reports disagree on who played', () => {
    gs.post(report('match-0001', 'Аня', KEY_A, 'Вера', true));
    expect(gs.post(report('match-0001', 'Боря', KEY_B, 'Аня', false))).toEqual({ ok: true, status: 'conflict' });
  });

  it('turns away the default name, bad input and formulas', () => {
    expect(gs.post(report('match-0001', 'Странник', KEY_A, 'Боря', true))).toEqual({ ok: false, error: 'no-name' });
    expect(gs.post(report('match-0001', 'Аня', KEY_A, 'странник', true))).toEqual({ ok: false, error: 'no-name' });
    expect(gs.post(report('match-0001', 'Аня', KEY_A, 'Аня', true))).toEqual({ ok: false, error: 'bad' });
    expect(gs.post(report('x', 'Аня', KEY_A, 'Боря', true))).toEqual({ ok: false, error: 'bad' });
    expect(gs.post(report('match-0001', 'Аня', 'short', 'Боря', true))).toEqual({ ok: false, error: 'bad' });
    expect(gs.post('not json')).toEqual({ ok: false, error: 'bad' });
    gs.post(report('match-0001', '=HYPERLINK("x")', KEY_A, 'Боря', true));
    expect(gs.book.get('Рейтинг')!.rows[1][0]).toBe('HYPERLINK("x")');
  });

  it('takes the stronger player fewer points and recounts after a game is deleted', () => {
    for (let i = 0; i < 3; i++) {
      gs.post(report(`match-000${i}`, 'Аня', KEY_A, 'Боря', true));
      gs.post(report(`match-000${i}`, 'Боря', KEY_B, 'Аня', false));
    }
    const [a, b] = gs.get().players;
    expect(a.rating - 1000).toBeLessThan(48);
    expect(a.rating + b.rating).toBe(2000);
    gs.book.get('Партии')!.rows.splice(1, 2);
    gs.recalc();
    expect(gs.get().players).toEqual([
      { name: 'Аня', rating: 1016, wins: 1, losses: 0 },
      { name: 'Боря', rating: 984, wins: 0, losses: 1 },
    ]);
  });
});
