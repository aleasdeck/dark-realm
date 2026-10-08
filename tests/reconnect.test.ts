import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Accept, JoinRoom, Link, LinkHandlers, NetMessage, OpenRoom } from '../src/net/room';
import { savedMatch } from '../src/net/saved';
import type { PatronId } from '../src/engine/types';
import { GuestController, HostController } from '../src/ui/controller';

/** In-memory stand-ins for localStorage and sessionStorage. */
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

/** One connection as the guest's end sees it. */
interface Wire {
  sent: NetMessage[];
  closed: boolean;
  say(m: NetMessage): void;
  drop(): void;
}

function wire(): { accept: Accept; w: Wire } {
  let h: LinkHandlers;
  const w: Wire = { sent: [], closed: false, say: (m) => h.onMessage(m), drop: () => h.onClose() };
  const accept: Accept = (handlers) => {
    h = handlers;
    return { send: (m) => void w.sent.push(m), close: () => void (w.closed = true) };
  };
  return { accept, w };
}

function fakeRoom() {
  let onConnection: (a: Accept) => void = () => {};
  const open: OpenRoom = async (_code, cb) => {
    onConnection = cb;
    return { close() {} };
  };
  return {
    open,
    connect(): Wire {
      const { accept, w } = wire();
      onConnection(accept);
      return w;
    },
  };
}

