import Peer, { type PeerOptions } from 'peerjs';
import type { Action, GameState, PatronId, PlayerIdx } from '../engine/types';
import { relayHost, relayJoin } from './relay';

/*
 * Serverless rooms: the host registers a PeerJS id derived from the room code
 * on the public PeerJS broker, the guest connects to it over WebRTC. The host
 * runs the authoritative engine; the guest sends actions and receives state.
 * When WebRTC can't get through, the same messages go through public MQTT
 * brokers instead (src/net/relay.ts): the host listens there too, and the guest
 * takes the relay when the direct link fails or is slow to open.
 *
 * Both sides ping each other, so a link that silently died (a reloaded or
 * crashed page, a phone that dropped off the network) is noticed within
 * seconds. Moves travel on their own, not as whole states (see src/net/sync.ts). The host keeps its room open for the whole match, and the guest
 * comes back to it by connecting again and saying hello with the same client id.
 */

export type NetMessage =
  /**
   * `patrons`: the locked patrons the guest has opened, added to the draft by the host.
   * `v`: the move protocol the guest speaks (LOCKSTEP); without it the host sends a whole state after every move.
   */
  | { type: 'hello'; name: string; client?: string; patrons?: PatronId[]; v?: number }
  /** The whole game; `seq` counts the moves made in it so far. */
  | { type: 'state'; state: GameState; seq?: number }
  /** A guest's move; `seq` is the move count of the state the guest made it in. */
  | { type: 'action'; action: Action; seq?: number }
  /** A move the host has applied, either player's: the move count after it and the state's fingerprint. */
  | { type: 'move'; by: PlayerIdx; action: Action; seq: number; hash: number }
  /** The guest's copy of the game went astray: the host sends the whole state. */
  | { type: 'sync' }
  | { type: 'error'; message: string }
  /** The host turns this connection away; the guest gives up and goes back to the menu. */
  | { type: 'reject'; message: string }
  | { type: 'ping' }
  | { type: 'bye' };

const PREFIX = 'dark-realm-tot-';
/** How often each side pings, and how long a silent link lives before it counts as lost. */
const PING_MS = 2500;
const SILENT_MS = 10000;

/** How long the guest waits for the direct link before it takes the relay, and for either at all. */
const DIRECT_MS = 5000;
const JOIN_MS = 20000;

/**
 * Where WebRTC looks for a way through NATs: several STUN servers, so one being down or
 * blocked doesn't matter, and PeerJS's own TURN relay (its default).
 */
const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

/**
 * `?peer=host:port` points at a self-hosted PeerJS server instead of the public broker;
 * `?peer=off` leaves WebRTC out, so only the relay is used (for tests).
 */
function peerOptions(): PeerOptions | null {
  const custom = new URLSearchParams(location.search).get('peer');
  const config = { iceServers: ICE };
  if (!custom) return { config };
  if (custom === 'off') return null;
  const [host, port] = custom.split(':');
  const local = host === 'localhost' || host === '127.0.0.1';
  return { host, port: Number(port) || (local ? 9000 : 443), secure: !local, path: '/', config };
}
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRoomCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return code;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface Link {
  send(msg: NetMessage): void;
  /** Closes the link on purpose: its `onClose` does not fire. */
  close(): void;
}

export interface LinkHandlers {
  onMessage(msg: NetMessage): void;
  /** The link was lost: the other side closed it, or it went silent. */
  onClose(): void;
}

/** Opens a link over an incoming or outgoing connection; `onClose` lets the caller tidy up after it. */
export type Accept = (h: LinkHandlers) => Link;

/** A connection under a link: a PeerJS DataConnection or a relay channel. */
interface Pipe {
  readonly open: boolean;
  send(msg: unknown): void;
  close(): void;
  on(event: 'data', cb: (d: unknown) => void): void;
  on(event: 'close' | 'error', cb: () => void): void;
}

