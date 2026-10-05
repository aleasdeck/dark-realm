import { describe, expect, it } from 'vitest';
import { botAction } from '../src/engine/bot';
import { CARDS, DRAFTABLE, LOCKED, PATRONS } from '../src/engine/cards';
import { actingPlayer, applyAction, createGame, patronAvailable } from '../src/engine/engine';
import type { Card, GameState, PatronId, PlayerIdx } from '../src/engine/types';

const ALL = [...DRAFTABLE, ...LOCKED];

function draft(patrons: PatronId[], seed = 5): GameState {
  let s = createGame(seed, ['A', 'B'], { pool: ALL });
  for (const patron of patrons) s = applyAction(s, actingPlayer(s), { t: 'draft', patron });
  return s;
}

let uid = 10000;
/** Puts a fresh copy of a card in player 0's hand and returns it. */
function give(s: GameState, id: string, pi: PlayerIdx = 0): Card {
  const c = { uid: uid++, id };
  s.players[pi].hand.push(c);
  return c;
}

const play = (s: GameState, c: Card) => applyAction(s, 0, { t: 'play', uid: c.uid });
const choose = (s: GameState, picks: number[]) => applyAction(s, actingPlayer(s), { t: 'choose', picks });

describe('locked patrons', () => {
  it('stay out of the default draft and join it through the pool option', () => {
    expect(createGame(1, ['A', 'B']).draftPool).toEqual(DRAFTABLE);
    for (const pid of LOCKED) expect(PATRONS[pid].locked).toBe(true);
    expect(draft(['alma', 'hunding', 'druid', 'mora']).patrons).toEqual(['alma', 'hunding', 'druid', 'mora', 'treasury']);
  });

  it('each deck has 20 tavern cards and one starter', () => {
    for (const pid of LOCKED) {
      const own = CARDS.filter((c) => c.patron === pid);
      expect(own.reduce((n, c) => n + c.copies, 0)).toBe(20);
      expect(own.filter((c) => c.type === 'starter' || c.starter)).toHaveLength(1);
    }
  });

  it('bot vs bot games with the new patrons finish', () => {
    const pools: PatronId[][] = [LOCKED, [...LOCKED].reverse(), ['alma', 'druid', 'crows', 'pelin'], ['mora', 'alessia', 'hlaalu', 'orgnum']];
    for (let seed = 1; seed <= 24; seed++) {
      let s = createGame(seed, ['A', 'B'], { pool: pools[seed % pools.length] });
      for (let i = 0; i < 20000 && s.phase !== 'over'; i++) {
        const pi = actingPlayer(s);
        s = applyAction(s, pi, botAction(s, pi)!);
      }
      expect(s.phase).toBe('over');
    }
  });
});

