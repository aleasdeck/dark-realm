import {
  cardDef,
  CARDS,
  DRAFTABLE,
  HAND_SIZE,
  PATRONS,
  PRESTIGE_GOAL,
  PRESTIGE_INSTANT,
  STARTING_GOLD,
  TAVERN_SIZE,
} from './cards';
import { rngNext } from './rng';
import { effectText } from './text';
import type {
  GameEvent,
  Action,
  AgentInPlay,
  Card,
  Effect,
  GameState,
  Pending,
  PatronId,
  PlayerIdx,
  PlayerState,
  QueuedEffect,
  TriggerOn,
} from './types';

export class RuleError extends Error {}

const DRAFT_ORDER: PlayerIdx[] = [0, 1, 1, 0];

/** Who drafted a patron, from its place in the pick order; null for the treasury, which nobody picks. */
export function draftedBy(s: GameState, pid: PatronId): PlayerIdx | null {
  const i = s.patrons.indexOf(pid);
  return i >= 0 && i < DRAFT_ORDER.length && pid !== 'treasury' ? DRAFT_ORDER[i] : null;
}

const other = (p: PlayerIdx): PlayerIdx => (p === 0 ? 1 : 0);

function newPlayer(name: string): PlayerState {
  return { name, deck: [], hand: [], played: [], cooldown: [], agents: [], coin: 0, power: 0, prestige: 0, pendingDiscard: 0 };
}

export interface GameOptions {
  /** Patrons offered in the draft (the unlocked ones); the base six by default. */
  pool?: PatronId[];
  /** Prestige that wins once the player stays ahead through the opponent's turn. */
  goal?: number;
  /** Prestige that wins at once. */
  instant?: number;
  /** Cards that open the tavern, in this order (the tutorial's fixed deal). */
  tavernTop?: string[];
  /** How many of the first player's purchases go on top of their deck (the tutorial). */
  buyOnTop?: number;
}

export function createGame(seed: number, names: [string, string], opts: GameOptions = {}): GameState {
  const { pool, ...targets } = opts;
  return {
    ...targets,
    phase: 'draft',
    rng: seed | 0,
    nextUid: 1,
    players: [newPlayer(names[0]), newPlayer(names[1])],
    current: 0,
    turn: 0,
    patrons: [],
    draftPool: [...(pool ?? DRAFTABLE)],
    draftStep: 0,
    favor: {},
    patronCalls: 1,
    patronsUsed: [],
    tavernDeck: [],
    tavern: [],
    queue: [],
    pending: null,
    turnPlays: [],
    log: [],
    events: [],
    winner: null,
    winReason: '',
  };
}

/** Whose input the game is waiting for. */
export function actingPlayer(s: GameState): PlayerIdx {
  if (s.phase === 'draft') return DRAFT_ORDER[s.draftStep];
  if (s.pending) return s.pending.player;
  return s.current;
}

// ── helpers ──────────────────────────────────────────────

function rand(s: GameState): number {
  const [v, next] = rngNext(s.rng);
  s.rng = next;
  return v;
}

