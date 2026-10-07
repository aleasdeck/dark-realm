import { artUrl, patronEmblemUrl, type Subject } from '../art';
import { customCardArt, customEmblem } from '../art/custom';
import { cardDef, PATRONS } from '../engine/cards';
import { attackable, draftedBy, hpLeft, mustPlayCurse, other, patronAvailable, prestigeGoal } from '../engine/engine';
import { cardLines, PATRON_RULES, TYPE_NAMES } from '../engine/text';
import { esc, paintIcons, richText } from './rich';
import { icon } from './icons';
import type { Action, AgentInPlay, Card, CardDef, Effect, GameState, PatronId, Pending, PlayerIdx } from '../engine/types';

export { esc, paintIcons, richText };

const NEUTRAL_PALETTE = { bg1: '#0b0b0d', bg2: '#25222a', accent: '#8d8577', glow: '#f1d9a0' };

export function paletteOf(def: CardDef) {
  return def.patron === 'neutral' ? NEUTRAL_PALETTE : PATRONS[def.patron].palette;
}

export function cardArt(def: CardDef): string {
  return customCardArt(def.id) ?? artUrl(def.art as Subject, paletteOf(def), def.seed ?? 0);
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
  /** Show the full card in a tooltip on mouse hover. */
  tip?: boolean;
}

