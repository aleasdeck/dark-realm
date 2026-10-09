import { applyAction, createGame } from './engine';
import { cardDef } from './cards';
import type { GameState, PatronId, PlayerIdx, ScriptId } from './types';

/** The tutorial opponent, a mocking vagrant who still says exactly what to do. */
export const TUTORIAL_OPPONENT = 'Бродяга';

/** Both tutorials are dealt the same every time; the director stacks the rest. */
export const TUTORIAL_SEED = 11;

export interface Lesson {
  /** Patrons in draft order: the player, the opponent twice, the player again. */
  patrons: PatronId[];
  goal: number;
  instant: number;
  /** Cards that open the tavern. */
  tavern: string[];
  /** The player drafts with the coach; otherwise the patrons are drafted before the game opens. */
  draft: boolean;
}

export const LESSONS: Record<ScriptId, Lesson> = {
  // The basics: Wolf and Crow for the player, Rat and Eagle for the vagrant; a win at 20 on the fifth turn.
  basic: {
    patrons: ['pelin', 'hlaalu', 'eagle', 'crows'],
    goal: 20,
    instant: 20,
    tavern: ['hlaalu_exports', 'pelin_portcullis', 'pelin_legion', 'pelin_reinforce', 'crows_brigand'],
    draft: false,
  },
  // The advanced game: Rat and Eagle for the player, Wolf and Cat for the vagrant; 20, and he gets a reply.
  advanced: {
    patrons: ['hlaalu', 'pelin', 'rajhin', 'eagle'],
    goal: 20,
    instant: 40,
    tavern: ['eagle_bonfire', 'hlaalu_exports', 'pelin_portcullis', 'rajhin_sleight', 'eagle_raid'],
    draft: true,
  },
};

/**
 * Everything the vagrant does on a turn besides playing his cards and using his agents, tried in order.
 * A purchase names a card, or takes the cheapest action (`cheap`) or the action with the most power (`power`).
 */
export type BotStep = { buy: string } | { patron: PatronId } | { attack: string };

export const BOT_PLAN: Record<ScriptId, Record<number, BotStep[]>> = {
  // His agent first, then a card with power each turn to keep up; the last purchase makes room for the final contract.
  basic: {
    2: [{ buy: 'crows_brigand' }],
    4: [{ buy: 'power' }],
    6: [{ buy: 'power' }],
    8: [{ buy: 'power' }],
  },
  // The curse for the player, coins for the shield, the shield; then he knocks out the player's
  // agent and takes the Eagle, plays the bag of tricks, and only then goes for prestige.
  advanced: {
    2: [{ patron: 'rajhin' }],
    4: [{ buy: 'rajhin_sleight' }, { buy: 'pelin_portcullis' }],
    6: [{ buy: 'pelin_bearer' }],
    8: [{ attack: 'eagle_hunter' }, { patron: 'eagle' }, { buy: 'hlaalu_exports' }],
    10: [{ buy: 'rajhin_tricks' }, { buy: 'power' }],
    12: [{ buy: 'rajhin_tricks' }, { buy: 'power' }],
    14: [{ buy: 'power' }],
    16: [{ buy: 'power' }],
  },
};

/** A tutorial game; the basics start straight on the table, the advanced one with the draft. */
export function createTutorialGame(name: string, lesson: ScriptId = 'basic', seed = TUTORIAL_SEED): GameState {
  const l = LESSONS[lesson];
  let s = createGame(seed, [name, TUTORIAL_OPPONENT], {
    goal: l.goal,
    instant: l.instant,
    pool: l.patrons,
    tavernTop: l.tavern,
    script: lesson,
  });
  if (!l.draft) {
    for (const [i, patron] of l.patrons.entries()) s = applyAction(s, i === 0 || i === 3 ? 0 : 1, { t: 'draft', patron });
    s.log = s.log.filter((line) => !line.includes('выбирает владыку'));
    s.events = [];
  }
  return s;
}

/** What the vagrant tells the player to buy in the advanced game once its lessons are past: dear Rat cards, then power. */
const ADVICE = ['hlaalu_exchange', 'hlaalu_market', 'eagle_raid', 'pelin_siege', 'pelin_armory', 'pelin_volley', 'pelin_legion', 'pelin_portcullis', 'hlaalu_exports'];

/** The card the vagrant points the player at in the tavern, if one is on offer and affordable. */
export function suggestBuy(s: GameState, me: PlayerIdx): string | null {
  const coin = s.players[me].coin;
  return ADVICE.find((id) => s.tavern.some((c) => c.id === id) && cardDef(id).cost <= coin) ?? null;
}
