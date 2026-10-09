import { cardDef } from './cards';
import type { Card, Effect, GameState, PlayerIdx, ScriptId } from './types';

/**
 * The director of a tutorial game. The rules stay as they are; only luck is stacked: which cards
 * a hand draws (any order of a deck nobody has seen is as good as a shuffle) and which card comes
 * next into the tavern. So the player meets each lesson on the turn it is due, combos turn up as
 * if by chance, and the game ends near the planned turn whatever the player buys.
 */
interface Scenario {
  /** The first hand of each player, dealt off the top of the shuffled deck. */
  hands: [string[], string[]];
  /**
   * How good a hand is for the plan: `ids` is what `pi` will hold on turn `turn`, `rest` what is
   * left in the deck after it. The best scoring cards are drawn.
   */
  hand(s: GameState, pi: PlayerIdx, turn: number, ids: string[], rest: string[]): number;
  /** Cards that come into the tavern next, best first. */
  want(s: GameState): string[];
  /** Cards kept out of the tavern for now. */
  hold(s: GameState, id: string): boolean;
  /** Cards that must be on offer when this turn starts. */
  force?(s: GameState): string[];
}

/** Coins, power and draws a set of cards gives when played together, combos included. */
export function yieldOf(ids: string[], also: string[] = []) {
  const count: Record<string, number> = {};
  for (const id of [...ids, ...also]) {
    const pt = cardDef(id).patron;
    count[pt] = (count[pt] ?? 0) + 1;
  }
  const out = { coin: 0, power: 0, draw: 0, combos: 0 };
  const add = (list: Effect[]) => {
    for (const e of list) {
      if (e.k === 'coin') out.coin += e.n;
      else if (e.k === 'power' || e.k === 'prestige') out.power += e.n;
      else if (e.k === 'draw') out.draw += e.n;
      else if (e.k === 'choice') {
        const best = [...e.options].sort((a, b) => worth(b) - worth(a))[0] ?? [];
        add(best);
      }
    }
  };
  for (const id of [...ids, ...also]) {
    const def = cardDef(id);
    add(def.play);
    if (def.patron === 'neutral') continue;
    for (const k of [2, 3, 4] as const) {
      const fx = def.combo?.[k];
      if (fx && count[def.patron] >= k) {
        add(fx);
        out.combos++;
      }
    }
  }
  return out;
}

/** Power the Crow can make of the best hand left in a deck: its coins less one, plus its power. */
function crowFuel(ids: string[]): number {
  const each = ids.map((id) => {
    const y = yieldOf([id]);
    return y.coin + y.power;
  });
  return each.sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0) - 1;
}

const worth = (list: Effect[]) => list.reduce((v, e) => v + (e.k === 'coin' || e.k === 'power' ? e.n : 0), 0);

/** Prestige the tutorial opponent should have after each of his turns: always a step behind. */
const BASIC_PACE = [0, 1, 3, 6, 10, 12, 14, 15, 16, 17];

/** Plain cards that suit the lessons of the basics: power and coins, combos within reach. */
const BASIC_TAVERN = [
  'crows_murder',
  'pelin_siege',
  'pelin_volley',
  'crows_scratch',
  'pelin_legion',
  'hlaalu_exports',
  'pelin_portcullis',
  'eagle_raid',
  'crows_toll_silver',
  'pelin_reinforce',
  'pelin_armory',
];

/** The contract that closes the gap at the end of the basics, kept back until the last turns. */
export const FINAL_CONTRACT = 'eagle_sacrifice';
/** The turn from which the contract may come into the tavern: the opponent's turn before the player's fifth. */
const FINAL_TURN = 8;

/** Whether a card was bought at any time in this game, by its name in the journal. */
const everBought = (s: GameState, id: string) => s.log.some((l) => l.includes(`покупает контракт «${cardDef(id).name}»`) || l.includes(`покупает «${cardDef(id).name}»`));

