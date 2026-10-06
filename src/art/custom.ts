/**
 * Hand-drawn art. A file named after a card id in src/assets/cards/ or a
 * patron id in src/assets/patrons/ replaces the procedural picture for it;
 * everything without a file keeps the generated pixel art.
 */
const byName = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([path, url]) => [path.replace(/^.*\/|\.webp$/g, ''), url]));

const CARDS = byName(import.meta.glob<string>('../assets/cards/*.webp', { eager: true, query: '?url', import: 'default' }));
const PATRONS = byName(import.meta.glob<string>('../assets/patrons/*.webp', { eager: true, query: '?url', import: 'default' }));

export const customCardArt = (cardId: string): string | undefined => CARDS[cardId];
export const customEmblem = (patronId: string): string | undefined => PATRONS[patronId];

/**
 * Fetches and decodes every hand-drawn picture up front, while the menu is
 * open, so no card shows up blank for a moment the first time it is dealt.
 */
const held: HTMLImageElement[] = [];
export function preloadCustomArt(): void {
  for (const url of [...Object.values(CARDS), ...Object.values(PATRONS)]) {
    const img = new Image();
    img.src = url;
    img.decode().catch(() => {});
    held.push(img); // kept alive so the decoded picture stays in the browser's memory cache
  }
}
