export type PatronId =
  | 'crows'
  | 'hlaalu'
  | 'pelin'
  | 'psijic'
  | 'rajhin'
  | 'eagle'
  | 'alma'
  | 'hunding'
  | 'druid'
  | 'mora'
  | 'alessia'
  | 'orgnum'
  | 'treasury';
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
  /** Knock out every agent on the table, yours included. */
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
  | { k: 'choice'; options: Effect[][] }
  /** Put up to n cards from the opponent's cooldown under this agent until it leaves play. */
  | { k: 'confine'; n: number }
  /** The opponent gains this at the start of their next turn. */
  | { k: 'setback'; res: 'coin' | 'power' | 'draw'; n: number }
  /** Look at the top n cards of the opponent's deck and send one of them to their cooldown. */
  | { k: 'reprieve'; n: number }
  /** Take any non-contract card from the tavern; the opponent gets a copy. */
  | { k: 'bargain' }
  /** Discard n cards from your own hand (a patron's price). */
  | { k: 'selfDiscard'; n: number };

/**
 * "While in play" events: a card in play (played this turn or an agent on the table)
 * reacts when its owner discards, a card or an agent goes to their cooldown,
 * an agent is played or activated, or any other agent is knocked out.
 */
export type TriggerOn = 'discard' | 'toCooldown' | 'agentToCooldown' | 'agentPlay' | 'knockout';

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
  /** "While in play" reaction; `self` lets the card react to its own move to the cooldown. */
  trigger?: { on: TriggerOn; fx: Effect[]; self?: boolean };
  /** Starts in every deck when its patron is drafted (for starters that are not of the starter type). */
  starter?: boolean;
}

export interface PatronDef {
  id: PatronId;
  name: string;
  title: string;
  /** Not in the draft until the player unlocks it. */
  locked?: boolean;
  palette: { bg1: string; bg2: string; accent: string; glow: string };
}

export interface Card {
  uid: number;
  id: string;
}

export interface AgentInPlay extends Card {
  dmg: number;
  activated: boolean;
  /** Opponent cards held under this agent; they go back to the opponent's cooldown when it leaves. */
  confined?: Card[];
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
  /** Setbacks the opponent caused: gained at the start of this player's next turn. */
  boon?: { coin: number; power: number; draw: number };
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
  | 'psijic'
  | 'confine'
  | 'reprieve'
  | 'bargain'
  | 'selfDiscard';

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
  /** uid of the card the effect came from. */
  src?: number;
}

export interface TurnPlay {
  id: string;
  uid?: number;
  patron: Owner;
  fired: number[];
}

/** What happened during the last applied action, for sounds and the opponent feed. */
export type GameEvent =
  | { k: 'draft'; p: PlayerIdx; patron: PatronId }
  | { k: 'play' | 'activate' | 'buy' | 'gain' | 'destroy'; p: PlayerIdx; card: string }
  | { k: 'attack'; p: PlayerIdx; card: string; n: number }
  | { k: 'knockout'; p: PlayerIdx; card: string }
  | { k: 'patron'; p: PlayerIdx; patron: PatronId }
  | { k: 'discard'; p: PlayerIdx; n: number }
  | { k: 'prestige'; p: PlayerIdx; n: number }
  | { k: 'turn'; p: PlayerIdx }
  | { k: 'win'; p: PlayerIdx };

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
  /** Events of the last applied action (cleared by every applyAction). */
  events: GameEvent[];
  winner: PlayerIdx | null;
  winReason: string;
  /** Prestige targets when they differ from the standard ones (the short tutorial game). */
  goal?: number;
  instant?: number;
  /** Turn on which the Druid patron last handed out its Chimera. */
  chimeraTurn?: number;
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