function wrap(conn: Pipe, h: LinkHandlers, onClose: () => void = () => {}): Link {
  let closed = false;
  let heard = Date.now();
  const send = (msg: NetMessage) => {
    if (!closed && conn.open) conn.send(msg);
  };
  const stop = () => {
    closed = true;
    clearInterval(beat);
    try {
      conn.close();
    } catch {
      /* already gone */
    }
    onClose();
  };
  const lost = () => {
    if (closed) return;
    stop();
    h.onClose();
  };
  const beat = setInterval(() => {
    if (Date.now() - heard > SILENT_MS) lost();
    else send({ type: 'ping' });
  }, PING_MS);
  conn.on('data', (d) => {
    if (closed) return;
    heard = Date.now();
    const msg = d as NetMessage;
    if (msg.type !== 'ping') h.onMessage(msg);
  });
  conn.on('close', lost);
  conn.on('error', lost);
  return {
    send,
    close: () => {
      if (!closed) stop();
    },
  };
}

export function peerError(err: unknown): string {
  const type = (err as { type?: string }).type;
  if (type === 'unavailable-id') return 'Комната с таким кодом уже существует.';
  if (type === 'peer-unavailable') return 'Комната не найдена. Проверьте код.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'Нет связи с сервером комнат.';
  if (type === 'browser-incompatible') return 'Браузер не поддерживает WebRTC.';
  return 'Ошибка соединения: ' + (type ?? String(err));
}

/** An error opening a room or joining one, with PeerJS's error type kept for retries. */
export class RoomError extends Error {
  constructor(readonly type: string, message: string) {
    super(message);
  }
}

function roomError(err: unknown): RoomError {
  return new RoomError((err as { type?: string }).type ?? '', peerError(err));
}

export interface HostedRoom {
  /** Takes the room down: the code is free again and every connection closes. */
  close(): void;
}

export type OpenRoom = (code: string, onConnection: (accept: Accept) => void) => Promise<HostedRoom>;

/** Calls `fn` whenever the page comes back to the front, until the returned function is called. */
function onFront(fn: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const h = () => {
    if (document.visibilityState === 'visible') fn();
  };
  document.addEventListener('visibilitychange', h);
  window.addEventListener('online', h);
  return () => {
    document.removeEventListener('visibilitychange', h);
    window.removeEventListener('online', h);
  };
}

/**
 * Opens a room and resolves once guests can find it, on the PeerJS broker or on a relay
 * broker. Every connection that opens goes to `onConnection`; the host decides from the
 * guest's hello whether to keep it. A broker that drops the room gets it registered again,
 * at once when the page comes back to the front (a phone switching to a messenger to send
 * the code puts the page to sleep).
 */
export const hostRoom: OpenRoom = (code, onConnection) =>
  new Promise((resolve, reject) => {
    const options = peerOptions();
    const started = Date.now();
    let opened = false;
    let closed = false;
    let peer: Peer | null = null;
    let peerFailed: RoomError | null = options ? null : new RoomError('off', 'WebRTC отключён.');
    let retry: ReturnType<typeof setTimeout> | undefined;
    const room: HostedRoom = {
      close: () => {
        closed = true;
        clearTimeout(retry);
        clearTimeout(giveUp);
        stopFront();
        peer?.destroy();
        relay.close();
      },
    };
    const ready = () => {
      if (opened || closed) return;
      opened = true;
      clearTimeout(giveUp);
      resolve(room);
    };
    const fail = (err: RoomError) => {
      if (opened || closed) return;
      room.close();
      reject(err);
    };
    // Without the PeerJS broker the room still opens if a relay broker answers in time.
    const check = () => {
      if (peerFailed && !relay.listening && Date.now() - started >= 10000) fail(peerFailed);
    };
    const giveUp = setTimeout(check, 10000);

    const startPeer = () => {
      if (!options || closed) return;
      const p = new Peer(PREFIX + code, options);
      peer = p;
      p.on('open', ready);
      p.on('error', (err) => {
        if (p !== peer || closed || opened) return;
        const e = roomError(err);
        // The code is someone else's room: guests coming straight would end up there.
        if (e.type === 'unavailable-id') return fail(e);
        peerFailed = e;
        check();
      });
      // Connections already open live on without the broker, but a guest coming back needs it.
      // A peer that lost the broker connects again; one that never got on is made anew.
      const later = () => {
        clearTimeout(retry);
        retry = setTimeout(() => {
          if (closed || p !== peer) return;
          if (p.destroyed) startPeer();
          else if (p.disconnected) p.reconnect();
        }, 3000);
      };
      p.on('disconnected', later);
      p.on('close', later);
      p.on('connection', (conn) => {
        conn.on('open', () => onConnection((h) => wrap(conn, h)));
      });
    };

    const relay = relayHost(code, (ch) => onConnection((h) => wrap(ch, h)), ready);
    const stopFront = onFront(() => {
      relay.wake();
      if (!peer || peer.destroyed) {
        clearTimeout(retry);
        startPeer();
      } else if (peer.disconnected) {
        clearTimeout(retry);
        peer.reconnect();
      }
    });
    startPeer();
  });