const lastState = (w: Wire) => [...w.sent].reverse().find((m) => m.type === 'state');

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
  vi.stubGlobal('sessionStorage', fakeStorage());
  vi.stubGlobal('location', { search: '' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('host reconnect', () => {
  it('lets the same guest back in with the game as it was', async () => {
    const room = fakeRoom();
    const host = new HostController('Хозяин', 'ABCDE', room.open);
    await Promise.resolve();
    expect(host.ready).toBe(true);

    const first = room.connect();
    first.say({ type: 'hello', name: 'Гость', client: 'g1' });
    expect(host.state?.phase).toBe('draft');
    expect(host.online).toBe(true);

    first.drop();
    expect(host.online).toBe(false);
    expect(host.notice).toBe('Соперник переподключается…');

    const again = room.connect();
    again.say({ type: 'hello', name: 'Гость', client: 'g1' });
    expect(host.online).toBe(true);
    expect(host.notice).toBe('');
    expect(lastState(again)).toEqual({ type: 'state', state: host.state, seq: 0 });
  });

  it('turns away anyone else while the match is on', async () => {
    const room = fakeRoom();
    const host = new HostController('Хозяин', 'ABCDE', room.open);
    await Promise.resolve();
    room.connect().say({ type: 'hello', name: 'Гость', client: 'g1' });

    const stranger = room.connect();
    stranger.say({ type: 'hello', name: 'Чужак', client: 'g2' });
    expect(stranger.sent).toEqual([{ type: 'reject', message: 'Комната уже занята.' }]);
    expect(host.online).toBe(true);
    expect(host.state?.players[1].name).toBe('Гость');
  });

  it('drops the stale link when the guest comes back before it timed out', async () => {
    const room = fakeRoom();
    const host = new HostController('Хозяин', 'ABCDE', room.open);
    await Promise.resolve();
    const old = room.connect();
    old.say({ type: 'hello', name: 'Гость', client: 'g1' });
    const fresh = room.connect();
    fresh.say({ type: 'hello', name: 'Гость', client: 'g1' });
    expect(old.closed).toBe(true);
    // Moves from the old link no longer count.
    const before = host.state;
    old.say({ type: 'action', action: { t: 'draft', patron: host.state!.draftPool[0] } });
    expect(host.state).toBe(before);
  });

  it('picks the match up again after the host page reloads', async () => {
    const room = fakeRoom();
    const host = new HostController('Хозяин', 'ABCDE', room.open);
    await Promise.resolve();
    room.connect().say({ type: 'hello', name: 'Гость', client: 'g1' });
    // A move on the host's side, if the coin let it open the draft.
    if (host.state!.first === 0) host.dispatch({ t: 'draft', patron: host.state!.draftPool[0] });

    const saved = savedMatch();
    expect(saved?.role).toBe('host');
    if (saved?.role !== 'host') return;
    expect(saved.state).toEqual(host.state);

    // The page is gone without a goodbye; a new one opens the same room with the saved game.
    const room2 = fakeRoom();
    const back = new HostController(saved.name, saved.code, room2.open, saved);
    expect(back.state).toEqual(host.state);
    await Promise.resolve();
    expect(back.notice).toBe('Соперник переподключается…');
    const g = room2.connect();
    g.say({ type: 'hello', name: 'Гость', client: 'g1' });
    expect(back.online).toBe(true);
    expect(lastState(g)).toMatchObject({ type: 'state', state: host.state });
  });

  it('keeps trying when the old room code is still taken', async () => {
    vi.useFakeTimers();
    const room = fakeRoom();
    const host = new HostController('Хозяин', 'ABCDE', room.open);
    await vi.advanceTimersByTimeAsync(0);
    room.connect().say({ type: 'hello', name: 'Гость', client: 'g1' });
    let tries = 0;
    const open: OpenRoom = async () => {
      if (++tries < 3) throw new Error('Комната с таким кодом уже существует.');
      return { close() {} };
    };
    const back = new HostController('Хозяин', 'ABCDE', open, { client: 'g1', state: host.state! });
    await vi.advanceTimersByTimeAsync(10000);
    expect(tries).toBe(3);
    expect(back.ready).toBe(true);
    expect(back.gone).toBe('');
  });

  it('forgets the match when the host leaves it', async () => {
    const room = fakeRoom();
    const host = new HostController('Хозяин', 'ABCDE', room.open);
    await Promise.resolve();
    const g = room.connect();
    g.say({ type: 'hello', name: 'Гость', client: 'g1' });
    expect(savedMatch()).not.toBeNull();
    host.dispose();
    expect(savedMatch()).toBeNull();
    expect(g.sent.at(-1)).toEqual({ type: 'bye' });
  });
});

describe('guest reconnect', () => {
  /** A host that answers every hello with the state it holds. */
  function fakeHost() {
    const links: { h: LinkHandlers; sent: NetMessage[]; closed: boolean }[] = [];
    let up = true;
    const join: JoinRoom = async (_code, h) => {
      if (!up) throw new Error('Комната не найдена. Проверьте код.');
      const l = { h, sent: [] as NetMessage[], closed: false };
      links.push(l);
      const link: Link = { send: (m) => void l.sent.push(m), close: () => void (l.closed = true) };
      return link;
    };
    return {
      join,
      links,
      setUp(v: boolean) {
        up = v;
      },
    };
  }

  it('reconnects on its own and says hello again', async () => {
    vi.useFakeTimers();
    const room = fakeRoom();
    const host = new HostController('Хозяин', 'ABCDE', room.open);
    await vi.advanceTimersByTimeAsync(0);
    const net = fakeHost();
    const guest = new GuestController('ABCDE', 'Гость', net.join);
    await vi.advanceTimersByTimeAsync(0);
    const hello = net.links[0].sent[0];
    expect(hello).toMatchObject({ type: 'hello', name: 'Гость' });
    room.connect().say(hello);
    net.links[0].h.onMessage({ type: 'state', state: host.state! });
    expect(guest.offline).toBe(false);
    expect(savedMatch()?.role).toBe('guest');

    // The host's page reloads: the link dies and the room is gone for a moment.
    net.setUp(false);
    net.links[0].h.onClose();
    expect(guest.offline).toBe(true);
    expect(guest.notice).toBe('Связь потеряна. Переподключаемся…');
    guest.dispatch({ t: 'end' });
    expect(net.links[0].sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(net.links).toHaveLength(1);
    expect(guest.gone).toBe('');

    net.setUp(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(net.links).toHaveLength(2);
    expect(net.links[1].sent[0]).toEqual(hello);
    net.links[1].h.onMessage({ type: 'state', state: host.state! });
    expect(guest.offline).toBe(false);
    expect(guest.notice).toBe('');
  });

  it('gives up on a room it never got into', async () => {
    const net = fakeHost();
    net.setUp(false);
    const guest = new GuestController('ZZZZZ', 'Гость', net.join);
    await Promise.resolve();
    await Promise.resolve();
    expect(guest.gone).toBe('Комната не найдена. Проверьте код.');
  });

  it('goes back to the menu when the room turns it away', async () => {
    const net = fakeHost();
    const guest = new GuestController('ABCDE', 'Гость', net.join);
    await Promise.resolve();
    await Promise.resolve();
    net.links[0].h.onMessage({ type: 'reject', message: 'Комната уже занята.' });
    expect(guest.gone).toBe('Комната уже занята.');
  });
});

describe('online draft', () => {
  it('lets each player draft only the locked patrons they have opened', async () => {
    localStorage.setItem('dr-wins', '10');
    const room = fakeRoom();
    const host = new HostController('Хозяин', 'ABCDE', room.open);
    await Promise.resolve();
    const g = room.connect();
    g.say({ type: 'hello', name: 'Гость', client: 'g1', patrons: ['alessia', 'nonsense' as never] });
    const s = host.state!;
    expect(s.draftPool).toEqual(expect.arrayContaining(['hunding', 'orgnum', 'alessia']));
    expect(s.draftPool).not.toContain('druid');
    expect(s.draftPool).not.toContain('nonsense');
    expect(s.own).toEqual([['hunding', 'orgnum'], ['alessia']]);
    const first = s.current;
    const guestPick = (patron: PatronId) => g.say({ type: 'action', action: { t: 'draft', patron } });
    if (first === 0) {
      host.dispatch({ t: 'draft', patron: 'alessia' });
      expect(host.error).toMatch(/не открыт/);
      host.dispatch({ t: 'draft', patron: 'hunding' });
    }
    guestPick('orgnum');
    expect(g.sent.at(-1)).toMatchObject({ type: 'error' });
    guestPick('alessia');
    expect(host.state!.patrons).toContain('alessia');
    host.dispose();
  });

  it('sends the guest’s opened patrons in its hello', async () => {
    localStorage.setItem('dr-wins', '5');
    const { accept, w } = wire();
    const join: JoinRoom = async (_code, handlers) => accept(handlers);
    const guest = new GuestController('ABCDE', 'Гость', join);
    await Promise.resolve();
    await Promise.resolve();
    expect(w.sent.find((m) => m.type === 'hello')).toMatchObject({ patrons: ['hunding'] });
    guest.dispose();
  });
});
