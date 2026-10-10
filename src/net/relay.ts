import { mqttConnect, type Mqtt } from './mqtt';

/*
 * The relay: when a direct WebRTC link between the players can't be made (a strict NAT on a
 * mobile network, a firewall, STUN/TURN traffic cut on the way), the game's messages go
 * through public MQTT brokers instead. These need no account and run over an ordinary TLS
 * WebSocket. The host listens on every broker at once; a guest knocks on all of them and
 * stays on the first that answers.
 *
 * A broker passes messages at most once, so a channel numbers what it sends, the other side
 * acknowledges it, and whatever goes unacknowledged is sent again. Big messages go in parts.
 */

/** Public brokers that take anyone over WebSockets; `?relay=url,url` replaces them (for tests). */
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const TOPIC = 'dark-realm-tot/1/';

/** Characters of a message per packet. */
export const PART = 8000;
/** A packet unacknowledged for this long is sent again. */
const RESEND_MS = 1500;
/** The guest knocks again this often until a broker answers. */
const KNOCK_MS = 1500;

export function brokers(): string[] {
  const custom = new URLSearchParams(location.search).get('relay');
  return custom ? custom.split(',').filter(Boolean) : BROKERS;
}

/**
 * Packets on the wire. `c` is the guest's connection; `knock` asks the host for a channel and
 * `hi` answers it; `d` carries part `p` of a message, numbered `n`, with `e` on the last part;
 * `a` acknowledges every packet up to `n`; `x` closes the channel.
 */
export type Packet =
  | { t: 'knock'; c: string }
  | { t: 'hi'; c: string }
  | { t: 'd'; c: string; n: number; p: string; e?: 1 }
  | { t: 'a'; c: string; n: number }
  | { t: 'x'; c: string };

type Listener = (d?: unknown) => void;

/**
 * One end of a channel. It looks like a PeerJS DataConnection to the code above it: `send`,
 * `close`, `open` and the `data`, `close` and `error` events.
 */
export class Channel {
  open = true;
  private next = 0;
  private expected = 0;
  private unacked = new Map<number, { pkt: Packet; at: number }>();
  private early = new Map<number, Extract<Packet, { t: 'd' }>>();
  private parts: string[] = [];
  private resend: ReturnType<typeof setInterval>;
  private listeners: Record<string, Listener[]> = {};

  constructor(
    readonly id: string,
    private out: (p: Packet) => void,
    private onEnd: () => void = () => {},
    /** The broker the channel runs through, for the console. */
    readonly via = '',
  ) {
    this.resend = setInterval(() => this.flush(), RESEND_MS / 2);
  }

  /** Sends again what has gone unacknowledged for too long. */
  private flush() {
    const now = Date.now();
    for (const u of this.unacked.values()) {
      if (now - u.at < RESEND_MS) continue;
      u.at = now;
      this.out(u.pkt);
    }
  }

  on(event: 'data' | 'close' | 'error', cb: Listener) {
    (this.listeners[event] ??= []).push(cb);
  }

  private emit(event: string, d?: unknown) {
    for (const cb of this.listeners[event] ?? []) cb(d);
  }

  send(msg: unknown) {
    if (!this.open) return;
    const s = JSON.stringify(msg);
    for (let i = 0; i < s.length || i === 0; i += PART) {
      const last = i + PART >= s.length;
      const pkt: Packet = { t: 'd', c: this.id, n: this.next++, p: s.slice(i, i + PART), ...(last ? { e: 1 as const } : {}) };
      this.unacked.set(pkt.n, { pkt, at: Date.now() });
      this.out(pkt);
    }
  }

  /** A packet for this channel from the other side. */
  receive(p: Packet) {
    if (!this.open) return;
    if (p.t === 'x') return this.end(false);
    if (p.t === 'a') {
      for (const n of this.unacked.keys()) if (n <= p.n) this.unacked.delete(n);
      return;
    }
    if (p.t !== 'd') return;
    // A page in the background runs its timers once a minute, so packets that arrive drive the
    // resending too.
    this.flush();
    if (p.n >= this.expected) this.early.set(p.n, p);
    for (let d = this.early.get(this.expected); d; d = this.early.get(this.expected)) {
      this.early.delete(this.expected++);
      this.parts.push(d.p);
      if (!d.e) continue;
      const s = this.parts.join('');
      this.parts = [];
      let msg: unknown;
      try {
        msg = JSON.parse(s);
      } catch {
        continue;
      }
      this.emit('data', msg);
      if (!this.open) return;
    }
    // Acknowledged at once, for a repeat too (its ack was lost): a timer could wait a minute in a hidden tab.
    if (this.open) this.out({ t: 'a', c: this.id, n: this.expected - 1 });
  }

  close() {
    this.end(true);
  }

  /** The broker connection under the channel is gone. */
  drop() {
    this.end(false);
  }

  private end(tell: boolean) {
    if (!this.open) return;
    if (tell) this.out({ t: 'x', c: this.id });
    this.open = false;
    clearInterval(this.resend);
    this.onEnd();
    this.emit('close');
  }
}

