import { cardDef } from './cards';
import { actingPlayer, attackable, hpLeft, other, patronAvailable } from './engine';
import { hardAction } from './botHard';
import { rngNext } from './rng';
import { TUTORIAL_PATRONS } from './tutorial';
import type { Action, Card, Effect, GameState, Pending, PatronId, PlayerIdx } from './types';

/**
 * How well the bot plays. `gentle` is the tutorial opponent; the other three are offered before a game:
 * `easy` shops at random and leaves patrons and agents alone, `medium` follows simple rules of thumb,
 * `hard` looks ahead through the rest of its turn and weighs decks, agents and favor on both sides.
 */
export type BotLevel = 'gentle' | 'easy' | 'medium' | 'hard';
export const BOT_LEVELS: Exclude<BotLevel, 'gentle'>[] = ['easy', 'medium', 'hard'];

/** Rough worth of an effect list, used to compare options. */
export function effectValue(list: Effect[]): number {
  let v = 0;
  for (const e of list) {
    switch (e.k) {
      case 'coin':
      case 'power':
        v += e.n;
        break;
      case 'prestige':
      case 'oppLosePrestige':
        v += e.n * 1.3;
        break;
      case 'draw':
        v += e.n * 1.5;
        break;
      case 'choice':
        v += Math.max(...e.options.map(effectValue));
        break;
      case 'setback':
        v -= e.n * (e.res === 'draw' ? 1.5 : 1);
        break;
      case 'knockoutAll':
      case 'bargain':
        v += 2;
        break;
      default:
        v += 'n' in e ? e.n : 2;
    }
  }
  return v;
}

/** How much the bot wants a card in its deck (low = junk). */
export function cardWorth(id: string): number {
  const def = cardDef(id);
  if (def.type === 'curse') return -1;
  if (id === 'gold') return 1;
  return Math.max(def.cost, effectValue(def.play));
}

/** Play order: curses must come first, then the strongest cards. */
const sortKey = (id: string) => (cardDef(id).type === 'curse' ? 100 : cardWorth(id));

const byWorth = (a: { cardId?: string }, b: { cardId?: string }) =>
  cardWorth(a.cardId ?? '') - cardWorth(b.cardId ?? '');

export function choose(s: GameState, pend: Pending): Action {
  const opts = [...pend.options];
  const take = (list: typeof opts, n: number) => list.slice(0, n).map((o) => o.ref);
  let picks: number[] = [];
  switch (pend.kind) {
    case 'choice': {
      const branches = pend.data as Effect[][];
      const p = s.players[pend.player];
      // Spend leftover-style: prefer coin early when cheap cards are around, else best value.
      let best = 0;
      let bestV = -Infinity;
      branches.forEach((b, i) => {
        const v = effectValue(b) + (b.some((e) => e.k === 'coin') && p.coin < 5 ? 0.5 : 0);
        if (v > bestV) [best, bestV] = [i, v];
      });
      picks = [best];
      break;
    }
    case 'acquire':
    case 'returnTop':
    case 'pelin':
    case 'knockout':
    case 'psijic':
    case 'confine':
    case 'reprieve':
    case 'bargain':
      opts.sort((a, b) => -byWorth(a, b));
      picks = take(opts, pend.max);
      break;
    case 'hlaalu': {
      // Sacrifice the priciest card played this turn, an agent only when nothing else is left.
      const agents = new Set(s.players[pend.player].agents.map((x) => x.uid));
      const rank = (o: (typeof opts)[number]) => cardDef(o.cardId!).cost - (agents.has(o.ref) ? 100 : 0);
      opts.sort((a, b) => rank(b) - rank(a));
      picks = take(opts, 1);
      break;
    }
    case 'toss':
    case 'donate':
      picks = opts.filter((o) => cardWorth(o.cardId!) <= 1).map((o) => o.ref).slice(0, pend.max);
      break;
    case 'destroy':
      // Thin the deck: curses, then starters already played this turn.
      opts.sort(byWorth);
      picks = opts
        .filter((o) => cardWorth(o.cardId!) < 0 || (cardWorth(o.cardId!) <= 1 && o.label.endsWith('(в игре)')))
        .map((o) => o.ref)
        .slice(0, pend.max);
      break;
    case 'treasury':
    case 'discard':
    case 'selfDiscard':
      opts.sort(byWorth);
      picks = take(opts, Math.max(pend.min, 1));
      break;
    case 'replaceTavern':
      picks = [];
      break;
    case 'heal':
      picks = take(opts, 1);
      break;
  }
  if (picks.length < pend.min) {
    for (const o of opts) if (picks.length < pend.min && !picks.includes(o.ref)) picks.push(o.ref);
  }
  return { t: 'choose', picks: picks.slice(0, pend.max) };
}

export function ownedPatronCount(s: GameState, pi: PlayerIdx, patron: string): number {
  const p = s.players[pi];
  const all: Card[] = [...p.deck, ...p.hand, ...p.played, ...p.cooldown, ...p.agents];
  return all.filter((c) => cardDef(c.id).patron === patron).length;
}

const DRAFT_PREF: PatronId[] = ['crows', 'eagle', 'hlaalu', 'pelin', 'psijic', 'rajhin'];

/** A number in [0, 1) that depends on the position only, so the bot needs no randomness of its own. */
export function noise(s: GameState, salt: number): number {
  return rngNext((s.rng ^ Math.imul(salt + s.nextUid + s.turn * 131, 0x9e3779b1)) | 0)[0];
}

