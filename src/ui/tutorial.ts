import { attackable, other } from '../engine/engine';
import { TUTORIAL_GOAL } from '../engine/tutorial';
import type { GameState, PlayerIdx } from '../engine/types';

/** One coach hint: what it points at, what it says, and when it is no longer needed. */
export interface Hint {
  id: string;
  /** Selector of the part of the table to light up; none for a hint about the whole screen. */
  target?: string;
  text: string;
  /** Shows an "OK" button; otherwise the hint waits for the action it asks for. */
  ok?: boolean;
  /** Pin the bubble to the top of the screen (above choice sheets). */
  top?: boolean;
}

interface Step extends Hint {
  /** The hint has nothing left to say. */
  done: (s: GameState, me: PlayerIdx) => boolean;
  /** Optional hints show once, the first time their situation comes up. */
  when?: (s: GameState, me: PlayerIdx) => boolean;
}

const myTurn = (s: GameState, me: PlayerIdx) => s.phase === 'play' && s.current === me;
const idle = (s: GameState, me: PlayerIdx) => myTurn(s, me) && !s.pending && s.queue.length === 0;
const firstTurnOver = (s: GameState) => s.turn > 1;

/** The first turn, walked through in order. */
const SCRIPT: Step[] = [
  {
    id: 'goal',
    target: '.my-bar .res.pre',
    text: `Добро пожаловать в Dark Realm. Побеждает тот, кто наберёт ${TUTORIAL_GOAL} престижа ✦. В обычной партии нужно 40.`,
    ok: true,
    done: firstTurnOver,
  },
  {
    id: 'hand',
    target: '.hand',
    text: 'Это ваша рука. Нажмите на карту, она увеличится. Нажмите ещё раз, чтобы сыграть её.',
    done: (s, me) => firstTurnOver(s) || s.players[me].hand.length < 5,
  },
  {
    id: 'resources',
    target: '.my-bar .res-group',
    text: 'Карты дают монеты ● и силу ⚔. Монеты тратятся в таверне, а сила в конце хода превращается в престиж ✦.',
    ok: true,
    done: firstTurnOver,
  },
  {
    id: 'play-all',
    target: '.hand',
    text: 'Сыграйте остальные карты. Кнопка ▶▶ внизу сыграет их все разом.',
    done: (s, me) => firstTurnOver(s) || s.players[me].hand.length === 0,
  },
  {
    id: 'tavern',
    target: '.tavern',
    text: 'В таверне покупают карты за монеты ●. Яркие вам по карману: нажмите на карту дважды, чтобы купить. Покупка ляжет в сброс и придёт в руку позже.',
    ok: true,
    done: (s, me) => firstTurnOver(s) || s.players[me].cooldown.length > 0 || s.players[me].agents.length > 0,
  },
  {
    id: 'patrons',
    target: '.patrons',
    text: 'Покровители. Раз в ход можно воззвать к одному из них: заплатить цену и получить эффект. Он склонится к вам, а если все на вашей стороне в конце хода, вы победили.',
    ok: true,
    done: firstTurnOver,
  },
  {
    id: 'end',
    target: '.my-bar .end',
    text: 'Нажмите «Конец хода». Сила ⚔ станет престижем ✦, и вы возьмёте 5 новых карт.',
    done: firstTurnOver,
  },
  {
    id: 'their-turn',
    target: '.opp-bar',
    text: 'Теперь ходит соперник. Его карты появляются на столе, а полный список ходов есть в журнале (меню ☰).',
    done: (s, me) => s.turn > 2 && myTurn(s, me),
  },
  {
    id: 'free',
    text: `Основы вы знаете. Наберите ${TUTORIAL_GOAL} престижа ✦ раньше соперника. Подсказки появятся, когда случится что-то новое.`,
    ok: true,
    done: () => false,
  },
];

/** Hints for situations that come up on their own, shown the first time only. */
const EVENTS: Step[] = [
  {
    id: 'choice',
    text: 'Карта предлагает выбор. Нажмите на нужный вариант.',
    top: true,
    ok: true,
    when: (s, me) => s.pending?.player === me,
    done: (s, me) => s.pending?.player !== me,
  },
  {
    id: 'combo',
    target: '.my-table .played-part',
    text: 'Комбо! Две карты одного покровителя за ход включают бонус из строки «Комбо 2». Он срабатывает сам.',
    ok: true,
    when: (s, me) => myTurn(s, me) && s.turnPlays.some((p) => p.fired.length > 0),
    done: (s, me) => !myTurn(s, me),
  },
  {
    id: 'my-agent',
    target: '.my-table .agents',
    text: 'Ваш агент остаётся на столе. Каждый ход нажмите на него дважды, чтобы он снова сработал.',
    ok: true,
    when: (s, me) => idle(s, me) && s.players[me].agents.some((a) => !a.activated),
    done: (s, me) => !myTurn(s, me) || s.players[me].agents.every((a) => a.activated),
  },
  {
    id: 'attack',
    target: '.opp-agents',
    text: 'У соперника агент, а у вас есть сила ⚔. Нажмите на агента дважды, чтобы ударить. Агентов с провокацией бьют первыми.',
    ok: true,
    when: (s, me) => idle(s, me) && s.players[me].power > 0 && attackable(s, me).length > 0,
    done: (s, me) => !idle(s, me) || s.players[me].power === 0 || s.players[other(me)].agents.length === 0,
  },
];

