import type { CardDef, Effect, PatronDef, PatronId } from './types';

/*
 * Card data. Costs, effects and copies follow the Tales of Tribute base decks as listed
 * on UESP (en.uesp.net/wiki/Online:Tales_of_Tribute, patron pages, upgrades left out);
 * names and flavor are reworked for the Dark Realm setting. To add a custom card, append an
 * entry to CARDS with a unique id and the patron it belongs to. `copies`
 * controls how many end up in the tavern deck. The engine also supports effects the base
 * decks don't use (prestige, heal, returnTop, donate, choice, create), see Effect in types.ts.
 */

const coin = (n: number): Effect => ({ k: 'coin', n });
const power = (n: number): Effect => ({ k: 'power', n });
const oppLose = (n: number): Effect => ({ k: 'oppLosePrestige', n });
const draw = (n: number): Effect => ({ k: 'draw', n });
const oppDiscard = (n: number): Effect => ({ k: 'oppDiscard', n });
const acquire = (n: number): Effect => ({ k: 'acquire', n });
const toss = (n: number): Effect => ({ k: 'toss', n });
const destroy = (n: number): Effect => ({ k: 'destroy', n });
const knockout = (n: number): Effect => ({ k: 'knockout', n });
const replaceTavern = (n: number): Effect => ({ k: 'replaceTavern', n });
const patronCall = (n: number): Effect => ({ k: 'patronCall', n });

export const PATRONS: Record<PatronId, PatronDef> = {
  crows: {
    id: 'crows',
    name: 'Карраг Падальщик',
    title: 'Владыка голодной стаи',
    palette: { bg1: '#0b0710', bg2: '#2a0f22', accent: '#7a2440', glow: '#d8405a' },
  },
  hlaalu: {
    id: 'hlaalu',
    name: 'Ростовщица Вейла',
    title: 'Всё имеет цену',
    palette: { bg1: '#140c05', bg2: '#3b2410', accent: '#b8862b', glow: '#ffd36b' },
  },
  pelin: {
    id: 'pelin',
    name: 'Гримвальд Костяной',
    title: 'Мёртвые не покидают строй',
    palette: { bg1: '#070b12', bg2: '#1b2638', accent: '#8a9bb5', glow: '#d9e6ff' },
  },
  psijic: {
    id: 'psijic',
    name: 'Иссерия Безглазая',
    title: 'Видит то, чего ещё нет',
    palette: { bg1: '#04100f', bg2: '#0f3330', accent: '#2f8f84', glow: '#7affe4' },
  },
  rajhin: {
    id: 'rajhin',
    name: 'Шут Морвен',
    title: 'Улыбка в темноте',
    palette: { bg1: '#0c0612', bg2: '#2a1638', accent: '#6d3f8f', glow: '#b98cff' },
  },
  eagle: {
    id: 'eagle',
    name: 'Хротгар Кровавое Перо',
    title: 'Вождь пепельных пустошей',
    palette: { bg1: '#120504', bg2: '#3a120b', accent: '#a33a20', glow: '#ff7a3d' },
  },
  treasury: {
    id: 'treasury',
    name: 'Сундук Бездны',
    title: 'Нейтральный покровитель',
    palette: { bg1: '#0a0a0a', bg2: '#262019', accent: '#7d6a4d', glow: '#e8c98a' },
  },
};

export const DRAFTABLE: PatronId[] = ['crows', 'hlaalu', 'pelin', 'psijic', 'rajhin', 'eagle'];

