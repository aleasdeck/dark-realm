import type { GameState } from '../engine/types';

/*
 * How long a game has been played: the clock starts on the first turn after the draft, runs only
 * while the game is open on a shown page, and stops when the game ends. It also notes when each
 * turn began, for the turn banner and the journal. Each side of a network game keeps its own.
 *
 * The clock of the game that can be picked up again (the bot game, the hosted match, the joined
 * match) is kept in localStorage, so a reloaded or continued game goes on counting from where it was.
 */

export type ClockSlot = 'bot' | 'host' | 'guest';

interface SavedClock {
  /** The network match the time belongs to. */
  id?: string;
  ms: number;
  /** Time on the clock when each turn began, by turn number − 1. */
  turns: (number | null)[];
}

const KEY = 'dr-clock';

function readAll(): Partial<Record<ClockSlot, SavedClock>> {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return all && typeof all === 'object' ? all : {};
  } catch {
    return {};
  }
}

export class GameClock {
  private ms = 0;
  /** When the clock was last started; null while it stands. */
  private since: number | null = null;
  private turns: (number | null)[] = [];
  private id: string | undefined;

  /** A clock with no slot isn't kept (the tutorial). */
  constructor(
    private slot: ClockSlot | null = null,
    private now: () => number = () => performance.now(),
  ) {}

  /** The clock of a new game, or the kept one of the game being picked up again. */
  static open(slot: ClockSlot, resume: boolean): GameClock {
    const c = new GameClock(slot);
    const saved = resume ? readAll()[slot] : undefined;
    if (saved && Number.isFinite(saved.ms)) {
      c.ms = Math.max(0, saved.ms);
      c.turns = Array.isArray(saved.turns) ? saved.turns : [];
      c.id = saved.id;
    }
    c.save();
    return c;
  }

  /** Milliseconds played so far. */
  elapsed(): number {
    return this.ms + (this.since === null ? 0 : this.now() - this.since);
  }

  /** Time on the clock when the given turn began, if this clock saw it begin. */
  turnStart(turn: number): number | undefined {
    return this.turns[turn - 1] ?? undefined;
  }

  /** Called with every new position: notes a turn that has just begun and runs only while a game is played on a shown page. */
  track(s: GameState | null, shown: boolean) {
    if (!s) return;
    // A network match other than the one the kept time belongs to starts from zero.
    if (s.match && s.match !== this.id) {
      if (this.id !== undefined) this.reset();
      this.id = s.match;
    }
    if (s.phase === 'play' && s.turn > 0 && this.turns[s.turn - 1] == null) this.turns[s.turn - 1] = this.elapsed();
    this.run(s.phase === 'play' && shown);
    this.save();
  }

  /** The game is left: the clock stands, and the time so far is kept. */
  stop() {
    this.run(false);
    this.save();
  }

  private run(on: boolean) {
    if (on && this.since === null) this.since = this.now();
    else if (!on && this.since !== null) {
      this.ms += this.now() - this.since;
      this.since = null;
    }
  }

  private reset() {
    this.ms = 0;
    this.turns = [];
    if (this.since !== null) this.since = this.now();
  }

  private save() {
    if (!this.slot) return;
    try {
      const all = readAll();
      all[this.slot] = { id: this.id, ms: Math.round(this.elapsed()), turns: this.turns.map((t) => (t == null ? null : Math.round(t))) };
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      /* storage unavailable: the time just won't survive a reload */
    }
  }
}

/** A small hourglass drawn in front of the game time. */
export const HOURGLASS =
  '<svg class="glass" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h12v2c0 3.2-2.2 5.6-4.4 8 2.2 2.4 4.4 4.8 4.4 8v2H6v-2c0-3.2 2.2-5.6 4.4-8C8.2 9.6 6 7.2 6 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 20c0-1.6 1.4-2.8 3-3.6 1.6.8 3 2 3 3.6z" fill="currentColor"/></svg>';

/** Game time as on a clock: 0:42, 14:37, 1:02:05. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