const BASIC: Scenario = {
  hands: [
    ['gold', 'gold', 'gold', 'pelin_starter', 'eagle_starter'],
    ['gold', 'gold', 'gold', 'gold', 'gold'],
  ],
  hand(s, pi, turn, ids, rest) {
    const p = s.players[pi];
    const y = yieldOf(ids, p.agents.map((a) => a.id));
    if (pi === 1) {
      const n = turn / 2;
      const target = Math.min(BASIC_PACE[Math.min(n, BASIC_PACE.length - 1)], (s.goal ?? 40) - 2);
      // His agent comes on his third turn, so the player meets an agent on their fourth.
      const agent = n === 3 && ids.includes('crows_brigand') ? 30 : 0;
      return agent - Math.abs(p.prestige + y.power - target) * 4 + Math.min(y.coin, 3) * 0.3;
    }
    const n = (turn + 1) / 2;
    if (n === 4) {
      // A hand of coins that the Crow turns into power, enough to knock out the agent and still
      // score; the strong cards stay in the deck for the finish.
      const r = yieldOf(rest);
      const crow = y.coin - 1 + y.power;
      return (y.coin >= 2 && crow >= 2 ? 50 : 0) + Math.min(crow, 6) * 2 + (r.power * 3 + r.coin) * 1.5;
    }
    if (n === 5) {
      // The finish: power for the Eagle, whose card makes the most of what is left in the deck,
      // and a gap of one to three prestige after it, which the contract's 3 power close; six
      // coins buy it. The Eagle's starter makes the contract a combo that draws one more card.
      const draw = Math.max(0, ...rest.map((id) => yieldOf([...ids, id], p.agents.map((a) => a.id)).power - y.power));
      const reach = y.power >= 2 ? y.power - 2 + draw : y.power;
      const short = (s.goal ?? 40) - p.prestige - reach;
      const fit = short >= 1 && short <= 3 ? 40 : -Math.abs(short - 2) * 6;
      const eagle = ids.includes('eagle_starter') ? 6 : 0;
      return (y.coin >= 6 ? 20 : 0) + fit + Math.min(y.coin, 8) * 0.5 + y.combos + eagle;
    }
    // The combo turn; a good card or two left in the deck comes back for the finish.
    // The combo turn; with an eye on the Crow's turn after it, which gets the best of the rest.
    if (n === 3) return y.power * 3 + Math.min(y.coin, 6) + y.combos * 0.5 + crowFuel(rest) * 3;
    return y.power * 3 + Math.min(y.coin, 6) + y.combos * 0.5;
  },
  want(s) {
    return s.turn >= FINAL_TURN ? [FINAL_CONTRACT, ...BASIC_TAVERN] : BASIC_TAVERN;
  },
  hold(s, id) {
    if (id === FINAL_CONTRACT) return s.turn < FINAL_TURN;
    return cardDef(id).type !== 'action';
  },
  force(s) {
    return s.current === 0 && s.turn > FINAL_TURN && !everBought(s, FINAL_CONTRACT) ? [FINAL_CONTRACT] : [];
  },
};

/** Prestige the vagrant aims for after each of his turns in the advanced game, never quite level with the player. */
const ADVANCED_PACE = [0, 2, 2, 3, 4, 6, 9, 13, 17, 21, 24, 26, 27];

/** Plain cards the advanced game keeps on offer: power first, the player's buys for prestige. */
const ADVANCED_TAVERN = ['eagle_raid', 'pelin_legion', 'pelin_portcullis', 'pelin_siege', 'pelin_volley', 'hlaalu_exports', 'rajhin_sleight', 'pelin_armory'];
/** Cards of the lessons, kept out of the tavern until their turn: the card and the turn it may come. */
const ADVANCED_CARDS: Record<string, number> = {
  eagle_hunter: 5,
  pelin_bearer: 6,
  hlaalu_exchange: 9,
  hlaalu_market: 9,
  rajhin_tricks: 10,
};

