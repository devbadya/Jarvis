/**
 * What of a web page the model actually gets to read.
 *
 * A page arrives from the reader as markdown of any length and left at 8,000
 * characters — roughly 2,000 tokens, and by far the largest thing in this
 * model's context. The cap is not the problem; taking it from the top is. The
 * sentence that answers the question sits wherever the page put it, and a
 * head-first truncation is a bet that it was put first, while everything before
 * it — the navigation, the cookie notice, the list of related links — is spent
 * on a 0.8B model's attention regardless.
 *
 * So the page is stripped of its furniture and then, if it is still too long,
 * reduced to the passages about the question. Long tool results are not a
 * neutral cost: across several models, function-calling accuracy falls by
 * between 7% and 91% as tool responses grow (arXiv:2505.10570), so a shorter
 * and more relevant result is the same change twice over.
 *
 * Selection is lexical, for the same reasons `src/skills/retrieve.ts` gives: a
 * dense retriever would mean shipping a second model into an app whose premise
 * is one download. The seam is `rankPassages` if that ever changes.
 */

/**
 * Roughly 2,000 tokens, which leaves room for the prompt and the answer.
 *
 * This is a cap on what reaches the model, not on what was fetched. `readPage`
 * returns the whole page and this decides how much of it is worth spending.
 */
export const MAX_PAGE_CHARS = 8000

/** Stands where passages were dropped, so the model can see that they were. */
const GAP = '[…]'

/**
 * Words too common to tell one passage from another.
 *
 * A third stop list in this repository, and deliberately not one of the other
 * two: `skills/retrieve.ts` scores curated keywords and `memory/text.ts`
 * compares short sentences, and both drop tokens under three characters. A
 * question about `UN`, `AI` or `GB` needs those, and the rarity of a term here
 * is measured against the page itself rather than against a fixed corpus.
 */
const STOPWORDS = new Set([
  'the',
  'and',
  'that',
  'this',
  'with',
  'for',
  'from',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'its',
  'their',
  'what',
  'which',
  'who',
  'whom',
  'how',
  'why',
  'when',
  'where',
  'does',
  'did',
  'can',
  'could',
  'would',
  'should',
  'about',
  'into',
  'you',
  'your',
  'i',
  'me',
  'my',
  'we',
  'us',
  'is',
  'in',
  'on',
  'of',
  'at',
  'to',
  'it',
  'a',
  'an',
  'be',
  'as',
  'or',
  'tell',
  'give',
  'show',
  'please',
  // German, because the app answers in the language it is asked in and the
  // question is what these are matched against.
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einen',
  'und',
  'oder',
  'ist',
  'sind',
  'war',
  'waren',
  'hat',
  'haben',
  'wie',
  'was',
  'wer',
  'wo',
  'wann',
  'warum',
  'mir',
  'mich',
  'ich',
  'du',
  'sie',
  'von',
  'für',
  'auf',
  'mit',
  'im',
  'zu',
  'bitte',
  'sag',
  'nach',
])

const WORD = /[\p{L}\p{N}]+/gu

/** The words of a question worth matching a page against. */
export function queryTerms(question: string): string[] {
  const words = [...question.toLowerCase().matchAll(WORD)].map((match) => match[0])
  return [...new Set(words.filter((word) => !STOPWORDS.has(word)))]
}

/**
 * Lines that are part of the site rather than part of the page.
 *
 * Every one of these was measured against reader output rather than imagined:
 * `r.jina.ai` renders a navigation bar as a run of one-link lines, an image as
 * its alt text in brackets, and a cookie banner as two short sentences. None of
 * them can answer anything, and together they are routinely the first thousand
 * characters of the page — which is precisely what a head-first cap keeps.
 */
const IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)$/
const LINK_ONLY_LINE = /^[-*+]?\s*!?\[[^\]]*\]\([^)]*\)[.,;:]?$/
const CHROME_WORDS =
  /^(skip to (main )?content|menu|navigation|search|sign in|log in|register|subscribe|newsletter|share (this|on)?|follow us|advertisement|sponsored|cookies?|accept( all)?( cookies)?|privacy (policy|settings)|manage (cookies|preferences)|related( articles| stories)?|back to top|print this page|inhalt|hauptmenü|anmelden|abonnieren|teilen|werbung|datenschutz|cookie-einstellungen|zum inhalt springen)\b/i

/** A consent notice, which is a sentence rather than a label. */
const CONSENT =
  /\b(we use cookies|uses cookies|accept (all )?cookies|cookie (settings|consent|banner)|wir verwenden cookies|cookies akzeptieren)\b/i

