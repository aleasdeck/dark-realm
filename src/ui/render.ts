import { artUrl, cardBackUrl, patronEmblemUrl, type Subject } from '../art';
import { cardDef, PATRONS } from '../engine/cards';
import { attackable, hpLeft, other, patronAvailable } from '../engine/engine';
import { cardLines, PATRON_RULES, TYPE_NAMES } from '../engine/text';
import type { AgentInPlay, Card, CardDef, GameState, PatronId, PlayerIdx } from '../engine/types';

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

/** Compact card for agents and played cards; hovering shows the full card in the preview. */
export function miniHtml(id: string, o: CardOpts = {}): string {
  const def = cardDef(id);
  return `<div class="mini ${o.cls ?? ''}" style="${styleVars(def)}" data-card="${def.id}"${attrs(o)}>
    <img src="${cardArt(def)}" alt="" draggable="false">
    <span class="m-name">${esc(def.name)}</span>
    ${hpBadge(def, o.agent)}
  </div>`;
}

/** Tiny chip for cards already played this turn. */
export function chipHtml(id: string): string {
  const def = cardDef(id);
  return `<div class="chip" style="${styleVars(def)}" data-card="${def.id}"><img src="${cardArt(def)}" alt="" draggable="false"><span>${esc(def.name)}</span></div>`;
}

export function pileHtml(count: number, label: string, act?: string): string {
  return `<div class="pile"${act ? ` data-act="${act}" data-tip="${esc(`${label}: нажмите, чтобы посмотреть`)}"` : ''}>
    <img src="${cardBackUrl()}" alt="" draggable="false"><div><b>${count}</b><small>${label}</small></div>
  </div>`;
}

export function patronEmblem(pid: PatronId) {
  return patronEmblemUrl(pid, PATRONS[pid].palette);
}

function patronHtml(s: GameState, me: PlayerIdx, pid: PatronId): string {
  const def = PATRONS[pid];
  const f = s.favor[pid];
  const favor = pid === 'treasury' ? 'fixed' : f === undefined || f === null ? 'neutral' : f === me ? 'mine' : 'theirs';
  const favorText = { fixed: 'всегда нейтрален', neutral: 'нейтрален', mine: 'на вашей стороне', theirs: 'на стороне соперника' }[favor];
  const can = patronAvailable(s, me, pid);
  const rules = PATRON_RULES[pid];
  const tip = `${def.name}\n«${def.title}»\n\nЦена: ${rules.cost}\nЭффект: ${rules.effect}\n\nПосле воззвания покровитель переходит на вашу сторону (или из стороны соперника в нейтраль).`;
  return `<div class="patron fav-${favor}${can ? ' can' : ''}" style="--accent:${def.palette.accent};--glow:${def.palette.glow}"
      ${can ? `data-act="patron" data-patron="${pid}"` : ''} data-tip="${esc(tip)}">
    <img src="${patronEmblem(pid)}" alt="" draggable="false">
    <div class="p-body">
      <div class="p-name">${esc(def.name)}</div>
      <div class="p-cost">${esc(rules.cost)} → ${esc(rules.effect.split('.')[0])}</div>
      <div class="p-favor">${favorText}</div>
    </div>
  </div>`;
}

function playerPanel(s: GameState, pi: PlayerIdx, active: boolean, label: string) {
  const p = s.players[pi];
  return `<div class="player-panel${active ? ' active' : ''}">
    <div class="pp-name"><span>${esc(p.name)}</span><small>${active ? 'ходит' : label}</small></div>
    <div class="pp-stats">
      <div class="stat st-prestige" data-tip="Престиж: очки победы. Нужно 40 и перевес после хода соперника, или 80 сразу."><b>${p.prestige}</b><small>престиж</small></div>
      <div class="stat st-power" data-tip="Сила: в конце хода превращается в престиж. Можно тратить на атаку агентов соперника."><b>${p.power}</b><small>сила</small></div>
      <div class="stat st-coin" data-tip="Монеты: покупка карт в таверне. Сгорают в конце хода."><b>${p.coin}</b><small>монеты</small></div>
    </div>
  </div>`;
}

function emptyHint(text: string) {
  return `<div class="empty">${text}</div>`;
}

