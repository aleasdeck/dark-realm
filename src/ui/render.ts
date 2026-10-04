import { artUrl, patronEmblemUrl, type Subject } from '../art';
import { cardDef, PATRONS } from '../engine/cards';
import { attackable, hpLeft, other, patronAvailable } from '../engine/engine';
import { cardLines, PATRON_RULES, TYPE_NAMES } from '../engine/text';
import type { AgentInPlay, Card, CardDef, Effect, GameState, PatronId, PlayerIdx } from '../engine/types';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const NEUTRAL_PALETTE = { bg1: '#0b0b0d', bg2: '#25222a', accent: '#8d8577', glow: '#f1d9a0' };

export function paletteOf(def: CardDef) {
  return def.patron === 'neutral' ? NEUTRAL_PALETTE : PATRONS[def.patron].palette;
}

export function cardArt(def: CardDef): string {
  return artUrl(def.art as Subject, paletteOf(def), def.seed ?? 0);
}

function styleVars(def: CardDef) {
  const p = paletteOf(def);
  return `--bg1:${p.bg1};--bg2:${p.bg2};--accent:${p.accent};--glow:${p.glow}`;
}

function patronLabel(def: CardDef) {
  return def.patron === 'neutral' ? 'Нейтральная' : PATRONS[def.patron].name;
}

export interface CardOpts {
  act?: string;
  uid?: number;
  ref?: number;
  cls?: string;
  agent?: AgentInPlay;
}

function attrs(o: CardOpts) {
  let a = '';
  if (o.act) a += ` data-act="${o.act}"`;
  if (o.uid !== undefined) a += ` data-uid="${o.uid}"`;
  if (o.ref !== undefined) a += ` data-ref="${o.ref}"`;
  return a;
}

function hpBadge(def: CardDef, agent?: AgentInPlay) {
  if (!def.hp) return '';
  const left = agent ? hpLeft(agent) : def.hp;
  return `<div class="c-hp${def.taunt ? ' taunt' : ''}" title="${def.taunt ? 'Провокация: атакуют первым' : 'Прочность'}">${left}</div>`;
}

/** Full size card with art and rules text. */
export function cardHtml(id: string, o: CardOpts = {}): string {
  const def = cardDef(id);
  const lines = cardLines(def)
    .map((l) => `<p>${l.label ? `<b>${esc(l.label)}:</b> ` : ''}${esc(l.text)}</p>`)
    .join('');
  return `<div class="card ${o.cls ?? ''} t-${def.type}" style="${styleVars(def)}" data-card="${def.id}"${attrs(o)}>
    <div class="c-head"><span class="c-cost">${def.cost}</span><span class="c-name">${esc(def.name)}</span></div>
    <img class="c-art" src="${cardArt(def)}" alt="" draggable="false">
    <div class="c-type">${TYPE_NAMES[def.type]} · ${esc(patronLabel(def))}</div>
    <div class="c-text">${lines}</div>
    ${hpBadge(def, o.agent)}
  </div>`;
}

const FX: Partial<Record<Effect['k'], (n: number) => string>> = {
  coin: (n) => `<i class="fx coin">+${n}</i>`,
  power: (n) => `<i class="fx pow">+${n}</i>`,
  prestige: (n) => `<i class="fx pre">+${n}</i>`,
  oppLosePrestige: (n) => `<i class="fx bad">−${n}✦</i>`,
  draw: (n) => `<i class="fx">+${n} карт.</i>`,
  oppDiscard: (n) => `<i class="fx">сброс ${n}</i>`,
  acquire: (n) => `<i class="fx">дар ≤${n}</i>`,
  toss: (n) => `<i class="fx">отсев ${n}</i>`,
  destroy: (n) => `<i class="fx">уничт. ${n}</i>`,
  knockout: () => `<i class="fx">нокаут</i>`,
  knockoutAll: () => `<i class="fx">нокаут всех</i>`,
  returnTop: () => `<i class="fx">возврат</i>`,
  replaceTavern: () => `<i class="fx">замена</i>`,
  heal: (n) => `<i class="fx">лечение ${n}</i>`,
  create: () => `<i class="fx">морок</i>`,
  patronCall: () => `<i class="fx">+призыв</i>`,
  donate: () => `<i class="fx">обмен</i>`,
};

/** Compact summary of a card's main effect for small tiles. */
function shortFx(def: CardDef): string {
  const one = (e: Effect): string =>
    e.k === 'choice' ? e.options.map((o) => o.map(one).join('')).join('<i class="fx or">/</i>') : (FX[e.k]?.('n' in e ? e.n : 0) ?? '');
  const main = def.play.map(one).join('');
  const combos = Object.keys(def.combo ?? {}).length ? '<i class="fx combo">К</i>' : '';
  return main + combos || '<i class="fx">—</i>';
}

