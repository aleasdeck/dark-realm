import { BOT_LEVELS, type BotLevel } from '../engine/bot';
import type { GameState } from '../engine/types';

/*
 * The last unfinished game against the bot, kept in localStorage after every move, so
 * the «Играть» menu can offer «Продолжить игру» after a reload or a closed tab. One game at
 * a time: a new one takes its place, and a finished one is forgotten. The tutorial isn't kept.
 */

export interface SavedBotGame {
  level: BotLevel;
  state: GameState;
  at: number;
}

const KEY = 'dr-bot-game';

export function saveBotGame(level: BotLevel, state: GameState) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ level, state, at: Date.now() } satisfies SavedBotGame));
  } catch {
    /* storage unavailable or full: the game just won't survive a reload */
  }
}

export function forgetBotGame() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

/** The game to continue, if one was left unfinished. */
export function savedBotGame(): SavedBotGame | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as SavedBotGame;
    if (!(BOT_LEVELS as BotLevel[]).includes(g.level) || (g.state?.phase !== 'draft' && g.state?.phase !== 'play')) return null;
    return g;
  } catch {
    return null;
  }
}
