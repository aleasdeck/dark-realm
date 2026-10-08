import { beforeEach, describe, expect, it } from 'vitest';
import { loadRatingScript, type RatingScript } from './gas';

const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);
const KEY_C = 'c'.repeat(32);

const report = (match: string, name: string, key: string, opp: string, won: boolean, turns = 12, pick?: string) => ({ match, name, key, opp, won, turns, pick });

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
      { name: 'Аня', rating: 1016, wins: 1, losses: 0, deck: '' },
      { name: 'Боря', rating: 984, wins: 0, losses: 1, deck: '' },
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
      { name: 'Аня', rating: 1016, wins: 1, losses: 0, deck: '' },
      { name: 'Боря', rating: 984, wins: 0, losses: 1, deck: '' },
    ]);
  });

  it('names the patron each player picks first most often', () => {
    const picks = [
      ['crows', 'rats'],
      ['crows', 'wolves'],
      ['owls', 'wolves'],
    ];
    picks.forEach(([a, b], i) => {
      gs.post(report(`match-000${i}`, 'Аня', KEY_A, 'Боря', i !== 2, 12, a));
      gs.post(report(`match-000${i}`, 'Боря', KEY_B, 'Аня', i === 2, 12, b));
    });
    expect(gs.get().players.map((p: { name: string; deck: string }) => [p.name, p.deck])).toEqual([
      ['Аня', 'crows'],
      ['Боря', 'wolves'],
    ]);
    expect(gs.book.get('Рейтинг')!.rows[1][7]).toBe('crows:2, owls:1');
    expect(gs.book.get('Партии')!.rows[3].slice(8)).toEqual(['wolves', 'owls']);
    // A pick that isn't a patron id is dropped; recounting rebuilds the counts from Партии.
    gs.post(report('match-0009', 'Аня', KEY_A, 'Боря', true, 12, '=evil()'));
    gs.post(report('match-0009', 'Боря', KEY_B, 'Аня', false, 12));
    gs.book.get('Рейтинг')!.rows[1][7] = '';
    gs.recalc();
    expect(gs.book.get('Рейтинг')!.rows[1][7]).toBe('crows:2, owls:1');
  });

  it('adds the new columns to a table made by the first version', () => {
    gs.post(report('match-0001', 'Аня', KEY_A, 'Боря', true));
    const sheet = gs.book.get('Рейтинг')!;
    sheet.rows[0] = sheet.rows[0].slice(0, 7);
    sheet.rows[1] = sheet.rows[1].slice(0, 7);
    gs.post(report('match-0001', 'Боря', KEY_B, 'Аня', false, 12, 'rats'));
    expect(sheet.rows[0][7]).toBe('Первые пики');
    expect(gs.get().players.map((p: { deck: string }) => p.deck)).toEqual(['', 'rats']);
  });
});
