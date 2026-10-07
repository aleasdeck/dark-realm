import { choose, mediumAction, noise, playFirst, randomDraft } from './bot';
import { cardDef, HAND_SIZE, PRESTIGE_GOAL } from './cards';
import { actingPlayer, applyAction, attackable, hpLeft, other, patronAvailable, RuleError } from './engine';
import { rngNext } from './rng';
import type { Action, Card, Effect, GameState, PatronId, PlayerIdx, PlayerState } from './types';

/*
 * The hard bot plays out the rest of its turn in its head. Before each decision that matters (what to buy,
 * which patron to call, which agent to knock out, how to answer a choice) it tries every option, follows
 * each with a few more of its own decisions, and scores where the turn ends. The score weighs prestige,
 * the strength of both decks (combos included), agents on the table and patron favor, including the
 * threat of the opponent winning through favor next turn.
 *
 * It does not peek: before looking ahead it shuffles everything it cannot see (its own deck, the
 * opponent's hand and deck, the tavern deck) into a few guessed worlds and averages over them.
 */

const WIN = 10000;
/**
 * Search size and scoring weights, tuned in bot-vs-bot games (scripts/duel.ts). `worlds` guessed deals,
 * `depth` decisions looked through, `budget` positions per decision before lines are finished by rules
 * of thumb; the rest weigh parts of the score against a point of prestige.
 */
export const TUNE = { worlds: 3, depth: 3, budget: 1200, deck: 1.7, favor: 0.9, threat: 40, coinLeft: 0.4, horizonDiv: 7, taunt: 0.45, goalBonus: 6 };
const T = TUNE;

let visited = 0;

/** The next action of the hard bot playing as `pi`. */
export function hardAction(s: GameState, pi: PlayerIdx): Action {
  if (s.phase === 'draft') return randomDraft(s);
  const forced = forcedMove(s, pi);
  if (forced) return forced;
  const options = candidates(s, pi);
  if (options.length === 1) return options[0];
  visited = 0;
  const scores = options.map(() => 0);
  for (let w = 0; w < T.worlds; w++) {
    const world = guessWorld(s, pi, w);
    options.forEach((a, i) => {
      scores[i] += valueOf(world, pi, a, T.depth - 1);
    });
  }
  let best = 0;
  for (let i = 1; i < options.length; i++) if (scores[i] > scores[best] + 1e-9) best = i;
  return options[best];
}

/** Moves that are always right: playing every card in hand and using every agent. */
function forcedMove(s: GameState, pi: PlayerIdx): Action | null {
  if (s.pending) return null;
  const p = s.players[pi];
  const card = playFirst(p.hand);
  if (card) return { t: 'play', uid: card.uid };
  const ready = p.agents.find((a) => !a.activated);
  if (ready) return { t: 'activate', uid: ready.uid };
  return null;
}

/** The options worth comparing at this point of the turn. */
function candidates(s: GameState, pi: PlayerIdx): Action[] {
  const pend = s.pending;
  if (pend) {
    if (pend.kind === 'choice') return pend.options.map((o) => ({ t: 'choose', picks: [o.ref] }));
    const out: Action[] = [];
    if (pend.min === 0) out.push({ t: 'choose', picks: [] });
    if (pend.max === 1) {
      const seen = new Set<string>();
      for (const o of pend.options) {
        const key = o.cardId ?? String(o.ref);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ t: 'choose', picks: [o.ref] });
      }
    } else {
      const rule = choose(s, pend);
      if (rule.t === 'choose' && rule.picks.length) out.push(rule);
    }
    if (!out.length) out.push(choose(s, pend));
    return out;
  }
  const p = s.players[pi];
  const out: Action[] = [{ t: 'end' }];
  const seen = new Set<string>();
  for (const c of s.tavern) {
    const def = cardDef(c.id);
    if (def.cost > p.coin || def.cost <= 0 || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ t: 'buy', uid: c.uid });
  }
  for (const pid of s.patrons) if (patronAvailable(s, pi, pid)) out.push({ t: 'patron', patron: pid });
  if (p.power > 0) {
    for (const a of attackable(s, pi)) if (hpLeft(a) <= p.power) out.push({ t: 'attack', uid: a.uid });
  }
  return out;
}

function valueOf(s: GameState, pi: PlayerIdx, a: Action, depth: number): number {
  let next: GameState;
  try {
    next = applyAction(s, pi, a);
  } catch (e) {
    if (e instanceof RuleError) return -Infinity;
    throw e;
  }
  visited++;
  return search(next, pi, depth);
}

function search(s: GameState, pi: PlayerIdx, depth: number): number {
  for (;;) {
    if (s.phase === 'over') return s.winner === pi ? WIN : -WIN;
    if (s.current !== pi || actingPlayer(s) !== pi) return evaluate(s, pi);
    const forced = forcedMove(s, pi);
    if (!forced) break;
    s = applyAction(s, pi, forced);
    visited++;
  }
  if (depth <= 0 || visited > T.budget) return rollout(s, pi);
  let best = -Infinity;
  for (const a of candidates(s, pi)) best = Math.max(best, valueOf(s, pi, a, depth - 1));
  return best;
}

