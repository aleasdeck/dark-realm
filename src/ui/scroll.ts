/**
 * A scrolling list with the game's own scroll bar. Phones draw their bars over the page and ignore styling,
 * so the browser's bar is hidden and a thin green thumb on the right shows where the list is.
 * Markup: <div class="tscroll"><div class="tscroll-body">…</div></div>; the thumb is added here.
 */
export function themedScroll(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('.tscroll:not([data-ts])').forEach((box) => {
    box.dataset.ts = '';
    const body = box.querySelector<HTMLElement>('.tscroll-body')!;
    const thumb = document.createElement('i');
    thumb.className = 'tscroll-thumb';
    box.append(thumb);
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = body;
      const over = scrollHeight - clientHeight;
      box.classList.toggle('scrolls', over > 1);
      if (over <= 1) return;
      const h = Math.max(28, (clientHeight * clientHeight) / scrollHeight);
      thumb.style.top = `${body.offsetTop}px`;
      thumb.style.height = `${h}px`;
      thumb.style.transform = `translateY(${(Math.min(scrollTop, over) / over) * (clientHeight - h)}px)`;
    };
    body.addEventListener('scroll', update, { passive: true });
    // The list changes size with the screen, with fonts arriving, and when a switch shows or hides.
    const ro = new ResizeObserver(update);
    ro.observe(body);
    for (const child of body.children) ro.observe(child);
    new MutationObserver(update).observe(body, { childList: true, subtree: true });
    update();
  });
}
