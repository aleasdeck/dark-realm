import type { CardDef, Effect, PatronDef, PatronId } from './types';

/*
 * Card data. Mechanics follow Tales of Tribute patron decks; names and flavor
 * are reworked for the Dark Realm setting. To add a custom card, append an
 * entry to CARDS with a unique id and the patron it belongs to. `copies`
 * controls how many end up in the tavern deck.
 */

const coin = (n: number): Effect => ({ k: 'coin', n });
const power = (n: number): Effect => ({ k: 'power', n });
const prestige = (n: number): Effect => ({ k: 'prestige', n });
const oppLose = (n: number): Effect => ({ k: 'oppLosePrestige', n });
const draw = (n: number): Effect => ({ k: 'draw', n });
const oppDiscard = (n: number): Effect => ({ k: 'oppDiscard', n });
const acquire = (n: number): Effect => ({ k: 'acquire', n });
const toss = (n: number): Effect => ({ k: 'toss', n });
const destroy = (n: number): Effect => ({ k: 'destroy', n });
const knockout = (n: number): Effect => ({ k: 'knockout', n });
const returnTop = (n: number, agentsOnly = false): Effect => ({ k: 'returnTop', n, agentsOnly });
const replaceTavern = (n: number): Effect => ({ k: 'replaceTavern', n });
const heal = (n: number): Effect => ({ k: 'heal', n });
const patronCall = (n: number): Effect => ({ k: 'patronCall', n });
const donate = (n: number): Effect => ({ k: 'donate', n });
const or = (...options: Effect[][]): Effect => ({ k: 'choice', options });
const curse = (n: number): Effect => ({ k: 'create', card: 'bewilderment', n, to: 'oppCooldown' });

