import { cardDef, PATRONS } from '../engine/cards';
import { FINAL_CONTRACT, yieldOf } from '../engine/director';
import { attackable, draftedBy, other, patronAvailable } from '../engine/engine';
import { LESSONS, suggestBuy, TUTORIAL_OPPONENT } from '../engine/tutorial';
import type { GameState, PatronId, PlayerIdx, ScriptId } from '../engine/types';
import { icon, withIcon } from './icons';
import { esc, patronEmblem } from './render';
import { paintIcons } from './rich';

/** One hint of the vagrant who teaches: what it points at, what it says, and when it is no longer needed. */
export interface Hint {
  id: string;
  /**
   * Selector (or selector list) of the part of the table to light up; none for a hint about the
   * whole screen. While a hint is up, only its target and the coach respond to taps.
   */
  target?: string;
  text: string;
  /** Shows a button to read on; otherwise the hint waits for the action it asks for. */
  ok?: boolean;
  /** Pin the bubble to the top of the screen (above choice sheets). */
  top?: boolean;
  /** A screen of its own over the dimmed table, before the game starts: its title and body. */
  screen?: { title: string; html: string; step: string };
  /** A short line on why, under the hint (the advanced lesson). */
  why?: string;
}

type Text = string | ((s: GameState, me: PlayerIdx) => string);

interface Step extends Omit<Hint, 'text'> {
  text: Text;
  /** The game turn the step belongs to: it waits for it and is over with it. */
  turn?: number;
  /** The hint has nothing left to say (a hint with a button also goes once it is read). */
  done?: (s: GameState, me: PlayerIdx) => boolean;
  /**
   * Its moment has not come yet: the script goes on to the next step that is due, and this one
   * may still show later in its turn. An event shows the first time its moment comes.
   */
  when?: (s: GameState, me: PlayerIdx) => boolean;
}

const myTurn = (s: GameState, me: PlayerIdx) => s.phase === 'play' && s.current === me;
const idle = (s: GameState, me: PlayerIdx) => myTurn(s, me) && !s.pending && s.queue.length === 0;
const handEmpty = (s: GameState, me: PlayerIdx) => s.players[me].hand.length === 0;
/** The player's cards are all played and nothing is waiting: time for patrons and the tavern. */
const idleEmpty = (s: GameState, me: PlayerIdx) => idle(s, me) && handEmpty(s, me);
const nothingToBuy = (s: GameState, me: PlayerIdx) =>
  !s.tavern.some((c) => cardDef(c.id).cost > 0 && cardDef(c.id).cost <= s.players[me].coin);
const called = (s: GameState, me: PlayerIdx, pid: PatronId) => myTurn(s, me) && s.patronsUsed.includes(pid);
/** Whether the player bought something this turn (this card, if given), read from the journal. */
function bought(s: GameState, me: PlayerIdx, id?: string): boolean {
  const who = `${s.players[me].name} покупает `;
  for (let i = s.log.length - 1; i >= 0 && !s.log[i].startsWith(`Ход ${s.turn}:`); i--) {
    if (s.log[i].startsWith(who) && (!id || s.log[i].includes(`«${cardDef(id).name}»`))) return true;
  }
  return false;
}
/** Durability left on the opponent's first agent. */
const hpOf = (s: GameState, pi: PlayerIdx) => {
  const a = s.players[pi].agents[0];
  return a ? (cardDef(a.id).hp ?? 1) - a.dmg : 0;
};
/** The final contract is on offer and the player can pay for it. */
const contractFits = (s: GameState, me: PlayerIdx) =>
  s.tavern.some((c) => c.id === FINAL_CONTRACT) && s.players[me].coin >= cardDef(FINAL_CONTRACT).cost;
const gap = (s: GameState, me: PlayerIdx) => (s.goal ?? 40) - s.players[me].prestige - s.players[me].power;
/** Cards to take from the tavern are picked right in it (see tavernPick in render.ts). */
const tavernPicking = (s: GameState, me: PlayerIdx) =>
  s.pending?.player === me && ['acquire', 'bargain', 'replaceTavern'].includes(s.pending.kind);
const patron = (pid: PatronId) => `.patrons .patron[data-patron="${pid}"]`;
const tile = (id: string) => `.tavern .tile[data-card="${id}"]`;

/** Patron names as in «три карты Волка». */
const GENITIVE: Partial<Record<PatronId, string>> = { pelin: 'Волка', hlaalu: 'Крысы', crows: 'Ворона', eagle: 'Орла', rajhin: 'Кота' };