const ADVANCED: Scenario = {
  hands: [
    ['gold', 'gold', 'gold', 'gold', 'hlaalu_starter'],
    ['gold', 'gold', 'pelin_starter', 'eagle_starter', 'rajhin_starter'],
  ],
  hand(s, pi, turn, ids) {
    const p = s.players[pi];
    const y = yieldOf(ids, p.agents.map((a) => a.id));
    if (pi === 1) {
      const n = turn / 2;
      const player = s.players[0].prestige;
      const target = Math.min(ADVANCED_PACE[Math.min(n, ADVANCED_PACE.length - 1)], Math.max(2, player - 3));
      // Coins for the lesson's purchase: the shield on his third turn, the bag of tricks on his fifth.
      const tricks = !everBought(s, 'rajhin_tricks');
      const need = n === 3 ? 6 : n === 4 ? 2 : n >= 5 && tricks ? 7 : 0;
      const coins = y.coin >= need ? 20 : -20;
      // His fourth turn: power to knock out the player's agent and call the Eagle.
      const power = n === 4 ? (y.power >= 4 ? 20 : -20) : -Math.abs(p.prestige + y.power - target) * 4;
      // The bag of tricks makes the player discard one card, not two: no other Cat card beside it.
      const cats = need === 7 ? ids.filter((id) => cardDef(id).patron === 'rajhin').length * -3 : 0;
      return coins + power + cats + Math.min(y.coin, 8) * 0.2;
    }
    // His third turn: the curse comes back with coins for the Chest and the hunter.
    if (turn === 5) return (ids.includes('bewilderment') ? 50 : 0) + Math.min(y.coin, 7) * 3 + y.power;
    // Later on: power for prestige and the patrons, coins for the dear cards of the Rat.
    const dear = ids.some((id) => cardDef(id).patron === 'hlaalu' && cardDef(id).cost >= 7) ? 6 : 0;
    return y.power * 3 + Math.min(y.coin, 10) + y.combos + dear - (ids.includes('bewilderment') ? 10 : 0);
  },
  want(s) {
    const lesson = Object.keys(ADVANCED_CARDS).filter((id) => s.turn >= ADVANCED_CARDS[id]);
    return [...lesson, ...ADVANCED_TAVERN];
  },
  hold(s, id) {
    if (id in ADVANCED_CARDS) return s.turn < ADVANCED_CARDS[id];
    const def = cardDef(id);
    return def.type !== 'action' || def.cost > 8;
  },
  force(s) {
    // Each lesson's card is on offer on its turn and stays until it is bought; on his fourth turn
    // the vagrant finds a caravan for the coins his bag of tricks will cost.
    const now = Object.keys(ADVANCED_CARDS).filter((id) => s.turn >= ADVANCED_CARDS[id] && (id !== 'pelin_bearer' || s.turn === 6) && (id !== 'eagle_hunter' || s.turn === 5));
    return [...now.filter((id) => !everBought(s, id)), ...(s.turn === 8 ? ['hlaalu_exports'] : [])];
  },
};

const SCENARIOS: Partial<Record<ScriptId, Scenario>> = { basic: BASIC, advanced: ADVANCED };

/** Puts each player's scripted first hand on top of their deck. */
export function arrangeDecks(s: GameState) {
  const sc = s.script && SCENARIOS[s.script];
  if (!sc) return;
  s.players.forEach((p, pi) => {
    const top: Card[] = [];
    for (const id of sc.hands[pi]) {
      const i = p.deck.findIndex((c) => c.id === id);
      if (i >= 0) top.push(...p.deck.splice(i, 1));
    }
    p.deck.unshift(...top);
  });
}

/**
 * Before `n` cards are drawn: puts the best of them on top of the deck. When the deck runs out,
 * what is left of it comes first and the cooldown is shuffled in under it now, as the draw would.
 */