function parse(payload: string): Packet | null {
  try {
    const p = JSON.parse(payload) as Packet;
    return p && typeof p.c === 'string' && typeof p.t === 'string' ? p : null;
  } catch {
    return null;
  }
}

const hostTopic = (code: string) => `${TOPIC}${code}/h`;
const guestTopic = (code: string, c: string) => `${TOPIC}${code}/g/${c}`;

export interface RelayHost {
  /** Whether at least one broker is listening for guests. */
  readonly listening: boolean;
  /** Connects again at once to brokers that were lost, e.g. when the page comes back to the front. */
  wake(): void;
  close(): void;
}

/**
 * The host's end: listens for guests on every broker and keeps the brokers connected for as
 * long as the room is open. `onListening` fires each time a broker starts listening.
 */
export function relayHost(code: string, onChannel: (ch: Channel) => void, onListening: () => void, urls = brokers()): RelayHost {
  let closed = false;
  const channels = new Map<string, Channel>();
  /** Channels closed here, so late packets for them don't open them again. */
  const ended = new Set<string>();

  const station = (url: string) => {
    let mq: Mqtt | null = null;
    let listening = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mine = new Set<Channel>();
    const connect = () => {
      clearTimeout(timer);
      if (closed) return;
      const conn = mqttConnect(url, {
        onOpen: () => {
          tries = 0;
          conn.subscribe(hostTopic(code));
          listening = true;
          onListening();
        },
        onMessage: (_topic, payload) => {
          const p = parse(payload);
          if (!p) return;
          const reply = (r: Packet) => conn.publish(guestTopic(code, p.c), JSON.stringify(r));
          if (p.t === 'knock') return reply({ t: 'hi', c: p.c });
          let ch = channels.get(p.c);
          if (!ch) {
            // A channel starts with its first message; anything else is left from one that ended.
            if (p.t !== 'd' || p.n !== 0 || ended.has(p.c)) {
              if (p.t !== 'x') reply({ t: 'x', c: p.c });
              return;
            }
            const id = p.c;
            ch = new Channel(
              id,
              reply,
              () => {
                channels.delete(id);
                ended.add(id);
                mine.delete(ch!);
              },
              new URL(url).hostname,
            );
            channels.set(id, ch);
            mine.add(ch);
            onChannel(ch);
          }
          ch.receive(p);
        },
        onClose: () => {
          if (mq !== conn) return;
          mq = null;
          listening = false;
          for (const ch of [...mine]) ch.drop();
          if (!closed) timer = setTimeout(connect, [1000, 2000, 5000, 10000][Math.min(tries++, 3)]);
        },
      });
      mq = conn;
    };
    connect();
    return {
      get listening() {
        return listening;
      },
      wake() {
        if (!mq && !closed) connect();
      },
      close() {
        clearTimeout(timer);
        for (const ch of [...mine]) ch.close();
        const conn = mq;
        mq = null;
        conn?.close();
      },
    };
  };

  const stations = urls.map(station);
  return {
    get listening() {
      return stations.some((s) => s.listening);
    },
    wake() {
      for (const s of stations) s.wake();
    },
    close() {
      closed = true;
      for (const s of stations) s.close();
    },
  };
}

export interface RelayJoin {
  /** The channel, once a broker has answered; the attempt fails when every broker is gone. */
  ready: Promise<Channel>;
  /** Gives the attempt up (a channel already made stays). */
  cancel(): void;
}

/** The guest's end: knocks on every broker and keeps the first one the host answers on. */
export function relayJoin(code: string, urls = brokers()): RelayJoin {
  const c = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const conns: Mqtt[] = [];
  let done = false;
  let left = urls.length;
  let knock: ReturnType<typeof setInterval> | undefined;
  let resolve!: (ch: Channel) => void;
  let reject!: (e: Error) => void;
  const ready = new Promise<Channel>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const finish = () => {
    done = true;
    clearInterval(knock);
  };
  const knockAll = () => {
    for (const m of conns) if (m.open) m.publish(hostTopic(code), JSON.stringify({ t: 'knock', c }));
  };
  for (const url of urls) {
    let ch: Channel | null = null;
    const conn: Mqtt = mqttConnect(url, {
      onOpen: () => {
        if (done) return conn.close();
        conn.subscribe(guestTopic(code, c));
        conn.publish(hostTopic(code), JSON.stringify({ t: 'knock', c }));
        knock ??= setInterval(knockAll, KNOCK_MS);
      },
      onMessage: (_topic, payload) => {
        const p = parse(payload);
        if (!p || p.c !== c) return;
        if (ch) return ch.receive(p);
        if (p.t !== 'hi' || done) return;
        finish();
        for (const m of conns) if (m !== conn) m.close();
        ch = new Channel(c, (r) => conn.publish(hostTopic(code), JSON.stringify(r)), () => setTimeout(() => conn.close(), 200), new URL(url).hostname);
        resolve(ch);
      },
      onClose: () => {
        if (ch) return ch.drop();
        if (--left === 0 && !done) {
          finish();
          reject(new Error('relay'));
        }
      },
    });
    conns.push(conn);
  }
  return {
    ready,
    cancel() {
      if (done) return;
      finish();
      for (const m of conns) m.close();
      reject(new Error('cancelled'));
    },
  };
}