export const CARDS: CardDef[] = [
  // ── Neutral ─────────────────────────────────────────────
  { id: 'gold', name: 'Золото', patron: 'neutral', cost: 0, type: 'starter', copies: 0, play: [coin(1)], art: 'coin', seed: 1 },
  { id: 'writ', name: 'Долговая расписка', patron: 'neutral', cost: 0, type: 'starter', copies: 0, play: [coin(2)], art: 'scroll', seed: 7 },
  {
    id: 'bewilderment', name: 'Морок', patron: 'neutral', cost: 0, type: 'curse', copies: 0, play: [], art: 'ghost', seed: 3,
    flavor: 'Пустые глаза, пустые руки.',
  },

  // ── Сундук Бездны (Treasury): контракты, есть в каждой партии ────
  { id: 'treasury_ambush', name: 'Засада', patron: 'treasury', cost: 3, type: 'contractAction', copies: 1, play: [knockout(2)], art: 'dagger', seed: 131 },
  { id: 'treasury_barterer', name: 'Меняла', patron: 'treasury', cost: 1, type: 'contractAction', copies: 4, play: [replaceTavern(1)], art: 'merchant', seed: 132 },
  { id: 'treasury_sacrament', name: 'Чёрное таинство', patron: 'treasury', cost: 2, type: 'contractAction', copies: 3, play: [knockout(1)], art: 'skull', seed: 133 },
  { id: 'treasury_blackmail', name: 'Шантаж', patron: 'treasury', cost: 3, type: 'contractAction', copies: 2, play: [power(2)], art: 'scroll', seed: 134 },
  { id: 'treasury_harvest', name: 'Скудная жатва', patron: 'treasury', cost: 2, type: 'contractAction', copies: 3, play: [draw(1)], art: 'grave', seed: 135 },
  { id: 'treasury_prison', name: 'Заточение', patron: 'treasury', cost: 5, type: 'contractAction', copies: 3, play: [power(4)], art: 'chain', seed: 136 },
  { id: 'treasury_ragpicker', name: 'Старьёвщик', patron: 'treasury', cost: 3, type: 'contractAction', copies: 2, play: [destroy(1)], art: 'rat', seed: 137 },
  { id: 'treasury_tithe', name: 'Десятина', patron: 'treasury', cost: 3, type: 'contractAction', copies: 2, play: [patronCall(1)], art: 'coins', seed: 138 },

  // ── Карраг Падальщик (Duke of Crows): добор, монеты и сила в комбо ────
  { id: 'crows_starter', name: 'Вороний грай', patron: 'crows', cost: 0, type: 'starter', copies: 0, play: [coin(1)], art: 'crow', seed: 11 },
  { id: 'crows_scratch', name: 'Удар когтем', patron: 'crows', cost: 4, type: 'action', copies: 4, play: [coin(1)], combo: { 2: [coin(2), power(2)] }, art: 'feather', seed: 12 },
  { id: 'crows_toll_flesh', name: 'Пошлина плотью', patron: 'crows', cost: 4, type: 'action', copies: 4, play: [coin(2)], combo: { 2: [draw(1)] }, art: 'heart', seed: 14 },
  { id: 'crows_pool', name: 'Омут теней', patron: 'crows', cost: 4, type: 'action', copies: 2, play: [power(2)], combo: { 2: [draw(1)], 4: [coin(3)] }, art: 'portal', seed: 16 },
  { id: 'crows_law', name: 'Закон Вороньего Гнезда', patron: 'crows', cost: 4, type: 'contractAction', copies: 2, play: [draw(1)], combo: { 3: [oppDiscard(1)] }, art: 'throne', seed: 20 },
  { id: 'crows_pilfer', name: 'Мародёрство', patron: 'crows', cost: 5, type: 'action', copies: 2, play: [draw(1)], combo: { 2: [draw(1)] }, art: 'hand', seed: 19 },
  { id: 'crows_sermon', name: 'Каркающая проповедь', patron: 'crows', cost: 6, type: 'action', copies: 2, play: [draw(1)], combo: { 3: [draw(1)], 4: [power(4)] }, art: 'altar', seed: 18 },
  { id: 'crows_brigand', name: 'Чернокрылый головорез', patron: 'crows', cost: 6, type: 'agent', hp: 2, copies: 2, play: [coin(1)], combo: { 3: [draw(1)] }, art: 'assassin', seed: 13 },
  { id: 'crows_knight', name: 'Чернокрылый рыцарь', patron: 'crows', cost: 6, type: 'agent', hp: 3, copies: 2, play: [coin(1)], combo: { 3: [coin(2), power(2)] }, art: 'knight', seed: 17 },

  // ── Ростовщица Вейла (Hlaalu): монеты и бесплатные приобретения ─
  { id: 'hlaalu_starter', name: 'Пепельная поставка', patron: 'hlaalu', cost: 0, type: 'starter', copies: 0, play: [coin(1)], art: 'chest', seed: 31 },
  { id: 'hlaalu_exports', name: 'Траурный караван', patron: 'hlaalu', cost: 2, type: 'action', copies: 3, play: [coin(3)], art: 'ship', seed: 36 },
  { id: 'hlaalu_mine', name: 'Пепельная шахта', patron: 'hlaalu', cost: 3, type: 'contractAction', copies: 3, play: [coin(2)], combo: { 3: [coin(3)] }, art: 'gate', seed: 38 },
  { id: 'hlaalu_seizure', name: 'Конфискация', patron: 'hlaalu', cost: 4, type: 'action', copies: 3, play: [acquire(6)], art: 'key', seed: 34 },
  { id: 'hlaalu_takeover', name: 'Поглощение долга', patron: 'hlaalu', cost: 5, type: 'action', copies: 2, play: [power(1)], combo: { 2: [acquire(7)] }, art: 'book', seed: 32 },
  { id: 'hlaalu_hireling', name: 'Наёмный писарь', patron: 'hlaalu', cost: 6, type: 'agent', hp: 2, copies: 3, play: [coin(2)], combo: { 2: [acquire(5)] }, art: 'merchant', seed: 33 },
  { id: 'hlaalu_exchange', name: 'Весы ростовщицы', patron: 'hlaalu', cost: 7, type: 'action', copies: 2, play: [replaceTavern(1), coin(5)], combo: { 2: [patronCall(1)] }, art: 'scales', seed: 35 },
  { id: 'hlaalu_market', name: 'Аукцион костей', patron: 'hlaalu', cost: 8, type: 'action', copies: 2, play: [coin(6)], combo: { 2: [acquire(7)] }, art: 'bones', seed: 39 },
  { id: 'hlaalu_kinsman', name: 'Маклер душ', patron: 'hlaalu', cost: 10, type: 'agent', hp: 1, copies: 2, play: [acquire(9)], combo: { 2: [replaceTavern(1)] }, art: 'mask', seed: 37 },

  // ── Гримвальд Костяной (Saint Pelin): сила и агенты с провокацией ──────
  { id: 'pelin_starter', name: 'Клятва стража', patron: 'pelin', cost: 0, type: 'starter', copies: 0, play: [power(1)], art: 'shield', seed: 51 },
  { id: 'pelin_portcullis', name: 'Ржавая решётка', patron: 'pelin', cost: 2, type: 'action', copies: 3, play: [power(2)], combo: { 2: [coin(1)] }, art: 'gate', seed: 54 },
  { id: 'pelin_reinforce', name: 'Подкрепление из склепа', patron: 'pelin', cost: 3, type: 'action', copies: 3, play: [coin(2)], combo: { 2: [power(2)], 3: [power(1)] }, art: 'ghost', seed: 52 },
  { id: 'pelin_volley', name: 'Залп костяных лучников', patron: 'pelin', cost: 4, type: 'action', copies: 4, play: [power(3)], combo: { 2: [coin(1)] }, art: 'bow', seed: 53 },
  { id: 'pelin_armory', name: 'Костяной арсенал', patron: 'pelin', cost: 6, type: 'action', copies: 2, play: [power(5)], combo: { 2: [coin(1)] }, art: 'hammer', seed: 56 },
  { id: 'pelin_bearer', name: 'Щитоносец-призрак', patron: 'pelin', cost: 6, type: 'contractAgent', hp: 5, taunt: true, copies: 2, play: [power(1)], art: 'knight', seed: 58 },
  { id: 'pelin_sentries', name: 'Могильная стража', patron: 'pelin', cost: 7, type: 'agent', hp: 4, taunt: true, copies: 2, play: [coin(1)], art: 'priest', seed: 57 },
  { id: 'pelin_rally', name: 'Сбор павших', patron: 'pelin', cost: 8, type: 'action', copies: 2, play: [power(6)], combo: { 2: [draw(1)] }, art: 'grave', seed: 59 },
  { id: 'pelin_banneret', name: 'Знаменосец мёртвых', patron: 'pelin', cost: 9, type: 'agent', hp: 5, taunt: true, copies: 2, play: [power(3)], art: 'banner', seed: 55 },

  // ── Иссерия Безглазая (Psijic): просмотр колоды и сброс лишнего ──────
  { id: 'psijic_starter', name: 'Прозрение', patron: 'psijic', cost: 0, type: 'starter', copies: 0, play: [coin(1)], art: 'eye', seed: 71 },
  { id: 'psijic_globe', name: 'Шар прорицания', patron: 'psijic', cost: 2, type: 'action', copies: 4, play: [coin(2), toss(2)], art: 'gem', seed: 72 },
  { id: 'psijic_counsel', name: 'Совет мудреца', patron: 'psijic', cost: 3, type: 'contractAction', copies: 3, play: [toss(3)], combo: { 2: [power(1)] }, art: 'book', seed: 77 },
  { id: 'psijic_mastery', name: 'Власть над временем', patron: 'psijic', cost: 3, type: 'action', copies: 3, play: [toss(5)], combo: { 2: [coin(2)] }, art: 'tower', seed: 75 },
  { id: 'psijic_prescience', name: 'Предвидение', patron: 'psijic', cost: 4, type: 'action', copies: 3, play: [coin(3), replaceTavern(1)], art: 'eye', seed: 73 },
  { id: 'psijic_insight', name: 'Слепое озарение', patron: 'psijic', cost: 5, type: 'action', copies: 2, play: [coin(2), toss(4)], combo: { 2: [power(2)] }, art: 'moon', seed: 76 },
  { id: 'psijic_apprentice', name: 'Безглазый послушник', patron: 'psijic', cost: 6, type: 'agent', hp: 3, copies: 2, play: [toss(4)], art: 'hooded', seed: 74 },
  { id: 'psijic_cave', name: 'Пещера снов', patron: 'psijic', cost: 6, type: 'action', copies: 3, play: [draw(1), toss(4)], combo: { 2: [power(2)] }, art: 'portal', seed: 79 },

  // ── Шут Морвен (Rajhin): сброс, потеря престижа, нокаут ──────────
  { id: 'rajhin_starter', name: 'Ловкие пальцы', patron: 'rajhin', cost: 0, type: 'starter', copies: 0, play: [coin(1)], art: 'hand', seed: 91 },
  { id: 'rajhin_sleight', name: 'Ловкость рук', patron: 'rajhin', cost: 2, type: 'action', copies: 3, play: [coin(2)], combo: { 2: [replaceTavern(1)] }, art: 'key', seed: 92 },
  { id: 'rajhin_illusion', name: 'Лунный морок', patron: 'rajhin', cost: 3, type: 'contractAction', copies: 3, play: [destroy(1)], combo: { 3: [oppLose(1)] }, art: 'moon', seed: 96 },
  { id: 'rajhin_jeering', name: 'Глумливая тень', patron: 'rajhin', cost: 4, type: 'agent', hp: 2, copies: 3, play: [coin(1)], combo: { 2: [oppLose(1)] }, art: 'mask', seed: 94 },
  { id: 'rajhin_pounce', name: 'Прыжок и нажива', patron: 'rajhin', cost: 5, type: 'action', copies: 3, play: [coin(4)], combo: { 2: [knockout(1)] }, art: 'cat', seed: 97 },
  { id: 'rajhin_stubborn', name: 'Упрямая тень', patron: 'rajhin', cost: 6, type: 'agent', hp: 3, taunt: true, copies: 3, play: [], combo: { 2: [oppLose(2)] }, art: 'spider', seed: 98 },
  { id: 'rajhin_tricks', name: 'Мешок фокусов', patron: 'rajhin', cost: 7, type: 'contractAction', copies: 2, play: [oppDiscard(1)], combo: { 2: [draw(1)], 3: [oppDiscard(1)] }, art: 'chest', seed: 93 },
  { id: 'rajhin_lullaby', name: 'Скрипучая колыбельная', patron: 'rajhin', cost: 7, type: 'action', copies: 2, play: [knockout(2), coin(2)], combo: { 2: [coin(2)], 3: [oppDiscard(1)] }, art: 'lantern', seed: 95 },
  { id: 'rajhin_revelry', name: 'Сумеречный кутёж', patron: 'rajhin', cost: 10, type: 'action', copies: 1, play: [oppDiscard(1)], combo: { 2: [replaceTavern(3)], 3: [oppLose(3)], 4: [draw(3)] }, art: 'chalice', seed: 99 },

  // ── Хротгар Кровавое Перо (Red Eagle): чистка колоды и сила ───────────
  { id: 'eagle_starter', name: 'Клич пустоши', patron: 'eagle', cost: 0, type: 'starter', copies: 0, play: [power(1)], art: 'eagle', seed: 111 },
  { id: 'eagle_bonfire', name: 'Погребальный костёр', patron: 'eagle', cost: 3, type: 'contractAction', copies: 3, play: [destroy(1)], art: 'flame', seed: 112 },
  { id: 'eagle_spoils', name: 'Трофеи набега', patron: 'eagle', cost: 3, type: 'contractAction', copies: 3, play: [replaceTavern(2)], combo: { 2: [coin(1)] }, art: 'coins', seed: 113 },
  { id: 'eagle_raid', name: 'Полночный набег', patron: 'eagle', cost: 4, type: 'action', copies: 3, play: [power(3)], combo: { 2: [power(2)] }, art: 'wolf', seed: 114 },
  { id: 'eagle_ritual', name: 'Ритуал терновых сердец', patron: 'eagle', cost: 5, type: 'contractAction', copies: 2, play: [power(1), destroy(2)], art: 'heart', seed: 115 },
  { id: 'eagle_hunter', name: 'Ловчий людей', patron: 'eagle', cost: 5, type: 'contractAgent', hp: 2, copies: 2, play: [power(1)], combo: { 2: [destroy(1)] }, art: 'axe', seed: 116 },
  { id: 'eagle_offering', name: 'Кровавое подношение', patron: 'eagle', cost: 6, type: 'contractAction', copies: 2, play: [destroy(1), power(2)], combo: { 2: [draw(1)] }, art: 'altar', seed: 117 },
  { id: 'eagle_witch', name: 'Ведьма клана', patron: 'eagle', cost: 6, type: 'contractAgent', hp: 4, copies: 3, play: [destroy(1)], art: 'cauldron', seed: 118 },
  { id: 'eagle_hagraven', name: 'Карга-ворожея', patron: 'eagle', cost: 9, type: 'agent', hp: 4, copies: 2, play: [destroy(1)], combo: { 2: [power(1)] }, art: 'beast', seed: 119 },
];

export const CARD_MAP: Record<string, CardDef> = Object.fromEntries(CARDS.map((c) => [c.id, c]));

export function cardDef(id: string): CardDef {
  const def = CARD_MAP[id];
  if (!def) throw new Error(`Unknown card ${id}`);
  return def;
}

export const STARTING_GOLD = 6;
export const HAND_SIZE = 5;
export const TAVERN_SIZE = 5;
export const PRESTIGE_GOAL = 40;
export const PRESTIGE_INSTANT = 80;
