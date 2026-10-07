/**
 * Hand-drawn art. A file named after a card id in src/assets/cards/ or a
 * patron id in src/assets/patrons/ replaces the procedural picture for it;
 * everything without a file keeps the generated pixel art.
 */
const byName = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([path, url]) => [path.replace(/^.*\/|\.webp$/g, ''), url]));

const CARDS = byName(import.meta.glob<string>('../assets/cards/*.webp', { eager: true, query: '?url', import: 'default' }));
const PATRONS = byName(import.meta.glob<string>('../assets/patrons/*.webp', { eager: true, query: '?url', import: 'default' }));
/** The card back, the backdrops, the logo and the interface icons, used from style.css, main.ts and src/ui/icons.ts; listed here only to be loaded up front. */
const SCENERY = import.meta.glob<string>(['../assets/ui/*.webp', '../assets/bg/*.webp', '../assets/icons/*.webp', '../assets/app/*.webp'], {
  eager: true,
  query: '?url',
  import: 'default',
});

export const customCardArt = (cardId: string): string | undefined => CARDS[cardId];
export const customEmblem = (patronId: string): string | undefined => PATRONS[patronId];

/** Every hand-drawn picture in the game, for the loading screen to fetch and decode before the menu opens. */
export const allArt = (): string[] => [...Object.values(SCENERY), ...Object.values(CARDS), ...Object.values(PATRONS)];