export const PATRONS: Record<PatronId, PatronDef> = {
  crows: {
    id: 'crows',
    name: 'Князь Ворон',
    title: 'Власть над голодной стаей',
    palette: { bg1: '#0b0710', bg2: '#2a0f22', accent: '#7a2440', glow: '#d8405a' },
  },
  hlaalu: {
    id: 'hlaalu',
    name: 'Магистр Пепла',
    title: 'Всё имеет цену',
    palette: { bg1: '#140c05', bg2: '#3b2410', accent: '#b8862b', glow: '#ffd36b' },
  },
  pelin: {
    id: 'pelin',
    name: 'Святой Велиор',
    title: 'Мёртвые не покидают строй',
    palette: { bg1: '#070b12', bg2: '#1b2638', accent: '#8a9bb5', glow: '#d9e6ff' },
  },
  psijic: {
    id: 'psijic',
    name: 'Слепой Провидец',
    title: 'Видит то, чего ещё нет',
    palette: { bg1: '#04100f', bg2: '#0f3330', accent: '#2f8f84', glow: '#7affe4' },
  },
  rajhin: {
    id: 'rajhin',
    name: 'Шепчущий Лжец',
    title: 'Улыбка в темноте',
    palette: { bg1: '#0c0612', bg2: '#2a1638', accent: '#6d3f8f', glow: '#b98cff' },
  },
  eagle: {
    id: 'eagle',
    name: 'Алый Орёл',
    title: 'Король пустошей',
    palette: { bg1: '#120504', bg2: '#3a120b', accent: '#a33a20', glow: '#ff7a3d' },
  },
  treasury: {
    id: 'treasury',
    name: 'Казна',
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

  // ── Князь Ворон (Duke of Crows): сила, сброс, нокаут ────
  { id: 'crows_starter', name: 'Вороний грай', patron: 'crows', cost: 0, type: 'starter', copies: 0, play: [power(1)], combo: { 2: [power(1)] }, art: 'crow', seed: 11 },
  { id: 'crows_peck', name: 'Клевок', patron: 'crows', cost: 1, type: 'action', copies: 2, play: [power(1)], combo: { 2: [coin(1)] }, art: 'feather', seed: 12 },
  { id: 'crows_knave', name: 'Чернокрылый плут', patron: 'crows', cost: 3, type: 'agent', hp: 1, copies: 2, play: [power(1)], combo: { 2: [coin(1)] }, art: 'assassin', seed: 13 },
  { id: 'crows_toll_flesh', name: 'Пошлина плотью', patron: 'crows', cost: 3, type: 'action', copies: 2, play: [power(2)], combo: { 2: [oppDiscard(1)] }, art: 'heart', seed: 14 },
  { id: 'crows_toll_silver', name: 'Пошлина серебром', patron: 'crows', cost: 3, type: 'action', copies: 2, play: [coin(2)], combo: { 2: [power(1)] }, art: 'coins', seed: 15 },
  { id: 'crows_pool', name: 'Омут теней', patron: 'crows', cost: 4, type: 'action', copies: 1, play: [power(2), destroy(1)], combo: { 3: [oppDiscard(1)] }, art: 'portal', seed: 16 },
  { id: 'crows_brigand', name: 'Чернокрылый головорез', patron: 'crows', cost: 5, type: 'agent', hp: 3, taunt: true, copies: 1, play: [power(2)], combo: { 3: [power(1)] }, art: 'knight', seed: 17 },
  { id: 'crows_sermon', name: 'Каркающая проповедь', patron: 'crows', cost: 5, type: 'contractAction', copies: 1, play: [power(3), oppDiscard(1)], art: 'altar', seed: 18 },
  { id: 'crows_plunder', name: 'Разграбление', patron: 'crows', cost: 6, type: 'action', copies: 1, play: [coin(3), power(1)], combo: { 2: [power(2)] }, art: 'chest', seed: 19 },
  { id: 'crows_law', name: 'Закон Вороньего Гнезда', patron: 'crows', cost: 8, type: 'action', copies: 1, play: [power(4), knockout(1)], combo: { 3: [oppLose(2)] }, art: 'throne', seed: 20 },
  { id: 'crows_murder', name: 'Стая-убийца', patron: 'crows', cost: 9, type: 'action', copies: 1, play: [power(5)], combo: { 2: [oppDiscard(1)], 4: [power(3)] }, art: 'crow', seed: 21 },

  // ── Магистр Пепла (Hlaalu): монеты, престиж, приобретение ─
  { id: 'hlaalu_starter', name: 'Пепельная поставка', patron: 'hlaalu', cost: 0, type: 'starter', copies: 0, play: [coin(1)], combo: { 2: [coin(1)] }, art: 'chest', seed: 31 },
  { id: 'hlaalu_ledger', name: 'Долговая книга', patron: 'hlaalu', cost: 2, type: 'action', copies: 2, play: [coin(2)], combo: { 2: [prestige(1)] }, art: 'book', seed: 32 },
  { id: 'hlaalu_clerk', name: 'Пепельный писарь', patron: 'hlaalu', cost: 3, type: 'agent', hp: 2, copies: 2, play: [coin(1), prestige(1)], art: 'merchant', seed: 33 },
  { id: 'hlaalu_bribe', name: 'Взятка', patron: 'hlaalu', cost: 3, type: 'action', copies: 2, play: [or([coin(3)], [power(2)])], combo: { 3: [prestige(2)] }, art: 'hand', seed: 34 },
  { id: 'hlaalu_scales', name: 'Весы Магистра', patron: 'hlaalu', cost: 4, type: 'action', copies: 1, play: [coin(2), replaceTavern(2)], combo: { 2: [prestige(2)] }, art: 'scales', seed: 35 },
  { id: 'hlaalu_caravan', name: 'Траурный караван', patron: 'hlaalu', cost: 5, type: 'contractAction', copies: 1, play: [coin(3), prestige(2)], art: 'ship', seed: 36 },
  { id: 'hlaalu_broker', name: 'Маклер душ', patron: 'hlaalu', cost: 5, type: 'agent', hp: 3, copies: 1, play: [acquire(3)], art: 'mask', seed: 37 },
  { id: 'hlaalu_vault', name: 'Пепельное хранилище', patron: 'hlaalu', cost: 6, type: 'action', copies: 1, play: [coin(4)], combo: { 3: [prestige(3)] }, art: 'gate', seed: 38 },
  { id: 'hlaalu_auction', name: 'Аукцион костей', patron: 'hlaalu', cost: 7, type: 'action', copies: 1, play: [acquire(6)], combo: { 2: [prestige(2)] }, art: 'bones', seed: 39 },
  { id: 'hlaalu_monopoly', name: 'Монополия на скорбь', patron: 'hlaalu', cost: 9, type: 'action', copies: 1, play: [coin(5), prestige(3)], combo: { 3: [prestige(4)] }, art: 'crown', seed: 40 },

  // ── Святой Велиор (Pelin): агенты, лечение, возврат ──────
  { id: 'pelin_starter', name: 'Клятва стража', patron: 'pelin', cost: 0, type: 'starter', copies: 0, play: [power(1)], combo: { 2: [heal(2)] }, art: 'shield', seed: 51 },
  { id: 'pelin_squire', name: 'Оруженосец-призрак', patron: 'pelin', cost: 2, type: 'agent', hp: 2, taunt: true, copies: 2, play: [power(1)], art: 'ghost', seed: 52 },
  { id: 'pelin_vigil', name: 'Ночное бдение', patron: 'pelin', cost: 2, type: 'action', copies: 2, play: [power(1), heal(2)], combo: { 2: [power(1)] }, art: 'candle', seed: 53 },
  { id: 'pelin_rally', name: 'Сбор павших', patron: 'pelin', cost: 3, type: 'action', copies: 2, play: [returnTop(1, true), power(1)], combo: { 3: [power(2)] }, art: 'grave', seed: 54 },
  { id: 'pelin_paladin', name: 'Пепельный паладин', patron: 'pelin', cost: 4, type: 'agent', hp: 4, taunt: true, copies: 1, play: [power(2)], art: 'knight', seed: 55 },
  { id: 'pelin_banner', name: 'Знамя мученика', patron: 'pelin', cost: 5, type: 'action', copies: 1, play: [power(3)], combo: { 2: [heal(3)], 3: [prestige(2)] }, art: 'banner', seed: 56 },
  { id: 'pelin_chaplain', name: 'Могильный капеллан', patron: 'pelin', cost: 5, type: 'agent', hp: 3, copies: 1, play: [heal(2), draw(1)], art: 'priest', seed: 57 },
  { id: 'pelin_crusade', name: 'Мёртвый поход', patron: 'pelin', cost: 6, type: 'contractAgent', hp: 5, taunt: true, copies: 1, play: [power(3)], art: 'hammer', seed: 58 },
  { id: 'pelin_relic', name: 'Мощи святого', patron: 'pelin', cost: 7, type: 'action', copies: 1, play: [power(3), returnTop(2)], combo: { 3: [prestige(3)] }, art: 'chalice', seed: 59 },
  { id: 'pelin_saint', name: 'Неупокоенный святой', patron: 'pelin', cost: 9, type: 'agent', hp: 6, taunt: true, copies: 1, play: [power(4), prestige(1)], art: 'priest', seed: 60 },

  // ── Слепой Провидец (Psijic): нокаут, добор, призыв ──────
  { id: 'psijic_starter', name: 'Прозрение', patron: 'psijic', cost: 0, type: 'starter', copies: 0, play: [coin(1)], combo: { 2: [toss(1)] }, art: 'eye', seed: 71 },
  { id: 'psijic_acolyte', name: 'Безглазый послушник', patron: 'psijic', cost: 2, type: 'action', copies: 2, play: [coin(1), toss(2)], combo: { 2: [draw(1)] }, art: 'hooded', seed: 72 },
  { id: 'psijic_rune', name: 'Руна забвения', patron: 'psijic', cost: 3, type: 'action', copies: 2, play: [power(2)], combo: { 2: [knockout(1)] }, art: 'rune', seed: 73 },
  { id: 'psijic_seer', name: 'Звёздный толкователь', patron: 'psijic', cost: 4, type: 'agent', hp: 3, copies: 1, play: [draw(1)], art: 'mage', seed: 74 },
  { id: 'psijic_tide', name: 'Безвременный прилив', patron: 'psijic', cost: 4, type: 'action', copies: 2, play: [coin(2), patronCall(1)], combo: { 3: [draw(1)] }, art: 'moon', seed: 75 },
  { id: 'psijic_banish', name: 'Изгнание', patron: 'psijic', cost: 5, type: 'action', copies: 1, play: [knockout(1), power(2)], combo: { 2: [draw(1)] }, art: 'portal', seed: 76 },
  { id: 'psijic_tower', name: 'Башня у края времени', patron: 'psijic', cost: 6, type: 'contractAction', copies: 1, play: [draw(2), patronCall(1)], art: 'tower', seed: 77 },
  { id: 'psijic_warden', name: 'Хранитель безмолвия', patron: 'psijic', cost: 6, type: 'agent', hp: 4, taunt: true, copies: 1, play: [power(2), toss(1)], art: 'mage', seed: 78 },
  { id: 'psijic_rift', name: 'Разлом', patron: 'psijic', cost: 8, type: 'action', copies: 1, play: [{ k: 'knockoutAll' }, power(3)], combo: { 3: [draw(2)] }, art: 'eye', seed: 79 },

  // ── Шепчущий Лжец (Rajhin): морок, сброс, добор ──────────
  { id: 'rajhin_starter', name: 'Мешок фокусов', patron: 'rajhin', cost: 0, type: 'starter', copies: 0, play: [coin(1)], combo: { 2: [curse(1)] }, art: 'cat', seed: 91 },
  { id: 'rajhin_pickpocket', name: 'Карманник', patron: 'rajhin', cost: 2, type: 'action', copies: 2, play: [coin(2)], combo: { 2: [curse(1)] }, art: 'rat', seed: 92 },
  { id: 'rajhin_lie', name: 'Сладкая ложь', patron: 'rajhin', cost: 3, type: 'action', copies: 2, play: [curse(1), draw(1)], combo: { 3: [oppDiscard(1)] }, art: 'mask', seed: 93 },
  { id: 'rajhin_shade', name: 'Тень на крыше', patron: 'rajhin', cost: 3, type: 'agent', hp: 2, copies: 2, play: [coin(1), donate(1)], art: 'cat', seed: 94 },
  { id: 'rajhin_spider', name: 'Паучья сеть', patron: 'rajhin', cost: 4, type: 'action', copies: 1, play: [power(2), oppDiscard(1)], combo: { 2: [curse(1)] }, art: 'spider', seed: 95 },
  { id: 'rajhin_lantern', name: 'Ложный огонёк', patron: 'rajhin', cost: 5, type: 'contractAction', copies: 1, play: [curse(2), coin(2)], art: 'lantern', seed: 96 },
  { id: 'rajhin_heist', name: 'Кража из склепа', patron: 'rajhin', cost: 6, type: 'action', copies: 1, play: [coin(3), draw(1)], combo: { 2: [acquire(4)] }, art: 'key', seed: 97 },
  { id: 'rajhin_jester', name: 'Смеющийся шут', patron: 'rajhin', cost: 6, type: 'agent', hp: 4, copies: 1, play: [curse(1), power(1)], art: 'mask', seed: 98 },
  { id: 'rajhin_grin', name: 'Улыбка во тьме', patron: 'rajhin', cost: 8, type: 'action', copies: 1, play: [oppDiscard(2), power(3)], combo: { 3: [oppLose(3)] }, art: 'cat', seed: 99 },

  // ── Алый Орёл (Red Eagle): сила, добор, агенты ───────────
  { id: 'eagle_starter', name: 'Клич пустоши', patron: 'eagle', cost: 0, type: 'starter', copies: 0, play: [power(1)], combo: { 2: [draw(1)] }, art: 'eagle', seed: 111 },
  { id: 'eagle_scout', name: 'Разведчик холмов', patron: 'eagle', cost: 1, type: 'action', copies: 2, play: [or([coin(1)], [power(1)])], combo: { 2: [draw(1)] }, art: 'bow', seed: 112 },
  { id: 'eagle_raider', name: 'Налётчик в шкурах', patron: 'eagle', cost: 3, type: 'agent', hp: 2, copies: 2, play: [power(2)], art: 'axe', seed: 113 },
  { id: 'eagle_warcry', name: 'Боевой клич', patron: 'eagle', cost: 3, type: 'action', copies: 2, play: [power(2), draw(1)], combo: { 3: [power(2)] }, art: 'banner', seed: 114 },
  { id: 'eagle_wolf', name: 'Пепельный волк', patron: 'eagle', cost: 4, type: 'agent', hp: 3, taunt: true, copies: 1, play: [power(2)], combo: { 2: [power(1)] }, art: 'wolf', seed: 115 },
  { id: 'eagle_shaman', name: 'Шаманка Вороньего камня', patron: 'eagle', cost: 5, type: 'agent', hp: 3, copies: 1, play: [draw(1), heal(2)], art: 'cauldron', seed: 116 },
  { id: 'eagle_warband', name: 'Военный отряд', patron: 'eagle', cost: 6, type: 'contractAgent', hp: 4, taunt: true, copies: 1, play: [power(3)], art: 'sword', seed: 117 },
  { id: 'eagle_hunt', name: 'Кровавая охота', patron: 'eagle', cost: 6, type: 'action', copies: 1, play: [power(4)], combo: { 2: [knockout(1)] }, art: 'beast', seed: 118 },
  { id: 'eagle_king', name: 'Король-изгнанник', patron: 'eagle', cost: 9, type: 'agent', hp: 6, taunt: true, copies: 1, play: [power(3), draw(1)], art: 'crown', seed: 119 },
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
