/*
 * Bot against bot, for tuning the levels: plays games between two levels, seats alternating, with every
 * patron in the draft, and prints the first level's win rate and how the games ended.
 *
 *   npx rolldown scripts/duel.ts --platform node --format esm -o /tmp/duel.mjs
 *   node /tmp/duel.mjs hard medium 100 [first seed]
 *
 * TUNE='{"deck":1.2}' overrides the hard bot's weights (see TUNE in src/engine/botHard.ts).
 */
import { botAction, type BotLevel } from '../src/engine/bot';
import { DRAFTABLE, LOCKED } from '../src/engine/cards';
import { actingPlayer, applyAction, createGame } from '../src/engine/engine';
import { TUNE } from '../src/engine/botHard';

Object.assign(TUNE, JSON.parse(process.env.TUNE ?? '{}'));

const [a = 'hard', b = 'medium', n = '100', start = '1'] = process.argv.slice(2);
let wins = 0;
const reasons: Record<string, number> = {};
let turns = 0;
const t0 = Date.now();
for (let g = 0; g < Number(n); g++) {
  const seed = Number(start) + g;
  const levels: BotLevel[] = g % 2 ? [b as BotLevel, a as BotLevel] : [a as BotLevel, b as BotLevel];
  let s = createGame(seed * 7919, ['0', '1'], { pool: [...DRAFTABLE, ...LOCKED] });
  for (let i = 0; i < 5000 && s.phase !== 'over'; i++) {
    const pi = actingPlayer(s);
    s = applyAction(s, pi, botAction(s, pi, levels[pi])!);
  }
  const aSeat = g % 2 ? 1 : 0;
  if (s.winner === aSeat) wins++;
  const r = (s.winner === aSeat ? a : b) + ':' + s.winReason;
  reasons[r] = (reasons[r] ?? 0) + 1;
  turns += s.turn;
}
console.log(`${a} vs ${b}: ${wins}/${n} (${((100 * wins) / Number(n)).toFixed(0)}%), avg turns ${(turns / Number(n)).toFixed(1)}, ${((Date.now() - t0) / Number(n)).toFixed(0)} ms/game`);
console.log(reasons);
