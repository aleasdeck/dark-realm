import { botAction, type BotLevel } from '../engine/bot';
import { actingPlayer, applyAction, createGame, RuleError } from '../engine/engine';
import { randomSeed } from '../engine/rng';
import { createTutorialGame } from '../engine/tutorial';
import type { Action, GameState, PatronId, PlayerIdx } from '../engine/types';
import type { Link, LinkHandlers, NetMessage } from '../net/room';
import { draftPool, recordGame } from './unlocks';

/** One running match as seen by the local player. */
export abstract class Controller {
  abstract readonly me: PlayerIdx;
  abstract readonly kind: 'bot' | 'host' | 'guest';
  state: GameState | null = null;
  notice = '';
  error = '';
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
  dispose() {
    this.listeners = [];
  }
}

/** Pause before the bot's next move, long enough to follow what it does. */
function botDelay(s: GameState): number {
  if (s.phase === 'draft') return 900;
  if (s.events?.some((e) => e.k === 'turn')) return 1400; // let the turn banner play first
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

/** The bot's worker, started on first use; null where workers are unavailable. */
function botWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; action: Action | null }>) => {
      thinking.get(e.data.id)?.resolve(e.data.action);
      thinking.delete(e.data.id);
    };
    // If the worker fails, the moves it owed are worked out here and later ones too.
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      for (const t of thinking.values()) t.resolve(botAction(t.state, 1, t.level));
      thinking.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
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
      : createGame(randomSeed(), [this.playerName, BOT_NAMES[this.level]], { pool: draftPool() });
    this.emit();
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
    if (!s || s.phase === 'over' || actingPlayer(s) !== 1) return;
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
    this.ticket++;
    super.dispose();
  }
}

export class HostController extends Controller {
  readonly me: PlayerIdx = 0;
  readonly kind = 'host';
  private link: Link;

  constructor(private playerName: string, connect: (h: LinkHandlers) => Link) {
    super();
    this.link = connect({ onMessage: (m) => this.onMessage(m), onClose: () => this.onClose() });
    this.notice = 'Соперник подключается…';
  }

  private onMessage(m: NetMessage) {
    if (m.type === 'hello') {
      this.state = createGame(randomSeed(), [this.playerName, m.name.slice(0, 24) || 'Гость'], { pool: draftPool() });
      this.notice = '';
      this.broadcast();
    } else if (m.type === 'action' && this.state) {
      try {
        this.state = applyAction(this.state, 1, m.action);
        this.broadcast();
      } catch (e) {
        this.link.send({ type: 'error', message: e instanceof Error ? e.message : 'Ошибка' });
      }
    } else if (m.type === 'bye') {
      this.onClose();
    }
  }

  private onClose() {
    this.notice = 'Соперник отключился.';
    this.emit();
  }

  private broadcast() {
    if (this.state) this.link.send({ type: 'state', state: this.state });
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
    this.link.send({ type: 'bye' });
    this.link.close();
    super.dispose();
  }
}

export class GuestController extends Controller {
  readonly me: PlayerIdx = 1;
  readonly kind = 'guest';
  private link: Link | null = null;

  attach(link: Link, name: string) {
    this.link = link;
    this.notice = 'Ждём начала игры…';
    link.send({ type: 'hello', name });
    this.emit();
  }

  handlers(): LinkHandlers {
    return {
      onMessage: (m) => {
        if (m.type === 'state') {
          this.state = m.state;
          this.notice = '';
          this.error = '';
        } else if (m.type === 'error') {
          this.error = m.message;
        } else if (m.type === 'bye') {
          this.notice = 'Хозяин комнаты отключился.';
        }
        this.emit();
      },
      onClose: () => {
        this.notice = 'Соединение потеряно.';
        this.emit();
      },
    };
  }

  dispatch(a: Action) {
    this.link?.send({ type: 'action', action: a });
  }

  dispose() {
    this.link?.send({ type: 'bye' });
    this.link?.close();
    super.dispose();
  }
}
