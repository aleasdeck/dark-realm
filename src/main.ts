import './fonts.css';
import './style.css';
import logoUrl from './assets/app/logo.webp';
import { BOT_LEVELS, type BotLevel } from './engine/bot';
import { cardDef, LOCKED, PATRONS } from './engine/cards';
import { actingPlayer, canCancel, draftedBy, mayDraft } from './engine/engine';
import { PATRON_RULES } from './engine/text';
import type { Card, GameState, PatronId, ScriptId } from './engine/types';
import { hostRoom, joinRoom, newRoomCode, normalizeCode } from './net/room';
import { DEFAULT_NAME, flushReports, ratingLine, ratingUrl, sameName, topPlayers, type RatedPlayer } from './net/rating';
import { forgetMatch, leaveTab, savedMatch } from './net/saved';
import { BotController, Controller, GuestController, HostController } from './ui/controller';
import { closeCoin, coinFace, showCoin } from './ui/coin';
import { clearFx, onStateChange } from './ui/feed';
import { musicVolume, preloadMusic, setMusicScene, setMusicVolume, unlockMusic } from './ui/music';
import { play, setSoundVolume, soundVolume, unlock } from './ui/sound';
import {
  boardHtml,
  cardHtml,
  esc,
  focusView,
  lostMark,
  paintIcons,
  patronEmblem,
  patronTipHtml,
  pileGridHtml,
  richText,
  tavernPick,
  tileHtml,
  type Focus,
} from './ui/render';
import { hideTooltip, initTooltips, refreshTooltip } from './ui/tooltip';
import { icon, withIcon } from './ui/icons';
import { themedScroll } from './ui/scroll';
import { fullscreenSupported, isFullscreen, launchedFromIcon, onFullscreenChange, setFullscreen, showInstallHint } from './ui/fullscreen';
import { animateChange, clearMotion, motionOn, setMotion, snapshot, still } from './ui/motion';
import { initPlayed, restorePlayed, savePlayed } from './ui/played';
import { initDrag, restoreDrag } from './ui/drag';
import { initFit } from './ui/fit';
import { journalHtml } from './ui/journal';
import { formatClock, HOURGLASS } from './ui/clock';
import { hideLoading, loadAll } from './ui/loading';
import { fadeIn, initMenuFx, playMenu, shootMenu } from './ui/menuFx';
import { savedBotGame } from './ui/savedGame';
import { Coach, finale, hintAllows, showHint, type Hint } from './ui/tutorial';
import { lessonDone, markLessonDone, newcomer } from './ui/lessons';
import { isUnlocked, UNLOCK_AT, unlockHint, unlockLeft } from './ui/unlocks';
import { bindCollection, collectionHtml } from './ui/collection';
import { clearPhrases, markSaid, maySay, sayAt, sayMenuHtml, showPhrase, type SayAt } from './ui/say';
import { isPhrase } from './net/phrases';

const app = document.getElementById('app')!;
let ctrl: Controller | null = null;
let selected = new Set<number>();
let pendingKey = '';
let autoPlay = false;
/** Open sheet; the played cards one follows the table live, so a play while it is open shows up in it. */
let modal:
  | { kind: 'pile'; title: string; cards: Card[] }
  | { kind: 'played'; side: 'me' | 'opp' }
  | { kind: 'log' }
  | { kind: 'menu' }
  | ({ kind: 'say' } & SayAt)
  | null = null;
let focus: Focus | null = null;
/**
 * A card opened from a sheet (a pile or a choice) to read its text; ref is set when the card
 * is an option of the current choice, so the enlarged card can also pick it.
 */
let peek: { id: string; ref?: number } | null = null;
let animatedFocus = '';
let lastState: GameState | null = null;
let lastError = '';
/** Hints of the tutorial game; null in every other game. */
let coach: Coach | null = null;
/** The hint for the current state; while it is up, only what it points at responds. */
let hint: Hint | null = null;
/** Whether this game's coin toss has been shown; the tutorial tosses none. */
let tossed = false;

const NAME_KEY = 'dark-realm-name';
function playerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || DEFAULT_NAME;
  } catch {
    return DEFAULT_NAME;
  }
}
function saveName(n: string) {
  try {
    if (n) localStorage.setItem(NAME_KEY, n);
    else localStorage.removeItem(NAME_KEY);
  } catch {
    /* storage unavailable */
  }
}