/** Compact tile used everywhere on the board; tapping opens the card sheet. */
export function tileHtml(id: string, o: CardOpts & { agent?: AgentInPlay; full?: boolean } = {}): string {
  const def = cardDef(id);
  const text = o.full
    ? `<span class="t-text">${cardLines(def).map((l) => `<span>${l.label ? `<b>${esc(l.label)}:</b> ` : ''}${esc(l.text)}</span>`).join('')}</span>`
    : '';
  return `<div class="tile ${o.cls ?? ''}" style="${styleVars(def)}" data-card="${def.id}"${attrs(o)}>
    <img src="${cardArt(def)}" alt="" draggable="false">
    ${def.type === 'curse' ? '' : `<span class="t-cost">${def.cost}</span>`}
    ${hpBadge(def, o.agent)}
    <span class="t-name">${esc(def.name)}</span>
    ${o.full ? text : `<span class="t-fx">${shortFx(def)}</span>`}
  </div>`;
}

/** Small square used for agents and played cards. */
export function chipHtml(id: string, o: CardOpts & { agent?: AgentInPlay } = {}): string {
  const def = cardDef(id);
  return `<div class="chip ${o.cls ?? ''}" style="${styleVars(def)}" data-card="${def.id}"${attrs(o)}>
    <img src="${cardArt(def)}" alt="" draggable="false">${hpBadge(def, o.agent)}
  </div>`;
}

export function patronEmblem(pid: PatronId) {
  return patronEmblemUrl(pid, PATRONS[pid].palette);
}

function patronHtml(s: GameState, me: PlayerIdx, pid: PatronId): string {
  const def = PATRONS[pid];
  const f = s.favor[pid];
  const favor = pid === 'treasury' ? 'fixed' : f === undefined || f === null ? 'neutral' : f === me ? 'mine' : 'theirs';
  const can = patronAvailable(s, me, pid);
  return `<div class="patron fav-${favor}${can ? ' can' : ''}" style="--accent:${def.palette.accent};--glow:${def.palette.glow}" data-act="inspect-patron" data-patron="${pid}">
    <img src="${patronEmblem(pid)}" alt="" draggable="false">
    <span class="p-name">${esc(def.name.split(' ')[0])}</span>
  </div>`;
}

function res(p: { prestige: number; power: number; coin: number }) {
  return `<span class="res pre"><i>✦</i>${p.prestige}</span><span class="res pow"><i>⚔</i>${p.power}</span><span class="res coin"><i>●</i>${p.coin}</span>`;
}

function count(n: number, label: string, act?: string) {
  return `<span class="count"${act ? ` data-act="${act}"` : ''}><b>${n}</b><small>${label}</small></span>`;
}

function slots(tiles: string[]) {
  return tiles.map((t) => `<div class="slot">${t}</div>`).join('');
}

export function boardHtml(s: GameState, me: PlayerIdx, opts: { myTurn: boolean; idle: boolean }): string {
  const you = s.players[me];
  const them = s.players[other(me)];
  const targets = new Set(opts.idle && you.power > 0 ? attackable(s, me).map((a) => a.uid) : []);
  const theirAgents = them.agents
    .map((a) => chipHtml(a.id, { agent: a, act: 'inspect', uid: a.uid, cls: targets.has(a.uid) ? 'target' : '' }))
    .join('');
  const myAgents = you.agents
    .map((a) => chipHtml(a.id, { agent: a, act: 'inspect', uid: a.uid, cls: opts.idle && !a.activated ? 'ready' : 'spent' }))
    .join('');
  const theirPlayed = them.played.map((c) => chipHtml(c.id, { cls: 'played' })).join('');
  const played = you.played.map((c) => chipHtml(c.id, { act: 'inspect', uid: c.uid, cls: 'played' })).join('');
  const tavern = s.tavern.map((c) => {
    const can = opts.idle && cardDef(c.id).cost <= you.coin;
    return tileHtml(c.id, { act: 'inspect', uid: c.uid, cls: can ? 'buyable' : 'dim' });
  });
  const hand = you.hand.map((c: Card) => tileHtml(c.id, { act: 'inspect', uid: c.uid, cls: `full${opts.idle ? ' playable' : ''}`, full: true }));

  return `<div class="game ${opts.myTurn ? 'my-turn' : 'their-turn'}">
    <header class="bar opp-bar${opts.myTurn ? '' : ' active'}">
      <span class="who">${esc(them.name)}</span>
      <span class="res-group">${res(them)}</span>
      <span class="counts">${count(them.hand.length, 'рука')}${count(them.deck.length, 'колода')}${count(them.cooldown.length, 'сброс', 'pile-opp-cd')}</span>
    </header>
    <section class="strip opp-agents">${theirAgents || (theirPlayed ? '' : '<span class="empty">агентов нет</span>')}
      ${theirPlayed ? `<div class="part played-part">${theirPlayed}</div>` : ''}
      ${targets.size ? '<span class="hint">нажмите на агента, чтобы атаковать</span>' : ''}</section>
    <section class="patrons">${s.patrons.map((p) => patronHtml(s, me, p)).join('')}</section>
    <section class="tavern">
      <div class="label"><span>Таверна</span><small>в запасе ${s.tavernDeck.length}</small></div>
      <div class="row">${slots(tavern)}</div>
    </section>
    <section class="strip my-table">
      <div class="part counts">${count(you.deck.length, 'колода', 'pile-deck')}${count(you.cooldown.length, 'сброс', 'pile-cd')}</div>
      <div class="part">${myAgents || '<span class="empty">ваших агентов нет</span>'}</div>
      ${played ? `<div class="part played-part">${played}</div>` : ''}
    </section>
    <section class="hand">${hand.length ? slots(hand) : '<span class="empty">рука пуста</span>'}</section>
    <footer class="bar my-bar${opts.myTurn ? ' active' : ''}">
      <span class="res-group">${res(you)}</span>
      <button class="icon" data-act="menu" aria-label="Меню">☰</button>
      <button class="icon" data-act="play-all" ${opts.idle && you.hand.length ? '' : 'disabled'} aria-label="Сыграть всё">▶▶</button>
      <button class="end" data-act="end" ${opts.idle ? '' : 'disabled'}>${opts.myTurn ? 'Конец хода' : 'Ход соперника'}</button>
    </footer>
  </div>`;
}

