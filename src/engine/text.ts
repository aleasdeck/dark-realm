import { CARD_MAP } from './cards';
import type { CardDef, Effect, PatronId, TriggerOn } from './types';

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const cards = (n: number) => `${n} ${plural(n, 'карту', 'карты', 'карт')}`;

export function effectText(e: Effect): string {
  switch (e.k) {
    case 'coin':
      return `+${e.n} ${plural(e.n, 'монета', 'монеты', 'монет')}`;
    case 'power':
      return `+${e.n} силы`;
    case 'prestige':
      return `+${e.n} престижа`;
    case 'oppLosePrestige':
      return `Соперник теряет ${e.n} престижа`;
    case 'draw':
      return `Взять ${cards(e.n)}`;
    case 'oppDiscard':
      return `Соперник сбрасывает ${cards(e.n)}`;
    case 'acquire':
      return `Получить карту из таверны ценой до ${e.n}`;
    case 'toss':
      return `Просмотреть ${e.n} верхн. карт колоды и сбросить любые`;
    case 'destroy':
      return `Уничтожить до ${cards(e.n)} в игре или в руке`;
    case 'knockout':
      return e.n === 1 ? 'Сразить агента соперника' : `Сразить до ${e.n} агентов соперника`;
    case 'knockoutAll':
      return 'Сразить всех агентов на столе, и своих, и соперника';
    case 'returnTop':
      if (e.agentsOnly) return `Вернуть ${e.n === 1 ? 'агента' : `до ${e.n} агентов`} из сброса наверх колоды`;
      return `Вернуть ${e.n === 1 ? 'карту' : `до ${cards(e.n)}`} из сброса наверх колоды`;
    case 'replaceTavern':
      return `Заменить до ${cards(e.n)} в таверне`;
    case 'heal':
      return `Исцелить своего агента на ${e.n}`;
    case 'create': {
      const name = CARD_MAP[e.card]?.name ?? e.card;
      const where = e.to === 'oppCooldown' ? 'в сброс соперника' : e.to === 'hand' ? 'в руку' : 'в свой сброс';
      return `Подложить «${name}»${e.n > 1 ? ` ×${e.n}` : ''} ${where}`;
    }
    case 'patronCall':
      return `+${e.n} призыв покровителя`;
    case 'donate':
      return `Сбросить до ${cards(e.n)} из руки и взять столько же`;
    case 'choice':
      return e.options.map((o) => o.map(effectText).join(', ')).join(' ИЛИ ');
    case 'confine':
      return `Заточить ${cards(e.n)} из сброса соперника под этим агентом`;
    case 'setback': {
      const what = e.res === 'coin' ? `+${e.n} ${plural(e.n, 'монету', 'монеты', 'монет')}` : e.res === 'power' ? `+${e.n} силы` : cards(e.n);
      return `Расплата: соперник в начале хода ${e.res === 'draw' ? 'берёт' : 'получает'} ${what}`;
    }
    case 'reprieve':
      return `Посмотреть ${e.n} верхн. карт колоды соперника и одну отправить в его сброс`;
    case 'bargain':
      return 'Взять любую карту таверны (не контракт), соперник получает такую же';
    case 'selfDiscard':
      return `Сбросить ${cards(e.n)} из руки`;
  }
}

const TRIGGER_TEXT: Record<TriggerOn, string> = {
  discard: 'Когда вы сбрасываете карту',
  toCooldown: 'Когда любая карта уходит в ваш сброс',
  agentToCooldown: 'Когда другой ваш агент уходит в сброс',
  agentPlay: 'Когда ваш агент разыгран или применён (и этот тоже)',
  knockout: 'Когда сражён любой другой агент',
};

export function effectsText(list: Effect[]): string {
  return list.map(effectText).join('. ');
}

export const TYPE_NAMES: Record<CardDef['type'], string> = {
  action: 'Действие',
  agent: 'Агент',
  contractAction: 'Контракт',
  contractAgent: 'Контракт-агент',
  starter: 'Начальная',
  curse: 'Проклятие',
};

export function cardLines(def: CardDef): { label: string; text: string }[] {
  const lines: { label: string; text: string }[] = [];
  if (def.play.length) lines.push({ label: def.type.includes('gent') ? 'Каждый ход' : '', text: effectsText(def.play) });
  else if (def.type === 'curse') lines.push({ label: '', text: 'Бесполезная карта. Её надо разыграть раньше остальных.' });
  if (def.trigger) {
    const when = TRIGGER_TEXT[def.trigger.on] + (def.trigger.self ? ', и эта тоже' : '');
    lines.push({ label: 'Пока в игре', text: `${when}: ${effectsText(def.trigger.fx).toLowerCase()}` });
  }
  for (const tier of [2, 3, 4] as const) {
    const c = def.combo?.[tier];
    if (c) lines.push({ label: `Комбо ${tier}`, text: effectsText(c) });
  }
  if (def.type === 'contractAction') lines.push({ label: '', text: 'Срабатывает сразу при покупке.' });
  if (def.type === 'contractAgent') lines.push({ label: '', text: 'Сразу выходит на поле. Сражённый, уходит из игры.' });
  return lines;
}

export const PATRON_RULES: Record<PatronId, { cost: string; effect: string }> = {
  treasury: { cost: '2 монеты', effect: 'Уничтожить карту в игре или в руке, положить в сброс «Долговую расписку» (+2 монеты).' },
  crows: { cost: 'все монеты (мин. 1)', effect: 'Получить силу = монеты − 1. Нельзя, если он уже благоволит вам.' },
  hlaalu: { cost: 'ваша карта ценой ≥ 1 в игре (сыгранная или агент)', effect: 'Пожертвовать её и получить престиж = цена − 1.' },
  pelin: { cost: '2 силы и агент в сбросе', effect: 'Вернуть агента из сброса наверх колоды.' },
  psijic: { cost: '4 монеты и агент у соперника', effect: 'Сразить агента соперника.' },
  rajhin: { cost: '3 монеты', effect: 'Подложить «Морок» в сброс соперника.' },
  eagle: { cost: '2 силы', effect: 'Взять карту.' },
  alma: {
    cost: 'благоволит: 1 монета и сброс карты; нейтральна: сброс карты; против вас: 1 монета',
    effect: 'Посмотреть 5 / 4 / 3 верхние карты колоды соперника и одну отправить в его сброс.',
  },
  hunding: { cost: '2 силы', effect: '+1 монета. Пока он благоволит вам, вы получаете +1 монету в начале каждого хода.' },
  druid: {
    cost: '2 силы',
    effect: 'Заменить до 2 карт в таверне. Пока благоволит, 4-я карта Друида за ход (5-я, пока нейтрален) приносит «Химеру».',
  },
  mora: { cost: '3 силы (2, если благоволит сопернику)', effect: 'Взять любую карту таверны (не контракт); соперник получает такую же.' },
  alessia: {
    cost: '4 монеты (3, если благоволит сопернику)',
    effect: 'Благоволит: «Сержант Разбитых Цепей» в сброс. Нейтральна: «Солдат восстания». Против вас: +2 силы.',
  },
  orgnum: {
    cost: '3 / 2 / 1 монета (благоволит / нейтрален / против вас)',
    effect: 'Сила за размер колоды: 1 за каждые 4 карты и «Разграбление острова» в сброс / 1 за каждые 6 карт / просто +2 силы.',
  },
};
