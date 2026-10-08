import { describe, expect, it } from 'vitest';
import { CARDS } from '../src/engine/cards';
import { cardLines, effectText, PATRON_RULES } from '../src/engine/text';
import { hyphenate, richText } from '../src/ui/rich';

describe('resource icons in effect texts', () => {
  it('writes amounts as a number and an icon', () => {
    expect(effectText({ k: 'coin', n: 1 })).toBe('+1 ●');
    expect(effectText({ k: 'power', n: 3 })).toBe('+3 ⚔');
    expect(effectText({ k: 'prestige', n: 2 })).toBe('+2 ✦');
    expect(effectText({ k: 'oppLosePrestige', n: 1 })).toBe('Соперник теряет 1 ✦');
    expect(effectText({ k: 'setback', res: 'coin', n: 2 })).toContain('+2 ●');
  });

  it('leaves no resource words in card and patron texts', () => {
    const texts = [
      ...CARDS.flatMap((c) => cardLines(c).map((l) => l.text)),
      ...Object.values(PATRON_RULES).flatMap((r) => [r.cost, r.effect]),
    ];
    for (const t of texts) expect(t).not.toMatch(/монет|сил[аыу]|престиж/i);
  });

  it('paints the amount and its icon in the resource color', () => {
    expect(richText('Взять карту, +2 ⚔ <b>')).toBe('Взять карту, <span class="ri pow">+2 <i>⚔</i></span> &lt;b&gt;');
    expect(richText('все ● (мин. 1)')).toBe('все <span class="ri coin"><i>●</i></span> (мин. 1)');
  });
});

describe('fake coin', () => {
  it('says only what it gives', () => {
    const def = CARDS.find((c) => c.id === 'fake_coin')!;
    expect(cardLines(def)).toEqual([{ label: '', text: '+1 ●' }]);
  });
});

describe('soft hyphens in card names', () => {
  const parts = (s: string) => hyphenate(s).split('\u00ad');

  it('breaks long words at syllables', () => {
    expect(parts('Конфискация')).toEqual(['Кон', 'фис', 'ка', 'ция']);
    expect(parts('Присягнувший')).toEqual(['При', 'сяг', 'нув', 'ший']);
    expect(parts('Мародёрство')).toEqual(['Ма', 'ро', 'дёр', 'ство']);
    expect(parts('Чернокрылый')).toEqual(['Чер', 'но', 'кры', 'лый']);
    expect(parts('призрак')).toEqual(['при', 'зрак']);
  });

  it('keeps short words and the letters й, ь, ъ whole', () => {
    expect(hyphenate('Шар')).toBe('Шар');
    expect(hyphenate('Золото')).toBe('Зо\u00adло\u00adто');
    for (const part of parts('Старьёвщик Воровское Чернокрылый')) expect(part).not.toMatch(/^[йьъ]/);
  });

  it('never changes the text itself', () => {
    for (const c of CARDS) expect(hyphenate(c.name).replaceAll('\u00ad', '')).toBe(c.name);
  });
});