describe('new mechanics', () => {
  it('a setback pays the opponent at the start of their turn', () => {
    let s = draft(['mora', 'crows', 'pelin', 'eagle']);
    s = play(s, give(s, 'mora_ink'));
    const before = s.players[1].coin;
    s = applyAction(s, 0, { t: 'end' });
    expect(s.players[1].power).toBe(1);
    expect(s.players[1].coin).toBe(before + 1); // the second player's coin
    expect(s.players[1].boon).toBeUndefined();
  });

  it('confined cards come back to the opponent when the agent is knocked out', () => {
    let s = draft(['alma', 'crows', 'pelin', 'eagle']);
    const foe = { uid: uid++, id: 'gold' };
    s.players[1].cooldown.push(foe);
    s.players[0].agents.push({ uid: uid++, id: 'alma_gaoler', dmg: 0, activated: false });
    const gaoler = s.players[0].agents.at(-1)!;
    s = applyAction(s, 0, { t: 'activate', uid: gaoler.uid });
    s = play(s, give(s, 'alma_plate')); // second Almalexia card: combo 2 confines
    expect(s.pending?.kind).toBe('confine');
    s = choose(s, [foe.uid]);
    expect(s.players[1].cooldown.some((c) => c.uid === foe.uid)).toBe(false);
    expect(s.players[0].agents.find((a) => a.uid === gaoler.uid)!.confined).toEqual([foe]);
    s = applyAction(s, 0, { t: 'end' });
    s.players[1].power = 3;
    s.players[1].hand = [];
    s = applyAction(s, 1, { t: 'attack', uid: gaoler.uid });
    expect(s.players[1].cooldown.some((c) => c.uid === foe.uid)).toBe(true);
  });

  it('discarding feeds "while in play" cards', () => {
    let s = draft(['alma', 'crows', 'pelin', 'eagle']);
    s = play(s, give(s, 'alma_alms'));
    s = play(s, give(s, 'alma_veneration')); // donate 1 now, and combo 2 donates 1 more
    expect(s.pending?.kind).toBe('donate');
    const power = s.players[0].power;
    s = choose(s, [s.players[0].hand[0].uid]);
    expect(s.players[0].power).toBe(power + 1);
  });

  it('cards going to the cooldown and played agents trigger the Druid cards', () => {
    let s = draft(['druid', 'crows', 'pelin', 'eagle']);
    s.players[0].agents.push({ uid: uid++, id: 'druid_wraith', dmg: 0, activated: true });
    s.players[0].agents.push({ uid: uid++, id: 'druid_rockseer', dmg: 0, activated: true });
    const { power, coin } = s.players[0];
    s = play(s, give(s, 'alessia_soldier')); // an agent played: Rockseer pays a coin
    s = choose(s, [0]); // the Soldier's own 2 coins
    expect(s.players[0].coin).toBe(coin + 3);
    s.players[0].coin = 10;
    const cheap = s.tavern.find((c) => !c.id.startsWith('treasury'))!;
    s = applyAction(s, 0, { t: 'buy', uid: cheap.uid }); // bought card goes to the cooldown: Wraith gives power
    expect(s.players[0].power).toBe(power + 1);
  });

  it('the Druid patron hands out a Chimera on the 4th Druid card while it favors you', () => {
    let s = draft(['druid', 'crows', 'pelin', 'eagle']);
    s.favor.druid = 0;
    for (let i = 0; i < 4; i++) {
      s = play(s, give(s, 'druid_herbs'));
      while (s.pending) s = choose(s, []);
    }
    expect(s.players[0].cooldown.filter((c) => c.id === 'druid_chimera')).toHaveLength(1);
  });

  it('Knock Out All clears both sides, and the archer earns a coin per other agent', () => {
    let s = draft(['alessia', 'crows', 'pelin', 'eagle']);
    s.players[0].agents.push({ uid: uid++, id: 'alessia_archer', dmg: 0, activated: true });
    s.players[1].agents.push({ uid: uid++, id: 'pelin_sentries', dmg: 0, activated: false });
    s.players[1].agents.push({ uid: uid++, id: 'crows_knight', dmg: 0, activated: false });
    const coin = s.players[0].coin;
    s = play(s, give(s, 'alessia_wrath'));
    s = choose(s, [0]);
    expect(s.players[0].agents).toHaveLength(0);
    expect(s.players[1].agents).toHaveLength(0);
    expect(s.players[0].coin).toBe(coin + 2);
  });

  it('the Alessia starter is an agent dealt into the opening deck', () => {
    const s = draft(['alessia', 'crows', 'pelin', 'eagle']);
    const p = s.players[0];
    expect([...p.deck, ...p.hand].filter((c) => c.id === 'alessia_rebel')).toHaveLength(1);
  });

  it('Kenjar pays a coin at the start of each turn while he favors you', () => {
    let s = draft(['hunding', 'crows', 'pelin', 'eagle']);
    s.players[0].power = 2;
    s = applyAction(s, 0, { t: 'patron', patron: 'hunding' });
    expect(s.favor.hunding).toBe(0);
    expect(patronAvailable(s, 0, 'hunding')).toBe(false);
    s = applyAction(s, 0, { t: 'end' });
    s = applyAction(s, 1, { t: 'end' });
    while (s.pending) s = choose(s, s.pending.options.slice(0, s.pending.min).map((o) => o.ref));
    expect(s.players[0].coin).toBe(1);
  });

  it('Vaelor turns deck size into power and the Mora patron shares the card it gives', () => {
    let s = draft(['orgnum', 'mora', 'pelin', 'eagle']);
    s.favor.orgnum = 0;
    s.players[0].coin = 3;
    s = applyAction(s, 0, { t: 'patron', patron: 'orgnum' });
    expect(s.players[0].power).toBe(2); // 6 gold + 4 starters = 10 cards → 1 power per 4
    expect(s.players[0].cooldown.some((c) => c.id === 'orgnum_sacking')).toBe(true);

    s.patronCalls = 1;
    s.players[0].power = 3;
    s = applyAction(s, 0, { t: 'patron', patron: 'mora' });
    expect(s.pending?.kind).toBe('bargain');
    const ref = s.pending!.options[0];
    s = choose(s, [ref.ref]);
    expect(s.players[0].cooldown.some((c) => c.uid === ref.ref)).toBe(true);
    expect(s.players[1].cooldown.some((c) => c.id === ref.cardId)).toBe(true);
  });
});
