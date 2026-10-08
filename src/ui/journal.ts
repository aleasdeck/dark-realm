import { CARDS } from '../engine/cards';
import { LOG_SUB } from '../engine/engine';
import type { GameState, PlayerIdx } from '../engine/types';
import { esc, paintIcons } from './rich';

const BY_NAME = new Map(CARDS.map((c) => [c.name, c.id]));

/** Journal text with resource icons painted; card names in «» open the card, other names (patrons) are bold. */
function linkCards(text: string): string {
  let html = '';
  let at = 0;
  for (const m of text.matchAll(/«([^»]+)»/g)) {
    html += paintIcons(esc(text.slice(at, m.index)));
    const id = BY_NAME.get(m[1]);
    html += id ? `<button class="log-card" data-act="peek" data-card="${id}">${esc(m[1])}</button>` : `<b>${esc(m[1])}</b>`;
    at = m.index + m[0].length;
  }
  return html + paintIcons(esc(text.slice(at)));
}

/**
 * The game's journal: each turn under a heading, every move on its own line with what it gave,
 * and what it led to indented under it. Lines are tinted by whose move it was.
 */
export function journalHtml(s: GameState, me: PlayerIdx): string {
  const names = [s.players[me].name, s.players[me === 0 ? 1 : 0].name];
  let side = '';
  return s.log
    .map((l) => {
      const isSub = l.startsWith(LOG_SUB);
      let text = isSub ? l.slice(LOG_SUB.length) : l;
      const turn = !isSub && /^Ход \d+: /.test(text);
      let who = '';
      if (turn) {
        const n = text.slice(text.indexOf(': ') + 2);
        side = n === names[0] ? 'log-me' : n === names[1] ? 'log-opp' : '';
      } else if (!isSub) {
        // Your name first, in case both players took the same one.
        const i = names.findIndex((n) => text.startsWith(`${n} `) || text.startsWith(`${n}:`));
        side = i === 0 ? 'log-me' : i === 1 ? 'log-opp' : '';
        if (i >= 0) {
          who = `<span class="log-who">${esc(names[i])}</span>`;
          text = text.slice(names[i].length);
        }
      }
      const cls = [turn ? 'log-turn' : isSub ? 'log-sub' : 'log-move', side].filter(Boolean).join(' ');
      return `<div class="${cls}">${who}${linkCards(text)}</div>`;
    })
    .join('');
}
