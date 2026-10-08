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
import { cards as nCards, effectText, ICON } from './text';
import type {
  GameEvent,
  Action,
  AgentInPlay,
  Card,
  Effect,
  EffectSource,
  GameState,
  Pending,
  PatronId,
  PatronUndo,
  PendingKind,
  PlayerIdx,
  PlayerState,
  QueuedEffect,
  TriggerOn,
} from './types';

export class RuleError extends Error {}

const other = (p: PlayerIdx): PlayerIdx => (p === 0 ? 1 : 0);

/** The second player's compensation card on their first turn. */
const FAKE_COIN = 'fake_coin';

/** Pick order of the draft: the first player, the second twice, the first again. */
const DRAFT_PICKS = 4;
function drafter(s: GameState, step: number): PlayerIdx {
  const first = s.first ?? 0;
  return step === 0 || step === 3 ? first : other(first);
}

/** Who drafted a patron, from its place in the pick order; null for the treasury, which nobody picks. */
export function draftedBy(s: GameState, pid: PatronId): PlayerIdx | null {
  const i = s.patrons.indexOf(pid);
  return i >= 0 && i < DRAFT_PICKS && pid !== 'treasury' ? drafter(s, i) : null;
}

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
  /** Who moves first, as the coin fell; player 0 when no coin was tossed (the tutorial). */
  first?: PlayerIdx;
  /** Online games: the locked patrons each player has opened; only they may draft them. */
  own?: [PatronId[], PatronId[]];
}

export function createGame(seed: number, names: [string, string], opts: GameOptions = {}): GameState {
  const { pool, ...targets } = opts;
  return {
    ...targets,
    phase: 'draft',
    rng: seed | 0,
    nextUid: 1,
    players: [newPlayer(names[0]), newPlayer(names[1])],
    current: opts.first ?? 0,
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
  if (s.phase === 'draft') return drafter(s, s.draftStep);
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

/** Journal lines that start with this are what the move above them led to, shown indented under it. */
export const LOG_SUB = '  ';
const LOG_MAX = 600;

function log(s: GameState, msg: string) {
  s.log.push(msg);
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
  open = null;
}

/** A consequence of the move above it in the journal. */
const sub = (s: GameState, msg: string) => log(s, LOG_SUB + msg);

/**
 * The journal line the effects of one card are being added to ("… «Карта»: +2 ●, +1 ⚔"), by its source key.
 * Any other line closes it. Reset by every applyAction, so the journal depends on the moves alone.
 */
let open: { key: string; bare: boolean; skip?: number } | null = null;
/** The queued effect being resolved now, for the journal. */
let resolving: QueuedEffect | null = null;

const srcKey = (f: EffectSource | null) => (f ? `${f.src ?? ''}|${f.card ?? ''}|${f.tag ?? ''}` : '');

/** Starts a line the following effects of `f` add to (a card play, a purchase, a patron call). */
function head(s: GameState, msg: string, f: EffectSource | null = null) {
  log(s, msg);
  open = { key: srcKey(f), bare: true };
}

/** Writes what an effect gave: on the line of its card when that is the last one, otherwise on a new indented line. */
function gave(s: GameState, text: string) {
  const f = resolving;
  const key = srcKey(f);
  if (open && open.key === key && open.skip) {
    open.skip--;
    return;
  }
  if (open && open.key === key) {
    s.log[s.log.length - 1] += (open.bare ? ': ' : ', ') + text;
    open.bare = false;
    return;
  }
  const card = f?.card && `«${name(f.card)}»`;
  const lead = !card ? '' : f!.tag === 'combo' ? `Комбо ${card}: ` : f!.tag === 'trigger' ? `${card} срабатывает: ` : `${card}: `;
  sub(s, lead + text);
  open = { key, bare: false };
}

/** "«А», «Б»" */
const names = (list: Card[]) => list.map((c) => `«${name(c.id)}»`).join(', ');
const { coin: COIN, power: POW, prestige: PRE } = ICON;

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
  sub(s, `${p.name} теряет агента «${name(a.id)}»`);
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
    for (const e of tr.fx) now.push({ e, player: pi, src: c.uid, card: c.id, tag: 'trigger' });
  }
  s.queue.unshift(...now);
}

