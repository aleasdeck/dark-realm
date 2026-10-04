import '@fontsource/philosopher/400.css';
import '@fontsource/philosopher/700.css';
import '@fontsource/pt-sans/400.css';
import '@fontsource/pt-sans/700.css';
import '@fontsource/pt-sans-narrow/400.css';
import '@fontsource/pt-sans-narrow/700.css';
import './style.css';
import { cardDef, PATRONS } from './engine/cards';
import { actingPlayer } from './engine/engine';
import { PATRON_RULES } from './engine/text';
import type { Card, GameState, PatronId } from './engine/types';
import { hostRoom, joinRoom, newRoomCode, normalizeCode } from './net/room';
import { BotController, Controller, GuestController, HostController } from './ui/controller';
import { boardHtml, cardHtml, esc, miniHtml, patronEmblem } from './ui/render';

const app = document.getElementById('app')!;
let ctrl: Controller | null = null;
let cancelHost: (() => void) | null = null;
let selected = new Set<number>();
let pendingKey = '';
let autoPlay = false;
let modal: { title: string; cards: Card[] } | { title: string; log: true } | null = null;

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
      <button data-go="bot">Играть против бота</button>
      <button data-go="host">Создать комнату</button>
      <div class="join"><input id="code" placeholder="КОД" maxlength="8" value="${esc(code)}"><button data-go="join">Войти</button></div>
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
      if (go === 'bot') startGame(new BotController(n));
      else if (go === 'host') host(n);
      else join(n, normalizeCode(app.querySelector<HTMLInputElement>('#code')!.value));
    }),
  );
}

function rulesHtml() {
  const patrons = (Object.keys(PATRON_RULES) as PatronId[])
    .map((p) => `<li><b>${esc(PATRONS[p].name)}</b>: ${esc(PATRON_RULES[p].cost)} → ${esc(PATRON_RULES[p].effect)}</li>`)
    .join('');
  return `<ul>
    <li>Игроки по очереди выбирают 4 покровителей; их колоды образуют таверну. Сундук Бездны есть всегда.</li>
    <li>Начальная колода: 6 «Золота» и по одной начальной карте каждого покровителя. В руке 5 карт.</li>
    <li>Сыгранные карты дают <b>монеты</b> (покупка карт в таверне) и <b>силу</b> (в конце хода становится престижем или идёт на атаку агентов).</li>
    <li><b>Комбо N</b> срабатывает, когда за ход сыграно N карт одного покровителя, даже задним числом.</li>
    <li><b>Агенты</b> остаются на поле и действуют каждый ход. Агентов с провокацией надо сразить первыми.</li>
    <li><b>Контракты</b> срабатывают сразу при покупке и не попадают в колоду.</li>
    <li>За ход можно один раз воззвать к покровителю. Он становится благосклонен к вам, а если благоволил сопернику, то нейтрален.</li>
    <li>Победа: 40 престижа и перевес после хода соперника, 80 престижа сразу, или конец хода с благосклонностью всех 4 покровителей.</li>
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
  if (s.phase === 'draft') {
    app.innerHTML = draftHtml(s);
  } else {
    const myTurn = s.current === me && s.phase === 'play';
    const idle = myTurn && !s.pending && s.queue.length === 0;
    app.innerHTML = boardHtml(s, me, { myTurn, idle }) + overlays(s);
  }
  const log = app.querySelector('.log-view .log');
  if (log) log.scrollTop = log.scrollHeight;
  hideTip();
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
  const next = s.players[me].hand[0];
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
  return `<div class="draft">
    <h2>${mine ? 'Выберите покровителя' : `Выбирает ${esc(s.players[turn].name)}…`}</h2>
    <div class="draft-picks"><div><b>${esc(s.players[me].name)}</b>${picks(me)}</div><div><b>${esc(s.players[me === 0 ? 1 : 0].name)}</b>${picks(me === 0 ? 1 : 0)}</div></div>
    <div class="draft-tiles">${tiles}</div>
    <button class="ghost" data-act="leave">Выйти</button>
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
      <div class="buttons">${ctrl instanceof BotController ? '<button data-act="rematch">Ещё партия</button>' : ''}
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
            ? `<div class="opt-card${sel}" data-act="pick" data-ref="${o.ref}">${cardHtml(o.cardId)}<span>${esc(o.label)}</span></div>`
            : `<button class="opt${sel}" data-act="pick" data-ref="${o.ref}">${esc(o.label)}</button>`;
        })
        .join('');
      const ok = selected.size >= p.min && selected.size <= p.max;
      const range = p.min === p.max ? `${p.min}` : `${p.min}–${p.max}`;
      html += `<div class="overlay"><div class="dialog choice">
        <h2>${esc(p.prompt)}</h2><p class="hint">Выберите ${range}</p>
        <div class="options">${opts}</div>
        ${single ? '' : `<div class="buttons"><button data-act="confirm" ${ok ? '' : 'disabled'}>Готово (${selected.size})</button></div>`}
      </div></div>`;
    }
  }
  if (modal && 'log' in modal) {
    html += `<div class="overlay" data-act="close"><div class="dialog log-view">
      <h2>${esc(modal.title)}</h2>
      <div class="log">${s.log.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
      <div class="buttons"><button data-act="close">Закрыть</button></div></div></div>`;
  } else if (modal) {
    const cards = [...modal.cards].sort((a, b) => cardDef(a.id).name.localeCompare(cardDef(b.id).name));
    html += `<div class="overlay" data-act="close"><div class="dialog pile-view">
      <h2>${esc(modal.title)} (${cards.length})</h2>
      <div class="options">${cards.map((c) => miniHtml(c.id)).join('') || '<p>Пусто</p>'}</div>
      <div class="buttons"><button data-act="close">Закрыть</button></div></div></div>`;
  }
  return html;
}

