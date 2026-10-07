/**
 * Hand-drawn interface icons: src/assets/icons/<id>.webp, made by scripts/import-icons.py.
 * Each place that shows one keeps its old glyph or text for when the file is missing.
 * Kept free of DOM access, like rich.ts, so the tutorial tests can use it.
 */
const ICONS = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../assets/icons/*.webp', { eager: true, query: '?url', import: 'default' })).map(([path, url]) => [
    path.replace(/^.*\/|\.webp$/g, ''),
    url,
  ]),
);

export const iconUrl = (id: string): string | undefined => ICONS[id];
export const allIcons = (): string[] => Object.values(ICONS);

/** The icon as an inline picture, or the fallback when there is no file for it. */
export function icon(id: string, fallback = '', cls = ''): string {
  const url = ICONS[id];
  return url ? `<img class="ic${cls ? ` ${cls}` : ''}" src="${url}" alt="" draggable="false">` : fallback;
}

/** A button label with its icon in front. */
export const withIcon = (id: string, label: string) => `${icon(id)}<span>${label}</span>`;
