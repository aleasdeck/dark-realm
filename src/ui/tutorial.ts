import { cardDef, PATRONS } from '../engine/cards';
import { actingPlayer, attackable, other, patronAvailable } from '../engine/engine';
import { TUTORIAL_GOAL, TUTORIAL_PATRONS } from '../engine/tutorial';
import type { GameState, PlayerIdx } from '../engine/types';
import { paintIcons } from './rich';

/** One coach hint: what it points at, what it says, and when it is no longer needed. */
export interface Hint {
  id: string;
  /**
   * Selector (or selector list) of the part of the table to light up; none for a hint about the
   * whole screen. While a hint is up, only its target and the coach respond to taps.
   */
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
/** The player's second turn is turn 3 (the bot plays turn 2). */
const secondTurnOver = (s: GameState) => s.turn > 3;
const called = (s: GameState, me: PlayerIdx, which: (pid: string) => boolean) =>
  s.events.some((e) => e.k === 'patron' && e.p === me && which(e.patron));
/** Drafted patrons (not the Chest) the player can call right now. */
const callablePatrons = (s: GameState, me: PlayerIdx) => TUTORIAL_PATRONS.some((pid) => patronAvailable(s, me, pid));
/** Cards to take from the tavern are picked right in it (see tavernPick in render.ts). */
const tavernPicking = (s: GameState, me: PlayerIdx) =>
  s.pending?.player === me && ['acquire', 'bargain', 'replaceTavern'].includes(s.pending.kind);

const draftPick = (n: number): Step => {
  const pid = TUTORIAL_PATRONS[n === 0 ? 0 : 3];
  return {
    id: `draft-${n}`,
    target: `.draft-tile[data-patron="${pid}"]`,
    text:
      n === 0
        ? `Сначала игроки выбирают покровителей: их карты наполнят таверну. Нажмите на подсвеченного: ${PATRONS[pid].name}.`
        : `Ваш второй покровитель: ${PATRONS[pid].name}. Нажмите на него.`,
    done: (s) => s.phase !== 'draft' || s.draftStep > (n === 0 ? 0 : 3),
  };
};

/** The draft and the first turn, walked through in order. */
const SCRIPT: Step[] = [
  draftPick(0),
  {
    id: 'draft-bot',
    text: 'Теперь соперник выбирает двух покровителей.',
    done: (s, me) => s.phase !== 'draft' || actingPlayer(s) === me,
  },
  draftPick(1),
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
    target: '.hand, .controls [data-act="play-all"]',
    text: 'Сыграйте остальные карты. Кнопка ▶▶ внизу сыграет их все разом.',
    done: (s, me) => firstTurnOver(s) || s.players[me].hand.length === 0,
  },
  {
    id: 'treasury',
    target: '.patrons .patron.chest',
    text: 'Это Сундук: к нему можно воззвать в любой партии. За 2 ● он уничтожит ненужную карту, а взамен даст «Долговую расписку» на 2 ●. Нажмите на Сундук, затем ещё раз, и выберите, например, «Золото».',
    // No "OK": the player has to call it. It steps aside only if the Chest can't be called.
    done: (s, me) => firstTurnOver(s) || called(s, me, (p) => p === 'treasury') || !patronAvailable(s, me, 'treasury'),
  },
  {
    id: 'tavern',
    target: '.tavern',
    text: 'В таверне покупают карты за монеты ●. Купите одну из ярких: нажмите на карту, затем ещё раз. Покупка ляжет в сброс и придёт в руку позже, а контракт сработает сразу.',
    // No "OK" here: the player has to buy something. Only if nothing is affordable does it step aside.
    done: (s, me) =>
      firstTurnOver(s) ||
      s.events.some((e) => e.k === 'buy' && e.p === me) ||
      !s.tavern.some((c) => cardDef(c.id).cost > 0 && cardDef(c.id).cost <= s.players[me].coin),
  },
  {
    id: 'patrons',
    target: '.patrons',
    text: 'Рядом с Сундуком покровители: слева ваши, справа соперника. Раз в ход можно воззвать к одному из них или к Сундуку. Покровитель склонится к вам, а если все на вашей стороне, вы сразу победили. В следующий ход попробуете.',
    ok: true,
    done: firstTurnOver,
  },
  {
    id: 'end',
    target: '.controls .end',
    text: 'Нажмите «Конец хода». Сила ⚔ станет престижем ✦, и вы возьмёте 5 новых карт.',
    done: firstTurnOver,
  },
  {
    id: 'their-turn',
    target: '.opp-bar',
    text: 'Теперь ходит соперник. Его карты появляются на столе. Дождитесь своего хода.',
    done: (s, me) => s.turn > 2 && myTurn(s, me),
  },
  {
    id: 'play-2',
    target: '.hand, .controls [data-act="play-all"]',
    text: 'Ваш ход. Сыграйте карты, чтобы набрать монеты ● и силу ⚔.',
    done: (s, me) => secondTurnOver(s) || s.players[me].hand.length === 0,
  },
  {
    id: 'patron-call',
    target: '.patrons .patron.can:not(.chest)',
    text: 'Теперь воззовите к покровителю. Подсвечены те, чья цена вам по силам: нажмите на покровителя, прочтите, что он даёт, и нажмите ещё раз.',
    // No "OK": the player has to call one. It steps aside only if nobody can be called.
    done: (s, me) => secondTurnOver(s) || called(s, me, (p) => p !== 'treasury') || !callablePatrons(s, me),
  },
  {
    id: 'free',
    text: `Основы вы знаете, дальше играйте сами. Наберите ${TUTORIAL_GOAL} ✦ раньше соперника. Если случится что-то новое, я подскажу.`,
    ok: true,
    done: () => false,
  },
];

