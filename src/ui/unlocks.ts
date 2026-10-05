import { DRAFTABLE, LOCKED } from '../engine/cards';
import type { PatronId } from '../engine/types';

/*
 * Locked patrons open as the player wins games (against the bot at any level or online;
 * the tutorial does not count). `?unlock=all` in the URL opens every patron for testing
 * without saving anything.
 */
const WINS = 'dr-wins';
/** Finished games, from when patrons opened by games played (kept as a statistic). */
const GAMES = 'dr-games';
/** Patrons already opened by the old games-played counter: they stay open. */
const KEPT = 'dr-unlocked';

/** Wins needed to open each locked patron. */
export const UNLOCK_AT: Partial<Record<PatronId, number>> = {
  hunding: 5,
  orgnum: 10,
  alessia: 20,
  druid: 30,
  alma: 40,
  mora: 50,
};

function read(key: string): number {
  try {
    return Math.max(0, Number(localStorage.getItem(key)) || 0);
  } catch {
    return 0;
  }
}

function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

let kept: PatronId[] | null = null;

/** Patrons opened before wins were counted. Worked out once from the old games counter. */
function keptPatrons(): PatronId[] {
  if (kept) return kept;
  try {
    if (localStorage.getItem(WINS) === null) {
      const games = read(GAMES);
      const old = LOCKED.filter((pid) => games >= (UNLOCK_AT[pid] ?? Infinity));
      write(KEPT, JSON.stringify(old));
      write(WINS, '0');
    }
    const list = JSON.parse(localStorage.getItem(KEPT) ?? '[]');
    kept = Array.isArray(list) ? list.filter((p): p is PatronId => LOCKED.includes(p)) : [];
  } catch {
    kept = [];
  }
  return kept;
}

export function wins(): number {
  keptPatrons();
  return read(WINS);
}

export function isUnlocked(pid: PatronId): boolean {
  if (!LOCKED.includes(pid)) return true;
  if (new URLSearchParams(location.search).get('unlock') === 'all') return true;
  return keptPatrons().includes(pid) || wins() >= (UNLOCK_AT[pid] ?? Infinity);
}

/** Counts a finished game and returns the patrons a win opened. */
export function recordGame(won: boolean): PatronId[] {
  const before = LOCKED.filter(isUnlocked);
  write(GAMES, String(read(GAMES) + 1));
  if (!won || !write(WINS, String(wins() + 1))) return [];
  return LOCKED.filter((pid) => isUnlocked(pid) && !before.includes(pid));
}

/** Patrons this player can draft. */
export function draftPool(): PatronId[] {
  return [...DRAFTABLE, ...LOCKED.filter(isUnlocked)];
}

function winsWord(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'победу';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'победы';
  return 'побед';
}

/** "Opens after N wins (M won)" for a locked patron. */
export function unlockHint(pid: PatronId): string {
  const need = UNLOCK_AT[pid];
  if (need === undefined) return 'Пока закрыт.';
  return `Откроется после ${need} побед (побед ${Math.min(wins(), need)}).`;
}

/** "Opens in N wins" for a locked patron's draft tile. */
export function unlockLeft(pid: PatronId): string {
  const need = UNLOCK_AT[pid];
  if (need === undefined) return 'Пока закрыт';
  const n = Math.max(1, need - wins());
  return `Откроется через ${n} ${winsWord(n)}`;
}
