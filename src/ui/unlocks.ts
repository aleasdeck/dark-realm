import { DRAFTABLE, LOCKED } from '../engine/cards';
import type { PatronId } from '../engine/types';

/*
 * Which locked patrons this player has opened. The unlock conditions are not decided yet;
 * whatever grants one should call unlockPatron. `?unlock=all` in the URL opens every
 * patron for testing without saving anything.
 */
const KEY = 'dr-unlocked';

function stored(): PatronId[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((p): p is PatronId => LOCKED.includes(p)) : [];
  } catch {
    return [];
  }
}

export function isUnlocked(pid: PatronId): boolean {
  if (!LOCKED.includes(pid)) return true;
  if (new URLSearchParams(location.search).get('unlock') === 'all') return true;
  return stored().includes(pid);
}

export function unlockPatron(pid: PatronId) {
  if (!LOCKED.includes(pid) || stored().includes(pid)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...stored(), pid]));
  } catch {
    // storage blocked: the unlock lasts for this page only
  }
}

/** Patrons this player can draft. */
export function draftPool(): PatronId[] {
  return [...DRAFTABLE, ...LOCKED.filter(isUnlocked)];
}