const LEVEL_NAMES: Record<BotLevel, string> = { gentle: 'Бродяга', easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный' };
const LEVEL_ICONS: Record<BotLevel, string> = { gentle: 'level_gentle', easy: 'level_easy', medium: 'level_medium', hard: 'level_hard' };

function roomFromUrl(): string {
  return normalizeCode(new URLSearchParams(location.search).get('room') ?? '');
}

function roomLink(code: string) {
  const u = new URL(location.href);
  const keep = ['peer', 'relay'].filter((k) => u.searchParams.get(k)).map((k) => `&${k}=${encodeURIComponent(u.searchParams.get(k)!)}`);
  u.search = `?room=${code}${keep.join('')}`;
  u.hash = '';
  return u.toString();
}

// ── screens ──────────────────────────────────────────────

/** Back to the menu; `keep` leaves the match saved, to continue or reconnect from the menu. */
function leaveGame(message = '', keep = false) {
  if (keep) {
    ctrl?.suspend();
    leaveTab();
  } else ctrl?.dispose();
  ctrl = null;
  autoPlay = false;
  modal = null;
  focus = null;
  peek = null;
  lastState = null;
  coach = null;
  hint = null;
  closeCoin();
  clearFx();
  clearMotion();
  clearPhrases();
  const peer = new URLSearchParams(location.search).get('peer');
  history.replaceState(null, '', location.pathname + (peer ? `?peer=${encodeURIComponent(peer)}` : ''));
  menu(message);
}

/** The player chose to play without a nick: the network menu doesn't ask again until a reload. */
let nickAsked = false;
/** Where the nick screen leads on to. */
let nickNext: MenuView = 'net';

/** Screens of the main menu; each one but the first has a way back to the one it came from. */
type MenuView = 'home' | 'play' | 'learn' | 'bot' | 'net' | 'join' | 'nick' | 'collection' | 'rating' | 'settings';
const MENU_VIEWS: Record<MenuView, { title: string; back: MenuView }> = {
  home: { title: '', back: 'home' },
  play: { title: 'Играть', back: 'home' },
  learn: { title: 'Обучение', back: 'play' },
  bot: { title: 'Сложность бота', back: 'play' },
  net: { title: 'Сетевая игра', back: 'home' },
  join: { title: 'Присоединиться', back: 'net' },
  nick: { title: 'Ваш ник', back: 'home' },
  collection: { title: 'Коллекция', back: 'home' },
  rating: { title: 'Рейтинг', back: 'home' },
  settings: { title: 'Настройки', back: 'home' },
};

/** How far a screen lies from the first one, so the menu knows which way to slide. */
function menuDepth(view: MenuView): number {
  let d = 0;
  for (let v = view; v !== 'home'; v = MENU_VIEWS[v].back) d++;
  return d;
}

const menuButton = (go: string, ic: string, label: string, cls = '', note = '') =>
  `<button class="menu-btn${cls ? ` ${cls}` : ''}" data-go="${go}">${withIcon(ic, label)}${note ? `<small>${note}</small>` : ''}</button>`;

function menuBody(view: MenuView): string {
  switch (view) {
    case 'home':
      return (
        menuButton('play', 'play_all', 'Играть') +
        menuButton('net', 'combo', 'Сетевая игра') +
        menuButton('collection', 'pile_deck', 'Коллекция') +
        menuButton('rating', 'win', 'Рейтинг') +
        menuButton('settings', 'settings', 'Настройки')
      );
    case 'play':
      // An unfinished game comes first, one tap away.
      return (
        (savedBotGame() ? menuButton('continue', 'rematch', 'Продолжить игру') : '') +
        menuButton('learn', 'tutorial', 'Обучение', newcomer() ? 'fresh' : '') +
        menuButton('bot', 'play_bot', 'Против бота')
      );
    case 'learn':
      // The basics glow until they are won; the advanced lesson is open from the start, only marked as the second.
      return (
        menuButton('lesson-basic', 'tutorial', 'Основы', lessonDone('basic') ? '' : 'fresh') +
        menuButton('lesson-advanced', 'rules', 'Продвинутое', '', lessonDone('basic') ? '' : 'после основ')
      );
    case 'bot':
      return BOT_LEVELS.map((v) => menuButton(`level-${v}`, LEVEL_ICONS[v], LEVEL_NAMES[v])).join('');
    case 'net':
      return (
        (savedMatch() ? menuButton('reconnect', 'combo', 'Переподключение') : '') +
        menuButton('host', 'host', 'Создать комнату') +
        menuButton('join', 'join', 'Присоединиться')
      );
    case 'join':
      return `<div class="join"><input id="code" placeholder="КОД КОМНАТЫ" maxlength="8" value="${esc(roomFromUrl())}" autocomplete="off"><button class="menu-btn" data-go="enter">${withIcon('join', 'Войти')}</button></div>`;
    case 'nick':
      return `<p class="nick-text">Придумайте ник: его увидит соперник, и под ним вы попадёте в рейтинг. Сменить ник можно в Настройках.</p>
        <input id="nick" maxlength="24" placeholder="Ваш ник" autocomplete="nickname">
        ${menuButton('nick-ok', 'confirm', 'Продолжить')}${menuButton('nick-skip', 'skip', 'Без ника')}`;
    case 'collection':
      return collectionHtml();
    case 'rating':
      return `<div class="rating-board">${ratingUrl() ? '<p class="wait">Загружаем…</p>' : '<p class="wait">Таблица рейтинга ещё не подключена.</p>'}</div>`;
    case 'settings':
      return `${scrolling(`<label class="field">Ваше имя <input id="name" maxlength="24" value="${esc(playerName())}" autocomplete="nickname"></label>
        <div class="settings">${settingsRows()}</div>`)}
        ${menuButton('rules', 'rules', 'Правила')}`;
  }
}

/** The main menu: a few buttons, each opening a screen of its own. A room link opens straight on joining it. */
function menu(message = '', view: MenuView = roomFromUrl() ? 'join' : 'home') {
  // A player without a nick is offered one on the way to a network game.
  if ((view === 'net' || view === 'join') && !nickAsked && sameName(playerName(), DEFAULT_NAME)) {
    nickNext = view;
    view = 'nick';
  }
  const v = MENU_VIEWS[view];
  const depth = menuDepth(view);
  const shot = shootMenu(app, depth, view);
  setMusicScene('menu');
  app.innerHTML = `<div class="menu home ${view === 'home' ? 'root' : 'sub'}" data-view="${view}">
    <h1 class="logo"><img src="${logoUrl}" alt="Dark Realm"></h1>
    ${view === 'home' ? '<p class="subtitle">Карточная дуэль владык тёмного мира</p>' : `<h2 class="menu-title">${v.title}</h2>`}
    <div class="menu-buttons">${menuBody(view)}${view === 'home' ? '' : menuButton('back', 'back', 'Назад')}</div>
    ${message ? `<p class="msg">${esc(message)}</p>` : ''}
  </div>`;
  const nameInput = app.querySelector<HTMLInputElement>('#name');
  nameInput?.addEventListener('input', () => saveName(nameInput.value.trim()));
  const nickInput = app.querySelector<HTMLInputElement>('#nick');
  const setNick = () => {
    const nick = nickInput!.value.trim();
    if (!nick || sameName(nick, DEFAULT_NAME)) return menu('Введите ник.', 'nick');
    saveName(nick);
    menu('', nickNext);
  };
  nickInput?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') setNick();
  });
  const codeInput = app.querySelector<HTMLInputElement>('#code');
  codeInput?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') join(playerName(), normalizeCode(codeInput.value));
  });
  const menuSettings = app.querySelector('.settings');
  if (menuSettings) bindVolumes(menuSettings);
  menuSettings?.addEventListener('click', (ev) => {
    const row = (ev.target as HTMLElement).closest<HTMLElement>('[data-set]');
    if (!row) return;
    const o = SETTINGS.find((x) => x.key === row.dataset.set)!;
    o.set(!o.on());
    app.querySelector('.settings')!.innerHTML = settingsRows();
  });
  app.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) =>
    b.addEventListener('click', () => {
      const go = b.dataset.go!;
      const n = playerName();
      if (go === 'back') return menu('', v.back);
      if (go === 'play' || go === 'learn' || go === 'net' || go === 'collection' || go === 'rating' || go === 'settings' || go === 'bot' || go === 'join') return menu('', go);
      if (go === 'rules') return showRules();
      if (go === 'nick-ok') return setNick();
      if (go === 'nick-skip') {
        nickAsked = true;
        return menu('', nickNext);
      }
      if (go === 'continue') return continueBotGame();
      if (go === 'reconnect') return resume(false) || menu('Партия уже закончилась.', 'net');
      if (go.startsWith('lesson-')) return startLesson(go.slice(7) as ScriptId);
      if (go.startsWith('level-')) return startGame(new BotController(n, go.slice(6) as BotLevel));
      if (go === 'host') return host(n);
      if (go === 'enter') return join(n, normalizeCode(codeInput!.value));
    }),
  );
  if (view === 'rating' && ratingUrl()) loadRating();
  bindCollection(app);
  themedScroll(app);
  playMenu(app, shot, depth);
}

