import type { CardDef, Effect, PatronDef, PatronId } from './types';

/*
 * Card data. Costs, effects and copies follow the fully upgraded Tales of Tribute decks as
 * listed on UESP (en.uesp.net/wiki/Online:Tales_of_Tribute, patron pages): each upgrade takes
 * over some copies of a base card, so every deck still holds 20 cards. Names and flavor are
 * reworked for the Dark Realm setting. To add a custom card, append an
 * entry to CARDS with a unique id and the patron it belongs to. `copies`
 * controls how many end up in the tavern deck. The engine supports more effects than these
 * decks use, see Effect in types.ts. The patrons marked `locked` stay out of the
 * draft until the player unlocks them (see src/ui/unlocks.ts).
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
const heal = (n: number): Effect => ({ k: 'heal', n });
const replaceTavern = (n: number): Effect => ({ k: 'replaceTavern', n });
const patronCall = (n: number): Effect => ({ k: 'patronCall', n });
const prestige = (n: number): Effect => ({ k: 'prestige', n });
const donate = (n: number): Effect => ({ k: 'donate', n });
const confine = (n: number): Effect => ({ k: 'confine', n });
const refresh = (n: number, agentsOnly = false): Effect => ({ k: 'returnTop', n, ...(agentsOnly ? { agentsOnly } : {}) });
const setback = (res: 'coin' | 'power' | 'draw', n: number): Effect => ({ k: 'setback', res, n });
const create = (card: string): Effect => ({ k: 'create', card, n: 1, to: 'cooldown' });
const pick = (...options: Effect[][]): Effect => ({ k: 'choice', options });
const knockoutAll: Effect = { k: 'knockoutAll' };

export const PATRONS: Record<PatronId, PatronDef> = {
  crows: {
    id: 'crows',
    name: 'Ворон',
    title: 'Владыка голодной стаи',
    palette: { bg1: '#0b0710', bg2: '#2a0f22', accent: '#7a2440', glow: '#d8405a' },
  },
  hlaalu: {
    id: 'hlaalu',
    name: 'Крыса',
    title: 'Всё имеет цену',
    palette: { bg1: '#140c05', bg2: '#3b2410', accent: '#b8862b', glow: '#ffd36b' },
  },
  pelin: {
    id: 'pelin',
    name: 'Волк',
    title: 'Мёртвые не покидают строй',
    palette: { bg1: '#070b12', bg2: '#1b2638', accent: '#8a9bb5', glow: '#d9e6ff' },
  },
  psijic: {
    id: 'psijic',
    name: 'Сова',
    title: 'Видит то, чего ещё нет',
    palette: { bg1: '#04100f', bg2: '#0f3330', accent: '#2f8f84', glow: '#7affe4' },
  },
  rajhin: {
    id: 'rajhin',
    name: 'Кот',
    title: 'Улыбка в темноте',
    palette: { bg1: '#0c0612', bg2: '#2a1638', accent: '#6d3f8f', glow: '#b98cff' },
  },
  eagle: {
    id: 'eagle',
    name: 'Орёл',
    title: 'Вождь пепельных пустошей',
    palette: { bg1: '#120504', bg2: '#3a120b', accent: '#a33a20', glow: '#ff7a3d' },
  },
  alma: {
    id: 'alma',
    name: 'Паук',
    title: 'Милость тоже бывает цепью',
    locked: true,
    palette: { bg1: '#12070c', bg2: '#3a1426', accent: '#a84a6a', glow: '#ff9ac0' },
  },
  hunding: {
    id: 'hunding',
    name: 'Богомол',
    title: 'Клинок поёт лишь в верной руке',
    locked: true,
    palette: { bg1: '#040c08', bg2: '#0f2e21', accent: '#1f7f52', glow: '#7ef0b8' },
  },
  druid: {
    id: 'druid',
    name: 'Олень',
    title: 'Пепел помнит корни',
    locked: true,
    palette: { bg1: '#050c05', bg2: '#163018', accent: '#3e7a2e', glow: '#9cff6a' },
  },
  mora: {
    id: 'mora',
    name: 'Спрут',
    title: 'Знание всегда берёт плату',
    locked: true,
    palette: { bg1: '#0a0b04', bg2: '#2a2e0e', accent: '#707a1a', glow: '#e4ff4a' },
  },
  alessia: {
    id: 'alessia',
    name: 'Бык',
    title: 'Цепи падают с первым криком',
    locked: true,
    palette: { bg1: '#120904', bg2: '#3a200c', accent: '#b05a1e', glow: '#ffc070' },
  },
  orgnum: {
    id: 'orgnum',
    name: 'Змей',
    title: 'Прилив всегда приносит добычу',
    locked: true,
    palette: { bg1: '#040a12', bg2: '#0e2a42', accent: '#1e5a8a', glow: '#5ad4ff' },
  },
  treasury: {
    id: 'treasury',
    name: 'Сундук Бездны',
    title: 'Нейтральный покровитель',
    palette: { bg1: '#0a0a0a', bg2: '#262019', accent: '#7d6a4d', glow: '#e8c98a' },
  },
};

export const DRAFTABLE: PatronId[] = ['crows', 'hlaalu', 'pelin', 'psijic', 'rajhin', 'eagle'];
/** Patrons that join the draft only once unlocked. */
export const LOCKED: PatronId[] = ['alma', 'hunding', 'druid', 'mora', 'alessia', 'orgnum'];

