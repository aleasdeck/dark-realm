import { ICON } from '../engine/text';

/* Kept free of DOM access so the tutorial (and its tests) can use it. */

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ICON_CLASS: Record<string, string> = { [ICON.coin]: 'coin', [ICON.power]: 'pow', [ICON.prestige]: 'pre' };
const ICON_RE = new RegExp(`([+−-]?\\d+ )?([${Object.keys(ICON_CLASS).join('')}])`, 'g');

/** Paints resource icons in ready HTML, together with the amount in front of them, in the colors of the player bars. */
export function paintIcons(html: string): string {
  return html.replace(ICON_RE, (_, n: string | undefined, icon: string) => `<span class="ri ${ICON_CLASS[icon]}">${n ?? ''}<i>${icon}</i></span>`);
}

/** Escapes rules text and paints its resource icons. */
export const richText = (s: string) => paintIcons(esc(s));
