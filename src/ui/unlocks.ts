import { DRAFTABLE, LOCKED } from '../engine/cards';
import type { PatronId } from '../engine/types';

/*
 * Locked patrons open as the player finishes games (against the bot or online; the tutorial
 * does not count). `?unlock=all` in the URL opens every patron for testing without saving anything.
 */
const KEY = 'dr-games';

/** Finished games needed to open each locked patron. */
export const UNLOCK_AT: Partial<Record<PatronId, number>> = {
  hunding: 5,
  orgnum: 10,
  alessia: 20,
  druid: 30,
  alma: 40,
  mora: 50,
};

export function gamesPlayed(): number {
  try {
    return Math.max(0, Number(localStorage.getItem(KEY)) || 0);
  } catch {
    return 0;
  }
}

export function isUnlocked(pid: PatronId): boolean {
  if (!LOCKED.includes(pid)) return true;
  if (new URLSearchParams(location.search).get('unlock') === 'all') return true;
  return gamesPlayed() >= (UNLOCK_AT[pid] ?? Infinity);
}

/** Counts a finished game and returns the patrons it opened. */
export function recordGame(): PatronId[] {
  const before = LOCKED.filter(isUnlocked);
  try {
    localStorage.setItem(KEY, String(gamesPlayed() + 1));
  } catch {
    return [];
  }
  return LOCKED.filter((pid) => isUnlocked(pid) && !before.includes(pid));
}

/** Patrons this player can draft. */
export function draftPool(): PatronId[] {
  return [...DRAFTABLE, ...LOCKED.filter(isUnlocked)];
}

/** "Opens after N games (M played)" for a locked patron. */
export function unlockHint(pid: PatronId): string {
  const need = UNLOCK_AT[pid];
  if (need === undefined) return 'Пока закрыт.';
  return `Откроется после ${need} сыгранных партий (сыграно ${Math.min(gamesPlayed(), need)}).`;
}
