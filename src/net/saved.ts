import type { GameState } from '../engine/types';

/*
 * A network match outlives a reload: the host keeps the whole game here, the guest
 * just the room it plays in (the host sends the state again on reconnect). Both live
 * in localStorage so a crashed or closed tab can come back too; the tab that played
 * also marks its side in sessionStorage, so two tabs of one browser (host and guest)
 * each come back to their own side. Only that tab goes back into the match by itself on a
 * reload; anywhere else the «Сетевая игра» menu offers «Переподключение».
 */

export type SavedMatch =
  | { role: 'host'; code: string; name: string; client: string | null; state: GameState; seq?: number; at: number }
  | { role: 'guest'; code: string; name: string; at: number };

const KEY = { host: 'dr-net-host', guest: 'dr-net-guest' } as const;
const TAB = 'dr-net-tab';
const CLIENT = 'dr-net-client';
/** A match left alone this long is not picked up again. */
export const SAVED_FOR_MS = 6 * 60 * 60 * 1000;

function read(role: SavedMatch['role']): SavedMatch | null {
  try {
    const raw = localStorage.getItem(KEY[role]);
    if (!raw) return null;
    const m = JSON.parse(raw) as SavedMatch;
    if (m.role !== role || typeof m.code !== 'string' || !(Date.now() - m.at < SAVED_FOR_MS)) return null;
    if (m.role === 'host' && m.state?.phase !== 'draft' && m.state?.phase !== 'play') return null;
    return m;
  } catch {
    return null;
  }
}

function tab(): string | null {
  try {
    return sessionStorage.getItem(TAB);
  } catch {
    return null;
  }
}

export function saveMatch(m: SavedMatch) {
  try {
    localStorage.setItem(KEY[m.role], JSON.stringify(m));
    sessionStorage.setItem(TAB, m.role);
  } catch {
    /* storage unavailable or full: the match just won't survive a reload */
  }
}

export function forgetMatch(role: SavedMatch['role']) {
  try {
    localStorage.removeItem(KEY[role]);
    if (sessionStorage.getItem(TAB) === role) sessionStorage.removeItem(TAB);
  } catch {
    /* storage unavailable */
  }
}

/** The player left the match for the menu: a reload of this tab no longer goes back into it. */
export function leaveTab() {
  try {
    sessionStorage.removeItem(TAB);
  } catch {
    /* storage unavailable */
  }
}

/** The match to come back to: this tab's own side first, else (unless only this tab's will do) the latest one saved. */
export function savedMatch(thisTab = false): SavedMatch | null {
  const own = tab();
  if (own === 'host' || own === 'guest') {
    const m = read(own);
    if (m) return m;
  }
  if (thisTab) return null;
  const all = [read('host'), read('guest')].filter((m): m is SavedMatch => !!m);
  return all.sort((a, b) => b.at - a.at)[0] ?? null;
}

/** Stands in for the id when storage is off: this page can still play, just not come back. */
const pageId = Math.random().toString(36).slice(2);

/** This browser's id as a guest: the host lets the same guest back into the match. */
export function clientId(): string {
  try {
    let id = localStorage.getItem(CLIENT);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(CLIENT, id);
    }
    return id;
  } catch {
    return pageId;
  }
}
