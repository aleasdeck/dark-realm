import { draftedBy } from '../engine/engine';
import type { GameState, PatronId, PlayerIdx } from '../engine/types';

/*
 * The rating table of network games. It lives in a Google Sheet behind a small web app
 * (server/rating.gs). When a network game ends, each player sends its result there; the
 * game counts once both have, with the same match id and opposite results. The player's
 * name is held by this browser's secret key, so nobody else can play under it.
 */

/**
 * The web app's address (the /exec link of the deployed server/rating.gs).
 * Empty: the rating isn't connected yet, so the menu says so and no game is reported.
 */
export const RATING_URL = 'https://script.google.com/macros/s/AKfycbyCEvA7e6ZOCysPCXpjsMDoapFhRmulQdyjGB__agqH7whn1AKtM9wfbKn_jSqAacKitw/exec';

/** The name of a player who never set one: their games stay out of the rating. */
export const DEFAULT_NAME = 'Странник';

/** `?rating=http://localhost:…` points at a local stand-in, for testing only. */
const LOCAL = (() => {
  try {
    const u = new URL(new URLSearchParams(location.search).get('rating') ?? '');
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' ? u.toString() : '';
  } catch {
    return '';
  }
})();

export function ratingUrl(): string {
  return LOCAL || RATING_URL;
}

export interface RatedPlayer {
  name: string;
  rating: number;
  wins: number;
  losses: number;
  /** The patron the player most often picks first; '' or missing before any. */
  deck?: string;
}

/** Where a finished network game stands in the rating, as the end of the game shows it. */
export type RatingStatus =
  | { kind: 'sending' | 'pending' | 'conflict' | 'unconfirmed' | 'later' | 'taken' | 'noname' | 'oppnoname' | 'failed' }
  | { kind: 'done'; rating: number; delta: number };

interface Report {
  match: string;
  name: string;
  key: string;
  opp: string;
  won: boolean;
  turns: number;
  /** The patron this player picked first in the draft. */
  pick: PatronId | '';
  at: number;
}

type Answer = { ok: true; status: 'pending' | 'conflict' | 'none' } | { ok: true; status: 'done'; rating: number; delta: number } | { ok: false; error: string };

const KEY = 'dr-rating-key';
const QUEUE = 'dr-rating-queue';
/** A report that couldn't be sent is tried again on later visits for this long. */
const QUEUE_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_MS = 4000;
const POLLS = 10;

export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** This browser's secret: the rating table gives a name to the first key that plays under it. */
function ratingKey(): string {
  try {
    let key = localStorage.getItem(KEY);
    if (!key) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(KEY, key);
    }
    return key;
  } catch {
    return '';
  }
}

/** A new match id, shared with the guest in the game state. */
export function newMatchId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Date.now().toString(36) + '-' + Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

async function call(init?: RequestInit, params = ''): Promise<Answer> {
  const res = await fetch(ratingUrl() + params, { ...init, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The table, best first. */
export async function topPlayers(): Promise<RatedPlayer[]> {
  const res = await fetch(`${ratingUrl()}?top=1`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.ok || !Array.isArray(data.players)) throw new Error('bad answer');
  return data.players;
}

// The body goes as plain text: a "simple" request, which Apps Script answers without a CORS preflight.
const send = (r: Report) => call({ method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(r) });
const status = (r: Report) => call(undefined, `?match=${encodeURIComponent(r.match)}&name=${encodeURIComponent(r.name)}`);

function readQueue(): Report[] {
  try {
    const list = JSON.parse(localStorage.getItem(QUEUE) ?? '[]');
    return Array.isArray(list) ? list.filter((r) => Date.now() - r.at < QUEUE_MS) : [];
  } catch {
    return [];
  }
}

function writeQueue(list: Report[]) {
  try {
    if (list.length) localStorage.setItem(QUEUE, JSON.stringify(list));
    else localStorage.removeItem(QUEUE);
  } catch {
    /* storage unavailable: the report goes now or never */
  }
}

const queue = (r: Report) => writeQueue([...readQueue().filter((q) => q.match !== r.match), r]);
const unqueue = (match: string) => writeQueue(readQueue().filter((q) => q.match !== match));

/** Sends the results that didn't get through before (no connection, a closed tab). */
export function flushReports() {
  if (!ratingUrl()) return;
  for (const r of readQueue()) send(r).then(() => unqueue(r.match), () => {});
}

function fromAnswer(a: Answer): RatingStatus {
  if (!a.ok) return { kind: a.error === 'name-taken' ? 'taken' : a.error === 'no-name' ? 'noname' : 'failed' };
  if (a.status === 'done') return { kind: 'done', rating: a.rating, delta: a.delta };
  if (a.status === 'conflict') return { kind: 'conflict' };
  return { kind: 'pending' };
}

/**
 * Sends a finished network game to the rating, then follows it until the opponent's result
 * arrives too. `update` hears each change; the returned function stops following.
 * Null when the game isn't one for the rating (no table yet, or the match has no id).
 */
export function rateGame(s: GameState, me: PlayerIdx, update: (r: RatingStatus) => void): (() => void) | null {
  if (!ratingUrl() || !s.match || s.winner === null) return null;
  const name = s.players[me].name;
  const opp = s.players[me === 0 ? 1 : 0].name;
  if (sameName(name, DEFAULT_NAME)) return update({ kind: 'noname' }), null;
  if (sameName(opp, DEFAULT_NAME)) return update({ kind: 'oppnoname' }), null;
  const pick = s.patrons.find((pid) => draftedBy(s, pid) === me) ?? '';
  const r: Report = { match: s.match, name, key: ratingKey(), opp, won: s.winner === me, turns: s.turn, pick, at: Date.now() };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polls = 0;
  const show = (st: RatingStatus) => {
    if (!stopped) update(st);
  };
  const follow = (a: Answer) => {
    const st = fromAnswer(a);
    if (st.kind !== 'pending') return show(st);
    show(st);
    if (polls++ >= POLLS) return show({ kind: 'unconfirmed' });
    timer = setTimeout(() => {
      if (!stopped) status(r).then(follow, () => show({ kind: 'unconfirmed' }));
    }, POLL_MS);
  };
  // Kept until the table has it, so a lost connection or a closed tab sends it on a later visit.
  queue(r);
  show({ kind: 'sending' });
  send(r).then(
    (a) => {
      unqueue(r.match);
      follow(a);
    },
    () => show({ kind: 'later' }),
  );
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** One line under the result of a network game. */
export function ratingLine(r: RatingStatus, name: string): string {
  switch (r.kind) {
    case 'sending':
      return 'Отправляем результат в рейтинг…';
    case 'pending':
      return 'Ждём, когда соперник подтвердит результат…';
    case 'done':
      return `Рейтинг: ${r.rating} (${r.delta > 0 ? '+' : ''}${r.delta})`;
    case 'conflict':
      return 'Результаты игроков не совпали, партия не засчитана.';
    case 'unconfirmed':
      return 'Партия попадёт в рейтинг, когда соперник подтвердит результат.';
    case 'later':
      return 'Нет связи с рейтингом. Результат отправится при следующем запуске.';
    case 'taken':
      return `Имя «${name}» в рейтинге занято другим игроком. Смените имя в Настройках.`;
    case 'noname':
      return 'Задайте имя в Настройках, чтобы партии шли в рейтинг.';
    case 'oppnoname':
      return 'У соперника нет имени, партия не идёт в рейтинг.';
    case 'failed':
      return 'Рейтинг не принял результат.';
  }
}