/** Finishes the turn by rules of thumb and scores the result. */
function rollout(s: GameState, pi: PlayerIdx): number {
  for (let i = 0; i < 40; i++) {
    if (s.phase === 'over') return s.winner === pi ? WIN : -WIN;
    if (s.current !== pi || actingPlayer(s) !== pi) break;
    s = applyAction(s, pi, mediumAction(s, pi));
    visited++;
  }
  return s.phase === 'over' ? (s.winner === pi ? WIN : -WIN) : evaluate(s, pi);
}

// ── guessing what the bot cannot see ─────────────────────

function shuffled<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let r = seed | 0;
  for (let i = out.length - 1; i > 0; i--) {
    const [v, next] = rngNext(r);
    r = next;
    const j = Math.floor(v * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A copy of the game with hidden cards reshuffled. Cards a pending choice shows stay where they are. */
function guessWorld(s: GameState, pi: PlayerIdx, w: number): GameState {
  const g = structuredClone(s) as GameState;
  g.log = [];
  g.events = [];
  const seed = Math.floor(noise(s, 17 + w) * 0x7fffffff);
  const me = g.players[pi];
  const opp = g.players[other(pi)];
  const shown = new Set(g.pending?.options.map((o) => o.ref) ?? []);
  const keepTop = (deck: Card[]) => {
    let n = 0;
    while (n < deck.length && shown.has(deck[n].uid)) n++;
    return n;
  };
  const myTop = keepTop(me.deck);
  me.deck = [...me.deck.slice(0, myTop), ...shuffled(me.deck.slice(myTop), seed)];
  const oppTop = keepTop(opp.deck);
  const hidden = shuffled([...opp.hand, ...opp.deck.slice(oppTop)], seed + 1);
  opp.hand = hidden.slice(0, opp.hand.length);
  opp.deck = [...opp.deck.slice(0, oppTop), ...hidden.slice(opp.hand.length)];
  g.tavernDeck = shuffled(g.tavernDeck, seed + 2);
  // The engine's own randomness (reshuffles mid-turn) must not follow the real game either.
  g.rng = (g.rng ^ seed) | 0;
  return g;
}

// ── scoring a position ───────────────────────────────────

/** Worth of an effect in prestige-like units; `late` (0..1) shifts weight from coins to power. */
function fx(list: Effect[] | undefined, late: number): number {
  if (!list) return 0;
  let v = 0;
  for (const e of list) {
    switch (e.k) {
      case 'coin':
        v += e.n * (1 - 0.35 * late);
        break;
      case 'power':
        v += e.n * (0.75 + 0.35 * late);
        break;
      case 'prestige':
      case 'oppLosePrestige':
        v += e.n * 1.1;
        break;
      case 'draw':
        v += e.n * 1.6;
        break;
      case 'oppDiscard':
        v += e.n * 1.4;
        break;
      case 'acquire':
        v += e.n * 0.55 * (1 - 0.5 * late);
        break;
      case 'toss':
        v += 0.3 + 0.08 * e.n;
        break;
      case 'destroy':
        v += e.n * 0.8 * (1 - late);
        break;
      case 'knockout':
        v += e.n * 1.2;
        break;
      case 'knockoutAll':
        v += 1;
        break;
      case 'returnTop':
        v += e.n * 0.5;
        break;
      case 'replaceTavern':
        v += e.n * 0.15;
        break;
      case 'heal':
        v += 0.4;
        break;
      case 'create':
        v += e.n * 0.6;
        break;
      case 'patronCall':
        v += e.n * 1.5;
        break;
      case 'donate':
        v += e.n * 0.6;
        break;
      case 'choice':
        v += Math.max(...e.options.map((o) => fx(o, late)));
        break;
      case 'confine':
        v += e.n * 0.8;
        break;
      case 'setback':
        v -= e.n * (e.res === 'draw' ? 1.6 : 0.9);
        break;
      case 'reprieve':
        v += 0.6;
        break;
      case 'bargain':
        v += 1.5;
        break;
      case 'selfDiscard':
        v -= e.n * 1.4;
        break;
    }
  }
  return v;
}

/** Chance that at least `need` of `draws` cards pulled from `n` hold one of `k` marked ones (binomial guess). */
function atLeast(need: number, k: number, n: number, draws: number): number {
  if (need <= 0) return 1;
  if (n <= 0 || k < need) return 0;
  const p = Math.min(1, k / n);
  let miss = 0;
  for (let i = 0; i < need; i++) miss += binom(draws, i) * p ** i * (1 - p) ** (draws - i);
  return Math.max(0, 1 - miss);
}

function binom(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

interface Deck {
  cards: Card[];
  byPatron: Map<string, number>;
}

function deckOf(p: PlayerState): Deck {
  const cards = [...p.deck, ...p.hand, ...p.played, ...p.cooldown].filter((c) => !cardDef(c.id).fleeting);
  const byPatron = new Map<string, number>();
  for (const c of [...cards, ...p.agents]) {
    const pat = cardDef(c.id).patron;
    byPatron.set(pat, (byPatron.get(pat) ?? 0) + 1);
  }
  return { cards, byPatron };
}

/** Worth of one play of a card, combos weighted by how likely its patron's other cards show up the same turn. */
function playValue(id: string, d: Deck, late: number, agentsOut: number): number {
  const def = cardDef(id);
  if (def.type === 'curse') return -0.4;
  let v = fx(def.play, late);
  if (def.combo) {
    const others = (d.byPatron.get(def.patron) ?? 1) - 1;
    const pool = Math.max(1, d.cards.length - 1);
    for (const tier of [2, 3, 4] as const) {
      const combo = def.combo[tier];
      if (combo) v += fx(combo, late) * atLeast(tier - 1, others, pool + agentsOut, HAND_SIZE - 1 + agentsOut);
    }
  }
  return v;
}

/** How many more turns a player is likely to get, from how close the leader is to the goal. */
function turnsLeft(s: GameState): number {
  const goal = s.goal ?? PRESTIGE_GOAL;
  const lead = Math.max(s.players[0].prestige, s.players[1].prestige);
  return Math.max(0.6, Math.min(6, (goal - lead) / T.horizonDiv + 0.6));
}

/** Expected output of a player's future turns: hand-sized samples of the deck plus the agents on the table. */
function strength(s: GameState, pi: PlayerIdx, horizon: number, late: number): number {
  const p = s.players[pi];
  const foe = s.players[other(pi)];
  const d = deckOf(p);
  const n = d.cards.length;
  let deck = 0;
  for (const c of d.cards) {
    const def = cardDef(c.id);
    let v = playValue(c.id, d, late, p.agents.length);
    // An agent bought into the deck stays out once played and acts again on later turns.
    if (def.type === 'agent') v *= 1 + 0.4 * Math.min(horizon, 1 + (def.hp ?? 1) / 2);
    deck += v;
  }
  let total = n ? (deck / n) * HAND_SIZE * horizon : 0;
  for (const a of p.agents) {
    const def = cardDef(a.id);
    const life = 1 + hpLeft(a) / 2.5;
    total += playValue(a.id, d, late, p.agents.length) * Math.min(horizon, life);
    // A taunting agent soaks up power the opponent would turn into prestige.
    if (def.taunt) total += Math.min(hpLeft(a), 6) * T.taunt;
    if (a.confined?.length) total += a.confined.length * 0.6;
  }
  // Cards held under the opponent's agents are missing from this deck until they get out.
  total -= foe.agents.reduce((k, a) => k + (a.confined?.length ?? 0), 0) * 0.2;
  return total;
}

function favorValue(s: GameState, pi: PlayerIdx, horizon: number): number {
  const drafted = s.patrons.filter((x) => x !== 'treasury');
  const foe = other(pi);
  let v = 0;
  const count = (who: PlayerIdx) => drafted.filter((x) => s.favor[x] === who).length;
  for (const x of drafted) {
    const f = s.favor[x];
    const w = x === 'hunding' ? 0.6 + 0.8 * horizon : T.favor;
    if (f === pi) v += w;
    else if (f === foe) v -= w;
  }
  // One favor short of winning outright with the last patron neutral (or the Crow): a call next turn ends the game.
  const threat = (who: PlayerIdx) => {
    if (count(who) !== drafted.length - 1) return 0;
    const last = drafted.find((x) => s.favor[x] !== who) as PatronId;
    // The Crow swings straight over from the other side, so holding him is no shield.
    return s.favor[last] === null || last === 'crows' ? 1 : 0.25;
  };
  const toMove = s.current;
  v += threat(pi) * (toMove === pi ? T.threat : 7);
  v -= threat(foe) * (toMove === foe ? T.threat : 7);
  return v;
}

/** Score of a position for `pi`, in prestige-like units. */
export function evaluate(s: GameState, pi: PlayerIdx): number {
  if (s.phase === 'over') return s.winner === pi ? WIN : -WIN;
  const foe = other(pi);
  const me = s.players[pi];
  const op = s.players[foe];
  const goal = s.goal ?? PRESTIGE_GOAL;
  const horizon = turnsLeft(s);
  const late = Math.max(0, Math.min(1, Math.max(me.prestige, op.prestige) / goal));
  let v = me.prestige - op.prestige;
  // Whoever is to move still turns their power into prestige; their coins buy something.
  const mover = s.players[s.current];
  const sign = s.current === pi ? 1 : -1;
  v += sign * (mover.power + mover.coin * T.coinLeft);
  if (op.pendingDiscard) v += op.pendingDiscard * 1.3;
  if (s.pending?.kind === 'discard' && s.pending.player === foe) v += s.pending.min * 1.3;
  v += T.deck * (strength(s, pi, horizon, late) - strength(s, foe, horizon, late));
  v += favorValue(s, pi, horizon);
  // Past the goal and ahead after our turn, the opponent has one turn to catch up.
  if (s.current === foe && me.prestige >= goal && me.prestige > op.prestige) v += T.goalBonus + (me.prestige - op.prestige);
  if (s.current === pi && op.prestige >= goal && op.prestige > me.prestige) v -= T.goalBonus + (op.prestige - me.prestige);
  return v;
}