/** "три карты Волка": the patron of the biggest combo this turn and how many of its cards were played. */
function comboText(s: GameState): string {
  const fired = s.turnPlays.filter((t) => t.fired.length > 0);
  const pid = fired[0]?.patron ?? 'neutral';
  const n = s.turnPlays.filter((t) => t.patron === pid).length;
  const levels = [...new Set(fired.filter((t) => t.patron === pid).flatMap((t) => t.fired))].sort();
  const count = ['', 'одна карта', 'две карты', 'три карты', 'четыре карты', 'пять карт'][n] ?? `${n} карт`;
  const name = pid === 'neutral' ? '' : ` ${GENITIVE[pid as PatronId] ?? PATRONS[pid as PatronId].name}`;
  const which = levels.map((k) => `«Комбо ${k}»`).join(' и ');
  return `Комбо! ${count[0].toUpperCase() + count.slice(1)}${name} за ход, сработал${levels.length > 1 ? 'и' : 'о'} ${which}. И слепой курице зерно попадается. Держись одного владыки.`;
}

const BASIC_PATRONS_ROW = (['pelin', 'hlaalu', 'crows', 'eagle'] as PatronId[])
  .map(
    (pid, i) =>
      `<span class="intro-patron" style="--glow:${PATRONS[pid].palette.glow};--i:${i}"><img src="${patronEmblem(pid)}" alt=""><b>${esc(PATRONS[pid].name)}</b><small>${
        { pelin: 'сила ⚔', hlaalu: 'монеты ●', crows: 'монеты и сила', eagle: 'призыв за карту' }[pid as string]
      }</small></span>`,
  )
  .join('');