/** The emblem of a player's favourite deck in the rating; nothing for an unknown patron or none yet. */
function deckEmblem(id: string | undefined): string {
  if (!id || !(id in PATRONS) || id === 'treasury') return '';
  const pid = id as PatronId;
  return `<img src="${patronEmblem(pid)}" alt="${esc(PATRONS[pid].name)}" title="${esc(PATRONS[pid].name)}">`;
}

/** Fills the rating screen once the table arrives, if the player is still on it. */
async function loadRating() {
  const board = app.querySelector<HTMLElement>('.rating-board')!;
  let players: RatedPlayer[];
  try {
    players = await topPlayers();
  } catch {
    if (board.isConnected) board.innerHTML = '<p class="wait">Не удалось загрузить рейтинг. Проверьте связь.</p>';
    return;
  }
  if (!board.isConnected) return;
  const name = playerName();
  const rows = players
    .map(
      (p, i) => `<li class="${sameName(p.name, name) ? 'me' : ''}"><span class="r-place">${i + 1}</span><span class="r-name">${esc(p.name)}</span>
        <span class="r-deck">${deckEmblem(p.deck)}</span><span class="r-score">${p.rating}</span><span class="r-win">${p.wins}</span><span class="r-loss">${p.losses}</span></li>`,
    )
    .join('');
  board.innerHTML = rows
    ? `<div class="rating-head"><span class="r-place">#</span><span class="r-name">Игрок</span><span class="r-deck">Колода</span><span class="r-score">Рейтинг</span><span class="r-win" title="Победы">${icon('win', 'П')}</span><span class="r-loss" title="Поражения">${icon('lose', 'Пр')}</span></div><ol class="rating-list">${rows}</ol>`
    : '<p class="wait">В рейтинге пока никого нет. Сыграйте сетевую партию!</p>';
  board.querySelector('.me')?.scrollIntoView({ block: 'nearest' });
}

/** Music and sound volumes on sliders; the same sheet opens from the main menu and in a game. */
const VOLUMES = [
  { key: 'music', label: 'Музыка', icon: 'set_music', get: musicVolume, set: setMusicVolume },
  { key: 'sound', label: 'Звуки', icon: 'set_sound', get: soundVolume, set: setSoundVolume },
];

/** Animations and full screen, each switched on or off. */
const SETTINGS = [
  { key: 'motion', label: 'Анимации', icon: 'set_motion', on: motionOn, set: setMotion },
  // Where the browser cannot go full screen (iPhone), the switch tells how to put the game on the home screen.
  { key: 'fullscreen', label: 'Весь экран', icon: 'fullscreen', on: isFullscreen, set: (on: boolean) => (fullscreenSupported() ? setFullscreen(on) : showInstallHint()) },
];

// Full screen also ends from the browser (Back, Esc), so open switches follow it.
onFullscreenChange(() => document.querySelectorAll('.settings').forEach((el) => (el.innerHTML = settingsRows())));

const volumeText = (v: number) => (v ? `${v}%` : 'Выкл');

function settingsRows() {
  const sliders = VOLUMES.map(
    (o) => `<label class="vol-row" data-vol="${o.key}"><span class="t-label">${icon(o.icon)}<span>${o.label}</span></span>
      <input type="range" min="0" max="100" step="5" value="${o.get()}" aria-label="Громкость: ${o.label}"><b>${volumeText(o.get())}</b></label>`,
  ).join('');
  return sliders + SETTINGS.filter((o) => o.key !== 'fullscreen' || !launchedFromIcon()).map(
    (o) => `<button class="toggle" data-set="${o.key}" aria-pressed="${o.on()}"><span class="t-label">${icon(o.icon)}<span>${o.label}</span></span><b>${o.on() ? 'Вкл' : 'Выкл'}</b></button>`,
  ).join('');
}

/** Volume sliders act while dragged; the effects slider plays a click on release, so the level can be heard. */
function bindVolumes(root: Element) {
  root.addEventListener('input', (ev) => {
    const input = ev.target as HTMLInputElement;
    const row = input.closest<HTMLElement>('[data-vol]');
    if (!row) return;
    const o = VOLUMES.find((x) => x.key === row.dataset.vol)!;
    unlock();
    o.set(Number(input.value));
    row.querySelector('b')!.textContent = volumeText(o.get());
  });
  root.addEventListener('change', (ev) => {
    const row = (ev.target as HTMLElement).closest<HTMLElement>('[data-vol="sound"]');
    if (row) play('click');
  });
}

function showSettings() {
  const box = document.createElement('div');
  box.className = 'overlay sheet-wrap';
  box.innerHTML = `<div class="sheet settings-sheet"><h2>Настройки</h2>${scrolling(`<div class="settings">${settingsRows()}</div>`)}
    <div class="sheet-actions"><button data-close>${withIcon('confirm', 'Готово')}</button></div></div>`;
  bindVolumes(box);
  box.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const row = t.closest<HTMLElement>('[data-set]');
    if (row) {
      const o = SETTINGS.find((x) => x.key === row.dataset.set)!;
      o.set(!o.on());
      box.querySelector('.settings')!.innerHTML = settingsRows();
      return;
    }
    if (t === box || t.closest('[data-close]')) box.remove();
  });
  document.body.appendChild(box);
  themedScroll(box);
}

/** Wraps a list that may not fit a small screen, so it scrolls with the game's scroll bar (src/ui/scroll.ts). */
function scrolling(html: string) {
  return `<div class="tscroll"><div class="tscroll-body">${html}</div></div>`;
}

