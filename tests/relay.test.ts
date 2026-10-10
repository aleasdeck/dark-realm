import { afterEach, describe, expect, it, vi } from 'vitest';
import { PacketReader, connectPacket, publishPacket, readPublish, subscribePacket } from '../src/net/mqtt';
import { Channel, PART, type Packet } from '../src/net/relay';

afterEach(() => {
  vi.useRealTimers();
});

/** Two channel ends over a broker that may lose, repeat or reorder packets. */
function pair(mess: (p: Packet, deliver: () => void) => void = (_p, d) => d()) {
  const got: { a: unknown[]; b: unknown[] } = { a: [], b: [] };
  let a: Channel, b: Channel;
  a = new Channel('c1', (p) => mess(p, () => b.receive(structuredClone(p))));
  b = new Channel('c1', (p) => mess(p, () => a.receive(structuredClone(p))));
  a.on('data', (d) => got.a.push(d));
  b.on('data', (d) => got.b.push(d));
  return { a, b, got };
}

describe('relay channel', () => {
  it('passes messages both ways in order', () => {
    vi.useFakeTimers();
    const { a, b, got } = pair();
    a.send({ type: 'hello', name: 'Гость' });
    a.send({ type: 'ping' });
    b.send({ type: 'state', seq: 3 });
    expect(got.b).toEqual([{ type: 'hello', name: 'Гость' }, { type: 'ping' }]);
    expect(got.a).toEqual([{ type: 'state', seq: 3 }]);
  });

  it('splits a big message into parts and puts it back together', () => {
    vi.useFakeTimers();
    const sizes: number[] = [];
    const { a, got } = pair((p, d) => {
      if (p.t === 'd') sizes.push(p.p.length);
      d();
    });
    const big = { type: 'state', text: 'ж'.repeat(PART * 3 + 17) };
    a.send(big);
    expect(sizes.length).toBe(4);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(PART);
    expect(got.b).toEqual([big]);
  });

  it('sends lost packets again and drops repeats', async () => {
    vi.useFakeTimers();
    let n = 0;
    const { a, b, got } = pair((_p, d) => {
      n++;
      // Every third packet is lost, every fifth arrives twice.
      if (n % 3 === 0) return;
      d();
      if (n % 5 === 0) d();
    });
    const msgs = Array.from({ length: 30 }, (_, i) => ({ type: 'move', seq: i, pad: 'x'.repeat(i % 4 === 0 ? PART + 5 : 10) }));
    for (const m of msgs) a.send(m);
    b.send({ type: 'sync' });
    await vi.advanceTimersByTimeAsync(20000);
    expect(got.b).toEqual(msgs);
    expect(got.a).toEqual([{ type: 'sync' }]);
  });

  it('puts packets that arrive out of order back in order', async () => {
    vi.useFakeTimers();
    const held: (() => void)[] = [];
    const { a, got } = pair((p, d) => {
      if (p.t === 'd' && p.n % 2 === 0) held.push(d);
      else d();
    });
    for (let i = 0; i < 6; i++) a.send({ i });
    expect(got.b).toEqual([]);
    for (const d of held.reverse()) d();
    expect(got.b).toEqual([0, 1, 2, 3, 4, 5].map((i) => ({ i })));
  });

  it('tells the other side when it closes', () => {
    vi.useFakeTimers();
    const { a, b } = pair();
    let closed = 0;
    b.on('close', () => closed++);
    a.close();
    expect(a.open).toBe(false);
    expect(b.open).toBe(false);
    expect(closed).toBe(1);
  });
});

describe('mqtt packets', () => {
  it('reads packets split across and joined in WebSocket frames', () => {
    const msg = publishPacket('dark-realm-tot/1/ABCDE/h', JSON.stringify({ t: 'knock', c: 'x', pad: 'ё'.repeat(300) }));
    const two = new Uint8Array([...msg, ...msg]);
    const r = new PacketReader();
    expect(r.push(two.subarray(0, 3))).toEqual([]);
    const got = [...r.push(two.subarray(3, msg.length + 5)), ...r.push(two.subarray(msg.length + 5))];
    expect(got).toHaveLength(2);
    for (const p of got) {
      expect(p.type).toBe(3);
      expect(readPublish(p).topic).toBe('dark-realm-tot/1/ABCDE/h');
      expect(JSON.parse(readPublish(p).payload).pad).toBe('ё'.repeat(300));
    }
  });

  it('encodes connect and subscribe as MQTT 3.1.1', () => {
    const c = connectPacket('dr123');
    expect([...c.subarray(0, 2)]).toEqual([0x10, c.length - 2]);
    expect(new TextDecoder().decode(c.subarray(4, 8))).toBe('MQTT');
    expect(c[8]).toBe(4);
    const s = subscribePacket(7, 'a/b');
    expect([...s]).toEqual([0x82, 8, 0, 7, 0, 3, 97, 47, 98, 0]);
  });
});
