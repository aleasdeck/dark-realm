import '@fontsource/philosopher/400.css';
import '@fontsource/philosopher/700.css';
import '@fontsource/pt-sans/400.css';
import '@fontsource/pt-sans/700.css';
import '@fontsource/pt-sans-narrow/400.css';
import '@fontsource/pt-sans-narrow/700.css';
import './style.css';
import { cardDef, LOCKED, PATRONS } from './engine/cards';
import { actingPlayer } from './engine/engine';
import { PATRON_RULES } from './engine/text';
import type { Card, GameState, PatronId } from './engine/types';
import { hostRoom, joinRoom, newRoomCode, normalizeCode } from './net/room';
import { BotController, Controller, GuestController, HostController } from './ui/controller';
import { clearFx, onStateChange } from './ui/feed';
import { musicOn, setMusic, unlockMusic } from './ui/music';
import { play, setSound, soundOn, unlock } from './ui/sound';
import { boardHtml, cardHtml, esc, focusView, patronEmblem, patronTipHtml, pileGridHtml, tileHtml, type Focus } from './ui/render';
import { hideTooltip, initTooltips, refreshTooltip } from './ui/tooltip';
import { initPlayed, restorePlayed, savePlayed } from './ui/played';
import { Coach, hintAllows, showHint, type Hint } from './ui/tutorial';
import { isUnlocked } from './ui/unlocks';

const app = document.getElementById('app')!;
let ctrl: Controller | null = null;
let cancelHost: (() => void) | null = null;
let selected = new Set<number>();
let pendingKey = '';
let autoPlay = false;
let modal: { kind: 'pile'; title: string; cards: Card[] } | { kind: 'log' } | { kind: 'menu' } | null = null;
let focus: Focus | null = null;
let animatedFocus = '';
let lastState: GameState | null = null;
let lastError = '';
/** Hints of the tutorial game; null in every other game. */
let coach: Coach | null = null;
/** The hint for the current state; while it is up, only what it points at responds. */
let hint: Hint | null = null;

const NAME_KEY = 'dark-realm-name';
function playerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || 'Странник';
  } catch {
    return 'Странник';
  }
}
function saveName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* storage unavailable */
  }
}

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

function leaveGame() {
  ctrl?.dispose();
  ctrl = null;
  cancelHost?.();
  cancelHost = null;
  autoPlay = false;
  modal = null;
  focus = null;
  lastState = null;
  coach = null;
  hint = null;
  clearFx();
  const peer = new URLSearchParams(location.search).get('peer');
  history.replaceState(null, '', location.pathname + (peer ? `?peer=${encodeURIComponent(peer)}` : ''));
  menu();
}

function menu(message = '') {
  const code = roomFromUrl();
  app.innerHTML = `<div class="menu">
    <h1 class="title">Dark Realm</h1>
    <p class="subtitle">Карточная дуэль покровителей тёмного мира</p>
    <label class="field">Ваше имя <input id="name" maxlength="24" value="${esc(playerName())}"></label>
    <div class="menu-buttons">
      <button data-go="tutorial">Туториал</button>
      <button data-go="bot">Играть против бота</button>
      <button data-go="host">Создать комнату</button>
      <div class="join"><input id="code" placeholder="КОД" maxlength="8" value="${esc(code)}"><button data-go="join">Войти</button></div>
      <button class="ghost" data-go="sound">${soundLabel()}</button>
      <button class="ghost" data-go="music">${musicLabel()}</button>
    </div>
    ${message ? `<p class="msg">${esc(message)}</p>` : ''}
    <details class="rules"><summary>Правила</summary>${rulesHtml()}</details>
  </div>`;
  const nameInput = app.querySelector<HTMLInputElement>('#name')!;
  app.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) =>
    b.addEventListener('click', () => {
      const n = nameInput.value.trim() || 'Странник';
      saveName(n);
      const go = b.dataset.go;
      if (go === 'sound') {
        setSound(!soundOn());
        b.textContent = soundLabel();
        return;
      }
      if (go === 'music') {
        setMusic(!musicOn());
        b.textContent = musicLabel();
        return;
      }
      if (go === 'tutorial') startGame(new BotController(n, true));
      else if (go === 'bot') startGame(new BotController(n));
      else if (go === 'host') host(n);
      else join(n, normalizeCode(app.querySelector<HTMLInputElement>('#code')!.value));
    }),
  );
}

function soundLabel() {
  return soundOn() ? '🔊 Звуки включены' : '🔇 Звуки выключены';
}

