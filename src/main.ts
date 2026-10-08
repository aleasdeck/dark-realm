import './fonts.css';
import './style.css';
import logoUrl from './assets/app/logo.webp';
import { BOT_LEVELS, type BotLevel } from './engine/bot';
import { cardDef, LOCKED, PATRONS } from './engine/cards';
import { actingPlayer, canCancel, draftedBy, mayDraft } from './engine/engine';
import { PATRON_RULES } from './engine/text';
import type { Card, GameState, PatronId } from './engine/types';
import { hostRoom, joinRoom, newRoomCode, normalizeCode } from './net/room';
import { DEFAULT_NAME, flushReports, ratingLine, ratingUrl, sameName, topPlayers, type RatedPlayer } from './net/rating';
import { forgetMatch, savedMatch } from './net/saved';
import { BotController, Controller, GuestController, HostController } from './ui/controller';
import { closeCoin, coinFace, showCoin } from './ui/coin';
import { clearFx, onStateChange } from './ui/feed';
import { musicOn, setMusic, unlockMusic } from './ui/music';
import { play, setSound, soundOn, unlock } from './ui/sound';
import {
  boardHtml,
  cardHtml,
  esc,
  focusView,
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
import { animateChange, clearMotion, motionOn, setMotion, snapshot, still } from './ui/motion';
import { initPlayed, restorePlayed, savePlayed } from './ui/played';
import { hideLoading, loadAll } from './ui/loading';
import { Coach, hintAllows, showHint, type Hint } from './ui/tutorial';
import { isUnlocked, UNLOCK_AT, unlockHint, unlockLeft } from './ui/unlocks';

const app = document.getElementById('app')!;
let ctrl: Controller | null = null;
let selected = new Set<number>();
let pendingKey = '';
let autoPlay = false;
/** Open sheet; the played cards one follows the table live, so a play while it is open shows up in it. */
let modal: { kind: 'pile'; title: string; cards: Card[] } | { kind: 'played'; side: 'me' | 'opp' } | { kind: 'log' } | { kind: 'menu' } | null = null;
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

const LEVEL_NAMES: Record<BotLevel, string> = { gentle: 'Наставник', easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный' };
const LEVEL_ICONS: Record<BotLevel, string> = { gentle: 'level_gentle', easy: 'level_easy', medium: 'level_medium', hard: 'level_hard' };

function roomFromUrl(): string {
  return normalizeCode(new URLSearchParams(location.search).get('room') ?? '');
}

function roomLink(code: string) {
  const u = new URL(location.href);
  const peer = u.searchParams.get('peer');
  u.search = `?room=${code}${peer ? `&peer=${encodeURIComponent(peer)}` : ''}`;
  u.hash = '';
  return u.toString();
}

// ── screens ──────────────────────────────────────────────

function leaveGame(message = '') {
  ctrl?.dispose();
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
  const peer = new URLSearchParams(location.search).get('peer');
  history.replaceState(null, '', location.pathname + (peer ? `?peer=${encodeURIComponent(peer)}` : ''));
  menu(message);
}

/** The player chose to play without a nick: the network menu doesn't ask again until a reload. */
let nickAsked = false;
/** Where the nick screen leads on to. */
let nickNext: MenuView = 'net';

/** Screens of the main menu; each one but the first has a way back to the one it came from. */
type MenuView = 'home' | 'play' | 'bot' | 'net' | 'join' | 'nick' | 'rating' | 'settings';
const MENU_VIEWS: Record<MenuView, { title: string; back: MenuView }> = {
  home: { title: '', back: 'home' },
  play: { title: 'Играть', back: 'home' },
  bot: { title: 'Сложность бота', back: 'play' },
  net: { title: 'Сетевая игра', back: 'home' },
  join: { title: 'Присоединиться', back: 'net' },
  nick: { title: 'Ваш ник', back: 'home' },
  rating: { title: 'Рейтинг', back: 'home' },
  settings: { title: 'Настройки', back: 'home' },
};

const menuButton = (go: string, ic: string, label: string) => `<button class="menu-btn" data-go="${go}">${withIcon(ic, label)}</button>`;

function menuBody(view: MenuView): string {
  switch (view) {
    case 'home':
      return (
        menuButton('play', 'play_all', 'Играть') +
        menuButton('net', 'combo', 'Сетевая игра') +
        menuButton('rating', 'win', 'Рейтинг') +
        menuButton('settings', 'settings', 'Настройки')
      );
    case 'play':
      return menuButton('tutorial', 'tutorial', 'Туториал') + menuButton('bot', 'play_bot', 'Против бота');
    case 'bot':
      return BOT_LEVELS.map((v) => menuButton(`level-${v}`, LEVEL_ICONS[v], LEVEL_NAMES[v])).join('');
    case 'net':
      return menuButton('host', 'host', 'Создать комнату') + menuButton('join', 'join', 'Присоединиться');
    case 'join':
      return `<div class="join"><input id="code" placeholder="КОД КОМНАТЫ" maxlength="8" value="${esc(roomFromUrl())}" autocomplete="off"><button class="menu-btn" data-go="enter">${withIcon('join', 'Войти')}</button></div>`;
    case 'nick':
      return `<p class="nick-text">Придумайте ник: его увидит соперник, и под ним вы попадёте в рейтинг. Сменить ник можно в Настройках.</p>
        <input id="nick" maxlength="24" placeholder="Ваш ник" autocomplete="nickname">
        ${menuButton('nick-ok', 'confirm', 'Продолжить')}${menuButton('nick-skip', 'skip', 'Без ника')}`;
    case 'rating':
      return `<div class="rating-board">${ratingUrl() ? '<p class="wait">Загружаем…</p>' : '<p class="wait">Таблица рейтинга ещё не подключена.</p>'}</div>`;
    case 'settings':
      return `<label class="field">Ваше имя <input id="name" maxlength="24" value="${esc(playerName())}" autocomplete="nickname"></label>
        <div class="settings">${settingsRows()}</div>
        ${menuButton('rules', 'rules', 'Правила')}`;
  }
}

/** The main menu: three buttons, each opening a screen of its own. A room link opens straight on joining it. */
function menu(message = '', view: MenuView = roomFromUrl() ? 'join' : 'home') {
  // A player without a nick is offered one on the way to a network game.
  if ((view === 'net' || view === 'join') && !nickAsked && sameName(playerName(), DEFAULT_NAME)) {
    nickNext = view;
    view = 'nick';
  }
  const v = MENU_VIEWS[view];
  app.innerHTML = `<div class="menu home ${view === 'home' ? 'root' : 'sub'}" data-view="${view}">
    <h1 class="logo"><img src="${logoUrl}" alt="Dark Realm"></h1>
    ${view === 'home' ? '<p class="subtitle">Карточная дуэль покровителей тёмного мира</p>' : `<h2 class="menu-title">${v.title}</h2>`}
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
  app.querySelector('.settings')?.addEventListener('click', (ev) => {
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
      if (go === 'play' || go === 'net' || go === 'rating' || go === 'settings' || go === 'bot' || go === 'join') return menu('', go);
      if (go === 'rules') return showRules();
      if (go === 'nick-ok') return setNick();
      if (go === 'nick-skip') {
        nickAsked = true;
        return menu('', nickNext);
      }
      if (go === 'tutorial') return startGame(new BotController(n, 'gentle'));
      if (go.startsWith('level-')) return startGame(new BotController(n, go.slice(6) as BotLevel));
      if (go === 'host') return host(n);
      if (go === 'enter') return join(n, normalizeCode(codeInput!.value));
    }),
  );
  if (view === 'rating' && ratingUrl()) loadRating();
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
        <span class="r-score">${p.rating}</span><span class="r-wl">${p.wins}–${p.losses}</span></li>`,
    )
    .join('');
  const note = sameName(name, DEFAULT_NAME)
    ? 'Задайте имя в Настройках, чтобы попасть в рейтинг.'
    : 'Сетевые партии против людей. Партия засчитывается, когда результат пришлют оба игрока.';
  board.innerHTML = `${
    rows
      ? `<div class="rating-head"><span class="r-place">#</span><span class="r-name">Игрок</span><span class="r-score">Рейтинг</span><span class="r-wl">П–П</span></div><ol class="rating-list">${rows}</ol>`
      : '<p class="wait">В рейтинге пока никого нет. Сыграйте сетевую партию!</p>'
  }<p class="rating-note">${note}</p>`;
  board.querySelector('.me')?.scrollIntoView({ block: 'nearest' });
}

/** Music, sounds and animations, each switched on or off; the same sheet opens from the main menu and in a game. */
const SETTINGS = [
  { key: 'music', label: 'Музыка', icon: 'set_music', on: musicOn, set: setMusic },
  { key: 'sound', label: 'Звуки', icon: 'set_sound', on: soundOn, set: setSound },
  { key: 'motion', label: 'Анимации', icon: 'set_motion', on: motionOn, set: setMotion },
];

function settingsRows() {
  return SETTINGS.map(
    (o) => `<button class="toggle" data-set="${o.key}" aria-pressed="${o.on()}"><span class="t-label">${icon(o.icon)}<span>${o.label}</span></span><b>${o.on() ? 'Вкл' : 'Выкл'}</b></button>`,
  ).join('');
}

function showSettings() {
  const box = document.createElement('div');
  box.className = 'overlay sheet-wrap';
  box.innerHTML = `<div class="sheet settings-sheet"><h2>Настройки</h2><div class="settings">${settingsRows()}</div>
    <div class="sheet-actions"><button data-close>${withIcon('confirm', 'Готово')}</button></div></div>`;
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
}

function rulesHtml() {
  const patrons = (Object.keys(PATRON_RULES) as PatronId[])
    .map((p) => {
      const lock = isUnlocked(p) ? '' : ` ${icon('lock', '🔒')} (${unlockHint(p).replace(/\.$/, '').toLowerCase()})`;
      return `<li><b>${esc(PATRONS[p].name)}</b>${lock}: ${richText(PATRON_RULES[p].cost)} → ${richText(PATRON_RULES[p].effect)}</li>`;
    })
    .join('');
  return paintIcons(`<ul>
    <li>В начале партии бросается монетка. Кому выпало, тот первым выбирает покровителя и первым ходит, а второй игрок получает в свой первый ход контракт «Фальшивая монета» (+1 ●). Его надо разыграть в этот же ход, иначе он сгорит.</li>
    <li>Игроки по очереди выбирают 4 покровителей: первый, второй, второй, первый. Их колоды образуют таверну. Сундук Бездны есть всегда.</li>
    <li>Начальная колода: 6 «Золота» и по одной начальной карте каждого покровителя. В руке 5 карт.</li>
    <li>Сыгранные карты дают <b>монеты</b> ● (покупка карт в таверне) и <b>силу</b> ⚔ (в конце хода становится престижем ✦ или идёт на атаку агентов).</li>
    <li><b>Комбо N</b> срабатывает, когда за ход сыграно N карт одного покровителя, даже задним числом.</li>
    <li><b>Агенты</b> остаются на поле и действуют каждый ход. Агентов с провокацией надо сразить первыми, а в конце хода остаток силы сам бьёт по ним и только потом становится престижем.</li>
    <li><b>Контракты</b> срабатывают сразу при покупке и не попадают в колоду. Колода Сундука Бездны целиком из контрактов.</li>
    <li><b>Морок</b> (проклятие) надо разыграть раньше остальных карт в руке.</li>
    <li>Нажмите на счётчик колоды или сброса, своего или соперника, чтобы посмотреть эти карты. Порядок колоды скрыт.</li>
    <li>За ход можно один раз воззвать к покровителю. Он становится благосклонен к вам, а если благоволил сопернику, то нейтрален. Ворон нейтрален только в начале игры: после вызова он сразу на вашей стороне.</li>
    <li>Победа: 40 ✦ и перевес после хода соперника, или сразу: 80 ✦ либо благосклонность всех 4 покровителей.</li>
  </ul>`) + `<ul class="patron-rules">${patrons}</ul>`;
}

function waiting(text: string, extra = '') {
  app.innerHTML = `<div class="menu"><h1 class="title small">Dark Realm</h1><p class="wait">${text}</p>${extra}
    <button data-go="back">${withIcon('back', 'Назад')}</button></div>`;
  app.querySelector('[data-go="back"]')!.addEventListener('click', () => leaveGame());
}

function host(name: string) {
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
  startGame(new GuestController(code, name, joinRoom));
}

/** A network match this page was playing before a reload or a crash picks up where it was. */
function resume(): boolean {
  const m = savedMatch();
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
  ctrl?.dispose();
  ctrl = c;
  selected = new Set();
  pendingKey = '';
  focus = null;
  modal = null;
  peek = null;
  lastState = null;
  lastError = '';
  coach = c instanceof BotController && c.tutorial ? new Coach() : null;
  hint = null;
  tossed = false;
  closeCoin();
  clearFx();
  clearMotion();
  c.subscribe(render);
  render();
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
  // Where the cards were, read before the board is redrawn, so the moved ones can fly.
  const snap = prev !== s ? snapshot(app) : null;
  onStateChange(prev, s, me);
  lastState = s;
  if (ctrl.error && ctrl.error !== lastError) play('error');
  lastError = ctrl.error;
  hint = coach?.hint(s, me) ?? null;
  if (s.phase === 'draft') {
    app.innerHTML = draftHtml(s) + netOverlay(s);
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
    app.innerHTML = boardHtml(s, me, { myTurn, idle, focus, pick }) + overlays(s);
    restorePlayed(app);
    animateChange(app, snap, prev, s, me);
    if (view) showZoom(view.html, view.label, view.can);
    // The enlarged card says what to do itself, so the coach steps aside for it.
    if (hint && !view && !modal) showHint(app, hint);
  }
  if (!focus) animatedFocus = '';
  refreshTooltip();
  const log = app.querySelector('.log-view .log');
  if (log) log.scrollTop = log.scrollHeight;
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
        <p><b>Воззвание:</b> ${richText(r.cost)} → ${richText(r.effect)}</p>
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
    <h2>${mine ? 'Выберите покровителя' : `Выбирает ${esc(s.players[turn].name)}…`}</h2>
    <div class="draft-picks">${([me, me === 0 ? 1 : 0] as const)
      .map((pi) => `<div><b>${coin(pi)}${esc(s.players[pi].name)}</b><span class="picks">${picks(pi)}</span></div>`)
      .join('')}</div>
    <div class="draft-tiles">${tiles}</div>
    <button class="ghost" data-act="leave">${withIcon('back', 'Выйти')}</button>
  </div>`;
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
    return `<div class="overlay"><div class="dialog reconnect"><h2>Нет связи</h2>
      <p class="wait">${esc(ctrl.notice)}</p>
      <div class="buttons"><button class="ghost" data-act="leave">${withIcon('back', 'В меню')}</button></div></div></div>`;
  }
  if (ctrl instanceof HostController && !ctrl.online) return `<div class="toast away">${esc(ctrl.notice)}</div>`;
  return '';
}

