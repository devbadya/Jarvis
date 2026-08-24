import type { SkillEntry } from './types'

/**
 * Finding the right skill without asking the model.
 *
 * The received wisdom is to put every skill's name and description in the system
 * prompt and let the model pick. That is what the Agent Skills standard does,
 * and what Claude's tool search does at a larger scale, because there the reader
 * is a frontier model. Here it is a 0.8B model generating at around 18 tokens a
 * second, so a search round-trip costs seconds and a whole generation, and this
 * app has already measured that prose in the system prompt is close to worthless
 * to it. Retrieval happens in code instead, which means the catalogue costs zero
 * tokens rather than the standard's ~100 per skill.
 *
 * Retrieval is lexical, not semantic. The corpus is a handful of short entries,
 * which is where BM25-style scoring is at its best and where a dense retriever
 * would mean shipping a second model — 22 MB and up — to an app whose whole
 * premise is one download that works offline. The seam is here if that changes:
 * anything that can score an entry against a query can replace `search`.
 *
 * What it searches is curated. Retrieving over the description reads like the
 * obvious choice and is a trap: `temperature` appears in the weather
 * description, so a bag-of-words match fires the weather skill on *what
 * temperature does water boil at*. Keywords are written to be matched.
 */
export interface Retrieved {
  entry: SkillEntry
  score: number
  /** The keywords or terms that matched, in scoring order. Shown in the UI. */
  matched: string[]
}

/**
 * Words carrying no routing signal. Short by design: this is a stop list for
 * question shapes, not for prose, and every word removed is a word a skill
 * author cannot use as a keyword.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'am',
  'do',
  'does',
  'did',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'and',
  'or',
  'it',
  'its',
  'my',
  'me',
  'you',
  'your',
  'i',
  'we',
  'what',
  'whats',
  'which',
  'how',
  'can',
  'could',
  'would',
  'please',
  'tell',
  'give',
  'show',
  // German, since the system prompt tells the model to answer in the language it
  // was asked in and the triggers are all written in English. `was` and `am`
  // stand in both lists and are only listed once.
  'ist',
  'sind',
  'der',
  'die',
  'das',
  'ein',
  'eine',
  'und',
  'oder',
  'mir',
  'mich',
  'ich',
  'wie',
  'im',
  'von',
  'für',
  'zu',
])

/** Unicode-aware, so German and accented terms survive tokenising. */
const WORD = /[\p{L}\p{N}]+/gu

/** Every word, stop or not: phrase matching needs the words that were written. */
export function tokenize(text: string): string[] {
  return [...text.toLowerCase().matchAll(WORD)].map((match) => match[0])
}

export function contentTerms(text: string): string[] {
  return tokenize(text).filter((token) => !STOPWORDS.has(token))
}

/**
 * A keyword matches when its words appear in the message contiguously and in
 * order.
 *
 * Phrases are the point, and they are matched over the words as written rather
 * than over the content words. Dropping stopwords first would quietly turn
 * `how warm` into `warm` and fire the weather skill on a bowl of soup, and
 * allowing gaps would turn `temperature outside` back into the bag of words that
 * matches *what temperature does water boil at*. The cost is that a keyword has
 * to be written the way people write it — which is what the keyword is for.
 */
function phraseMatches(phrase: string[], message: string[]): boolean {
  if (phrase.length === 0 || phrase.length > message.length) return false

  return message.some((_token, start) => phrase.every((word, offset) => message[start + offset] === word))
}

/**
 * How much a term is worth: rarer across the catalogue means more telling.
 *
 * The BM25 idf, without the length normalisation the rest of BM25 adds — these
 * documents are a handful of keywords each, so there is no document length for
 * it to correct for, and leaving it out keeps every score explainable by the
 * terms that produced it.
 */
function inverseFrequency(term: string, documentFrequency: Map<string, number>, total: number): number {
  const seen = documentFrequency.get(term) ?? 0
  return Math.log((total - seen + 0.5) / (seen + 0.5) + 1)
}

interface Indexed {
  entry: SkillEntry
  /** Curated keywords: the words as written, and the ones worth scoring. */
  phrases: { source: string; words: string[]; scored: string[] }[]
  /** Description terms, used only when a skill declares no keywords. */
  fallback: string[]
}

interface Index {
  entries: Indexed[]
  /** How many entries each term appears in, for the idf. */
  documentFrequency: Map<string, number>
}

/**
 * Built once per catalogue rather than once per message.
 *
 * The catalogue is a module-level constant, so this is a cache with exactly one
 * live key in practice; the WeakMap is what keeps the eval's throwaway
 * catalogues from accumulating.
 */
const INDEXES = new WeakMap<SkillEntry[], Index>()

function index(catalog: SkillEntry[]): Index {
  const cached = INDEXES.get(catalog)
  if (cached) return cached

  const entries: Indexed[] = catalog.map((entry) => ({
    entry,
    phrases: entry.keywords
      .map((keyword) => ({
        source: keyword,
        words: tokenize(keyword),
        scored: contentTerms(keyword),
      }))
      .filter((phrase) => phrase.words.length > 0),
    fallback: entry.keywords.length === 0 ? [...new Set(contentTerms(entry.description))] : [],
  }))

  const documentFrequency = new Map<string, number>()
  for (const { phrases, fallback } of entries) {
    const terms = new Set([...phrases.flatMap((phrase) => phrase.scored), ...fallback])
    for (const term of terms) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
  }

  const built = { entries, documentFrequency }
  INDEXES.set(catalog, built)
  return built
}

/**
 * One curated keyword is enough, because somebody chose it. Two terms are
 * required of a skill with no keywords at all, where the index is prose the
 * author never meant to be matched.
 */
const MIN_FALLBACK_TERMS = 2

/**
 * Ranks the catalogue against a message, best first, and returns only entries
 * worth loading.
 *
 * An empty result is the common and correct outcome: most messages are not a job
 * for any skill, and firing one on plain conversation is what makes a small
 * model reach for tools it does not need.
 */
export function search(message: string, catalog: SkillEntry[]): Retrieved[] {
  const words = tokenize(message)
  if (words.length === 0) return []
  const query = new Set(contentTerms(message))

  const { entries, documentFrequency } = index(catalog)

  const scored = entries.map(({ entry, phrases, fallback }) => {
    const hits = phrases
      .filter((phrase) => phraseMatches(phrase.words, words))
      .map((phrase) => ({
        source: phrase.source,
        // A longer phrase matching is a stronger signal than a shorter one, and
        // summing its terms says so without a separate length bonus.
        score: phrase.scored.reduce(
          (total, word) => total + inverseFrequency(word, documentFrequency, entries.length),
          0,
        ),
      }))

    if (hits.length === 0 && fallback.length > 0) {
      const matched = fallback.filter((term) => query.has(term))
      if (matched.length >= MIN_FALLBACK_TERMS) {
        for (const term of matched) {
          hits.push({
            source: term,
            // Halved: the description was written to be read, not matched.
            score: inverseFrequency(term, documentFrequency, entries.length) / 2,
          })
        }
      }
    }

    hits.sort((a, b) => b.score - a.score)
    return {
      entry,
      score: hits.reduce((total, hit) => total + hit.score, 0),
      matched: hits.map((hit) => hit.source),
    }
  })

  return scored
    .filter((candidate) => candidate.matched.length > 0)
    .sort((a, b) => b.score - a.score || b.entry.priority - a.entry.priority)
}
