import { actingPlayer, hpLeft } from '../engine/engine';
import type { AgentInPlay, GameState, PlayerIdx } from '../engine/types';
import { cardMoves, type Move, type Place } from './moves';
import { richText, tileHtml } from './render';

/**
 * Card movement on the table. The board is redrawn from scratch on every state, so the cards
 * that changed place are flown over it by stand-ins ("ghosts") from where they were to where
 * they are now, while the real card stays hidden until its ghost lands.
 *
 * snapshot() reads the old board right before it is replaced; animateChange() compares the two
 * states afterwards and plans the flights. Ghosts live in their own layer outside #app.
 */

interface Box {
  /** Centre on screen. */
  x: number;
  y: number;
  /** Unrotated size. */
  w: number;
  h: number;
}

export interface Snapshot {
  cards: Map<number, { el: HTMLElement; box: Box }>;
  /** The opponent's card backs, in hand order. */
  backs: Box[];
}

const layer = document.createElement('div');
layer.className = 'motion-layer';
document.body.appendChild(layer);

const MOTION_KEY = 'dark-realm-motion';
let motion = readMotion();

function readMotion(): boolean {
  try {
    return localStorage.getItem(MOTION_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function motionOn() {
  return motion;
}

/** The "Анимации" setting; the system's reduced motion turns them off too. */
export function setMotion(on: boolean) {
  motion = on;
  try {
    localStorage.setItem(MOTION_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
  if (!on) clearMotion();
}

/** Whether the table should stay still: switched off in the settings or by the system. */
export const still = () => !motion || matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Cards still in flight: the real card stays hidden until then (performance.now time). */
const hiddenCards = new Map<number, number>();
const hiddenBacks = new Map<number, number>();

const MOVE_MS = 380;
const DRAW_MS = 460;
const SHOW_MS = 1050;
const EASE = 'cubic-bezier(.3,.75,.35,1)';
/** More ghosts than this at once are skipped (the piles still count right). */
const MAX_GHOSTS = 26;

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  const h = el as HTMLElement;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: h.offsetWidth || r.width, h: h.offsetHeight || r.height };
}

/** A played chip scrolled out of its column counts as sitting at the column's edge. */
function inList(el: HTMLElement, b: Box, scrollsToTop = false): Box {
  const list = el.closest<HTMLElement>('.pl-list');
  if (!list) return b;
  // A column that just got a card slides back to its top (see played.ts).
  const y = scrollsToTop ? b.y + list.scrollTop : b.y;
  const r = list.getBoundingClientRect();
  return { ...b, y: Math.max(r.top + b.h / 2, Math.min(r.bottom - b.h / 2, y)) };
}

const cardEl = (root: ParentNode, uid: number) => root.querySelector<HTMLElement>(`.game [data-uid="${uid}"]`);

/** Reads where every card is on the board about to be replaced. */
export function snapshot(root: HTMLElement): Snapshot | null {
  if (still()) return null;
  const cards: Snapshot['cards'] = new Map();
  const game = root.querySelector('.game');
  if (!game) return { cards, backs: [] };
  for (const el of game.querySelectorAll<HTMLElement>('[data-uid]')) cards.set(Number(el.dataset.uid), { el, box: inList(el, boxOf(el)) });
  // A card picked up and enlarged leaves from where it is shown.
  const zoom = root.querySelector<HTMLElement>('.zoom[data-zoom-uid]');
  const big = zoom?.firstElementChild as HTMLElement | null;
  if (zoom && big) cards.set(Number(zoom.dataset.zoomUid), { el: big, box: boxOf(big) });
  return { cards, backs: [...game.querySelectorAll('.opp-hand .back')].map(boxOf) };
}

/** Drops every flight, for a new game or the menu. */
export function clearMotion() {
  layer.replaceChildren();
  hiddenCards.clear();
  hiddenBacks.clear();
}

/** Keeps cards whose ghosts are still flying hidden on a board that was just redrawn. */
function rehide(game: HTMLElement) {
  const now = performance.now();
  for (const [uid, t] of hiddenCards) {
    if (t <= now) hiddenCards.delete(uid);
    else {
      const el = cardEl(game, uid);
      if (el) el.style.visibility = 'hidden';
    }
  }
  const backs = game.querySelectorAll<HTMLElement>('.opp-hand .back');
  for (const [i, t] of hiddenBacks) {
    if (t <= now) hiddenBacks.delete(i);
    else if (backs[i]) backs[i].style.visibility = 'hidden';
  }
}

function hideCard(uid: number, el: HTMLElement, until: number) {
  el.style.visibility = 'hidden';
  hiddenCards.set(uid, until);
}

/** Shows a card whose ghost has landed, with a little settle. */
function revealCard(uid: number, until: number) {
  if (hiddenCards.get(uid) !== until) return;
  hiddenCards.delete(uid);
  const el = cardEl(document, uid);
  if (!el) return;
  el.style.visibility = '';
  bump(el.closest<HTMLElement>('.fan-slot') ?? el, 1.1);
}

function revealBack(i: number, until: number) {
  if (hiddenBacks.get(i) !== until) return;
  hiddenBacks.delete(i);
  const el = document.querySelectorAll<HTMLElement>('.game .opp-hand .back')[i];
  if (el) el.style.visibility = '';
}

function bump(el: Element, k = 1.25, delay = 0) {
  el.animate([{ scale: '1' }, { scale: String(k) }, { scale: '1' }], { duration: 260, delay, easing: 'ease-out' });
}

// ── looks ─────────────────────────────────────────────

const STATE_CLASSES = ['focused', 'buyable', 'pickable', 'marked', 'target', 'ready', 'dim', 'playable'];

/** A copy of a card as it shows on the table, without its highlights. */
function lookOf(el: HTMLElement): HTMLElement {
  const c = el.cloneNode(true) as HTMLElement;
  for (const a of ['data-act', 'data-tip', 'data-uid']) c.removeAttribute(a);
  c.classList.remove(...STATE_CLASSES);
  c.style.visibility = '';
  return c;
}

const kindOf = (el: HTMLElement) => (el.classList.contains('chip') ? 'chip' : el.classList.contains('tile') ? 'tile' : 'card');

function tileLook(id: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = tileHtml(id);
  return t.content.firstElementChild as HTMLElement;
}

function backLook(): HTMLElement {
  const b = document.createElement('div');
  b.className = 'gh-back';
  b.innerHTML = '<span>✠</span>';
  return b;
}

/** Puts a look into a ghost, sized to w×h (tiles lay out their text from --tw). */
function face(look: HTMLElement, w: number, h: number, cls = 'gh-face'): HTMLElement {
  const f = document.createElement('div');
  f.className = cls;
  f.style.width = `${w}px`;
  f.style.height = `${h}px`;
  if (look.classList.contains('tile') || look.classList.contains('card')) f.style.setProperty('--tw', `${w}px`);
  f.appendChild(look);
  return f;
}

// ── flights ───────────────────────────────────────────

interface Flight {
  /** How the card looks when it sets off. */
  look: HTMLElement;
  /** What it turns into by the time it lands, if that differs. */
  end?: HTMLElement;
  from: Box;
  /** null: the card leaves the game where it is. */
  to: Box | null;
  delay: number;
  dur: number;
  /** Starts face down and turns over on the way. */
  flip?: boolean;
  /** Fades out as it lands (into a pile). */
  fade?: boolean;
  /** The opponent's move: stops in the middle of the table first, so it can be read. */
  show?: Box;
  /** Knocked out: shakes before it goes. */
  shake?: boolean;
  land?: () => void;
}

function fly(f: Flight) {
  if (layer.childElementCount >= MAX_GHOSTS) {
    setTimeout(() => f.land?.(), f.delay + f.dur);
    return;
  }
  const base = f.show ?? f.from;
  const g = document.createElement('div');
  g.className = 'mv-ghost';
  g.style.left = `${base.x - base.w / 2}px`;
  g.style.top = `${base.y - base.h / 2}px`;
  g.style.width = `${base.w}px`;
  g.style.height = `${base.h}px`;
  const card = document.createElement('div');
  card.className = 'gh-card';
  g.appendChild(card);
  const start = face(f.look, base.w, base.h);
  card.appendChild(start);
  if (f.flip) {
    const back = face(backLook(), base.w, base.h, 'gh-face gh-turned');
    card.appendChild(back);
  }
  const at = (b: Box, lift = 0, grow = 1) => {
    const s = Math.min(b.w / base.w, b.h / base.h) * grow;
    return `translate(${b.x - base.x}px, ${b.y - base.y - lift}px) scale(${s})`;
  };
  const to = f.to;
  let endFace: HTMLElement | null = null;
  if (f.end && to) {
    // Sized so that, scaled like the ghost, it matches the real card where it lands.
    const s = Math.min(to.w / base.w, to.h / base.h);
    endFace = face(f.end, to.w / s, to.h / s);
    endFace.style.left = `${(base.w - to.w / s) / 2}px`;
    endFace.style.top = `${(base.h - to.h / s) / 2}px`;
    card.appendChild(endFace);
  }
  layer.appendChild(g);
  const timing = { duration: f.dur, delay: f.delay, fill: 'both' as const };

  let path: Keyframe[];
  let morphAt = 0.5;
  if (!to) {
    // Burns away where it is.
    path = [
      { transform: 'none', filter: 'none', opacity: 1 },
      { transform: 'scale(1.12)', filter: 'brightness(1.8) sepia(.8) hue-rotate(-25deg)', opacity: 1, offset: 0.45 },
      { transform: 'translateY(-14px) scale(.9)', filter: 'brightness(.4) sepia(1) hue-rotate(-40deg)', opacity: 0 },
    ];
  } else if (f.show) {
    morphAt = 0.78;
    path = [
      { transform: at(f.from), offset: 0 },
      { transform: 'none', offset: 0.28, easing: 'linear' },
      { transform: 'scale(1.03)', offset: 0.66, easing: EASE },
      { transform: at(to), offset: 1 },
    ];
  } else if (f.shake) {
    path = [
      { transform: 'none', filter: 'none', offset: 0 },
      { transform: 'translateX(-6px)', filter: 'sepia(1) saturate(4) hue-rotate(-40deg)', offset: 0.08 },
      { transform: 'translateX(6px)', offset: 0.16 },
      { transform: 'translateX(-4px)', offset: 0.24 },
      { transform: 'none', filter: 'sepia(1) saturate(4) hue-rotate(-40deg)', offset: 0.34, easing: EASE },
      { transform: at(to), filter: 'none', offset: 1 },
    ];
  } else {
    const mid: Box = { x: (f.from.x + to.x) / 2, y: (f.from.y + to.y) / 2, w: (f.from.w + to.w) / 2, h: (f.from.h + to.h) / 2 };
    path = [
      { transform: at(f.from), offset: 0 },
      { transform: at(mid, Math.min(24, Math.abs(to.y - f.from.y) * 0.15 + 8), 1.08), offset: 0.5 },
      { transform: at(to), offset: 1 },
    ];
  }
  const anim = g.animate(path, { ...timing, easing: f.show || f.shake || !to ? 'linear' : EASE });
  if (f.fade) g.animate([{ opacity: 1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], timing);
  if (f.flip) {
    const turnBy = f.show ? 0.26 : 0.55;
    card.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(180deg)', offset: 0.05 }, { transform: 'rotateY(0deg)', offset: turnBy }, { transform: 'rotateY(0deg)' }], timing);
  }
  if (endFace) {
    endFace.animate([{ opacity: 0 }, { opacity: 0, offset: morphAt }, { opacity: 1, offset: Math.min(1, morphAt + 0.2) }, { opacity: 1 }], timing);
    start.animate([{ opacity: 1 }, { opacity: 1, offset: morphAt }, { opacity: 0, offset: Math.min(1, morphAt + 0.2) }, { opacity: 0 }], timing);
  }
  anim.finished
    .catch(() => undefined)
    .then(() => {
      g.remove();
      f.land?.();
    });
}

/** "+3 ●" rising from a counter. */
function floatText(at: Box, text: string, cls: string, delay: number) {
  const el = document.createElement('div');
  el.className = `float ${cls}`;
  el.innerHTML = richText(text);
  el.style.left = `${at.x}px`;
  el.style.top = `${at.y}px`;
  layer.appendChild(el);
  el.animate(
    [
      { transform: 'translate(-50%, -50%) scale(.7)', opacity: 0 },
      { transform: 'translate(-50%, -90%) scale(1.15)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%, -190%) scale(1)', opacity: 0 },
    ],
    { duration: 950, delay, fill: 'both', easing: 'ease-out' },
  ).finished.then(() => el.remove(), () => el.remove());
}

// ── planning ──────────────────────────────────────────

const REVEALED = new Set<Place['zone']>(['played', 'agents', 'tavern']);

/** Compares two states and animates what happened between them on the freshly drawn board. */
export function animateChange(root: HTMLElement, snap: Snapshot | null, prev: GameState | null, next: GameState, me: PlayerIdx) {
  const game = root.querySelector<HTMLElement>('.game');
  if (!game) return;
  rehide(game);
  if (!snap || !prev || prev === next || prev.phase === 'over' || still()) return;
  const now = performance.now();
  const sel = (p: PlayerIdx | null, mine: string, theirs: string) => game.querySelector<HTMLElement>(p === me ? mine : theirs);
  const tavernTile = game.querySelector<HTMLElement>('.tavern .tile');
  const tw = tavernTile?.offsetWidth ?? 70;
  const pileSize = (b: Box): Box => ({ ...b, w: tw * 0.5, h: tw * 0.7 });
  const anchor = (el: Element | null): Box | null => (el ? pileSize(boxOf(el)) : null);
  const deckBox = (p: PlayerIdx | null) => anchor(sel(p, '.my-bar [data-act="pile-deck"]', '.opp-bar [data-act="pile-opp-deck"]'));
  const cdBox = (p: PlayerIdx | null) => anchor(sel(p, '.my-bar [data-act="pile-cd"]', '.opp-bar [data-act="pile-opp-cd"]'));
  const tdeckBox = () => anchor(game.querySelector('.sl-tavern small') ?? game.querySelector('.sl-tavern'));
  const oppHandBox = () => anchor(game.querySelector('.opp-hand'));
  const newBacks = [...game.querySelectorAll<HTMLElement>('.opp-hand .back')];
  // The middle of the table, where the opponent's moves are shown.
  const tav = game.querySelector('.tavern');
  const showW = Math.min(tw * 1.55, 150, innerWidth * 0.36);
  const show: Box | null = tav ? { ...boxOf(tav), w: showW, h: showW + 40 } : null;

  const actor = actingPlayer(prev);
  const theirs = actor !== me;
  const turnEnded = next.events?.some((e) => e.k === 'turn') ? prev.current : null;
  const dealt = prev.phase === 'draft';
  const resolvedContracts = new Set(next.events?.filter((e) => e.k === 'buy').map((e) => (e as { card: string }).card));

  interface End {
    box: Box;
    look?: HTMLElement;
    faceDown?: boolean;
    el?: HTMLElement;
    back?: number;
  }

  /** Where a card sets off from: its old place on the board, or the pile it came out of. */
  const source = (uid: number, f: Place): End | null => {
    const seen = snap.cards.get(uid);
    if (seen) return { box: seen.box, look: lookOf(seen.el) };
    switch (f.zone) {
      case 'hand': {
        if (f.p === me) return null;
        const b = snap.backs[f.i] ?? snap.backs[snap.backs.length - 1] ?? oppHandBox();
        return b && { box: b, faceDown: true };
      }
      case 'deck': {
        const b = deckBox(f.p);
        return b && { box: b, faceDown: true };
      }
      case 'cd': {
        const b = cdBox(f.p);
        return b && { box: b };
      }
      case 'tdeck': {
        const b = tdeckBox();
        return b && { box: b, faceDown: true };
      }
      case 'confined': {
        const h = snap.cards.get(f.holder!);
        return h ? { box: h.box } : null;
      }
      default:
        return null;
    }
  };

  /** Where a card lands: its new place on the board, or the pile it went into. */
  const target = (uid: number, t: Place): End | null => {
    const el = REVEALED.has(t.zone) || (t.zone === 'hand' && t.p === me) ? cardEl(game, uid) : null;
    if (el) return { box: inList(el, boxOf(el), true), look: lookOf(el), el };
    switch (t.zone) {
      case 'hand': {
        const b = newBacks[t.i];
        return b ? { box: boxOf(b), faceDown: true, back: t.i } : oppHandBox() && { box: oppHandBox()!, faceDown: true };
      }
      case 'deck': {
        const b = deckBox(t.p);
        return b && { box: b, faceDown: true };
      }
      case 'cd': {
        const b = cdBox(t.p);
        return b && { box: b };
      }
      case 'tdeck': {
        const b = tdeckBox();
        return b && { box: b, faceDown: true };
      }
      case 'confined': {
        const h = cardEl(game, t.holder!);
        return h ? { box: boxOf(h) } : null;
      }
      default:
        return null;
    }
  };

  const pileSel = (t: Place) =>
    t.zone === 'deck' ? (t.p === me ? '.my-bar [data-act="pile-deck"]' : '.opp-bar [data-act="pile-opp-deck"]')
    : t.zone === 'cd' ? (t.p === me ? '.my-bar [data-act="pile-cd"]' : '.opp-bar [data-act="pile-opp-cd"]')
    : null;

  let leaving = 0;
  let shuffled = 0;
  let arriving = 0;
  let firstLanding = 0;
  const arriveBase = () => (dealt ? 150 : turnEnded !== null ? 520 : leaving ? 220 : 0);

  const launch = (m: Move, from: Place, to: Place, phase: 0 | 1 | 2) => {
    const src = source(m.uid, from);
    let dst = target(m.uid, to);
    // A contract bought from the tavern resolves at once and leaves the table.
    if (from.zone === 'tavern' && to.zone === 'tdeck' && resolvedContracts.has(m.id)) dst = null;
    if (!src && !dst) return;
    const start: End = src ?? { box: show ? { ...show, w: show.w * 0.3, h: show.h * 0.3 } : dst!.box, look: tileLook(m.id) };
    const showcase =
      theirs &&
      show &&
      to.p === actor &&
      ((from.zone === 'hand' && (to.zone === 'played' || to.zone === 'agents')) || from.zone === 'tavern' || from.zone === 'gone');
    const knocked = from.zone === 'agents' && to.zone !== 'agents';

    let delay = 0;
    let dur = MOVE_MS;
    if (phase === 0) delay = leaving++ * (turnEnded !== null ? 35 : 60);
    else if (phase === 1) {
      if (shuffled >= 4) return; // a few backs are enough to show a reshuffle
      delay = 300 + shuffled++ * 50;
    } else {
      delay = arriveBase() + arriving++ * (dealt ? 55 : 85);
      dur = DRAW_MS;
    }
    if (showcase) dur = SHOW_MS;
    if (knocked) dur = 760;
    if (!dst) dur = 620;

    // Face down from start to finish (a draw into the opponent's hand, a reshuffle).
    const hidden = !!start.faceDown && (!dst || !!dst.faceDown);
    let look: HTMLElement;
    let end: HTMLElement | undefined;
    if (hidden) look = backLook();
    else if (showcase) {
      // Shown as a full tile in the middle of the table, whatever it becomes after.
      look = from.zone === 'tavern' && start.look ? start.look : tileLook(m.id);
      end = dst?.look;
    } else {
      look = start.look ?? dst?.look ?? tileLook(m.id);
      if (start.look && dst?.look && kindOf(start.look) !== kindOf(dst.look)) end = dst.look;
    }

    const until = now + delay + dur;
    if (dst?.el) hideCard(m.uid, dst.el, until);
    if (dst?.back !== undefined) {
      newBacks[dst.back].style.visibility = 'hidden';
      hiddenBacks.set(dst.back, until);
    }
    if (!firstLanding || until < firstLanding) firstLanding = until;
    const pile = pileSel(to);
    fly({
      look,
      end,
      from: start.box,
      to: dst?.box ?? null,
      delay,
      dur,
      flip: !!start.faceDown && !hidden,
      fade: !!dst && !dst.el && dst.back === undefined,
      show: showcase ? show! : undefined,
      shake: knocked,
      land: () => {
        if (dst?.el) revealCard(m.uid, until);
        if (dst?.back !== undefined) revealBack(dst.back, until);
        const el = pile && document.querySelector(`.game ${pile}`);
        if (el) bump(el, 1.18);
      },
    });
  };

  for (const m0 of cardMoves(prev, next)) {
    let m = m0;
    // The opening deal: cards come out of each player's deck and the tavern deck.
    if (dealt && m.from.zone === 'gone') m = { ...m, from: { zone: m.to.zone === 'tavern' ? 'tdeck' : 'deck', p: m.to.p, i: 0 } };
    if (m.from.zone === m.to.zone && m.from.p === m.to.p) continue;
    const f = m.from;
    const t = m.to;
    // End of turn: what was played and held goes to the cooldown first; new cards come after.
    if (turnEnded !== null && f.p === turnEnded && (f.zone === 'hand' || f.zone === 'played') && (t.zone === 'hand' || t.zone === 'deck')) {
      const cd: Place = { zone: 'cd', p: f.p, i: 0 };
      launch(m, f, cd, 0);
      if (t.zone === 'hand') launch(m, { zone: 'deck', p: t.p, i: 0 }, t, 2);
      continue;
    }
    const phase = f.zone === 'cd' && t.zone === 'deck' && turnEnded !== null ? 1 : f.zone === 'deck' || f.zone === 'tdeck' || f.zone === 'gone' ? 2 : 0;
    launch(m, f, t, phase);
  }

  // Cards that kept their place but shifted (the fan closing up, the tavern sliding left).
  for (const [uid, seen] of snap.cards) {
    if (hiddenCards.has(uid)) continue;
    const el = cardEl(game, uid);
    if (!el || el.closest('.pl-list')) continue;
    const b = boxOf(el);
    const dx = seen.box.x - b.x;
    const dy = seen.box.y - b.y;
    if (Math.abs(dx) + Math.abs(dy) < 3 || Math.abs(dx) + Math.abs(dy) > innerHeight) continue;
    (el.closest<HTMLElement>('.fan-slot') ?? el).animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 280, easing: EASE });
  }

  // Agents: hits, healing, actions.
  const resDelay = firstLanding ? Math.max(0, firstLanding - now - 80) : 0;
  next.players.forEach((pl, pi) => {
    const before = new Map(prev.players[pi].agents.map((a) => [a.uid, a] as [number, AgentInPlay]));
    for (const a of pl.agents) {
      const was = before.get(a.uid);
      const el = cardEl(game, a.uid);
      if (!was || !el) continue;
      const b = boxOf(el);
      if (a.dmg > was.dmg) {
        el.animate(
          [{ transform: 'none' }, { transform: 'translateX(-5px) rotate(-3deg)', filter: 'sepia(1) saturate(5) hue-rotate(-40deg)' }, { transform: 'translateX(5px) rotate(3deg)' }, { transform: 'none' }],
          { duration: 360, easing: 'ease-out' },
        );
        floatText(b, `−${a.dmg - was.dmg}`, 'bad', 0);
      } else if (a.dmg < was.dmg) floatText(b, `+${was.dmg - a.dmg}`, 'heal', 0);
      if (a.activated && !was.activated && turnEnded === null) {
        el.animate([{ scale: '1', filter: 'brightness(1)' }, { scale: '1.12', filter: 'brightness(1.7)' }, { scale: '1', filter: 'brightness(1)' }], { duration: 420, easing: 'ease-out' });
      }
    }
    // An agent knocked out by an attack: its last hit point.
    for (const was of before.values()) {
      if (pl.agents.some((a) => a.uid === was.uid)) continue;
      const seen = snap.cards.get(was.uid);
      if (seen && next.events?.some((e) => e.k === 'attack')) floatText(seen.box, `−${hpLeft(was)}`, 'bad', 0);
    }
  });

  // Prestige, power and coins rise or fall where they are counted.
  const RES = [
    ['prestige', 'pre', '✦'],
    ['power', 'pow', '⚔'],
    ['coin', 'coin', '●'],
  ] as const;
  next.players.forEach((pl, pi) => {
    for (const [key, cls, icon] of RES) {
      const d = pl[key] - prev.players[pi][key];
      if (!d) continue;
      const el = sel(pi as PlayerIdx, `.my-bar .res.${cls}`, `.opp-bar .res.${cls}`);
      if (!el) continue;
      // Spending isn't news; what a card or patron gives (or takes) is.
      const delay = key === 'coin' && d < 0 ? 0 : resDelay;
      floatText(boxOf(el), `${d > 0 ? '+' : '−'}${Math.abs(d)}${icon}`, d > 0 ? cls : 'bad', delay);
      bump(el, 1.3, delay);
    }
  });

  // Patrons called or turned.
  for (const pid of next.patrons) {
    const called = next.events?.some((e) => e.k === 'patron' && e.patron === pid);
    if (!called && prev.favor[pid] === next.favor[pid]) continue;
    const track = game.querySelector(`.patron[data-patron="${pid}"] .p-track`);
    track?.animate([{ scale: '1', filter: 'brightness(1)' }, { scale: '1.15', filter: 'brightness(1.9)' }, { scale: '1', filter: 'brightness(1)' }], { duration: 520, easing: 'ease-out' });
  }
}