function isFurniture(line: string): boolean {
  const text = line.trim()
  if (!text) return false
  if (IMAGE_LINE.test(text) || LINK_ONLY_LINE.test(text)) return true
  // Length is what keeps this honest in both cases: an article about cookie
  // legislation has to keep its sentences about cookies, and it does not write
  // them in twenty characters.
  const bare = text.replace(/^[-*+#\s]+/, '')
  if (text.length <= 60 && CHROME_WORDS.test(bare)) return true
  return text.length <= 120 && CONSENT.test(bare)
}

/**
 * Splits a page into the blocks a passage can be.
 *
 * A heading is glued to the block beneath it: on its own it is four words that
 * match a question and answer nothing, and attached it is the context for the
 * paragraph that does. Consecutive duplicate lines are dropped, which is what a
 * repeated navigation strip looks like once the links are gone.
 */
export function splitPassages(markdown: string): string[] {
  const passages: string[] = []
  let block: string[] = []
  let heading: string | null = null
  let previous = ''

  const flush = (): void => {
    if (block.length === 0) {
      return
    }
    const body = block.join('\n')
    passages.push(heading ? `${heading}\n${body}` : body)
    heading = null
    block = []
  }

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd()
    const text = line.trim()

    if (!text) {
      flush()
      continue
    }
    if (isFurniture(line)) continue
    if (text === previous) continue
    previous = text

    if (/^#{1,6}\s/.test(text)) {
      flush()
      heading = text
      continue
    }
    block.push(line)
  }
  flush()

  return passages.filter((passage) => passage.trim().length > 0)
}

/**
 * How telling a term is, measured across this page's own passages.
 *
 * The BM25 idf, as in `retrieve.ts`, and computed here over the page rather than
 * over a fixed corpus: the site's own name appears in every passage of it and
 * should decide nothing, while the word the question turns on usually appears in
 * two or three.
 */
function inverseFrequency(documentFrequency: number, total: number): number {
  return Math.log((total - documentFrequency + 0.5) / (documentFrequency + 0.5) + 1)
}

export interface RankedPassage {
  index: number
  text: string
  score: number
}

/**
 * Scores every passage against the question, best first.
 *
 * Presence rather than frequency, which is what keeps a long passage from
 * winning on repetition alone: a paragraph mentioning the term once and a
 * paragraph mentioning it nine times are equally about it, and the second is
 * usually a list.
 */
export function rankPassages(passages: string[], question: string): RankedPassage[] {
  const terms = queryTerms(question)
  if (terms.length === 0 || passages.length === 0) return []

  const words = passages.map((passage) => new Set(queryTerms(passage)))
  const weights = new Map(
    terms.map((term) => [
      term,
      inverseFrequency(words.filter((set) => set.has(term)).length, passages.length),
    ]),
  )

  const scored = passages.map((text, index) => {
    let score = 0
    for (const term of terms) {
      if (words[index]?.has(term)) score += weights.get(term) ?? 0
    }
    return { index, text, score }
  })

  return scored.filter((passage) => passage.score > 0).sort((a, b) => b.score - a.score || a.index - b.index)
}

/** Joins passages in the order the page had them, marking what was skipped. */
function assemble(chosen: RankedPassage[]): string {
  const ordered = [...chosen].sort((a, b) => a.index - b.index)
  const parts: string[] = []

  ordered.forEach((passage, position) => {
    const previous = ordered[position - 1]
    if (previous && passage.index > previous.index + 1) parts.push(GAP)
    parts.push(passage.text)
  })

  return parts.join('\n\n')
}

/**
 * The part of a page worth putting in front of the model.
 *
 * Three outcomes, in order of how often they happen. A page that fits after its
 * furniture is stripped is returned whole. A page that does not, asked about
 * something, is reduced to the passages about it. A page that does not, with
 * nothing to go on — no question, or a question the page shares no word with —
 * falls back to the head, which is where this started.
 */
export function pageExtract(markdown: string, question = '', limit = MAX_PAGE_CHARS): string {
  const passages = splitPassages(markdown)
  const whole = passages.join('\n\n')
  if (whole.length <= limit) return whole

  const head = (): string =>
    `${whole.slice(0, limit).trimEnd()}\n\n[Truncated: the page continues beyond this point.]`

  const ranked = rankPassages(passages, question)
  if (ranked.length === 0) return head()

  const chosen = new Map<number, RankedPassage>()
  // The gap markers and the separators are part of what has to fit, so the
  // budget is spent as the result is built rather than checked once at the end.
  let used = 0
  const take = (index: number): void => {
    const text = passages[index]
    if (text === undefined || chosen.has(index)) return
    const cost = text.length + GAP.length + 4
    if (used + cost > limit) return
    chosen.set(index, { index, text, score: 0 })
    used += cost
  }

  // No minimum length: a passage that matched has earned its place, and
  // `Founded: 1889` is short precisely because it is the answer.
  for (const passage of ranked) take(passage.index)
  if (chosen.size === 0) return head()

  // Whatever is left over goes on context rather than on nothing: the paragraphs
  // either side of the best match, where a sentence answering the question
  // usually continues, and then the page's own opening, which is what says what
  // the page is. Both are skipped silently when the budget is already spent.
  const best = ranked[0]?.index ?? 0
  take(best + 1)
  take(best - 1)
  take(0)

  return `${assemble([...chosen.values()])}\n\n[Shortened: only the parts of this page about the question are shown.]`
}
