import { CARDS, DRAFTABLE, LOCKED, PATRONS, cardDef } from '../engine/cards';
import { PATRON_RULES } from '../engine/text';
import type { CardDef, PatronId } from '../engine/types';
import { icon, withIcon } from './icons';
import { cardArt, cardHtml, esc, patronEmblem, richText, tileHtml } from './render';
import { themedScroll } from './scroll';
import { isUnlocked, UNLOCK_AT, unlockHint } from './unlocks';

/**
 * The collection screen of the main menu: every deck the player has opened, card by card. A row of
 * emblems picks the deck, its cards fill a list that scrolls inside the screen, and a tap on a card
 * opens it enlarged. Locked decks keep their emblem in the row, dimmed, and say how many wins open them.
 */

type Tab = PatronId | 'neutral';

/** The draft's patrons, the chest that is in every game, the locked ones in the order they open, the cards of no patron. */
const TABS: Tab[] = [...DRAFTABLE, 'treasury', ...[...LOCKED].sort((a, b) => (UNLOCK_AT[a] ?? 0) - (UNLOCK_AT[b] ?? 0)), 'neutral'];

/** The deck on screen; kept while the game runs, so coming back to the collection opens the same one. */
let tab: Tab = TABS[0];

const open = (t: Tab) => t === 'neutral' || isUnlocked(t);
const isStarter = (d: CardDef) => d.type === 'starter' || !!d.starter;

/** The cards of no patron, in the order a game meets them. */
const NEUTRAL = ['gold', 'fake_coin', 'writ', 'bewilderment'];

function tabHtml(t: Tab): string {
  const on = t === tab ? ' on' : '';
  if (t === 'neutral') {
    return `<button class="coll-tab neutral${on}" data-tab="neutral" title="Общие карты" style="--accent:#7d6a4d;--glow:#e8c98a">
      ${icon('res_coin', `<img src="${cardArt(cardDef('gold'))}" alt="" draggable="false">`)}</button>`;
  }
  const p = PATRONS[t];
  const lock = open(t) ? '' : ` locked`;
  return `<button class="coll-tab${on}${lock}" data-tab="${t}" title="${esc(p.name)}" style="--accent:${p.palette.accent};--glow:${p.palette.glow}">
    <img src="${patronEmblem(t)}" alt="${esc(p.name)}" draggable="false">${lock ? icon('lock', '🔒', 'coll-lock') : ''}</button>`;
}

/** The cards of a deck: the starting card first, then by cost and name. */
function deckCards(t: Tab): CardDef[] {
  if (t === 'neutral') return NEUTRAL.map(cardDef);
  const own = CARDS.filter((c) => c.patron === t);
  return own.sort((a, b) => Number(isStarter(b)) - Number(isStarter(a)) || a.cost - b.cost || a.name.localeCompare(b.name, 'ru'));
}

function note(d: CardDef): string {
  if (d.patron === 'neutral') return d.id === 'gold' ? '×6' : '';
  if (isStarter(d)) return d.copies ? `начальная, ×${d.copies}` : 'начальная';
  return `×${d.copies}`;
}

function headHtml(t: Tab): string {
  if (t === 'neutral') return `<div class="coll-head"><h3>Общие карты</h3><span class="coll-sub">ничьи</span></div>`;
  const p = PATRONS[t];
  return `<div class="coll-head"><h3 style="color:${p.palette.glow}">${esc(p.name)}</h3><span class="coll-sub">${esc(p.title)}</span></div>`;
}

/** Under the cards: how big the deck is and what calling its patron does. */
function footHtml(t: Tab): string {
  if (t === 'neutral') {
    return `<p class="coll-rule">${['«Золото»: 6 штук в начальной колоде.', '«Фальшивую монету» получает второй игрок в первый ход.', '«Долговую расписку» даёт призыв Сундука Бездны.', '«Морок» подкладывает в сброс соперник, призвав Кота.'].join(' ')}</p>`;
  }
  const count = CARDS.filter((c) => c.patron === t).reduce((n, c) => n + c.copies, 0);
  const rule = PATRON_RULES[t];
  return `<p class="coll-rule">${count} карт в таверне.</p><p class="coll-rule"><b>Призыв:</b> ${richText(rule.cost)} → ${richText(rule.effect)}</p>`;
}

function lockedHtml(t: PatronId): string {
  const p = PATRONS[t];
  return `<div class="coll-closed" style="--accent:${p.palette.accent};--glow:${p.palette.glow}">
    <div class="coll-closed-emblem"><img src="${patronEmblem(t)}" alt="" draggable="false">${icon('lock', '🔒', 'coll-lock')}</div>
    <h3>${esc(p.name)}</h3><p>Колода закрыта. ${esc(unlockHint(t))}</p></div>`;
}

function bodyHtml(t: Tab): string {
  if (!open(t)) return lockedHtml(t as PatronId);
  const cells = deckCards(t)
    .map((d) => `<div class="coll-cell" data-peek="${d.id}">${tileHtml(d.id)}<span>${note(d)}</span></div>`)
    .join('');
  return `${headHtml(t)}<div class="coll-grid">${cells}</div>${footHtml(t)}`;
}

/** The collection's board, put into the menu screen. */
export function collectionHtml(): string {
  return `<div class="coll-board"><div class="coll-tabs">${TABS.map(tabHtml).join('')}</div>
    <div class="tscroll"><div class="tscroll-body coll-body">${bodyHtml(tab)}</div></div></div>`;
}

/** A card of the collection, enlarged over the screen; any tap closes it. */
function peekCard(id: string) {
  const box = document.createElement('div');
  box.className = 'overlay peek coll-peek';
  box.innerHTML = `<div class="peek-card">${cardHtml(id, { cls: 'big' })}</div>
    <div class="peek-actions"><button class="ghost">${withIcon('close', 'Закрыть')}</button></div>`;
  const close = () => {
    box.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close();
  };
  box.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(box);
}

/** Makes the emblems switch decks and the cards open. */
export function bindCollection(root: ParentNode) {
  const board = root.querySelector<HTMLElement>('.coll-board');
  if (!board) return;
  const body = board.querySelector<HTMLElement>('.coll-body')!;
  board.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const pick = t.closest<HTMLElement>('[data-tab]');
    if (pick) {
      const next = pick.dataset.tab as Tab;
      if (next === tab) return;
      tab = next;
      board.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      body.innerHTML = bodyHtml(tab);
      body.scrollTop = 0;
      themedScroll(board);
      return;
    }
    const cell = t.closest<HTMLElement>('[data-peek]');
    if (cell) peekCard(cell.dataset.peek!);
  });
}
