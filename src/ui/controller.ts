import { botAction, type BotLevel } from '../engine/bot';
import { actingPlayer, applyAction, createGame, prestigeGoal, RuleError } from '../engine/engine';
import { LOCKED } from '../engine/cards';
import { randomSeed } from '../engine/rng';
import { createTutorialGame } from '../engine/tutorial';
import type { Action, GameState, PatronId, PlayerIdx } from '../engine/types';
import type { Accept, HostedRoom, JoinRoom, Link, NetMessage, OpenRoom } from '../net/room';
import { clientId, forgetMatch, saveMatch } from '../net/saved';
import { draftPool, recordGame, unlockedPatrons } from './unlocks';

/** One running match as seen by the local player. */
export abstract class Controller {
  abstract readonly me: PlayerIdx;
  abstract readonly kind: 'bot' | 'host' | 'guest';
  state: GameState | null = null;
  notice = '';
  error = '';
  /** Set when this side's match is gone for good: the game goes back to the menu with this message. */
  gone = '';
  /** Patrons the game that just ended opened. */
  unlocked: PatronId[] = [];
  /** Whether finished games count toward unlocking patrons. */
  protected counts = true;
  private wasOver = false;
  private listeners: (() => void)[] = [];

  subscribe(fn: () => void) {
    this.listeners.push(fn);
  }

  protected emit() {
    const over = this.state?.phase === 'over';
    // A game counts once, when it ends after the draft; only a win moves the unlocks.
    if (over && !this.wasOver) this.unlocked = this.counts && this.state!.turn > 0 ? recordGame(this.state!.winner === this.me) : [];
    else if (!over) this.unlocked = [];
    this.wasOver = over;
    for (const fn of this.listeners) fn();
  }

  abstract dispatch(a: Action): void;
  /** The coin toss has been shown; the game may go on. */
  tossShown() {}
  dispose() {
    this.listeners = [];
  }
}

/** The coin toss: who moves first and opens the draft. */
export function tossCoin(): PlayerIdx {
  return Math.random() < 0.5 ? 0 : 1;
}

/** Longest the bot waits for the coin toss to be shown before it plays on anyway. */
const TOSS_WAIT_MS = 8000;

/** Whether the power turned into prestige at the end of the last turn took a player up to the goal. */
function reachedGoalAtTurnEnd(s: GameState): boolean {
  const goal = prestigeGoal(s);
  return !!s.events?.some((e) => e.k === 'prestige' && s.players[e.p].prestige >= goal && s.players[e.p].prestige - e.n < goal);
}

/** Pause before the bot's next move, long enough to follow what it does. */
function botDelay(s: GameState): number {
  if (s.phase === 'draft') return 900;
  // let the turn banner play first, and before it the notice of a player reaching the prestige goal
  if (s.events?.some((e) => e.k === 'turn')) return reachedGoalAtTurnEnd(s) ? 3400 : 1400;
  return 1150;
}

interface Thought {
  resolve: (a: Action | null) => void;
  state: GameState;
  level: BotLevel;
}
let worker: Worker | null | undefined;
let seq = 0;
const thinking = new Map<number, Thought>();
/** Answers the worker owes to warmBot's calls. */
const pings = new Map<number, () => void>();

/** The bot's worker, started on first use; null where workers are unavailable. */
function botWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; action: Action | null }>) => {
      pings.get(e.data.id)?.();
      pings.delete(e.data.id);
      thinking.get(e.data.id)?.resolve(e.data.action);
      thinking.delete(e.data.id);
    };
    // If the worker fails, the moves it owed are worked out here and later ones too.
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      for (const t of thinking.values()) t.resolve(botAction(t.state, 1, t.level));
      thinking.clear();
      for (const done of pings.values()) done();
      pings.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Starts the bot's worker and waits until its code has loaded, so the hard bot's first move fetches nothing. */
export function warmBot(): Promise<void> {
  const w = botWorker();
  if (!w) return Promise.resolve();
  return new Promise((resolve) => {
    const id = ++seq;
    pings.set(id, resolve);
    w.postMessage({ id });
  });
}

/** The bot's next move; the hard bot thinks in the worker. */
function think(state: GameState, level: BotLevel): Promise<Action | null> {
  const w = level === 'hard' ? botWorker() : null;
  if (!w) return Promise.resolve(botAction(state, 1, level));
  return new Promise((resolve) => {
    const id = ++seq;
    thinking.set(id, { resolve, state, level });
    w.postMessage({ id, state, pi: 1, level });
  });
}

/** The bot's name in the game tells which level it plays at. */
const BOT_NAMES: Record<BotLevel, string> = {
  gentle: 'Наставник',
  easy: 'Бот-послушник',
  medium: 'Бот-некромант',
  hard: 'Бот-архилич',
};

export class BotController extends Controller {
  readonly me: PlayerIdx = 0;
  readonly kind = 'bot';
  private timer = 0;
  /** Bumped by every new position, so a move thought out for an old one is dropped. */
  private ticket = 0;
  /** While the coin is in the air the bot doesn't pick, even when it won the toss. */
  private tossing = false;
  private tossTimer = 0;

