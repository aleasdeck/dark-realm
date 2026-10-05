import { botAction } from '../engine/bot';
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
    // A game counts once, when it ends after the draft.
    if (over && !this.wasOver) this.unlocked = this.counts && this.state!.turn > 0 ? recordGame() : [];
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
  return 950;
}

export class BotController extends Controller {
  readonly me: PlayerIdx = 0;
  readonly kind = 'bot';
  private timer = 0;

  /** `tutorial` plays the short scripted game against a gentle bot. */
  constructor(
    private playerName: string,
    readonly tutorial = false,
  ) {
    super();
    this.counts = !tutorial;
    this.restart();
  }

  restart() {
    this.state = this.tutorial
      ? createTutorialGame(this.playerName)
      : createGame(randomSeed(), [this.playerName, 'Бот-некромант'], { pool: draftPool() });
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
    const s = this.state;
    if (!s || s.phase === 'over' || actingPlayer(s) !== 1) return;
    this.timer = window.setTimeout(() => {
      const cur = this.state!;
      const a = botAction(cur, 1, this.tutorial);
      if (a) this.state = applyAction(cur, 1, a);
      this.emit();
      this.schedule();
    }, botDelay(s));
  }

  dispose() {
    clearTimeout(this.timer);
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
