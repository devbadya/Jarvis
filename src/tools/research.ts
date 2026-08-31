/**
 * Researching a question across several sources in one tool call.
 *
 * `web_search` and `read_page` can do this between them, and the model has to
 * chain them to get there: search, pick a result, read it, and — if it wants a
 * second opinion — read another. A turn is capped at `MAX_TOOL_ROUNDS` rounds,
 * so that chain runs out of budget at roughly two sources, and every link in it
 * is a decision a 0.8B model can get wrong. This is the `weather` shape applied
 * to the web: the fan-out happens here, and what reaches the model is one
 * compact result it did not have to assemble.
 *
 * Three sources, not five: search plus three page-reads would spend four of the
 * reader's 20 requests a minute, and Wikipedia pages skip the reader entirely,
 * so a typical call is one search and two reads. Five sources was six requests
 * and three questions in a minute before the rate limit.
 *
 * Wikipedia is fetched alongside the web, because MediaWiki is free and the
 * lead paragraph is usually the sentence that names the person. A page that
 * comes back as a firewall, a login wall or empty prose is replaced from the
 * remaining hits rather than quoted; the search snippet only stands in when
 * nothing else could be opened. Passages are scored lexically against the
 * question, with inflected forms of a word counting as the same term, so a
 * German page is not silent on a German question.
 */

import {
  queryLanguage,
  readPage,
  searchWeb,
  wikipediaPage,
  type SearchResult,
  type WebAccessConfig,
} from './web'

/**
 * How many results to ask for before narrowing them. Larger than `MAX_SOURCES`
 * because the narrowing drops duplicate sites, and a page of results from one
 * newspaper should still leave three sources to read.
 */
const SEARCH_LIMIT = 8

/** Three independent sites. A fourth is usually the same claim from a mirror. */
const MAX_SOURCES = 3

/**
 * How many page-reads a turn may spend filling those three slots.
 *
 * The first wave is `MAX_SOURCES` in parallel. A blocked or empty page spends
 * one of the remainder on a replacement rather than quoting its snippet while
 * unread hits sit unused. Five is one search-plus-three plus two retries, still
 * inside the reader's 20-a-minute budget for a single question.
 */
const MAX_READ_ATTEMPTS = 5

/** Enough Wikipedia hits to have a lead article after disambiguations are demoted. */
const WIKI_SEARCH_LIMIT = 3

/** Two passages carry a claim and its context. A third is usually the same claim again. */
const MAX_PASSAGES_PER_SOURCE = 2

const MAX_PASSAGE_CHARS = 280

/** Shorter than this is a heading, a byline or a nav item rather than prose. */
const MIN_PASSAGE_CHARS = 60

/** Words, not characters: a long run of link text can clear the character floor. */
const MIN_PASSAGE_WORDS = 8

/**
 * The whole result, well under `read_page`'s 8,000. Three short sources cost
 * less context than one whole page, which is the failure this tool exists to
 * avoid.
 */
const MAX_DIGEST_CHARS = 4000

const WORD = /[\p{L}\p{N}]+/gu

function words(text: string): string[] {
  return [...text.toLowerCase().matchAll(WORD)].map((match) => match[0])
}

/**
 * Whether two tokens are the same word in different clothes.
 *
 * German office titles inflect: a question about the *Bundeskanzler* is
 * answered by a sentence about the *Bundeskanzlers* Amt, and treating those as
 * unrelated is what made a German page silent on a German question. A shared
 * prefix of five letters, with only a short suffix on either side, catches the
 * inflections without treating *news* as *newspaper*.
 */
export function related(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 5 || b.length < 5) return false
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i += 1
  return i >= 5 && a.length - i <= 4 && b.length - i <= 4
}

