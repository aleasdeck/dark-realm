import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { botAction } from '../src/engine/bot';
import { actingPlayer, createGame } from '../src/engine/engine';
import type { GameState } from '../src/engine/types';
import type { Accept, JoinRoom, LinkHandlers, NetMessage, OpenRoom } from '../src/net/room';
import { stateHash } from '../src/net/sync';
import { GuestController, HostController } from '../src/ui/controller';

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

/** Messages cross the wire as copies, as they do over PeerJS. */
const copy = (m: NetMessage): NetMessage => JSON.parse(JSON.stringify(m));

/**
 * A host and a guest joined by a slow wire: nothing arrives until it is delivered,
 * so each side's messages queue up as they would on a poor connection.
 */
function slowWire() {
  const toHost: NetMessage[] = [];
  const toGuest: NetMessage[] = [];
  let onConnection: (a: Accept) => void = () => {};
  let host: LinkHandlers | null = null;
  let guest: LinkHandlers | null = null;
  const open: OpenRoom = async (_code, cb) => {
    onConnection = cb;
    return { close() {} };
  };
  const join: JoinRoom = async (_code, h) => {
    guest = h;
    toHost.length = 0;
    toGuest.length = 0;
    onConnection((hh) => {
      host = hh;
      return { send: (m) => void toGuest.push(copy(m)), close() {} };
    });
    return { send: (m) => void toHost.push(copy(m)), close() {} };
  };
  return {
    open,
    join,
    toHost,
    toGuest,
    deliverToHost() {
      for (const m of toHost.splice(0)) host!.onMessage(m);
    },
    deliverToGuest() {
      for (const m of toGuest.splice(0)) guest!.onMessage(m);
    },
    deliver() {
      while (toHost.length || toGuest.length) {
        this.deliverToHost();
        this.deliverToGuest();
      }
    },
    drop() {
      host!.onClose();
      guest!.onClose();
    },
  };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

async function start() {
  const net = slowWire();
  const host = new HostController('Хозяин', 'ABCDE', net.open);
  await settle();
  const guest = new GuestController('ABCDE', 'Гость', net.join);
  await settle();
  net.deliver();
  return { net, host, guest };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', fakeStorage());
  vi.stubGlobal('sessionStorage', fakeStorage());
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('network moves in lockstep', () => {
  it('shows the guest its own moves at once and ends in the host’s state', async () => {
    const { net, host, guest } = await start();
    expect(guest.offline).toBe(false);
    expect(stateHash(guest.state!)).toBe(stateHash(host.state!));
    let guestMoves = 0;
    let wholeStates = 0;
    for (let i = 0; i < 4000 && host.state!.phase !== 'over'; i++) {
      const shown = guest.state!;
      if (shown.phase !== 'over' && actingPlayer(shown) === 1) {
        guest.dispatch(botAction(shown, 1, 'medium')!);
        // On the guest's table before the host has heard of it.
        expect(guest.state).not.toBe(shown);
        expect(guest.error).toBe('');
        guestMoves++;
        // Several moves may go out before the host answers.
        if (i % 3) continue;
      }
      wholeStates += net.toGuest.filter((m) => m.type === 'state').length;
      net.deliver();
      const s = host.state!;
      if (s.phase !== 'over' && actingPlayer(s) === 0) host.dispatch(botAction(s, 0, 'medium')!);
      wholeStates += net.toGuest.filter((m) => m.type === 'state').length;
      expect(net.toHost.some((m) => m.type === 'sync')).toBe(false);
      net.deliver();
    }
    net.deliver();
    expect(host.state!.phase).toBe('over');
    expect(guestMoves).toBeGreaterThan(20);
    expect(wholeStates).toBe(0);
    expect(stateHash(guest.state!)).toBe(stateHash(host.state!));
    host.dispose();
    guest.dispose();
  });

  it('confirms the guest’s move without redrawing the table', async () => {
    const { net, host, guest } = await start();
    if (actingPlayer(host.state!) === 0) {
      host.dispatch(botAction(host.state!, 0)!);
      net.deliver();
    }
    let renders = 0;
    guest.subscribe(() => renders++);
    guest.dispatch(botAction(guest.state!, 1)!);
    const shown = guest.state;
    expect(renders).toBe(1);
    net.deliver();
    expect(renders).toBe(1);
    expect(guest.state).toBe(shown);
    expect(stateHash(host.state!)).toBe(stateHash(shown!));
  });

  it('turns down a move against the rules on the guest’s side, without asking the host', async () => {
    const { net, guest } = await start();
    guest.dispatch({ t: 'play', uid: -1 });
    expect(guest.error).not.toBe('');
    expect(net.toHost).toHaveLength(0);
  });

  it('takes the host’s whole state when its copy went astray', async () => {
    const { net, host, guest } = await start();
    // Something the guest's copy got wrong.
    (guest as unknown as { confirmed: GameState }).confirmed.players[1].prestige += 5;
    const actor = actingPlayer(host.state!);
    if (actor === 0) host.dispatch(botAction(host.state!, 0)!);
    else guest.dispatch(botAction(guest.state!, 1)!);
    net.deliverToHost();
    net.deliverToGuest();
    expect(net.toHost).toEqual([{ type: 'sync' }]);
    net.deliver();
    expect(stateHash(guest.state!)).toBe(stateHash(host.state!));
  });

  it('puts the guest’s table back when the host turns a move down', async () => {
    const { net, host, guest } = await start();
    if (actingPlayer(host.state!) === 0) {
      host.dispatch(botAction(host.state!, 0)!);
      net.deliver();
    }
    const before = stateHash(host.state!);
    // The host's game moved on in a way the guest didn't see: the guest's pick is no longer allowed there.
    const pick = botAction(guest.state!, 1)!;
    guest.dispatch(pick);
    host.state = { ...host.state!, draftPool: host.state!.draftPool.filter((p) => pick.t !== 'draft' || p !== pick.patron) };
    net.deliverToHost();
    net.deliverToGuest();
    expect(guest.error).not.toBe('');
    expect(stateHash(guest.state!)).toBe(stateHash(host.state!));
    expect(stateHash(host.state!)).not.toBe(before);
  });

  it('sends the moves the host never got again after the link comes back', async () => {
    const { net, host, guest } = await start();
    if (actingPlayer(host.state!) === 0) {
      host.dispatch(botAction(host.state!, 0)!);
      net.deliver();
    }
    guest.dispatch(botAction(guest.state!, 1)!);
    const shown = guest.state;
    // The move is lost with the link.
    net.toHost.length = 0;
    net.drop();
    expect(guest.offline).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    net.deliver();
    expect(guest.offline).toBe(false);
    expect(guest.state).toBe(shown);
    expect(stateHash(host.state!)).toBe(stateHash(shown!));
  });

  it('keeps the move count with the host’s saved match', async () => {
    const { net, host, guest } = await start();
    const actor = actingPlayer(host.state!);
    if (actor === 0) host.dispatch(botAction(host.state!, 0)!);
    else guest.dispatch(botAction(guest.state!, 1)!);
    net.deliver();
    // Host and guest share this test's storage: the host's own entry.
    expect(JSON.parse(localStorage.getItem('dr-net-host')!)).toMatchObject({ role: 'host', seq: 1 });
  });
});

describe('older peers', () => {
  it('sends a guest without the move protocol the whole state after every move', async () => {
    let onConnection: (a: Accept) => void = () => {};
    const host = new HostController('Хозяин', 'ABCDE', async (_code, cb) => {
      onConnection = cb;
      return { close() {} };
    });
    await settle();
    const sent: NetMessage[] = [];
    let h: LinkHandlers | null = null;
    onConnection((handlers) => {
      h = handlers;
      return { send: (m) => void sent.push(m), close() {} };
    });
    // An older guest's hello names no protocol, and its moves carry no move count.
    h!.onMessage({ type: 'hello', name: 'Гость', client: 'g1' });
    if (actingPlayer(host.state!) === 0) host.dispatch(botAction(host.state!, 0)!);
    else h!.onMessage({ type: 'action', action: botAction(host.state!, 1)! });
    expect(sent.map((m) => m.type)).toEqual(['state', 'state']);
    host.dispose();
  });

  it('waits for an older host’s state before showing its move', async () => {
    const sent: NetMessage[] = [];
    let h: LinkHandlers | null = null;
    const join: JoinRoom = async (_code, handlers) => {
      h = handlers;
      return { send: (m) => void sent.push(m), close() {} };
    };
    const guest = new GuestController('ABCDE', 'Гость', join);
    await settle();
    // An older host's state has no move count.
    h!.onMessage({ type: 'state', state: createGame(7, ['Хозяин', 'Гость'], { first: 1 }) });
    const shown = guest.state!;
    const a = botAction(shown, 1)!;
    guest.dispatch(a);
    expect(guest.state).toBe(shown);
    expect(sent.at(-1)).toEqual({ type: 'action', action: a });
    guest.dispose();
  });
});
