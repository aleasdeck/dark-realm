import { prestigeGoal, reachedGoal } from '../engine/engine';
import type { GameEvent, GameState, PlayerIdx } from '../engine/types';
import { still } from './motion';
import { agentHits, strikePause } from './moves';
import { esc, paintIcons } from './render';
import { play, type SoundName } from './sound';

/**
 * Turns state changes into sounds, a turn banner and the prestige goal notice. The opponent's moves
 * show as cards flying over the table (src/ui/motion.ts) and are told in the journal, not in pop-ups.
 * Lives outside #app so full re-renders don't restart its animations.
 */
const layer = document.createElement('div');
layer.className = 'fx-layer';
document.body.appendChild(layer);

export function clearFx() {
  layer.querySelectorAll('.turn-banner, .goal-notice').forEach((b) => b.remove());
  clearTimeout(bannerTimer);
  clearTimeout(goalTimer);
}

/** How long the prestige goal notice stays up; the turn banner waits for it. */
export const GOAL_MS = 2400;
let bannerTimer = 0;
let goalTimer = 0;

function banner(text: string, mine: boolean, delay = 0) {
  clearTimeout(bannerTimer);
  if (delay) {
    bannerTimer = window.setTimeout(() => banner(text, mine), delay);
    return;
  }
  layer.querySelectorAll('.turn-banner').forEach((b) => b.remove());
  const el = document.createElement('div');
  el.className = `turn-banner ${mine ? 'mine' : 'theirs'}`;
  el.textContent = text;
  layer.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

/** A player reached the prestige goal: a notice in the middle of the screen says who and what it means now. */
function goalNotice(goal: number, mine: boolean, name: string, delay = 0) {
  clearTimeout(goalTimer);
  if (delay) {
    goalTimer = window.setTimeout(() => goalNotice(goal, mine, name), delay);
    return;
  }
  layer.querySelectorAll('.goal-notice').forEach((b) => b.remove());
  const el = document.createElement('div');
  el.className = `goal-notice ${mine ? 'mine' : 'theirs'}`;
  el.style.setProperty('--goal-ms', `${GOAL_MS}ms`);
  el.innerHTML = `<div class="gn-box">
    <div class="gn-num">${paintIcons(`${goal} ✦`)}</div>
    <h3>${mine ? `Вы набрали ${goal} престижа` : `${esc(name)}: ${goal} престижа`}</h3>
    <p>${mine ? 'Если соперник не догонит вас за свой ход, победа ваша' : 'Догоните соперника за свой ход, иначе поражение'}</p>
  </div>`;
  layer.appendChild(el);
  el.addEventListener('animationend', (ev) => ev.target === el && el.remove());
}

const SOUND: Record<GameEvent['k'], SoundName> = {
  draft: 'draft',
  play: 'card',
  activate: 'agent',
  buy: 'coin',
  gain: 'coin',
  attack: 'hit',
  knockout: 'knockout',
  patron: 'patron',
  cancel: 'click',
  unplay: 'click',
  destroy: 'destroy',
  discard: 'discard',
  prestige: 'prestige',
  turn: 'myTurn',
  win: 'win',
};

export function onStateChange(prev: GameState | null, next: GameState, me: PlayerIdx) {
  if (!prev || prev === next) return;
  const sounds = new Set<SoundName>();
  // Reaching the goal is told first; the turn banner of the same move comes after it.
  const reached = next.phase === 'play' ? reachedGoal(prev, next) : [];
  // Both wait while power hits agents (leftover power going into taunting agents at the end of a turn).
  const pause = still() ? 0 : strikePause(agentHits(prev, next).length);
  for (const pi of reached) goalNotice(prestigeGoal(next), pi === me, next.players[pi].name, pause);
  for (const e of next.events ?? []) {
    let snd = SOUND[e.k];
    if (e.k === 'turn') {
      snd = e.p === me ? 'myTurn' : 'theirTurn';
      if (next.phase === 'play') banner(e.p === me ? 'Ваш ход' : 'Ход соперника', e.p === me, pause + (reached.length ? GOAL_MS - 300 : 0));
    } else if (e.k === 'win') {
      snd = e.p === me ? 'win' : 'lose';
    }
    sounds.add(snd);
  }
  if (next.pending?.player === me && prev.pending?.player !== me && next.phase === 'play') sounds.add('choose');
  // Win and turn sounds win over the small ones fired by the same action.
  if (sounds.has('win') || sounds.has('lose')) return play(sounds.has('win') ? 'win' : 'lose');
  let delay = 0;
  for (const s of sounds) {
    setTimeout(() => play(s), delay);
    delay += 110;
  }
}