function shuffle<T>(s: GameState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function mk(s: GameState, id: string): Card {
  return { uid: s.nextUid++, id };
}

function emit(s: GameState, e: GameEvent) {
  (s.events ??= []).push(e);
}

function log(s: GameState, msg: string) {
  s.log.push(msg);
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
}

function refillDeck(s: GameState, p: PlayerState) {
  if (p.deck.length === 0 && p.cooldown.length > 0) {
    p.deck = shuffle(s, p.cooldown);
    p.cooldown = [];
  }
}

function drawCards(s: GameState, p: PlayerState, n: number) {
  for (let i = 0; i < n; i++) {
    refillDeck(s, p);
    const c = p.deck.shift();
    if (!c) return;
    p.hand.push(c);
  }
}

function refillTavern(s: GameState) {
  while (s.tavern.length < TAVERN_SIZE && s.tavernDeck.length > 0) {
    s.tavern.push(s.tavernDeck.shift()!);
  }
}

function removeByUid<T extends Card>(arr: T[], uid: number): T | undefined {
  const i = arr.findIndex((c) => c.uid === uid);
  return i < 0 ? undefined : arr.splice(i, 1)[0];
}

function name(id: string) {
  return cardDef(id).name;
}

function hpLeft(a: AgentInPlay) {
  return (cardDef(a.id).hp ?? 1) - a.dmg;
}

/** A knocked out agent goes to its owner's cooldown, or back under the tavern deck if it was a contract. */
function knockOut(s: GameState, owner: PlayerIdx, uid: number) {
  const p = s.players[owner];
  const a = removeByUid(p.agents, uid);
  if (!a) return;
  release(s, owner, a);
  const card: Card = { uid: a.uid, id: a.id };
  log(s, `${p.name}: агент «${name(a.id)}» сражён`);
  emit(s, { k: 'knockout', p: owner, card: a.id });
  if (cardDef(a.id).type === 'contractAgent') s.tavernDeck.push(card);
  else toCooldown(s, owner, card);
  fire(s, s.current, 'knockout', card);
}

/** An agent leaving play lets its confined cards go back to the opponent's cooldown. */
function release(s: GameState, owner: PlayerIdx, a: AgentInPlay) {
  if (!a.confined?.length) return;
  s.players[other(owner)].cooldown.push(...a.confined);
  a.confined = [];
}

/** Cards of yours that are in play: played this turn and agents on the table. */
function inPlay(p: PlayerState): Card[] {
  return [...p.played, ...p.agents];
}

/**
 * "While in play" reactions of the current player's cards. `card` is what moved;
 * a card never reacts to itself unless its trigger says `self`.
 */
function fire(s: GameState, pi: PlayerIdx, on: TriggerOn, card?: Card) {
  if (s.phase !== 'play' || s.current !== pi) return;
  const listeners = inPlay(s.players[pi]);
  if (card && cardDef(card.id).trigger?.self && !listeners.some((c) => c.uid === card.uid)) listeners.push(card);
  // Reactions resolve before whatever else is still queued.
  const now: QueuedEffect[] = [];
  for (const c of listeners) {
    const tr = cardDef(c.id).trigger;
    if (!tr || tr.on !== on) continue;
    if (card && c.uid === card.uid && !tr.self) continue;
    for (const e of tr.fx) now.push({ e, player: pi, src: c.uid });
  }
  s.queue.unshift(...now);
}

const isAgent = (id: string) => {
  const t = cardDef(id).type;
  return t === 'agent' || t === 'contractAgent';
};

/** Puts a card in a player's cooldown and lets their cards in play react. */
function toCooldown(s: GameState, pi: PlayerIdx, c: Card) {
  s.players[pi].cooldown.push(c);
  fire(s, pi, 'toCooldown', c);
  if (isAgent(c.id)) fire(s, pi, 'agentToCooldown', c);
}

/** Hand to cooldown, as a discard. */
function discardFromHand(s: GameState, pi: PlayerIdx, uid: number) {
  const c = removeByUid(s.players[pi].hand, uid);
  if (!c) return;
  toCooldown(s, pi, c);
  fire(s, pi, 'discard', c);
}

// ── setup ────────────────────────────────────────────────

function startMatch(s: GameState) {
  s.patrons = [...s.patrons, 'treasury'];
  for (const pid of s.patrons) if (pid !== 'treasury') s.favor[pid] = null;
  for (const p of s.players) {
    const deck: Card[] = [];
    for (let i = 0; i < STARTING_GOLD; i++) deck.push(mk(s, 'gold'));
    for (const pid of s.patrons) {
      const starter = CARDS.find((c) => c.patron === pid && (c.type === 'starter' || c.starter));
      if (starter) deck.push(mk(s, starter.id));
    }
    p.deck = shuffle(s, deck);
  }
  const tavern: Card[] = [];
  for (const def of CARDS) {
    if (def.patron !== 'neutral' && s.patrons.includes(def.patron)) {
      for (let i = 0; i < def.copies; i++) tavern.push(mk(s, def.id));
    }
  }
  s.tavernDeck = shuffle(s, tavern);
  for (const id of [...(s.tavernTop ?? [])].reverse()) {
    const i = s.tavernDeck.findIndex((c) => c.id === id);
    if (i >= 0) s.tavernDeck.unshift(...s.tavernDeck.splice(i, 1));
  }
  refillTavern(s);
  drawCards(s, s.players[0], HAND_SIZE);
  drawCards(s, s.players[1], HAND_SIZE);
  s.phase = 'play';
  s.current = 0;
  s.turn = 1;
  log(s, `Покровители: ${s.patrons.map((p) => PATRONS[p].name).join(', ')}`);
  log(s, `Ход ${s.turn}: ${s.players[0].name}`);
  emit(s, { k: 'turn', p: 0 });
}

// ── effect resolution ────────────────────────────────────

function ask(s: GameState, pending: Pending) {
  if (pending.options.length === 0 || pending.max === 0) return;
  pending.max = Math.min(pending.max, pending.options.length);
  pending.min = Math.min(pending.min, pending.max);
  s.pending = pending;
}

function cardOption(c: Card, extra = '') {
  return { label: name(c.id) + extra, ref: c.uid, cardId: c.id };
}

/** Cards that Destroy and the Treasury may take: played this turn or still in hand. */
function inPlayOrHand(p: PlayerState) {
  return [...p.played.map((c) => cardOption(c, ' (в игре)')), ...p.hand.map((c) => cardOption(c, ' (в руке)'))];
}

/** Cards of yours on the table, which the Hlaalu patron may sacrifice. */
const ownInPlay = inPlay;

/** Every card a player owns, wherever it is. */
function ownedCount(p: PlayerState): number {
  return p.deck.length + p.hand.length + p.played.length + p.cooldown.length + p.agents.length;
}

/** A curse in hand has to be played before any other card. */
export function mustPlayCurse(p: PlayerState, id: string): boolean {
  return cardDef(id).type !== 'curse' && p.hand.some((c) => cardDef(c.id).type === 'curse');
}

function execEffect(s: GameState, e: Effect, pi: PlayerIdx, src?: number) {
  const p = s.players[pi];
  const opp = s.players[other(pi)];
  switch (e.k) {
    case 'coin':
      p.coin += e.n;
      return;
    case 'power':
      p.power += e.n;
      return;
    case 'prestige':
      p.prestige += e.n;
      return;
    case 'oppLosePrestige':
      opp.prestige = Math.max(0, opp.prestige - e.n);
      return;
    case 'draw':
      drawCards(s, p, e.n);
      return;
    case 'oppDiscard':
      opp.pendingDiscard += e.n;
      return;
    case 'patronCall':
      s.patronCalls += e.n;
      return;
    case 'create':
      for (let i = 0; i < e.n; i++) {
        const c = mk(s, e.card);
        if (e.to === 'oppCooldown') opp.cooldown.push(c);
        else if (e.to === 'hand') p.hand.push(c);
        else toCooldown(s, pi, c);
      }
      return;
    case 'knockoutAll':
      for (const a of [...opp.agents]) knockOut(s, other(pi), a.uid);
      for (const a of [...p.agents]) knockOut(s, pi, a.uid);
      return;
    case 'setback': {
      const b = (opp.boon ??= { coin: 0, power: 0, draw: 0 });
      b[e.res] += e.n;
      return;
    }
    case 'confine':
      return ask(s, {
        player: pi,
        kind: 'confine',
        prompt: `Заточите до ${e.n} карт из сброса соперника`,
        options: opp.cooldown.map((c) => cardOption(c)),
        min: e.n,
        max: e.n,
        data: src,
      });
    case 'reprieve':
      refillDeck(s, opp);
      return ask(s, {
        player: pi,
        kind: 'reprieve',
        prompt: 'Верх колоды соперника: отправьте одну карту в его сброс',
        options: opp.deck.slice(0, e.n).map((c) => cardOption(c)),
        min: 1,
        max: 1,
      });
    case 'bargain':
      return ask(s, {
        player: pi,
        kind: 'bargain',
        prompt: 'Возьмите карту из таверны; соперник получит такую же',
        options: s.tavern.filter((c) => !cardDef(c.id).type.startsWith('contract')).map((c) => cardOption(c)),
        min: 1,
        max: 1,
      });
    case 'selfDiscard':
      return ask(s, {
        player: pi,
        kind: 'selfDiscard',
        prompt: `Сбросьте ${e.n} карт(ы) из руки`,
        options: p.hand.map((c) => cardOption(c)),
        min: e.n,
        max: e.n,
      });
    case 'choice':
      return ask(s, {
        player: pi,
        kind: 'choice',
        prompt: 'Выберите эффект',
        options: e.options.map((o, i) => ({ label: o.map(effectText).join(', '), ref: i })),
        min: 1,
        max: 1,
        data: e.options,
      });
    case 'acquire':
      return ask(s, {
        player: pi,
        kind: 'acquire',
        prompt: `Получите карту из таверны ценой до ${e.n}`,
        options: s.tavern.filter((c) => cardDef(c.id).cost <= e.n).map((c) => cardOption(c)),
        min: 0,
        max: 1,
      });
    case 'toss': {
      refillDeck(s, p);
      return ask(s, {
        player: pi,
        kind: 'toss',
        prompt: 'Верх колоды: отметьте карты, которые уйдут в сброс',
        options: p.deck.slice(0, e.n).map((c) => cardOption(c)),
        min: 0,
        max: e.n,
      });
    }
    case 'destroy':
      return ask(s, {
        player: pi,
        kind: 'destroy',
        prompt: `Уничтожьте до ${e.n} карт (в игре или в руке)`,
        options: inPlayOrHand(p),
        min: 0,
        max: e.n,
      });
    case 'knockout': {
      return ask(s, {
        player: pi,
        kind: 'knockout',
        prompt: 'Сразите агента соперника',
        options: opp.agents.map((a) => cardOption(a)),
        min: Math.min(e.n, opp.agents.length),
        max: e.n,
      });
    }
    case 'returnTop': {
      const pool = e.agentsOnly ? p.cooldown.filter((c) => cardDef(c.id).type === 'agent') : p.cooldown;
      return ask(s, {
        player: pi,
        kind: 'returnTop',
        prompt: `Верните до ${e.n} ${e.agentsOnly ? 'агентов' : 'карт'} из сброса наверх колоды`,
        options: pool.map((c) => cardOption(c)),
        min: 0,
        max: e.n,
      });
    }
    case 'replaceTavern':
      return ask(s, {
        player: pi,
        kind: 'replaceTavern',
        prompt: `Отметьте до ${e.n} карт таверны для замены`,
        options: s.tavern.map((c) => cardOption(c)),
        min: 0,
        max: e.n,
      });
    case 'heal': {
      const hurt = p.agents.filter((a) => a.dmg > 0);
      return ask(s, {
        player: pi,
        kind: 'heal',
        prompt: `Исцелите агента на ${e.n}`,
        options: hurt.map((a) => cardOption(a, ` (${hpLeft(a)}/${cardDef(a.id).hp})`)),
        min: 1,
        max: 1,
        data: e.n,
      });
    }
    case 'donate':
      return ask(s, {
        player: pi,
        kind: 'donate',
        prompt: `Сбросьте до ${e.n} карт из руки, чтобы взять столько же`,
        options: p.hand.map((c) => cardOption(c)),
        min: 0,
        max: e.n,
      });
  }
}

function runQueue(s: GameState) {
  while (!s.pending && s.queue.length > 0 && s.phase === 'play') {
    const q = s.queue.shift()!;
    execEffect(s, q.e, q.player, q.src);
  }
}

function enqueue(s: GameState, pi: PlayerIdx, effects: Effect[] | undefined, src?: number) {
  if (!effects) return;
  for (const e of effects) s.queue.push({ e, player: pi, src });
}

/** Records a play for combo purposes and queues the card effect plus any combos it unlocks. */
function registerPlay(s: GameState, pi: PlayerIdx, c: Card) {
  const def = cardDef(c.id);
  enqueue(s, pi, def.play, c.uid);
  if (def.patron === 'neutral' || def.patron === 'treasury') return;
  s.turnPlays.push({ id: c.id, uid: c.uid, patron: def.patron, fired: [] });
  const count = s.turnPlays.filter((t) => t.patron === def.patron).length;
  for (const tp of s.turnPlays) {
    if (tp.patron !== def.patron) continue;
    const combo = cardDef(tp.id).combo;
    if (!combo) continue;
    for (const tier of [2, 3, 4] as const) {
      if (combo[tier] && tier <= count && !tp.fired.includes(tier)) {
        tp.fired.push(tier);
        enqueue(s, pi, combo[tier], tp.uid);
      }
    }
  }
  if (def.patron === 'druid') druidChimera(s, pi, count);
}

/** The Druid patron's passive: the 4th Druid card of a turn (5th while neutral) brings a Chimera. */
function druidChimera(s: GameState, pi: PlayerIdx, count: number) {
  const f = s.favor.druid;
  const need = f === pi ? 4 : f === null ? 5 : Infinity;
  if (count < need || s.chimeraTurn === s.turn) return;
  s.chimeraTurn = s.turn;
  toCooldown(s, pi, mk(s, 'druid_chimera'));
  log(s, `${s.players[pi].name}: Олень дарует «Химеру»`);
}

function resolvePending(s: GameState, picks: number[]) {
  const pend = s.pending!;
  const refs = new Set(pend.options.map((o) => o.ref));
  const uniq = [...new Set(picks)];
  if (uniq.length < pend.min || uniq.length > pend.max || uniq.some((r) => !refs.has(r))) {
    throw new RuleError('Недопустимый выбор');
  }
  s.pending = null;
  const pi = pend.player;
  const p = s.players[pi];
  switch (pend.kind) {
    case 'choice': {
      const branches = pend.data as Effect[][];
      const branch = branches[uniq[0]];
      s.queue.unshift(...branch.map((e) => ({ e, player: pi })));
      break;
    }
    case 'acquire':
      for (const uid of uniq) {
        const c = removeByUid(s.tavern, uid)!;
        gainCard(s, pi, c);
        log(s, `${p.name} получает «${name(c.id)}»`);
        emit(s, { k: 'gain', p: pi, card: c.id });
      }
      refillTavern(s);
      break;
    case 'toss':
      for (const uid of uniq) toCooldown(s, pi, removeByUid(p.deck, uid)!);
      break;
    case 'destroy':
    case 'treasury':
      for (const uid of uniq) {
        const c = removeByUid(p.played, uid) ?? removeByUid(p.hand, uid);
        if (!c) continue;
        log(s, `${p.name} уничтожает «${name(c.id)}»`);
        emit(s, { k: 'destroy', p: pi, card: c.id });
      }
      if (pend.kind === 'treasury') toCooldown(s, pi, mk(s, 'writ'));
      break;
    case 'hlaalu':
      for (const uid of uniq) {
        const agent = removeByUid(p.agents, uid);
        if (agent) release(s, pi, agent);
        const c = removeByUid(p.played, uid) ?? agent;
        if (!c) continue;
        const gain = Math.max(0, cardDef(c.id).cost - 1);
        p.prestige += gain;
        log(s, `${p.name} жертвует «${name(c.id)}» Крысе: +${gain} ✦`);
        emit(s, { k: 'destroy', p: pi, card: c.id });
      }
      break;
    case 'knockout':
    case 'psijic':
      for (const uid of uniq) knockOut(s, other(pi), uid);
      break;
    case 'returnTop':
    case 'pelin':
      for (const uid of uniq) {
        const c = removeByUid(p.cooldown, uid);
        if (c) p.deck.unshift(c);
      }
      break;
    case 'replaceTavern':
      for (const uid of uniq) s.tavernDeck.push(removeByUid(s.tavern, uid)!);
      refillTavern(s);
      break;
    case 'heal': {
      const a = p.agents.find((x) => x.uid === uniq[0]);
      if (a) a.dmg = Math.max(0, a.dmg - (pend.data as number));
      break;
    }
    case 'donate':
      for (const uid of uniq) discardFromHand(s, pi, uid);
      drawCards(s, p, uniq.length);
      break;
    case 'confine': {
      const holder = p.agents.find((a) => a.uid === pend.data);
      const opp = s.players[other(pi)];
      for (const uid of uniq) {
        const c = removeByUid(opp.cooldown, uid)!;
        // The agent may have left play before its effect resolved: then nothing is confined.
        if (!holder) opp.cooldown.push(c);
        else (holder.confined ??= []).push(c);
      }
      if (holder && uniq.length) log(s, `${p.name} заточает ${uniq.length} карт(ы) соперника`);
      break;
    }
    case 'reprieve': {
      const opp = s.players[other(pi)];
      for (const uid of uniq) opp.cooldown.push(removeByUid(opp.deck, uid)!);
      break;
    }
    case 'bargain':
      for (const uid of uniq) {
        const c = removeByUid(s.tavern, uid)!;
        gainCard(s, pi, c);
        s.players[other(pi)].cooldown.push(mk(s, c.id));
        log(s, `${p.name} получает «${name(c.id)}», соперник тоже`);
        emit(s, { k: 'gain', p: pi, card: c.id });
      }
      refillTavern(s);
      break;
    case 'selfDiscard':
    case 'discard':
      for (const uid of uniq) discardFromHand(s, pi, uid);
      if (uniq.length) {
        log(s, `${p.name} сбрасывает ${uniq.length} карт(ы)`);
        emit(s, { k: 'discard', p: pi, n: uniq.length });
      }
      break;
  }
  runQueue(s);
}

/** Puts a newly obtained card where it belongs: contracts resolve at once. */
function gainCard(s: GameState, pi: PlayerIdx, c: Card) {
  const def = cardDef(c.id);
  if (def.type === 'contractAction') {
    s.tavernDeck.push(c);
    registerPlay(s, pi, c);
  } else if (def.type === 'contractAgent') {
    s.players[pi].agents.push({ ...c, dmg: 0, activated: false });
  } else {
    toCooldown(s, pi, c);
  }
}

// ── patrons ──────────────────────────────────────────────

export function patronAvailable(s: GameState, pi: PlayerIdx, pid: PatronId): boolean {
  if (s.phase !== 'play' || s.current !== pi || s.pending || s.queue.length) return false;
  if (!s.patrons.includes(pid) || s.patronCalls <= 0 || s.patronsUsed.includes(pid)) return false;
  const p = s.players[pi];
  const opp = s.players[other(pi)];
  switch (pid) {
    case 'treasury':
      return p.coin >= 2 && p.played.length + p.hand.length > 0;
    case 'crows':
      return s.favor.crows !== pi && p.coin >= 1;
    case 'hlaalu':
      return ownInPlay(p).some((c) => cardDef(c.id).cost >= 1);
    case 'pelin':
      return p.power >= 2 && p.cooldown.some((c) => cardDef(c.id).type === 'agent');
    case 'psijic':
      return p.coin >= 4 && opp.agents.length > 0;
    case 'rajhin':
      return p.coin >= 3;
    case 'eagle':
      return p.power >= 2;
    case 'alma': {
      const f = s.favor.alma;
      if (f === pi) return p.coin >= 1 && p.hand.length > 0;
      if (f === null) return p.hand.length > 0;
      return p.coin >= 1;
    }
    case 'hunding':
      return s.favor.hunding !== pi && p.power >= 2;
    case 'druid':
      return p.power >= 2;
    case 'mora':
      return p.power >= (s.favor.mora === other(pi) ? 2 : 3) && s.tavern.some((c) => !cardDef(c.id).type.startsWith('contract'));
    case 'alessia':
      return p.coin >= (s.favor.alessia === other(pi) ? 3 : 4);
    case 'orgnum': {
      const f = s.favor.orgnum;
      return p.coin >= (f === pi ? 3 : f === null ? 2 : 1);
    }
  }
}

function activatePatron(s: GameState, pi: PlayerIdx, pid: PatronId) {
  if (!patronAvailable(s, pi, pid)) throw new RuleError('Покровитель недоступен');
  const p = s.players[pi];
  const opp = s.players[other(pi)];
  s.patronCalls--;
  s.patronsUsed.push(pid);
  log(s, `${p.name} взывает к покровителю «${PATRONS[pid].name}»`);
  emit(s, { k: 'patron', p: pi, patron: pid });
  // What the favor was before this call: several patrons pay out according to it.
  const was = s.favor[pid];
  if (pid !== 'treasury') s.favor[pid] = was === other(pi) ? null : pi;
  const mine = was === pi;
  const neutral = was === null;
  switch (pid) {
    case 'treasury':
      p.coin -= 2;
      ask(s, {
        player: pi,
        kind: 'treasury',
        prompt: 'Сундук Бездны: уничтожьте карту, взамен получите «Долговую расписку»',
        options: inPlayOrHand(p),
        min: 1,
        max: 1,
      });
      break;
    case 'crows': {
      const paid = p.coin;
      p.coin = 0;
      p.power += paid - 1;
      break;
    }
    case 'hlaalu':
      ask(s, {
        player: pi,
        kind: 'hlaalu',
        prompt: 'Крыса: пожертвуйте карту ради ✦ (цена − 1)',
        options: ownInPlay(p)
          .filter((c) => cardDef(c.id).cost >= 1)
          .map((c) => cardOption(c, ` (+${cardDef(c.id).cost - 1})`)),
        min: 1,
        max: 1,
      });
      break;
    case 'pelin':
      p.power -= 2;
      ask(s, {
        player: pi,
        kind: 'pelin',
        prompt: 'Волк: верните агента наверх колоды',
        options: p.cooldown.filter((c) => cardDef(c.id).type === 'agent').map((c) => cardOption(c)),
        min: 1,
        max: 1,
      });
      break;
    case 'psijic':
      p.coin -= 4;
      ask(s, {
        player: pi,
        kind: 'psijic',
        prompt: 'Сова: сразите агента соперника',
        options: opp.agents.map((a) => cardOption(a)),
        min: 1,
        max: 1,
      });
      break;
    case 'rajhin':
      p.coin -= 3;
      opp.cooldown.push(mk(s, 'bewilderment'));
      break;
    case 'eagle':
      p.power -= 2;
      drawCards(s, p, 1);
      break;
    case 'alma':
      if (mine || !neutral) p.coin -= 1;
      if (mine || neutral) enqueue(s, pi, [{ k: 'selfDiscard', n: 1 }]);
      enqueue(s, pi, [{ k: 'reprieve', n: mine ? 5 : neutral ? 4 : 3 }]);
      break;
    case 'hunding':
      p.power -= 2;
      p.coin += 1;
      break;
    case 'druid':
      p.power -= 2;
      enqueue(s, pi, [{ k: 'replaceTavern', n: 2 }]);
      break;
    case 'mora':
      p.power -= mine || neutral ? 3 : 2;
      enqueue(s, pi, [{ k: 'bargain' }]);
      break;
    case 'alessia':
      if (mine || neutral) {
        p.coin -= 4;
        toCooldown(s, pi, mk(s, mine ? 'alessia_sergeant' : 'alessia_soldier'));
      } else {
        p.coin -= 3;
        p.power += 2;
      }
      break;
    case 'orgnum':
      if (mine) {
        p.coin -= 3;
        p.power += Math.floor(ownedCount(p) / 4);
        toCooldown(s, pi, mk(s, 'orgnum_sacking'));
      } else if (neutral) {
        p.coin -= 2;
        p.power += Math.floor(ownedCount(p) / 6);
      } else {
        p.coin -= 1;
        p.power += 2;
      }
      break;
  }
}

// ── turn flow ────────────────────────────────────────────

/** Leftover power hits the opponent's taunting agents first; only what is left after them becomes prestige. */
function tauntsAbsorbPower(s: GameState, pi: PlayerIdx) {
  const p = s.players[pi];
  const foe = other(pi);
  for (const a of [...s.players[foe].agents]) {
    if (p.power <= 0) return;
    if (!cardDef(a.id).taunt) continue;
    const dmg = Math.min(p.power, hpLeft(a));
    p.power -= dmg;
    a.dmg += dmg;
    log(s, `${p.name}: остаток силы бьёт «${name(a.id)}»: −${dmg}`);
    emit(s, { k: 'attack', p: pi, card: a.id, n: dmg });
    if (hpLeft(a) <= 0) knockOut(s, foe, a.uid);
  }
}

/** 80 prestige or the favor of every drafted patron ends the game at once. */
function checkInstantWin(s: GameState): boolean {
  if (s.phase !== 'play') return false;
  const instant = s.instant ?? PRESTIGE_INSTANT;
  for (const pi of [s.current, other(s.current)]) {
    if (s.players[pi].prestige >= instant) {
      finish(s, pi, `${instant} ✦`);
      return true;
    }
  }
  const drafted = s.patrons.filter((x) => x !== 'treasury');
  const pi = s.current;
  if (drafted.length > 0 && drafted.every((x) => s.favor[x] === pi)) {
    finish(s, pi, 'благосклонность всех покровителей');
    return true;
  }
  return false;
}

function endTurn(s: GameState) {
  const pi = s.current;
  const p = s.players[pi];
  tauntsAbsorbPower(s, pi);
  // Reactions to what the leftover power knocked out come too late to use.
  s.queue = [];
  p.prestige += p.power;
  if (p.power > 0) {
    log(s, `${p.name}: ${p.power} ⚔ → ✦`);
    emit(s, { k: 'prestige', p: pi, n: p.power });
  }
  p.power = 0;
  p.coin = 0;
  p.cooldown.push(...p.hand, ...p.played);
  p.hand = [];
  p.played = [];
  for (const a of p.agents) a.activated = false;
  drawCards(s, p, HAND_SIZE);

  if (checkInstantWin(s)) return;
  const goal = s.goal ?? PRESTIGE_GOAL;

  const next = other(pi);
  const n = s.players[next];
  s.current = next;
  s.turn++;
  s.patronCalls = 1;
  s.patronsUsed = [];
  s.turnPlays = [];
  log(s, `Ход ${s.turn}: ${n.name}`);
  emit(s, { k: 'turn', p: next });
  // A player who reached the goal and stayed ahead through the opponent's turn wins.
  if (n.prestige >= goal && n.prestige > p.prestige) return finish(s, next, `${goal}+ ✦`);
  if (s.turn === 2) n.coin += 1; // second player compensation
  if (s.favor.hunding === next) n.coin += 1; // Kenjar pays whoever kept his favor through the turn
  if (n.boon) {
    n.coin += n.boon.coin;
    n.power += n.boon.power;
    drawCards(s, n, n.boon.draw);
    delete n.boon;
  }
  if (n.pendingDiscard > 0) {
    const k = n.pendingDiscard;
    n.pendingDiscard = 0;
    ask(s, {
      player: next,
      kind: 'discard',
      prompt: `Сбросьте ${k} карт(ы) из руки`,
      options: n.hand.map((c) => cardOption(c)),
      min: k,
      max: k,
    });
  }
}

function finish(s: GameState, winner: PlayerIdx, reason: string) {
  s.phase = 'over';
  s.winner = winner;
  s.winReason = reason;
  s.pending = null;
  s.queue = [];
  log(s, `Победа: ${s.players[winner].name} (${reason})`);
  emit(s, { k: 'win', p: winner });
}

function idle(s: GameState, pi: PlayerIdx) {
  return s.phase === 'play' && s.current === pi && !s.pending && s.queue.length === 0;
}

export function attackable(s: GameState, pi: PlayerIdx): AgentInPlay[] {
  const opp = s.players[other(pi)];
  const taunts = opp.agents.filter((a) => cardDef(a.id).taunt);
  return taunts.length ? taunts : opp.agents;
}

/** Applies an action for player `pi` and returns the new state. Throws RuleError on illegal moves. */
export function applyAction(state: GameState, pi: PlayerIdx, a: Action): GameState {
  const s = structuredClone(state) as GameState;
  s.events = [];
  if (a.t === 'concede') {
    if (s.phase === 'over') throw new RuleError('Игра окончена');
    finish(s, other(pi), 'соперник сдался');
    return s;
  }
  if (s.phase === 'over') throw new RuleError('Игра окончена');
  if (actingPlayer(s) !== pi) throw new RuleError('Сейчас не ваш ход');

  if (s.phase === 'draft') {
    if (a.t !== 'draft' || !s.draftPool.includes(a.patron)) throw new RuleError('Выберите покровителя');
    s.draftPool = s.draftPool.filter((x) => x !== a.patron);
    s.patrons.push(a.patron);
    log(s, `${s.players[pi].name} выбирает покровителя «${PATRONS[a.patron].name}»`);
    emit(s, { k: 'draft', p: pi, patron: a.patron });
    s.draftStep++;
    if (s.draftStep >= DRAFT_ORDER.length) startMatch(s);
    return s;
  }

  if (s.pending) {
    if (a.t !== 'choose') throw new RuleError('Сначала сделайте выбор');
    resolvePending(s, a.picks);
    checkInstantWin(s);
    return s;
  }
  if (!idle(s, pi)) throw new RuleError('Подождите');
  const p = s.players[pi];

  switch (a.t) {
    case 'play': {
      const inHand = p.hand.find((x) => x.uid === a.uid);
      if (!inHand) throw new RuleError('Нет такой карты в руке');
      if (mustPlayCurse(p, inHand.id)) throw new RuleError('Сначала разыграйте «Морок»');
      const c = removeByUid(p.hand, a.uid)!;
      const def = cardDef(c.id);
      if (def.type === 'agent') {
        p.agents.push({ ...c, dmg: 0, activated: true });
      } else {
        p.played.push(c);
      }
      log(s, `${p.name} разыгрывает «${def.name}»`);
      emit(s, { k: 'play', p: pi, card: c.id });
      registerPlay(s, pi, c);
      if (def.type === 'agent') fire(s, pi, 'agentPlay', c);
      break;
    }
    case 'activate': {
      const ag = p.agents.find((x) => x.uid === a.uid);
      if (!ag || ag.activated) throw new RuleError('Агент уже действовал');
      ag.activated = true;
      log(s, `${p.name} применяет агента «${name(ag.id)}»`);
      emit(s, { k: 'activate', p: pi, card: ag.id });
      registerPlay(s, pi, ag);
      fire(s, pi, 'agentPlay', ag);
      break;
    }
    case 'attack': {
      const target = attackable(s, pi).find((x) => x.uid === a.uid);
      if (!target) throw new RuleError('Сначала атакуйте агентов с провокацией');
      if (p.power <= 0) throw new RuleError('Нет силы для атаки');
      const dmg = Math.min(p.power, hpLeft(target));
      p.power -= dmg;
      target.dmg += dmg;
      log(s, `${p.name} атакует «${name(target.id)}»: −${dmg}`);
      emit(s, { k: 'attack', p: pi, card: target.id, n: dmg });
      if (hpLeft(target) <= 0) knockOut(s, other(pi), target.uid);
      break;
    }
    case 'buy': {
      const c = s.tavern.find((x) => x.uid === a.uid);
      if (!c) throw new RuleError('Карты нет в таверне');
      const def = cardDef(c.id);
      if (p.coin < def.cost) throw new RuleError('Не хватает монет');
      p.coin -= def.cost;
      removeByUid(s.tavern, c.uid);
      log(s, `${p.name} покупает «${def.name}»`);
      emit(s, { k: 'buy', p: pi, card: c.id });
      if (pi === 0 && s.buyOnTop && !def.type.startsWith('contract')) {
        // Tutorial: the purchase comes straight into the next hand.
        s.buyOnTop--;
        p.deck.unshift(c);
      } else gainCard(s, pi, c);
      refillTavern(s);
      break;
    }
    case 'patron':
      activatePatron(s, pi, a.patron);
      break;
    case 'end':
      endTurn(s);
      return s;
    default:
      throw new RuleError('Недопустимое действие');
  }
  runQueue(s);
  checkInstantWin(s);
  return s;
}

export { other, hpLeft };