const BASIC: Step[] = [
  {
    id: 'intro-1',
    turn: 1,
    text: '',
    screen: {
      step: '1 из 3',
      title: 'Четыре владыки, одна таверна',
      html: `<div class="intro-patrons">${BASIC_PATRONS_ROW}</div><p>Каждый владыка приносит свою колоду. Четыре колоды смешиваются в общую таверну. Из неё мы оба покупаем карты себе, и наши колоды крепнут с каждым ходом.</p>`,
    },
    ok: true,
  },
  {
    id: 'intro-2',
    turn: 1,
    text: '',
    screen: {
      step: '2 из 3',
      title: 'Два ресурса дают третий',
      html: `<ul class="intro-res">
        <li><span class="res coin"><i>●</i></span><span><b>Монеты</b>: на них покупают карты</span></li>
        <li><span class="res pow"><i>⚔</i></span><span><b>Сила</b>: в конце хода становится престижем</span></li>
        <li><span class="res pre"><i>✦</i></span><span><b>Престиж</b>: очки победы</span></li></ul>`,
    },
    ok: true,
  },
  {
    id: 'intro-3',
    turn: 1,
    text: '',
    screen: {
      step: '3 из 3',
      title: 'Как победить',
      html: `<p class="intro-quote">«Набери 20 ✦ раньше меня. Остальное покажу по ходу, если не сбежишь.»</p><p class="intro-who">${TUTORIAL_OPPONENT}</p>`,
    },
    ok: true,
  },
  // The first turn: play, buy, the discard pile, the end of the turn.
  {
    id: 'hand',
    turn: 1,
    target: '.hand',
    text: 'Карта не кусается. Тронь её и жми «Сыграть». Или тащи на стол.',
    done: (s, me) => s.players[me].hand.length < 5,
  },
  {
    id: 'resources',
    turn: 1,
    target: '.my-bar .res-group, .hand, .controls [data-act="play-all"]',
    text: 'Монеты ● и сила ⚔ копятся тут. Не возись по одной: ▶▶ выбросит всё разом.',
    done: handEmpty,
  },
  {
    id: 'tavern',
    turn: 1,
    target: '.tavern',
    text: 'Это таверна. Подсвечено то, на что тебе хватит ●. Выбирай: Волк бьёт, Крыса копит, Ворон всего понемногу.',
    done: (s, me) => bought(s, me) || (idleEmpty(s, me) && nothingToBuy(s, me)),
  },
  {
    id: 'discard',
    turn: 1,
    target: '.my-bar [data-act="pile-cd"]',
    text: 'Покупка ушла в твой сброс. Кончится колода, сброс перемешается и станет новой. Запомни, дважды не повторю.',
    ok: true,
    when: (s, me) => bought(s, me),
  },
  {
    id: 'end',
    turn: 1,
    target: '.controls .end',
    text: 'Жми «Конец хода». Сила станет престижем, а монеты сгорят: копить их бесполезно.',
  },
  {
    id: 'their-turn',
    turn: 2,
    target: '.opp-bar',
    text: 'Мой ход. Смотри и учись: карты, покупка, престиж.',
    ok: true,
  },
  // The second turn: the last cards of the deck, a turn for shopping.
  {
    id: 'last-cards',
    turn: 3,
    target: '.my-bar [data-act="pile-deck"]',
    text: 'Это последние карты в колоде. Потом сброс перемешается, и твои покупки вернутся в руку.',
    ok: true,
  },
  {
    id: 'shop',
    turn: 3,
    target: '.tavern',
    text: 'Силы нет? Значит, ход покупок. Трать всё до последнего медяка.',
    when: idleEmpty,
    done: (s, me) => idleEmpty(s, me) && nothingToBuy(s, me),
  },
  // The third turn: the reshuffle; the combo is explained when it fires (see EVENTS).
  {
    id: 'reshuffle',
    turn: 5,
    target: '.hand',
    text: 'Колода кончилась, сброс перемешан. Гляди-ка, твои покупки вернулись.',
    ok: true,
  },
  // The fourth turn: a weak hand, the patrons, favor, the opponent's agent.
  {
    id: 'patrons',
    turn: 7,
    target: '.patrons',
    text: 'Пустая рука? Бывает с такими, как ты. Зови владык: раз в ход платишь цену и берёшь награду.',
    ok: true,
    when: idleEmpty,
  },
  {
    id: 'crow',
    turn: 7,
    target: patron('crows'),
    text: 'Ворон заберёт все твои ● и даст столько же ⚔ без одной. Зови его.',
    when: idleEmpty,
    done: (s, me) => called(s, me, 'crows') || (idleEmpty(s, me) && !patronAvailable(s, me, 'crows')),
  },
  {
    id: 'favor',
    turn: 7,
    target: patron('crows'),
    text: 'Ворон теперь твой. Перетянешь всех четверых, и победа твоя сразу. Только не мечтай слишком громко.',
    ok: true,
    when: (s, me) => called(s, me, 'crows') && s.favor.crows === me,
  },
  {
    id: 'opp-agent',
    turn: 7,
    target: '.opp-agents',
    text: (s, me) =>
      `Это мой наймит: стоит на столе и каждый ход несёт мне монеты. Собьёшь за ${hpOf(s, other(me))} ⚔ или пустишь силу в престиж. Думай сам.`,
    ok: true,
    when: (s, me) => idle(s, me) && s.players[me].power > 0 && attackable(s, me).length > 0,
    done: (s, me) => !s.players[other(me)].agents.length,
  },
  {
    id: 'race',
    turn: 8,
    target: '.opp-bar .res-group, .my-bar .res-group',
    text: (s, me) => `У меня ${s.players[other(me)].prestige} ✦, у тебя ${s.players[me].prestige}. Посмотрим, кто первым доползёт до ${s.goal}.`,
    ok: true,
  },
  // The fifth turn: the Eagle, the gap, the contract that closes it.
  {
    id: 'eagle',
    turn: 9,
    target: patron('eagle'),
    text: 'Орёл берёт 2 ⚔ и даёт карту. Авось и тебе повезёт.',
    when: idleEmpty,
    done: (s, me) => called(s, me, 'eagle') || (idleEmpty(s, me) && !patronAvailable(s, me, 'eagle')),
  },
  {
    id: 'short',
    turn: 9,
    target: '.my-bar .res-group',
    text: (s, me) =>
      `У тебя ${s.players[me].prestige} ✦ и ${s.players[me].power} ⚔. До ${s.goal} не хватает ${gap(s, me)}. Глянь в таверну, если не совсем слеп.`,
    ok: true,
    when: (s, me) => idleEmpty(s, me) && gap(s, me) > 0 && contractFits(s, me),
  },
  {
    id: 'contract',
    turn: 9,
    target: tile(FINAL_CONTRACT),
    text: (s, me) =>
      `Это контракт: срабатывает сразу при покупке и в колоду не идёт. «${cardDef(FINAL_CONTRACT).name}» даст 3 ⚔${gap(s, me) <= 3 ? ', ровно сколько недостаёт' : ''}.`,
    when: (s, me) => idleEmpty(s, me) && gap(s, me) > 0 && contractFits(s, me),
    done: (s, me) => bought(s, me, FINAL_CONTRACT),
  },
  {
    id: 'contract-destroy',
    turn: 9,
    text: 'Ещё он сожжёт ненужную карту, хоть то же Золото. Не хочешь, пропусти.',
    top: true,
    ok: true,
    when: (s, me) => s.pending?.player === me && s.pending.kind === 'destroy',
  },
  {
    id: 'not-yet',
    turn: 9,
    target: '.controls .end',
    text: 'Не дотянул? Бывает. Заканчивай ход, следующим добьёшь.',
    ok: true,
    when: (s, me) => idleEmpty(s, me) && gap(s, me) > 0 && !contractFits(s, me),
  },
  // Whenever the power on the table makes the goal: the last tap.
  {
    id: 'finish',
    target: '.controls .end',
    text: 'Ну, добивай. Жми «Конец хода».',
    when: (s, me) => idle(s, me) && gap(s, me) <= 0,
  },
];

/** Hints for situations that come up on their own, shown the first time only. */
const EVENTS: Step[] = [
  {
    id: 'combo',
    target: '.my-table .played-part',
    text: comboText,
    ok: true,
    when: (s, me) => myTurn(s, me) && s.turnPlays.some((p) => p.fired.length > 0),
    done: (s, me) => !myTurn(s, me),
  },
  {
    id: 'tavern-pick',
    target: '.tavern',
    text: (s) =>
      s.pending?.kind === 'replaceTavern'
        ? 'Карта даёт сменить карту в таверне. Тронь ненужную, отметь её и жми «Заменить». Или «Не менять».'
        : 'Карта даёт взять карту в таверне. Подходящие подсвечены: тронь карту и жми кнопку под ней.',
    ok: true,
    when: tavernPicking,
    done: (s, me) => !tavernPicking(s, me),
  },
  {
    id: 'my-agent',
    target: '.my-table .agents',
    text: 'Твой наймит стоит на столе. Каждый ход тронь его и жми «Применить», он снова сработает.',
    ok: true,
    when: (s, me) => idle(s, me) && s.players[me].agents.some((a) => !a.activated),
    done: (s, me) => !myTurn(s, me) || s.players[me].agents.every((a) => a.activated),
  },
];

