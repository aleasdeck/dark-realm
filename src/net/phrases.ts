/*
 * The phrases players can say to each other in a network game. Only the id travels over the
 * network; each side shows its own text for it, so an unknown id from a newer game is dropped.
 */

export const PHRASES = {
  hello: 'Привет, смертный. Бездна заждалась.',
  thanks: 'Как щедро. Бездна это запомнит.',
  sorry: 'Прости. Мне почти не жаль.',
  curse: 'Проклятье! Чтоб тебя вороны склевали.',
} as const;

export type PhraseId = keyof typeof PHRASES;

export const PHRASE_IDS = Object.keys(PHRASES) as PhraseId[];

export function isPhrase(id: unknown): id is PhraseId {
  return typeof id === 'string' && Object.hasOwn(PHRASES, id);
}
