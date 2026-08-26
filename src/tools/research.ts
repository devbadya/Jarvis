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
 * The reason to do it here is not only the round budget. Reading more of the web
 * makes answers worse if all of it reaches the context — function-calling
 * accuracy falls by 7% to 91% as tool responses grow (arXiv:2505.10570), and
 * five pages at `read_page`'s cap would be 40,000 characters. So the pages are
 * read in full and quoted in part: the passages that bear on the question are
 * selected here, verbatim, and the rest is never sent. Five sources cost less
 * context than one whole page.
 *
 * Selection is lexical, for the same reason skill routing is: a dense retriever
 * would mean shipping a second model into an app whose premise is one download.
 * Paragraphs are scored by the question's terms, each weighted by how rare it is
 * across every paragraph the turn fetched — which is what makes a stop list
 * unnecessary, since a word that appears in all of them earns almost nothing
 * without anyone having to write it down.
 */

import { readPage, searchWeb, type SearchResult, type WebAccessConfig } from './web'

/**
 * How many results to ask for before narrowing them. Larger than `MAX_SOURCES`
 * because the narrowing drops duplicate hosts, and a page of results from one
 * newspaper should still leave five sources to read.
 */
const SEARCH_LIMIT = 8

/**
 * How many sources are consulted.
 *
 * The ceiling is the reader's, not the model's: search and `read_page` share 20
 * requests a minute per IP without a Jina key, so one call already spends six of
 * them and three questions in a minute is the honest limit. Raising this trades
 * a rate limit the user cannot see for sources the answer does not need.
 */
const MAX_SOURCES = 5

/** Two passages carry a claim and its context. A third is usually the same claim again. */
const MAX_PASSAGES_PER_SOURCE = 2

const MAX_PASSAGE_CHARS = 280

/** Shorter than this is a heading, a byline or a nav item rather than prose. */
const MIN_PASSAGE_CHARS = 60

/** Words, not characters: a long run of link text can clear the character floor. */
const MIN_PASSAGE_WORDS = 8

/**
 * The whole result, well under `read_page`'s 8,000. Five sources are worth
 * having because they are short; five sources at page length would be the
 * failure this tool exists to avoid.
 */
const MAX_DIGEST_CHARS = 4000

const WORD = /[\p{L}\p{N}]+/gu

function words(text: string): string[] {
  return [...text.toLowerCase().matchAll(WORD)].map((match) => match[0])
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
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

/**
 * Orders the results so that the first hit on each host comes before any second
 * hit on one, then takes the first `max`.
 *
 * "Many sources" has to mean many *different* sources: a search for a news story
 * returns four pages of the same newspaper, and reading all four is four reader
 * requests spent to hear one newsroom repeat itself. Reordering rather than
 * discarding is what keeps this from being a special case for Wikipedia, whose
 * results are all one host — there the list refills with further articles from
 * that host instead of collapsing to a single source.
 */
export function diverseFirst(results: SearchResult[], max: number): SearchResult[] {
  const hosts = new Set<string>()
  const urls = new Set<string>()
  const first: SearchResult[] = []
  const rest: SearchResult[] = []

  for (const result of results) {
    if (!result.url || urls.has(result.url)) continue
    urls.add(result.url)

    const host = hostOf(result.url)
    if (hosts.has(host)) {
      rest.push(result)
      continue
    }
    hosts.add(host)
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
 * What each word of the question is worth, measured over every paragraph the
 * turn fetched rather than over one page at a time.
 *
 * Pooling is what makes a stop list unnecessary, and it has to be pooled to
 * work: across a hundred paragraphs *the* appears in nearly all of them and ends
 * up worth about two per cent of *executive*, but within a single four-paragraph
 * page it can be exactly as rare and score just as high. Measured on one page,
 * "who is the chief executive of the airline" ranked the paragraph containing
 * *the airline* level with the one naming the chief executive.
 *
 * A length floor would be the cheap way to drop *of* and *is*, and it is the
 * wrong one: *UN*, *EU* and *AI* are two letters and are the whole question.
 */
function weigh(question: string, corpus: string[]): Map<string, number> {
  const terms = new Set(words(question).filter((term) => term.length > 1))
  const tokenized = corpus.map((paragraph) => new Set(words(paragraph)))

  const weights = new Map<string, number>()
  for (const term of terms) {
    const seen = tokenized.filter((paragraph) => paragraph.has(term)).length
    if (seen > 0) weights.set(term, inverseFrequency(seen, tokenized.length))
  }
  return weights
}

function score(text: string, weights: Map<string, number>): number {
  let total = 0
  for (const term of new Set(words(text))) total += weights.get(term) ?? 0
  return total
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
  const subject = `Researched "${question}" across ${sources.length} source${sources.length === 1 ? '' : 's'}`

  if (read === 0) return `${subject}; none could be opened, so these are search snippets only.`
  if (read === sources.length) return `${subject}, all read in full.`
  return `${subject}; ${read} read in full, ${sources.length - read} from the search snippet only.`
}

export function digest(question: string, sources: Source[]): string {
  const body = [header(question, sources), '', ...sources.map(entry)].join('\n')
  if (body.length <= MAX_DIGEST_CHARS) return body
  return `${body.slice(0, MAX_DIGEST_CHARS)}\n\n[Truncated: further sources were dropped.]`
}

function reasonsFrom(settled: PromiseSettledResult<unknown>[]): string {
  return settled
    .flatMap((outcome) =>
      outcome.status === 'rejected'
        ? [outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)]
        : [],
    )
    .join('; ')
}

/**
 * Searches, reads the most promising results in parallel and returns the
 * passages that bear on the question, each with the URL it came from.
 *
 * A page that fails is replaced by its search snippet rather than allowed to
 * take the answer down with it — the reader's per-minute budget is shared, so a
 * 429 on the fourth page is an ordinary event and not a reason to abandon the
 * three that arrived.
 */
export async function researchQuestion(question: string, config: WebAccessConfig): Promise<string> {
  const results = await searchWeb(question, SEARCH_LIMIT, config)
  if (results.length === 0) return `No results for "${question}".`

  const selected = diverseFirst(results, MAX_SOURCES)
  const settled = await Promise.allSettled(selected.map((result) => readPage(result.url, config)))

  const chosen = passagesFor(
    question,
    settled.map((outcome) => {
      if (outcome.status !== 'fulfilled') return []
      const { title, text } = outcome.value
      // A page the site refused to serve arrives as a 200 with prose on it. Left
      // in, it is a source that says nothing and cannot be told from one that
      // does; the search snippet for the same URL at least came from the index.
      return looksBlocked(title, text) ? [] : paragraphsOf(text)
    }),
  )

  const sources = selected.flatMap((result, at): Source[] => {
    const outcome = settled[at]
    const passages = chosen[at] ?? []

    if (outcome?.status === 'fulfilled' && passages.length > 0) {
      return [
        {
          url: outcome.value.url,
          title: outcome.value.title || result.title,
          passages,
          read: true,
        },
      ]
    }

    const snippet = collapse(result.snippet)
    if (!snippet) return []
    return [{ url: result.url, title: result.title, passages: [snippet], read: false }]
  })

  // Every source silent means the search found pages and nothing could be read
  // off any of them. Reporting that as a result would have the model relay it as
  // "there is nothing on this", which is the one thing it must not say.
  if (sources.length === 0) {
    const reasons = reasonsFrom(settled)
    throw new Error(
      `Found ${results.length} results for "${question}" but could not read any of them${reasons ? `: ${reasons}` : '.'}`,
    )
  }

  return digest(question, sources)
}