/** The cards of a lesson by id, to name them in hints. */
const named = (id: string) => `«${cardDef(id).name}»`;
const pendingOf = (s: GameState, me: PlayerIdx, kind: string) => s.pending?.player === me && s.pending.kind === kind;
/** Whether the journal of this turn tells of the line. */
function thisTurn(s: GameState, text: string): boolean {
  for (let i = s.log.length - 1; i >= 0 && !s.log[i].startsWith(`Ход ${s.turn}:`); i--) if (s.log[i].includes(text)) return true;
  return false;
}
const inHand = (s: GameState, me: PlayerIdx, id: string) => s.players[me].hand.some((c) => c.id === id);
const taunting = (s: GameState, me: PlayerIdx) => s.players[other(me)].agents.some((a) => cardDef(a.id).taunt);
/** The dearest card the player played this turn, for the Rat to take; agents stay on the table. */
function dearest(s: GameState, me: PlayerIdx): string | null {
  const own = s.players[me].played.map((c) => c.id).filter((id) => cardDef(id).cost >= 1);
  return own.sort((a, b) => cardDef(b).cost - cardDef(a).cost)[0] ?? null;
}
const DEAR = ['hlaalu_exchange', 'hlaalu_market'];
const dearOnOffer = (s: GameState, me: PlayerIdx) =>
  s.tavern.find((c) => DEAR.includes(c.id) && cardDef(c.id).cost <= s.players[me].coin)?.id ?? null;

