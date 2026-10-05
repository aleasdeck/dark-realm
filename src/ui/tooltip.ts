/**
 * Floating tooltips for elements marked with data-tip: shown on mouse hover,
 * or on a long press on touch screens. They float above the table, so the layout never moves.
 */

type Content = (el: HTMLElement) => string | null;

const HOVER_MS = 220;
const PRESS_MS = 420;

const tip = document.createElement('div');
tip.className = 'tooltip';
tip.hidden = true;
document.body.appendChild(tip);

let content: Content = () => null;
let anchorKey = '';
let hoverTimer = 0;
let pressTimer = 0;
let pressStart: { x: number; y: number } | null = null;
let swallowClick = false;

/** Identifies the anchor across full re-renders, which replace the element. */
function keyOf(el: HTMLElement): string {
  if (el.dataset.patron) return `[data-tip][data-patron="${el.dataset.patron}"]`;
  if (el.dataset.uid) return `[data-tip][data-uid="${el.dataset.uid}"]`;
  return '';
}

function show(el: HTMLElement) {
  const html = content(el);
  const key = keyOf(el);
  if (!html || !key) return hide();
  anchorKey = key;
  tip.innerHTML = html;
  tip.hidden = false;
  place(el);
}

function place(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const vw = innerWidth;
  const vh = innerHeight;
  const x = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2));
  // Above the anchor when there is room, otherwise below it.
  let y = r.top - h - 8;
  if (y < 8) y = Math.min(vh - h - 8, r.bottom + 8);
  tip.style.left = `${x}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

export function hideTooltip() {
  window.clearTimeout(hoverTimer);
  window.clearTimeout(pressTimer);
  hide();
}

function hide() {
  anchorKey = '';
  tip.hidden = true;
}

/** Re-attaches the open tooltip to its anchor after the board re-rendered. */
export function refreshTooltip() {
  if (!anchorKey) return;
  const el = document.querySelector<HTMLElement>(anchorKey);
  if (el) show(el);
  else hide();
}

export function initTooltips(fn: Content) {
  content = fn;
  const target = (ev: Event) => (ev.target as HTMLElement).closest<HTMLElement>('[data-tip]');

  document.addEventListener('pointerover', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    const el = target(ev);
    window.clearTimeout(hoverTimer);
    if (!el) return hide();
    if (keyOf(el) === anchorKey) return;
    hoverTimer = window.setTimeout(() => show(el), HOVER_MS);
  });
  // Touch also fires pointerleave on release, but a long-press tooltip stays until the next tap.
  document.addEventListener('pointerleave', (ev) => {
    if (ev.pointerType === 'mouse') hideTooltip();
  });

  document.addEventListener(
    'pointerdown',
    (ev) => {
      swallowClick = false;
      if (ev.pointerType === 'mouse') return hideTooltip();
      hide();
      const el = target(ev);
      if (!el) return;
      pressStart = { x: ev.clientX, y: ev.clientY };
      pressTimer = window.setTimeout(() => {
        swallowClick = true;
        show(el);
      }, PRESS_MS);
    },
    { capture: true },
  );
  document.addEventListener('pointermove', (ev) => {
    if (!pressStart) return;
    if (Math.hypot(ev.clientX - pressStart.x, ev.clientY - pressStart.y) > 10) window.clearTimeout(pressTimer);
  });
  const release = () => {
    window.clearTimeout(pressTimer);
    pressStart = null;
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  // A long press only shows the tooltip; it must not also select the patron or card.
  document.addEventListener(
    'click',
    (ev) => {
      if (!swallowClick) return;
      swallowClick = false;
      ev.stopPropagation();
      ev.preventDefault();
    },
    { capture: true },
  );
  // Long press on mobile would otherwise open the system menu or select text.
  document.addEventListener('contextmenu', (ev) => {
    if (target(ev)) ev.preventDefault();
  });
}