  /** The `gentle` level plays the short scripted tutorial game. */
  constructor(
    private playerName: string,
    readonly level: BotLevel = 'medium',
  ) {
    super();
    this.counts = !this.tutorial;
    this.restart();
  }

  get tutorial() {
    return this.level === 'gentle';
  }

  restart() {
    this.state = this.tutorial
      ? createTutorialGame(this.playerName)
      : createGame(randomSeed(), [this.playerName, BOT_NAMES[this.level]], { pool: draftPool(), first: tossCoin() });
    // The tutorial is dealt the same every time and tosses no coin.
    this.tossing = this.state.first !== undefined;
    clearTimeout(this.tossTimer);
    if (this.tossing) this.tossTimer = window.setTimeout(() => this.tossShown(), TOSS_WAIT_MS);
    this.emit();
    this.schedule();
  }

  tossShown() {
    if (!this.tossing) return;
    this.tossing = false;
    clearTimeout(this.tossTimer);
    this.schedule();
  }

  dispatch(a: Action) {
    if (!this.state) return;
    try {
      this.state = applyAction(this.state, this.me, a);
      this.error = '';
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      this.error = e.message;
    }
    this.emit();
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    const ticket = ++this.ticket;
    const s = this.state;
    if (!s || s.phase === 'over' || this.tossing || actingPlayer(s) !== 1) return;
    const started = performance.now();
    think(s, this.level).then((a) => {
      if (ticket !== this.ticket) return;
      // The pause is counted from when the bot started thinking.
      const wait = Math.max(0, botDelay(s) - (performance.now() - started));
      this.timer = window.setTimeout(() => {
        if (ticket !== this.ticket) return;
        if (a) this.state = applyAction(s, 1, a);
        this.emit();
        this.schedule();
      }, wait);
    });
  }

  dispose() {
    clearTimeout(this.timer);
    clearTimeout(this.tossTimer);
    this.ticket++;
    super.dispose();
  }
}

/** Pauses between tries to get a lost room or link back. */
const RETRY_MS = [1000, 2000, 3000, 5000];
const retryDelay = (n: number) => RETRY_MS[Math.min(n, RETRY_MS.length - 1)];
/** A connection that hasn't said hello by then is dropped. */
const HELLO_MS = 15000;

/**
 * The room's host runs the game. The room stays open for the whole match: a guest who
 * drops out comes back by connecting again, and only the guest who joined gets in.
 * The match is saved after every move, so a reloaded host page opens the same room again.
 */
export class HostController extends Controller {
  readonly me: PlayerIdx = 0;
  readonly kind = 'host';
  /** The room is registered, so its code can be handed out. */
  ready = false;
  /** The guest's connection, while they are in the room. */
  private link: Link | null = null;
  /** The guest who joined this match. */
  private client: string | null = null;
  private room: HostedRoom | null = null;
  private tries = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private playerName: string,
    readonly code: string,
    private openRoom: OpenRoom,
    saved?: { client: string | null; state: GameState },
  ) {
    super();
    if (saved) {
      this.state = saved.state;
      this.client = saved.client;
    }
    this.notice = saved ? 'Восстанавливаем комнату…' : 'Открываем комнату…';
    this.open();
  }

  /** Whether the guest is in the room right now. */
  get online() {
    return !!this.link;
  }

  private async open() {
    try {
      const room = await this.openRoom(this.code, (accept) => this.accept(accept));
      if (this.disposed) return room.close();
      this.room = room;
      this.ready = true;
      this.tries = 0;
      this.notice = this.state && !this.link ? 'Соперник переподключается…' : '';
    } catch (e) {
      if (this.disposed) return;
      // A new room gives up at once; a match in progress keeps trying, as the broker
      // may hold the code of the reloaded page for a while.
      if (!this.state) this.gone = e instanceof Error ? e.message : String(e);
      else this.timer = setTimeout(() => this.open(), retryDelay(this.tries++));
    }
    this.emit();
  }

  private accept(accept: Accept) {
    if (this.disposed) return;
    let hello = false;
    const link: Link = accept({
      onMessage: (m) => {
        if (m.type === 'hello') hello = true;
        this.onMessage(link, m);
      },
      onClose: () => {
        if (link === this.link) this.lost();
      },
    });
    setTimeout(() => {
      if (!hello) link.close();
    }, HELLO_MS);
  }

  private onMessage(link: Link, m: NetMessage) {
    if (m.type === 'hello') {
      const client = m.client ?? null;
      if (!this.state) {
        // The host tosses the coin; the guest gets the result with the state, so both see the same.
        // The draft holds the patrons either player has opened, and each may take only their own.
        const theirs = (Array.isArray(m.patrons) ? m.patrons : []).filter((pid) => LOCKED.includes(pid));
        this.state = createGame(randomSeed(), [this.playerName, m.name.slice(0, 24) || 'Гость'], {
          pool: draftPool(theirs),
          own: [unlockedPatrons(), theirs],
          first: tossCoin(),
        });
        this.client = client;
      } else if (client !== this.client) {
        link.send({ type: 'reject', message: 'Комната уже занята.' });
        setTimeout(() => link.close(), 500);
        return;
      }
      // The same guest on a new connection: the old one is stale.
      if (this.link !== link) this.link?.close();
      this.link = link;
      this.notice = '';
      this.broadcast();
      return;
    }
    if (link !== this.link) return;
    if (m.type === 'action' && this.state) {
      try {
        this.state = applyAction(this.state, 1, m.action);
        this.broadcast();
      } catch (e) {
        link.send({ type: 'error', message: e instanceof Error ? e.message : 'Ошибка' });
      }
    } else if (m.type === 'bye') {
      link.close();
      this.link = null;
      this.notice = 'Соперник покинул партию.';
      this.emit();
    }
  }

  private lost() {
    this.link = null;
    this.notice = this.state?.phase === 'over' ? 'Соперник отключился.' : 'Соперник переподключается…';
    this.emit();
  }

  private broadcast() {
    const s = this.state;
    if (!s) return;
    this.link?.send({ type: 'state', state: s });
    if (s.phase === 'over') forgetMatch('host');
    else saveMatch({ role: 'host', code: this.code, name: this.playerName, client: this.client, state: s, at: Date.now() });
    this.emit();
  }

  dispatch(a: Action) {
    if (!this.state) return;
    try {
      this.state = applyAction(this.state, this.me, a);
      this.error = '';
      this.broadcast();
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      this.error = e.message;
      this.emit();
    }
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.link?.send({ type: 'bye' });
    this.link?.close();
    this.room?.close();
    forgetMatch('host');
    super.dispose();
  }
}

