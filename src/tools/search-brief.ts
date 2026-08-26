/**
 * One search, several independent sites, compared before the model sees them.
 *
 * A search used to return a title, a URL and one line each, and everything that
 * made those lines worth anything — opening the promising ones, noticing that
 * three of them say 2023 and the fourth says 2021 — was left to the model. A
 * 0.8B model spends its whole tool budget there: four searches in a row, none of
 * them read, and `src/agent/budget.ts` exists because of it.
 *
 * So the shape is the one `weather.ts` already uses. The comparison happens here
 * rather than in the conversation: the pages are fetched in parallel, their
 * leads are cut to a budget, and what they agree and disagree on is worked out
 * deterministically. What reaches the model is one brief it can answer from.
 *
 * Two rules keep it from being an encyclopedia lookup wearing four coats.
 * Sources must come from *different* sites, because two pages of one publisher
 * are one source; and a reference work gets one seat of the four, since its
 * extract is a paragraph where a results page gives a line and it would
 * otherwise be the richest voice in every brief — while dropping it outright
 * would take the best source there is out of every question about history.
 *
 * Nothing here needs a server. The pages go through the same reader `read_page`
 * uses, which is the only fetch in this project verified to survive CORS from
 * the deployed origin.
 */

import {
  collapse,
  readPage,
  searchWeb,
  truncate,
  type SearchProvider,
  type SearchResult,
  type WebAccessConfig,
} from './web'

/** How many different sites are compared. Four fits the brief; more crowds it. */
export const MAX_SOURCES = 4

/**
 * Room for one source's text.
 *
 * Four of these plus the header, the URLs and the comparison stay inside
 * `MAX_BRIEF_CHARS`, which is half of what `read_page` alone is allowed —
 * comparing four pages must not cost more context than reading one.
 */
const MAX_EXTRACT_CHARS = 700
const MIN_EXTRACT_CHARS = 200

/** Roughly 1,000 tokens for the whole brief. */
const MAX_BRIEF_CHARS = 4000

/** What the header, the numbering and the comparison take before extracts do. */
const BRIEF_OVERHEAD_CHARS = 600

/** At most this many agreements and disagreements are reported. */
const MAX_OVERLAP = 4
const MAX_CONFLICTS = 2

/**
 * Providers that send usable text with each result, so the brief can be built
 * from one request. Everything else is read page by page through the reader.
 */
const PROVIDERS_WITH_EXTRACTS: SearchProvider[] = ['langsearch']

/**
 * Suffixes under which the label before them is still a registrant rather than
 * a site. Without these `bbc.co.uk` and `theguardian.co.uk` look like one site.
 */
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'com.br',
  'com.cn',
  'com.tr',
  'co.in',
  'co.za',
  'com.mx',
  'com.ar',
  'co.kr',
  'com.sg',
])

/**
 * Reference works, allowed exactly one seat.
 *
 * Both extremes of this were wrong. Left to rank freely they take several seats
 * and decide the answer by themselves — a lead paragraph beside three one-line
 * snippets is not a comparison, and a mirror of Wikipedia is not a second
 * opinion. Dropped whenever two other sites answered, the brief for *who was X*
 * fills up with whatever happens to rank, and for history and biography an
 * encyclopedia is the most reliable thing the search returned, not the least.
 *
 * One seat is the rule that survives both: never the majority, never absent
 * when the search found one.
 */
const ENCYCLOPEDIAS = new Set(['wikipedia.org', 'wikimedia.org', 'wikidata.org', 'britannica.com'])

const MAX_ENCYCLOPEDIAS = 1

/** The site a URL belongs to, as a reader would name it. */
export function siteOf(url: string): string {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return url
  }

  const labels = host.split('.')
  if (labels.length < 3) return host

  const lastTwo = labels.slice(-2).join('.')
  return TWO_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo
}

/**
 * Picks the results worth reading: one per site, at most one reference work.
 *
 * Rank order is otherwise kept, so the best result of a site is the one that
 * survives and the search engine's own judgement is not second-guessed beyond
 * these two rules.
 */
