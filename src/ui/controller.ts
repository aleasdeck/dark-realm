import { botAction, type BotLevel } from '../engine/bot';
import { actingPlayer, applyAction, createGame, prestigeGoal, RuleError } from '../engine/engine';
import { LOCKED } from '../engine/cards';
import { randomSeed } from '../engine/rng';
import { createTutorialGame } from '../engine/tutorial';
import type { Action, GameState, PatronId, PlayerIdx } from '../engine/types';
import type { Accept, HostedRoom, JoinRoom, Link, NetMessage, OpenRoom } from '../net/room';
import { newMatchId, rateGame, type RatingStatus } from '../net/rating';
import { clientId, forgetMatch, saveMatch } from '../net/saved';
import { LOCKSTEP, stateHash } from '../net/sync';
import { GameClock } from './clock';
import { forgetBotGame, saveBotGame } from './savedGame';
import { strikePause } from './moves';
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
  /** Network games: where the finished game stands in the rating table; null when it isn't rated. */
  rating: RatingStatus | null = null;
  /** How long this game has been played. */
  clock = new GameClock();
  /** Whether finished games count toward unlocking patrons. */
  protected counts = true;
  private wasOver = false;
  private stopRating: (() => void) | null = null;
  private listeners: (() => void)[] = [];

  subscribe(fn: () => void) {
    this.listeners.push(fn);
  }

  protected emit() {
    this.clock.track(this.state, pageShown());
    const over = this.state?.phase === 'over';
    // A game counts once, when it ends after the draft; only a win moves the unlocks.
    if (over && !this.wasOver) {
      this.unlocked = this.counts && this.state!.turn > 0 ? recordGame(this.state!.winner === this.me) : [];
      // A network game ended after the draft goes to the rating; one conceded in the draft doesn't.
      if (this.kind !== 'bot' && this.state!.turn > 0) {
        let now = true;
        this.stopRating = rateGame(this.state!, this.me, (r) => {
          this.rating = r;
          if (!now) this.emit();
        });
        now = false;
      }
    } else if (!over) this.unlocked = [];
    this.wasOver = over;
    for (const fn of this.listeners) fn();
  }

  abstract dispatch(a: Action): void;
  /** The coin toss has been shown; the game may go on. */
  tossShown() {}
  /** The player steps out to the menu but keeps the match to come back to. */
  suspend() {
    this.dispose();
  }
  /** The page was hidden or shown again: the game clock stands while nobody can see the game. */
  shownChanged() {
    this.clock.track(this.state, pageShown());
  }

  dispose() {
    this.clock.stop();
    this.stopRating?.();
    this.listeners = [];
  }
}

