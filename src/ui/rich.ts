import { ICON } from '../engine/text';

/* Kept free of DOM access so the tutorial (and its tests) can use it. */

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ICON_CLASS: Record<string, string> = { [ICON.coin]: 'coin', [ICON.power]: 'pow', [ICON.prestige]: 'pre' };
const ICON_RE = new RegExp(`([+−-]?\\d+ )?([${Object.keys(ICON_CLASS).join('')}])`, 'g');

/** Paints resource icons in ready HTML, together with the amount in front of them, in the colors of the player bars. */
export function paintIcons(html: string): string {
  return html.replace(ICON_RE, (_, n: string | undefined, icon: string) => `<span class="ri ${ICON_CLASS[icon]}">${n ?? ''}<i>${icon}</i></span>`);
}

const VOWEL = /[аеёиоуыэюя]/i;
const SIGN = /[йьъ]/i;
const LETTER = /[а-яё]/i;
/** A consonant and р or л that stay together at the start of a syllable: «кры», «пле», «зрак». */
const PAIR = /^[бвгдзкптфх][рл]$/i;

/**
 * Puts soft hyphens into Russian words where a syllable may break, so a name too long for a narrow
 * tile wraps as «Конфис-кация» instead of at an arbitrary letter. Simplified rules: a lone consonant
 * between vowels opens the next syllable (V-CV) and so does a pair like «кр» (V-CRV), a longer run of
 * consonants splits after its first one (VC-CCV), and words also break after й/ь/ъ. Every part keeps
 * at least two letters and a vowel.
 */
export function hyphenate(text: string): string {
  return text.replace(/[а-яё]+/gi, (w) => {
    let out = '';
    let from = 0;
    for (let i = 2; i <= w.length - 2; i++) {
      const prev = w[i - 1];
      const cur = w[i];
      const next = w[i + 1];
      const consonant = !VOWEL.test(cur) && !SIGN.test(cur);
      // V-CV: a lone consonant (or a pair like «кр», «пл») opens the next syllable; VC-C…V: a run splits after its first one
      const opens =
        consonant &&
        ((VOWEL.test(prev) && (VOWEL.test(next) || (PAIR.test(cur + next) && VOWEL.test(w[i + 2] ?? '')))) ||
          (!VOWEL.test(prev) && !SIGN.test(prev) && VOWEL.test(w[i - 2]) && !PAIR.test(prev + cur)));
      const ok = opens || (SIGN.test(prev) && LETTER.test(cur));
      if (!ok || SIGN.test(cur) || i - from < 2 || !VOWEL.test(w.slice(from, i)) || !VOWEL.test(w.slice(i))) continue;
      out += w.slice(from, i) + '\u00ad';
      from = i;
    }
    return out + w.slice(from);
  });
}

/** Escapes rules text and paints its resource icons. */
export const richText = (s: string) => paintIcons(esc(s));