function attrs(o: CardOpts) {
  let a = o.tip ? ' data-tip="card"' : '';
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

const BOLT = 'M14.2 1.5 4.6 13.6h6.1L8.9 22.5 19.4 9.9h-6.2z';
const BUST = 'M12 2.4a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8zM2.8 22.3c.5-5.3 4.3-8.5 9.2-8.5s8.7 3.2 9.2 8.5z';
const SCROLL =
  'M7.5 2.5h11.2a3 3 0 0 1 0 6H17v10.2a3 3 0 0 1-3 3H5.3a3 3 0 0 1 0-6H7V3zM9.6 6.3v1.6h5.4V6.3zM9.6 10v1.6h5.4V10zM9.6 13.7v1.6h4V13.7z';
const SKULL =
  'M12 2C6.9 2 3.5 5.5 3.5 10c0 2.6 1.1 4.6 3 5.8V20c0 1.1.9 2 2 2h7c1.1 0 2-.9 2-2v-4.2c1.9-1.2 3-3.2 3-5.8C20.5 5.5 17.1 2 12 2zM8.6 9.3a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2zm6.8 0a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2zM12 14.2l1.4 2.6h-2.8z';
/** Type badge glyph, its hand-drawn icon and color class: the drawing says action or agent, the color says contract. */
const TYPE_BADGE: Record<CardDef['type'], [glyph: string, icon: string, cls: string]> = {
  action: [BOLT, 'kind_action', 'act'],
  starter: [BOLT, 'kind_action', 'act'],
  agent: [BUST, 'kind_agent', 'agent'],
  contractAction: [SCROLL, 'kind_contract', 'contract'],
  contractAgent: [BUST, 'kind_agent', 'contract'],
  curse: [SKULL, 'kind_curse', 'curse'],
};

/** Small coin under the cost that tells the card's type at a glance; agents already on the table go without it. */
function typeBadge(def: CardDef): string {
  const [glyph, pic, cls] = TYPE_BADGE[def.type];
  const svg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${glyph}"/></svg>`;
  return `<span class="c-kind k-${cls}" title="${TYPE_NAMES[def.type]}">${icon(pic, svg)}</span>`;
}

/** Full size card: the art fills the top edge to edge, cost, type and name sit on it, rules text below. */
export function cardHtml(id: string, o: CardOpts = {}): string {
  const def = cardDef(id);
  const lines = cardLines(def)
    .map((l) => `<p>${l.label ? `<b>${esc(l.label)}:</b> ` : ''}${richText(l.text)}</p>`)
    .join('');
  return `<div class="card ${o.cls ?? ''} t-${def.type}" style="${styleVars(def)}" data-card="${def.id}"${attrs(o)}>
    <div class="c-top">
      <img class="c-art" src="${cardArt(def)}" alt="" draggable="false">
      <span class="c-cost">${def.cost}</span>
      <div class="c-title"><span class="c-name">${esc(def.name)}</span><span class="c-type">${TYPE_NAMES[def.type]} · ${esc(patronLabel(def))}</span></div>
    </div>
    <div class="c-text">${lines}</div>
    ${typeBadge(def)}
    ${hpBadge(def, o.agent)}
  </div>`;
}

/** An effect on a tile: its icon with the amount in front, or the short text when the icon is missing. */
const fx = (pic: string, text: string, n = '', cls = '') => `<i class="fx${cls ? ` ${cls}` : ''}">${icon(pic) ? `${n}${icon(pic)}` : text}</i>`;

const FX: Partial<Record<Effect['k'], (n: number) => string>> = {
  coin: (n) => `<i class="fx coin">+${n}</i>`,
  power: (n) => `<i class="fx pow">+${n}</i>`,
  prestige: (n) => `<i class="fx pre">+${n}</i>`,
  oppLosePrestige: (n) => fx('fx_opp_lose_prestige', `−${n}✦`, `−${n}`, 'bad'),
  draw: (n) => fx('fx_draw', `+${n} карт.`, `+${n}`),
  oppDiscard: (n) => fx('fx_opp_discard', `сброс ${n}`, `${n}`),
  acquire: (n) => fx('fx_acquire', `дар ≤${n}`, `≤${n}`),
  toss: (n) => fx('fx_toss', `отсев ${n}`, `${n}`),
  destroy: (n) => fx('fx_destroy', `уничт. ${n}`, `${n}`),
  knockout: () => fx('fx_knockout', 'нокаут'),
  knockoutAll: () => fx('fx_knockout_all', 'нокаут всех'),
  returnTop: () => fx('fx_return', 'возврат'),
  replaceTavern: () => fx('fx_replace', 'замена'),
  heal: (n) => `<i class="fx">лечение ${n}</i>`,
  create: () => fx('fx_create', '+карта'),
  patronCall: () => fx('fx_patron_call', '+призыв'),
  donate: () => fx('fx_donate', 'обмен'),
  confine: () => fx('fx_confine', 'заточ.'),
  setback: () => fx('fx_setback', 'расплата', '', 'bad'),
};

/** Compact summary of a card's main effect for small tiles. */
function shortFx(def: CardDef): string {
  const one = (e: Effect): string =>
    e.k === 'choice' ? e.options.map((o) => o.map(one).join('')).join('<i class="fx or">/</i>') : (FX[e.k]?.('n' in e ? e.n : 0) ?? '');
  const main = def.play.map(one).join('');
  const combos = Object.keys(def.combo ?? {}).length ? (icon('combo') ? `<i class="fx">${icon('combo')}</i>` : '<i class="fx combo">К</i>') : '';
  const trigger = def.trigger ? `<i class="fx">${icon('trigger', '⟳')}</i>` : '';
  return main + trigger + combos || '<i class="fx">—</i>';
}

/** Compact tile used everywhere on the board; tapping opens the card sheet. */
export function tileHtml(id: string, o: CardOpts & { agent?: AgentInPlay } = {}): string {
  const def = cardDef(id);
  return `<div class="tile ${o.cls ?? ''}" style="${styleVars(def)}" data-card="${def.id}"${attrs(o)}>
    <img src="${cardArt(def)}" alt="" draggable="false">
    ${def.type === 'curse' ? '' : `<span class="t-cost">${def.cost}</span>`}
    ${typeBadge(def)}
    ${hpBadge(def, o.agent)}
    <span class="t-name">${esc(def.name)}</span>
    <span class="t-fx">${shortFx(def)}</span>
  </div>`;
}

/** Small square used for agents and played cards. */
export function chipHtml(id: string, o: CardOpts & { agent?: AgentInPlay } = {}, vars = ''): string {
  const def = cardDef(id);
  return `<div class="chip ${o.cls ?? ''}" style="${styleVars(def)}${vars ? `;${vars}` : ''}" data-card="${def.id}"${attrs(o)}>
    <img src="${cardArt(def)}" alt="" draggable="false">${hpBadge(def, o.agent)}
  </div>`;
}

/**
 * Cards played this turn as a vertical column, newest on top, that shows up to five and scrolls through the rest.
 * A tap on any of them opens them all in a sheet.
 */
function playedHtml(cards: Card[], side: 'me' | 'opp', focusUid: number): string {
  if (!cards.length) return '';
  const rows = [...cards]
    .reverse()
    // the stacking index keeps each card above the older one peeking out under it
    .map((c, i) => chipHtml(c.id, { act: 'played', uid: c.uid, cls: 'played' + (c.uid === focusUid ? ' focused' : ''), tip: true }, `--i:${i}`))
    .join('');
  return `<div class="part played-part" aria-label="Разыграно: ${cards.length}"><div class="pl-list" data-side="${side}" data-clip>${rows}</div></div>`;
}

export function patronEmblem(pid: PatronId) {
  return customEmblem(pid) ?? patronEmblemUrl(pid, PATRONS[pid].palette);
}

/** Where a patron leans: the emblem slides along a track toward that player's side of the table. */
function favorOf(s: GameState, me: PlayerIdx, pid: PatronId): 'fixed' | 'neutral' | 'mine' | 'theirs' {
  const f = s.favor[pid];
  return pid === 'treasury' ? 'fixed' : f === undefined || f === null ? 'neutral' : f === me ? 'mine' : 'theirs';
}

function patronHtml(s: GameState, me: PlayerIdx, pid: PatronId, focused: boolean): string {
  const def = PATRONS[pid];
  const favor = favorOf(s, me, pid);
  const can = patronAvailable(s, me, pid);
  return `<div class="patron fav-${favor}${can ? ' can' : ''}${focused ? ' focused' : ''}" style="--accent:${def.palette.accent};--glow:${def.palette.glow}" data-act="inspect-patron" data-patron="${pid}" data-tip="patron">
    <div class="p-track"><img src="${patronEmblem(pid)}" alt="" draggable="false"></div>
    <span class="p-name">${esc(def.name.split(' ')[0])}</span>
  </div>`;
}

/**
 * The patron row: the treasury as a round medallion in the middle,
 * the patrons you drafted on the left and the opponent's on the right.
 */
function patronsRowHtml(s: GameState, me: PlayerIdx, focused: PatronId | null): string {
  const side = (p: PlayerIdx) =>
    s.patrons
      .filter((pid) => draftedBy(s, pid) === p)
      .map((pid) => patronHtml(s, me, pid, pid === focused))
      .join('');
  const chest = s.patrons.includes('treasury') ? treasuryHtml(s, me, focused === 'treasury') : '';
  return `<div class="p-side mine">${side(me)}</div>${chest}<div class="p-side theirs">${side(other(me))}</div>`;
}

function treasuryHtml(s: GameState, me: PlayerIdx, focused: boolean): string {
  const def = PATRONS.treasury;
  const can = patronAvailable(s, me, 'treasury');
  return `<div class="patron chest${can ? ' can' : ''}${focused ? ' focused' : ''}" style="--accent:${def.palette.accent};--glow:${def.palette.glow}" data-act="inspect-patron" data-patron="treasury" data-tip="patron">
    <div class="p-track"><img src="${patronEmblem('treasury')}" alt="" draggable="false"></div>
  </div>`;
}

/** Tooltip body for a patron: what calling it costs and does, and whose side it is on. */
export function patronTipHtml(s: GameState | null, me: PlayerIdx, pid: PatronId): string {
  const def = PATRONS[pid];
  const rules = PATRON_RULES[pid];
  const favor = s ? favorOf(s, me, pid) : 'neutral';
  const side = { fixed: 'Всегда нейтрален', neutral: 'Нейтрален', mine: 'Благоволит вам', theirs: 'Благоволит сопернику' }[favor];
  return `<div class="tip-patron fav-${favor}" style="--accent:${def.palette.accent};--glow:${def.palette.glow}">
    <div class="tp-head"><img src="${patronEmblem(pid)}" alt=""><div><h3>${esc(def.name)}</h3><p class="p-title">${esc(def.title)}</p></div></div>
    <p><b>Цена:</b> ${richText(rules.cost)}</p><p><b>Эффект:</b> ${richText(rules.effect)}</p>
    <p class="tp-side">${side}</p>
  </div>`;
}

/** Period of the glow on a prestige counter at the goal. */
const GOAL_PULSE_MS = 1600;

function res(p: { prestige: number; power: number; coin: number }, goal: number) {
  // At the goal the counter glows; the delay keeps the pulse in step across redraws of the board.
  const pre =
    p.prestige >= goal
      ? `<span class="res pre at-goal" style="animation-delay:-${Math.round(performance.now() % GOAL_PULSE_MS)}ms">`
      : '<span class="res pre">';
  return `${pre}<i>✦</i>${p.prestige}</span><span class="res pow"><i>⚔</i>${p.power}</span><span class="res coin"><i>●</i>${p.coin}</span>`;
}

function count(n: number, label: string, pic: string, act?: string) {
  const ic = icon(pic);
  return `<span class="count${ic ? ' with-ic' : ''}"${act ? ` data-act="${act}"` : ''} title="${label}">${ic}<b>${n}</b>${ic ? '' : `<small>${label}</small>`}</span>`;
}

function slots(tiles: string[]) {
  return tiles.map((t) => `<div class="slot">${t}</div>`).join('');
}

/** Card backs fanned along the top edge, one per card in the opponent's hand. */
function backsHtml(n: number): string {
  return Array.from({ length: n }, (_, i) => {
    const o = i - (n - 1) / 2;
    return `<div class="back" style="--o:${o};--ao:${Math.abs(o)}"><span>✠</span></div>`;
  }).join('');
}

export type Focus = { kind: 'card'; uid: number } | { kind: 'patron'; patron: PatronId };

/**
 * Effects that take cards from the tavern are picked on the table itself: the cards that qualify
 * light up in the tavern, and the usual tap-twice takes (or marks) one.
 */
export interface TavernPick {
  pending: Pending;
  /** Cards marked so far when several may be picked (tavern refresh). */
  marked: Set<number>;
}

const TAVERN_KINDS: Pending['kind'][] = ['acquire', 'bargain', 'replaceTavern'];

/** The tavern pick the local player has to make now, if any. */
export function tavernPick(s: GameState, me: PlayerIdx, marked: Set<number>): TavernPick | null {
  const p = s.pending;
  return p && p.player === me && TAVERN_KINDS.includes(p.kind) ? { pending: p, marked } : null;
}

/** The wide button's text with its icon in front. */
const endLabel = (pic: string, text: string) => `${icon(pic)}<span>${text}</span>`;

/** The button under the table that finishes (or skips) a tavern pick. */
function pickButton(pick: TavernPick): string {
  const p = pick.pending;
  const n = pick.marked.size;
  if (p.kind === 'replaceTavern') {
    return `<button class="end" data-act="confirm">${n ? endLabel('pick_replace', `Заменить (${n})`) : endLabel('pick_skip', 'Не менять')}</button>`;
  }
  if (p.min > 0) return '<button class="end" disabled>Выберите карту в таверне</button>';
  return `<button class="end" data-act="confirm">${endLabel('pick_skip', 'Не брать')}</button>`;
}

/** A block's name, written up the left edge outside its frame; the short form shows when the full one would not fit. */
function sideLabel(cls: string, full: string, short: string) {
  return `<div class="side-label sl-${cls}"><span class="sl-full">${full}</span><span class="sl-short">${short}</span></div>`;
}

export function boardHtml(
  s: GameState,
  me: PlayerIdx,
  opts: { myTurn: boolean; idle: boolean; focus: Focus | null; pick: TavernPick | null },
): string {
  const you = s.players[me];
  const them = s.players[other(me)];
  const focusUid = opts.focus?.kind === 'card' ? opts.focus.uid : -1;
  const f = (uid: number) => (uid === focusUid ? ' focused' : '');
  const targets = new Set(opts.idle && you.power > 0 ? attackable(s, me).map((a) => a.uid) : []);
  const theirAgents = them.agents
    .map((a) => chipHtml(a.id, { agent: a, act: 'inspect', uid: a.uid, cls: (targets.has(a.uid) ? 'target' : '') + f(a.uid), tip: true }))
    .join('');
  const myAgents = you.agents
    .map((a) => chipHtml(a.id, { agent: a, act: 'inspect', uid: a.uid, cls: (opts.idle && !a.activated ? 'ready' : 'spent') + f(a.uid), tip: true }))
    .join('');
  const theirPlayed = playedHtml(them.played, 'opp', focusUid);
  const played = playedHtml(you.played, 'me', focusUid);
  const pick = opts.pick;
  const pickable = new Set(pick?.pending.options.map((o) => o.ref));
  const tavern = s.tavern.map((c) => {
    const cls = pick
      ? pickable.has(c.uid)
        ? 'pickable' + (pick.marked.has(c.uid) ? ' marked' : '')
        : 'dim'
      : opts.idle && cardDef(c.id).cost <= you.coin
        ? 'buyable'
        : 'dim';
    return tileHtml(c.id, { act: 'inspect', uid: c.uid, cls: cls + f(c.uid), tip: true });
  });
  const n = you.hand.length;
  const hand = you.hand
    .map((c: Card, i) => {
      const o = i - (n - 1) / 2;
      return `<div class="fan-slot${f(c.uid)}" style="--o:${o};--ao:${Math.abs(o)}">${tileHtml(c.id, { act: 'inspect', uid: c.uid, cls: opts.idle ? 'playable' : '' })}</div>`;
    })
    .join('');
  const focusPatron = opts.focus?.kind === 'patron' ? opts.focus.patron : null;

  return `<div class="game ${opts.myTurn ? 'my-turn' : 'their-turn'}">
    <header class="bar opp-bar${opts.myTurn ? '' : ' active'}">
      <span class="who">${esc(them.name)}</span>
      <span class="res-group">${res(them, prestigeGoal(s))}</span>
      <span class="counts">${count(them.deck.length, 'колода', 'pile_deck', 'pile-opp-deck')}${count(them.cooldown.length, 'сброс', 'pile_discard', 'pile-opp-cd')}</span>
    </header>
    <section class="opp-hand" aria-label="Карт в руке соперника: ${them.hand.length}"><span class="oh-name">${esc(them.name)}</span>${backsHtml(them.hand.length)}</section>
    ${targets.size ? sideLabel('oppag attack', 'Атакуйте агентов', 'Атака') : sideLabel('oppag', 'Агенты соперника', 'Агенты')}
    <section class="strip opp-agents${theirPlayed ? ' has-played' : ''}" style="--na:${them.agents.length}">
      <div class="s-body">
        ${theirAgents ? `<div class="part agents">${theirAgents}</div>` : theirPlayed ? '<div class="part agents"></div>' : '<span class="empty">агентов нет</span>'}
        ${theirPlayed}
      </div>
    </section>
    <div class="side-label sl-tavern${pick ? ' picking' : ''}"><span>Таверна</span><small>в запасе ${s.tavernDeck.length}</small></div>
    <section class="tavern${pick ? ' picking' : ''}">
      ${pick ? `<div class="pick" title="${esc(pick.pending.prompt)}">${esc(pick.pending.prompt)}</div>` : ''}
      <div class="row">${slots(tavern)}</div>
    </section>
    <div class="side-label sl-patrons"><span>Покровители</span></div>
    <section class="patrons"><div class="p-row">${patronsRowHtml(s, me, focusPatron)}</div></section>
    ${sideLabel('table', 'Ваши агенты', 'Агенты')}
    <section class="strip my-table${played ? ' has-played' : ''}" style="--na:${you.agents.length}">
      <div class="s-body">
        <div class="part agents">${myAgents || '<span class="empty">агентов нет</span>'}</div>
        ${played}
      </div>
    </section>
    <section class="hand fan" style="--n:${n}">${n ? hand : '<span class="empty">рука пуста</span>'}</section>
    <div class="bar my-bar${opts.myTurn ? ' active' : ''}">
      <span class="who">${esc(you.name)}</span>
      <span class="res-group">${res(you, prestigeGoal(s))}</span>
      <span class="counts">${count(you.deck.length, 'колода', 'pile_deck', 'pile-deck')}${count(you.cooldown.length, 'сброс', 'pile_discard', 'pile-cd')}</span>
    </div>
    <footer class="controls">
      <button class="icon" data-act="menu" aria-label="Меню">${icon('menu', '☰')}</button>
      <button class="icon" data-act="play-all" ${opts.idle && you.hand.length ? '' : 'disabled'} aria-label="Сыграть всё">${icon('play_all', '▶▶')}</button>
      ${pick ? pickButton(pick) : `<button class="end" data-act="end" ${opts.idle ? '' : 'disabled'}>${opts.myTurn ? endLabel('end_turn', 'Конец хода') : endLabel('opponent_turn', 'Ход соперника')}</button>`}
    </footer>
  </div>`;
}

export interface FocusView {
  /** Enlarged card or patron panel. */
  html: string;
  /** Text on the confirm strip under it; empty when there is nothing to do. */
  label: string;
  /** Whether a second tap performs the action. */
  can: boolean;
  action: Action | null;
  /** During a tavern refresh a second tap marks or unmarks this card instead of an action. */
  mark?: number;
}

/**
 * What a selected card or patron shows when it slides out enlarged, and what a second tap does.
 * Returns null once the target has left the table.
 */
export function focusView(s: GameState, me: PlayerIdx, t: Focus, idle: boolean, pick: TavernPick | null = null): FocusView | null {
  const you = s.players[me];
  const them = s.players[other(me)];
  const waitPick = 'Сначала выберите карту в таверне';
  if (t.kind === 'patron') {
    const can = patronAvailable(s, me, t.patron);
    return {
      html: patronTipHtml(s, me, t.patron),
      label: pick ? waitPick : can ? 'Нажмите ещё раз: воззвать' : 'Сейчас воззвать нельзя',
      can,
      action: { t: 'patron', patron: t.patron },
    };
  }
  const uid = t.uid;
  const inHand = you.hand.find((c) => c.uid === uid);
  const inTavern = s.tavern.find((c) => c.uid === uid);
  const mine = you.agents.find((c) => c.uid === uid);
  const theirs = them.agents.find((c) => c.uid === uid);
  const played = you.played.find((c) => c.uid === uid) ?? them.played.find((c) => c.uid === uid);
  const view = (id: string, label: string, can: boolean, action: Action | null, agent?: AgentInPlay): FocusView => ({
    html: cardHtml(id, { cls: 'big', agent }),
    label,
    can,
    action,
  });
  if (pick) {
    const card = inTavern ?? inHand ?? mine ?? theirs ?? played;
    if (!card) return null;
    const agent = mine ?? theirs;
    if (!inTavern) return view(card.id, waitPick, false, null, agent);
    const kind = pick.pending.kind;
    if (!pick.pending.options.some((o) => o.ref === uid)) {
      return view(card.id, kind === 'acquire' ? 'Слишком дорогая' : 'Эту карту взять нельзя', false, null);
    }
    if (kind === 'replaceTavern') {
      const marked = pick.marked.has(uid);
      if (!marked && pick.marked.size >= pick.pending.max) return view(card.id, `Отмечено уже ${pick.marked.size}`, false, null);
      return { ...view(card.id, marked ? 'Нажмите ещё раз: оставить' : 'Нажмите ещё раз: заменить', true, null), mark: uid };
    }
    const label = kind === 'bargain' ? 'Ещё раз: взять, соперник получит копию' : 'Нажмите ещё раз: взять бесплатно';
    return view(card.id, label, true, { t: 'choose', picks: [uid] });
  }
  if (inHand) {
    const curseFirst = mustPlayCurse(you, inHand.id);
    const label = !idle ? 'Сейчас не ваш ход' : curseFirst ? 'Сначала разыграйте «Морок»' : 'Нажмите ещё раз: сыграть';
    return view(inHand.id, label, idle && !curseFirst, { t: 'play', uid });
  }
  if (inTavern) {
    const cost = cardDef(inTavern.id).cost;
    const ok = idle && you.coin >= cost;
    return view(inTavern.id, ok ? `Нажмите ещё раз: купить за ${cost} ●` : `Нужно ${cost} ●, у вас ${you.coin}`, ok, { t: 'buy', uid });
  }
  if (mine) {
    const ok = idle && !mine.activated;
    return view(mine.id, mine.activated ? 'Уже действовал в этот ход' : ok ? 'Нажмите ещё раз: применить' : 'Сейчас не ваш ход', ok, { t: 'activate', uid }, mine);
  }
  if (theirs) {
    const can = idle && you.power > 0 && attackable(s, me).some((a) => a.uid === uid);
    const dmg = Math.min(you.power, hpLeft(theirs));
    const label = can ? `Нажмите ещё раз: атаковать, −${dmg} ⚔` : you.power > 0 && idle ? 'Сначала агенты с провокацией' : 'Нужна сила для атаки';
    return view(theirs.id, label, can, { t: 'attack', uid }, theirs);
  }
  if (played) return view(played.id, '', false, null);
  return null;
}

export function pileGridHtml(cards: Card[]): string {
  return cards.map((c) => tileHtml(c.id, { act: 'peek' })).join('');
}