const pageShown = () => typeof document === 'undefined' || !document.hidden;

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
  // let the turn banner play first, and before it the notice of a player reaching the prestige goal,
  // and before both the leftover power hitting taunting agents
  if (s.events?.some((e) => e.k === 'turn')) {
    const strikes = strikePause(s.events.filter((e) => e.k === 'attack').length);
    return strikes + (reachedGoalAtTurnEnd(s) ? 3400 : 1400);
  }
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

  /** The `gentle` level plays the short scripted tutorial game; a saved game picks up where it was left. */
  constructor(
    private playerName: string,
    readonly level: BotLevel = 'medium',
    saved?: GameState,
  ) {
    super();
    this.counts = !this.tutorial;
    if (!this.tutorial) this.clock = GameClock.open('bot', !!saved);
    if (saved) this.begin(saved);
    else this.restart();
  }

  get tutorial() {
    return this.level === 'gentle';
  }

  restart() {
    // A rematch is a new game with a clock of its own.
    if (this.state) this.clock = this.tutorial ? new GameClock() : GameClock.open('bot', false);
    this.begin(
      this.tutorial
        ? createTutorialGame(this.playerName)
        : createGame(randomSeed(), [this.playerName, BOT_NAMES[this.level]], { pool: draftPool(), first: tossCoin() }),
    );
  }

  private begin(state: GameState) {
    this.state = state;
    // The tutorial is dealt the same every time and tosses no coin; a saved game tosses again only if the draft hasn't started.
    this.tossing = state.first !== undefined && state.phase === 'draft' && state.draftStep === 0;
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

  /** Every position of a game against the bot is kept until the game ends. */
  protected emit() {
    if (!this.tutorial && this.state) {
      if (this.state.phase === 'over') forgetBotGame();
      else saveBotGame(this.level, this.state);
    }
    super.emit();
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
 * The guest gets the whole state when it joins and then each move on its own.
 */
export class HostController extends Controller {
  readonly me: PlayerIdx = 0;
  readonly kind = 'host';
  /** The room is registered, so its code can be handed out. */
  ready = false;
  /** The guest's connection, while they are in the room. */
  private link: Link | null = null;
  /** The guest plays the moves on its own copy of the game; an older guest gets the whole state each time. */
  private lockstep = false;
  /** Moves made in this match so far. */
  private seq = 0;
  /** The guest who joined this match. */
  private client: string | null = null;
  private room: HostedRoom | null = null;
  private tries = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  /** Stepping out to the menu keeps the match saved and doesn't say goodbye. */
  private kept = false;

  constructor(
    private playerName: string,
    readonly code: string,
    private openRoom: OpenRoom,
    saved?: { client: string | null; state: GameState; seq?: number },
  ) {
    super();
    this.clock = GameClock.open('host', !!saved);
    if (saved) {
      this.state = saved.state;
      this.client = saved.client;
      this.seq = saved.seq ?? 0;
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
        this.state.match = newMatchId();
        this.client = client;
      } else if (client !== this.client) {
        link.send({ type: 'reject', message: 'Комната уже занята.' });
        setTimeout(() => link.close(), 500);
        return;
      }
      // The same guest on a new connection: the old one is stale.
      if (this.link !== link) this.link?.close();
      this.link = link;
      this.lockstep = (m.v ?? 0) >= LOCKSTEP;
      this.notice = '';
      this.sendState();
      this.save();
      this.emit();
      return;
    }
    if (link !== this.link) return;
    if (m.type === 'action' && this.state) {
      // A move made in a state the host has moved on from: the guest's copy is behind, so it gets the real one.
      if (m.seq !== undefined && m.seq !== this.seq) return this.sendState();
      let next: GameState;
      try {
        next = applyAction(this.state, 1, m.action);
      } catch (e) {
        link.send({ type: 'error', message: e instanceof Error ? e.message : 'Ошибка' });
        // The guest has already played it on its copy: that copy goes back to the host's.
        if (this.lockstep) this.sendState();
        return;
      }
      this.commit(next, 1, m.action);
    } else if (m.type === 'sync') {
      this.sendState();
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

  private sendState() {
    if (this.state) this.link?.send({ type: 'state', state: this.state, seq: this.seq });
  }

  /** A move is made: the guest hears of it, and the match is saved as it now stands. */
  private commit(s: GameState, by: PlayerIdx, action: Action) {
    this.state = s;
    this.seq++;
    if (this.lockstep) this.link?.send({ type: 'move', by, action, seq: this.seq, hash: stateHash(s) });
    else this.sendState();
    this.save();
    this.emit();
  }

  private save() {
    const s = this.state;
    if (!s) return;
    if (s.phase === 'over') forgetMatch('host');
    else saveMatch({ role: 'host', code: this.code, name: this.playerName, client: this.client, state: s, seq: this.seq, at: Date.now() });
  }

  dispatch(a: Action) {
    if (!this.state) return;
    try {
      const next = applyAction(this.state, this.me, a);
      this.error = '';
      this.commit(next, this.me, a);
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      this.error = e.message;
      this.emit();
    }
  }

  suspend() {
    this.kept = true;
    this.dispose();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    if (!this.kept) this.link?.send({ type: 'bye' });
    this.link?.close();
    this.room?.close();
    if (!this.kept) forgetMatch('host');
    super.dispose();
  }
}

/** A move the guest has made on its copy and sent, not yet confirmed by the host. */
interface Unconfirmed {
  action: Action;
  /** The move count of the state it was made in. */
  seq: number;
}

/**
 * The guest plays on its own copy of the host's game: its moves show at once, without
 * waiting for the host, and the host's moves arrive one by one and are played on the copy
 * too. The host's word is final: a fingerprint that doesn't match, or a move the host
 * turned down, brings the whole state over again. A lost link is tried again until the
 * host is back, and a reloaded guest page comes back to the room it played in.
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
  /** The game as the host last confirmed it, and how many moves it holds. */
  private confirmed: GameState | null = null;
  private seq = 0;
  /** The guest's own moves on top of `confirmed` that the host hasn't confirmed yet; `state` shows them made. */
  private unconfirmed: Unconfirmed[] = [];
  /** The host speaks in moves; an older host sends the whole state after each one, so the guest waits for it. */
  private lockstep = false;
  /** The guest asked for the whole state and ignores moves until it comes. */
  private syncing = false;
  /** The next whole state is the first on a new link: moves made before the link was lost are sent again. */
  private fresh = false;
  private tries = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  /** Stepping out to the menu keeps the match saved and doesn't say goodbye. */
  private kept = false;

  constructor(
    readonly code: string,
    private playerName: string,
    private join: JoinRoom,
    restoring = false,
  ) {
    super();
    this.clock = GameClock.open('guest', restoring);
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
    this.fresh = true;
    this.syncing = false;
    link.send({ type: 'hello', name: this.playerName, client: clientId(), patrons: unlockedPatrons(), v: LOCKSTEP });
    if (!this.state) this.notice = 'Ждём начала игры…';
    this.emit();
  }

  private onMessage(link: Link, m: NetMessage) {
    if (m.type === 'state') {
      this.resync(link, m.state, m.seq);
      this.live = true;
      this.joined = true;
      this.notice = '';
      // An older host's state means the move went through; a host speaking in moves sends
      // the state after an error too, and the error should stay up.
      if (!this.lockstep) this.error = '';
      this.keep();
    } else if (m.type === 'move') {
      if (!this.onMove(link, m)) return;
      this.keep();
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

  /**
   * The host's whole state. On a new link the guest's unconfirmed moves the host never got
   * are made again on it and sent again; otherwise the host's state stands as it is. When
   * it shows what the table already shows, the table is left alone, so nothing plays twice.
   */
  private resync(link: Link, state: GameState, seq: number | undefined) {
    this.lockstep = seq !== undefined;
    this.syncing = false;
    this.confirmed = state;
    this.seq = seq ?? 0;
    let shown = state;
    const resend = this.fresh && this.lockstep ? this.unconfirmed.filter((u) => u.seq >= this.seq) : [];
    this.fresh = false;
    this.unconfirmed = [];
    for (const u of resend) {
      try {
        shown = applyAction(shown, this.me, u.action);
      } catch {
        break;
      }
      const sent = { action: u.action, seq: this.seq + this.unconfirmed.length };
      this.unconfirmed.push(sent);
      link.send({ type: 'action', ...sent });
    }
    if (!this.state || stateHash(shown) !== stateHash(this.state)) this.state = shown;
  }

  /** A move the host made or confirmed; false when nothing changed on the table. */
  private onMove(link: Link, m: Extract<NetMessage, { type: 'move' }>): boolean {
    if (this.syncing) return false;
    const ask = () => {
      this.syncing = true;
      link.send({ type: 'sync' });
      return false;
    };
    if (!this.confirmed || m.seq !== this.seq + 1) return ask();
    let next: GameState;
    try {
      next = applyAction(this.confirmed, m.by, m.action);
    } catch {
      return ask();
    }
    const hash = stateHash(next);
    if (hash !== m.hash) return ask();
    this.confirmed = next;
    this.seq = m.seq;
    const own = this.unconfirmed[0];
    if (m.by === this.me && own && JSON.stringify(own.action) === JSON.stringify(m.action)) {
      // The guest's own move, as it already shows on the table.
      this.unconfirmed.shift();
      if (this.unconfirmed.length || (this.state && stateHash(this.state) === hash)) return false;
    }
    // The host's move: the table moves on to it.
    this.unconfirmed = [];
    this.state = next;
    return true;
  }

  /** The guest saves just the room it plays in, while the match is on. */
  private keep() {
    if (this.state?.phase === 'over') forgetMatch('guest');
    else saveMatch({ role: 'guest', code: this.code, name: this.playerName, at: Date.now() });
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
    if (!this.live || !this.link) return;
    // An older host: the move goes to it and shows when its state comes back.
    if (!this.lockstep || !this.state) return this.link.send({ type: 'action', action: a });
    try {
      this.state = applyAction(this.state, this.me, a);
      this.error = '';
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      this.error = e.message;
      return this.emit();
    }
    const sent = { action: a, seq: this.seq + this.unconfirmed.length };
    this.unconfirmed.push(sent);
    this.link.send({ type: 'action', ...sent });
    this.keep();
    this.emit();
  }

  suspend() {
    // Only a match the guest has been in is worth coming back to.
    this.kept = this.joined && !this.hostLeft;
    this.dispose();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    if (!this.kept) this.link?.send({ type: 'bye' });
    this.link?.close();
    if (!this.kept) forgetMatch('guest');
    super.dispose();
  }
}
