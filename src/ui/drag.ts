/**
 * Cards in hand can be picked up with a short hold (or by simply dragging them) and played by
 * dropping them on your table. A tap still works as before: select, then tap again to play.
 *
 * The board is redrawn from scratch on every state, so the picked-up card is a stand-in floating
 * above it, and the card in the hand is found again by its uid after each redraw.
 */

export interface DragHooks {
  /** Whether this hand card may be played now; when not, a hold does nothing and the tap goes on as usual. */
  canPlay(uid: number, el: HTMLElement): boolean;
  /** Called when a card is picked up: puts away an enlarged card. */
  lift(): void;
  /** Plays the card dropped on the table. */
  drop(uid: number): void;
}

const HOLD_MS = 170;
/** A finger or mouse that moves this far picks the card up without waiting for the hold. */
const MOVE_PX = 10;
/** The drop zone reaches a little past the frame of your table. */
const ZONE_PAD = 14;

const HAND_TILE = '.hand .fan-slot .tile[data-uid]';

interface Press {
  uid: number;
  pointer: number;
  x: number;
  y: number;
  timer: number;
}

interface Drag {
  uid: number;
  pointer: number;
  ghost: HTMLElement;
  /** Ghost centre relative to the pointer. */
  dx: number;
  dy: number;
  /** Where it was picked up: a card held and let go in place was only tapped slowly. */
  x0: number;
  y0: number;
  moved: boolean;
  over: boolean;
}

let root: HTMLElement;
let hooks: DragHooks;
let press: Press | null = null;
let drag: Drag | null = null;
/** Set while a dropped card is being played, so the redraw that follows leaves it alone. */
let dropping = false;
/** The click that follows a drop must not also select the card. */
let swallowUntil = 0;

const tileOf = (uid: number) => root.querySelector<HTMLElement>(`.hand .fan-slot .tile[data-uid="${uid}"]`);

export function initDrag(el: HTMLElement, h: DragHooks) {
  root = el;
  hooks = h;
  root.addEventListener('pointerdown', down);
  document.addEventListener('pointermove', move, { passive: false });
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
  // The art is an <img>: a mouse would otherwise drag the picture itself.
  root.addEventListener('dragstart', (ev) => {
    if ((ev.target as HTMLElement).closest('.hand')) ev.preventDefault();
  });
  document.addEventListener(
    'click',
    (ev) => {
      if (performance.now() > swallowUntil) return;
      swallowUntil = 0;
      ev.stopPropagation();
      ev.preventDefault();
    },
    { capture: true },
  );
}

function down(ev: PointerEvent) {
  if (ev.button !== 0 || !ev.isPrimary || press || drag) return;
  const el = (ev.target as HTMLElement).closest<HTMLElement>(HAND_TILE);
  if (!el) return;
  const uid = Number(el.dataset.uid);
  press = { uid, pointer: ev.pointerId, x: ev.clientX, y: ev.clientY, timer: 0 };
  const p = press;
  p.timer = window.setTimeout(() => pickUp(p, p.x, p.y), HOLD_MS);
}

function move(ev: PointerEvent) {
  if (drag && ev.pointerId === drag.pointer) {
    ev.preventDefault();
    follow(ev.clientX, ev.clientY);
    return;
  }
  if (!press || ev.pointerId !== press.pointer) return;
  if (Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > MOVE_PX) {
    ev.preventDefault();
    pickUp(press, ev.clientX, ev.clientY);
  }
}

function up(ev: PointerEvent) {
  if (press && ev.pointerId === press.pointer) release();
  if (!drag || ev.pointerId !== drag.pointer) return;
  follow(ev.clientX, ev.clientY);
  finish(drag.over);
}

function cancel(ev: PointerEvent) {
  if (press && ev.pointerId === press.pointer) release();
  if (drag && ev.pointerId === drag.pointer) finish(false);
}

function release() {
  if (press) window.clearTimeout(press.timer);
  press = null;
}

