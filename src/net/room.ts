import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { Action, GameState } from '../engine/types';

/*
 * Serverless rooms: the host registers a PeerJS id derived from the room code
 * on the public PeerJS broker, the guest connects to it over WebRTC. The host
 * runs the authoritative engine; the guest sends actions and receives state.
 *
 * Both sides ping each other, so a link that silently died (a reloaded or
 * crashed page, a phone that dropped off the network) is noticed within
 * seconds. The host keeps its room open for the whole match, and the guest
 * comes back to it by connecting again and saying hello with the same client id.
 */

export type NetMessage =
  | { type: 'hello'; name: string; client?: string }
  | { type: 'state'; state: GameState }
  | { type: 'action'; action: Action }
  | { type: 'error'; message: string }
  /** The host turns this connection away; the guest gives up and goes back to the menu. */
  | { type: 'reject'; message: string }
  | { type: 'ping' }
  | { type: 'bye' };

const PREFIX = 'dark-realm-tot-';
/** How often each side pings, and how long a silent link lives before it counts as lost. */
const PING_MS = 2500;
const SILENT_MS = 10000;

/** `?peer=host:port` points at a self-hosted PeerJS server instead of the public broker. */
function peerOptions(): PeerOptions {
  const custom = new URLSearchParams(location.search).get('peer');
  if (!custom) return {};
  const [host, port] = custom.split(':');
  const local = host === 'localhost' || host === '127.0.0.1';
  return { host, port: Number(port) || (local ? 9000 : 443), secure: !local, path: '/' };
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

function wrap(conn: DataConnection, h: LinkHandlers, onClose: () => void = () => {}): Link {
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

/**
 * Opens a room and resolves once it is registered. Every connection that opens goes to
 * `onConnection`; the host decides from the guest's hello whether to keep it.
 * If the broker drops the room, it is registered again under the same code.
 */
export const hostRoom: OpenRoom = (code, onConnection) =>
  new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code, peerOptions());
    let opened = false;
    let retry = 0;
    peer.on('open', () => {
      retry = 0;
      if (opened) return;
      opened = true;
      resolve({ close: () => peer.destroy() });
    });
    peer.on('error', (err) => {
      if (!opened) {
        peer.destroy();
        reject(roomError(err));
      }
    });
    // Connections already open live on without the broker, but a guest coming back needs it.
    peer.on('disconnected', () => {
      if (!opened) return;
      clearTimeout(retry);
      retry = window.setTimeout(() => {
        if (!peer.destroyed && peer.disconnected) peer.reconnect();
      }, 3000);
    });
    peer.on('connection', (conn) => {
      conn.on('open', () => onConnection((h) => wrap(conn, h)));
    });
  });

export type JoinRoom = (code: string, h: LinkHandlers) => Promise<Link>;

export const joinRoom: JoinRoom = (code, h) =>
  new Promise((resolve, reject) => {
    const peer = new Peer(peerOptions());
    let done = false;
    const fail = (err: RoomError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new RoomError('timeout', 'Не удалось подключиться к комнате.')), 15000);
    peer.on('error', (err) => fail(roomError(err)));
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(wrap(conn, h, () => peer.destroy()));
      });
    });
  });