const ADVANCED: Step[] = [
  {
    id: 'adv-intro',
    turn: 0,
    text: '',
    screen: {
      step: 'Продвинутое',
      title: 'Теперь по-взрослому',
      html: `<p class="intro-quote">«Основы ты знаешь. Или делаешь вид. Теперь владык выбираешь сам, у меня свои козыри, а после твоих ${LESSONS.advanced.goal} ✦ у меня будет ещё ход, чтобы тебя обогнать.»</p><p class="intro-who">${TUTORIAL_OPPONENT}</p>`,
    },
    ok: true,
  },
  // The draft: the Rat and the Eagle for the player.
  {
    id: 'draft-rat',
    turn: 0,
    target: '.draft-tile[data-patron="hlaalu"]',
    text: 'Сначала владыки. Каждый берёт двоих, их карты лягут в таверну. Бери Крысу.',
    why: 'Карты Крысы дают много ●, а её призыв продаёт дорогую карту за ✦. Монеты сегодня, престиж завтра.',
    when: (s) => s.phase === 'draft' && s.draftStep === 0,
    done: (s, me) => draftedBy(s, 'hlaalu') === me,
  },
  {
    id: 'draft-eagle',
    turn: 0,
    target: '.draft-tile[data-patron="eagle"]',
    text: 'Я взял Волка и Кота: от них тебе и достанется. Последний твой. Бери Орла.',
    why: 'Орёл жжёт слабые карты и даёт силу ⚔. Крыса копит, Орёл бьёт: вместе они не дают простаивать ни одной руке.',
    when: (s) => s.phase === 'draft' && s.draftStep === 3,
    done: (s, me) => draftedBy(s, 'eagle') === me,
  },
  // The first turn: the Chest and the bonfire thin out the Gold.
  {
    id: 'junk',
    turn: 1,
    target: '.hand, .controls [data-act="play-all"]',
    text: 'Глянь на руку: сплошное Золото, по 1 ● за карту. Мусор. Выкладывай всё ▶▶, а потом покажу, как от него избавиться.',
    done: handEmpty,
  },
  {
    id: 'chest',
    turn: 1,
    target: patron('treasury'),
    text: 'Сундук Бездны есть в каждой партии. За 2 ● он сожжёт карту, а взамен даст Долговую расписку на 2 ●. Зови.',
    why: 'Золото даёт 1 ●, расписка 2 ●. Слабая карта уходит, сильная приходит, и колода крепнет без покупки.',
    when: idleEmpty,
    done: (s, me) => called(s, me, 'treasury') || (idleEmpty(s, me) && !patronAvailable(s, me, 'treasury')),
  },
  {
    id: 'chest-pick',
    turn: 1,
    text: 'Жги Золото.',
    top: true,
    when: (s, me) => pendingOf(s, me, 'treasury'),
    done: (s, me) => called(s, me, 'treasury') && !pendingOf(s, me, 'treasury'),
  },
  {
    id: 'bonfire',
    turn: 1,
    target: tile('eagle_bonfire'),
    text: `${named('eagle_bonfire')} это контракт: срабатывает при покупке и в колоду не идёт. Купи и сожги ещё одно Золото.`,
    when: idleEmpty,
    done: (s, me) => bought(s, me, 'eagle_bonfire') || (idleEmpty(s, me) && s.players[me].coin < cardDef('eagle_bonfire').cost),
  },
  {
    id: 'bonfire-pick',
    turn: 1,
    text: 'Опять Золото. Не жалей.',
    why: 'Меньше мусора, значит твои сильные карты приходят чаще. Тонкая колода бьёт толстую.',
    top: true,
    when: (s, me) => pendingOf(s, me, 'destroy'),
    done: (s, me) => bought(s, me, 'eagle_bonfire') && !pendingOf(s, me, 'destroy'),
  },
  {
    id: 'end-1',
    turn: 1,
    target: '.controls .end',
    text: 'Конец хода. Я тебе кое-что приготовил.',
  },
  // The vagrant's first turn: the Cat's curse.
  {
    id: 'curse',
    turn: 2,
    target: '.my-bar [data-act="pile-cd"]',
    text: 'Подарочек. Я призвал Кота, и в твой сброс лёг Морок. Он ничего не даёт, а в руке его придётся разыграть первым.',
    why: 'Мусор в чужой колоде ослабляет её так же, как сильные карты крепят твою.',
    ok: true,
    when: (s, me) => s.players[me].cooldown.some((c) => c.id === 'bewilderment'),
  },
  // The second turn: a caravan for the coins.
  {
    id: 'caravan',
    turn: 3,
    target: tile('hlaalu_exports'),
    text: `${named('hlaalu_exports')}: 3 ● каждый раз, а стоит 2. Бери.`,
    why: 'Дешёвая карта, что приносит больше своей цены, окупается с первого раза. Монеты понадобятся на дорогие карты Крысы.',
    when: idleEmpty,
    done: (s, me) => bought(s, me, 'hlaalu_exports') || (idleEmpty(s, me) && s.players[me].coin < 2),
  },
  // The third turn: the curse comes, the Chest takes it; the player's own agent.
  {
    id: 'morok',
    turn: 5,
    target: '.hand',
    text: 'Вот и Морок. Пока он в руке, другие карты ждут. Выкладывай его первым.',
    done: (s, me) => !inHand(s, me, 'bewilderment'),
  },
  {
    id: 'chest-morok',
    turn: 5,
    target: patron('treasury'),
    text: 'Теперь Сундук. Сожги им Морок.',
    why: 'Проклятие сыграно и лежит на столе. Сожжёшь сейчас, и оно больше никогда не придёт в руку.',
    when: (s, me) => idleEmpty(s, me) && s.players[me].played.some((c) => c.id === 'bewilderment'),
    done: (s, me) => called(s, me, 'treasury') || (idleEmpty(s, me) && !patronAvailable(s, me, 'treasury')),
  },
  {
    id: 'morok-pick',
    turn: 5,
    text: 'Морок. Кого ж ещё.',
    top: true,
    when: (s, me) => pendingOf(s, me, 'treasury'),
    done: (s, me) => called(s, me, 'treasury') && !pendingOf(s, me, 'treasury'),
  },
  {
    id: 'hunter',
    turn: 5,
    target: tile('eagle_hunter'),
    text: `${named('eagle_hunter')} это наймит-контракт: после покупки сразу встаёт на твой стол. Бери.`,
    why: 'Наймит работает каждый ход, пока его не собьют, и не ждёт своей очереди в колоде.',
    when: (s, me) => idleEmpty(s, me) && !s.pending,
    done: (s, me) => bought(s, me, 'eagle_hunter') || (idleEmpty(s, me) && s.players[me].coin < cardDef('eagle_hunter').cost),
  },
  // The vagrant's third turn: his shield.
  {
    id: 'shield',
    turn: 6,
    target: '.opp-agents',
    text: `Мой ${named('pelin_bearer')}. У него провокация: пока стоит, вся твоя сила бьёт сначала его.`,
    ok: true,
    when: taunting,
  },
  // The fourth turn: hit the shield.
  {
    id: 'taunt',
    turn: 7,
    target: '.opp-agents',
    text: (s, me) =>
      `Щит держит ещё ${hpOf(s, other(me))}. Сила, что останется в конце хода, всё равно уйдёт в него, а не в престиж. Тронь его и бей.`,
    why: 'Пока щит стоит, твоя ⚔ не становится ✦. Снеси его, и сила снова пойдёт в престиж.',
    when: (s, me) => idleEmpty(s, me) && s.players[me].power > 0 && taunting(s, me),
    done: (s, me) => thisTurn(s, `атакует наймита «${cardDef('pelin_bearer').name}»`) || !taunting(s, me) || s.players[me].power === 0,
  },
  // The vagrant's fourth turn: the player's agent goes, the Eagle turns to him.
  {
    id: 'agent-lost',
    turn: 8,
    target: '.my-table .agents, .my-bar',
    text: `Сбил я твоего Ловчего. Наймит-контракт не уходит в сброс: он вернётся под низ таверны, и купить его сможет любой.`,
    ok: true,
    when: (s) => thisTurn(s, `теряет наймита «${cardDef('eagle_hunter').name}»`),
  },
  {
    id: 'eagle-mine',
    turn: 8,
    target: patron('eagle'),
    text: 'И Орёл теперь мой. Соберу милость всех четырёх владык, и победа моя сразу, без всякого престижа.',
    ok: true,
    when: (s, me) => s.favor.eagle === other(me),
  },
  // The fifth turn: the favor fight and the dear cards.
  {
    id: 'favor-fight',
    turn: 9,
    target: patron('eagle'),
    text: 'Отбери Орла. Твой призыв вернёт его в нейтраль, следующий сделает твоим.',
    why: 'Пока владыка у меня, я ближе к победе милостью всех четырёх. Отнять дешевле, чем потом догонять.',
    when: (s, me) => idleEmpty(s, me) && s.favor.eagle === other(me),
    done: (s, me) => called(s, me, 'eagle') || (idleEmpty(s, me) && !patronAvailable(s, me, 'eagle')),
  },
  {
    id: 'neutral',
    turn: 9,
    target: patron('eagle'),
    text: 'Орёл снова ничей. Каждый призыв тянет владыку на шаг к тебе.',
    ok: true,
    when: (s, me) => called(s, me, 'eagle') && s.favor.eagle === null,
  },
  // The vagrant's bag of tricks.
  {
    id: 'tricks',
    target: '.opp-agents',
    text: `${named('rajhin_tricks')}. В начале своего хода сбросишь карту из руки. Привыкай.`,
    ok: true,
    when: (s, me) => s.current !== me && s.phase === 'play' && s.players[me].pendingDiscard > 0,
  },
];