// ── input ────────────────────────────────────────────────

app.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el || !ctrl) return;
  const s = ctrl.state;
  const act = el.dataset.act!;
  const uid = Number(el.dataset.uid);
  if (act === 'leave') return leaveGame();
  if (act === 'rematch' && ctrl instanceof BotController) return ctrl.restart();
  if (act === 'close') {
    if (el.classList.contains('overlay') && ev.target !== el) return;
    modal = null;
    return render();
  }
  if (!s) return;
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
    case 'log':
      modal = { title: 'Журнал партии', log: true };
      return render();
    case 'pile-deck':
      modal = { title: 'Ваша колода (порядок скрыт)', cards: s.players[me].deck };
      return render();
    case 'pile-cd':
      modal = { title: 'Ваш сброс', cards: s.players[me].cooldown };
      return render();
    case 'pile-opp-cd':
      modal = { title: 'Сброс соперника', cards: s.players[me === 0 ? 1 : 0].cooldown };
      return render();
  }
});

// Floating card preview and tooltips: positioned over the page so nothing shifts.
const tip = document.createElement('div');
tip.className = 'float-tip';
document.body.appendChild(tip);
let tipFor: HTMLElement | null = null;

function hideTip() {
  tip.style.display = 'none';
  tipFor = null;
}

function placeTip(x: number, y: number) {
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let left = x + 18;
  let top = y - h / 2;
  if (left + w > innerWidth - 8) left = x - w - 18;
  top = Math.max(8, Math.min(top, innerHeight - h - 8));
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${top}px`;
}

app.addEventListener('mouseover', (ev) => {
  const t = ev.target as HTMLElement;
  const el = t.closest<HTMLElement>('[data-card], [data-tip]');
  if (!el || el === tipFor || el.closest('.dialog')) {
    if (!el) hideTip();
    return;
  }
  tipFor = el;
  // Full size cards already show their text; only compact ones get a preview.
  if (el.dataset.card && (el.classList.contains('mini') || el.classList.contains('chip'))) {
    tip.className = 'float-tip card-tip';
    tip.innerHTML = cardHtml(el.dataset.card, { cls: 'big' });
  } else if (el.dataset.tip) {
    tip.className = 'float-tip text-tip';
    tip.innerHTML = esc(el.dataset.tip).replace(/\n/g, '<br>');
  } else {
    hideTip();
    return;
  }
  tip.style.display = 'block';
  placeTip(ev.clientX, ev.clientY);
});
app.addEventListener('mousemove', (ev) => {
  if (tipFor) placeTip(ev.clientX, ev.clientY);
});
app.addEventListener('mouseleave', hideTip);

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && modal) {
    modal = null;
    render();
  }
});

menu();
