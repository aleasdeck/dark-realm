import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actingPlayer, mayDraft } from '../src/engine/engine';
import type { Accept, Link, LinkHandlers, OpenRoom } from '../src/net/room';
import { leaveTab, savedMatch } from '../src/net/saved';
import { BotController, GuestController, HostController } from '../src/ui/controller';
import { savedBotGame } from '../src/ui/savedGame';

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', fakeStorage());
  vi.stubGlobal('sessionStorage', fakeStorage());
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('window', globalThis);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('game against the bot', () => {
  it('is kept after every move and continues where it was', async () => {
    const bot = new BotController('Игрок', 'easy');
    bot.tossShown();
    // Both sides pick a patron or two.
    while (bot.state!.draftStep < 3) {
      const s = bot.state!;
      if (actingPlayer(s) === 0) bot.dispatch({ t: 'draft', patron: s.draftPool.find((p) => mayDraft(s, 0, p))! });
      else await vi.advanceTimersByTimeAsync(2000);
    }
    const s = bot.state!;
    const saved = savedBotGame();
    expect(saved?.level).toBe('easy');
    expect(saved?.state).toEqual(s);

    // The page is gone; the menu's «Продолжить игру» deals the same game again.
    bot.dispose();
    const back = new BotController('Игрок', saved!.level, saved!.state);
    expect(back.state).toEqual(s);
    back.dispose();
  });

  it('is forgotten once the game is over', () => {
    const bot = new BotController('Игрок', 'easy');
    expect(savedBotGame()).not.toBeNull();
    bot.dispatch({ t: 'concede' });
    expect(bot.state!.phase).toBe('over');
    expect(savedBotGame()).toBeNull();
    bot.dispose();
  });

  it('keeps no tutorial', () => {
    const bot = new BotController('Игрок', 'gentle');
    expect(savedBotGame()).toBeNull();
    bot.dispose();
  });
});

describe('network match left for the menu', () => {
  function fakeRoom() {
    let onConnection: (a: Accept) => void = () => {};
    const open: OpenRoom = async (_code, cb) => {
      onConnection = cb;
      return { close() {} };
    };
    const sent: unknown[] = [];
    return {
      open,
      sent,
      connect() {
        let h!: LinkHandlers;
        onConnection((handlers) => {
          h = handlers;
          return { send: (m) => void sent.push(m), close() {} };
        });
        return h;
      },
    };
  }

  it('keeps the host’s match without a goodbye, for «Переподключение»', async () => {
    const room = fakeRoom();
    const host = new HostController('Хозяин', 'ABCDE', room.open);
    await vi.advanceTimersByTimeAsync(0);
    room.connect().onMessage({ type: 'hello', name: 'Гость', client: 'g1' });
    host.suspend();
    leaveTab();
    expect(room.sent).not.toContainEqual({ type: 'bye' });
    // A reload of the tab doesn't go back in by itself, but the menu's button does.
    expect(savedMatch(true)).toBeNull();
    expect(savedMatch()).toMatchObject({ role: 'host', code: 'ABCDE' });
  });

  it('keeps the guest’s room once it has played in it', async () => {
    const sent: unknown[] = [];
    let h!: LinkHandlers;
    const join = async (_code: string, handlers: LinkHandlers): Promise<Link> => {
      h = handlers;
      return { send: (m) => void sent.push(m), close() {} };
    };
    const room = fakeRoom();
    const host = new HostController('Хозяин', 'ABCDE', room.open);
    await vi.advanceTimersByTimeAsync(0);
    room.connect().onMessage({ type: 'hello', name: 'Гость', client: 'g1' });
    const guest = new GuestController('ABCDE', 'Гость', join);
    await vi.advanceTimersByTimeAsync(0);
    h.onMessage({ type: 'state', state: host.state! });
    guest.suspend();
    expect(sent).not.toContainEqual({ type: 'bye' });
    expect(savedMatch()).toMatchObject({ role: 'guest', code: 'ABCDE' });
  });
});