/** Curses must come first, then cards that look at or draw from the deck, then the rest. */
export function playFirst(hand: Card[]): Card | undefined {
  const rank = (c: Card) => {
    const def = cardDef(c.id);
    if (def.type === 'curse') return 3;
    if (def.play.some((e) => e.k === 'toss')) return 2;
    if (def.play.some((e) => e.k === 'draw')) return 1;
    return 0;
  };
  return [...hand].sort((a, b) => rank(b) - rank(a) || sortKey(b.id) - sortKey(a.id))[0];
}

/** Picks the next action for the bot playing as `pi`, or null if it is not the bot's move. */
export function botAction(s: GameState, pi: PlayerIdx, level: BotLevel = 'medium'): Action | null {
  if (s.phase === 'over' || actingPlayer(s) !== pi) return null;
  if (level === 'hard') return hardAction(s, pi);
  if (level === 'easy') return easyAction(s, pi);
  return mediumAction(s, pi, level === 'gentle');
}

/**
 * The easy bot drafts at random, buys a random card it can afford and never calls patrons or attacks
 * agents beyond what the rules force.
 */
function easyAction(s: GameState, pi: PlayerIdx): Action {
  if (s.phase === 'draft') return { t: 'draft', patron: s.draftPool[Math.floor(noise(s, 1) * s.draftPool.length)] };
  if (s.pending) {
    if (s.pending.kind === 'choice') return { t: 'choose', picks: [Math.floor(noise(s, 2) * s.pending.options.length)] };
    return choose(s, s.pending);
  }
  const p = s.players[pi];
  const card = [...p.hand].sort((a, b) => sortKey(b.id) - sortKey(a.id))[0];
  if (card) return { t: 'play', uid: card.uid };
  const ready = p.agents.find((a) => !a.activated);
  if (ready) return { t: 'activate', uid: ready.uid };
  const affordable = s.tavern.filter((c) => cardDef(c.id).cost <= p.coin && cardDef(c.id).cost > 0);
  // Now and then it keeps its coins, as a beginner would.
  if (affordable.length && noise(s, 3) < 0.8) {
    return { t: 'buy', uid: affordable[Math.floor(noise(s, 4) * affordable.length)].uid };
  }
  return { t: 'end' };
}

/**
 * The medium bot, and with `gentle` the tutorial opponent, which drafts the tutorial patrons and never
 * calls patrons or attacks agents.
 */
export function mediumAction(s: GameState, pi: PlayerIdx, gentle = false): Action {
  if (s.phase === 'draft') {
    const pick = (gentle ? TUTORIAL_PATRONS : DRAFT_PREF).find((x) => s.draftPool.includes(x)) ?? s.draftPool[0];
    return { t: 'draft', patron: pick };
  }
  if (s.pending) return choose(s, s.pending);

  const p = s.players[pi];
  const opp = s.players[other(pi)];

  // 1. Play everything in hand, curses first as the rules demand.
  const playable = [...p.hand].sort((a, b) => sortKey(b.id) - sortKey(a.id));
  if (playable.length) return { t: 'play', uid: playable[0].uid };

  // 2. Use agents.
  const ready = p.agents.find((a) => !a.activated);
  if (ready) return { t: 'activate', uid: ready.uid };

  // 3. Buy the best affordable card.
  const affordable = s.tavern.filter((c) => cardDef(c.id).cost <= p.coin && cardDef(c.id).cost > 0);
  if (affordable.length) {
    const score = (c: Card) => cardDef(c.id).cost + 0.4 * ownedPatronCount(s, pi, cardDef(c.id).patron);
    affordable.sort((a, b) => score(b) - score(a));
    return { t: 'buy', uid: affordable[0].uid };
  }

  if (gentle) return { t: 'end' };

  // 4. Patrons.
  const can = (x: PatronId) => s.patrons.includes(x) && patronAvailable(s, pi, x);
  const junkInPlay = p.played.some((c) => cardWorth(c.id) <= 1);
  if (can('treasury') && junkInPlay) return { t: 'patron', patron: 'treasury' };
  if (can('psijic') && opp.agents.some((a) => cardDef(a.id).cost >= 4)) return { t: 'patron', patron: 'psijic' };
  if (can('hlaalu') && p.played.some((c) => cardDef(c.id).cost >= 4)) {
    return { t: 'patron', patron: 'hlaalu' };
  }
  if (can('eagle') && p.deck.length + p.cooldown.length > 0 && p.power >= 4) return { t: 'patron', patron: 'eagle' };
  if (can('pelin') && p.power >= 3) return { t: 'patron', patron: 'pelin' };
  if (can('rajhin')) return { t: 'patron', patron: 'rajhin' };
  if (can('crows') && p.coin >= 2) return { t: 'patron', patron: 'crows' };
  if (can('mora') && s.tavern.some((c) => cardDef(c.id).cost >= 5 && !cardDef(c.id).type.startsWith('contract'))) {
    return { t: 'patron', patron: 'mora' };
  }
  // Coins left after shopping are lost anyway, so spend them on the patrons that take coins.
  if (can('alessia')) return { t: 'patron', patron: 'alessia' };
  if (can('orgnum')) return { t: 'patron', patron: 'orgnum' };
  if (can('alma')) return { t: 'patron', patron: 'alma' };
  if (can('hunding') && s.tavern.some((c) => cardDef(c.id).cost === p.coin + 1)) return { t: 'patron', patron: 'hunding' };

  // 5. Knock out agents when it is cheap enough to be worth the lost prestige.
  if (p.power > 0) {
    const targets = attackable(s, pi)
      .filter((a) => hpLeft(a) <= p.power && (hpLeft(a) <= 3 || cardDef(a.id).cost >= 5))
      .sort((a, b) => cardDef(b.id).cost - cardDef(a.id).cost);
    if (targets.length) return { t: 'attack', uid: targets[0].uid };
  }

  return { t: 'end' };
}
