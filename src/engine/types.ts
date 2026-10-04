export type PatronId = 'crows' | 'hlaalu' | 'pelin' | 'psijic' | 'rajhin' | 'eagle' | 'treasury';
export type Owner = PatronId | 'neutral';
export type PlayerIdx = 0 | 1;

/** Atomic card/patron effects. `n` is always a non-negative amount. */
export type Effect =
  | { k: 'coin'; n: number }
  | { k: 'power'; n: number }
  | { k: 'prestige'; n: number }
  | { k: 'oppLosePrestige'; n: number }
  | { k: 'draw'; n: number }
  /** Opponent discards n cards at the start of their next turn. */
  | { k: 'oppDiscard'; n: number }
  /** Take a card costing up to n from the tavern for free. */
  | { k: 'acquire'; n: number }
  /** Look at the top n cards of your deck, send any of them to cooldown. */
  | { k: 'toss'; n: number }
  /** Remove up to n cards in play or in your cooldown from the game. */
  | { k: 'destroy'; n: number }
  /** Knock out up to n opponent agents. */
  | { k: 'knockout'; n: number }
  | { k: 'knockoutAll' }
  /** Put up to n cards from your cooldown on top of your deck. */
  | { k: 'returnTop'; n: number; agentsOnly?: boolean }
  /** Replace up to n tavern cards. */
  | { k: 'replaceTavern'; n: number }
  /** Heal one of your agents by n. */
  | { k: 'heal'; n: number }
  | { k: 'create'; card: string; n: number; to: 'oppCooldown' | 'cooldown' | 'hand' }
  | { k: 'patronCall'; n: number }
  /** Move up to n cards from hand to cooldown and draw as many. */
  | { k: 'donate'; n: number }
  | { k: 'choice'; options: Effect[][] };

export type CardType = 'action' | 'agent' | 'contractAction' | 'contractAgent' | 'starter' | 'curse';

export interface CardDef {
  id: string;
  name: string;
  patron: Owner;
  cost: number;
  type: CardType;
  /** Agent durability. */
  hp?: number;
  taunt?: boolean;
  /** Copies in the tavern deck. */
  copies: number;
  play: Effect[];
  combo?: Partial<Record<2 | 3 | 4, Effect[]>>;
  /** Art subject key (see src/art). */
  art: string;
  seed?: number;
  flavor?: string;
}

export interface PatronDef {
  id: PatronId;
  name: string;
  title: string;
  palette: { bg1: string; bg2: string; accent: string; glow: string };
}

export interface Card {
  uid: number;
  id: string;
}

export interface AgentInPlay extends Card {
  dmg: number;
  activated: boolean;
}

export interface PlayerState {
  name: string;
  deck: Card[]; // index 0 = top
  hand: Card[];
  played: Card[];
  cooldown: Card[];
  agents: AgentInPlay[];
  coin: number;
  power: number;
  prestige: number;
  pendingDiscard: number;
}

export interface PendingOption {
  label: string;
  /** Card uid or index, interpreted per pending kind. */
  ref: number;
  cardId?: string;
}

export type PendingKind =
  | 'choice'
  | 'acquire'
  | 'toss'
  | 'destroy'
  | 'knockout'
  | 'returnTop'
  | 'replaceTavern'
  | 'heal'
  | 'donate'
  | 'discard'
  | 'hlaalu'
  | 'treasury'
  | 'pelin'
  | 'psijic';

export interface Pending {
  player: PlayerIdx;
  kind: PendingKind;
  prompt: string;
  options: PendingOption[];
  min: number;
  max: number;
  /** Extra data the resolver needs (e.g. choice branches, heal amount). */
  data?: unknown;
}

export interface QueuedEffect {
  e: Effect;
  player: PlayerIdx;
}

export interface TurnPlay {
  id: string;
  patron: Owner;
  fired: number[];
}

export interface GameState {
  phase: 'draft' | 'play' | 'over';
  rng: number;
  nextUid: number;
  players: [PlayerState, PlayerState];
  current: PlayerIdx;
  turn: number;
  /** Drafted patrons (4) + treasury, in display order. */
  patrons: PatronId[];
  draftPool: PatronId[];
  draftStep: number;
  /** null = neutral, otherwise the favored player. */
  favor: Partial<Record<PatronId, PlayerIdx | null>>;
  patronCalls: number;
  patronsUsed: PatronId[];
  tavernDeck: Card[];
  tavern: Card[];
  queue: QueuedEffect[];
  pending: Pending | null;
  turnPlays: TurnPlay[];
  log: string[];
  winner: PlayerIdx | null;
  winReason: string;
}

export type Action =
  | { t: 'draft'; patron: PatronId }
  | { t: 'play'; uid: number }
  | { t: 'activate'; uid: number }
  | { t: 'attack'; uid: number }
  | { t: 'buy'; uid: number }
  | { t: 'patron'; patron: PatronId }
  | { t: 'choose'; picks: number[] }
  | { t: 'end' }
  | { t: 'concede' };
