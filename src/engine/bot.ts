import { cardDef } from './cards';
import { actingPlayer, attackable, hpLeft, other, patronAvailable } from './engine';
import type { Action, Card, Effect, GameState, Pending, PatronId, PlayerIdx } from './types';

/** Rough worth of an effect list, used to compare options. */
function effectValue(list: Effect[]): number {
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
      default:
        v += 'n' in e ? e.n : 2;
    }
  }
  return v;
}

/** How much the bot wants a card in its deck (low = junk). */
function cardWorth(id: string): number {
  const def = cardDef(id);
  if (def.type === 'curse') return -1;
  if (id === 'gold') return 1;
  return Math.max(def.cost, effectValue(def.play));
}

const byWorth = (a: { cardId?: string }, b: { cardId?: string }) =>
  cardWorth(a.cardId ?? '') - cardWorth(b.cardId ?? '');

function choose(s: GameState, pend: Pending): Action {
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
      opts.sort((a, b) => -byWorth(a, b));
      picks = take(opts, pend.max);
      break;
    case 'hlaalu':
      opts.sort((a, b) => cardDef(b.cardId!).cost - cardDef(a.cardId!).cost);
      picks = take(opts, 1);
      break;
    case 'toss':
    case 'donate':
      picks = opts.filter((o) => cardWorth(o.cardId!) <= 1).map((o) => o.ref).slice(0, pend.max);
      break;
    case 'destroy':
      picks = opts.filter((o) => cardWorth(o.cardId!) < 0).map((o) => o.ref).slice(0, pend.max);
      break;
    case 'treasury':
    case 'discard':
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

function ownedPatronCount(s: GameState, pi: PlayerIdx, patron: string): number {
  const p = s.players[pi];
  const all: Card[] = [...p.deck, ...p.hand, ...p.played, ...p.cooldown, ...p.agents];
  return all.filter((c) => cardDef(c.id).patron === patron).length;
}

const DRAFT_PREF: PatronId[] = ['crows', 'eagle', 'hlaalu', 'pelin', 'psijic', 'rajhin'];

/**
 * Picks the next action for the bot playing as `pi`, or null if it is not the bot's move.
 * A gentle bot (the tutorial opponent) never calls patrons or attacks agents.
 */
export function botAction(s: GameState, pi: PlayerIdx, gentle = false): Action | null {
  if (s.phase === 'over' || actingPlayer(s) !== pi) return null;
  if (s.phase === 'draft') {
    const pick = DRAFT_PREF.find((x) => s.draftPool.includes(x)) ?? s.draftPool[0];
    return { t: 'draft', patron: pick };
  }
  if (s.pending) return choose(s, s.pending);

  const p = s.players[pi];
  const opp = s.players[other(pi)];

  // 1. Play everything in hand.
  const playable = [...p.hand].sort((a, b) => cardWorth(b.id) - cardWorth(a.id));
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
  const junkInPlay = [...p.played, ...p.cooldown].some((c) => cardWorth(c.id) < 0);
  if (can('treasury') && junkInPlay) return { t: 'patron', patron: 'treasury' };
  if (can('psijic') && opp.agents.some((a) => cardDef(a.id).cost >= 4)) return { t: 'patron', patron: 'psijic' };
  if (can('hlaalu') && [...p.played, ...p.cooldown].some((c) => cardDef(c.id).cost >= 4)) {
    return { t: 'patron', patron: 'hlaalu' };
  }
  if (can('eagle') && p.deck.length + p.cooldown.length > 0 && p.power >= 4) return { t: 'patron', patron: 'eagle' };
  if (can('pelin') && p.power >= 3) return { t: 'patron', patron: 'pelin' };
  if (can('rajhin')) return { t: 'patron', patron: 'rajhin' };
  if (can('crows') && p.coin >= 2) return { t: 'patron', patron: 'crows' };

  // 5. Knock out agents when it is cheap enough to be worth the lost prestige.
  if (p.power > 0) {
    const targets = attackable(s, pi)
      .filter((a) => hpLeft(a) <= p.power && (hpLeft(a) <= 3 || cardDef(a.id).cost >= 5))
      .sort((a, b) => cardDef(b.id).cost - cardDef(a.id).cost);
    if (targets.length) return { t: 'attack', uid: targets[0].uid };
  }

  return { t: 'end' };
}
