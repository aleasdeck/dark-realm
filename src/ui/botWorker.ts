/// <reference lib="webworker" />
import { botAction, type BotLevel } from '../engine/bot';
import type { GameState, PlayerIdx } from '../engine/types';

/** Runs the bot off the main thread, so the hard bot's lookahead never freezes the table. */
self.onmessage = (e: MessageEvent<{ id: number; state?: GameState; pi: PlayerIdx; level: BotLevel }>) => {
  const { id, state, pi, level } = e.data;
  // A message without a state only checks that the worker is up (warmBot).
  self.postMessage({ id, action: state ? botAction(state, pi, level) : null });
};