/** Moments of the advanced game that come when they come, shown once. */
const ADVANCED_EVENTS: Step[] = [
  {
    id: 'dear',
    target: DEAR.map(tile).join(', '),
    text: (s, me) => {
      const id = dearOnOffer(s, me)!;
      return `${named(id)}: дорого, зато каждый раз, как придёт в руку, даст ${yieldOf([id]).coin} ●. А потом Крыса продаст её за престиж. Покупай.`;
    },
    why: 'Дорогая карта платит дважды: монетами, пока она в колоде, и престижем, когда Крыса её заберёт.',
    when: (s, me) => s.turn >= 9 && idleEmpty(s, me) && !s.pending && !!dearOnOffer(s, me),
    done: (s, me) => DEAR.some((id) => bought(s, me, id)) || !myTurn(s, me),
  },
  {
    id: 'discard',
    text: 'Сбрось самое слабое: Золото или стартовую карту.',
    why: 'Мешок бьёт по руке, а не по колоде. Отдай то, что дало бы меньше всего.',
    top: true,
    when: (s, me) => pendingOf(s, me, 'discard'),
    done: (s, me) => !pendingOf(s, me, 'discard'),
  },
  {
    id: 'rat',
    target: patron('hlaalu'),
    text: (s, me) => `Зови Крысу. Она заберёт сыгранную карту и даст её цену минус один в ✦. За ${named(dearest(s, me)!)} получишь +${cardDef(dearest(s, me)!).cost - 1} ✦.`,
    why: 'Карта уже отдала свои ● в этот ход, а теперь ещё и престиж. Колода тоньше, ты ближе к цели.',
    when: (s, me) => idleEmpty(s, me) && patronAvailable(s, me, 'hlaalu') && cardDef(dearest(s, me) ?? 'gold').cost >= 7,
    done: (s, me) => called(s, me, 'hlaalu') || !myTurn(s, me),
  },
  {
    id: 'rat-pick',
    text: (s, me) => `Отдавай ${named(dearest(s, me) ?? 'gold')}.`,
    top: true,
    when: (s, me) => pendingOf(s, me, 'hlaalu'),
    done: (s, me) => !pendingOf(s, me, 'hlaalu'),
  },
  {
    id: 'second-call',
    target: '.patrons',
    text: 'Комбо Крысы дало лишний призыв. Зови ещё одного владыку, только не того же.',
    ok: true,
    when: (s, me) => idle(s, me) && s.patronCalls >= 1 && s.patronsUsed.length >= 1,
    done: (s, me) => !myTurn(s, me),
  },
  {
    id: 'advice',
    target: '.tavern',
    text: (s, me) => `Совет даром: ${named(suggestBuy(s, me)!)}. Сила ⚔ теперь важнее всего.`,
    ok: true,
    when: (s, me) => s.turn >= 11 && idleEmpty(s, me) && !s.pending && !!suggestBuy(s, me),
    done: (s, me) => bought(s, me) || !myTurn(s, me),
  },
  {
    id: 'response',
    target: '.opp-bar .res-group, .my-bar .res-group',
    text: (s, me) => `${s.players[me].prestige} ✦? Рано радуешься. Теперь мой ответный ход: обгоню, и победа моя.`,
    why: 'Победа засчитывается в начале твоего следующего хода, если ты всё ещё впереди. Набирай с запасом.',
    ok: true,
    when: (s, me) => s.phase === 'play' && s.current !== me && s.players[me].prestige >= (s.goal ?? 40),
  },
];