function overlays(s: GameState): string {
  const me = ctrl!.me;
  const net = netOverlay(s);
  if (net && ctrl instanceof GuestController) return net;
  let html = net;
  // While the guest is away, the host's notice says so in place of the usual banner.
  const banner = net ? '' : ctrl!.notice || ctrl!.error;
  if (banner) html += `<div class="toast">${esc(banner)}</div>`;
  if (s.phase === 'over') {
    const win = s.winner === me;
    html += `<div class="overlay"><div class="dialog end-dialog ${win ? 'win' : 'lose'}">
      ${icon(win ? 'win' : 'lose', '', 'end-ic')}<h2>${win ? 'Победа' : 'Поражение'}</h2><p>${esc(s.players[s.winner!].name)}: ${richText(s.winReason)}</p>
      <p>Престиж ${s.players[me].prestige} : ${s.players[me === 0 ? 1 : 0].prestige}</p>
      ${ctrl!.rating ? `<p class="rating-line">${icon('win')}<span>${esc(ratingLine(ctrl!.rating, s.players[me].name))}</span></p>` : ''}
      ${ctrl!.unlocked.map((pid) => `<p class="unlocked"><img src="${patronEmblem(pid)}" alt=""><span>Открыт покровитель <b>${esc(PATRONS[pid].name)}</b></span></p>`).join('')}
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
      // A patron call that only opened this choice can be called off: nothing is spent.
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
      <h2>Журнал партии</h2>
      <div class="log">${s.log.map((l) => `<div>${richText(l)}</div>`).join('')}</div>
      <div class="sheet-actions"><button data-act="close">${withIcon('close', 'Закрыть')}</button></div></div></div>`;
  } else if (modal?.kind === 'menu') {
    html += `<div class="overlay sheet-wrap" data-act="close"><div class="sheet menu-sheet">
      <h2>Меню</h2>
      <div class="sheet-actions column">
        <button data-act="log">${withIcon('log', 'Журнал партии')}</button>
        <button data-act="rules">${withIcon('rules', 'Правила')}</button>
        <button data-act="settings">${withIcon('settings', 'Настройки')}</button>
        <button class="danger" data-act="concede">${withIcon('concede', 'Сдаться')}</button>
        <button class="ghost" data-act="close">${withIcon('back', 'Вернуться к игре')}</button>
      </div></div></div>`;
  } else if (modal?.kind === 'pile') {
    const cards = [...modal.cards].sort((a, b) => cardDef(a.id).name.localeCompare(cardDef(b.id).name));
    html += pileSheet(`${modal.title} (${cards.length})`, cards);
  } else if (modal?.kind === 'played') {
    // In the order they were played; the turn passing sends them to the discard and shuts the sheet.
    const cards = s.players[modal.side === 'me' ? me : me === 0 ? 1 : 0].played;
    if (cards.length) html += pileSheet(`${modal.side === 'me' ? 'Вы разыграли' : 'Соперник разыграл'} за ход (${cards.length})`, cards);
    else modal = null;
  }
  if (peek && (modal?.kind === 'pile' || modal?.kind === 'played' || (peek.ref !== undefined && s.pending?.player === me))) html += peekHtml(s.pending, peek);
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
 * a second tap on it (or on its source) confirms the action.
 */
function showZoom(html: string, label: string, can: boolean) {
  const f = focus!;
  const src = app.querySelector<HTMLElement>(
    f.kind === 'card' ? `.game [data-act="inspect"][data-uid="${f.uid}"]` : `.game [data-patron="${f.patron}"]`,
  );
  const zoom = document.createElement('div');
  zoom.className = `zoom${can ? ' can' : ''}${f.kind === 'patron' ? ' patron-zoom' : ''}`;
  zoom.dataset.act = 'confirm-focus';
  if (f.kind === 'card') zoom.dataset.zoomUid = String(f.uid);
  zoom.innerHTML = `${html}${label ? `<div class="zoom-act">${richText(label)}</div>` : ''}`;
  app.appendChild(zoom);
  if (!src) return;
  const r = src.getBoundingClientRect();
  const w = zoom.offsetWidth;
  const h = zoom.offsetHeight;
  const vw = innerWidth;
  const vh = innerHeight;
  const x = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2));
  // Cards in the lower half grow upward out of their place, the rest grow downward.
  const below = r.top + r.height / 2 > vh / 2;
  const y = Math.max(8, Math.min(vh - h - 8, below ? r.bottom - h : r.top));
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

/** First tap selects, a second tap on the same card or patron performs its action. */
function tapFocus(next: Focus) {
  const s = ctrl!.state!;
  const me = ctrl!.me;
  if (focus && focusKey(focus) === focusKey(next)) return confirmFocus();
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
  if (act === 'rematch' && ctrl instanceof BotController) {
    if (ctrl.tutorial) coach = new Coach();
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
  if (['end', 'confirm', 'cancel', 'play-all', 'concede', 'menu', 'played', 'pile-deck', 'pile-cd', 'pile-opp-deck', 'pile-opp-cd'].includes(act)) focus = null;
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

// Results of network games that didn't reach the rating table before.
flushReports();

void loadAll().then(() => {
  if (!resume()) menu();
  hideLoading();
});