function rulesHtml() {
  const patrons = (Object.keys(PATRON_RULES) as PatronId[])
    .map((p) => {
      const lock = isUnlocked(p) ? '' : ` ${icon('lock', '🔒')} (${unlockHint(p).replace(/\.$/, '').toLowerCase()})`;
      return `<li><b>${esc(PATRONS[p].name)}</b>${lock}: ${richText(PATRON_RULES[p].cost)} → ${richText(PATRON_RULES[p].effect)}</li>`;
    })
    .join('');
  return paintIcons(`<ul>
    <li>В начале партии бросается монетка. Кому выпало, тот первым выбирает владыку и первым ходит, а второй игрок получает в свой первый ход контракт «Фальшивая монета» (+1 ●). Его надо разыграть в этот же ход, иначе он сгорит.</li>
    <li>Игроки по очереди выбирают 4 владык: первый, второй, второй, первый. Их колоды образуют таверну. Сундук Бездны есть всегда.</li>
    <li>Начальная колода: 6 «Золота» и по одной начальной карте каждого владыки. В руке 5 карт.</li>
    <li>Сыгранные карты дают <b>монеты</b> ● (покупка карт в таверне) и <b>силу</b> ⚔ (в конце хода становится престижем ✦ или идёт на атаку наймитов).</li>
    <li><b>Комбо N</b> срабатывает, когда за ход сыграно N карт одного владыки, даже задним числом.</li>
    <li><b>Наймиты</b> остаются на поле и действуют каждый ход. Наймитов с провокацией надо сразить первыми, а в конце хода остаток силы сам бьёт по ним и только потом становится престижем.</li>
    <li><b>Контракты</b> срабатывают сразу при покупке и не попадают в колоду. Колода Сундука Бездны целиком из контрактов.</li>
    <li><b>Морок</b> (проклятие) надо разыграть раньше остальных карт в руке.</li>
    <li>Нажмите на карту, и она увеличится. Кнопка под ней разыграет её. Ещё можно задержать палец на карте в руке и перетащить её на свой стол.</li>
    <li>Нажмите на счётчик колоды или сброса, своего или соперника, чтобы посмотреть эти карты. Порядок колоды скрыт.</li>
    <li>За ход можно один раз призвать владыку. Он становится благосклонен к вам, а если благоволил сопернику, то нейтрален. Ворон нейтрален только в начале игры: после призыва он сразу на вашей стороне.</li>
    <li>Победа: 40 ✦ и перевес после хода соперника, или сразу: 80 ✦ либо благосклонность всех 4 владык.</li>
  </ul>`) + `<ul class="patron-rules">${patrons}</ul>`;
}

function waiting(text: string, extra = '') {
  app.innerHTML = `<div class="menu"><h1 class="title small">Dark Realm</h1><p class="wait">${text}</p>${extra}
    <button data-go="back">${withIcon('back', 'Назад')}</button></div>`;
  app.querySelector('[data-go="back"]')!.addEventListener('click', () => leaveGame());
}

function startLesson(lesson: ScriptId) {
  startGame(new BotController(playerName(), 'gentle', undefined, lesson));
}

function host(name: string) {
  forgetNetMatches();
  startGame(new HostController(name, newRoomCode(), hostRoom));
}

/** The open room, waiting for the opponent: its code and a link to send. */
function roomScreen(code: string) {
  const link = roomLink(code);
  waiting(
    'Ждём соперника. Отправьте ему код или ссылку.',
    `<div class="room-code">${code}</div>
     <div class="join"><input readonly value="${esc(link)}" id="link"><button id="copy">${withIcon('copy', 'Копировать')}</button></div>`,
  );
  app.querySelector('#copy')?.addEventListener('click', () => {
    const input = app.querySelector<HTMLInputElement>('#link')!;
    input.select();
    navigator.clipboard?.writeText(input.value).catch(() => document.execCommand('copy'));
  });
}

function join(name: string, code: string) {
  if (!code) return menu('Введите код комнаты.', 'join');
  forgetNetMatches();
  startGame(new GuestController(code, name, joinRoom));
}

/** A new network game: an unfinished one is left for good. */
function forgetNetMatches() {
  forgetMatch('host');
  forgetMatch('guest');
}

/** The game against the bot left unfinished, where it was. */
function continueBotGame() {
  const g = savedBotGame();
  if (!g) return menu('Партия уже закончилась.', 'play');
  startGame(new BotController(playerName(), g.level, g.state));
}

/**
 * A network match picks up where it was: on its own when this tab played it before a reload
 * or a crash, or from «Переподключение» in the menu.
 */
function resume(thisTab = true): boolean {
  const m = savedMatch(thisTab);
  if (!m) return false;
  // A link to another room means the player is off to a new game.
  const linked = roomFromUrl();
  if (linked && linked !== m.code) {
    forgetMatch(m.role);
    return false;
  }
  if (m.role === 'host') startGame(new HostController(m.name, m.code, hostRoom, m));
  else startGame(new GuestController(m.code, m.name, joinRoom, true));
  return true;
}

function startGame(c: Controller) {
  setMusicScene('game');
  ctrl?.dispose();
  ctrl = c;
  selected = new Set();
  pendingKey = '';
  focus = null;
  modal = null;
  peek = null;
  lastState = null;
  lastError = '';
  coach = c instanceof BotController && c.tutorial ? new Coach(c.lesson) : null;
  hint = null;
  tossed = false;
  closeCoin();
  clearFx();
  clearMotion();
  clearPhrases();
  c.subscribe(render);
  c.onPhrase = (by, id) => {
    showPhrase(by === c.me ? 'me' : 'opp', id);
    if (by !== c.me) play('click');
  };
  render();
  fadeIn(app);
}

// ── game rendering ───────────────────────────────────────

function render() {
  if (!ctrl) return;
  if (ctrl.gone) return leaveGame(ctrl.gone);
  const s = ctrl.state;
  if (!s) {
    if (ctrl instanceof HostController && ctrl.ready && !ctrl.notice) roomScreen(ctrl.code);
    else waiting(esc(ctrl.notice || 'Ждём…'));
    return;
  }
  const me = ctrl.me;
  const prev = lastState;
  // The journal keeps its place while a card from it is open; otherwise it shows the latest moves.
  const oldLog = app.querySelector('.log-view .log');
  const logAt = oldLog && oldLog.scrollTop + oldLog.clientHeight < oldLog.scrollHeight - 8 ? oldLog.scrollTop : null;
  // Where the cards were, read before the board is redrawn, so the moved ones can fly.
  const snap = prev !== s ? snapshot(app) : null;
  onStateChange(prev, s, me, ctrl.clock);
  lastState = s;
  if (ctrl.error && ctrl.error !== lastError) play('error');
  lastError = ctrl.error;
  hint = coach?.hint(s, me) ?? null;
  if (ctrl instanceof BotController && ctrl.tutorial && s.phase === 'over' && s.winner === me) markLessonDone(ctrl.lesson);
  if (s.phase === 'draft') {
    app.innerHTML = draftHtml(s) + netOverlay(s) + sayMenu();
    if (hint) showHint(app, hint);
    // A match picked up after a reload doesn't toss again once the draft is under way.
    if (s.first !== undefined && !tossed && s.draftStep === 0) {
      tossed = true;
      const c = ctrl;
      showCoin(s.first === me, () => c.tossShown());
    }
  } else {
    const myTurn = s.current === me && s.phase === 'play';
    const idle = myTurn && !s.pending && s.queue.length === 0;
    syncPending(s);
    // Tavern picks happen on the table itself, with the usual tap-twice; other choices use the sheet.
    const pick = tavernPick(s, me, selected);
    if ((!pick && (s.pending?.player === me || autoPlay)) || s.phase === 'over') focus = null;
    const view = focus ? focusView(s, me, focus, idle, pick) : null;
    if (!view) focus = null;
    savePlayed(app);
    app.innerHTML = boardHtml(s, me, { myTurn, idle, focus, pick, net: netNames() }) + overlays(s);
    restorePlayed(app);
    restoreDrag();
    animateChange(app, snap, prev, s, me);
    if (view) showZoom(view.html, view.label, view.can);
    // The enlarged card says what to do itself, so the coach steps aside for it.
    if (hint && !view && !modal) showHint(app, hint);
  }
  if (!focus) animatedFocus = '';
  refreshTooltip();
  const log = app.querySelector('.log-view .log');
  if (log) log.scrollTop = logAt ?? log.scrollHeight;
  continueAutoPlay(s);
}