const SCRIPTS: Record<ScriptId, Step[]> = { basic: BASIC, advanced: ADVANCED };
/** Each lesson's events on top of the common ones. */
const LESSON_EVENTS: Record<ScriptId, Step[]> = { basic: EVENTS, advanced: [...ADVANCED_EVENTS, ...EVENTS] };

/** What the vagrant says when the lesson is won, and what comes next. */
export interface Finale {
  title: string;
  quote: string;
  points: string[];
  /** The next lesson, offered as the first button. */
  next?: ScriptId;
}

export function finale(lesson: ScriptId, s: GameState, me: PlayerIdx): Finale | null {
  if (s.phase !== 'over' || s.winner !== me) return null;
  const score = `${s.players[me].prestige}\u00a0:\u00a0${s.players[other(me)].prestige}`;
  if (lesson === 'basic') {
    return {
      title: 'Победа!',
      quote: `Ладно, твоя взяла, ${score}. Но в настоящей партии тебя так не пожалеют:`,
      points: [
        'для победы нужно 40 ✦, и у соперника есть ещё ход, чтобы догнать;',
        'двух владык из десятка выбираешь сам;',
        'новые владыки открываются за победы;',
        'наймиты бывают и у тебя: они стоят на столе и работают каждый ход.',
      ],
      next: 'advanced',
    };
  }
  return {
    title: 'Победа!',
    quote: `Не догнал. Твоя взяла, ${score}.`,
    points: ['в настоящей партии порог 40 ✦;', 'а 80 ✦ или все владыки дают победу сразу;', 'и там тебя никто жалеть не будет.'],
  };
}

/** Leads the player through a lesson: the script in order, and the situations as they come up. */
export class Coach {
  /** Script hints read or put away for good; events already shown. */
  private over = new Set<string>();
  /** The event hint on screen. */
  private active: Step | null = null;
  off = false;

  constructor(readonly lesson: ScriptId) {}

  /** The first step of the script that is due now: its turn has come, its moment too, and it still has something to say. */
  private due(s: GameState, me: PlayerIdx): Step | null {
    for (const st of SCRIPTS[this.lesson]) {
      if (this.over.has(st.id) || (st.turn !== undefined && st.turn !== s.turn)) continue;
      // A step that is done may still be needed again: a patron called off, a card taken back.
      if (st.done?.(s, me)) continue;
      if (!st.when || st.when(s, me)) return st;
    }
    return null;
  }

  /** The hint to show for this state, or null. */
  hint(s: GameState, me: PlayerIdx): Hint | null {
    if (this.off || s.phase === 'over') return null;
    if (this.active?.done?.(s, me)) this.active = null;
    const st = this.due(s, me);
    // The script comes first while a step is due; the events fill the gaps between.
    if (!this.active && !st) {
      const ev = LESSON_EVENTS[this.lesson].find((e) => !this.over.has(e.id) && e.when!(s, me));
      if (ev) {
        this.over.add(ev.id);
        this.active = ev;
      }
    }
    const h = this.active ?? st;
    if (!h) return null;
    return { ...h, text: typeof h.text === 'function' ? h.text(s, me) : h.text };
  }

  /** The player tapped the hint's button. */
  ack(id: string) {
    if (this.active?.id === id) this.active = null;
    else this.over.add(id);
  }
}

/** The lesson's goals, as the intro and the finale name them. */
export const lessonGoal = (lesson: ScriptId) => LESSONS[lesson].goal;

/** Taps that still work while the hint is up: its target, the coach itself and choice sheets. */
const ALWAYS = ['tut-ok', 'tut-skip', 'confirm-focus', 'zoom', 'pick', 'peek', 'peek-pick', 'peek-close', 'confirm', 'cancel', 'close', 'leave', 'exit', 'rematch', 'next-lesson'];

export function hintAllows(h: Hint | null, el: HTMLElement): boolean {
  if (!h) return true;
  if (ALWAYS.includes(el.dataset.act ?? '')) return true;
  return !!h.target && !!el.closest(h.target);
}

/**
 * Lights up the hint's target and puts the bubble next to it, on the side with more room.
 * Called after every render, since the board is redrawn from scratch.
 */