/** Walks the player through the first turn, then explains new situations as they come up. */
export class Coach {
  private step = 0;
  /** Event hints already shown (or skipped); `active` is the one on screen. */
  private seen = new Set<string>();
  private active: Step | null = null;
  off = false;

  /** The hint to show for this state, or null. */
  hint(s: GameState, me: PlayerIdx): Hint | null {
    if (this.off || s.phase !== 'play') return null;
    if (this.active && this.active.done(s, me)) this.active = null;
    if (!this.active) {
      const ev = EVENTS.find((e) => !this.seen.has(e.id) && e.when!(s, me));
      if (ev) {
        this.seen.add(ev.id);
        this.active = ev;
      }
    }
    if (this.active) return this.active;
    while (this.step < SCRIPT.length && SCRIPT[this.step].done(s, me)) this.step++;
    return SCRIPT[this.step] ?? null;
  }

  /** The player tapped "OK" on the hint on screen. */
  ack(id: string) {
    if (this.active?.id === id) this.active = null;
    else if (SCRIPT[this.step]?.id === id) this.step++;
  }
}

/**
 * Lights up the hint's target and puts the bubble next to it, on the side with more room.
 * Called after every render, since the board is redrawn from scratch.
 */
export function showHint(root: HTMLElement, h: Hint) {
  const target = h.target ? root.querySelector<HTMLElement>(h.target) : null;
  const r = target ? outline(target) : null;
  const vw = innerWidth;
  const vh = innerHeight;
  if (r) {
    const spot = document.createElement('div');
    spot.className = 'coach-spot';
    const pad = 4;
    const top = Math.max(0, r.top - pad);
    const left = Math.max(0, r.left - pad);
    spot.style.cssText = `top:${top}px;left:${left}px;width:${Math.min(vw, r.right + pad) - left}px;height:${Math.min(vh, r.bottom + pad) - top}px`;
    root.appendChild(spot);
  }
  const bubble = document.createElement('div');
  bubble.className = 'coach';
  bubble.innerHTML = `<p>${h.text}</p><div class="coach-actions">
    <button class="ghost" data-act="tut-skip">Пропустить туториал</button>
    ${h.ok ? `<button data-act="tut-ok" data-hint="${h.id}">Понятно</button>` : ''}</div>`;
  root.appendChild(bubble);
  const bw = bubble.offsetWidth;
  const bh = bubble.offsetHeight;
  const gap = 10;
  let x = (vw - bw) / 2;
  let y = (vh - bh) / 2;
  if (h.top) y = 8;
  else if (r) {
    if (r.top - gap - bh >= 8) y = r.top - gap - bh;
    else if (r.bottom + gap + bh <= vh - 8) y = r.bottom + gap;
    else {
      // No room above or below (landscape): sit beside the target instead of covering it.
      const right = vw - r.right - gap;
      const left = r.left - gap;
      if (Math.max(left, right) >= Math.min(bw, 260)) {
        x = right >= left ? r.right + gap : Math.max(8, r.left - gap - bw);
        bubble.style.width = `${Math.min(bw, Math.max(left, right) - 8)}px`;
      } else y = r.top + r.height / 2 > vh / 2 ? r.top - gap - bh : r.bottom + gap;
      y = Math.min(y, r.top);
    }
  }
  bubble.style.left = `${Math.max(8, Math.min(vw - bubble.offsetWidth - 8, x))}px`;
  bubble.style.top = `${Math.max(8, Math.min(vh - bubble.offsetHeight - 8, y))}px`;
}

/** Box around the element and its cards, which may stick out of it (the fanned hand). */
function outline(el: HTMLElement): DOMRect | null {
  const rects = [el, ...el.querySelectorAll<HTMLElement>(':scope > *, :scope > * > *')]
    .map((e) => e.getBoundingClientRect())
    .filter((b) => b.width && b.height);
  if (!rects.length) return null;
  const left = Math.max(0, Math.min(...rects.map((b) => b.left)));
  const top = Math.max(0, Math.min(...rects.map((b) => b.top)));
  const right = Math.min(innerWidth, Math.max(...rects.map((b) => b.right)));
  // Cards tucked under the bottom bar stay hidden, so only grow up and sideways.
  const bottom = Math.min(innerHeight, rects[0].bottom);
  return new DOMRect(left, top, right - left, bottom - top);
}
