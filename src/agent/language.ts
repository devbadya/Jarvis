import { queryLanguage } from '@/tools/web'

/**
 * The language a reply written in code is set in.
 *
 * The picker decides when there is one: a German choice gets German whether
 * the question was *hallo* or *hello*. Without it the question decides, which
 * is what the tests and the eval harness rely on. Only German and English have
 * wording here; every other choice gets English sentences around figures that
 * read the same in any language.
 */
export type ReplyLanguage = 'de' | 'en'

/**
 * Words English does not use, so *Wie ist das Wetter?* is German even with no
 * umlaut in it. `queryLanguage` is tuned for picking a Wikipedia and stays as
 * it is; this only decides which sentence a reply is written in.
 */
const GERMAN_WORDS =
  /(?<![\p{L}])(?:ich|du|wie|ist|das|und|nicht|wird|gibt|wetter|morgen|heute|bitte|danke|mir|mich|dir|welche[rsn]?|uhr|spät|regnet|brauche|haben|sind|kannst|wo|wann|warum)(?![\p{L}])/iu

export function replyLanguageFor(question: string, chosen?: string): ReplyLanguage {
  if (chosen) return chosen === 'de' ? 'de' : 'en'
  return queryLanguage(question) === 'de' || GERMAN_WORDS.test(question) ? 'de' : 'en'
}

/** A decimal as the reply language writes it: `19,6` in German, `19.6` in English. */
export function formatDecimal(value: number, language: ReplyLanguage, maxDecimals = 1): string {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-GB', {
    maximumFractionDigits: maxDecimals,
    useGrouping: false,
  }).format(value)
}

/**
 * Whole words from a list, with boundaries that know about umlauts.
 *
 * `\b` is ASCII even under the `u` flag, so `\bübermorgen\b` never matches
 * and `\bheiß\b` fails after the ß.
 */
export function wordPattern(alternatives: string, flags = 'iu'): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, flags)
}

export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}
