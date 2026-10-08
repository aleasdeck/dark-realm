/** Shrinks a tavern tile's name until each word fits on a line and the name fits its two lines, so names never break mid-word. */

const MIN = 7.5;
let probe: HTMLSpanElement | null = null;

/** Width of the widest word of el's text in el's current font. */
function widest(el: HTMLElement): number {
  if (!probe) {
    probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap';
    document.body.append(probe);
  }
  // Safari can leave the computed `font` shorthand empty, so copy the parts.
  const cs = getComputedStyle(el);
  probe.style.fontFamily = cs.fontFamily;
  probe.style.fontWeight = cs.fontWeight;
  probe.style.fontSize = cs.fontSize;
  probe.style.fontStretch = cs.fontStretch;
  probe.style.letterSpacing = cs.letterSpacing;
  let max = 0;
  for (const word of (el.textContent ?? '').replace(/­/g, '').split(/\s+|(?<=-)/)) {
    if (!word) continue;
    probe.textContent = word;
    max = Math.max(max, probe.getBoundingClientRect().width);
  }
  return max;
}

/** Fits every tile name under root whose tile width changed since it was last fitted (cards move between zones of different sizes). */
export function fitNames(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('.t-name')) {
    const tile = el.parentElement;
    if (!tile) continue;
    const ts = getComputedStyle(tile);
    // The name is a shrink-to-fit flex item, so the room is the tile's content box.
    const room = tile.clientWidth - parseFloat(ts.paddingLeft) - parseFloat(ts.paddingRight);
    if (room <= 0 || el.dataset.fit === String(room)) continue;
    el.dataset.fit = String(room);
    el.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize);
    const need = widest(el);
    if (need > room) {
      size = Math.max(MIN, (size * room) / need - 0.1);
      el.style.fontSize = `${size}px`;
    }
    // Three short words can still wrap past the two lines the box shows.
    while (el.scrollHeight > el.clientHeight + 1 && size > MIN) {
      size = Math.max(MIN, size - 0.5);
      el.style.fontSize = `${size}px`;
    }
  }
}

/** Keeps tile names fitted as the screen re-renders and resizes. */
export function initFit() {
  let queued = false;
  const run = () => {
    queued = false;
    fitNames();
  };
  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(run);
    }
  };
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', queue);
  document.fonts?.addEventListener('loadingdone', () => {
    for (const el of document.querySelectorAll<HTMLElement>('.t-name[data-fit]')) delete el.dataset.fit;
    queue();
  });
}