function holds(haystack: Set<string>, term: string): boolean {
  if (haystack.has(term)) return true
  for (const word of haystack) {
    if (related(term, word)) return true
  }
  return false
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * The query to send the search engine, given what the model passed.
 *
 * A 0.8B model often forwards the whole question: *What is the capital of
 * France?* Searching that verbatim ranks a page *about questions* that uses
 * the sentence as an example, ahead of Paris. Stripping the interrogative
 * shell is the same narrowing `placeCandidates` does for weather. *Why* and
 * *how* questions keep the shell: *sky blue* ranks a colour swatch, *why is the
 * sky blue* ranks diffuse sky radiation. The language of the original is what
 * `searchWeb` still uses, so a stripped German *who* question does not flip to
 * English Wikipedia.
 */
export function focusQuery(raw: string): string {
  const original = collapse(raw.replace(/[?!？]+$/g, ''))
  if (!original) return raw.trim()

  // *Why is the sky blue?* is a better Wikipedia search than *sky blue*, which
  // ranks a colour and a football club ahead of Rayleigh scattering. Prices and
  // *who/what* questions still want the shell gone.
  if (/^(why|warum|wieso|weshalb|how|wie)\b/i.test(original) && !/^(how much|wie viel)/i.test(original)) {
    return original
  }

  let text = original.replace(
    /^(how much|wie viel(?:e)?)\s+(is|are|does|do|did|kostet|kosten)\s+(?:a|an|the|ein|eine|der|die|das)?\s*/i,
    '',
  )
  text = text.replace(
    /^(what's|whats|what|which|who|when|where|why|how|wer|was|wann|wo|warum|wieso|weshalb|welche[rsn]?)\s+(?:(?:is|are|was|were|do|does|did|ist|sind|war|waren|hat|haben)\s+)?(?:(?:the|a|an|der|die|das|ein|eine|den|dem)\s+)?/i,
    '',
  )
  text = collapse(text)
  return text.length >= 2 ? text : original
}

/**
 * Closes the gap the separators above open in front of punctuation. A quote is
 * only known to be a closing one when punctuation follows it, so that is the
 * only case where a space in front of one is removed.
 */
function tidy(value: string): string {
  return value.replace(/\s+(["'”’][.,;:!?])/g, '$1').replace(/\s+([.,;:!?])/g, '$1')
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return url
  }
}

function isWikipediaUrl(url: string): boolean {
  try {
    return wikipediaPage(new URL(url)) !== null
  } catch {
    return false
  }
}

/**
 * A URL that will not yield a page worth quoting.
 *
 * Login walls survive the reader as a 200 with prose on them, and then score
 * against the question because they mention the site. `download_pdf` is the
 * NVIDIA gallery that used to occupy a source slot with a binary rather than
 * an article. Demoted rather than dropped, so a search that returned nothing
 * else still has something to try.
 */
export function isUnreadableUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase()
    return (
      /\/(?:login|log-in|signin|sign-in|sign-up|signup|register|consent)(?:\/|$)/.test(path) ||
      path.includes('download_pdf')
    )
  } catch {
    return true
  }
}

/**
 * Compound public suffixes where the last two labels are not the site.
 *
 * `bbc.co.uk` and `theguardian.co.uk` are two newsrooms. Without this list they
 * collapse to `co.uk`. The list is the suffixes that actually show up in search
 * results, not the public suffix list.
 */
const COMPOUND_SUFFIX = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.jp',
  'co.kr',
  'com.br',
  'co.in',
  'com.mx',
  'co.za',
  'com.tr',
  'com.ar',
])

/**
 * The registrable site, so `investor.nvidia.com` and `nvidianews.nvidia.com`
 * count as one source rather than two readings of the same company.
 */
export function siteOf(url: string): string {
  const host = hostOf(url)
  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) return host
  const lastTwo = parts.slice(-2).join('.')
  if (COMPOUND_SUFFIX.has(lastTwo)) return parts.slice(-3).join('.')
  return lastTwo
}