export function selectDiverseSources(results: SearchResult[], limit = MAX_SOURCES): SearchResult[] {
  const seen = new Set<string>()
  const selected: SearchResult[] = []
  let encyclopedias = 0

  for (const result of results) {
    if (selected.length >= limit) break
    if (!result.url) continue

    const site = siteOf(result.url)
    if (seen.has(site)) continue

    if (ENCYCLOPEDIAS.has(site)) {
      if (encyclopedias >= MAX_ENCYCLOPEDIAS) continue
      encyclopedias += 1
    }

    seen.add(site)
    selected.push(result)
  }

  return selected
}

/** A markdown link, image or emphasis carries no meaning once the page is a paragraph. */
function plainText(line: string): string {
  return (
    line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // A space rather than nothing: the reader drops the spaces around its own
      // marks, so deleting them fuses words into ones that do not exist. The
      // cost is a space before the punctuation, which the next line takes back.
      .replace(/[*_`>]+/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
  )
}

interface Line {
  text: string
  heading: boolean
}

function readableLines(text: string): Line[] {
  const lines: Line[] = []

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    if (/^#{1,6}\s/.test(line)) {
      lines.push({ text: '', heading: true })
      continue
    }
    // A horizontal rule, and a table row flattened into one line of cells. The
    // second is not a paragraph however much text it holds.
    if (/^[-*+|=_]+$/.test(line) || line.startsWith('|')) continue

    const prose = collapse(plainText(line))
    if (prose) lines.push({ text: prose, heading: false })
  }

  return lines
}

/** A full stop, not a decimal point: `213.05` ends no sentence. */
const SENTENCE_END = /[.!?]["'”’)\]]?(?:\s|$)/

/**
 * Whether a line is written prose rather than furniture.
 *
 * This is the rule that made the difference in practice. Read from the top, the
 * budget went on "Skip to main content · Welcome · English Français · Home ·
 * About" — a nav column is long, and a 0.8B model handed 700 characters of it
 * has been handed nothing. A menu is a list of labels and carries no sentence,
 * so the first line that ends a sentence is where the page starts talking.
 */
function isProse(line: Line): boolean {
  return (
    !line.heading &&
    line.text.length >= 60 &&
    line.text.split(' ').length >= 8 &&
    SENTENCE_END.test(line.text)
  )
}

/**
 * The opening prose of a page, up to a budget.
 *
 * The reader returns the whole page as markdown, and the answer is almost always
 * in its first section — so this starts at the first real sentence and stops at
 * the heading after it, rather than reading a nav column, a cookie notice and a
 * related-articles list into the context.
 *
 * A page with no sentence in it at all — a table, a price grid — is read from
 * the top instead. It is worth less, and it is what the page says.
 */
export function leadOf(text: string, budget: number): string {
  const lines = readableLines(text)
  const opening = lines.findIndex(isProse)

  const kept: string[] = []
  let length = 0

  for (const line of lines.slice(opening === -1 ? 0 : opening)) {
    if (line.heading) {
      // A heading once something has been kept starts the next section.
      if (kept.length > 0) break
      continue
    }

    kept.push(line.text)
    length += line.text.length + 1
    if (length >= budget) break
  }

  return truncate(collapse(kept.join(' ')), budget)
}

export interface BriefSource {
  title: string
  url: string
  /** The site, which is what the comparison and the reader both name it by. */
  site: string
  extract: string
  /** False when the page could not be read and its search snippet stood in. */
  read: boolean
}

interface Mention {
  display: string
  sites: Set<string>
}

const NAME_SPAN = /\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*){0,2}/gu

/**
 * Words that start a sentence far more often than they start a name.
 *
 * A capitalised span is only evidence of a subject if it is not just the first
 * word of a sentence, and the sites a term appears on cannot tell the
 * difference — three pages all beginning "The company" would otherwise read as
 * agreement about something.
 */
const SENTENCE_STARTERS = new Set([
  'a',
  'aber',
  'after',
  'also',
  'an',
  'and',
  'as',
  'at',
  'auch',
  'but',
  'by',
  'das',
  'der',
  'die',
  'ein',
  'eine',
  'er',
  'es',
  'for',
  'from',
  'für',
  'he',
  'his',
  'her',
  'however',
  'if',
  'im',
  'in',
  'is',
  'it',
  'its',
  'mit',
  'nach',
  'of',
  'on',
  'or',
  'seit',
  'she',
  'sie',
  'since',
  'that',
  'the',
  'their',
  'these',
  'they',
  'this',
  'those',
  'to',
  'und',
  'von',
  'was',
  'we',
  'when',
  'which',
  'who',
  'wir',
  'with',
  'you',
])

/** Drops the leading sentence word, so "The United Nations" is compared as "United Nations". */
function trimLeadingStopwords(span: string): string {
  const words = span.split(/\s+/)
  while (words.length > 0 && SENTENCE_STARTERS.has((words[0] ?? '').toLowerCase())) words.shift()
  return words.join(' ')
}

function namesIn(text: string): string[] {
  const found: string[] = []

  for (const [span] of text.matchAll(NAME_SPAN)) {
    const name = trimLeadingStopwords(span).replace(/[’'-]+$/, '')
    if (name.length < 3) continue
    if (name.split(/\s+/).every((word) => SENTENCE_STARTERS.has(word.toLowerCase()))) continue
    found.push(name)
  }

  return found
}

const NUMBER_SPAN = /\d{4}-\d{2}-\d{2}|\d+(?:[.,]\d+)*/g

/**
 * One value however it was written, so `46,700` and `46.700` are the same figure
 * and `46.7` is not. A final group of three digits is a thousands separator
 * unless the number opens with a zero, which only a decimal does.
 */
function canonicalNumber(display: string): string {
  const groups = display.split(/[.,]/)
  if (groups.length === 1) return display

  const last = groups.at(-1) ?? ''
  const decimal = last.length !== 3 || groups[0] === '0'
  return decimal ? `${groups.slice(0, -1).join('')}.${last}` : groups.join('')
}

/**
 * What two numbers have to share to be answers to the same question.
 *
 * Years are their own kind because that is where sources disagree in a way worth
 * reporting; otherwise the digit count stands in for it, so a revenue figure is
 * never compared against a percentage.
 */
function numberKind(display: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(display)) return 'date'

  const canonical = canonicalNumber(display)
  const year = Number(canonical)
  if (/^\d{4}$/.test(canonical) && year >= 1800 && year <= 2099) return 'year'

  const [integer = ''] = canonical.split('.')
  return `d${integer.length}`
}

/** Single digits are list markers, counts and footnotes far more often than facts. */
function comparableKind(kind: string): boolean {
  return kind !== 'd1'
}

/** Kinds where several different values are ordinary rather than contradictory. */
const DATED_KINDS = new Set(['year', 'date'])

export interface Agreement {
  term: string
  sites: number
}

export interface Conflict {
  values: { display: string; sites: string[] }[]
}

export interface Spelling {
  /** The word as the query wrote it. */
  written: string
  /** How the sources write it instead. */
  found: string
  sites: number
}

export interface Comparison {
  overlap: Agreement[]
  conflicts: Conflict[]
  spelling: Spelling[]
}

/**
 * Words a query uses to ask rather than to name.
 *
 * This list is what stops the mechanism turning into nonsense. Without it,
 * `wer ist elon musk` offers up `wer`, no source contains it, and `der` is one
 * edit away on every German page — so the brief would helpfully report that the
 * sources spell it "der".
 */
const ASKING_WORDS = new Set([
  'about',
  'alt',
  'are',
  'aus',
  'can',
  'could',
  'dich',
  'did',
  'die',
  'dir',
  'does',
  'ein',
  'eine',
  'euch',
  'find',
  'für',
  'gibt',
  'hat',
  'haben',
  'has',
  'have',
  'how',
  'ist',
  'kann',
  'können',
  'me',
  'mich',
  'mir',
  'much',
  'muss',
  'must',
  'my',
  'out',
  'sind',
  'should',
  'soll',
  'tell',
  'the',
  'über',
  'uns',
  'viel',
  'von',
  'wann',
  'war',
  'waren',
  'warum',
  'was',
  'welche',
  'welcher',
  'welches',
  'wer',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'wie',
  'wieso',
  'wird',
  'werden',
  'will',
  'wo',
  'would',
  'your',
])

const WORD = /\p{L}[\p{L}'’-]*/gu

function wordsIn(text: string): string[] {
  return [...text.matchAll(WORD)].map(([word]) => word.toLowerCase())
}

/** How far apart two words are, giving up once they are further than `limit`. */
function editDistance(left: string, right: string, limit: number): number {
  if (Math.abs(left.length - right.length) > limit) return limit + 1

  let previous = Array.from({ length: right.length + 1 }, (_, at) => at)

  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1)
      current[column] = Math.min(substitution, (previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1)
    }
    if (Math.min(...current) > limit) return limit + 1
    previous = current
  }

  return previous[right.length] ?? limit + 1
}

/** One edit for a short word, two once there is enough of it to go wrong twice. */
function allowedEdits(word: string): number {
  return word.length >= 6 ? 2 : 1
}

/**
 * How the sources spell a word the query got wrong.
 *
 * The search engine has already done the correcting: `eln musk` returns "Elon
 * Musk — Wikipedia" as its first hit, and every source then writes the name
 * properly. So there is nothing to look up and no dictionary to ship — the
 * spelling is sitting in the results, and this only has to notice.
 *
 * Which is also why it is reported rather than acted on. Rewriting the query
 * would put back the failure `lookup-term` exists for, where the model decided
 * `1inch` was a typo for `1 inch` and searched for a unit conversion.
 */
export function spellingFrom(query: string, sources: BriefSource[]): Spelling[] {
  if (sources.length === 0) return []

  const candidates = new Map<string, { display: string; sites: Set<string> }>()
  const present = new Set<string>()

  for (const source of sources) {
    for (const [word] of `${source.title} ${source.extract}`.matchAll(WORD)) {
      const key = word.toLowerCase()
      present.add(key)
      const entry = candidates.get(key) ?? { display: word, sites: new Set<string>() }
      entry.sites.add(source.site)
      candidates.set(key, entry)
    }
  }

  const found: Spelling[] = []

  for (const word of new Set(wordsIn(query))) {
    if (word.length < 3 || ASKING_WORDS.has(word) || present.has(word)) continue

    const limit = allowedEdits(word)
    let best: { display: string; sites: number; distance: number } | undefined

    for (const [key, entry] of candidates) {
      // Two sources spelling it the same way is the evidence. One page's typo is
      // not a correction, and neither is a word from the site's own furniture.
      if (entry.sites.size < 2 || key.length < 3) continue
      const distance = editDistance(word, key, limit)
      if (distance > limit) continue
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance && entry.sites.size > best.sites)
      ) {
        best = { display: entry.display, sites: entry.sites.size, distance }
      }
    }

    if (best) found.push({ written: word, found: best.display, sites: best.sites })
  }

  // Two is already a query that needs retyping rather than annotating.
  return found.slice(0, 2)
}

function record(into: Map<string, Mention>, key: string, display: string, site: string): void {
  const existing = into.get(key)
  if (existing) {
    existing.sites.add(site)
    return
  }
  into.set(key, { display, sites: new Set([site]) })
}

/**
 * A term covered by more sites, and the longer of two terms covered by the same
 * number, is the more useful thing to report.
 */
function byReach(left: Mention, right: Mention): number {
  return right.sites.size - left.sites.size || right.display.length - left.display.length
}

/** "Ama Osei" says everything "Ama" does, so the shorter one is not a second finding. */
function subsumed(term: string, kept: Agreement[]): boolean {
  const lower = term.toLowerCase()
  return kept.some((entry) => {
    const other = entry.term.toLowerCase()
    return other !== lower && (other.includes(lower) || lower.includes(other))
  })
}

/**
 * What the sources agree and disagree on.
 *
 * Deterministic on purpose, exactly as `weather.ts` reconciles three forecasts
 * without asking the model to: a second generation spent grading the extracts
 * is the capacity the answer needed. Names and figures are what a rule can
 * honestly compare, so they are all it claims to have compared.
 */
export function compareSources(sources: BriefSource[], query = ''): Comparison {
  const names = new Map<string, Mention>()
  const numbers = new Map<string, Map<string, Mention>>()

  for (const source of sources) {
    for (const name of namesIn(source.extract)) {
      record(names, name.toLowerCase(), name, source.site)
    }

    for (const [display] of source.extract.matchAll(NUMBER_SPAN)) {
      const kind = numberKind(display)
      if (!comparableKind(kind)) continue
      const byValue = numbers.get(kind) ?? new Map<string, Mention>()
      numbers.set(kind, byValue)
      record(byValue, canonicalNumber(display), display, source.site)
    }
  }

  const shared = [...names.values(), ...[...numbers.values()].flatMap((byValue) => [...byValue.values()])]
    .filter((mention) => mention.sites.size > 1)
    .sort(byReach)

  const overlap: Agreement[] = []
  for (const mention of shared) {
    if (overlap.length >= MAX_OVERLAP) break
    if (subsumed(mention.display, overlap)) continue
    overlap.push({ term: mention.display, sites: mention.sites.size })
  }

  const conflicts: Conflict[] = []
  for (const [kind, byValue] of numbers) {
    // A biography names a birth year, an election year and this year, and none
    // of them contradicts the others. Observed on a live search, which reported
    // "1971 vs 2026 vs 2024" as a disagreement about one thing. Past two
    // distinct years the sources are dating different events, not differing.
    if (DATED_KINDS.has(kind) && byValue.size > 2) continue

    const [leading, ...rest] = [...byValue.values()].sort(byReach)
    // A disagreement is only reportable when there is a reading to disagree
    // with: one site against one other says which pages differ, not which is
    // out of date, and the extracts are in front of the model either way.
    if (!leading || leading.sites.size < 2) continue

    // A site naming both figures is not contradicting anything — a page that
    // mentions last year's number alongside this year's is the ordinary way to
    // write one. Only a site that names a value and not the agreed one is.
    const dissenting = rest.filter((mention) => [...mention.sites].some((site) => !leading.sites.has(site)))
    if (dissenting.length === 0) continue

    conflicts.push({
      values: [leading, ...dissenting].slice(0, 3).map((mention) => ({
        display: mention.display,
        sites: [...mention.sites].sort(),
      })),
    })
  }

  conflicts.sort((left, right) => (right.values[0]?.sites.length ?? 0) - (left.values[0]?.sites.length ?? 0))

  return { overlap, conflicts: conflicts.slice(0, MAX_CONFLICTS), spelling: spellingFrom(query, sources) }
}

/** `YYYY-MM-DD` in the user's own timezone, which is the day they are asking about. */
function localDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function overlapLine(overlap: Agreement[], total: number): string {
  const parts = overlap.map((entry) => `"${entry.term}" in ${entry.sites}/${total}`)
  return `Agreed across sources: ${parts.join('; ')}`
}

function conflictLine(conflict: Conflict): string {
  const parts = conflict.values.map((value) => `"${value.display}" (${value.sites.join(', ')})`)
  return `Sources disagree: ${parts.join(' vs ')}`
}

/**
 * Said plainly, because the model has to be able to use the right spelling in an
 * answer to a question that used the wrong one.
 */
function spellingLine(spelling: Spelling[]): string {
  const parts = spelling.map((entry) => `"${entry.found}" (the question wrote "${entry.written}")`)
  return `The sources spell it ${parts.join(' and ')}. Answer about that, and use their spelling.`
}

/**
 * The brief, in the shape the rest of the app already reads.
 *
 * Every source keeps its own URL on its own line, because that is what
 * `reviewAnswer` grounds a citation against and what `splitSources` turns into
 * pills. A comparison the model cannot cite is worse than no comparison.
 */
export function formatBrief(query: string, sources: BriefSource[], now = new Date()): string {
  const snippetOnly = sources.filter((source) => !source.read).length
  const header = [
    `Searched ${localDate(now)} for "${query}" — ${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`,
    snippetOnly > 0 ? `, ${snippetOnly} snippet only` : '',
  ].join('')

  const entries = sources.map((source, index) =>
    [
      `${index + 1}. ${source.title || source.site} (${source.site})${source.read ? '' : ' — snippet only'}`,
      `   ${source.url}`,
      `   ${source.extract || 'No text could be read from this page.'}`,
    ].join('\n'),
  )

  const { overlap, conflicts, spelling } = compareSources(sources, query)
  const footer = [
    ...(spelling.length > 0 ? [spellingLine(spelling)] : []),
    ...(sources.length === 1
      ? ['Only one source was readable, so nothing was cross-checked.']
      : [
          ...(overlap.length > 0 ? [overlapLine(overlap, sources.length)] : []),
          ...conflicts.map(conflictLine),
        ]),
  ]

  return truncate([header, ...entries, ...footer].join('\n'), MAX_BRIEF_CHARS)
}

/** Splits the extract budget between the sources that will actually use it. */
function extractBudget(count: number): number {
  if (count === 0) return MAX_EXTRACT_CHARS
  const share = Math.floor((MAX_BRIEF_CHARS - BRIEF_OVERHEAD_CHARS) / count)
  return Math.max(MIN_EXTRACT_CHARS, Math.min(MAX_EXTRACT_CHARS, share))
}

function fromSnippet(result: SearchResult, budget: number): BriefSource {
  const extract = truncate(collapse(result.extract ?? result.snippet), budget)
  return {
    title: result.title,
    url: result.url,
    site: siteOf(result.url),
    extract,
    // A provider that sends its own text has already been read once; a bare
    // search snippet has not, and the brief says which of the two this is.
    read: Boolean(result.extract),
  }
}

/**
 * Reads the selected pages at once.
 *
 * `allSettled` rather than `all`: a page that 404s, refuses the reader or spends
 * the last of a rate limit costs its own source and nothing else. Dropping the
 * whole brief for one dead link would be the failure this tool exists to avoid.
 */
async function readSources(
  selected: SearchResult[],
  config: WebAccessConfig,
  budget: number,
): Promise<BriefSource[]> {
  if (PROVIDERS_WITH_EXTRACTS.includes(config.provider)) {
    return selected.map((result) => fromSnippet(result, budget))
  }

  const settled = await Promise.allSettled(selected.map((result) => readPage(result.url, config)))

  return selected.map((result, index) => {
    const outcome = settled[index]
    if (outcome?.status !== 'fulfilled') return fromSnippet(result, budget)

    const lead = leadOf(outcome.value.text, budget)
    if (!lead) return fromSnippet(result, budget)

    return {
      title: outcome.value.title || result.title,
      url: outcome.value.url || result.url,
      site: siteOf(outcome.value.url || result.url),
      extract: lead,
      read: true,
    }
  })
}

/** The list-of-snippets a Wikipedia search has always returned. */
function formatArticles(results: SearchResult[]): string {
  return results
    .map((result, index) => `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet}`)
    .join('\n')
}

/**
 * Everything one `web_search` call does.
 *
 * A turn has four tool rounds, so a tool that needs the model to search, then
 * read, then read again to be useful is the wrong shape — the searching, the
 * reading and the comparing all happen here, and the model spends its rounds on
 * the answer instead.
 *
 * Wikipedia is exempt: comparing several independent sites is not something one
 * encyclopedia can do, and its extracts are already paragraphs. That provider
 * keeps returning articles, which is what the tool description promises there.
 */
export async function searchBrief(
  query: string,
  sourceLimit: number,
  config: WebAccessConfig,
  now = new Date(),
): Promise<string> {
  if (config.provider === 'wikipedia') {
    const articles = await searchWeb(query, sourceLimit, config)
    return articles.length === 0 ? `No results for "${query}".` : formatArticles(articles)
  }

  // More candidates than sources, because same-site duplicates and encyclopedia
  // mirrors are removed after ranking. It costs nothing: the count is a
  // parameter of the one request the provider was going to answer anyway.
  const candidates = await searchWeb(query, Math.min(sourceLimit + 3, 10), config)
  if (candidates.length === 0) return `No results for "${query}".`

  const selected = selectDiverseSources(candidates, sourceLimit)
  const sources = await readSources(selected, config, extractBudget(selected.length))

  return formatBrief(query, sources, now)
}