export const CARDS: CardDef[] = [
  // ── Neutral ─────────────────────────────────────────────
  { id: 'gold', name: 'Золото', patron: 'neutral', cost: 0, type: 'starter', copies: 0, play: [coin(1)], art: 'coin', seed: 1 },
  { id: 'fake_coin', name: 'Фальшивая монета', patron: 'neutral', cost: 0, type: 'contractAction', copies: 0, play: [coin(1)], art: 'coin', seed: 9, fleeting: true },
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

  // ── Ворон (Duke of Crows): добор, монеты и сила в комбо ────
  { id: 'crows_starter', name: 'Вороний грай', patron: 'crows', cost: 0, type: 'starter', copies: 0, play: [coin(1)], art: 'crow', seed: 11 },
  { id: 'crows_scratch', name: 'Удар когтем', patron: 'crows', cost: 4, type: 'action', copies: 2, play: [coin(1)], combo: { 2: [coin(2), power(2)] }, art: 'feather', seed: 12 },
  { id: 'crows_toll_flesh', name: 'Пошлина плотью', patron: 'crows', cost: 4, type: 'action', copies: 2, play: [coin(2)], combo: { 2: [draw(1)] }, art: 'heart', seed: 14 },
  { id: 'crows_pool', name: 'Омут теней', patron: 'crows', cost: 4, type: 'action', copies: 2, play: [power(2)], combo: { 2: [draw(1)], 4: [coin(3)] }, art: 'portal', seed: 16 },
  { id: 'crows_law', name: 'Закон Вороньего Гнезда', patron: 'crows', cost: 4, type: 'contractAction', copies: 2, play: [draw(1)], combo: { 3: [oppDiscard(1)] }, art: 'throne', seed: 20 },
  { id: 'crows_pilfer', name: 'Мародёрство', patron: 'crows', cost: 5, type: 'action', copies: 1, play: [draw(1)], combo: { 2: [draw(1)] }, art: 'hand', seed: 19 },
  { id: 'crows_sermon', name: 'Каркающая проповедь', patron: 'crows', cost: 6, type: 'action', copies: 2, play: [draw(1)], combo: { 3: [draw(1)], 4: [power(4)] }, art: 'altar', seed: 18 },
  { id: 'crows_brigand', name: 'Чернокрылый головорез', patron: 'crows', cost: 6, type: 'agent', hp: 2, copies: 1, play: [coin(1)], combo: { 3: [draw(1)] }, art: 'assassin', seed: 13 },
  { id: 'crows_knight', name: 'Чернокрылый рыцарь', patron: 'crows', cost: 6, type: 'agent', hp: 3, copies: 2, play: [coin(1)], combo: { 3: [coin(2), power(2)] }, art: 'knight', seed: 17 },
  // Улучшения (заменяют часть копий базовых карт выше)
  { id: 'crows_knave', name: 'Чернокрылый плут', patron: 'crows', cost: 6, type: 'agent', hp: 2, copies: 1, play: [coin(2)], combo: { 3: [draw(1)] }, art: 'mask', seed: 21 },
  { id: 'crows_murder', name: 'Воронья стая', patron: 'crows', cost: 4, type: 'action', copies: 2, play: [coin(1)], combo: { 2: [coin(2), power(2)], 3: [power(2)] }, art: 'crow', seed: 22 },
  { id: 'crows_plunder', name: 'Разорение', patron: 'crows', cost: 6, type: 'action', copies: 1, play: [draw(1)], combo: { 2: [draw(1)], 4: [draw(1)] }, art: 'chest', seed: 23 },
  { id: 'crows_toll_silver', name: 'Пошлина серебром', patron: 'crows', cost: 4, type: 'action', copies: 2, play: [coin(2)], combo: { 2: [draw(1)], 3: [coin(1)] }, art: 'coins', seed: 24 },

  // ── Крыса (Hlaalu): монеты и бесплатные приобретения ─
  { id: 'hlaalu_starter', name: 'Пепельная поставка', patron: 'hlaalu', cost: 0, type: 'starter', copies: 0, play: [coin(1)], art: 'chest', seed: 31 },
  { id: 'hlaalu_exports', name: 'Траурный караван', patron: 'hlaalu', cost: 2, type: 'action', copies: 3, play: [coin(3)], art: 'ship', seed: 36 },
  { id: 'hlaalu_mine', name: 'Пепельная шахта', patron: 'hlaalu', cost: 3, type: 'contractAction', copies: 1, play: [coin(2)], combo: { 3: [coin(3)] }, art: 'gate', seed: 38 },
  { id: 'hlaalu_seizure', name: 'Конфискация', patron: 'hlaalu', cost: 4, type: 'action', copies: 3, play: [acquire(6)], art: 'key', seed: 34 },
  { id: 'hlaalu_takeover', name: 'Поглощение долга', patron: 'hlaalu', cost: 5, type: 'action', copies: 2, play: [power(1)], combo: { 2: [acquire(7)] }, art: 'book', seed: 32 },
  { id: 'hlaalu_hireling', name: 'Наёмный писарь', patron: 'hlaalu', cost: 6, type: 'agent', hp: 2, copies: 1, play: [coin(2)], combo: { 2: [acquire(5)] }, art: 'merchant', seed: 33 },
  { id: 'hlaalu_exchange', name: 'Весы ростовщицы', patron: 'hlaalu', cost: 7, type: 'action', copies: 2, play: [replaceTavern(1), coin(5)], combo: { 2: [patronCall(1)] }, art: 'scales', seed: 35 },
  { id: 'hlaalu_market', name: 'Аукцион костей', patron: 'hlaalu', cost: 8, type: 'action', copies: 1, play: [coin(6)], combo: { 2: [acquire(7)] }, art: 'bones', seed: 39 },
  { id: 'hlaalu_kinsman', name: 'Маклер душ', patron: 'hlaalu', cost: 10, type: 'agent', hp: 1, copies: 1, play: [acquire(9)], combo: { 2: [replaceTavern(1)] }, art: 'mask', seed: 37 },
  // Улучшения
  { id: 'hlaalu_obsidian', name: 'Обсидиановая шахта', patron: 'hlaalu', cost: 3, type: 'contractAction', copies: 2, play: [coin(2)], combo: { 3: [coin(4)] }, art: 'gem', seed: 40 },
  { id: 'hlaalu_councilor', name: 'Ростовщик душ', patron: 'hlaalu', cost: 10, type: 'agent', hp: 2, copies: 1, play: [acquire(9)], combo: { 2: [replaceTavern(1)] }, art: 'crown', seed: 41 },
  { id: 'hlaalu_embassy', name: 'Посольство мёртвых', patron: 'hlaalu', cost: 8, type: 'action', copies: 1, play: [coin(7)], combo: { 2: [acquire(7)] }, art: 'castle', seed: 42 },
  { id: 'hlaalu_oathman', name: 'Присягнувший счетовод', patron: 'hlaalu', cost: 6, type: 'agent', hp: 2, copies: 2, play: [coin(2)], combo: { 2: [acquire(6)] }, art: 'scales', seed: 43 },

  // ── Волк (Saint Pelin): сила и агенты с провокацией ──────
  { id: 'pelin_starter', name: 'Клятва стража', patron: 'pelin', cost: 0, type: 'starter', copies: 0, play: [power(1)], art: 'shield', seed: 51 },
  { id: 'pelin_portcullis', name: 'Ржавая решётка', patron: 'pelin', cost: 2, type: 'action', copies: 3, play: [power(2)], combo: { 2: [coin(1)] }, art: 'gate', seed: 54 },
  { id: 'pelin_reinforce', name: 'Подкрепление из склепа', patron: 'pelin', cost: 3, type: 'action', copies: 1, play: [coin(2)], combo: { 2: [power(2)], 3: [power(1)] }, art: 'ghost', seed: 52 },
  { id: 'pelin_volley', name: 'Залп костяных лучников', patron: 'pelin', cost: 4, type: 'action', copies: 2, play: [power(3)], combo: { 2: [coin(1)] }, art: 'bow', seed: 53 },
  { id: 'pelin_armory', name: 'Костяной арсенал', patron: 'pelin', cost: 6, type: 'action', copies: 2, play: [power(5)], combo: { 2: [coin(1)] }, art: 'hammer', seed: 56 },
  { id: 'pelin_bearer', name: 'Щитоносец-призрак', patron: 'pelin', cost: 6, type: 'contractAgent', hp: 5, taunt: true, copies: 2, play: [power(1)], art: 'knight', seed: 58 },
  { id: 'pelin_sentries', name: 'Могильная стража', patron: 'pelin', cost: 7, type: 'agent', hp: 4, taunt: true, copies: 1, play: [coin(1)], art: 'priest', seed: 57 },
  { id: 'pelin_rally', name: 'Сбор павших', patron: 'pelin', cost: 8, type: 'action', copies: 2, play: [power(6)], combo: { 2: [draw(1)] }, art: 'grave', seed: 59 },
  { id: 'pelin_banneret', name: 'Знаменосец мёртвых', patron: 'pelin', cost: 9, type: 'agent', hp: 5, taunt: true, copies: 1, play: [power(3)], art: 'banner', seed: 55 },
  // Улучшения
  { id: 'pelin_commander', name: 'Командор мёртвых', patron: 'pelin', cost: 9, type: 'agent', hp: 5, taunt: true, copies: 1, play: [power(3)], combo: { 2: [heal(2)] }, art: 'banner', seed: 60 },
  { id: 'pelin_knights', name: 'Рыцари склепа', patron: 'pelin', cost: 7, type: 'agent', hp: 4, taunt: true, copies: 1, play: [coin(1)], combo: { 2: [power(1)] }, art: 'shield', seed: 61 },
  { id: 'pelin_legion', name: 'Мёртвый легион', patron: 'pelin', cost: 3, type: 'action', copies: 2, play: [coin(2)], combo: { 2: [power(3)] }, art: 'ghost', seed: 62 },
  { id: 'pelin_siege', name: 'Залп осадных машин', patron: 'pelin', cost: 4, type: 'action', copies: 2, play: [power(4)], combo: { 2: [coin(1)] }, art: 'castle', seed: 63 },

  // ── Сова (Psijic): просмотр колоды и сброс лишнего ──────
  { id: 'psijic_starter', name: 'Прозрение', patron: 'psijic', cost: 0, type: 'starter', copies: 0, play: [coin(1)], art: 'eye', seed: 71 },
  { id: 'psijic_globe', name: 'Шар прорицания', patron: 'psijic', cost: 2, type: 'action', copies: 4, play: [coin(2), toss(2)], art: 'gem', seed: 72 },
  { id: 'psijic_counsel', name: 'Совет мудреца', patron: 'psijic', cost: 3, type: 'contractAction', copies: 1, play: [toss(3)], combo: { 2: [power(1)] }, art: 'book', seed: 77 },
  { id: 'psijic_mastery', name: 'Власть над временем', patron: 'psijic', cost: 3, type: 'action', copies: 3, play: [toss(5)], combo: { 2: [coin(2)] }, art: 'tower', seed: 75 },
  { id: 'psijic_prescience', name: 'Предвидение', patron: 'psijic', cost: 4, type: 'action', copies: 1, play: [coin(3), replaceTavern(1)], art: 'eye', seed: 73 },
  { id: 'psijic_insight', name: 'Слепое озарение', patron: 'psijic', cost: 5, type: 'action', copies: 1, play: [coin(2), toss(4)], combo: { 2: [power(2)] }, art: 'moon', seed: 76 },
  { id: 'psijic_apprentice', name: 'Безглазый послушник', patron: 'psijic', cost: 6, type: 'agent', hp: 3, copies: 1, play: [toss(4)], art: 'hooded', seed: 74 },
  { id: 'psijic_cave', name: 'Пещера снов', patron: 'psijic', cost: 6, type: 'action', copies: 3, play: [draw(1), toss(4)], combo: { 2: [power(2)] }, art: 'portal', seed: 79 },
  // Улучшения
  { id: 'psijic_augur', name: 'Совет авгура', patron: 'psijic', cost: 3, type: 'contractAction', copies: 2, play: [toss(3)], combo: { 2: [power(2)] }, art: 'book', seed: 80 },
  { id: 'psijic_seer', name: 'Озарение провидицы', patron: 'psijic', cost: 5, type: 'action', copies: 1, play: [coin(2), toss(4)], combo: { 2: [power(3)] }, art: 'moon', seed: 81 },
  { id: 'psijic_prophecy', name: 'Пророчество', patron: 'psijic', cost: 4, type: 'action', copies: 2, play: [coin(3), replaceTavern(2)], art: 'eye', seed: 82 },
  { id: 'psijic_relicmaster', name: 'Хранитель реликвий', patron: 'psijic', cost: 6, type: 'agent', hp: 3, copies: 1, play: [coin(1), toss(4)], art: 'hooded', seed: 83 },

  // ── Кот (Rajhin): сброс, потеря престижа, нокаут ──────────
  { id: 'rajhin_starter', name: 'Ловкие пальцы', patron: 'rajhin', cost: 0, type: 'starter', copies: 0, play: [coin(1)], art: 'hand', seed: 91 },
  { id: 'rajhin_sleight', name: 'Ловкость рук', patron: 'rajhin', cost: 2, type: 'action', copies: 3, play: [coin(2)], combo: { 2: [replaceTavern(1)] }, art: 'key', seed: 92 },
  { id: 'rajhin_illusion', name: 'Лунный морок', patron: 'rajhin', cost: 3, type: 'contractAction', copies: 3, play: [destroy(1)], combo: { 3: [oppLose(1)] }, art: 'moon', seed: 96 },
  { id: 'rajhin_jeering', name: 'Глумливая тень', patron: 'rajhin', cost: 4, type: 'agent', hp: 2, copies: 1, play: [coin(1)], combo: { 2: [oppLose(1)] }, art: 'mask', seed: 94 },
  { id: 'rajhin_pounce', name: 'Прыжок и нажива', patron: 'rajhin', cost: 5, type: 'action', copies: 1, play: [coin(4)], combo: { 2: [knockout(1)] }, art: 'cat', seed: 97 },
  { id: 'rajhin_stubborn', name: 'Упрямая тень', patron: 'rajhin', cost: 6, type: 'agent', hp: 3, taunt: true, copies: 3, play: [], combo: { 2: [oppLose(2)] }, art: 'spider', seed: 98 },
  { id: 'rajhin_tricks', name: 'Мешок фокусов', patron: 'rajhin', cost: 7, type: 'contractAction', copies: 1, play: [oppDiscard(1)], combo: { 2: [draw(1)], 3: [oppDiscard(1)] }, art: 'chest', seed: 93 },
  { id: 'rajhin_lullaby', name: 'Скрипучая колыбельная', patron: 'rajhin', cost: 7, type: 'action', copies: 1, play: [knockout(2), coin(2)], combo: { 2: [coin(2)], 3: [oppDiscard(1)] }, art: 'lantern', seed: 95 },
  { id: 'rajhin_revelry', name: 'Сумеречный кутёж', patron: 'rajhin', cost: 10, type: 'action', copies: 1, play: [oppDiscard(1)], combo: { 2: [replaceTavern(3)], 3: [oppLose(3)], 4: [draw(3)] }, art: 'chalice', seed: 99 },
  // Улучшения
  { id: 'rajhin_larceny', name: 'Великая кража', patron: 'rajhin', cost: 5, type: 'action', copies: 2, play: [coin(4)], combo: { 2: [knockout(1), oppLose(1)] }, art: 'cat', seed: 100 },
  { id: 'rajhin_prowling', name: 'Крадущаяся тень', patron: 'rajhin', cost: 4, type: 'agent', hp: 2, copies: 2, play: [coin(2)], combo: { 2: [oppLose(1)] }, art: 'mask', seed: 101 },
  { id: 'rajhin_guile', name: 'Воровское коварство', patron: 'rajhin', cost: 7, type: 'contractAction', copies: 1, play: [oppDiscard(1)], combo: { 2: [draw(1)], 3: [oppDiscard(1), draw(1)] }, art: 'key', seed: 102 },
  { id: 'rajhin_slumber', name: 'Сон теней', patron: 'rajhin', cost: 7, type: 'action', copies: 1, play: [knockout(2), coin(2)], combo: { 2: [coin(3)], 3: [oppDiscard(1)] }, art: 'lantern', seed: 103 },

  // ── Орёл (Red Eagle): чистка колоды и сила ───────────
  { id: 'eagle_starter', name: 'Клич пустоши', patron: 'eagle', cost: 0, type: 'starter', copies: 0, play: [power(1)], art: 'eagle', seed: 111 },
  { id: 'eagle_bonfire', name: 'Погребальный костёр', patron: 'eagle', cost: 3, type: 'contractAction', copies: 3, play: [destroy(1)], art: 'flame', seed: 112 },
  { id: 'eagle_spoils', name: 'Трофеи набега', patron: 'eagle', cost: 3, type: 'contractAction', copies: 1, play: [replaceTavern(2)], combo: { 2: [coin(1)] }, art: 'coins', seed: 113 },
  { id: 'eagle_raid', name: 'Полночный набег', patron: 'eagle', cost: 4, type: 'action', copies: 3, play: [power(3)], combo: { 2: [power(2)] }, art: 'wolf', seed: 114 },
  { id: 'eagle_ritual', name: 'Ритуал терновых сердец', patron: 'eagle', cost: 5, type: 'contractAction', copies: 2, play: [power(1), destroy(2)], art: 'heart', seed: 115 },
  { id: 'eagle_hunter', name: 'Ловчий людей', patron: 'eagle', cost: 5, type: 'contractAgent', hp: 2, copies: 2, play: [power(1)], combo: { 2: [destroy(1)] }, art: 'axe', seed: 116 },
  { id: 'eagle_offering', name: 'Кровавое подношение', patron: 'eagle', cost: 6, type: 'contractAction', copies: 1, play: [destroy(1), power(2)], combo: { 2: [draw(1)] }, art: 'altar', seed: 117 },
  { id: 'eagle_witch', name: 'Ведьма клана', patron: 'eagle', cost: 6, type: 'contractAgent', hp: 4, copies: 1, play: [destroy(1)], art: 'cauldron', seed: 118 },
  { id: 'eagle_hagraven', name: 'Карга-ворожея', patron: 'eagle', cost: 9, type: 'agent', hp: 4, copies: 1, play: [destroy(1)], combo: { 2: [power(1)] }, art: 'beast', seed: 119 },
  // Улучшения
  { id: 'eagle_sacrifice', name: 'Кровавая жертва', patron: 'eagle', cost: 6, type: 'contractAction', copies: 1, play: [destroy(1), power(3)], combo: { 2: [draw(1)] }, art: 'altar', seed: 120 },
  { id: 'eagle_elder', name: 'Старшая ведьма', patron: 'eagle', cost: 6, type: 'contractAgent', hp: 4, copies: 2, play: [destroy(1)], combo: { 2: [replaceTavern(1)] }, art: 'cauldron', seed: 121 },
  { id: 'eagle_matron', name: 'Карга-праматерь', patron: 'eagle', cost: 9, type: 'agent', hp: 4, copies: 1, play: [destroy(1)], combo: { 2: [power(3)] }, art: 'beast', seed: 122 },
  { id: 'eagle_plunder', name: 'Награбленное золото', patron: 'eagle', cost: 3, type: 'contractAction', copies: 2, play: [replaceTavern(2)], combo: { 2: [coin(2)] }, art: 'coins', seed: 123 },

  // ── Паук (Almalexia): сброс ради выгоды, заточение карт соперника ──
  { id: 'alma_plate', name: 'Чаша для подаяний', patron: 'alma', cost: 0, type: 'starter', copies: 0, play: [coin(1)], combo: { 3: [donate(1)] }, art: 'chalice', seed: 151 },
  { id: 'alma_veneration', name: 'Хвалебный плач', patron: 'alma', cost: 3, type: 'action', copies: 1, play: [coin(2), donate(1)], combo: { 2: [donate(1)] }, art: 'candle', seed: 152 },
  { id: 'alma_gaoler', name: 'Набожный тюремщик', patron: 'alma', cost: 6, type: 'contractAgent', hp: 3, copies: 1, play: [power(1)], combo: { 2: [confine(1)], 3: [confine(1)] }, art: 'chain', seed: 153 },
  { id: 'alma_mercy', name: 'Милость Матери', patron: 'alma', cost: 5, type: 'action', copies: 1, play: [power(1), refresh(1)], art: 'heart', seed: 154 },
  {
    id: 'alma_clergy', name: 'Причт скорбного храма', patron: 'alma', cost: 5, type: 'contractAgent', hp: 3, copies: 2, play: [],
    trigger: { on: 'discard', fx: [prestige(2)] }, combo: { 2: [donate(1), confine(1)] }, art: 'priest', seed: 155,
  },
  {
    id: 'alma_alms', name: 'Щедрая милостыня', patron: 'alma', cost: 3, type: 'action', copies: 3, play: [coin(1)],
    trigger: { on: 'discard', fx: [power(1)] }, combo: { 2: [donate(1)], 3: [donate(1)] }, art: 'coins', seed: 156,
  },
  { id: 'alma_arbiter', name: 'Храмовый судья', patron: 'alma', cost: 6, type: 'agent', hp: 2, copies: 2, play: [coin(2)], combo: { 2: [confine(1)], 3: [confine(1)] }, art: 'hooded', seed: 157 },
  { id: 'alma_lesson', name: 'Урок Скорбящей', patron: 'alma', cost: 4, type: 'action', copies: 3, play: [donate(1)], combo: { 2: [draw(1)], 3: [donate(1)] }, art: 'book', seed: 158 },
  { id: 'alma_sentinel', name: 'Страж трибунала', patron: 'alma', cost: 8, type: 'agent', hp: 5, taunt: true, copies: 1, play: [], combo: { 2: [patronCall(1)] }, art: 'knight', seed: 159 },
  // Улучшения
  { id: 'alma_charity', name: 'Милосердие Трёх', patron: 'alma', cost: 5, type: 'action', copies: 1, play: [power(1), refresh(1)], combo: { 2: [coin(1)] }, art: 'heart', seed: 160 },
  { id: 'alma_festival', name: 'Праздник смирения', patron: 'alma', cost: 3, type: 'action', copies: 2, play: [coin(2), donate(1)], combo: { 2: [power(1), donate(1)] }, art: 'candle', seed: 161 },
  { id: 'alma_hand', name: 'Длань Скорбящей', patron: 'alma', cost: 6, type: 'contractAgent', hp: 3, copies: 2, play: [power(1)], combo: { 2: [confine(2)] }, art: 'hand', seed: 162 },
  { id: 'alma_elite', name: 'Гвардия Милосердной', patron: 'alma', cost: 8, type: 'agent', hp: 5, taunt: true, copies: 1, play: [coin(1)], combo: { 2: [patronCall(1)] }, art: 'knight', seed: 163 },

  // ── Богомол (Ansei Frandar Hunding): каждый раз выбор ──
  { id: 'hunding_way', name: 'Путь клинка', patron: 'hunding', cost: 0, type: 'starter', copies: 0, play: [pick([coin(1)], [power(1)])], art: 'sword', seed: 171 },
  { id: 'hunding_assault', name: 'Натиск мастера клинка', patron: 'hunding', cost: 9, type: 'action', copies: 1, play: [pick([power(5)], [acquire(9)])], art: 'axe', seed: 172 },
  { id: 'hunding_meditation', name: 'Боевое созерцание', patron: 'hunding', cost: 3, type: 'contractAction', copies: 1, play: [pick([power(2)], [refresh(1)])], art: 'candle', seed: 173 },
  { id: 'hunding_conquest', name: 'Завоевание', patron: 'hunding', cost: 4, type: 'action', copies: 3, play: [pick([power(3)], [acquire(4)])], combo: { 2: [power(2)] }, art: 'banner', seed: 174 },
  { id: 'hunding_march', name: 'Поход на крепость', patron: 'hunding', cost: 6, type: 'action', copies: 1, play: [pick([power(4)], [refresh(3)])], combo: { 2: [power(2)] }, art: 'castle', seed: 175 },
  { id: 'hunding_poet', name: 'Певец клинков', patron: 'hunding', cost: 6, type: 'agent', hp: 3, copies: 1, play: [refresh(1)], combo: { 2: [power(1)] }, art: 'hooded', seed: 176 },
  { id: 'hunding_summoning', name: 'Призыв духовного клинка', patron: 'hunding', cost: 5, type: 'action', copies: 3, play: [pick([refresh(2)], [acquire(5)])], combo: { 2: [refresh(1)] }, art: 'rune', seed: 177 },
  { id: 'hunding_wave', name: 'Волна воинов', patron: 'hunding', cost: 4, type: 'action', copies: 3, play: [pick([power(3)], [coin(3)])], art: 'shield', seed: 178 },
  // Улучшения
  { id: 'hunding_victory', name: 'Победа мастера клинка', patron: 'hunding', cost: 9, type: 'action', copies: 1, play: [pick([power(6)], [acquire(10)])], art: 'sword', seed: 180 },
  { id: 'hunding_oratory', name: 'Великая речь', patron: 'hunding', cost: 3, type: 'contractAction', copies: 2, play: [pick([power(2)], [refresh(1)])], combo: { 2: [coin(2)] }, art: 'scroll', seed: 181 },
  { id: 'hunding_herald', name: 'Вестник клинков', patron: 'hunding', cost: 6, type: 'agent', hp: 3, copies: 2, play: [refresh(2)], combo: { 2: [power(1)] }, art: 'banner', seed: 182 },
  { id: 'hunding_fall', name: 'Падение крепости', patron: 'hunding', cost: 6, type: 'action', copies: 2, play: [pick([power(4)], [refresh(3)])], combo: { 2: [power(2)] }, art: 'castle', seed: 183 },

  // ── Олень (Druid King): карты, уходящие в сброс, кормят агентов ──
  { id: 'druid_herbs', name: 'Обрядовые травы', patron: 'druid', cost: 0, type: 'starter', copies: 0, play: [coin(1)], art: 'potion', seed: 191 },
  { id: 'druid_ritual', name: 'Обряд глухой чащи', patron: 'druid', cost: 4, type: 'action', copies: 2, play: [power(2)], combo: { 2: [replaceTavern(1)], 3: [prestige(3)] }, art: 'altar', seed: 192 },
  {
    id: 'druid_fenwitch', name: 'Болотная ведьма', patron: 'druid', cost: 6, type: 'agent', hp: 3, copies: 1, play: [],
    trigger: { on: 'toCooldown', fx: [coin(1)], self: true }, combo: { 2: [create('druid_totem')] }, art: 'cauldron', seed: 193,
  },
  {
    id: 'druid_haruspex', name: 'Гадатель по огню', patron: 'druid', cost: 5, type: 'agent', hp: 1, copies: 3, play: [prestige(1), coin(1)],
    trigger: { on: 'agentToCooldown', fx: [prestige(1)] }, art: 'flame', seed: 194,
  },
  {
    id: 'druid_wraith', name: 'Лесной призрак', patron: 'druid', cost: 4, type: 'contractAgent', hp: 3, copies: 2, play: [power(1)],
    trigger: { on: 'toCooldown', fx: [power(1)] }, art: 'ghost', seed: 195,
  },
  {
    id: 'druid_runes', name: 'Руны друидов', patron: 'druid', cost: 2, type: 'action', copies: 1, play: [coin(2)],
    trigger: { on: 'agentToCooldown', fx: [power(1)] }, art: 'rune', seed: 196,
  },
  {
    id: 'druid_rockseer', name: 'Камневидец', patron: 'druid', cost: 5, type: 'agent', hp: 2, copies: 1, play: [power(1)],
    trigger: { on: 'agentPlay', fx: [coin(1)] }, art: 'gem', seed: 197,
  },
  { id: 'druid_whispers', name: 'Шёпот рощи', patron: 'druid', cost: 2, type: 'contractAction', copies: 2, play: [replaceTavern(1)], combo: { 3: [coin(2)] }, art: 'feather', seed: 198 },
  { id: 'druid_totem', name: 'Тотем блуждающих огней', patron: 'druid', cost: 3, type: 'action', copies: 1, play: [coin(1)], combo: { 2: [coin(2)], 4: [coin(2)] }, art: 'lantern', seed: 199 },
  // Улучшения
  {
    id: 'druid_ritecaller', name: 'Хранительница обрядов', patron: 'druid', cost: 6, type: 'agent', hp: 3, copies: 1, play: [],
    trigger: { on: 'toCooldown', fx: [coin(1)], self: true }, combo: { 2: [create('druid_hearttotem')] }, art: 'priest', seed: 201,
  },
  {
    id: 'druid_vestments', name: 'Облачение короля-друида', patron: 'druid', cost: 2, type: 'action', copies: 2, play: [coin(2)],
    trigger: { on: 'toCooldown', fx: [power(1)] }, art: 'crown', seed: 202,
  },
  {
    id: 'druid_envoy', name: 'Посланник рощи', patron: 'druid', cost: 5, type: 'agent', hp: 3, copies: 2, play: [power(1)],
    trigger: { on: 'agentPlay', fx: [coin(1)] }, art: 'hooded', seed: 203,
  },
  { id: 'druid_hearttotem', name: 'Тотем сердца огней', patron: 'druid', cost: 3, type: 'action', copies: 2, play: [coin(1)], combo: { 2: [coin(2)], 3: [coin(2)], 4: [coin(3)] }, art: 'lantern', seed: 204 },
  // Not in the tavern: the Druid patron hands it out on a long combo.
  { id: 'druid_chimera', name: 'Химера', patron: 'druid', cost: 0, type: 'agent', hp: 5, taunt: true, copies: 0, play: [], combo: { 2: [replaceTavern(1)], 3: [power(2)], 4: [prestige(3)] }, art: 'beast', seed: 200 },

  // ── Спрут (Hermaeus Mora): сильные карты, но сопернику тоже перепадает ──
  { id: 'mora_glyph', name: 'Сорванная печать', patron: 'mora', cost: 0, type: 'starter', copies: 0, play: [power(1)], combo: { 3: [coin(1)] }, art: 'scroll', seed: 211 },
  { id: 'mora_pact', name: 'Запретный договор', patron: 'mora', cost: 4, type: 'action', copies: 1, play: [power(2), coin(1), setback('coin', 2)], combo: { 2: [power(2)], 3: [power(1)] }, art: 'scroll', seed: 212 },
  { id: 'mora_bargain', name: 'Сделка за знание', patron: 'mora', cost: 4, type: 'contractAction', copies: 1, play: [power(5), setback('draw', 1)], combo: { 2: [coin(1)], 3: [coin(2)] }, art: 'hand', seed: 213 },
  { id: 'mora_cipher', name: 'Шифр Ока', patron: 'mora', cost: 5, type: 'contractAgent', hp: 2, copies: 1, play: [destroy(1), setback('coin', 3)], combo: { 2: [power(2)] }, art: 'eye', seed: 214 },
  { id: 'mora_aura', name: 'Гнетущая аура', patron: 'mora', cost: 6, type: 'action', copies: 1, play: [power(4), setback('draw', 1)], combo: { 2: [power(2)], 3: [power(2)], 4: [power(3)] }, art: 'tentacle', seed: 215 },
  { id: 'mora_ink', name: 'Чернила и кровь', patron: 'mora', cost: 2, type: 'action', copies: 3, play: [coin(2), setback('power', 1)], combo: { 2: [power(2), coin(1)] }, art: 'potion', seed: 216 },
  { id: 'mora_threads', name: 'Нити судьбы', patron: 'mora', cost: 2, type: 'contractAction', copies: 3, play: [power(2), setback('coin', 1)], combo: { 2: [power(1)], 3: [coin(1)] }, art: 'spider', seed: 217 },
  { id: 'mora_tome', name: 'Прожорливый фолиант', patron: 'mora', cost: 3, type: 'action', copies: 3, play: [destroy(2), setback('draw', 1)], combo: { 2: [power(3)] }, art: 'book', seed: 218 },
  // Улучшения
  { id: 'mora_reservoir', name: 'Радужный источник', patron: 'mora', cost: 6, type: 'action', copies: 1, play: [power(4), setback('draw', 1)], combo: { 2: [power(2)], 3: [power(2)], 4: [power(4)] }, art: 'potion', seed: 220 },
  { id: 'mora_lantern', name: 'Фонарь бесконечности', patron: 'mora', cost: 4, type: 'action', copies: 3, play: [power(2), coin(1), setback('coin', 2)], combo: { 2: [power(2)], 3: [power(2)] }, art: 'lantern', seed: 221 },
  { id: 'mora_seeker', name: 'Ищущий тайн', patron: 'mora', cost: 5, type: 'contractAgent', hp: 2, copies: 1, play: [destroy(1), setback('coin', 3)], combo: { 2: [power(3)] }, art: 'hooded', seed: 222 },
  { id: 'mora_secrets', name: 'Непостижимые тайны', patron: 'mora', cost: 4, type: 'agent', hp: 5, copies: 2, play: [power(5), setback('draw', 1)], combo: { 2: [coin(2)], 3: [coin(2)] }, art: 'tentacle', seed: 223 },

  // ── Бык (Saint Alessia): дешёвые агенты и сражение чужих ──
  { id: 'alessia_rebel', name: 'Мятежник', patron: 'alessia', cost: 0, type: 'agent', hp: 1, copies: 0, starter: true, play: [], combo: { 2: [coin(1)] }, art: 'assassin', seed: 231 },
  { id: 'alessia_defector', name: 'Перебежчик из белой башни', patron: 'alessia', cost: 5, type: 'contractAgent', hp: 1, copies: 1, play: [pick([draw(1)], [knockoutAll])], combo: { 3: [prestige(1)] }, art: 'tower', seed: 232 },
  { id: 'alessia_sergeant', name: 'Сержант Разбитых Цепей', patron: 'alessia', cost: 4, type: 'agent', hp: 1, copies: 1, play: [pick([coin(3)], [power(2)])], art: 'chain', seed: 233 },
  {
    id: 'alessia_archer', name: 'Рогатый лучник', patron: 'alessia', cost: 5, type: 'agent', hp: 1, copies: 1, play: [knockout(1)],
    trigger: { on: 'knockout', fx: [coin(1)] }, combo: { 3: [prestige(2)] }, art: 'bow', seed: 234,
  },
  { id: 'alessia_paladin', name: 'Безумный паладин', patron: 'alessia', cost: 7, type: 'agent', hp: 2, copies: 1, play: [pick([knockout(2)], [refresh(4, true)])], combo: { 3: [prestige(3)] }, art: 'knight', seed: 235 },
  { id: 'alessia_priestess', name: 'Жрица Восьми', patron: 'alessia', cost: 5, type: 'agent', hp: 1, copies: 3, play: [pick([replaceTavern(1)], [donate(2)])], combo: { 2: [prestige(1)] }, art: 'priest', seed: 236 },
  { id: 'alessia_wrath', name: 'Гнев святой', patron: 'alessia', cost: 4, type: 'action', copies: 3, play: [pick([knockoutAll], [refresh(3)])], art: 'sword', seed: 237 },
  { id: 'alessia_soldier', name: 'Солдат восстания', patron: 'alessia', cost: 3, type: 'agent', hp: 1, copies: 3, play: [pick([coin(2)], [power(1)])], art: 'shield', seed: 238 },
  // Улучшения
  { id: 'alessia_quartermaster', name: 'Интендант белой башни', patron: 'alessia', cost: 5, type: 'contractAgent', hp: 1, copies: 2, play: [pick([draw(1)], [knockoutAll])], combo: { 3: [prestige(2)] }, art: 'tower', seed: 240 },
  { id: 'alessia_captain', name: 'Капитан Разбитых Цепей', patron: 'alessia', cost: 4, type: 'agent', hp: 1, copies: 2, play: [pick([coin(3)], [power(2)])], combo: { 3: [prestige(1)] }, art: 'chain', seed: 241 },
  {
    id: 'alessia_bull', name: 'Священный бык', patron: 'alessia', cost: 5, type: 'agent', hp: 1, copies: 2, play: [knockout(1)],
    trigger: { on: 'knockout', fx: [coin(1)] }, combo: { 3: [prestige(3)] }, art: 'beast', seed: 242,
  },
  { id: 'alessia_ascendant', name: 'Вознёсшийся паладин', patron: 'alessia', cost: 7, type: 'agent', hp: 2, copies: 1, play: [pick([knockout(2)], [refresh(4, true)])], combo: { 3: [prestige(4)] }, art: 'knight', seed: 243 },

  // ── Змей (Sorcerer-King Orgnum): дешёвые набеги за престиж ──
  { id: 'orgnum_raid', name: 'Морской набег', patron: 'orgnum', cost: 0, type: 'starter', copies: 0, play: [coin(1)], combo: { 3: [power(1)] }, art: 'ship', seed: 251 },
  { id: 'orgnum_serpent', name: 'Призрачный змей', patron: 'orgnum', cost: 2, type: 'action', copies: 1, play: [coin(1), prestige(1)], combo: { 2: [power(1)] }, art: 'serpent', seed: 252 },
  { id: 'orgnum_command', name: 'Приказ Колдуна', patron: 'orgnum', cost: 2, type: 'contractAction', copies: 2, play: [patronCall(1)], art: 'crown', seed: 253 },
  { id: 'orgnum_boarding', name: 'Абордажная команда', patron: 'orgnum', cost: 2, type: 'action', copies: 1, play: [prestige(1)], combo: { 2: [prestige(1)] }, art: 'dagger', seed: 254 },
  { id: 'orgnum_cutter', name: 'Быстрый катер', patron: 'orgnum', cost: 2, type: 'contractAction', copies: 2, play: [power(1)], combo: { 2: [power(1)], 3: [power(2)] }, art: 'ship', seed: 255 },
  { id: 'orgnum_glory', name: 'Слава налётчиков', patron: 'orgnum', cost: 2, type: 'contractAction', copies: 2, play: [prestige(1)], combo: { 3: [prestige(3)] }, art: 'chalice', seed: 256 },
  { id: 'orgnum_schooner', name: 'Шхуна со змеиным носом', patron: 'orgnum', cost: 3, type: 'action', copies: 1, play: [power(2)], combo: { 3: [power(2)] }, art: 'ship', seed: 257 },
  { id: 'orgnum_wavecaller', name: 'Заклинатель штормовых акул', patron: 'orgnum', cost: 5, type: 'agent', hp: 2, copies: 1, play: [power(2)], combo: { 2: [replaceTavern(1)] }, art: 'mage', seed: 258 },
  { id: 'orgnum_freebooter', name: 'Флибустьер в змеиной коже', patron: 'orgnum', cost: 5, type: 'agent', hp: 3, copies: 2, play: [coin(1)], combo: { 2: [create('orgnum_boarding')] }, art: 'assassin', seed: 259 },
  // Улучшения
  { id: 'orgnum_fleet', name: 'Флот Колдуна', patron: 'orgnum', cost: 3, type: 'action', copies: 2, play: [power(2)], combo: { 3: [power(3)] }, art: 'ship', seed: 261 },
  { id: 'orgnum_colossus', name: 'Морской колосс', patron: 'orgnum', cost: 2, type: 'action', copies: 2, play: [coin(1), prestige(1)], combo: { 2: [power(2)] }, art: 'serpent', seed: 262 },
  { id: 'orgnum_rider', name: 'Наездник морского змея', patron: 'orgnum', cost: 5, type: 'agent', hp: 2, copies: 2, play: [power(2)], combo: { 2: [replaceTavern(1), power(1)] }, art: 'mage', seed: 263 },
  // An upgrade in the tavern; the Orgnum patron also hands it out when it favors you.
  { id: 'orgnum_sacking', name: 'Разграбление острова', patron: 'orgnum', cost: 2, type: 'action', copies: 2, play: [prestige(1)], combo: { 2: [prestige(1)], 3: [coin(1)] }, art: 'castle', seed: 260 },
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