export function boardHtml(s: GameState, me: PlayerIdx, opts: { myTurn: boolean; idle: boolean }): string {
  const you = s.players[me];
  const them = s.players[other(me)];
  const targets = new Set(opts.idle && you.power > 0 ? attackable(s, me).map((a) => a.uid) : []);
  const theirAgents = them.agents
    .map((a) => miniHtml(a.id, { agent: a, act: targets.has(a.uid) ? 'attack' : undefined, uid: a.uid, cls: targets.has(a.uid) ? 'target' : '' }))
    .join('');
  const myAgents = you.agents
    .map((a) => {
      const ready = opts.idle && !a.activated;
      return miniHtml(a.id, { agent: a, act: ready ? 'activate' : undefined, uid: a.uid, cls: ready ? 'ready' : 'spent' });
    })
    .join('');
  const played = you.played.map((c) => chipHtml(c.id)).join('');
  const tavern = s.tavern
    .map((c) => {
      const can = opts.idle && cardDef(c.id).cost <= you.coin;
      return cardHtml(c.id, { act: can ? 'buy' : undefined, uid: c.uid, cls: can ? 'buyable' : 'tavern' });
    })
    .join('');
  const hand = you.hand.map((c: Card) => cardHtml(c.id, { act: opts.idle ? 'play' : undefined, uid: c.uid, cls: opts.idle ? 'playable' : '' })).join('');
  const oppHand = `<div class="opp-hand" data-tip="Карт в руке соперника">${Array.from({ length: them.hand.length }, () => `<img src="${cardBackUrl()}" alt="">`).join('')}<span>${them.hand.length}</span></div>`;
  const attackHint = targets.size ? ' · нажмите на агента, чтобы атаковать силой' : '';

  return `<div class="board ${opts.myTurn ? 'my-turn' : 'their-turn'}">
    <section class="zone zone-them">
      ${playerPanel(s, other(me), !opts.myTurn, 'соперник')}
      <div class="zone-cell grow"><div class="zone-title">Агенты соперника${attackHint}</div>
        <div class="cards-row">${theirAgents || emptyHint('нет агентов')}</div></div>
      <div class="zone-cell piles">${oppHand}${pileHtml(them.deck.length, 'колода')}${pileHtml(them.cooldown.length, 'сброс', 'pile-opp-cd')}</div>
    </section>

    <section class="patron-strip">
      <div class="strip-side them">↑ соперник</div>
      <div class="patrons">${s.patrons.map((p) => patronHtml(s, me, p)).join('')}</div>
      <div class="strip-side you">↓ вы</div>
    </section>

    <section class="tavern-zone">
      <div class="zone-title">Таверна: покупайте карты за монеты</div>
      <div class="tavern-row"><div class="tavern-cards">${tavern}</div>
        <div class="piles">${pileHtml(s.tavernDeck.length, 'в запасе')}</div></div>
    </section>

    <section class="zone zone-you">
      <div class="zone-cell side-col">
        ${playerPanel(s, me, opts.myTurn, 'вы')}
        <div class="piles-row">${pileHtml(you.deck.length, 'колода', 'pile-deck')}${pileHtml(you.cooldown.length, 'сброс', 'pile-cd')}</div>
      </div>
      <div class="zone-cell grow hand-cell">
        <div class="zone-title">Ваша рука${opts.idle && you.hand.length ? ' · нажмите на карту, чтобы сыграть' : ''}</div>
        <div class="hand">${hand || emptyHint('рука пуста')}</div>
      </div>
      <div class="zone-cell table-col">
        <div class="zone-title">Ваши агенты${opts.idle && you.agents.some((a) => !a.activated) ? ' · нажмите, чтобы применить' : ''}</div>
        <div class="cards-row wrap">${myAgents || emptyHint('нет агентов')}</div>
        <div class="zone-title">Сыграно в этот ход</div>
        <div class="chips">${played || emptyHint('пока ничего')}</div>
      </div>
    </section>

    <nav class="action-bar">
      <div class="bar-left">
        <button class="ghost" data-act="log">Журнал</button>
        <button class="ghost" data-act="concede">Сдаться</button>
      </div>
      <div class="turn-badge ${opts.myTurn ? 'mine' : 'theirs'}">${opts.myTurn ? 'Ваш ход' : 'Ход соперника'} · ход ${s.turn}</div>
      <div class="bar-right">
        <button data-act="play-all" ${opts.idle && you.hand.length ? '' : 'disabled'}>Сыграть всё</button>
        <button class="end" data-act="end" ${opts.idle ? '' : 'disabled'}>Конец хода</button>
      </div>
    </nav>
  </div>`;
}
