// Temporary: plays network rooms against the real public PeerJS broker and MQTT brokers
// from a CI runner and reports every dropped link.
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:4173/';
const SCEN = [
  ['default', '', false],
  ['webrtc-blocked', '', true],
  ['relay-emqx', 'peer=off&relay=wss://broker.emqx.io:8084/mqtt', false],
  ['relay-hivemq', 'peer=off&relay=wss://broker.hivemq.com:8884/mqtt', false],
  ['relay-mosquitto', 'peer=off&relay=wss://test.mosquitto.org:8081/mqtt', false],
];
const browser = await chromium.launch();
for (const [name, q, block] of SCEN) {
  const t0 = Date.now();
  const log = [];
  const ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
  const mk = async (who, blockRtc) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript((n) => localStorage.setItem('dark-realm-name', n), who);
    if (blockRtc) await ctx.addInitScript(() => {
      const R = window.RTCPeerConnection;
      window.RTCPeerConnection = function (c) { return new R({ ...(c || {}), iceServers: [], iceTransportPolicy: 'relay' }); };
      window.RTCPeerConnection.prototype = R.prototype;
    });
    const p = await ctx.newPage();
    p.on('console', (m) => { if (/\[room\]|rror/.test(m.text())) log.push(`${ts()} ${who}: ${m.text()}`); });
    p.on('pageerror', (e) => log.push(`${ts()} ${who}: PAGEERROR ${e.message}`));
    return p;
  };
  try {
    const host = await mk('host', false);
    await host.goto(BASE + (q ? '?' + q : ''));
    await host.click('[data-go="net"]', { timeout: 30000 });
    if (await host.$('[data-go="nick-skip"]')) await host.click('[data-go="nick-skip"]');
    await host.click('[data-go="host"]');
    await host.waitForSelector('.room-code', { timeout: 30000 });
    const code = (await host.textContent('.room-code')).trim();
    log.push(`${ts()} room ${code} open`);
    const guest = await mk('guest', block);
    await guest.goto(`${BASE}?room=${code}${q ? '&' + q : ''}`);
    await guest.click('[data-go="enter"]', { timeout: 30000 });
    await guest.waitForSelector('.draft-tile', { timeout: 60000 });
    log.push(`${ts()} guest in draft`);
    let drops = 0, was = false;
    for (let i = 0; i < 60; i++) {
      await guest.waitForTimeout(1000);
      const t = await guest.evaluate(() => document.body.innerText);
      const down = /Связь потеряна|Нет связи|Переподключаемся/.test(t);
      if (down && !was) { drops++; log.push(`${ts()} guest shows drop`); }
      was = down;
      if (i % 10 === 5) for (const p of [host, guest]) { const d = await p.$('[data-act="draft"]'); if (d) await d.click().catch(() => {}); }
    }
    console.log(`\n=== ${name}: drops ${drops}`);
  } catch (e) {
    console.log(`\n=== ${name}: FAILED ${e.message.split('\n')[0]}`);
  }
  console.log(log.join('\n'));
  for (const c of browser.contexts()) await c.close();
}
await browser.close();