function continueAutoPlay(s: GameState) {
  if (!autoPlay || !ctrl) return;
  const me = ctrl.me;
  if (s.phase !== 'play' || s.current !== me) {
    autoPlay = false;
    return;
  }
  if (s.pending || s.queue.length) return; // resume after the choice
  const hand = s.players[me].hand;
  const next = hand.find((c) => cardDef(c.id).type === 'curse') ?? hand[0];
  if (!next) {
    autoPlay = false;
    return;
  }
  setTimeout(() => ctrl?.dispatch({ t: 'play', uid: next.uid }), 120);
}

function draftHtml(s: GameState): string {
  const me = ctrl!.me;
  const turn = actingPlayer(s);
  const mine = turn === me;
  // Each player's two picks as emblems, with empty slots for the ones still to come numbered
  // in pick order (first, second, second, first); the slot the acting player fills next glows.
  const picks = (pi: 0 | 1) => {
    const mine = s.patrons.filter((pid) => draftedBy(s, pid) === pi);
    const order = pi === (s.first ?? 0) ? [1, 4] : [2, 3];
    return [0, 1]
      .map((i) => {
        const pid = mine[i];
        if (!pid) return `<span class="pick-slot${turn === pi && i === mine.length ? ' next' : ''}" data-n="${order[i]}"></span>`;
        const p = PATRONS[pid];
        return `<span class="pick" style="--glow:${p.palette.glow}"><img src="${patronEmblem(pid)}" alt=""><small>${esc(p.name)}</small></span>`;
      })
      .join('');
  };
  // The coin as it fell, beside the name of whoever moves first: the sun if it is you, the moon if not.
  const coin = (pi: 0 | 1) => (s.first === pi ? `<span class="pick-coin" title="Ходит первым">${coinFace(pi === me)}</span>` : '');
  const tile = (pid: PatronId, locked: boolean) => {
    const p = PATRONS[pid];
    const r = PATRON_RULES[pid];
    const can = mine && !locked;
    return `<div class="draft-tile${can ? ' can' : ''}${locked ? ' locked' : ''}" ${can ? `data-act="draft" data-patron="${pid}"` : ''} style="--accent:${p.palette.accent};--glow:${p.palette.glow}">
        <img src="${patronEmblem(pid)}" alt="">
        <h3>${esc(p.name)}</h3><p class="p-title">${esc(p.title)}</p>
        <p><b>Призыв:</b> ${richText(r.cost)} → ${richText(r.effect)}</p>
        ${locked ? `<p class="lock-left">${icon('lock', '🔒')} ${esc(unlockLeft(pid))}</p>` : ''}
      </div>`;
  };
  // Locked patrons are listed too, greyed out, with the wins left until they open. Online,
  // a patron only the opponent opened stays greyed out here, though the opponent may take it.
  // The tutorial offers only its own four patrons.
  const tutorial = ctrl instanceof BotController && ctrl.tutorial;
  const open = s.draftPool.filter((pid) => mayDraft(s, me, pid));
  const locked = (tutorial ? [] : LOCKED).filter((pid) => !open.includes(pid) && !s.patrons.includes(pid)).sort(
    (a, b) => (UNLOCK_AT[a] ?? 0) - (UNLOCK_AT[b] ?? 0),
  );
  const tiles = open.map((pid) => tile(pid, false)).join('') + locked.map((pid) => tile(pid, true)).join('');
  return `<div class="draft">
    <h2>${mine ? 'Выберите владыку' : `Выбирает ${esc(s.players[turn].name)}…`}</h2>
    <div class="draft-picks">${([me, me === 0 ? 1 : 0] as const)
      .map((pi) => `<div><b>${coin(pi)}${nameHtml(s.players[pi].name, pi === me ? 'me' : 'opp')}</b><span class="picks">${picks(pi)}</span></div>`)
      .join('')}</div>
    <div class="draft-tiles">${tiles}</div>
    <button class="ghost" data-act="exit">${withIcon('back', 'Выйти')}</button>
  </div>`;
}

/** What a network table does with the players' names: they open the phrases, and the opponent's shows them gone. */
function netNames(): { say: boolean; lost: boolean } | undefined {
  if (!(ctrl instanceof HostController || ctrl instanceof GuestController)) return undefined;
  return { say: true, lost: ctrl instanceof HostController && ctrl.reconnecting };
}

/** A player's name in the draft; online it opens the phrases, and the opponent's shows when they are gone. */
function nameHtml(name: string, side: 'me' | 'opp'): string {
  const net = netNames();
  if (!net) return esc(name);
  return `<span class="say-name" data-act="say" data-side="${side}">${esc(name)}</span>${side === 'opp' && net.lost ? lostMark() : ''}`;
}

/** The phrase menu, while it is open. */
function sayMenu(): string {
  return modal?.kind === 'say' ? sayMenuHtml(modal) : '';
}

/** A new choice starts with nothing selected. */
function syncPending(s: GameState) {
  const p = s.pending;
  const key = p ? `${s.turn}:${p.kind}:${p.options.map((o) => o.ref).join(',')}` : '';
  if (key !== pendingKey) {
    pendingKey = key;
    selected = new Set();
    if (peek?.ref !== undefined) peek = null;
  }
}

/**
 * A network match with the other side gone: the guest can't move at all, so the table waits
 * under a dialog until the host is back; the host plays on with a notice up until the guest returns.
 */
function netOverlay(s: GameState): string {
  if (s.phase === 'over') return '';
  if (ctrl instanceof GuestController && ctrl.offline) {
    return `<div class="overlay"><div class="dialog reconnect"><h2>${lostMark()}Нет связи</h2>
      <p class="wait">${esc(ctrl.notice)}</p>
      <div class="buttons"><button class="ghost" data-act="exit">${withIcon('back', 'В меню')}</button></div></div></div>`;
  }
  if (ctrl instanceof HostController && !ctrl.online && ctrl.notice) return `<div class="toast away">${esc(ctrl.notice)}</div>`;
  return '';
}

