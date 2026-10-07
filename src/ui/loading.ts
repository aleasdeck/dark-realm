import { allArt } from '../art/custom';
import { warmBot } from './controller';

/**
 * The loading screen. Its markup and styles are in index.html, so it is up before this code
 * arrives; here every picture is fetched and decoded, the fonts and the bot's worker are loaded,
 * and only then does the menu open, so nothing in the game loads or pops in later.
 */

const FONTS = ['Philosopher', 'PT Sans', 'PT Sans Narrow'].flatMap((f) => [`400 16px "${f}"`, `700 16px "${f}"`]);

/** Every character the game writes in these fonts: the fonts come in parts (Cyrillic, Latin), and each part loads for the letters it covers. */
const SAMPLE = (() => {
  let s = 'ЁёАаЯя«»–—…·×№';
  for (let c = 0x20; c < 0x7f; c++) s += String.fromCharCode(c);
  for (let c = 0x410; c < 0x450; c++) s += String.fromCharCode(c);
  return s;
})();

/** Decoded pictures stay referenced, so the browser keeps them ready in memory. */
const held: HTMLImageElement[] = [];

function picture(url: string): Promise<unknown> {
  const img = new Image();
  img.src = url;
  held.push(img);
  return img.decode();
}

/** Loads everything, moving the screen's bar as each piece arrives; a piece that fails still counts, so the game always opens. */
export async function loadAll(): Promise<void> {
  const fill = document.getElementById('boot-fill');
  const label = document.getElementById('boot-pct');
  const bar = fill?.parentElement;
  const tasks: Promise<unknown>[] = [...allArt().map(picture), ...FONTS.map((f) => document.fonts?.load(f, SAMPLE)), warmBot()];
  let done = 0;
  const step = () => {
    done++;
    const pct = Math.round((done / tasks.length) * 100);
    if (fill) fill.style.width = `${pct}%`;
    if (label) label.textContent = `${pct}%`;
    bar?.setAttribute('aria-valuenow', String(pct));
  };
  await Promise.all(tasks.map((t) => Promise.resolve(t).catch(() => {}).then(step)));
}

/** Fades the loading screen out over the menu that is already drawn under it. */
export function hideLoading(): void {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 450);
}
