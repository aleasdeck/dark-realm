import { cardDef, PATRONS } from '../engine/cards';
import { actingPlayer, prestigeGoal, reachedGoal } from '../engine/engine';
import type { GameEvent, GameState, PlayerIdx } from '../engine/types';
import { still } from './motion';
import { agentHits, strikePause } from './moves';
import { cardArt, esc, paintIcons, patronEmblem } from './render';
import { play, type SoundName } from './sound';

/**
 * Turns state changes into sounds, a turn banner, the prestige goal notice and a feed of the opponent's moves.
 * Lives outside #app so full re-renders don't restart its animations.
 */
const layer = document.createElement('div');
layer.className = 'fx-layer';
document.body.appendChild(layer);
const feed = document.createElement('div');
feed.className = 'feed';
layer.appendChild(feed);

const FEED_MS = 3600;
const FEED_MAX = 4;

export function clearFx() {
  feed.innerHTML = '';
  layer.querySelectorAll('.turn-banner, .goal-notice').forEach((b) => b.remove());
  clearTimeout(bannerTimer);
  clearTimeout(goalTimer);
}

/** Clears the opponent's moves once they can't be missed, so they don't cover the hand on your turn. */
function fadeFeed(after: number) {
  for (const el of [...feed.children]) {
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
    }, after);
  }
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

function feedItem(img: string | null, html: string) {
  const el = document.createElement('div');
  el.className = 'feed-item';
  el.innerHTML = `${img ? `<img src="${img}" alt="">` : ''}<span>${html}</span>`;
  feed.appendChild(el);
  while (feed.children.length > FEED_MAX) feed.firstElementChild!.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, FEED_MS);
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
  destroy: 'destroy',
  discard: 'discard',
  prestige: 'prestige',
  turn: 'myTurn',
  win: 'win',
};

const q = (s: string) => `<b>«${esc(s)}»</b>`;

/** Feed line for a move the opponent made, or null when it isn't worth showing. */
function describe(e: GameEvent, me: PlayerIdx): [string | null, string] | null {
  switch (e.k) {
    case 'draft':
      return [patronEmblem(e.patron), `выбирает покровителя ${q(PATRONS[e.patron].name)}`];
    case 'play':
      return [cardArt(cardDef(e.card)), `разыгрывает ${q(cardDef(e.card).name)}`];
    case 'activate':
      return [cardArt(cardDef(e.card)), `применяет агента ${q(cardDef(e.card).name)}`];
    case 'buy':
      return [cardArt(cardDef(e.card)), `покупает ${q(cardDef(e.card).name)}`];
    case 'gain':
      return [cardArt(cardDef(e.card)), `получает ${q(cardDef(e.card).name)}`];
    case 'attack':
      return [cardArt(cardDef(e.card)), `атакует вашего агента ${q(cardDef(e.card).name)}: <em class="bad">−${e.n}</em>`];
    case 'knockout':
      return e.p === me ? [cardArt(cardDef(e.card)), `<em class="bad">Ваш агент ${q(cardDef(e.card).name)} сражён</em>`] : null;
    case 'patron':
      return [patronEmblem(e.patron), `взывает к покровителю ${q(PATRONS[e.patron].name)}`];
    case 'cancel':
      return [patronEmblem(e.patron), `передумывает взывать к ${q(PATRONS[e.patron].name)}`];
    case 'destroy':
      return [cardArt(cardDef(e.card)), `уничтожает ${q(cardDef(e.card).name)}`];
    case 'discard':
      return [null, `сбрасывает ${e.n} карт(ы)`];
    case 'prestige':
      return [null, `получает ${paintIcons(`+${e.n} ✦`)}`];
    default:
      return null;
  }
}

export function onStateChange(prev: GameState | null, next: GameState, me: PlayerIdx) {
  if (!prev || prev === next) return;
  const actor = actingPlayer(prev);
  const byThem = actor !== me;
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
      if (e.p === me) fadeFeed(1200);
    } else if (e.k === 'win') {
      snd = e.p === me ? 'win' : 'lose';
    }
    sounds.add(snd);
    if (byThem && e.p === actor) {
      const line = describe(e, me);
      if (line) feedItem(line[0], `${esc(next.players[actor].name)} ${line[1]}`);
    } else if (byThem && e.k === 'knockout') {
      const line = describe(e, me);
      if (line) feedItem(line[0], line[1]);
    }
  }
  const lost = prev.players[me].prestige - next.players[me].prestige;
  if (byThem && lost > 0 && next.phase === 'play') feedItem(null, `<em class="bad">${paintIcons(`Вы теряете ${lost} ✦`)}</em>`);
  if (next.pending?.player === me && prev.pending?.player !== me && next.phase === 'play') {
    sounds.add('choose');
    if (byThem || next.current !== me) feedItem(null, esc(next.pending.prompt));
  }
  // Win and turn sounds win over the small ones fired by the same action.
  if (sounds.has('win') || sounds.has('lose')) return play(sounds.has('win') ? 'win' : 'lose');
  let delay = 0;
  for (const s of sounds) {
    setTimeout(() => play(s), delay);
    delay += 110;
  }
}