/**
 * The guest plays on the host's state. A lost link is tried again until the host is back,
 * and a reloaded guest page comes back to the room it played in.
 */
export class GuestController extends Controller {
  readonly me: PlayerIdx = 1;
  readonly kind = 'guest';
  private link: Link | null = null;
  /** The host has answered on the current link, so the state shown is the live one. */
  private live = false;
  /** The guest has been in this match: a lost link is tried again instead of given up. */
  private joined: boolean;
  /** The host left the match on purpose: there is nothing to come back to. */
  private hostLeft = false;
  private tries = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    readonly code: string,
    private playerName: string,
    private join: JoinRoom,
    restoring = false,
  ) {
    super();
    this.joined = restoring;
    this.notice = restoring ? 'Возвращаемся в партию…' : `Подключаемся к комнате ${code}…`;
    this.connect();
  }

  /** Whether the link to the host is down (or not answered yet), so moves can't be sent. */
  get offline() {
    return !this.live;
  }

  private async connect() {
    let link: Link | undefined;
    try {
      link = await this.join(this.code, {
        onMessage: (m) => {
          if (link && link === this.link) this.onMessage(link, m);
        },
        onClose: () => {
          if (link && link === this.link) this.lost();
        },
      });
    } catch (e) {
      if (this.disposed) return;
      if (this.joined) this.retry();
      else {
        this.gone = e instanceof Error ? e.message : String(e);
        this.emit();
      }
      return;
    }
    if (this.disposed) return link.close();
    this.link = link;
    this.tries = 0;
    link.send({ type: 'hello', name: this.playerName, client: clientId(), patrons: unlockedPatrons() });
    if (!this.state) this.notice = 'Ждём начала игры…';
    this.emit();
  }

  private onMessage(link: Link, m: NetMessage) {
    if (m.type === 'state') {
      this.state = m.state;
      this.live = true;
      this.joined = true;
      this.notice = '';
      this.error = '';
      if (m.state.phase === 'over') forgetMatch('guest');
      else saveMatch({ role: 'guest', code: this.code, name: this.playerName, at: Date.now() });
    } else if (m.type === 'error') {
      this.error = m.message;
    } else if (m.type === 'reject') {
      link.close();
      this.link = null;
      this.live = false;
      forgetMatch('guest');
      this.gone = m.message;
    } else if (m.type === 'bye') {
      link.close();
      this.link = null;
      this.live = false;
      this.hostLeft = true;
      forgetMatch('guest');
      this.notice = 'Хозяин комнаты покинул партию.';
    }
    this.emit();
  }

  private lost() {
    this.link = null;
    this.live = false;
    if (!this.joined) {
      this.gone = 'Соединение потеряно.';
    } else if (this.state?.phase === 'over') {
      this.notice = 'Соединение потеряно.';
    } else {
      this.notice = 'Связь потеряна. Переподключаемся…';
      this.retry();
    }
    this.emit();
  }

  private retry() {
    if (this.disposed || this.hostLeft) return;
    this.notice = 'Связь потеряна. Переподключаемся…';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), retryDelay(this.tries++));
    this.emit();
  }

  dispatch(a: Action) {
    if (this.live) this.link?.send({ type: 'action', action: a });
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.link?.send({ type: 'bye' });
    this.link?.close();
    forgetMatch('guest');
    super.dispose();
  }
}
