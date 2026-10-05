import { artUrl, patronEmblemUrl, type Subject } from '../art';
import { cardDef, PATRONS } from '../engine/cards';
import { attackable, hpLeft, mustPlayCurse, other, patronAvailable } from '../engine/engine';
import { cardLines, PATRON_RULES, TYPE_NAMES } from '../engine/text';
import { musicOn } from './music';
import type { Action, AgentInPlay, Card, CardDef, Effect, GameState, PatronId, PlayerIdx } from '../engine/types';

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
export function tileHtml(id: string, o: CardOpts & { agent?: AgentInPlay } = {}): string {
  const def = cardDef(id);
  return `<div class="tile ${o.cls ?? ''}" style="${styleVars(def)}" data-card="${def.id}"${attrs(o)}>
    <img src="${cardArt(def)}" alt="" draggable="false">
    ${def.type === 'curse' ? '' : `<span class="t-cost">${def.cost}</span>`}
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

/** Cards played this turn as a vertical column, newest on top, that shows up to five and scrolls through the rest. */
function playedHtml(cards: Card[], side: 'me' | 'opp', focusUid: number): string {
  if (!cards.length) return '';
  const rows = [...cards]
    .reverse()
    // the stacking index keeps each card above the older one peeking out under it
    .map((c, i) => chipHtml(c.id, { act: 'inspect', uid: c.uid, cls: 'played' + (c.uid === focusUid ? ' focused' : ''), tip: true }, `--i:${i}`))
    .join('');
  return `<div class="part played-part" aria-label="Разыграно: ${cards.length}"><div class="pl-list" data-side="${side}" data-clip>${rows}</div></div>`;
}

export function patronEmblem(pid: PatronId) {
  return patronEmblemUrl(pid, PATRONS[pid].palette);
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

/** Tooltip body for a patron: what calling it costs and does, and whose side it is on. */
export function patronTipHtml(s: GameState | null, me: PlayerIdx, pid: PatronId): string {
  const def = PATRONS[pid];
  const rules = PATRON_RULES[pid];
  const favor = s ? favorOf(s, me, pid) : 'neutral';
  const side = { fixed: 'Всегда нейтрален', neutral: 'Нейтрален', mine: 'Благоволит вам', theirs: 'Благоволит сопернику' }[favor];
  return `<div class="tip-patron fav-${favor}" style="--accent:${def.palette.accent};--glow:${def.palette.glow}">
    <div class="tp-head"><img src="${patronEmblem(pid)}" alt=""><div><h3>${esc(def.name)}</h3><p class="p-title">${esc(def.title)}</p></div></div>
    <p><b>Цена:</b> ${esc(rules.cost)}</p><p><b>Эффект:</b> ${esc(rules.effect)}</p>
    <p class="tp-side">${side}</p>
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

/** Card backs fanned along the top edge, one per card in the opponent's hand. */
function backsHtml(n: number): string {
  return Array.from({ length: n }, (_, i) => {
    const o = i - (n - 1) / 2;
    return `<div class="back" style="--o:${o};--ao:${Math.abs(o)}"><span>✠</span></div>`;
  }).join('');
}

export type Focus = { kind: 'card'; uid: number } | { kind: 'patron'; patron: PatronId };

export function boardHtml(s: GameState, me: PlayerIdx, opts: { myTurn: boolean; idle: boolean; focus: Focus | null }): string {
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
  const tavern = s.tavern.map((c) => {
    const can = opts.idle && cardDef(c.id).cost <= you.coin;
    return tileHtml(c.id, { act: 'inspect', uid: c.uid, cls: (can ? 'buyable' : 'dim') + f(c.uid), tip: true });
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
      <span class="res-group">${res(them)}</span>
      <span class="counts">${count(them.deck.length, 'колода')}${count(them.cooldown.length, 'сброс', 'pile-opp-cd')}</span>
    </header>
    <section class="opp-hand" aria-label="Карт в руке соперника: ${them.hand.length}">${backsHtml(them.hand.length)}</section>
    <section class="strip opp-agents${theirPlayed ? ' has-played' : ''}" style="--na:${them.agents.length}">
      ${theirAgents ? `<div class="part agents">${theirAgents}</div>` : theirPlayed ? '<div class="part agents"></div>' : '<span class="empty">агентов нет</span>'}
      ${theirPlayed}
      ${targets.size ? '<span class="hint">нажмите на агента, чтобы атаковать</span>' : ''}</section>
    <section class="tavern">
      <div class="label"><span>Таверна</span><small>в запасе ${s.tavernDeck.length}</small></div>
      <div class="row">${slots(tavern)}</div>
    </section>
    <section class="patrons">${s.patrons.map((p) => patronHtml(s, me, p, p === focusPatron)).join('')}</section>
    <section class="strip my-table${played ? ' has-played' : ''}" style="--na:${you.agents.length}">
      <div class="part agents">${myAgents || '<span class="empty">ваших агентов нет</span>'}</div>
      ${played}
    </section>
    <section class="hand fan" style="--n:${n}">${n ? hand : '<span class="empty">рука пуста</span>'}</section>
    <div class="bar my-bar${opts.myTurn ? ' active' : ''}">
      <span class="who">${esc(you.name)}</span>
      <span class="res-group">${res(you)}</span>
      <span class="counts">${count(you.deck.length, 'колода', 'pile-deck')}${count(you.cooldown.length, 'сброс', 'pile-cd')}</span>
    </div>
    <footer class="controls">
      <button class="icon" data-act="menu" aria-label="Меню">☰</button>
      <button class="icon${musicOn() ? '' : ' off'}" data-act="music" aria-label="Музыка" aria-pressed="${musicOn()}">♪</button>
      <button class="icon" data-act="play-all" ${opts.idle && you.hand.length ? '' : 'disabled'} aria-label="Сыграть всё">▶▶</button>
      <button class="end" data-act="end" ${opts.idle ? '' : 'disabled'}>${opts.myTurn ? 'Конец хода' : 'Ход соперника'}</button>
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
}

/**
 * What a selected card or patron shows when it slides out enlarged, and what a second tap does.
 * Returns null once the target has left the table.
 */
export function focusView(s: GameState, me: PlayerIdx, t: Focus, idle: boolean): FocusView | null {
  const you = s.players[me];
  const them = s.players[other(me)];
  if (t.kind === 'patron') {
    const can = patronAvailable(s, me, t.patron);
    return {
      html: patronTipHtml(s, me, t.patron),
      label: can ? 'Нажмите ещё раз: воззвать' : 'Сейчас воззвать нельзя',
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
  return cards.map((c) => tileHtml(c.id)).join('');
}
