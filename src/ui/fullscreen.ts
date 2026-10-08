/**
 * Full screen in the browser tab, through the Fullscreen API (Android, desktop, iPad).
 * The iPhone's Safari has no such API for pages, so there the game can only go full screen
 * from an icon on the home screen (public/manifest.webmanifest); the switch explains how instead.
 */
type FsDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => void };

const doc = document as FsDocument;

export const fullscreenSupported = (): boolean => !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);

export const isFullscreen = (): boolean => !!(doc.fullscreenElement || doc.webkitFullscreenElement);

/** Opened from the home-screen icon, so already without the browser's bars: the switch is not needed. */
export function launchedFromIcon(): boolean {
  if (isFullscreen()) return false;
  const mode = (m: string) => window.matchMedia?.(`(display-mode: ${m})`).matches;
  return mode('fullscreen') || mode('standalone') || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function setFullscreen(on: boolean) {
  if (on === isFullscreen()) return;
  if (on) {
    const el = document.documentElement as FsElement;
    if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    else el.webkitRequestFullscreen?.();
  } else if (doc.exitFullscreen) doc.exitFullscreen().catch(() => {});
  else doc.webkitExitFullscreen?.();
}

/** Called whenever full screen is entered or left, by the switch or by the browser (Back, Esc). */
export function onFullscreenChange(cb: () => void) {
  document.addEventListener('fullscreenchange', cb);
  document.addEventListener('webkitfullscreenchange', cb);
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** How to get the game full screen where the browser cannot do it for a page. */
export function showInstallHint() {
  const steps = isIos()
    ? `<p>Safari на iPhone не умеет открывать игры на весь экран прямо во вкладке. Зато можно поставить игру на экран «Домой», и с иконки она откроется без адресной строки:</p>
      <ol><li>Нажмите «Поделиться» (квадрат со стрелкой вверх) внизу Safari.</li>
      <li>Выберите «На экран „Домой“» и нажмите «Добавить».</li>
      <li>Запускайте игру с новой иконки Dark Realm.</li></ol>`
    : `<p>Этот браузер не умеет открывать игры на весь экран. Добавьте игру на главный экран через меню браузера («Установить приложение» или «Добавить на главный экран»), и с иконки она откроется на весь экран.</p>`;
  const box = document.createElement('div');
  box.className = 'overlay sheet-wrap';
  box.innerHTML = `<div class="sheet install-hint"><h2>Весь экран</h2>${steps}
    <div class="sheet-actions"><button data-close>Понятно</button></div></div>`;
  box.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    if (t === box || t.closest('[data-close]')) box.remove();
  });
  document.body.appendChild(box);
}