/** The game time so far, as the journal's title shows it. */
function logClock(): string {
  return ctrl ? `${HOURGLASS}${formatClock(ctrl.clock.elapsed())}` : '';
}

// While the journal is open its clock goes on ticking; the rest of the sheet stays as it is.
setInterval(() => {
  const el = modal?.kind === 'log' ? app.querySelector('.log-view .log-clock') : null;
  if (el) el.innerHTML = logClock();
}, 1000);

// The game clock stands while the page is hidden (another app, a locked phone).
document.addEventListener('visibilitychange', () => ctrl?.shownChanged());

function overlays(s: GameState): string {
  const me = ctrl!.me;
  const net = netOverlay(s);
  if (net && ctrl instanceof GuestController) return net;
  let html = net;
  // While the guest is away, the host's notice says so in place of the usual banner.
  const banner = net ? '' : ctrl!.notice || ctrl!.error;
  if (banner) html += `<div class="toast">${esc(banner)}</div>`;
  const lesson = ctrl instanceof BotController && ctrl.tutorial ? finale(ctrl.lesson, s, me) : null;
  if (lesson) {
    // Two halves, side by side on a landscape screen: the vagrant's word, then what comes next.
    html += `<div class="overlay"><div class="dialog end-dialog win lesson-end">
      <div class="lesson-head">${icon('win', '', 'end-ic')}<h2>${esc(lesson.title)}</h2>
      <p class="lesson-quote"><b>${esc(s.players[me === 0 ? 1 : 0].name)}:</b> «${richText(lesson.quote)}»</p></div>
      <div class="lesson-body"><ul class="lesson-points">${lesson.points.map((x) => `<li>${richText(x)}</li>`).join('')}</ul>
      ${lesson.next ? `<div class="buttons"><button data-act="next-lesson" data-lesson="${lesson.next}">${withIcon('rules', 'Продвинутое обучение')}</button></div>` : ''}
      <div class="buttons"><button data-act="rematch" class="${lesson.next ? 'ghost' : ''}">${withIcon('rematch', 'Пройти ещё раз')}</button>
      <button class="ghost" data-act="leave">${withIcon('back', 'В меню')}</button></div></div></div></div>`;
    return html;
  }
  if (s.phase === 'over') {
    const win = s.winner === me;
    html += `<div class="overlay"><div class="dialog end-dialog ${win ? 'win' : 'lose'}">
      ${icon(win ? 'win' : 'lose', '', 'end-ic')}<h2>${win ? 'Победа' : 'Поражение'}</h2><p>${esc(s.players[s.winner!].name)}: ${richText(s.winReason)}</p>
      <p>Престиж ${s.players[me].prestige} : ${s.players[me === 0 ? 1 : 0].prestige}</p>
      ${ctrl!.rating ? `<p class="rating-line">${icon('win')}<span>${esc(ratingLine(ctrl!.rating, s.players[me].name))}</span></p>` : ''}
      ${ctrl!.unlocked.map((pid) => `<p class="unlocked"><img src="${patronEmblem(pid)}" alt=""><span>Открыт владыка <b>${esc(PATRONS[pid].name)}</b></span></p>`).join('')}
      <div class="buttons">${ctrl instanceof BotController ? `<button data-act="rematch">${withIcon('rematch', ctrl.tutorial ? 'Пройти ещё раз' : 'Ещё партия')}</button>` : ''}
      <button data-act="leave">${withIcon('back', 'В меню')}</button></div></div></div>`;
    return html;
  }
  if (s.pending) {
    const p = s.pending;
    if (p.player !== me) {
      if (!banner && !net) html += `<div class="toast">Соперник делает выбор…</div>`;
    } else if (!tavernPick(s, me, selected)) {
      // One card at most: a tap picks it at once, and an optional pick can be skipped.
      const single = p.max === 1;
      const opts = p.options
        .map((o) => {
          const sel = selected.has(o.ref) ? ' selected' : '';
          return o.cardId
            ? `<div class="opt-card${sel}" data-act="peek" data-card="${o.cardId}" data-ref="${o.ref}">${tileHtml(o.cardId)}<span>${richText(o.label)}</span></div>`
            : `<button class="opt${sel}" data-act="pick" data-ref="${o.ref}">${richText(o.label)}</button>`;
        })
        .join('');
      const ok = selected.size >= p.min && selected.size <= p.max;
      // A patron call or a card that only opened this choice can be called off: nothing is spent.
      const cancel = canCancel(s, me) ? `<button class="ghost" data-act="cancel">${withIcon('cancel', 'Отмена')}</button>` : '';
      const done =
        single && p.min > 0
          ? ''
          : `<button data-act="confirm" ${ok ? '' : 'disabled'}>${single || (selected.size === 0 && p.min === 0) ? withIcon('skip', 'Пропустить') : withIcon('confirm', `Готово (${selected.size})`)}</button>`;
      const buttons = cancel + done;
      const range = p.min === p.max ? `${p.min}` : p.min === 0 ? `до ${p.max}` : `${p.min}–${p.max}`;
      html += `<div class="overlay sheet-wrap"><div class="sheet choice">
        <h2>${esc(p.prompt)}</h2><p class="hint">Выберите ${range}</p>
        <div class="options">${opts}</div>
        ${buttons ? `<div class="buttons">${buttons}</div>` : ''}
      </div></div>`;
    }
  }
  if (modal?.kind === 'log') {
    html += `<div class="overlay sheet-wrap" data-act="close"><div class="sheet log-view">
      <h2>Журнал партии<span class="log-clock" title="Время партии">${logClock()}</span></h2>
      <div class="log">${journalHtml(s, me, (n) => ctrl?.clock.turnStart(n))}</div>
      <div class="sheet-actions"><button data-act="close">${withIcon('close', 'Закрыть')}</button></div></div></div>`;
  } else if (modal?.kind === 'menu') {
    html += `<div class="overlay sheet-wrap" data-act="close"><div class="sheet menu-sheet">
      <h2>Меню${ctrl instanceof HostController || ctrl instanceof GuestController ? `<span class="room-tag">Комната <b>${esc(ctrl.code)}</b></span>` : ''}</h2>
      <div class="sheet-actions column">
        <button data-act="log">${withIcon('log', 'Журнал партии')}</button>
        <button data-act="rules">${withIcon('rules', 'Правила')}</button>
        <button data-act="settings">${withIcon('settings', 'Настройки')}</button>
        <button data-act="exit">${withIcon('menu', 'Выйти в меню')}</button>
        <button class="danger" data-act="concede">${withIcon('concede', 'Сдаться')}</button>
        <button class="ghost" data-act="close">${withIcon('back', 'Вернуться к игре')}</button>
      </div></div></div>`;
  } else if (modal?.kind === 'say') {
    html += sayMenu();
  } else if (modal?.kind === 'pile') {
    const cards = [...modal.cards].sort((a, b) => cardDef(a.id).name.localeCompare(cardDef(b.id).name));
    html += pileSheet(`${modal.title} (${cards.length})`, cards);
  } else if (modal?.kind === 'played') {
    // In the order they were played; the turn passing sends them to the discard and shuts the sheet.
    const cards = s.players[modal.side === 'me' ? me : me === 0 ? 1 : 0].played;
    if (cards.length) html += pileSheet(`${modal.side === 'me' ? 'Вы разыграли' : 'Соперник разыграл'} за ход (${cards.length})`, cards);
    else modal = null;
  }
  if (peek && (modal?.kind === 'pile' || modal?.kind === 'played' || modal?.kind === 'log' || (peek.ref !== undefined && s.pending?.player === me))) html += peekHtml(s.pending, peek);
  else peek = null;
  return html;
}

