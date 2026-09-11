/**
 * Researching a question across several sources in one tool call.
 *
 * `web_search` and `read_page` can do this between them, and the model has to
 * chain them to get there: search, pick a result, read it, and — if it wants a
 * second opinion — read another. A turn is capped at `MAX_TOOL_ROUNDS` rounds,
 * so that chain runs out of budget at roughly two sources, and every link in it
 * is a decision a 0.8B model can get wrong. This is the `weather` shape applied
 * to the web: the fan-out happens here, and what reaches the model is one
 * compact result it did not have to assemble. When the passages agree on a
 * person or place, or a sentence states it as the predicate of the question,
 * that result opens with `Answer: Friedrich Merz.` so a 0.8B model can copy
 * the line rather than extract it from a list.
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

/**
 * Enough Wikipedia hits to rerank after a list and a same-word trap (capital
 * punishment) occupy the top of the index.
 */
const WIKI_SEARCH_LIMIT = 5

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
 * Nationality and country names that mean the same place.
 *
 * `related` only sees a shared prefix of five letters, so *russische* and
 * *Russland* look unrelated — and a page titled *Präsident Russlands* then
 * scores the same as any other president page on *präsident* alone. That is
 * how *Wer ist der russische Präsident?* could open a German Amtsträger line.
 */
const PLACE_FAMILY = [
  /^(russisch\w*|russian|russland\w*|russia)$/,
  /^(franz(?:ö|oe)sisch\w*|french|frankreich\w*|france)$/,
  /^(amerikanisch\w*|american|usa)$/,
  /^(britisch\w*|british|britain|england)$/,
  /^(deutsch\w*|german|deutschland\w*|germany)$/,
  /^(ukrainisch\w*|ukrainian|ukraine)$/,
  /^(chinesisch\w*|chinese|china)$/,
  /^(spanisch\w*|spanish|spanien\w*|spain)$/,
  /^(italienisch\w*|italian|italien\w*|italy)$/,
  /^(japanisch\w*|japanese|japan)$/,
  /^(europ(?:ä|ae)isch\w*|european|europa\w*|europe)$/,
  /^(indisch\w*|indian|indien\w*|india)$/,
  /^(t(?:ü|ue)rkisch\w*|turkish|t(?:ü|ue)rkei\w*|turkey)$/,
  /^(polnisch\w*|polish|polen\w*|poland)$/,
  /^(niederl(?:ä|ae)ndisch\w*|dutch|niederlande\w*|netherlands)$/,
  /^(brasilianisch\w*|brazilian|brasilien\w*|brazil)$/,
  /^(kanadisch\w*|canadian|kanada\w*|canada)$/,
  /^(australisch\w*|australian|australien\w*|australia)$/,
  /^(mexikanisch\w*|mexican|mexiko\w*|mexico)$/,
  /^(s(?:ü|ue)dkoreanisch\w*|korean|korea\w*)$/,
  /^(israelisch\w*|israeli|israel)$/,
  /^(schweizerisch\w*|swiss|schweiz\w*|switzerland)$/,
  /^(oesterreich\w*|österreich\w*|austrian|austria)$/,
]

function samePlace(a: string, b: string): boolean {
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  return PLACE_FAMILY.some((pattern) => pattern.test(left) && pattern.test(right))
}

/**
 * Whether the question named a country or nationality that this evidence never
 * mentions.
 *
 * An Amtsträger line is enough for *Wer ist der Bundeskanzler?* because that
 * question names no place. The same line on a German page must not become
 * `Answer: Friedrich Merz` for *russische Präsident* — that is the first
 * failure in the screenshot, and `wrong-fact` then forces the model to repeat
 * it.
 */
function fitsAskedPlace(question: string, evidence: string): boolean {
  const asked = words(question).filter((token) => PLACE_FAMILY.some((pattern) => pattern.test(token)))
  if (asked.length === 0) return true
  const present = words(evidence)
  return asked.every((token) => present.some((word) => samePlace(token, word)))
}

