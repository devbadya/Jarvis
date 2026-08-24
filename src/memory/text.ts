/**
 * How memory text is compared — to a question during recall, to another memory
 * when deduplicating, and to whatever words the model used to name the one it
 * means.
 *
 * All three were separate before, and the loosest of the three was the one
 * pointed at `delete`: matching raw words meant "forget that I live in Berlin"
 * missed "Lives in Berlin" twice over, on `that` and on the plural.
 */

const STOPWORDS = new Set([
  'the',
  'and',
  'but',
  'for',
  'you',
  'your',
  'yours',
  'are',
  'was',
  'were',
  'not',
  'that',
  'this',
  'with',
  'what',
  'when',
  'where',
  'which',
  'who',
  'how',
  'why',
  'about',
  'from',
  'into',
  'have',
  'has',
  'had',
  'can',
  'could',
  'would',
  'should',
  'did',
  'does',
  'done',
  'please',
  'tell',
  'give',
  'them',
  'they',
  'there',
  'then',
  'than',
  'get',
  'got',
])

/**
 * A trailing `s` is dropped so `lives` matches `live` and `bikes` matches
 * `bike`. That is the whole of the stemming here, deliberately: the question is
 * "does this memory mention what was asked about", and a real stemmer is a
 * dependency and a table of exceptions for a handful of extra hits.
 */
function stem(word: string): string {
  return word.length >= 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}

/** Words worth matching on: three letters or more, and not one everybody uses. */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return words.filter((word) => word.length >= 3 && !STOPWORDS.has(word)).map(stem)
}

/**
 * The whole sentence, ignoring case, punctuation and spacing — so "I like tea."
 * and "i like tea" are one memory. Stricter than `tokenize` on purpose: this
 * decides whether something is a repeat, where a false positive silently drops
 * what the user just said.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}