function musicLabel() {
  return musicOn() ? '♪ Музыка включена' : '♪ Музыка выключена';
}

function rulesHtml() {
  const patrons = (Object.keys(PATRON_RULES) as PatronId[])
    .map((p) => {
      const lock = isUnlocked(p) ? '' : ' 🔒 (пока закрыт)';
      return `<li><b>${esc(PATRONS[p].name)}</b>${lock}: ${esc(PATRON_RULES[p].cost)} → ${esc(PATRON_RULES[p].effect)}</li>`;
    })
    .join('');
  return `<ul>
    <li>Игроки по очереди выбирают 4 покровителей; их колоды образуют таверну. Сундук Бездны есть всегда.</li>
    <li>Начальная колода: 6 «Золота» и по одной начальной карте каждого покровителя. В руке 5 карт.</li>
    <li>Сыгранные карты дают <b>монеты</b> (покупка карт в таверне) и <b>силу</b> (в конце хода становится престижем или идёт на атаку агентов).</li>
    <li><b>Комбо N</b> срабатывает, когда за ход сыграно N карт одного покровителя, даже задним числом.</li>
    <li><b>Агенты</b> остаются на поле и действуют каждый ход. Агентов с провокацией надо сразить первыми, а в конце хода остаток силы сам бьёт по ним и только потом становится престижем.</li>
    <li><b>Контракты</b> срабатывают сразу при покупке и не попадают в колоду. Колода Сундука Бездны целиком из контрактов.</li>
    <li><b>Морок</b> (проклятие) надо разыграть раньше остальных карт в руке.</li>
    <li>За ход можно один раз воззвать к покровителю. Он становится благосклонен к вам, а если благоволил сопернику, то нейтрален.</li>
    <li>Победа: 40 престижа и перевес после хода соперника, или сразу: 80 престижа либо благосклонность всех 4 покровителей.</li>
  </ul><ul class="patron-rules">${patrons}</ul>`;
}

function waiting(text: string, extra = '') {
  app.innerHTML = `<div class="menu"><h1 class="title small">Dark Realm</h1><p class="wait">${text}</p>${extra}
    <button data-go="back">Назад</button></div>`;
  app.querySelector('[data-go="back"]')!.addEventListener('click', leaveGame);
}

async function host(name: string) {
  const code = newRoomCode();
  waiting('Открываем комнату…');
  try {
    const room = await hostRoom(code, (connect) => {
      startGame(new HostController(name, connect));
    });
    cancelHost = room.cancel;
    if (ctrl) return;
    const link = roomLink(code);
    waiting(
      'Ждём соперника. Отправьте ему код или ссылку.',
      `<div class="room-code">${code}</div>
       <div class="join"><input readonly value="${esc(link)}" id="link"><button id="copy">Копировать</button></div>`,
    );
    app.querySelector('#copy')?.addEventListener('click', () => {
      const input = app.querySelector<HTMLInputElement>('#link')!;
      input.select();
      navigator.clipboard?.writeText(input.value).catch(() => document.execCommand('copy'));
    });
  } catch (e) {
    menu(e instanceof Error ? e.message : String(e));
  }
}

async function join(name: string, code: string) {
  if (!code) return menu('Введите код комнаты.');
  waiting(`Подключаемся к комнате ${esc(code)}…`);
  const guest = new GuestController();
  try {
    const link = await joinRoom(code, guest.handlers());
    startGame(guest);
    guest.attach(link, name);
  } catch (e) {
    menu(e instanceof Error ? e.message : String(e));
  }
}

function startGame(c: Controller) {
  ctrl?.dispose();
  ctrl = c;
  selected = new Set();
  pendingKey = '';
  focus = null;
  modal = null;
  lastState = null;
  lastError = '';
  coach = c instanceof BotController && c.tutorial ? new Coach() : null;
  hint = null;
  clearFx();
  c.subscribe(render);
  render();
}

// ── game rendering ───────────────────────────────────────