/**
 * Whether two tokens are the same word in different clothes.
 *
 * German office titles inflect: a question about the *Bundeskanzler* is
 * answered by a sentence about the *Bundeskanzlers* Amt, and treating those as
 * unrelated is what made a German page silent on a German question. A shared
 * prefix of five letters, with only a short suffix on either side, catches the
 * inflections without treating *news* as *newspaper*. A nationality and its
 * country are the same place even when the stems diverge (*russische* /
 * *Russland*).
 */
export function related(a: string, b: string): boolean {
  if (a === b) return true
  if (samePlace(a, b)) return true
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
 * A year in this century.
 *
 * Wikipedia names a current office holder in a one-line paragraph of its own —
 * *Amtsträger ist seit dem 6. Mai 2025 Friedrich Merz (CDU).* — which is shorter
 * than the prose floor and never repeats the office title. The year is what
 * distinguishes that claim from a heading, and what prefers it over the
 * etymology that otherwise wins on the title's own words.
 */
const THIS_CENTURY = /\b20\d{2}\b/

function dated(text: string): number {
  return THIS_CENTURY.test(text) ? 1 : 0
}

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
  const blocks = markdown
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
    .filter(Boolean)

  // A dated one-liner is usually the sentence that names the incumbent, sitting
  // on its own after a long definition. Joining it to the paragraph it follows
  // is what keeps it above the length floor without treating every short
  // sentence as prose.
  const merged: string[] = []
  for (const block of blocks) {
    if (
      merged.length > 0 &&
      block.length < MIN_PASSAGE_CHARS &&
      ENDS_A_SENTENCE.test(block) &&
      THIS_CENTURY.test(block)
    ) {
      merged[merged.length - 1] += ` ${block}`
      continue
    }
    merged.push(block)
  }

  return merged.filter(
    (block) =>
      block.length >= MIN_PASSAGE_CHARS &&
      words(block).length >= MIN_PASSAGE_WORDS &&
      ENDS_A_SENTENCE.test(block) &&
      !BOILERPLATE.test(block) &&
      !REFERENCE_LIST.test(block),
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
  const focused = focusQuery(question).toLowerCase()
  return results
    .map((result, at) => {
      const hay = `${result.title} ${result.snippet}`.toLowerCase()
      const phrase = focused.length >= 8 && hay.includes(focused) ? 1 : 0
      return { result, at, score: score(hay, weights) + phrase }
    })
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
  const extraWiki: SearchResult[] = []
  const extraOther: SearchResult[] = []
  for (const entry of extraReadable) {
    if (isWikipediaUrl(entry.url)) extraWiki.push(entry)
    else extraOther.push(entry)
  }

  // One Wikipedia slot, and it should be the article that answers — Huang on a
  // CEO question, not the company page that happened to rank first.
  const wikiRanked = rankBySnippet(question, [...wiki, ...extraWiki])
  const wikiLead = wikiRanked.slice(0, 1)
  const wikiMore = wikiRanked.slice(1)

  return [
    ...wikiLead,
    ...rankBySnippet(question, other),
    ...rankBySnippet(question, [...wikiMore, ...extraOther]),
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
  const windows: { text: string; score: number }[] = []

  for (let start = 0; start < sentences.length; start += 1) {
    let window = ''
    for (let end = start; end < sentences.length; end += 1) {
      const extended = window ? `${window} ${sentences[end]}` : (sentences[end] ?? '')
      if (extended.length > MAX_PASSAGE_CHARS) break
      window = extended
      windows.push({ text: window, score: score(window, weights) })
    }
  }

  const substantial = windows.filter((entry) => entry.text.length >= MIN_PASSAGE_CHARS)
  // A long lead names the incumbent in its last sentence. Scoring by the
  // question's words prefers the definition at the start, which never has the
  // year; if the paragraph is dated, only windows that kept the year compete.
  const datedWindows = substantial.filter((entry) => dated(entry.text) > 0)
  const pool =
    dated(paragraph) > 0 && datedWindows.length > 0
      ? datedWindows
      : substantial.length > 0
        ? substantial
        : windows

  let best = pool[0]
  for (const entry of pool) {
    if (
      best === undefined ||
      entry.score > best.score ||
      (entry.score === best.score && entry.text.length > best.text.length)
    ) {
      best = entry
    }
  }

  return best?.text || `${paragraph.slice(0, MAX_PASSAGE_CHARS).trimEnd()}…`
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
    .map((text, at) => ({ text, at, score: score(text, weights), dated: dated(text) }))
    .sort((a, b) => b.score - a.score || b.dated - a.dated || a.at - b.at)

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

/**
 * A proper-name token: capital letter, then letters, marks, hyphen or apostrophe.
 * A period is only an initial (`J.R.R.`), never a trailing full stop — otherwise
 * *Frank Herbert.* becomes the name and every later word-boundary check dies on
 * the extra dot.
 */
const NAME_TOKEN = String.raw`\p{Lu}(?:[\p{L}\p{M}'’-]+|\.(?=\p{Lu}))*`

/** Particles that sit inside a name without being a name themselves. */
const NAME_PARTICLE = 'von|van|de|da|di|del|der|den|la|le|bin|al|und|and|of'

const MULTI_NAME = new RegExp(
  `(?<!\\p{L})(?:${NAME_TOKEN})(?:\\s+(?:${NAME_PARTICLE}|${NAME_TOKEN})){1,4}(?!\\p{L})`,
  'gu',
)

const SINGLE_NAME = new RegExp(`(?<!\\p{L})(?:${NAME_TOKEN})(?!\\p{L})`, 'gu')

/**
 * Months, days and page chrome. A single capitalised token that is only one of
 * these is a heading, not an answer. Multi-word names that happen to contain
 * them (`Theresa May`) still pass, because the other token is the name.
 */
const NAME_STOP = new Set([
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'januar',
  'februar',
  'marz',
  'märz',
  'mai',
  'juni',
  'juli',
  'oktober',
  'dezember',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'montag',
  'dienstag',
  'mittwoch',
  'donnerstag',
  'freitag',
  'samstag',
  'sonntag',
  'wikipedia',
  'wikimedia',
  'retrieved',
  'abgerufen',
  'official',
  'homepage',
])

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function nameKey(text: string): string {
  return words(text).join(' ')
}

function namedInQuestion(candidate: string, question: string): boolean {
  const asked = new Set(words(question))
  const tokens = words(candidate)
  return tokens.length > 0 && tokens.every((token) => holds(asked, token))
}

function isStopName(text: string): boolean {
  const tokens = words(text)
  if (tokens.length === 0) return true
  if (tokens.length === 1) {
    const token = tokens[0] ?? ''
    if (token.length < 3 || NAME_STOP.has(token) || SHELL.has(token)) return true
    if (token.length <= 3 && /^\p{Lu}+$/u.test(text)) return true
  }
  return tokens.every((token) => NAME_STOP.has(token) || SHELL.has(token))
}

function hasQuestionTerm(passage: string, question: string): boolean {
  const present = new Set(words(passage))
  return [...questionTerms(question)].some((term) => term.length >= 3 && holds(present, term))
}

/**
 * Whether this passage states `name` as the thing the question asked for.
 *
 * *Paris is the capital*, *the capital is Paris*, *Ama Osei has led … as chief
 * executive*, *Amtsträger ist … Friedrich Merz*, *a novel by Frank Herbert*.
 * Being mentioned in the same paragraph is not enough — that is how a country
 * name sitting next to an office holder would win the slot.
 */
function statesAnswer(name: string, passage: string, question: string): boolean {
  const escaped = escapeRegExp(name)
  const authored = new RegExp(
    `(?:\\b(?:written\\s+)?by\\b|\\bvon\\b)\\s+${escaped}\\b|\\b${escaped}\\s+(?:wrote|authored|geschrieben)\\b`,
    'i',
  )
  if (authored.test(passage) && hasQuestionTerm(passage, question)) return true
  // `6. Mai 2025` is a German date; `[^.]` would stop at the day and miss the name.
  if (new RegExp(`amtstr[aä]ger\\b.{0,80}?\\b${escaped}`, 'i').test(passage)) return true

  for (const term of questionTerms(question)) {
    if (term.length < 3) continue
    const t = escapeRegExp(term)
    const asRole = new RegExp(
      `${escaped}\\s+(?:has\\s+)?(?:is|are|was|were|ist|sind|war|waren)\\s+(?:seit\\b[^.]{0,40}?\\s+)?(?:(?:the|der|die|das|ein|eine|a|an)\\s+)?(?:(?:current|ninth|tenth|aktuell(?:e[rsn]?))\\s+)?${t}`,
      'i',
    )
    const roleIs = new RegExp(
      `(?:(?:the|der|die|das)\\s+)?(?:(?:current|aktuell(?:e[rsn]?))\\s+)?${t}\\s+(?:is|are|was|were|ist|sind|war|waren)\\s+${escaped}`,
      'i',
    )
    const served = new RegExp(`${escaped}\\s+(?:has\\s+)?(?:led|served|been)\\b[^.]{0,48}\\b${t}`, 'i')
    if (asRole.test(passage) || roleIs.test(passage) || served.test(passage)) return true
  }
  return false
}

function namesIn(passage: string): string[] {
  MULTI_NAME.lastIndex = 0
  SINGLE_NAME.lastIndex = 0
  const multi = [...passage.matchAll(MULTI_NAME)].map((match) => collapse(match[0] ?? ''))
  const singles = [...passage.matchAll(SINGLE_NAME)].map((match) => collapse(match[0] ?? ''))
  const covered = new Set(multi.flatMap((name) => words(name)))
  const extra = singles.filter((name) => {
    const tokens = words(name)
    return tokens.length === 1 && !covered.has(tokens[0] ?? '')
  })
  return [...multi, ...extra].filter((name) => name.length > 0 && !isStopName(name))
}

interface Candidate {
  text: string
  sources: Set<number>
  dated: boolean
  patterned: boolean
}

function better(a: Candidate, b: Candidate): number {
  if (a.sources.size !== b.sources.size) return a.sources.size - b.sources.size
  if (a.patterned !== b.patterned) return a.patterned ? 1 : -1
  const aTokens = words(a.text).length
  const bTokens = words(b.text).length
  if (aTokens !== bTokens) return aTokens - bTokens
  if (a.dated !== b.dated) return a.dated ? 1 : -1
  return 0
}

/**
 * Questions whose answer is a number, not a name. A 0.8B model invents these
 * to three significant figures; the digest has to hand it the figure the way
 * it already hands it *Friedrich Merz*.
 */
const FIGURE_ASKED =
  /\b(population|einwohner(?:zahl)?|how much|wie viel(?:e)?|kostet|kosten|cost|price|preis)\b/i

export function wantsFigure(question: string): boolean {
  return FIGURE_ASKED.test(question)
}

const SCALE: Record<string, number> = {
  million: 1e6,
  millions: 1e6,
  millionen: 1e6,
  mio: 1e6,
  billion: 1e9,
  billions: 1e9,
  billionen: 1e9,
  mrd: 1e9,
  thousand: 1e3,
  thousands: 1e3,
  tausend: 1e3,
}

const CURRENCY: Record<string, string> = {
  $: 'usd',
  '€': 'eur',
  '£': 'gbp',
  '¥': 'jpy',
  yen: 'jpy',
  jpy: 'jpy',
  usd: 'usd',
  eur: 'eur',
  euro: 'eur',
  euros: 'eur',
  dollar: 'usd',
  dollars: 'usd',
  pound: 'gbp',
  pounds: 'gbp',
}

const FIGURE =
  /(?<![.\d])(?:([$€£¥])\s*)?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?:\s*(million(?:s|en)?|billion(?:s|en)?|mio\.?|mrd\.?|thousand(?:s)?|tausend))?(?:\s*(people|inhabitants?|einwohner(?:n|zahl)?|yen|jpy|usd|eur|euros?|dollars?|pounds?))?(?!\p{L}|\d)/giu

/**
 * Reads a written amount into a number. The last separator that is followed by
 * one or two digits is the decimal; every other comma or dot is a thousand
 * mark. That is what keeps *13.96 million* and *13.960.000* from collapsing
 * into the same parse.
 */
export function parseAmount(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')
  let normalized = text
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '')
  } else if (lastComma >= 0) {
    const commas = text.match(/,/g)?.length ?? 0
    const after = text.length - lastComma - 1
    normalized = commas > 1 || after === 3 ? text.replace(/,/g, '') : text.replace(',', '.')
  } else if (lastDot >= 0) {
    const dots = text.match(/\./g)?.length ?? 0
    const after = text.length - lastDot - 1
    if (dots > 1 || (dots === 1 && after === 3 && text.replace(/\./g, '').length >= 5)) {
      normalized = text.replace(/\./g, '')
    }
  }
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

interface FigureHit {
  text: string
  value: number
  currency: string | null
  unit: boolean
}

function figuresIn(passage: string): FigureHit[] {
  FIGURE.lastIndex = 0
  const hits: FigureHit[] = []
  for (const match of passage.matchAll(FIGURE)) {
    const symbol = match[1]
    const digits = match[2]
    const scaleWord = (match[3] ?? '').replace(/\./g, '').toLowerCase()
    const unitWord = (match[4] ?? '').toLowerCase()
    if (!digits) continue
    const base = parseAmount(digits)
    if (base === null) continue
    const scale = SCALE[scaleWord] ?? 1
    const value = base * scale
    const currency = symbol ? (CURRENCY[symbol] ?? null) : (CURRENCY[unitWord] ?? null)
    const unit = Boolean(scaleWord) || Boolean(unitWord) || Boolean(symbol)
    // A bare year is a date, not a population or a price.
    if (!unit && value >= 1900 && value <= 2100 && Number.isInteger(value)) continue
    // "3 airports" on a population page is not an answer.
    if (!unit && value < 1000) continue
    const text = collapse(match[0] ?? '')
    if (!text) continue
    hits.push({ text, value, currency, unit })
  }
  return hits
}

function figureKey(hit: FigureHit): string {
  const kind = hit.currency ?? 'n'
  if (hit.value <= 0) return `${kind}:0`
  const digits = Math.floor(Math.log10(hit.value))
  const mag = 10 ** Math.max(0, digits - 1)
  return `${kind}:${Math.round(hit.value / mag) * mag}`
}

function asksPrice(question: string): boolean {
  return /\b(how much|wie viel|kostet|kosten|cost|price|preis)\b/i.test(question)
}

function figureFitsQuestion(hit: FigureHit, question: string): boolean {
  if (asksPrice(question)) return hit.currency !== null
  if (/\b(population|einwohner)\b/i.test(question)) return hit.currency === null
  return true
}

function statesFigure(hit: FigureHit, passage: string, question: string): boolean {
  if (!hasQuestionTerm(passage, question) || !figureFitsQuestion(hit, question)) return false
  // *3,8 Millionen Einwohner* already is the claim; looking past the match
  // for *Einwohner* again is how a German page went silent.
  if (
    hit.unit &&
    /\b(million|einwohner|inhabitants?|people|yen|usd|eur|dollar|pound|euro)\b/i.test(hit.text)
  ) {
    return true
  }
  const escaped = escapeRegExp(hit.text)
  return new RegExp(
    `(?:population|einwohner|inhabitants?|people|kostet|kosten|cost|price|preis|costs?)[\\s\\S]{0,48}${escaped}|${escaped}[\\s\\S]{0,24}(?:million|einwohner|inhabitants?|people|yen|usd|eur|dollar|preis)`,
    'i',
  ).test(passage)
}

function morePrecise(a: FigureHit, b: FigureHit): FigureHit {
  const aDigits = a.text.replace(/\D/g, '').length
  const bDigits = b.text.replace(/\D/g, '').length
  if (a.unit !== b.unit) return a.unit ? a : b
  return aDigits >= bDigits ? a : b
}

/**
 * A figure the passages agree on, or `null` when they do not.
 *
 * Only runs when the question asked for a number. *What's the population of
 * Tokyo?* must not fall through to *Tokyo*; that is the name, not the answer.
 * Two sources within about ten per cent count as the same reading — 13.96
 * million and 14 million are one claim, 14 million and 11 million are not.
 */
export function extractFigure(question: string, sources: Source[]): string | null {
  const found = new Map<string, Candidate & { hit: FigureHit }>()

  for (const [at, source] of sources.entries()) {
    for (const passage of source.passages) {
      for (const hit of figuresIn(passage)) {
        if (!figureFitsQuestion(hit, question)) continue
        if (!fitsAskedPlace(question, `${source.title} ${source.url} ${passage}`)) continue
        const key = figureKey(hit)
        const current = found.get(key)
        const patterned = statesFigure(hit, passage, question)
        if (current) {
          current.sources.add(at)
          current.patterned = current.patterned || patterned
          const betterHit = morePrecise(hit, current.hit)
          current.hit = betterHit
          current.text = betterHit.text
          continue
        }
        found.set(key, {
          text: hit.text,
          sources: new Set([at]),
          dated: false,
          patterned,
          hit,
        })
      }
    }
  }

  const confident = [...found.values()].filter(
    (candidate) => candidate.sources.size >= 2 || candidate.patterned,
  )
  if (confident.length === 0) return null

  confident.sort((a, b) => better(b, a))
  const winner = confident[0]
  const runnerUp = confident[1]
  if (!winner) return null
  if (
    runnerUp &&
    runnerUp.sources.size === winner.sources.size &&
    runnerUp.patterned === winner.patterned &&
    figureKey(runnerUp.hit) !== figureKey(winner.hit)
  ) {
    return null
  }
  return winner.text
}

/**
 * A short extractive answer the model can copy, or `null` when nothing is
 * confident enough.
 *
 * Two sources naming the same person or place is enough. One source is enough
 * only when a sentence states that name as the predicate of the question —
 * *Paris is the capital*, *Amtsträger ist … Friedrich Merz* — because a lone
 * mention is how a country, a predecessor or a sentence-initial noun wins.
 * The subject's own name is never the answer: *Who is Elon Musk?* already
 * knows who, and the passages are a biography.
 *
 * A tie between two different names at the same confidence is left blank.
 * Inventing a one-liner is worse than making the model read the quotes.
 *
 * A question that asked for a figure — population, price — never falls
 * through to a name. *Tokyo* is not an answer to *how many people live there*.
 *
 * A nationality or country in the question has to appear in the same source.
 * *Amtsträger ist Friedrich Merz* answers *Bundeskanzler*; it does not answer
 * *russische Präsident*.
 */
export function extractAnswer(question: string, sources: Source[]): string | null {
  if (wantsFigure(question)) return extractFigure(question, sources)

  const found = new Map<string, Candidate>()

  for (const [at, source] of sources.entries()) {
    for (const passage of source.passages) {
      const when = dated(passage) > 0
      for (const name of namesIn(passage)) {
        if (namedInQuestion(name, question)) continue
        if (!fitsAskedPlace(question, `${source.title} ${source.url} ${passage}`)) continue
        const key = nameKey(name)
        if (!key) continue
        const current = found.get(key)
        if (current) {
          current.sources.add(at)
          current.dated = current.dated || when
          current.patterned = current.patterned || statesAnswer(name, passage, question)
          continue
        }
        found.set(key, {
          text: name,
          sources: new Set([at]),
          dated: when,
          patterned: statesAnswer(name, passage, question),
        })
      }
    }
  }

  // Drop a shorter name that only ever appears as part of a longer one
  // (`Ama` inside `Ama Osei`), so the one-liner is the full name.
  const keys = [...found.keys()]
  for (const shorter of keys) {
    if (keys.some((longer) => longer !== shorter && longer.includes(shorter) && found.has(longer))) {
      found.delete(shorter)
    }
  }

  const confident = [...found.values()].filter(
    (candidate) => candidate.sources.size >= 2 || candidate.patterned,
  )
  if (confident.length === 0) return null

  confident.sort((a, b) => better(b, a))
  const winner = confident[0]
  const runnerUp = confident[1]
  if (!winner) return null
  if (
    runnerUp &&
    runnerUp.sources.size === winner.sources.size &&
    runnerUp.patterned === winner.patterned &&
    runnerUp.dated === winner.dated &&
    nameKey(runnerUp.text) !== nameKey(winner.text)
  ) {
    return null
  }
  return winner.text
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
  const answer = extractAnswer(question, sources)
  const lead = answer ? [`Answer: ${answer}.`, ''] : []
  const body = [...lead, header(question, sources), '', ...sources.map(entry)].join('\n')
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
