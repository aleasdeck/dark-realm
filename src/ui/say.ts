import { PHRASE_IDS, PHRASE_LABELS, PHRASES, type PhraseId } from '../net/phrases';
import { esc } from './rich';

/*
 * Phrases at a network table: a tap on a player's name opens a small menu of them, and the one
 * said shows in a speech bubble by the speaker's name on both screens. The bubbles live outside
 * the table, so redrawing the table doesn't cut them short.
 */

/** How long a bubble stays up, and how long after saying something the menu stays shut (no word of it anywhere). */
const SHOWN_MS = 4500;
const PAUSE_MS = 30000;

let saidAt = 0;
const bubbles = new Map<'me' | 'opp', { el: HTMLElement; timer: number }>();

/** Whether a phrase may be said now: right after one, the menu waits a moment. */
export const maySay = () => Date.now() - saidAt >= PAUSE_MS;

export function markSaid() {
  saidAt = Date.now();
}

/** Where the tap on a name opens the menu: under the name in the top half of the screen, over it in the bottom half. */
export interface SayAt {
  x: number;
  y: number;
  below: boolean;
}

export function sayAt(name: HTMLElement): SayAt {
  const r = name.getBoundingClientRect();
  const below = r.top + r.height / 2 < innerHeight / 2;
  return { x: r.left + r.width / 2, y: below ? r.bottom : r.top, below };
}

/** The menu of phrases, over a backdrop that shuts it. */
export function sayMenuHtml(at: SayAt): string {
  const items = PHRASE_IDS.map((id) => `<button data-act="say-pick" data-phrase="${id}">${esc(PHRASE_LABELS[id])}</button>`).join('');
  return `<div class="overlay say-wrap" data-act="close"><div class="say-menu ${at.below ? 'below' : 'above'}" style="--x:${at.x}px;--y:${at.y}px">${items}</div></div>`;
}

/** The visible name of that side, or its bar when the name is hidden (your own, held sideways). */
function anchor(side: 'me' | 'opp'): HTMLElement | null {
  const names = document.querySelectorAll<HTMLElement>(`[data-act="say"][data-side="${side}"]`);
  for (const el of names) if (el.getClientRects().length) return el;
  return document.querySelector<HTMLElement>(side === 'me' ? '.my-bar' : '.opp-bar');
}

/** Shows a phrase in a bubble by the speaker's name. */
export function showPhrase(side: 'me' | 'opp', id: PhraseId) {
  const at = anchor(side);
  if (!at) return;
  const old = bubbles.get(side);
  if (old) {
    clearTimeout(old.timer);
    old.el.remove();
  }
  const r = at.getBoundingClientRect();
  const below = r.top + r.height / 2 < innerHeight / 2;
  const el = document.createElement('div');
  el.className = `say-bubble ${side} ${below ? 'below' : 'above'}`;
  el.setAttribute('role', 'status');
  el.textContent = PHRASES[id];
  document.body.append(el);
  // Lined up with the start of the name as far as the screen allows; the tail points at where the name begins.
  const w = el.offsetWidth;
  const start = r.left + 10;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.left - 4));
  el.style.left = `${left}px`;
  el.style.setProperty('--tail', `${Math.max(14, Math.min(w - 14, start - left))}px`);
  if (below) el.style.top = `${r.bottom + 10}px`;
  else el.style.bottom = `${innerHeight - r.top + 10}px`;
  const timer = window.setTimeout(() => {
    el.classList.add('gone');
    setTimeout(() => el.remove(), 400);
    if (bubbles.get(side)?.el === el) bubbles.delete(side);
  }, SHOWN_MS);
  bubbles.set(side, { el, timer });
}

/** Takes down every bubble: the game is over or left. */
export function clearPhrases() {
  for (const b of bubbles.values()) {
    clearTimeout(b.timer);
    b.el.remove();
  }
  bubbles.clear();
}