export type SheetTarget = { kind: 'card'; uid: number } | { kind: 'patron'; patron: PatronId };

/** Bottom sheet with the full card (or patron) and the actions available for it. */
export function sheetHtml(s: GameState, me: PlayerIdx, t: SheetTarget, idle: boolean): string | null {
  const you = s.players[me];
  const them = s.players[other(me)];
  if (t.kind === 'patron') {
    const def = PATRONS[t.patron];
    const rules = PATRON_RULES[t.patron];
    const f = s.favor[t.patron];
    const favor =
      t.patron === 'treasury' ? 'Всегда нейтрален' : f === undefined || f === null ? 'Нейтрален' : f === me ? 'На вашей стороне' : 'На стороне соперника';
    const can = patronAvailable(s, me, t.patron);
    return `<div class="sheet-body patron-sheet" style="--accent:${def.palette.accent};--glow:${def.palette.glow}">
      <img src="${patronEmblem(t.patron)}" alt="">
      <h2>${esc(def.name)}</h2><p class="p-title">${esc(def.title)}</p>
      <p><b>Цена:</b> ${esc(rules.cost)}</p><p><b>Эффект:</b> ${esc(rules.effect)}</p>
      <p class="muted">${favor}. Воззвать можно один раз за ход; после этого покровитель смещается на вашу сторону.</p>
      </div>
      <div class="sheet-actions"><button class="end" data-act="patron" data-patron="${t.patron}" ${can ? '' : 'disabled'}>${can ? 'Воззвать' : 'Сейчас недоступно'}</button></div>`;
  }
  const uid = t.uid;
  let action = '';
  let card: { id: string; agent?: AgentInPlay } | null = null;
  const inHand = you.hand.find((c) => c.uid === uid);
  const inTavern = s.tavern.find((c) => c.uid === uid);
  const mine = you.agents.find((c) => c.uid === uid);
  const theirs = them.agents.find((c) => c.uid === uid);
  const played = you.played.find((c) => c.uid === uid);
  if (inHand) {
    card = inHand;
    action = `<button class="end" data-act="play" data-uid="${uid}" ${idle ? '' : 'disabled'}>Сыграть</button>`;
  } else if (inTavern) {
    card = inTavern;
    const cost = cardDef(inTavern.id).cost;
    const ok = idle && you.coin >= cost;
    action = `<button class="end" data-act="buy" data-uid="${uid}" ${ok ? '' : 'disabled'}>${ok ? `Купить за ${cost} ●` : `Нужно ${cost} ●, у вас ${you.coin}`}</button>`;
  } else if (mine) {
    card = { id: mine.id, agent: mine };
    action = `<button class="end" data-act="activate" data-uid="${uid}" ${idle && !mine.activated ? '' : 'disabled'}>${mine.activated ? 'Уже действовал в этот ход' : 'Применить'}</button>`;
  } else if (theirs) {
    card = { id: theirs.id, agent: theirs };
    const can = idle && you.power > 0 && attackable(s, me).some((a) => a.uid === uid);
    const dmg = Math.min(you.power, hpLeft(theirs));
    action = `<button class="end danger" data-act="attack" data-uid="${uid}" ${can ? '' : 'disabled'}>${
      can ? `Атаковать: −${dmg} силы` : you.power > 0 && idle ? 'Сначала агенты с провокацией' : 'Нужна сила для атаки'
    }</button>`;
  } else if (played) {
    card = played;
  }
  if (!card) return null;
  return `<div class="sheet-body">${cardHtml(card.id, { cls: 'big', agent: card.agent })}</div>
    <div class="sheet-actions">${action}</div>`;
}

export function pileGridHtml(cards: Card[]): string {
  return cards.map((c) => tileHtml(c.id)).join('');
}