/** The hold is over: the card leaves the hand and follows the pointer. */
function pickUp(p: Press, x: number, y: number) {
  release();
  const el = tileOf(p.uid);
  if (!el || !hooks.canPlay(p.uid, el)) return;
  const r = el.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const ghost = document.createElement('div');
  ghost.className = 'drag-card';
  ghost.dataset.dragUid = String(p.uid);
  ghost.style.width = `${w}px`;
  ghost.style.height = `${h}px`;
  ghost.style.setProperty('--tw', getComputedStyle(el).getPropertyValue('--tw'));
  const lift = document.createElement('div');
  lift.className = 'drag-lift';
  const look = el.cloneNode(true) as HTMLElement;
  look.removeAttribute('data-act');
  look.removeAttribute('data-uid');
  look.classList.remove('playable', 'focused');
  lift.appendChild(look);
  ghost.appendChild(lift);
  document.body.appendChild(ghost);
  // The card keeps where it was grabbed under the pointer, raised a little so a finger doesn't cover it.
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  drag = { uid: p.uid, pointer: p.pointer, ghost, dx: cx - p.x, dy: cy - p.y, x0: p.x, y0: p.y, moved: false, over: false };
  lift.animate([{ scale: '1', rotate: '0deg' }, { scale: '1.12', rotate: '-3deg' }], { duration: 140, easing: 'ease-out', fill: 'forwards' });
  ghost.animate([{ translate: `0 0` }, { translate: '0 -18px' }], { duration: 140, easing: 'ease-out', fill: 'forwards' });
  navigator.vibrate?.(12);
  follow(x, y);
  mark();
}

function follow(x: number, y: number) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(x - drag.x0, y - drag.y0) > MOVE_PX) {
    drag.moved = true;
    // Puts away an enlarged card, which redraws the board.
    hooks.lift();
    mark();
  }
  const { ghost } = drag;
  const w = ghost.offsetWidth;
  const h = ghost.offsetHeight;
  ghost.style.left = `${x + drag.dx - w / 2}px`;
  ghost.style.top = `${y + drag.dy - h / 2}px`;
  const over = overTable(x, y);
  if (over !== drag.over) {
    drag.over = over;
    mark();
  }
}

function overTable(x: number, y: number): boolean {
  const zone = root.querySelector('.game .my-table');
  if (!zone) return false;
  const r = zone.getBoundingClientRect();
  return x >= r.left - ZONE_PAD && x <= r.right + ZONE_PAD && y >= r.top - ZONE_PAD && y <= r.bottom + ZONE_PAD;
}

/** Dims the card's place in the hand and lights up the table, again after every redraw. */
function mark() {
  const game = root.querySelector('.game');
  if (!drag || !game) return;
  game.classList.add('drag-on');
  game.querySelector('.my-table')?.classList.toggle('drop-hot', drag.over);
  tileOf(drag.uid)?.closest('.fan-slot')?.classList.add('dragged');
}

function unmark() {
  const game = root.querySelector('.game');
  game?.classList.remove('drag-on');
  game?.querySelector('.my-table')?.classList.remove('drop-hot');
  game?.querySelectorAll('.fan-slot.dragged').forEach((s) => s.classList.remove('dragged'));
}

function finish(onTable: boolean) {
  const d = drag;
  if (!d || dropping) return;
  if (!d.moved) {
    // Held but never carried: the tap goes on as usual (select, or play the selected card).
    drag = null;
    unmark();
    d.ghost.remove();
    return;
  }
  swallowUntil = performance.now() + 400;
  const el = tileOf(d.uid);
  if (onTable && el && hooks.canPlay(d.uid, el)) {
    unmark();
    // The stand-in stays while the move is made, so the card flies on from where it was dropped.
    dropping = true;
    try {
      hooks.drop(d.uid);
    } finally {
      dropping = false;
      drag = null;
      d.ghost.remove();
    }
    return;
  }
  drag = null;
  // Back to its place in the hand.
  if (!el) {
    unmark();
    d.ghost.remove();
    return;
  }
  const r = el.getBoundingClientRect();
  const g = d.ghost.getBoundingClientRect();
  const back = d.ghost.animate(
    [{ transform: 'none' }, { transform: `translate(${r.left + r.width / 2 - (g.left + g.width / 2)}px, ${r.top + r.height / 2 - (g.top + g.height / 2)}px) scale(0.9)` }],
    { duration: 180, easing: 'ease-in', fill: 'forwards' },
  );
  back.onfinish = () => {
    // Another card may have been picked up meanwhile.
    if (!drag) unmark();
    else if (drag.uid !== d.uid) tileOf(d.uid)?.closest('.fan-slot')?.classList.remove('dragged');
    d.ghost.remove();
  };
}

/** After a redraw: keeps the board's drag marks, or drops the card when it has left the hand or can't be played any more. */
export function restoreDrag() {
  if (!drag || dropping) return;
  const el = tileOf(drag.uid);
  if (el && hooks.canPlay(drag.uid, el)) return mark();
  finish(false);
}

/** The card being carried, for the motion snapshot: where it flies from when it is dropped. */
export function draggedCard(): { uid: number; el: HTMLElement } | null {
  const look = drag?.ghost.querySelector<HTMLElement>('.tile');
  return drag && look ? { uid: drag.uid, el: look } : null;
}