export function stackDraw(s: GameState, pi: PlayerIdx, n: number, hand: boolean, shuffle: (cards: Card[]) => Card[]) {
  const sc = s.script && SCENARIOS[s.script];
  if (!sc) return;
  const p = s.players[pi];
  let forced: Card[] = [];
  let pool = p.deck;
  if (p.deck.length < n) {
    if (!p.cooldown.length) return;
    forced = p.deck;
    pool = shuffle(p.cooldown);
    p.cooldown = [];
  }
  const k = Math.min(n - forced.length, pool.length);
  const base = forced.map((c) => c.id);
  // A hand drawn at the end of a turn is played on the player's next turn; any other draw is used now.
  const turn = s.turn + 2;
  const score = hand
    ? (ids: string[], rest: string[]) => sc.hand(s, pi, turn, [...base, ...ids], rest)
    : (ids: string[]) => {
        const before = [...s.turnPlays.map((t) => t.id), ...p.hand.map((c) => c.id)];
        const was = yieldOf(before);
        const now = yieldOf([...before, ...base, ...ids]);
        return (now.power - was.power) * 3 + (now.coin - was.coin) + (now.draw - was.draw) * 2;
      };
  const pick = bestSubset(pool, k, score);
  p.deck = [...forced, ...pick, ...pool.filter((c) => !pick.includes(c))];
}

/** The `k` cards of `pool` that score best; cards with the same id are interchangeable. */
function bestSubset(pool: Card[], k: number, score: (ids: string[], rest: string[]) => number): Card[] {
  const groups = new Map<string, Card[]>();
  for (const c of pool) groups.set(c.id, [...(groups.get(c.id) ?? []), c]);
  const keys = [...groups.keys()];
  let best: string[] = [];
  let bestV = -Infinity;
  const cur: string[] = [];
  const restOf = (taken: string[]) => {
    const left = pool.map((c) => c.id);
    for (const id of taken) left.splice(left.indexOf(id), 1);
    return left;
  };
  const walk = (i: number, left: number) => {
    if (left === 0 || i === keys.length) {
      if (left > 0) return;
      const v = score(cur, restOf(cur));
      if (v > bestV) [bestV, best] = [v, [...cur]];
      return;
    }
    const g = groups.get(keys[i])!;
    for (let take = Math.min(left, g.length); take >= 0; take--) {
      for (let t = 0; t < take; t++) cur.push(keys[i]);
      walk(i + 1, left - take);
      cur.length -= take;
    }
  };
  walk(0, k);
  const used = new Map<string, number>();
  return best.map((id) => {
    const n = used.get(id) ?? 0;
    used.set(id, n + 1);
    return groups.get(id)![n];
  });
}

/** Index in the tavern deck of the card that comes into the tavern next. */
export function nextTavernCard(s: GameState): number {
  const sc = s.script && SCENARIOS[s.script];
  if (!sc || s.phase !== 'play') return 0;
  for (const id of sc.want(s)) {
    if (sc.hold(s, id)) continue;
    const i = s.tavernDeck.findIndex((c) => c.id === id);
    if (i >= 0) return i;
  }
  const i = s.tavernDeck.findIndex((c) => !sc.hold(s, c.id));
  return Math.max(0, i);
}

/** A new turn: cards the plan needs on offer now take the place of the least wanted ones. */
export function turnBegins(s: GameState) {
  const sc = s.script && SCENARIOS[s.script];
  if (!sc?.force) return;
  const need = sc.force(s);
  const want = sc.want(s);
  for (const id of need) {
    if (s.tavern.some((c) => c.id === id)) continue;
    const i = s.tavernDeck.findIndex((c) => c.id === id);
    if (i < 0) continue;
    const rank = (c: Card) => (need.includes(c.id) ? -1 : want.includes(c.id) ? want.length - want.indexOf(c.id) : want.length + 1);
    const slot = s.tavern.reduce((b, c, j) => (rank(c) > rank(s.tavern[b]) ? j : b), 0);
    s.tavernDeck.push(s.tavern[slot]);
    s.tavern[slot] = s.tavernDeck.splice(i, 1)[0];
  }
}
