import type { GameState, PlayerIdx } from '../engine/types';

/** Where a card can be. Cards that left the game (or were never in it) are `gone`. */
export type Zone = 'hand' | 'deck' | 'cd' | 'played' | 'agents' | 'confined' | 'tavern' | 'tdeck' | 'gone';

export interface Place {
  zone: Zone;
  /** Owner of the zone; null for the tavern and for cards out of the game. */
  p: PlayerIdx | null;
  /** Position in the zone (hand order matters for the opponent's card backs). */
  i: number;
  /** For confined cards: the agent holding them. */
  holder?: number;
}

export interface Move {
  uid: number;
  id: string;
  from: Place;
  to: Place;
}

const GONE: Place = { zone: 'gone', p: null, i: 0 };

/** Where every card of the game is. */
export function places(s: GameState): Map<number, Place & { id: string }> {
  const at = new Map<number, Place & { id: string }>();
  s.players.forEach((pl, pi) => {
    const p = pi as PlayerIdx;
    const put = (cards: { uid: number; id: string }[], zone: Zone) => cards.forEach((c, i) => at.set(c.uid, { id: c.id, zone, p, i }));
    put(pl.hand, 'hand');
    put(pl.deck, 'deck');
    put(pl.cooldown, 'cd');
    put(pl.played, 'played');
    put(pl.agents, 'agents');
    for (const a of pl.agents) a.confined?.forEach((c, i) => at.set(c.uid, { id: c.id, zone: 'confined', p, i, holder: a.uid }));
  });
  s.tavern.forEach((c, i) => at.set(c.uid, { id: c.id, zone: 'tavern', p: null, i }));
  s.tavernDeck.forEach((c, i) => at.set(c.uid, { id: c.id, zone: 'tdeck', p: null, i }));
  return at;
}

/** Cards that changed zone (or owner) between two states, in uid order. */
export function cardMoves(prev: GameState, next: GameState): Move[] {
  const a = places(prev);
  const b = places(next);
  const moves: Move[] = [];
  const uids = new Set([...a.keys(), ...b.keys()]);
  for (const uid of [...uids].sort((x, y) => x - y)) {
    const from = a.get(uid);
    const to = b.get(uid);
    if (from && to && from.zone === to.zone && from.p === to.p && from.holder === to.holder) continue;
    const id = (to ?? from)!.id;
    moves.push({ uid, id, from: from ? strip(from) : GONE, to: to ? strip(to) : GONE });
  }
  return moves;
}

function strip(p: Place & { id: string }): Place {
  const { id: _, ...rest } = p;
  return rest;
}