/** Hints for situations that come up on their own, shown the first time only. */
const EVENTS: Step[] = [
  {
    id: 'tavern-pick',
    target: '.tavern, .controls .end',
    text: 'Карта даёт выбрать карту в таверне. Подходящие подсвечены: нажмите на карту, затем ещё раз, чтобы выбрать её. Кнопка внизу закончит выбор.',
    ok: true,
    when: (s, me) => tavernPicking(s, me),
    done: (s, me) => !tavernPicking(s, me),
  },
  {
    id: 'choice',
    text: 'Нужно сделать выбор. Нажмите на нужный вариант.',
    top: true,
    ok: true,
    when: (s, me) => s.pending?.player === me && !tavernPicking(s, me),
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
    if (this.off || s.phase === 'over') return null;
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
    else if (SCRIPT[this.step]?.id === id && SCRIPT[this.step].ok) this.step++;
  }
}

/** Taps that still work while the hint is up: its target, the coach itself and choice sheets. */
const ALWAYS = ['tut-ok', 'tut-skip', 'confirm-focus', 'pick', 'confirm', 'close', 'leave', 'rematch'];

export function hintAllows(h: Hint | null, el: HTMLElement): boolean {
  if (!h) return true;
  if (ALWAYS.includes(el.dataset.act ?? '')) return true;
  return !!h.target && !!el.closest(h.target);
}

/**
 * Lights up the hint's target and puts the bubble next to it, on the side with more room.
 * Called after every render, since the board is redrawn from scratch.
 */
export function showHint(root: HTMLElement, h: Hint) {
  const r = h.target ? outline([...root.querySelectorAll<HTMLElement>(h.target)]) : null;
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
  bubble.innerHTML = `<p>${paintIcons(h.text)}</p><div class="coach-actions">
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

/** Box around the elements and their cards, which may stick out of them (the fanned hand). */
function outline(els: HTMLElement[]): DOMRect | null {
  if (!els.length) return null;
  const rects = els
    .flatMap((el) => [el, ...el.querySelectorAll<HTMLElement>(':scope > *, :scope > * > *')])
    // Cards scrolled out of a column are clipped by it, so only the column itself counts.
    .filter((e) => !e.parentElement?.closest('[data-clip]'))
    .map((e) => e.getBoundingClientRect())
    .filter((b) => b.width && b.height);
  if (!rects.length) return null;
  const left = Math.max(0, Math.min(...rects.map((b) => b.left)));
  const top = Math.max(0, Math.min(...rects.map((b) => b.top)));
  const right = Math.min(innerWidth, Math.max(...rects.map((b) => b.right)));
  // Cards tucked under the bottom bar stay hidden, so only grow up and sideways.
  const bottom = Math.min(innerHeight, Math.max(...els.map((e) => e.getBoundingClientRect().bottom)));
  return new DOMRect(left, top, right - left, bottom - top);
}
