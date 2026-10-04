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

export function backHtml(count: number, label: string, act?: string): string {
  return `<div class="pile"${act ? ` data-act="${act}"` : ''}>
    <img src="${cardBackUrl()}" alt="" draggable="false"><span class="pile-n">${count}</span><span class="pile-l">${label}</span>
  </div>`;
}

export function patronEmblem(pid: PatronId) {
  return patronEmblemUrl(pid, PATRONS[pid].palette);
}

function patronHtml(s: GameState, me: PlayerIdx, pid: PatronId): string {
  const def = PATRONS[pid];
  const f = s.favor[pid];
  const favor = pid === 'treasury' ? 'neutral-fixed' : f === undefined || f === null ? 'neutral' : f === me ? 'mine' : 'theirs';
  const favorText = { 'neutral-fixed': 'всегда нейтральна', neutral: 'нейтрален', mine: 'благоволит вам', theirs: 'благоволит сопернику' }[favor];
  const can = patronAvailable(s, me, pid);
  const rules = PATRON_RULES[pid];
  return `<div class="patron fav-${favor}${can ? ' can' : ''}" style="${`--accent:${def.palette.accent};--glow:${def.palette.glow}`}"
      ${can ? `data-act="patron" data-patron="${pid}"` : ''} data-tip="${esc(`${def.name}\nЦена: ${rules.cost}\n${rules.effect}`)}">
    <img src="${patronEmblem(pid)}" alt="" draggable="false">
    <div class="p-name">${esc(def.name)}</div>
    <div class="p-favor">${favorText}</div>
  </div>`;
}

function stats(s: GameState, pi: PlayerIdx) {
  const p = s.players[pi];
  return `<span class="stat st-prestige" title="Престиж">✦ ${p.prestige}</span>
    <span class="stat st-power" title="Сила">⚔ ${p.power}</span>
    <span class="stat st-coin" title="Монеты">● ${p.coin}</span>`;
}

function track(s: GameState, me: PlayerIdx) {
  const pct = (v: number) => Math.min(100, (v / 40) * 100);
  const mine = s.players[me].prestige;
  const theirs = s.players[other(me)].prestige;
  return `<div class="track" title="Победа: 40 престижа и удержать перевес, или 80 сразу">
    <div class="track-bar them" style="width:${pct(theirs)}%"></div>
    <div class="track-bar you" style="width:${pct(mine)}%"></div>
    <span>${mine} : ${theirs} / 40</span>
  </div>`;
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
  const played = you.played.map((c) => miniHtml(c.id, { cls: 'spent' })).join('');
  const tavern = s.tavern
    .map((c) => {
      const can = opts.idle && cardDef(c.id).cost <= you.coin;
      return cardHtml(c.id, { act: can ? 'buy' : undefined, uid: c.uid, cls: can ? 'buyable' : 'tavern' });
    })
    .join('');
  const hand = you.hand.map((c: Card) => cardHtml(c.id, { act: opts.idle ? 'play' : undefined, uid: c.uid, cls: opts.idle ? 'playable' : '' })).join('');
  const oppHand = Array.from({ length: them.hand.length }, () => `<img class="opp-card" src="${cardBackUrl()}" alt="">`).join('');
  const logLines = s.log.slice(-40).map((l) => `<div>${esc(l)}</div>`).join('');

  return `<div class="board ${opts.myTurn ? 'my-turn' : 'their-turn'}">
    <section class="side them">
      <div class="who"><span class="pname">${esc(them.name)}</span>${stats(s, other(me))}</div>
      <div class="opp-hand">${oppHand}</div>
      ${backHtml(them.deck.length, 'колода')}${backHtml(them.cooldown.length, 'сброс', 'pile-opp-cd')}
    </section>
    <section class="row agents-row them-agents"><div class="row-label">Агенты соперника</div>${theirAgents || '<div class="empty">нет агентов</div>'}</section>
    <section class="middle">
      <div class="patrons">${s.patrons.map((p) => patronHtml(s, me, p)).join('')}</div>
      <div class="tavern"><div class="row-label">Таверна</div><div class="tavern-cards">${tavern}</div>
        <div class="tavern-deck">${backHtml(s.tavernDeck.length, 'в запасе')}</div></div>
      <aside class="side-panel">
        <div class="preview" id="preview"><div class="hint">Наведите на карту, чтобы рассмотреть её</div></div>
        <div class="log" id="log">${logLines}</div>
      </aside>
    </section>
    ${track(s, me)}
    <section class="row agents-row my-agents"><div class="row-label">Ваши агенты</div>${myAgents || '<div class="empty">нет агентов</div>'}
      <div class="row-label played-label">Сыграно</div>${played}</section>
    <section class="hand">${hand || '<div class="empty">рука пуста</div>'}</section>
    <section class="side you">
      <div class="who"><span class="pname">${esc(you.name)}</span>${stats(s, me)}</div>
      ${backHtml(you.deck.length, 'колода', 'pile-deck')}${backHtml(you.cooldown.length, 'сброс', 'pile-cd')}
      <div class="buttons">
        <button data-act="play-all" ${opts.idle && you.hand.length ? '' : 'disabled'}>Сыграть всё</button>
        <button class="end" data-act="end" ${opts.idle ? '' : 'disabled'}>Конец хода</button>
        <button class="ghost" data-act="concede">Сдаться</button>
      </div>
    </section>
  </div>`;
}