function pileSheet(title: string, cards: Card[]): string {
  return `<div class="overlay sheet-wrap" data-act="close"><div class="sheet pile-view">
      <h2>${esc(title)}</h2>
      <div class="options">${pileGridHtml(cards) || '<p>Пусто</p>'}</div>
      <div class="sheet-actions"><button data-act="close">${withIcon('close', 'Закрыть')}</button></div></div></div>`;
}

/**
 * A card from a sheet, enlarged over it so its text can be read. An option of a choice gets a
 * button that picks it (as does a second tap on the card); anything else closes it.
 */
function peekHtml(p: GameState['pending'], k: { id: string; ref?: number }): string {
  let pick = '';
  if (p && k.ref !== undefined) {
    const on = selected.has(k.ref);
    const full = p.max > 1 && !on && selected.size >= p.max;
    const label = on ? 'Снять выбор' : full ? `Выбрано уже ${selected.size}` : 'Выбрать';
    pick = `<button data-act="peek-pick" ${full ? 'disabled' : ''}>${on ? withIcon('cancel', label) : withIcon('confirm', label)}</button>`;
  }
  const act = pick && !pick.includes('disabled') ? 'peek-pick' : 'peek-close';
  return `<div class="overlay peek" data-act="peek-close">
    <div class="peek-card${act === 'peek-pick' ? ' can' : ''}" data-act="${act}">${cardHtml(k.id, { cls: 'big' })}</div>
    <div class="peek-actions"><button class="ghost" data-act="peek-close">${pick ? withIcon('back', 'Назад') : withIcon('close', 'Закрыть')}</button>${pick}</div>
  </div>`;
}

const focusKey = (f: Focus) => (f.kind === 'card' ? `card:${f.uid}` : `patron:${f.patron}`);

/**
 * The selected card slides out of its place enlarged, without dimming the table;
 * the button under it performs the action.
 */
