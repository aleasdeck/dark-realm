import { still } from './motion';

/**
 * Motion for the main menu. Its screens are redrawn whole, so before a redraw the old screen is
 * copied into a layer that slides out, and after it the new one slides in from the side it lies on:
 * deeper screens come from the right, «Назад» brings the previous one back from the left. The icon
 * on top doesn't jump between its two sizes, it shrinks or grows into place. Buttons answer a press
 * with a glow that spreads from the finger. Nothing moves with the «Анимации» switch off or with the
 * system's reduced motion.
 */

/** The menu as it was just before a redraw. */
export interface MenuShot {
  depth: number;
  view: string;
  logo: DOMRect | null;
  /** The copy of the old screen, on its way out. */
  ghost: HTMLElement | null;
}

const OUT_MS = 170;
const IN_MS = 260;
const STEP_MS = 40;
const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';

/** The button pressed last, to light it up while the rest of its screen leaves. */
let pressed: HTMLElement | null = null;

/** The screen on the way out stays in this layer until it has faded. */
function exitLayer(): HTMLElement {
  let layer = document.querySelector<HTMLElement>('.menu-exit');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'menu-exit';
    document.body.append(layer);
  }
  return layer;
}

/** Copies the menu on screen before it is redrawn; null when there is none (the game or the loading screen was up). */
export function shootMenu(root: ParentNode, depth: number, next: string): MenuShot | null {
  const old = root.querySelector<HTMLElement>('.menu.home');
  if (!old) return null;
  const logo = old.querySelector('.logo img')?.getBoundingClientRect() ?? null;
  const view = old.dataset.view ?? '';
  const shot: MenuShot = { depth: Number(old.dataset.depth ?? depth), view, logo, ghost: null };
  // The same screen drawn again (a message under it) doesn't move; only the message appears.
  if (still() || view === next) return shot;
  const r = old.getBoundingClientRect();
  const ghost = old.cloneNode(true) as HTMLElement;
  ghost.classList.add('menu-ghost');
  ghost.removeAttribute('data-depth');
  Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  ghost.querySelectorAll('.press-glow').forEach((g) => g.remove());
  ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  // Lists keep where they were scrolled to.
  const lists = old.querySelectorAll<HTMLElement>('.tscroll-body');
  ghost.querySelectorAll<HTMLElement>('.tscroll-body').forEach((b, i) => (b.dataset.top = String(lists[i]?.scrollTop ?? 0)));
  if (pressed && old.contains(pressed)) {
    const path: number[] = [];
    for (let el: HTMLElement = pressed; el !== old; el = el.parentElement!) path.unshift([...el.parentElement!.children].indexOf(el));
    let twin: Element = ghost;
    for (const i of path) twin = twin.children[i];
    twin.classList.add('chosen', 'lit');
  }
  exitLayer().append(ghost);
  ghost.querySelectorAll<HTMLElement>('.tscroll-body').forEach((b) => (b.scrollTop = Number(b.dataset.top)));
  shot.ghost = ghost;
  return shot;
}