function todayStamp(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Orders the results so that the first hit on each *site* comes before any
 * second hit on one, then takes the first `max`.
 *
 * "Many sources" has to mean many *different* sources: a search for a news story
 * returns four pages of the same newspaper, and reading all four is four reader
 * requests spent to hear one newsroom repeat itself. Grouping by site rather
 * than by host is what stops `investor.nvidia.com` and `nvidianews.nvidia.com`
 * counting as two opinions. Reordering rather than discarding is what keeps this
 * from being a special case for Wikipedia, whose results are all one site —
 * there the list refills with further articles instead of collapsing to one.
 */
export function diverseFirst(results: SearchResult[], max: number): SearchResult[] {
  const sites = new Set<string>()
  const urls = new Set<string>()
  const first: SearchResult[] = []
  const rest: SearchResult[] = []

  for (const result of results) {
    if (!result.url || urls.has(result.url)) continue
    urls.add(result.url)

    const site = siteOf(result.url)
    if (sites.has(site)) {
      rest.push(result)
      continue
    }
    sites.add(site)
    first.push(result)
  }

  return [...first, ...rest].slice(0, max)
}

const IMAGE = /!\[[^\]]*\]\([^)]*\)/g

/**
 * A markdown link target, tolerating one level of nesting inside it.
 *
 * `[^)]*` is the obvious pattern and stops at the first bracket of
 * `Betreuung_(Recht)`, which left `"Betreuung (Recht)")` sitting in a German
 * Wikipedia passage. Wikipedia URLs carry parenthesised disambiguators and the
 * reader adds a quoted title beside them, so both have to survive being matched.
 */
const LINK_TARGET = /\]\((?:[^()]|\([^()]*\))*\)/g

/** What is left of `[47]` once its target is gone: a footnote number mid-sentence. */
const FOOTNOTE = /\[\d+\]/g