function showZoom(html: string, label: string, can: boolean) {
  const f = focus!;
  const src = app.querySelector<HTMLElement>(
    f.kind === 'card' ? `.game [data-act="inspect"][data-uid="${f.uid}"]` : `.game [data-patron="${f.patron}"]`,
  );
  const zoom = document.createElement('div');
  zoom.className = `zoom${can ? ' can' : ''}${f.kind === 'patron' ? ' patron-zoom' : ''}`;
  // Tapping the enlarged card itself does nothing: only its button acts.
  zoom.dataset.act = 'zoom';
  if (f.kind === 'card') zoom.dataset.zoomUid = String(f.uid);
  const act = can ? `<button class="zoom-act" data-act="confirm-focus">${richText(label)}</button>` : `<div class="zoom-act">${richText(label)}</div>`;
  zoom.innerHTML = `${html}${label ? act : ''}`;
  app.appendChild(zoom);
  if (!src) return;
  const r = src.getBoundingClientRect();
  const w = zoom.offsetWidth;
  const h = zoom.offsetHeight;
  const vw = innerWidth;
  const vh = innerHeight;
  const x = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2));
  // Cards in the lower half rise above their place, so a second tap on the card doesn't land on
  // the button; the rest grow downward out of their place.
  const below = r.top + r.height / 2 > vh / 2;
  const y = Math.max(8, Math.min(vh - h - 8, below ? r.top - h - 6 : r.top));
  zoom.style.left = `${x}px`;
  zoom.style.top = `${y}px`;
  const key = focusKey(f);
  if (key === animatedFocus || still()) return;
  animatedFocus = key;
  const dx = r.left + r.width / 2 - (x + w / 2);
  const dy = r.top + r.height / 2 - (y + h / 2);
  zoom.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${Math.max(0.2, r.width / w)})`, opacity: 0.4 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: 190, easing: 'cubic-bezier(.2,.9,.3,1.2)' },
  );
}

/** A tap selects a card or patron; a second tap on it puts it back. Its button performs the action. */
function tapFocus(next: Focus) {
  const s = ctrl!.state!;
  const me = ctrl!.me;
  if (focus && focusKey(focus) === focusKey(next)) {
    focus = null;
    return render();
  }
  focus = next;
  const view = focusView(s, me, next, idleNow(s), tavernPick(s, me, selected));
  if (view) play('click');
  render();
}

function confirmFocus() {
  const s = ctrl!.state!;
  const view = focus ? focusView(s, ctrl!.me, focus, idleNow(s), tavernPick(s, ctrl!.me, selected)) : null;
  if (view?.can && view.mark !== undefined) {
    if (selected.has(view.mark)) selected.delete(view.mark);
    else selected.add(view.mark);
    play('click');
  }
  if (!view?.can || !view.action) {
    focus = null;
    return render();
  }
  focus = null;
  ctrl!.dispatch(view.action);
}

function idleNow(s: GameState) {
  return s.current === ctrl!.me && s.phase === 'play' && !s.pending && s.queue.length === 0;
}

// ── input ────────────────────────────────────────────────

app.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!ctrl) return;
  if (!el) {
    // Tapping the empty table puts the selected card back.
    if (focus) {
      focus = null;
      render();
    }
    return;
  }
  if (!hintAllows(hint, el)) {
    play('error');
    app.querySelector('.coach')?.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
      { duration: 240 },
    );
    return;
  }
  const s = ctrl.state;
  const act = el.dataset.act!;
  const uid = Number(el.dataset.uid);
  if (act === 'leave') return leaveGame();
  if (act === 'next-lesson') return startLesson(el.dataset.lesson as ScriptId);
  if (act === 'exit') return leaveGame('', true);
  if (act === 'rematch' && ctrl instanceof BotController) {
    if (ctrl.tutorial) coach = new Coach(ctrl.lesson);
    tossed = false;
    return ctrl.restart();
  }
  if (act === 'tut-ok' || act === 'tut-skip') {
    if (act === 'tut-ok') coach?.ack(el.dataset.hint ?? '');
    else if (coach) coach.off = true;
    play('click');
    return render();
  }
  if (act === 'close') {
    if (el.classList.contains('overlay') && ev.target !== el) return;
    modal = null;
    peek = null;
    return render();
  }
  if (!s) return;
  if (['end', 'confirm', 'cancel', 'play-all', 'concede', 'menu', 'say', 'log', 'played', 'pile-deck', 'pile-cd', 'pile-opp-deck', 'pile-opp-cd'].includes(act)) focus = null;
  const me = ctrl.me;
  switch (act) {
    case 'draft':
      return ctrl.dispatch({ t: 'draft', patron: el.dataset.patron as PatronId });
    case 'play':
      return ctrl.dispatch({ t: 'play', uid });
    case 'activate':
      return ctrl.dispatch({ t: 'activate', uid });
    case 'attack':
      return ctrl.dispatch({ t: 'attack', uid });
    case 'buy':
      return ctrl.dispatch({ t: 'buy', uid });
    case 'patron':
      return ctrl.dispatch({ t: 'patron', patron: el.dataset.patron as PatronId });
    case 'end':
      autoPlay = false;
      return ctrl.dispatch({ t: 'end' });
    case 'play-all':
      autoPlay = true;
      return continueAutoPlay(s);
    case 'concede':
      if (confirm('Сдаться?')) ctrl.dispatch({ t: 'concede' });
      return;
    case 'peek':
      play('click');
      peek = { id: el.dataset.card!, ref: el.dataset.ref === undefined ? undefined : Number(el.dataset.ref) };
      return render();
    case 'peek-close':
      if (el.classList.contains('overlay') && ev.target !== el) return;
      peek = null;
      return render();
    case 'peek-pick':
    case 'pick': {
      const p = s.pending;
      const ref = act === 'peek-pick' ? peek?.ref : Number(el.dataset.ref);
      peek = null;
      if (!p || ref === undefined) return render();
      if (p.max === 1) return ctrl.dispatch({ t: 'choose', picks: [ref] });
      if (selected.has(ref)) selected.delete(ref);
      else if (selected.size < p.max) selected.add(ref);
      return render();
    }
    case 'confirm':
      return ctrl.dispatch({ t: 'choose', picks: [...selected] });
    case 'cancel':
      // A card taken back goes to the hand: «play all» stops rather than play it again.
      autoPlay = false;
      return ctrl.dispatch({ t: 'cancel' });
    case 'inspect':
      return tapFocus({ kind: 'card', uid });
    case 'played':
      play('click');
      modal = { kind: 'played', side: el.closest<HTMLElement>('.pl-list')?.dataset.side === 'opp' ? 'opp' : 'me' };
      return render();
    case 'inspect-patron':
      return tapFocus({ kind: 'patron', patron: el.dataset.patron as PatronId });
    case 'confirm-focus':
      return confirmFocus();
    case 'say':
      if (!maySay()) return play('error');
      modal = { kind: 'say', ...sayAt(el) };
      play('click');
      return render();
    case 'say-pick': {
      const id = el.dataset.phrase;
      modal = null;
      if (isPhrase(id) && ctrl.say(id)) markSaid();
      return render();
    }
    case 'menu':
      modal = { kind: 'menu' };
      return render();
    case 'settings':
      modal = null;
      render();
      return showSettings();
    case 'rules':
      modal = null;
      showRules();
      return;
    case 'log':
      modal = { kind: 'log' };
      return render();
    case 'pile-deck':
      modal = { kind: 'pile', title: 'Ваша колода (порядок скрыт)', cards: s.players[me].deck };
      return render();
    case 'pile-cd':
      modal = { kind: 'pile', title: 'Ваш сброс', cards: s.players[me].cooldown };
      return render();
    case 'pile-opp-deck':
      modal = { kind: 'pile', title: 'Колода соперника (порядок скрыт)', cards: s.players[me === 0 ? 1 : 0].deck };
      return render();
    case 'pile-opp-cd':
      modal = { kind: 'pile', title: 'Сброс соперника', cards: s.players[me === 0 ? 1 : 0].cooldown };
      return render();
  }
});

function showRules() {
  const box = document.createElement('div');
  box.className = 'overlay sheet-wrap';
  box.innerHTML = `<div class="sheet rules-sheet"><h2>Правила</h2><div class="rules-body">${rulesHtml()}</div>
    <div class="sheet-actions"><button>${withIcon('close', 'Закрыть')}</button></div></div>`;
  box.addEventListener('click', (ev) => {
    if (ev.target === box || (ev.target as HTMLElement).closest('button')) box.remove();
  });
  document.body.appendChild(box);
  render();
}

// Audio can only start after a user gesture.
const unlockAudio = () => {
  unlock();
  unlockMusic();
};
document.addEventListener('pointerdown', unlockAudio, { capture: true });
document.addEventListener('keydown', unlockAudio, { capture: true });

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && peek) {
    peek = null;
    render();
  } else if (ev.key === 'Escape' && (modal || focus)) {
    modal = null;
    focus = null;
    render();
  }
});

// The played-cards columns scroll one card per wheel notch.
initPlayed(app);

// A hand card picked up with a short hold is played by dropping it on your table.
initDrag(app, {
  canPlay(uid, el) {
    const s = ctrl?.state;
    if (!s || s.phase !== 'play' || autoPlay || !hintAllows(hint, el)) return false;
    const view = focusView(s, ctrl!.me, { kind: 'card', uid }, idleNow(s), tavernPick(s, ctrl!.me, selected));
    return !!view?.can && view.action?.t === 'play';
  },
  lift() {
    hideTooltip();
    if (!focus) return;
    focus = null;
    render();
  },
  drop(uid) {
    play('click');
    ctrl?.dispatch({ t: 'play', uid });
  },
});

// Card and patron details on hover (mouse) or long press (touch).
initTooltips((el) => {
  const s = ctrl?.state ?? null;
  const me = ctrl?.me ?? 0;
  if (el.dataset.patron) return patronTipHtml(s, me, el.dataset.patron as PatronId);
  const id = el.dataset.card;
  if (!id) return null;
  const agent = s?.players.flatMap((p) => p.agents).find((a) => a.uid === Number(el.dataset.uid));
  return cardHtml(id, { cls: 'big tip-card', agent });
});
// Text reflows once the bundled fonts arrive, which moves whatever the coach points at.
document.fonts?.addEventListener('loadingdone', () => {
  if (hint) render();
});
window.addEventListener('resize', () => {
  hideTooltip();
  if (focus) render();
});

initFit();
initMenuFx();

// Results of network games that didn't reach the rating table before.
flushReports();

void loadAll().then(() => {
  if (!resume()) menu();
  hideLoading();
  preloadMusic();
});