export type JoinRoom = (code: string, h: LinkHandlers) => Promise<Link>;

interface Attempt {
  ready: Promise<Pipe>;
  cancel(): void;
}

/** A direct WebRTC connection to the host through the PeerJS broker. */
function joinDirect(code: string): Attempt {
  const options = peerOptions();
  if (!options) return { ready: Promise.reject(new RoomError('off', 'WebRTC отключён.')), cancel() {} };
  const peer = new Peer(options);
  let done = false;
  let fail!: (e: RoomError) => void;
  const ready = new Promise<Pipe>((resolve, reject) => {
    fail = (e) => {
      if (done) return;
      done = true;
      peer.destroy();
      reject(e);
    };
    peer.on('error', (err) => fail(roomError(err)));
    peer.on('open', () => {
      // PeerJS's binary serialization splits big messages into chunks; its JSON one drops
      // anything over 16 KB, which a game state passes after a few turns. The host's end of
      // the connection takes the serialization the guest picks here.
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'binary' });
      // ICE found no way through: there is no point waiting any longer.
      conn.on('error', () => fail(new RoomError('negotiation', 'Не удалось подключиться к комнате.')));
      conn.on('open', () => {
        if (done) return;
        done = true;
        const pipe: Pipe = conn;
        // The peer goes when its connection does.
        conn.on('close', () => peer.destroy());
        resolve(pipe);
      });
    });
  });
  return { ready, cancel: () => fail(new RoomError('cancelled', '')) };
}

/**
 * Joins a room. The direct WebRTC link and the relay are tried at once: the direct one is
 * taken if it opens within a few seconds, the relay otherwise. A room neither finds fails
 * with the direct attempt's reason, which tells "no such room" from "no network".
 */
export const joinRoom: JoinRoom = (code, h) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const direct = joinDirect(code);
    const relay = relayJoin(code);
    let directErr: RoomError | null = null;
    let relayFailed = false;
    let parked: Pipe | null = null;
    let done = false;
    const take = (pipe: Pipe, via: string) => {
      if (done) return pipe.close();
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      if (via === 'direct') relay.cancel();
      else direct.cancel();
      if (parked && parked !== pipe) parked.close();
      console.info(`[room] ${code}: ${via === 'direct' ? 'прямое соединение' : 'через ретранслятор'}`);
      resolve(wrap(pipe, h));
    };
    const fail = (err: RoomError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      direct.cancel();
      relay.cancel();
      parked?.close();
      reject(err);
    };
    const settle = () => {
      if (done) return;
      if (parked && (directErr || Date.now() - started >= DIRECT_MS)) return take(parked, 'relay');
      if (directErr && relayFailed) fail(directErr.type === 'off' ? new RoomError('network', 'Нет связи с сервером комнат.') : directErr);
    };
    const timer = setTimeout(() => fail(directErr?.type === 'peer-unavailable' ? directErr : new RoomError('timeout', 'Не удалось подключиться к комнате.')), JOIN_MS);
    const grace = setTimeout(settle, DIRECT_MS);
    direct.ready.then(
      (pipe) => take(pipe, 'direct'),
      (err: RoomError) => {
        directErr = err;
        settle();
      },
    );
    relay.ready.then(
      (ch) => {
        if (done) return ch.close();
        parked = ch;
        settle();
      },
      () => {
        relayFailed = true;
        settle();
      },
    );
  });