export function showHint(root: HTMLElement, h: Hint) {
  if (h.screen) return showScreen(root, h);
  const els = h.target ? [...root.querySelectorAll<HTMLElement>(h.target)] : [];
  const r = outline(els);
  const vw = innerWidth;
  const vh = innerHeight;
  if (r) {
    const spot = document.createElement('div');
    spot.className = 'coach-spot';
    const pad = 4;
    const top = Math.max(0, r.top - pad);
    const left = Math.max(0, r.left - pad);
    spot.style.cssText = `top:${top}px;left:${left}px;width:${Math.min(vw, r.right + pad) - left}px;height:${Math.min(vh, r.bottom + pad) - top}px`;
    root.appendChild(spot);
  }
  const bubble = document.createElement('div');
  bubble.className = 'coach';
  bubble.dataset.hint = h.id;
  // the play-all button is named by its icon, as it is drawn under the table
  bubble.innerHTML = `<p class="coach-who">${TUTORIAL_OPPONENT}</p><p>${paintIcons(esc(h.text)).replace('▶▶', icon('play_all', '▶▶'))}</p>${
    h.why ? `<p class="coach-why"><b>Почему так.</b> ${paintIcons(esc(h.why))}</p>` : ''
  }<div class="coach-actions">
    <button class="ghost" data-act="tut-skip">${withIcon('skip', 'Пропустить обучение')}</button>
    ${h.ok ? `<button data-act="tut-ok" data-hint="${h.id}">${withIcon('confirm', 'Понятно')}</button>` : ''}</div>`;
  root.appendChild(bubble);
  const bw = bubble.offsetWidth;
  const bh = bubble.offsetHeight;
  const gap = 10;
  let x = (vw - bw) / 2;
  let y = (vh - bh) / 2;
  if (h.top) y = 8;
  else if (r) {
    if (r.top - gap - bh >= 8) y = r.top - gap - bh;
    else if (r.bottom + gap + bh <= vh - 8) y = r.bottom + gap;
    else {
      // No room above or below (landscape): sit beside what the target holds, which may be
      // narrower than its frame (the tavern's cards in the middle of a full-width row).
      const c = contents(els) ?? r;
      const right = vw - c.right - gap;
      const left = c.left - gap;
      if (Math.max(left, right) >= Math.min(bw, 240)) {
        const w = Math.min(bw, Math.max(left, right) - 8);
        bubble.style.width = `${w}px`;
        x = right >= left ? c.right + gap : c.left - gap - w;
        y = c.top + c.height / 2 - bubble.offsetHeight / 2;
      } else y = Math.min(r.top + r.height / 2 > vh / 2 ? r.top - gap - bh : r.bottom + gap, r.top);
    }
  }
  bubble.style.left = `${Math.max(8, Math.min(vw - bubble.offsetWidth - 8, x))}px`;
  bubble.style.top = `${Math.max(8, Math.min(vh - bubble.offsetHeight - 8, y))}px`;
}

/** An intro screen over the dimmed table: one thought and a button to read on. */
function showScreen(root: HTMLElement, h: Hint) {
  const s = h.screen!;
  const box = document.createElement('div');
  box.className = 'overlay intro-wrap';
  box.dataset.hint = h.id;
  box.innerHTML = `<div class="dialog intro"><p class="intro-step">${s.step}</p><h2>${esc(s.title)}</h2>${paintIcons(s.html)}
    <div class="buttons"><button class="ghost" data-act="tut-skip">${withIcon('skip', 'Пропустить обучение')}</button>
    <button data-act="tut-ok" data-hint="${h.id}">${withIcon('confirm', 'Дальше')}</button></div></div>`;
  root.appendChild(box);
}

/** Box around what the elements hold, two levels down (the cards of a row), or null when they hold nothing. */
function contents(els: HTMLElement[]): DOMRect | null {
  const rects = els
    .flatMap((el) => [...el.querySelectorAll<HTMLElement>(':scope > * > *')])
    .filter((e) => !e.parentElement?.closest('[data-clip]'))
    .map((e) => e.getBoundingClientRect())
    .filter((b) => b.width && b.height);
  if (!rects.length) return null;
  const left = Math.max(0, Math.min(...rects.map((b) => b.left)));
  const top = Math.max(0, Math.min(...rects.map((b) => b.top)));
  const right = Math.min(innerWidth, Math.max(...rects.map((b) => b.right)));
  const bottom = Math.min(innerHeight, Math.max(...rects.map((b) => b.bottom)));
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Box around the elements and their cards, which may stick out of them (the fanned hand). */
function outline(els: HTMLElement[]): DOMRect | null {
  if (!els.length) return null;
  const rects = els
    .flatMap((el) => [el, ...el.querySelectorAll<HTMLElement>(':scope > *, :scope > * > *')])
    // Cards scrolled out of a column are clipped by it, so only the column itself counts.
    .filter((e) => !e.parentElement?.closest('[data-clip]'))
    .map((e) => e.getBoundingClientRect())
    .filter((b) => b.width && b.height);
  if (!rects.length) return null;
  const left = Math.max(0, Math.min(...rects.map((b) => b.left)));
  const top = Math.max(0, Math.min(...rects.map((b) => b.top)));
  const right = Math.min(innerWidth, Math.max(...rects.map((b) => b.right)));
  // Cards tucked under the bottom bar stay hidden, so only grow up and sideways.
  const bottom = Math.min(innerHeight, Math.max(...els.map((e) => e.getBoundingClientRect().bottom)));
  return new DOMRect(left, top, right - left, bottom - top);
}
