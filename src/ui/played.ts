/**
 * The played-cards columns: five rows show at a time and the rest scroll by like a slider.
 * The board is redrawn from scratch on every state, so the scroll position is carried over here,
 * and a newly played card slides in from the top instead of just appearing.
 */

interface Memo {
  top: number;
  uids: string[];
}

const memo = new Map<string, Memo>();

const lists = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.pl-list[data-side]')];
const uidsOf = (list: HTMLElement) => [...list.children].map((el) => (el as HTMLElement).dataset.uid ?? '');
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Remembers where each column was scrolled to; call right before the board is replaced. */
export function savePlayed(root: ParentNode) {
  memo.clear();
  for (const list of lists(root)) memo.set(list.dataset.side!, { top: list.scrollTop, uids: uidsOf(list) });
}

/** Puts each column back where it was and slides newly played cards in from the top. */
export function restorePlayed(root: ParentNode) {
  for (const list of lists(root)) {
    const prev = memo.get(list.dataset.side!);
    const uids = uidsOf(list);
    // Newest card is first, so whatever sits above the previous first card is new.
    const added = prev ? uids.indexOf(prev.uids[0]) : -1;
    if (prev && added === 0) list.scrollTop = prev.top;
    else if (prev && added > 0 && !reduced()) {
      // Show the old view first, then slide down to the new cards.
      list.scrollTop = prev.top + added * step(list);
      requestAnimationFrame(() => list.scrollTo({ top: 0, behavior: 'smooth' }));
    }
    markEdges(list);
  }
  memo.clear();
}

/** Height of one row including the gap. */
function step(list: HTMLElement): number {
  const [a, b] = list.children as unknown as HTMLElement[];
  if (!a) return 0;
  return b ? b.offsetTop - a.offsetTop : a.offsetHeight;
}

/** Fades the top or bottom edge while more cards hide past it. */
function markEdges(list: HTMLElement) {
  const max = list.scrollHeight - list.clientHeight;
  list.classList.toggle('more-up', list.scrollTop > 1);
  list.classList.toggle('more-down', list.scrollTop < max - 1);
}

/** A mouse wheel moves the column one card at a time, smoothly. */
export function initPlayed(root: HTMLElement) {
  root.addEventListener('scroll', (ev) => {
    const list = ev.target as HTMLElement;
    if (list.classList?.contains('pl-list')) markEdges(list);
  }, true);
  let lock = 0;
  root.addEventListener(
    'wheel',
    (ev) => {
      const list = (ev.target as HTMLElement).closest<HTMLElement>('.pl-list');
      if (!list || list.scrollHeight <= list.clientHeight || Math.abs(ev.deltaY) < Math.abs(ev.deltaX)) return;
      ev.preventDefault();
      const now = performance.now();
      if (now < lock) return;
      lock = now + 160;
      list.scrollBy({ top: Math.sign(ev.deltaY) * step(list), behavior: reduced() ? 'auto' : 'smooth' });
    },
    { passive: false },
  );
}
