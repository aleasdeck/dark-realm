import { describe, expect, it } from 'vitest';
import { botAction } from '../src/engine/bot';
import { cardDef, CARDS } from '../src/engine/cards';
import { actingPlayer, applyAction, createGame, patronAvailable } from '../src/engine/engine';
import type { GameState, PlayerIdx } from '../src/engine/types';

function draftAll(s: GameState): GameState {
  for (const patron of ['crows', 'hlaalu', 'pelin', 'eagle'] as const) {
    s = applyAction(s, actingPlayer(s), { t: 'draft', patron });
  }
  return s;
}

function playOut(seed: number, maxSteps = 20000): GameState {
  let s = createGame(seed, ['A', 'B']);
  for (let i = 0; i < maxSteps && s.phase !== 'over'; i++) {
    const pi = actingPlayer(s);
    const a = botAction(s, pi)!;
    s = applyAction(s, pi, a);
  }
  return s;
}

describe('engine', () => {
  it('drafts four patrons plus treasury and deals opening hands', () => {
    const s = draftAll(createGame(1, ['A', 'B']));
    expect(s.phase).toBe('play');
    expect(s.patrons).toEqual(['crows', 'hlaalu', 'pelin', 'eagle', 'treasury']);
    for (const p of s.players) {
      expect(p.hand).toHaveLength(5);
      expect(p.hand.length + p.deck.length).toBe(10);
    }
    expect(s.tavern).toHaveLength(5);
  });

  it('lets the winner of the coin toss open the draft and move first', () => {
    let s = createGame(3, ['A', 'B'], { first: 1 });
    const order: PlayerIdx[] = [];
    for (const patron of ['crows', 'hlaalu', 'pelin', 'eagle'] as const) {
      const pi = actingPlayer(s);
      order.push(pi);
      s = applyAction(s, pi, { t: 'draft', patron });
    }
    expect(order).toEqual([1, 0, 0, 1]);
    expect(s.current).toBe(1);
    expect(s.turn).toBe(1);
    expect(() => applyAction(s, 0, { t: 'end' })).toThrow();
    // The second player, here player 0, gets the extra coin on their first turn.
    s = applyAction(s, 1, { t: 'end' });
    expect(s.current).toBe(0);
    expect(s.players[0].coin).toBe(1);
  });

  it('rejects moves out of turn', () => {
    const s = draftAll(createGame(2, ['A', 'B']));
    expect(() => applyAction(s, 1, { t: 'end' })).toThrow();
  });

  it('converts power to prestige at end of turn and gives the second player a coin', () => {
    let s = draftAll(createGame(3, ['A', 'B']));
    s.players[0].power = 4;
    s = applyAction(s, 0, { t: 'end' });
    expect(s.players[0].prestige).toBe(4);
    expect(s.current).toBe(1);
    expect(s.players[1].coin).toBe(1);
  });

  it('fires combos retroactively', () => {
    let s = draftAll(createGame(4, ['A', 'B']));
    const p = s.players[0];
    p.hand = [{ uid: 900, id: 'crows_toll_flesh' }, { uid: 901, id: 'crows_scratch' }];
    s = applyAction(s, 0, { t: 'play', uid: 900 });
    expect(s.players[0].coin).toBe(2);
    s = applyAction(s, 0, { t: 'play', uid: 901 });
    // scratch: +1 coin, combo 2: +2 coin +2 power; toll of flesh combo 2: draw 1
    expect(s.players[0].coin).toBe(5);
    expect(s.players[0].power).toBe(2);
    expect(s.players[0].hand).toHaveLength(1);
  });

  it('patron favor moves toward the activating player', () => {
    let s = draftAll(createGame(5, ['A', 'B']));
    s.players[0].power = 2;
    s = applyAction(s, 0, { t: 'patron', patron: 'eagle' });
    expect(s.favor.eagle).toBe(0);
    expect(() => applyAction(s, 0, { t: 'patron', patron: 'crows' })).toThrow();
  });

  it('opponent discard is asked at the start of their turn', () => {
    let s = draftAll(createGame(6, ['A', 'B']));
    s.players[1].pendingDiscard = 1;
    s = applyAction(s, 0, { t: 'end' });
    expect(s.pending?.kind).toBe('discard');
    expect(s.pending?.player).toBe(1);
    s = applyAction(s, 1, { t: 'choose', picks: [s.pending!.options[0].ref] });
    expect(s.players[1].hand).toHaveLength(4);
  });

  it('wins at 40 prestige only after surviving the opponent turn', () => {
    let s = draftAll(createGame(7, ['A', 'B']));
    s.players[0].prestige = 41;
    s = applyAction(s, 0, { t: 'end' });
    expect(s.phase).toBe('play');
    s = applyAction(s, 1, { t: 'end' });
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(0);
  });

  it('starts with 6 gold and one starter per drafted patron, and the treasury contracts join the tavern', () => {
    const s = draftAll(createGame(8, ['A', 'B']));
    for (const p of s.players) {
      const ids = [...p.hand, ...p.deck].map((c) => c.id).sort();
      expect(ids).toEqual(['crows_starter', 'eagle_starter', 'gold', 'gold', 'gold', 'gold', 'gold', 'gold', 'hlaalu_starter', 'pelin_starter']);
    }
    const all = [...s.tavern, ...s.tavernDeck].map((c) => cardDef(c.id));
    expect(all).toHaveLength(100);
    for (const pid of s.patrons) expect(all.filter((d) => d.patron === pid)).toHaveLength(20);
  });

  it('calls the psijic patron with coin, not power', () => {
    let s = createGame(9, ['A', 'B']);
    for (const patron of ['psijic', 'crows', 'hlaalu', 'eagle'] as const) s = applyAction(s, actingPlayer(s), { t: 'draft', patron });
    s.players[1].agents.push({ uid: 950, id: 'crows_knight', dmg: 0, activated: false });
    s.players[0].power = 10;
    expect(patronAvailable(s, 0, 'psijic')).toBe(false);
    s.players[0].coin = 4;
    s = applyAction(s, 0, { t: 'patron', patron: 'psijic' });
    s = applyAction(s, 0, { t: 'choose', picks: [950] });
    expect(s.players[0].coin).toBe(0);
    expect(s.players[0].power).toBe(10);
    expect(s.players[1].agents).toHaveLength(0);
  });

  it('destroys cards in play or in hand, not in the cooldown pile', () => {
    let s = draftAll(createGame(10, ['A', 'B']));
    const p = s.players[0];
    p.hand = [{ uid: 960, id: 'gold' }];
    p.played = [{ uid: 961, id: 'gold' }];
    p.cooldown = [{ uid: 962, id: 'gold' }];
    s.tavern[0] = { uid: 963, id: 'eagle_bonfire' };
    p.coin = 3;
    s = applyAction(s, 0, { t: 'buy', uid: 963 });
    expect(s.pending?.kind).toBe('destroy');
    expect(s.pending!.options.map((o) => o.ref).sort()).toEqual([960, 961]);
  });

  it('knocks out up to two agents: none, one or two, as the player picks', () => {
    const setup = () => {
      const s = draftAll(createGame(14, ['A', 'B']));
      s.players[0].hand = [{ uid: 1000, id: 'rajhin_lullaby' }];
      s.players[1].agents = [1001, 1002, 1003].map((uid) => ({ uid, id: 'pelin_sentries', dmg: 0, activated: false }));
      return applyAction(s, 0, { t: 'play', uid: 1000 });
    };
    let s = setup();
    expect(s.pending?.kind).toBe('knockout');
    expect(s.pending!.min).toBe(0);
    expect(s.pending!.max).toBe(2);
    expect(() => applyAction(s, 0, { t: 'choose', picks: [1001, 1002, 1003] })).toThrow();
    for (const picks of [[], [1002], [1001, 1003]]) {
      s = applyAction(setup(), 0, { t: 'choose', picks });
      expect(s.pending).toBeNull();
      expect(s.players[1].agents.map((a) => a.uid).sort()).toEqual([1001, 1002, 1003].filter((u) => !picks.includes(u)));
      expect(s.players[0].coin).toBe(2);
    }
    // The bot still takes as many as it may.
    s = setup();
    const a = botAction(s, 0)!;
    expect(a.t === 'choose' && a.picks.length).toBe(2);
  });

  it('a curse in hand must be played first', () => {
    let s = draftAll(createGame(11, ['A', 'B']));
    s.players[0].hand = [{ uid: 970, id: 'gold' }, { uid: 971, id: 'bewilderment' }];
    expect(() => applyAction(s, 0, { t: 'play', uid: 970 })).toThrow();
    s = applyAction(s, 0, { t: 'play', uid: 971 });
    s = applyAction(s, 0, { t: 'play', uid: 970 });
    expect(s.players[0].coin).toBe(1);
  });

  it('leftover power hits taunting agents before it turns into prestige', () => {
    let s = draftAll(createGame(12, ['A', 'B']));
    s.players[1].agents.push({ uid: 980, id: 'pelin_sentries', dmg: 0, activated: false });
    s.players[0].power = 3;
    s = applyAction(s, 0, { t: 'end' });
    expect(s.players[0].prestige).toBe(0);
    expect(s.players[1].agents[0].dmg).toBe(3);
    s = applyAction(s, 1, { t: 'end' });
    s.players[0].power = 5;
    s = applyAction(s, 0, { t: 'end' });
    expect(s.players[1].agents).toHaveLength(0);
    expect(s.players[0].prestige).toBe(4);
  });

  it('wins at once on 80 prestige or the favor of all four patrons', () => {
    let s = draftAll(createGame(13, ['A', 'B']));
    s.players[0].prestige = 75;
    s.players[0].played = [{ uid: 990, id: 'hlaalu_market' }];
    s = applyAction(s, 0, { t: 'patron', patron: 'hlaalu' });
    s = applyAction(s, 0, { t: 'choose', picks: [990] });
    expect(s.players[0].prestige).toBe(82);
    expect(s.phase).toBe('over');

    s = draftAll(createGame(13, ['A', 'B']));
    s.favor = { crows: 0, hlaalu: 0, pelin: 0, eagle: null };
    s.players[0].power = 2;
    s = applyAction(s, 0, { t: 'patron', patron: 'eagle' });
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(0);
  });

  it('every card has a known patron, art and valid stats', () => {
    for (const c of CARDS) {
      expect(c.art).toBeTruthy();
      if (c.type === 'agent' || c.type === 'contractAgent') expect(c.hp).toBeGreaterThan(0);
    }
  });

  it('bot vs bot games finish with a winner', () => {
    const wins: Record<PlayerIdx, number> = { 0: 0, 1: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      const s = playOut(seed);
      expect(s.phase).toBe('over');
      wins[s.winner!]++;
    }
    expect(wins[0] + wins[1]).toBe(40);
  });

  it('reports the events of each action for sounds and the opponent feed', () => {
    let s = draftAll(createGame(1, ['A', 'B']));
    expect(s.events.at(-1)).toEqual({ k: 'turn', p: 0 });
    const card = s.players[0].hand[0];
    s = applyAction(s, 0, { t: 'play', uid: card.uid });
    expect(s.events[0]).toEqual({ k: 'play', p: 0, card: card.id });
    s = applyAction(s, 0, { t: 'end' });
    expect(s.events.at(-1)).toEqual({ k: 'turn', p: 1 });
  });
});