function render() {
  if (!ctrl) return;
  const s = ctrl.state;
  if (!s) {
    waiting(ctrl.notice || 'Ждём…');
    return;
  }
  const me = ctrl.me;
  onStateChange(lastState, s, me);
  lastState = s;
  if (ctrl.error && ctrl.error !== lastError) play('error');
  lastError = ctrl.error;
  hint = coach?.hint(s, me) ?? null;
  if (s.phase === 'draft') {
    app.innerHTML = draftHtml(s);
    if (hint) showHint(app, hint);
  } else {
    const myTurn = s.current === me && s.phase === 'play';
    const idle = myTurn && !s.pending && s.queue.length === 0;
    if (s.pending?.player === me || s.phase === 'over' || autoPlay) focus = null;
    const view = focus ? focusView(s, me, focus, idle) : null;
    if (!view) focus = null;
    savePlayed(app);
    app.innerHTML = boardHtml(s, me, { myTurn, idle, focus }) + overlays(s);
    restorePlayed(app);
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
  const picks = (pi: 0 | 1) =>
    s.log
      .filter((l) => l.startsWith(s.players[pi].name + ' выбирает'))
      .map((l) => `<div>${esc(l.replace(/^.*«(.*)»$/, '$1'))}</div>`)
      .join('');
  const tiles = s.draftPool
    .map((pid) => {
      const p = PATRONS[pid];
      const r = PATRON_RULES[pid];
      return `<div class="draft-tile${mine ? ' can' : ''}" ${mine ? `data-act="draft" data-patron="${pid}"` : ''} style="--accent:${p.palette.accent};--glow:${p.palette.glow}">
        <img src="${patronEmblem(pid)}" alt="">
        <h3>${esc(p.name)}</h3><p class="p-title">${esc(p.title)}</p>
        <p><b>Воззвание:</b> ${esc(r.cost)} → ${esc(r.effect)}</p>
      </div>`;
    })
    .join('');
  const locked = LOCKED.filter((pid) => !s.draftPool.includes(pid) && !s.patrons.includes(pid))
    .map((pid) => `<img src="${patronEmblem(pid)}" alt="${esc(PATRONS[pid].name)}" data-act="locked" data-patron="${pid}">`)
    .join('');
  return `<div class="draft">
    <h2>${mine ? 'Выберите покровителя' : `Выбирает ${esc(s.players[turn].name)}…`}</h2>
    <div class="draft-picks"><div><b>${esc(s.players[me].name)}</b>${picks(me)}</div><div><b>${esc(s.players[me === 0 ? 1 : 0].name)}</b>${picks(me === 0 ? 1 : 0)}</div></div>
    <div class="draft-tiles">${tiles}</div>
    <div class="draft-foot">
      ${locked ? `<div class="draft-locked" title="Закрытые покровители"><span>🔒</span>${locked}</div>` : ''}
      <button class="ghost" data-act="leave">Выйти</button>
    </div>
  </div>`;
}

function overlays(s: GameState): string {
  const me = ctrl!.me;
  let html = '';
  const banner = ctrl!.notice || ctrl!.error;
  if (banner) html += `<div class="toast">${esc(banner)}</div>`;
  if (s.phase === 'over') {
    const win = s.winner === me;
    html += `<div class="overlay"><div class="dialog end-dialog ${win ? 'win' : 'lose'}">
      <h2>${win ? 'Победа' : 'Поражение'}</h2><p>${esc(s.players[s.winner!].name)}: ${esc(s.winReason)}</p>
      <p>Престиж ${s.players[me].prestige} : ${s.players[me === 0 ? 1 : 0].prestige}</p>
      <div class="buttons">${ctrl instanceof BotController ? `<button data-act="rematch">${ctrl.tutorial ? 'Пройти ещё раз' : 'Ещё партия'}</button>` : ''}
      <button data-act="leave">В меню</button></div></div></div>`;
    return html;
  }
  if (s.pending) {
    const p = s.pending;
    const key = `${s.turn}:${p.kind}:${p.options.map((o) => o.ref).join(',')}`;
    if (key !== pendingKey) {
      pendingKey = key;
      selected = new Set();
    }
    if (p.player !== me) {
      html += `<div class="toast">Соперник делает выбор…</div>`;
    } else {
      const single = p.min === 1 && p.max === 1;
      const opts = p.options
        .map((o) => {
          const sel = selected.has(o.ref) ? ' selected' : '';
          return o.cardId
            ? `<div class="opt-card${sel}" data-act="pick" data-ref="${o.ref}">${tileHtml(o.cardId)}<span>${esc(o.label)}</span></div>`
            : `<button class="opt${sel}" data-act="pick" data-ref="${o.ref}">${esc(o.label)}</button>`;
        })
        .join('');
      const ok = selected.size >= p.min && selected.size <= p.max;
      const range = p.min === p.max ? `${p.min}` : `${p.min}–${p.max}`;
      html += `<div class="overlay sheet-wrap"><div class="sheet choice">
        <h2>${esc(p.prompt)}</h2><p class="hint">Выберите ${range}</p>
        <div class="options">${opts}</div>
        ${single ? '' : `<div class="buttons"><button data-act="confirm" ${ok ? '' : 'disabled'}>Готово (${selected.size})</button></div>`}
      </div></div>`;
    }
  }
  if (modal?.kind === 'log') {
    html += `<div class="overlay sheet-wrap" data-act="close"><div class="sheet log-view">
      <h2>Журнал партии</h2>
      <div class="log">${s.log.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
      <div class="sheet-actions"><button data-act="close">Закрыть</button></div></div></div>`;
  } else if (modal?.kind === 'menu') {
    html += `<div class="overlay sheet-wrap" data-act="close"><div class="sheet menu-sheet">
      <h2>Меню</h2>
      <div class="sheet-actions column">
        <button data-act="log">Журнал партии</button>
        <button data-act="rules">Правила</button>
        <button data-act="sound">${soundLabel()}</button>
        <button data-act="music">${musicLabel()}</button>
        <button class="danger" data-act="concede">Сдаться</button>
        <button class="ghost" data-act="close">Вернуться к игре</button>
      </div></div></div>`;
  } else if (modal?.kind === 'pile') {
    const cards = [...modal.cards].sort((a, b) => cardDef(a.id).name.localeCompare(cardDef(b.id).name));
    html += `<div class="overlay sheet-wrap" data-act="close"><div class="sheet pile-view">
      <h2>${esc(modal.title)} (${cards.length})</h2>
      <div class="options">${pileGridHtml(cards) || '<p>Пусто</p>'}</div>
      <div class="sheet-actions"><button data-act="close">Закрыть</button></div></div></div>`;
  }
  return html;
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
  zoom.innerHTML = `${html}${label ? `<div class="zoom-act">${esc(label)}</div>` : ''}`;
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
  if (key === animatedFocus || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
  const view = focusView(s, me, next, idleNow(s));
  if (view) play('click');
  render();
}

function confirmFocus() {
  const s = ctrl!.state!;
  const view = focus ? focusView(s, ctrl!.me, focus, idleNow(s)) : null;
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
    return render();
  }
  if (!s) return;
  if (['end', 'play-all', 'concede', 'menu', 'pile-deck', 'pile-cd', 'pile-opp-cd'].includes(act)) focus = null;
  const me = ctrl.me;
  switch (act) {
    case 'draft':
      return ctrl.dispatch({ t: 'draft', patron: el.dataset.patron as PatronId });
    case 'locked': {
      const p = PATRONS[el.dataset.patron as PatronId];
      ctrl.error = `${p.name} пока закрыт. Как его открыть, скоро появится.`;
      play('click');
      return render();
    }
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
    case 'pick': {
      const p = s.pending;
      if (!p) return;
      const ref = Number(el.dataset.ref);
      if (p.min === 1 && p.max === 1) return ctrl.dispatch({ t: 'choose', picks: [ref] });
      if (selected.has(ref)) selected.delete(ref);
      else if (selected.size < p.max) selected.add(ref);
      return render();
    }
    case 'confirm':
      return ctrl.dispatch({ t: 'choose', picks: [...selected] });
    case 'inspect':
      return tapFocus({ kind: 'card', uid });
    case 'inspect-patron':
      return tapFocus({ kind: 'patron', patron: el.dataset.patron as PatronId });
    case 'confirm-focus':
      return confirmFocus();
    case 'menu':
      modal = { kind: 'menu' };
      return render();
    case 'sound':
      setSound(!soundOn());
      return render();
    case 'music':
      setMusic(!musicOn());
      return render();
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
    case 'pile-opp-cd':
      modal = { kind: 'pile', title: 'Сброс соперника', cards: s.players[me === 0 ? 1 : 0].cooldown };
      return render();
  }
});

function showRules() {
  const box = document.createElement('div');
  box.className = 'overlay sheet-wrap';
  box.innerHTML = `<div class="sheet rules-sheet"><h2>Правила</h2><div class="rules-body">${rulesHtml()}</div>
    <div class="sheet-actions"><button>Закрыть</button></div></div>`;
  box.addEventListener('click', (ev) => {
    if (ev.target === box || (ev.target as HTMLElement).tagName === 'BUTTON') box.remove();
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
  if (ev.key === 'Escape' && (modal || focus)) {
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

menu();