const isAgent = (id: string) => {
  const t = cardDef(id).type;
  return t === 'agent' || t === 'contractAgent';
};

/** Puts a card in a player's cooldown and lets their cards in play react. */
function toCooldown(s: GameState, pi: PlayerIdx, c: Card) {
  if (cardDef(c.id).fleeting) return;
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
  const first = s.first ?? 0;
  s.phase = 'play';
  s.current = first;
  s.turn = 1;
  log(s, `Покровители: ${s.patrons.map((p) => PATRONS[p].name).join(', ')}`);
  log(s, `Ход ${s.turn}: ${s.players[first].name}`);
  emit(s, { k: 'turn', p: first });
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
  const from: EffectSource | undefined = resolving ? { src: resolving.src, card: resolving.card, tag: resolving.tag } : undefined;
  const p = s.players[pi];
  const opp = s.players[other(pi)];
  switch (e.k) {
    case 'coin':
      p.coin += e.n;
      return gave(s, `+${e.n} ${COIN}`);
    case 'power':
      p.power += e.n;
      return gave(s, `+${e.n} ${POW}`);
    case 'prestige':
      p.prestige += e.n;
      return gave(s, `+${e.n} ${PRE}`);
    case 'oppLosePrestige': {
      const lost = Math.min(opp.prestige, e.n);
      opp.prestige -= lost;
      return gave(s, `${opp.name} теряет ${lost} ${PRE}`);
    }
    case 'draw': {
      const had = p.hand.length;
      drawCards(s, p, e.n);
      return gave(s, `берёт ${nCards(p.hand.length - had)}`);
    }
    case 'oppDiscard':
      opp.pendingDiscard += e.n;
      return gave(s, `${opp.name} сбросит ${nCards(e.n)} в начале хода`);
    case 'patronCall':
      s.patronCalls += e.n;
      return gave(s, `+${e.n} призыв покровителя`);
    case 'create': {
      for (let i = 0; i < e.n; i++) {
        const c = mk(s, e.card);
        if (e.to === 'oppCooldown') opp.cooldown.push(c);
        else if (e.to === 'hand') p.hand.push(c);
        else toCooldown(s, pi, c);
      }
      const where = e.to === 'oppCooldown' ? `в сброс соперника` : e.to === 'hand' ? 'в руку' : 'в свой сброс';
      return gave(s, `«${name(e.card)}»${e.n > 1 ? ` ×${e.n}` : ''} ${where}`);
    }
    case 'knockoutAll':
      gave(s, 'сражает всех агентов на столе');
      for (const a of [...opp.agents]) knockOut(s, other(pi), a.uid);
      for (const a of [...p.agents]) knockOut(s, pi, a.uid);
      return;
    case 'setback': {
      const b = (opp.boon ??= { coin: 0, power: 0, draw: 0 });
      b[e.res] += e.n;
      const what = e.res === 'draw' ? `возьмёт ${nCards(e.n)}` : `получит +${e.n} ${e.res === 'coin' ? COIN : POW}`;
      return gave(s, `${opp.name} ${what} в начале хода`);
    }
    case 'confine':
      return ask(s, {
        player: pi,
        kind: 'confine',
        prompt: e.n === 1 ? 'Заточите карту из сброса соперника' : `Заточите ${e.n} карт(ы) из сброса соперника`,
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
        from,
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
        prompt: e.n === 1 ? 'Сразите агента соперника' : `Сразите до ${e.n} агентов соперника`,
        options: opp.agents.map((a) => cardOption(a)),
        // "Up to": the player may knock out fewer agents, or none.
        min: 0,
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
    resolving = q;
    execEffect(s, q.e, q.player, q.src);
    resolving = null;
  }
}

function enqueue(s: GameState, pi: PlayerIdx, effects: Effect[] | undefined, c?: Card, tag?: EffectSource['tag']) {
  if (!effects) return;
  for (const e of effects) s.queue.push({ e, player: pi, ...(c && { src: c.uid, card: c.id }), ...(tag && { tag }) });
}

/** Records a play for combo purposes and queues the card effect plus any combos it unlocks. */
function registerPlay(s: GameState, pi: PlayerIdx, c: Card) {
  const def = cardDef(c.id);
  enqueue(s, pi, def.play, c);
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
        enqueue(s, pi, combo[tier], tp.uid === undefined ? undefined : { uid: tp.uid, id: tp.id }, 'combo');
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
  sub(s, `${PATRONS.druid.name} дарует «${name('druid_chimera')}»`);
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
      // The chosen branch is told as it was offered, and its effects don't repeat it.
      const label = pend.options.find((o) => o.ref === uniq[0])!.label;
      head(s, `${LOG_SUB}выбирает: ${label.charAt(0).toLowerCase()}${label.slice(1)}`, pend.from ?? null);
      open!.bare = false;
      open!.skip = branch.length;
      s.queue.unshift(...branch.map((e) => ({ e, player: pi, ...pend.from })));
      break;
    }
    case 'acquire':
      for (const uid of uniq) {
        const c = removeByUid(s.tavern, uid)!;
        head(s, `${LOG_SUB}получает из таверны «${name(c.id)}»`, { src: c.uid, card: c.id });
        emit(s, { k: 'gain', p: pi, card: c.id });
        gainCard(s, pi, c);
      }
      refillTavern(s);
      break;
    case 'toss': {
      const tossed = uniq.map((uid) => removeByUid(p.deck, uid)!);
      if (tossed.length) sub(s, `сбрасывает с верха колоды ${names(tossed)}`);
      for (const c of tossed) toCooldown(s, pi, c);
      break;
    }
    case 'destroy':
    case 'treasury':
      for (const uid of uniq) {
        const c = removeByUid(p.played, uid) ?? removeByUid(p.hand, uid);
        if (!c) continue;
        sub(s, `уничтожает «${name(c.id)}»${pend.kind === 'treasury' ? `, взамен «${name('writ')}» в свой сброс` : ''}`);
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
        sub(s, `жертвует «${name(c.id)}»: +${gain} ${PRE}`);
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
        if (!c) continue;
        p.deck.unshift(c);
        sub(s, `кладёт «${name(c.id)}» из сброса наверх колоды`);
      }
      break;
    case 'replaceTavern': {
      const out = uniq.map((uid) => removeByUid(s.tavern, uid)!);
      s.tavernDeck.push(...out);
      const was = new Set(s.tavern.map((c) => c.uid));
      refillTavern(s);
      if (out.length) sub(s, `убирает из таверны ${names(out)}; приходят ${names(s.tavern.filter((c) => !was.has(c.uid)))}`);
      break;
    }
    case 'heal': {
      const a = p.agents.find((x) => x.uid === uniq[0]);
      if (!a) break;
      const before = a.dmg;
      a.dmg = Math.max(0, a.dmg - (pend.data as number));
      sub(s, `исцеляет «${name(a.id)}» на ${before - a.dmg}`);
      break;
    }
    case 'donate': {
      const gone = uniq.map((uid) => p.hand.find((c) => c.uid === uid)!);
      if (gone.length) sub(s, `сбрасывает ${names(gone)} и берёт ${nCards(gone.length)}`);
      for (const uid of uniq) discardFromHand(s, pi, uid);
      drawCards(s, p, uniq.length);
      break;
    }
    case 'confine': {
      const holder = p.agents.find((a) => a.uid === pend.data);
      const opp = s.players[other(pi)];
      const taken: Card[] = [];
      for (const uid of uniq) {
        const c = removeByUid(opp.cooldown, uid)!;
        taken.push(c);
        // The agent may have left play before its effect resolved: then nothing is confined.
        if (!holder) opp.cooldown.push(c);
        else (holder.confined ??= []).push(c);
      }
      if (holder && taken.length) sub(s, `заточает под «${name(holder.id)}» ${names(taken)} из сброса соперника`);
      break;
    }
    case 'reprieve': {
      const opp = s.players[other(pi)];
      for (const uid of uniq) {
        const c = removeByUid(opp.deck, uid)!;
        opp.cooldown.push(c);
        sub(s, `отправляет «${name(c.id)}» с верха колоды соперника в его сброс`);
      }
      break;
    }
    case 'bargain':
      for (const uid of uniq) {
        const c = removeByUid(s.tavern, uid)!;
        sub(s, `получает из таверны «${name(c.id)}», ${s.players[other(pi)].name} тоже`);
        gainCard(s, pi, c);
        s.players[other(pi)].cooldown.push(mk(s, c.id));
        emit(s, { k: 'gain', p: pi, card: c.id });
      }
      refillTavern(s);
      break;
    case 'selfDiscard':
    case 'discard':
      if (uniq.length) {
        const gone = names(uniq.map((uid) => p.hand.find((c) => c.uid === uid)!));
        // A discard forced at the start of a turn is a move of its own; the patron's price belongs to the call.
        if (pend.kind === 'discard') log(s, `${p.name} сбрасывает ${gone}`);
        else sub(s, `сбрасывает ${gone}`);
        emit(s, { k: 'discard', p: pi, n: uniq.length });
      }
      for (const uid of uniq) discardFromHand(s, pi, uid);
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
  const undo: PatronUndo = { patron: pid, coin: p.coin, power: p.power, favor: s.favor[pid] ?? null };
  s.patronCalls--;
  s.patronsUsed.push(pid);
  log(s, `${p.name} взывает к покровителю «${PATRONS[pid].name}»`);
  const line = s.log.length - 1;
  const hand = p.hand.length;
  const added = s.nextUid;
  emit(s, { k: 'patron', p: pi, patron: pid });
  // What the favor was before this call: several patrons pay out according to it.
  const was = s.favor[pid];
  // The Crow never goes back to neutral: after the first call he always sides with whoever called him last.
  if (pid !== 'treasury') s.favor[pid] = was === other(pi) && pid !== 'crows' ? null : pi;
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
  // What the call cost and gave goes on its journal line: "…: −3 ●, +2 ⚔".
  const delta = (n: number, icon: string) => (n > 0 ? [`+${n} ${icon}`] : n < 0 ? [`−${-n} ${icon}`] : []);
  const parts = [...delta(p.coin - undo.coin, COIN), ...delta(p.power - undo.power, POW)];
  if (p.hand.length > hand) parts.push(`берёт ${nCards(p.hand.length - hand)}`);
  for (const [pl, where] of [[p, 'в свой сброс'], [opp, 'в сброс соперника']] as const) {
    for (const c of pl.cooldown) if (c.uid >= added) parts.push(`«${name(c.id)}» ${where}`);
  }
  if (parts.length && s.log.length - 1 === line) s.log[line] += `: ${parts.join(', ')}`;
  // A call that only opened a choice of known cards can still be taken back.
  if (s.pending && CANCELABLE.includes(pid)) s.pending.undo = undo;
}

/** Patrons whose choice shows nothing hidden, so backing out of it gives nothing away. */
const CANCELABLE: PatronId[] = ['treasury', 'hlaalu', 'pelin', 'psijic'];

/** Whether `pi` may call off the patron or take back the card whose choice is open now. */
export function canCancel(s: GameState, pi: PlayerIdx): boolean {
  return s.phase === 'play' && s.pending?.player === pi && !!(s.pending.undo || s.pending.revert);
}

/** Calls off the patron: what it took comes back, and the call for this turn is not used. */
function cancelPatron(s: GameState, pi: PlayerIdx) {
  const undo = s.pending?.undo;
  if (!undo || !canCancel(s, pi)) throw new RuleError('Этот выбор отменить нельзя');
  const p = s.players[pi];
  p.coin = undo.coin;
  p.power = undo.power;
  if (undo.patron !== 'treasury') s.favor[undo.patron] = undo.favor;
  s.patronCalls++;
  s.patronsUsed.splice(s.patronsUsed.lastIndexOf(undo.patron), 1);
  s.pending = null;
  log(s, `${p.name} передумывает взывать к «${PATRONS[undo.patron].name}»`);
  emit(s, { k: 'cancel', p: pi, patron: undo.patron });
}

/** Choices that show cards nobody has seen: backing out of them would be a free peek. */
const REVEALING: PendingKind[] = ['toss', 'reprieve'];

const uids = (cards: Card[]) => cards.map((c) => c.uid).join();

/**
 * Whether the choice open now can still lead back to `before`: since then no card was drawn,
 * no deck shuffled or looked at and no new card came into the tavern.
 */
function nothingRevealed(before: GameState, s: GameState): boolean {
  const p = s.pending;
  if (!p || p.player !== s.current || p.undo || REVEALING.includes(p.kind) || s.rng !== before.rng) return false;
  if (uids(s.tavern) !== uids(before.tavern)) return false;
  return ([0, 1] as const).every((pi) => uids(s.players[pi].deck) === uids(before.players[pi].deck));
}

/** Takes back the card whose choice is open: the game goes back to how it was before the card was played. */
function takeBack(s: GameState, pi: PlayerIdx) {
  const r = s.pending?.revert;
  if (!r || !canCancel(s, pi)) throw new RuleError('Этот выбор отменить нельзя');
  const { log: lines, events } = s;
  for (const k of Object.keys(s)) delete (s as unknown as Record<string, unknown>)[k];
  Object.assign(s, r.state, { log: lines, events });
  const what = r.act === 'play' ? 'разыгрывать' : 'применять агента';
  log(s, `${s.players[pi].name} передумывает ${what} «${name(r.card)}»`);
  emit(s, { k: 'unplay', p: pi, card: r.card, act: r.act });
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
    log(s, `${p.name}: остаток силы бьёт «${name(a.id)}»: −${dmg}${hpLeft(a) > 0 ? ` (осталось ${hpLeft(a)})` : ''}`);
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

/** The prestige a player has to reach and keep ahead with through the opponent's turn. */
export function prestigeGoal(s: GameState): number {
  return s.goal ?? PRESTIGE_GOAL;
}

/** The players whose prestige climbed to the goal between two positions of the same game. */
export function reachedGoal(prev: GameState, next: GameState): PlayerIdx[] {
  const goal = prestigeGoal(next);
  return ([0, 1] as const).filter((pi) => prev.players[pi].prestige < goal && next.players[pi].prestige >= goal);
}

function endTurn(s: GameState) {
  const pi = s.current;
  const p = s.players[pi];
  tauntsAbsorbPower(s, pi);
  // Reactions to what the leftover power knocked out come too late to use.
  s.queue = [];
  p.prestige += p.power;
  if (p.power > 0) {
    log(s, `${p.name}: остаток ${p.power} ${POW} → +${p.power} ${PRE}`);
    emit(s, { k: 'prestige', p: pi, n: p.power });
  }
  p.power = 0;
  p.coin = 0;
  p.cooldown.push(...[...p.hand, ...p.played].filter((c) => !cardDef(c.id).fleeting));
  p.hand = [];
  p.played = [];
  for (const a of p.agents) a.activated = false;
  drawCards(s, p, HAND_SIZE);

  if (checkInstantWin(s)) return;
  const goal = prestigeGoal(s);

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
  if (s.turn === 2) {
    // Second player compensation: a one-off coin contract on top of the usual hand, gone with the turn.
    n.hand.push(mk(s, FAKE_COIN));
    log(s, `${n.name} получает «${name(FAKE_COIN)}»`);
    emit(s, { k: 'gain', p: next, card: FAKE_COIN });
  }
  if (s.favor.hunding === next) {
    n.coin += 1; // Kenjar pays whoever kept his favor through the turn
    log(s, `${n.name}: ${PATRONS.hunding.name} даёт +1 ${COIN}`);
  }
  if (n.boon) {
    const b = n.boon;
    n.coin += b.coin;
    n.power += b.power;
    drawCards(s, n, b.draw);
    delete n.boon;
    const got = [...(b.coin ? [`+${b.coin} ${COIN}`] : []), ...(b.power ? [`+${b.power} ${POW}`] : []), ...(b.draw ? [`берёт ${nCards(b.draw)}`] : [])];
    if (got.length) log(s, `${n.name} получает расплату: ${got.join(', ')}`);
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

/** Whether player `pi` may draft a patron from the pool: a locked one only if they opened it. */
export function mayDraft(s: GameState, pi: PlayerIdx, pid: PatronId): boolean {
  return !s.own || DRAFTABLE.includes(pid) || s.own[pi].includes(pid);
}

/** Applies an action for player `pi` and returns the new state. Throws RuleError on illegal moves. */
export function applyAction(state: GameState, pi: PlayerIdx, a: Action): GameState {
  const s = structuredClone(state) as GameState;
  s.events = [];
  open = null;
  resolving = null;
  if (a.t === 'concede') {
    if (s.phase === 'over') throw new RuleError('Игра окончена');
    finish(s, other(pi), 'соперник сдался');
    return s;
  }
  if (s.phase === 'over') throw new RuleError('Игра окончена');
  if (actingPlayer(s) !== pi) throw new RuleError('Сейчас не ваш ход');

  if (s.phase === 'draft') {
    if (a.t !== 'draft' || !s.draftPool.includes(a.patron)) throw new RuleError('Выберите покровителя');
    if (!mayDraft(s, pi, a.patron)) throw new RuleError('Этот покровитель у вас ещё не открыт');
    s.draftPool = s.draftPool.filter((x) => x !== a.patron);
    s.patrons.push(a.patron);
    log(s, `${s.players[pi].name} выбирает покровителя «${PATRONS[a.patron].name}»`);
    emit(s, { k: 'draft', p: pi, patron: a.patron });
    s.draftStep++;
    if (s.draftStep >= DRAFT_PICKS) startMatch(s);
    return s;
  }

  if (s.pending) {
    if (a.t === 'cancel') {
      if (s.pending.revert) takeBack(s, pi);
      else cancelPatron(s, pi);
      return s;
    }
    if (a.t !== 'choose') throw new RuleError('Сначала сделайте выбор');
    // The card's next choice can still take it back, as long as nothing hidden came to light.
    const revert = s.pending.revert;
    resolvePending(s, a.picks);
    if (revert && nothingRevealed(revert.state, s)) s.pending!.revert = revert;
    checkInstantWin(s);
    return s;
  }
  if (!idle(s, pi)) throw new RuleError('Подождите');
  const p = s.players[pi];
  // The card played or the agent used: its choice may take the move back.
  let moved: string | null = null;

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
      moved = c.id;
      head(s, `${p.name} разыгрывает ${def.type === 'agent' ? 'агента ' : ''}«${def.name}»`, { src: c.uid, card: c.id });
      emit(s, { k: 'play', p: pi, card: c.id });
      registerPlay(s, pi, c);
      if (def.type === 'agent') fire(s, pi, 'agentPlay', c);
      break;
    }
    case 'activate': {
      const ag = p.agents.find((x) => x.uid === a.uid);
      if (!ag || ag.activated) throw new RuleError('Агент уже действовал');
      ag.activated = true;
      moved = ag.id;
      head(s, `${p.name} применяет агента «${name(ag.id)}»`, { src: ag.uid, card: ag.id });
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
      log(s, `${p.name} атакует агента «${name(target.id)}»: −${dmg}${hpLeft(target) > 0 ? ` (осталось ${hpLeft(target)})` : ''}`);
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
      head(s, `${p.name} покупает ${def.type.startsWith('contract') ? 'контракт ' : ''}«${def.name}» за ${def.cost} ${COIN}`, { src: c.uid, card: c.id });
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
  if (moved && nothingRevealed(state, s)) {
    s.pending!.revert = { card: moved, act: a.t as 'play' | 'activate', state: structuredClone({ ...state, log: [], events: [] }) };
  }
  checkInstantWin(s);
  return s;
}

export { other, hpLeft };