/** Plays the way from the old screen to the one just drawn. */
export function playMenu(root: ParentNode, shot: MenuShot | null, depth: number) {
  const menu = root.querySelector<HTMLElement>('.menu.home');
  if (!menu) return;
  menu.dataset.depth = String(depth);
  const ghost = shot?.ghost ?? null;
  if (still()) {
    ghost?.remove();
    return;
  }
  const parts = [...menu.children].filter((el) => !el.classList.contains('logo')) as HTMLElement[];
  // From the game, the loading screen or a waiting room: the whole menu rises out of the dark.
  if (!shot) {
    const wait = document.getElementById('boot') ? 220 : 0;
    menu.querySelector('.logo img')?.animate(
      [
        { opacity: 0, transform: 'scale(.86)', filter: 'brightness(.3) drop-shadow(0 0 0 #4fd17a00)' },
        { opacity: 1, transform: 'scale(1.02)', filter: 'brightness(1.25) drop-shadow(0 0 22px #4fd17a99)', offset: 0.6 },
        { opacity: 1, transform: 'scale(1)', filter: 'brightness(1) drop-shadow(0 0 0 #4fd17a00)' },
      ],
      { duration: 700, delay: wait, easing: 'ease-out', fill: 'backwards' },
    );
    rise(parts, wait + 220, 'translateY(14px)');
    return;
  }
  if (shot.view === menu.dataset.view) {
    const msg = menu.querySelector<HTMLElement>('.msg');
    msg?.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }],
      { duration: 320, easing: 'ease-out' },
    );
    msg?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    return;
  }
  const dir = depth >= shot.depth ? 1 : -1;
  if (ghost) {
    const going: Animation[] = [];
    for (const el of ghost.children as HTMLCollectionOf<HTMLElement>) {
      if (el.classList.contains('logo')) {
        el.style.visibility = 'hidden';
        continue;
      }
      going.push(
        el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-28 * dir}px)` }], {
          duration: OUT_MS,
          easing: 'ease-in',
          fill: 'forwards',
        }),
      );
    }
    const chosen = ghost.querySelector<HTMLElement>('.chosen');
    const flash = chosen?.animate(
      [
        { opacity: 1, transform: 'none', boxShadow: '0 0 0 #4fd17a00' },
        { opacity: 1, transform: 'scale(1.03)', boxShadow: '0 0 22px #4fd17acc', offset: 0.45 },
        { opacity: 0, transform: `translateX(${-14 * dir}px) scale(1.03)`, boxShadow: '0 0 30px #4fd17a00' },
      ],
      { duration: OUT_MS + 90, easing: 'ease-out', fill: 'forwards' },
    );
    if (flash) going.push(flash);
    const gone = () => ghost.remove();
    Promise.all(going.map((a) => a.finished)).then(gone, gone);
  }
  // The icon shrinks or grows from where it was instead of jumping.
  const logo = menu.querySelector<HTMLElement>('.logo img');
  const now = logo?.getBoundingClientRect();
  if (logo && now && shot.logo && now.width > 0) {
    const s = shot.logo.width / now.width;
    const dx = shot.logo.left + shot.logo.width / 2 - (now.left + now.width / 2);
    const dy = shot.logo.top + shot.logo.height / 2 - (now.top + now.height / 2);
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || Math.abs(s - 1) > 0.01)
      logo.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }], { duration: 320, easing: EASE_OUT });
  }
  rise(parts, OUT_MS * 0.55, `translateX(${32 * dir}px)`);
}

/** Brings the parts of a screen in one after another; the buttons in a list each wait their turn. */
function rise(parts: HTMLElement[], delay: number, from: string) {
  let i = 0;
  const one = (el: HTMLElement) =>
    el.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], {
      duration: IN_MS,
      delay: delay + i++ * STEP_MS,
      easing: EASE_OUT,
      fill: 'backwards',
    });
  for (const el of parts) {
    if (el.classList.contains('menu-buttons')) {
      const items = [...el.children] as HTMLElement[];
      // A single scrolling block (settings, rating) comes in whole.
      if (items.length > 1) items.forEach(one);
      else one(el);
    } else one(el);
  }
}

/** A glow that spreads from where the finger met the button. */
function glow(btn: HTMLElement, x: number, y: number) {
  const r = btn.getBoundingClientRect();
  const size = Math.hypot(Math.max(x - r.left, r.right - x), Math.max(y - r.top, r.bottom - y)) * 2;
  const g = document.createElement('span');
  g.className = 'press-glow';
  Object.assign(g.style, { width: `${size}px`, height: `${size}px`, left: `${x - r.left - size / 2}px`, top: `${y - r.top - size / 2}px` });
  btn.append(g);
  g.animate(
    [
      { transform: 'scale(0)', opacity: 0.55 },
      { transform: 'scale(1)', opacity: 0 },
    ],
    { duration: 520, easing: 'ease-out' },
  ).finished.then(
    () => g.remove(),
    () => g.remove(),
  );
}

/** Lights the cracks of a stone button until the finger lifts, and a moment longer. */
function light(btn: HTMLElement) {
  btn.classList.add('lit');
  const off = () => {
    removeEventListener('pointerup', off, true);
    removeEventListener('pointercancel', off, true);
    setTimeout(() => btn.classList.remove('lit'), 180);
  };
  addEventListener('pointerup', off, true);
  addEventListener('pointercancel', off, true);
}

/** The buttons that answer a press with a glow: the main menu's and the game menu's. */
const GLOWS = 'button.menu-btn, .menu button.toggle, .menu-sheet .sheet-actions button, .menu > button';

/** Listens for presses once, for every menu screen to come. */
export function initMenuFx() {
  document.addEventListener(
    'pointerdown',
    (ev) => {
      const btn = (ev.target as HTMLElement).closest?.<HTMLElement>('button');
      pressed = btn;
      if (btn?.matches('button.menu-btn:not(:disabled)')) light(btn);
      if (!btn || still() || (btn as HTMLButtonElement).disabled || !btn.matches(GLOWS)) return;
      glow(btn, ev.clientX, ev.clientY);
    },
    { capture: true, passive: true },
  );
  // A key press picks a button too.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') pressed = document.activeElement as HTMLElement | null;
  });
}

/** A screen that isn't the menu (a game, a waiting room) fades in instead of snapping on. */
export function fadeIn(el: HTMLElement) {
  if (still()) return;
  document.querySelectorAll('.menu-exit .menu-ghost').forEach((g) => g.remove());
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
}
