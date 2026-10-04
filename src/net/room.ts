import Peer, { type DataConnection } from 'peerjs';
import type { Action, GameState } from '../engine/types';

/*
 * Serverless rooms: the host registers a PeerJS id derived from the room code
 * on the public PeerJS broker, the guest connects to it over WebRTC. The host
 * runs the authoritative engine; the guest sends actions and receives state.
 */

export type NetMessage =
  | { type: 'hello'; name: string }
  | { type: 'state'; state: GameState }
  | { type: 'action'; action: Action }
  | { type: 'error'; message: string }
  | { type: 'bye' };

const PREFIX = 'dark-realm-tot-';
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
  close(): void;
}

export interface LinkHandlers {
  onMessage(msg: NetMessage): void;
  onClose(): void;
}

function wrap(peer: Peer, conn: DataConnection, h: LinkHandlers): Link {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    h.onClose();
  };
  conn.on('data', (d) => h.onMessage(d as NetMessage));
  conn.on('close', close);
  conn.on('error', close);
  return {
    send: (msg) => {
      if (conn.open) conn.send(msg);
    },
    close: () => {
      try {
        conn.close();
      } finally {
        peer.destroy();
      }
    },
  };
}

function peerError(err: unknown): string {
  const type = (err as { type?: string }).type;
  if (type === 'unavailable-id') return 'Комната с таким кодом уже существует.';
  if (type === 'peer-unavailable') return 'Комната не найдена. Проверьте код.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'Нет связи с сервером комнат.';
  if (type === 'browser-incompatible') return 'Браузер не поддерживает WebRTC.';
  return 'Ошибка соединения: ' + (type ?? String(err));
}

/** Opens a room and resolves once it is registered; `onGuest` fires when an opponent joins. */
export function hostRoom(
  code: string,
  onGuest: (link: (h: LinkHandlers) => Link) => void,
): Promise<{ cancel(): void }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code);
    let taken = false;
    peer.on('open', () => resolve({ cancel: () => peer.destroy() }));
    peer.on('error', (err) => reject(new Error(peerError(err))));
    peer.on('connection', (conn) => {
      if (taken) {
        conn.on('open', () => {
          conn.send({ type: 'error', message: 'Комната уже занята.' } satisfies NetMessage);
          setTimeout(() => conn.close(), 500);
        });
        return;
      }
      taken = true;
      conn.on('open', () => onGuest((h) => wrap(peer, conn, h)));
    });
  });
}

export function joinRoom(code: string, h: LinkHandlers): Promise<Link> {
  return new Promise((resolve, reject) => {
    const peer = new Peer();
    const timer = setTimeout(() => {
      peer.destroy();
      reject(new Error('Не удалось подключиться к комнате.'));
    }, 20000);
    peer.on('error', (err) => {
      clearTimeout(timer);
      peer.destroy();
      reject(new Error(peerError(err)));
    });
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        clearTimeout(timer);
        resolve(wrap(peer, conn, h));
      });
    });
  });
}