const BARE_URL = /https?:\/\/\S+/g
const HEADING_MARK = /#{1,6}\s+/g
const EMPHASIS = /[*_`]+/g
const LINE_FURNITURE = /^\s*(?:[-*+]\s+|>\s+|\d+\.\s+)/

/**
 * Prose ends in a full stop. Menus, breadcrumbs and share rows do not, and they
 * clear every length floor: *Sie befinden sich hier Bundesregierung | Startseite
 * Bundeskabinett Bundeskanzler* was quoted as a source on what a chancellor is.
 *
 * Cheaper and less parochial than naming the furniture — it needs no word list
 * and works in either language. Trailing quotes and brackets are allowed through
 * because a paragraph often ends inside them.
 */
const ENDS_A_SENTENCE = /[.!?…][)"'”’]*$/

/**
 * Boilerplate that reads exactly like prose and answers nothing.
 *
 * Not a nicety. Run against the live web, two of five sources for *who is the
 * chief executive of Nvidia* came back quoting consent notices — "these cookies
 * may store a unique ID", "das Tool verwendet Cookies" — because a cookie banner
 * is several sentences long and mentions the site it is on, which is all the
 * scoring has to go on.
 *
 * The cost is that a paragraph genuinely about cookies or a privacy policy is
 * dropped with them. That is the right way round: this tool is asked who runs a
 * company far more often than it is asked what an HTTP cookie is, and the
 * failure it prevents was happening on most commercial sites.
 */
const BOILERPLATE =
  /\bcookies?\b|\bconsent\b|\bnewsletter\b|\bsubscribe\b|\bprivacy policy\b|\bterms of (use|service)\b|\ball rights reserved\b|\bdatenschutz\b|\beinwilligung\b|\bnutzungsbedingungen\b/i

/**
 * A citation list, which scores well and states nothing.
 *
 * Wikipedia's references were the top-ranked paragraph for *who is the chief
 * executive of Nvidia*: they repeat the subject's name in every entry, so they
 * out-score the sentence that answers the question.
 */
const REFERENCE_LIST =
  /↑|\bretrieved\b\s+\w+\s+\d{1,2},?\s+\d{4}|\barchived from the original\b|\babgerufen am\b/i

/**
 * Reads the reader's markdown back into candidate paragraphs.
 *
 * Link text is kept and the target dropped, and any bare URL goes with it. That
 * second part is not tidiness: `reviewAnswer` treats every URL in a tool result
 * as a source the answer may cite, so a footnote anchor left in a passage would
 * become a citable source that says nothing. A Wikipedia passage arrived carrying
 * `#cite_note-fitch20240226-50`, which is exactly that.
 */
export function paragraphsOf(markdown: string): string[] {
  return (
    markdown
      .replace(IMAGE, ' ')
      .replace(LINK_TARGET, ']')
      .replace(FOOTNOTE, '')
      // Whatever brackets are left were a link's text. A nested `[[47]](url)` is why
      // this strips them rather than matching a whole link in one pattern.
      //
      // A space, not nothing, and the same for the emphasis marks below: a page
      // writes two links with nothing between them, so deleting the brackets fuses
      // what they held. `our@NVIDIATwitter account,NVIDIA Facebookpage` was three
      // adjacent links, and it is the trap `unbold` in `web.ts` already documents.
      .replace(/[[\]]/g, ' ')
      .replace(BARE_URL, ' ')
      .split(/\n\s*\n/)
      .map((block) =>
        tidy(
          collapse(
            block
              .split('\n')
              .map((line) => line.replace(LINE_FURNITURE, ''))
              .join(' ')
              .replace(HEADING_MARK, ' ')
              .replace(EMPHASIS, ' '),
          ),
        ),
      )
      .filter(
        (block) =>
          block.length >= MIN_PASSAGE_CHARS &&
          words(block).length >= MIN_PASSAGE_WORDS &&
          ENDS_A_SENTENCE.test(block) &&
          !BOILERPLATE.test(block) &&
          !REFERENCE_LIST.test(block),
      )
  )
}

/**
 * What a firewall or a JavaScript gate serves instead of the page.
 *
 * The reader answers 200 with it, so nothing upstream can tell it from a result:
 * *wer ist der Bundeskanzler* came back with "Sucuri WebSite Firewall — Access
 * Denied" quoted as one of five sources. Length is half the test, because an
 * article about Cloudflare is long and a page refusing to serve one is not.
 */
const BLOCKED =
  /access denied|attention required|just a moment|enable javascript|are you a robot|verify you are human|cloudflare|sucuri|forbidden|zugriff verweigert/i

const BLOCK_PAGE_CHARS = 1200

export function looksBlocked(title: string, text: string): boolean {
  return text.length < BLOCK_PAGE_CHARS && BLOCKED.test(`${title} ${text.slice(0, 300)}`)
}

/** BM25's idf without the length normalisation, as `skills/retrieve.ts` uses it. */
function inverseFrequency(documentFrequency: number, total: number): number {
  return Math.log((total - documentFrequency + 0.5) / (documentFrequency + 0.5) + 1)
}

/**
 * Question-shell words. Pooling idf across a hundred paragraphs makes a stop
 * list unnecessary — *the* appears everywhere and ends up worth about two per
 * cent of *executive*. Across the three pages a research call actually reads,
 * *the* can be exactly as rare as *executive* and rank the wrong paragraph
 * first. Dropping the shell is what keeps *who is the chief executive* from
 * quoting the paragraph that only says *the airline*.
 *
 * A length floor would be the cheap way to drop *of* and *is*, and it is the
 * wrong one: *UN*, *EU* and *AI* are two letters and are the whole question.
 */
const SHELL = new Set([
  'who',
  'what',
  'which',
  'when',
  'where',
  'why',
  'how',
  'wer',
  'was',
  'wann',
  'wo',
  'warum',
  'wieso',
  'weshalb',
  'welche',
  'welcher',
  'welches',
  'welchen',
  'is',
  'are',
  'were',
  'the',
  'a',
  'an',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'and',
  'or',
  'ist',
  'sind',
  'der',
  'die',
  'das',
  'ein',
  'eine',
  'und',
  'oder',
  'von',
  'im',
  'für',
  'zu',
  'does',
  'do',
  'did',
  'can',
  'could',
  'please',
  'tell',
  'me',
  'you',
  'your',
  'hat',
  'haben',
  'dem',
  'den',
  'des',
])

function questionTerms(question: string): Set<string> {
  const all = new Set(words(question).filter((term) => term.length > 1))
  const focused = new Set([...all].filter((term) => !SHELL.has(term)))
  return focused.size > 0 ? focused : all
}

function weigh(question: string, corpus: string[]): Map<string, number> {
  const terms = questionTerms(question)
  const tokenized = corpus.map((paragraph) => new Set(words(paragraph)))

  const weights = new Map<string, number>()
  for (const term of terms) {
    const seen = tokenized.filter((paragraph) => holds(paragraph, term)).length
    if (seen > 0) weights.set(term, inverseFrequency(seen, tokenized.length))
  }
  return weights
}

function score(text: string, weights: Map<string, number>): number {
  const present = new Set(words(text))
  let total = 0
  for (const [term, weight] of weights) {
    if (holds(present, term)) total += weight
  }
  return total
}

function rankBySnippet(question: string, results: SearchResult[]): SearchResult[] {
  if (results.length <= 1) return results
  const weights = weigh(
    question,
    results.map((result) => `${result.title} ${result.snippet}`),
  )
  return results
    .map((result, at) => ({
      result,
      at,
      score: score(`${result.title} ${result.snippet}`, weights),
    }))
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map((entry) => entry.result)
}

/**
 * The results worth reading, in the order they should be tried.
 *
 * Wikipedia first, because MediaWiki is free and the lead paragraph usually
 * names the person. Then one hit per remaining site, ranked by whether the
 * snippet already bears on the question, so a PDF gallery sitting at rank two
 * does not spend a reader request ahead of the article that answers it. Extra
 * pages from a site already chosen, and URLs that will not yield a page, come
 * last — they fill a slot only when nothing else is left.
 */
export function pickCandidates(question: string, results: SearchResult[]): SearchResult[] {
  const ordered = diverseFirst(results, results.length)
  const seen = new Set<string>()
  const primary: SearchResult[] = []
  const extra: SearchResult[] = []

  for (const entry of ordered) {
    const site = siteOf(entry.url)
    if (seen.has(site)) extra.push(entry)
    else {
      seen.add(site)
      primary.push(entry)
    }
  }

  const wiki: SearchResult[] = []
  const other: SearchResult[] = []
  const junk: SearchResult[] = []
  for (const entry of primary) {
    if (isUnreadableUrl(entry.url)) junk.push(entry)
    else if (isWikipediaUrl(entry.url)) wiki.push(entry)
    else other.push(entry)
  }

  const extraReadable = extra.filter((entry) => !isUnreadableUrl(entry.url))
  const extraJunk = extra.filter((entry) => isUnreadableUrl(entry.url))

  return [
    ...wiki,
    ...rankBySnippet(question, other),
    ...rankBySnippet(question, extraReadable),
    ...junk,
    ...extraJunk,
  ]
}

const SENTENCE_END = /(?<=[.!?…])\s+/

/**
 * Cuts a paragraph down to the run of sentences that carries the most of the
 * question, so a long page contributes its relevant lines rather than its first
 * ones. A single sentence over the cap is cut mid-way, which is the one case
 * where this cannot avoid it.
 *
 * A window has to clear `MIN_PASSAGE_CHARS` to win on score alone, because
 * scoring rewards density and the densest window is often a heading. Asked who
 * runs Nvidia, this returned the FAQ question "Who leads NVIDIA?" — every word of
 * it earning, and the answer beneath it left out.
 */
function condense(paragraph: string, weights: Map<string, number>): string {
  if (paragraph.length <= MAX_PASSAGE_CHARS) return paragraph

  const sentences = paragraph.split(SENTENCE_END)
  let best = ''
  let bestScore = -1
  let substantial = ''
  let substantialScore = -1

  for (let start = 0; start < sentences.length; start += 1) {
    let window = ''
    for (let end = start; end < sentences.length; end += 1) {
      const extended = window ? `${window} ${sentences[end]}` : (sentences[end] ?? '')
      if (extended.length > MAX_PASSAGE_CHARS) break
      window = extended

      const windowScore = score(window, weights)
      if (windowScore > bestScore || (windowScore === bestScore && window.length > best.length)) {
        best = window
        bestScore = windowScore
      }
      if (
        window.length >= MIN_PASSAGE_CHARS &&
        (windowScore > substantialScore ||
          (windowScore === substantialScore && window.length > substantial.length))
      ) {
        substantial = window
        substantialScore = windowScore
      }
    }
  }

  return substantial || best || `${paragraph.slice(0, MAX_PASSAGE_CHARS).trimEnd()}…`
}

/** Enough of a passage to recognise the same claim written out twice. */
function fingerprint(passage: string): string {
  return words(passage).slice(0, 8).join(' ')
}

/**
 * The passages from one page worth putting in front of the model.
 *
 * A page whose prose never repeats the question's words still falls back to its
 * opening paragraph: *what is Stripe* is answered by a lead paragraph that says
 * "Stripe is a payments company" and may never say "what" or "is" again.
 */
function choose(candidates: string[], weights: Map<string, number>): string[] {
  if (candidates.length === 0) return []

  const ranked = candidates
    .map((text, at) => ({ text, at, score: score(text, weights) }))
    .sort((a, b) => b.score - a.score || a.at - b.at)

  const relevant = ranked.filter((candidate) => candidate.score > 0)
  const passages: string[] = []
  const seen = new Set<string>()

  for (const candidate of relevant.length > 0 ? relevant : ranked.slice(0, 1)) {
    if (passages.length >= MAX_PASSAGES_PER_SOURCE) break
    const passage = condense(candidate.text, weights)
    const mark = fingerprint(passage)
    if (mark === '' || seen.has(mark)) continue
    seen.add(mark)
    passages.push(passage)
  }

  return passages
}

/**
 * Picks the passages for every page at once, so each is ranked against the same
 * weights. Pages arrive as paragraph lists and leave as passage lists, index for
 * index; a page nothing could be read off stays empty rather than being dropped,
 * because its position still names a source.
 */
export function passagesFor(question: string, pages: string[][]): string[][] {
  const weights = weigh(question, pages.flat())
  return pages.map((candidates) => choose(candidates, weights))
}

export interface Source {
  url: string
  title: string
  /** Verbatim, best first. */
  passages: string[]
  /** False when the page could not be opened and its search snippet stood in. */
  read: boolean
}

/** Straight quotes wrap each passage, so the model is not handed its own edges to trip on. */
function unquote(passage: string): string {
  return passage.replace(/^["'“”]+|["'“”]+$/g, '').trim()
}

function entry(source: Source, at: number): string {
  const heading = `${at + 1}. ${source.title || hostOf(source.url)} — ${source.url}`
  return [heading, ...source.passages.map((passage) => `   "${unquote(passage)}"`)].join('\n')
}

/**
 * Says what was consulted before quoting any of it.
 *
 * A source that could only be reached as a search snippet is named as one: a
 * snippet is weaker evidence than a page, and the difference is invisible once
 * both are quoted lines in a list.
 */
function header(question: string, sources: Source[]): string {
  const read = sources.filter((source) => source.read).length
  const subject = `Researched ${todayStamp()} for "${question}" across ${sources.length} source${sources.length === 1 ? '' : 's'}`

  if (read === 0) return `${subject}; none could be opened, so these are search snippets only.`
  if (read === sources.length) return `${subject}, all read in full.`
  return `${subject}; ${read} read in full, ${sources.length - read} from the search snippet only.`
}

export function digest(question: string, sources: Source[]): string {
  const body = [header(question, sources), '', ...sources.map(entry)].join('\n')
  if (body.length <= MAX_DIGEST_CHARS) return body
  return `${body.slice(0, MAX_DIGEST_CHARS)}\n\n[Truncated: further sources were dropped.]`
}

/**
 * Wikipedia alongside the web, never instead of it.
 *
 * MediaWiki is free of the reader's budget and the lead paragraph usually
 * names the person, so a DuckDuckGo or LangSearch turn that never returned
 * Wikipedia used to spend three reader requests on news pages and still miss
 * the sentence that answered the question. A failure here is swallowed: the
 * web results are still an answer, and a thrown encyclopedia search would
 * take them down with it.
 */
async function encyclopediaHits(question: string, config: WebAccessConfig): Promise<SearchResult[]> {
  if (config.provider === 'wikipedia') return []
  try {
    return await searchWeb(
      focusQuery(question),
      WIKI_SEARCH_LIMIT,
      { provider: 'wikipedia' },
      queryLanguage(question),
    )
  } catch {
    return []
  }
}

interface Opened {
  url: string
  title: string
  paragraphs: string[]
}

/**
 * Reads until three pages have prose on them, or the attempt budget is gone.
 *
 * The first wave is parallel. A blocked, empty or refused page does not keep
 * its slot: the next unread candidate is tried, up to `MAX_READ_ATTEMPTS`.
 * Snippets from the failed hits only stand in once nothing else can be opened,
 * and a firewall body is never quoted — the search snippet for that URL at
 * least came from the index.
 */
async function readBest(
  question: string,
  candidates: SearchResult[],
  config: WebAccessConfig,
): Promise<{ sources: Source[]; reasons: string[] }> {
  const opened: Opened[] = []
  const fallbacks: SearchResult[] = []
  const reasons: string[] = []
  let next = 0
  let attempts = 0

  while (opened.length < MAX_SOURCES && next < candidates.length && attempts < MAX_READ_ATTEMPTS) {
    const take = Math.min(MAX_SOURCES - opened.length, MAX_READ_ATTEMPTS - attempts, candidates.length - next)
    const batch = candidates.slice(next, next + take)
    next += batch.length
    attempts += batch.length

    const settled = await Promise.allSettled(batch.map((entry) => readPage(entry.url, config)))

    for (const [at, result] of batch.entries()) {
      const outcome = settled[at]
      if (outcome?.status === 'fulfilled') {
        const { title, text, url } = outcome.value
        if (!looksBlocked(title, text)) {
          const paragraphs = paragraphsOf(text)
          if (paragraphs.length > 0) {
            opened.push({ url, title: title || result.title, paragraphs })
            continue
          }
        }
      } else if (outcome?.status === 'rejected') {
        reasons.push(outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason))
      }
      fallbacks.push(result)
    }
  }

  const chosen = passagesFor(
    question,
    opened.map((entry) => entry.paragraphs),
  )

  const sources: Source[] = []
  for (const [at, entry] of opened.entries()) {
    const passages = chosen[at] ?? []
    if (passages.length === 0) continue
    sources.push({ url: entry.url, title: entry.title, passages, read: true })
  }

  for (const result of fallbacks) {
    if (sources.length >= MAX_SOURCES) break
    const snippet = collapse(result.snippet)
    if (!snippet) continue
    sources.push({ url: result.url, title: result.title, passages: [snippet], read: false })
  }

  return { sources, reasons }
}

/**
 * Searches the web and Wikipedia, reads the most promising results in parallel
 * and returns the passages that bear on the question, each with the URL it
 * came from.
 *
 * A page that fails is replaced from the remaining hits rather than allowed to
 * take the answer down with it — the reader's per-minute budget is shared, so a
 * 429 on the third page is an ordinary event and not a reason to abandon the
 * two that arrived.
 */
export async function researchQuestion(question: string, config: WebAccessConfig): Promise<string> {
  const query = focusQuery(question)
  const language = queryLanguage(question)
  const [webResults, wikiResults] = await Promise.all([
    searchWeb(query, SEARCH_LIMIT, config, language),
    encyclopediaHits(question, config),
  ])

  const combined = [...wikiResults, ...webResults]
  if (combined.length === 0) return `Researched ${todayStamp()} for "${question}". No results.`

  const { sources, reasons } = await readBest(question, pickCandidates(question, combined), config)

  // Every source silent means the search found pages and nothing could be read
  // off any of them. Reporting that as a result would have the model relay it as
  // "there is nothing on this", which is the one thing it must not say.
  if (sources.length === 0) {
    throw new Error(
      `Found ${combined.length} results for "${question}" but could not read any of them${reasons.length > 0 ? `: ${reasons.join('; ')}` : '.'}`,
    )
  }

  return digest(question, sources)
}
