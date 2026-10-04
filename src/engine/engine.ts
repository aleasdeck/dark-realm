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
  Action,
  AgentInPlay,
  Card,
  Effect,
  GameState,
  Pending,
  PatronId,
  PlayerIdx,
  PlayerState,
} from './types';

export class RuleError extends Error {}

const DRAFT_ORDER: PlayerIdx[] = [0, 1, 1, 0];

const other = (p: PlayerIdx): PlayerIdx => (p === 0 ? 1 : 0);

function newPlayer(name: string): PlayerState {
  return { name, deck: [], hand: [], played: [], cooldown: [], agents: [], coin: 0, power: 0, prestige: 0, pendingDiscard: 0 };
}

export function createGame(seed: number, names: [string, string]): GameState {
  return {
    phase: 'draft',
    rng: seed | 0,
    nextUid: 1,
    players: [newPlayer(names[0]), newPlayer(names[1])],
    current: 0,
    turn: 0,
    patrons: [],
    draftPool: [...DRAFTABLE],
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
  const card: Card = { uid: a.uid, id: a.id };
  if (cardDef(a.id).type === 'contractAgent') s.tavernDeck.push(card);
  else p.cooldown.push(card);
  log(s, `${p.name}: агент «${name(a.id)}» сражён`);
}

// ── setup ────────────────────────────────────────────────

function startMatch(s: GameState) {
  s.patrons = [...s.patrons, 'treasury'];
  for (const pid of s.patrons) if (pid !== 'treasury') s.favor[pid] = null;
  for (const p of s.players) {
    const deck: Card[] = [];
    for (let i = 0; i < STARTING_GOLD; i++) deck.push(mk(s, 'gold'));
    for (const pid of s.patrons) {
      const starter = CARDS.find((c) => c.patron === pid && c.type === 'starter');
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
  refillTavern(s);
  drawCards(s, s.players[0], HAND_SIZE);
  drawCards(s, s.players[1], HAND_SIZE);
  s.phase = 'play';
  s.current = 0;
  s.turn = 1;
  log(s, `Покровители: ${s.patrons.map((p) => PATRONS[p].name).join(', ')}`);
  log(s, `Ход ${s.turn}: ${s.players[0].name}`);
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

function execEffect(s: GameState, e: Effect, pi: PlayerIdx) {
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
        else p.cooldown.push(c);
      }
      return;
    case 'knockoutAll':
      for (const a of [...opp.agents]) knockOut(s, other(pi), a.uid);
      return;
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
        prompt: `Уничтожьте до ${e.n} карт (в игре или в сбросе)`,
        options: [...p.played.map((c) => cardOption(c, ' (в игре)')), ...p.cooldown.map((c) => cardOption(c, ' (сброс)'))],
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
        prompt: e.agentsOnly ? 'Верните агента из сброса наверх колоды' : `Верните до ${e.n} карт из сброса наверх колоды`,
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
    execEffect(s, q.e, q.player);
  }
}

function enqueue(s: GameState, pi: PlayerIdx, effects: Effect[] | undefined) {
  if (!effects) return;
  for (const e of effects) s.queue.push({ e, player: pi });
}

/** Records a play for combo purposes and queues the card effect plus any combos it unlocks. */
function registerPlay(s: GameState, pi: PlayerIdx, id: string) {
  const def = cardDef(id);
  enqueue(s, pi, def.play);
  if (def.patron === 'neutral' || def.patron === 'treasury') return;
  s.turnPlays.push({ id, patron: def.patron, fired: [] });
  const count = s.turnPlays.filter((t) => t.patron === def.patron).length;
  for (const tp of s.turnPlays) {
    if (tp.patron !== def.patron) continue;
    const combo = cardDef(tp.id).combo;
    if (!combo) continue;
    for (const tier of [2, 3, 4] as const) {
      if (combo[tier] && tier <= count && !tp.fired.includes(tier)) {
        tp.fired.push(tier);
        enqueue(s, pi, combo[tier]);
      }
    }
  }
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
      }
      refillTavern(s);
      break;
    case 'toss':
      for (const uid of uniq) p.cooldown.push(removeByUid(p.deck, uid)!);
      break;
    case 'destroy':
    case 'treasury':
      for (const uid of uniq) {
        const c = removeByUid(p.played, uid) ?? removeByUid(p.cooldown, uid);
        if (c) log(s, `${p.name} уничтожает «${name(c.id)}»`);
      }
      if (pend.kind === 'treasury') p.cooldown.push(mk(s, 'writ'));
      break;
    case 'hlaalu':
      for (const uid of uniq) {
        const c = removeByUid(p.played, uid) ?? removeByUid(p.cooldown, uid);
        if (!c) continue;
        const gain = Math.max(0, cardDef(c.id).cost - 1);
        p.prestige += gain;
        log(s, `${p.name} жертвует «${name(c.id)}» Ростовщице: +${gain} престижа`);
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
      for (const uid of uniq) p.cooldown.push(removeByUid(p.hand, uid)!);
      drawCards(s, p, uniq.length);
      break;
    case 'discard':
      for (const uid of uniq) p.cooldown.push(removeByUid(p.hand, uid)!);
      if (uniq.length) log(s, `${p.name} сбрасывает ${uniq.length} карт(ы)`);
      break;
  }
  runQueue(s);
}

/** Puts a newly obtained card where it belongs: contracts resolve at once. */
function gainCard(s: GameState, pi: PlayerIdx, c: Card) {
  const def = cardDef(c.id);
  if (def.type === 'contractAction') {
    s.tavernDeck.push(c);
    registerPlay(s, pi, c.id);
  } else if (def.type === 'contractAgent') {
    s.players[pi].agents.push({ ...c, dmg: 0, activated: false });
  } else {
    s.players[pi].cooldown.push(c);
  }
}

// ── patrons ──────────────────────────────────────────────

export function patronAvailable(s: GameState, pi: PlayerIdx, pid: PatronId): boolean {
  if (s.phase !== 'play' || s.current !== pi || s.pending || s.queue.length) return false;
  if (!s.patrons.includes(pid) || s.patronCalls <= 0 || s.patronsUsed.includes(pid)) return false;
  const p = s.players[pi];
  const opp = s.players[other(pi)];
  const inPlayOrCd = [...p.played, ...p.cooldown];
  switch (pid) {
    case 'treasury':
      return p.coin >= 2 && inPlayOrCd.length > 0;
    case 'crows':
      return s.favor.crows !== pi && p.coin >= 1;
    case 'hlaalu':
      return inPlayOrCd.some((c) => cardDef(c.id).cost >= 1);
    case 'pelin':
      return p.power >= 2 && p.cooldown.some((c) => cardDef(c.id).type === 'agent');
    case 'psijic':
      return p.power >= 4 && opp.agents.length > 0;
    case 'rajhin':
      return p.coin >= 3;
    case 'eagle':
      return p.power >= 2;
  }
}

function activatePatron(s: GameState, pi: PlayerIdx, pid: PatronId) {
  if (!patronAvailable(s, pi, pid)) throw new RuleError('Покровитель недоступен');
  const p = s.players[pi];
  const opp = s.players[other(pi)];
  s.patronCalls--;
  s.patronsUsed.push(pid);
  log(s, `${p.name} взывает к покровителю «${PATRONS[pid].name}»`);
  if (pid !== 'treasury') {
    const f = s.favor[pid];
    s.favor[pid] = f === other(pi) ? null : pi;
  }
  switch (pid) {
    case 'treasury':
      p.coin -= 2;
      ask(s, {
        player: pi,
        kind: 'treasury',
        prompt: 'Сундук Бездны: уничтожьте карту, взамен получите «Долговую расписку»',
        options: [...p.played.map((c) => cardOption(c, ' (в игре)')), ...p.cooldown.map((c) => cardOption(c, ' (сброс)'))],
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
        prompt: 'Ростовщица Вейла: пожертвуйте карту ради престижа (цена − 1)',
        options: [...p.played, ...p.cooldown]
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
        prompt: 'Гримвальд Костяной: верните агента наверх колоды',
        options: p.cooldown.filter((c) => cardDef(c.id).type === 'agent').map((c) => cardOption(c)),
        min: 1,
        max: 1,
      });
      break;
    case 'psijic':
      p.power -= 4;
      ask(s, {
        player: pi,
        kind: 'psijic',
        prompt: 'Иссерия Безглазая: сразите агента соперника',
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
  }
}

// ── turn flow ────────────────────────────────────────────

function endTurn(s: GameState) {
  const pi = s.current;
  const p = s.players[pi];
  p.prestige += p.power;
  if (p.power > 0) log(s, `${p.name}: сила ${p.power} → престиж`);
  p.power = 0;
  p.coin = 0;
  p.cooldown.push(...p.hand, ...p.played);
  p.hand = [];
  p.played = [];
  for (const a of p.agents) a.activated = false;
  drawCards(s, p, HAND_SIZE);

  if (p.prestige >= PRESTIGE_INSTANT) return finish(s, pi, `${PRESTIGE_INSTANT} престижа`);
  const drafted = s.patrons.filter((x) => x !== 'treasury');
  if (drafted.length > 0 && drafted.every((x) => s.favor[x] === pi)) {
    return finish(s, pi, 'благосклонность всех покровителей');
  }

  const next = other(pi);
  const n = s.players[next];
  s.current = next;
  s.turn++;
  s.patronCalls = 1;
  s.patronsUsed = [];
  s.turnPlays = [];
  log(s, `Ход ${s.turn}: ${n.name}`);
  // A player who reached the goal and stayed ahead through the opponent's turn wins.
  if (n.prestige >= PRESTIGE_GOAL && n.prestige > p.prestige) return finish(s, next, `${PRESTIGE_GOAL}+ престижа`);
  if (s.turn === 2) n.coin += 1; // second player compensation
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
    s.draftStep++;
    if (s.draftStep >= DRAFT_ORDER.length) startMatch(s);
    return s;
  }

  if (s.pending) {
    if (a.t !== 'choose') throw new RuleError('Сначала сделайте выбор');
    resolvePending(s, a.picks);
    return s;
  }
  if (!idle(s, pi)) throw new RuleError('Подождите');
  const p = s.players[pi];

  switch (a.t) {
    case 'play': {
      const c = removeByUid(p.hand, a.uid);
      if (!c) throw new RuleError('Нет такой карты в руке');
      const def = cardDef(c.id);
      if (def.type === 'agent') {
        p.agents.push({ ...c, dmg: 0, activated: true });
      } else {
        p.played.push(c);
      }
      registerPlay(s, pi, c.id);
      break;
    }
    case 'activate': {
      const ag = p.agents.find((x) => x.uid === a.uid);
      if (!ag || ag.activated) throw new RuleError('Агент уже действовал');
      ag.activated = true;
      registerPlay(s, pi, ag.id);
      break;
    }
    case 'attack': {
      const target = attackable(s, pi).find((x) => x.uid === a.uid);
      if (!target) throw new RuleError('Сначала атакуйте агентов с провокацией');
      if (p.power <= 0) throw new RuleError('Нет силы для атаки');
      const dmg = Math.min(p.power, hpLeft(target));
      p.power -= dmg;
      target.dmg += dmg;
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
      gainCard(s, pi, c);
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
  return s;
}

export { other, hpLeft };
