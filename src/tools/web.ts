/**
 * Browser-direct implementations of the agent's two network tools, plus an
 * optional path through a tool proxy.
 *
 * The published site has no server, so these requests leave the page itself.
 * That rules out most of the web: a browser may only read a response whose
 * origin opts in with CORS headers, and an arbitrary page does not — which is
 * why `read_page` goes through a reader service rather than fetching the page.
 * Every provider below was checked to send the headers this needs.
 *
 * When a proxy is configured (`proxyUrl`, or `VITE_AGENT_API_BASE` in
 * development) DuckDuckGo search and non-Wikipedia page reads go to
 * `/api/search` and `/api/fetch` instead. Wikipedia, LangSearch and Jina still
 * go direct: they already send CORS headers, and their keys must not travel
 * through a server of ours.
 *
 * A provider is only usable here if its *response* carries
 * `Access-Control-Allow-Origin` for this app's origin. Checking the preflight
 * is not enough and neither is checking from localhost: Tavily answers the
 * preflight with the origin reflected and then omits the header from the POST,
 * and Exa sends it for `http://localhost` only. Both looked fine in development
 * and failed on the deployed site. Verify with the real request and the real
 * origin before adding one.
 *
 * Jina and LangSearch want an API key. It is the user's own, entered at runtime
 * and kept in localStorage; a key baked into the bundle would be readable by
 * anyone who loads the app.
 *
 * No search engine offers a keyless JSON API a browser may read: measured from
 * the deployed origin, Marginalia answers 200 with no CORS header at all, and
 * DuckDuckGo's Instant Answer API sends one but returns an empty payload for
 * anything longer than a bare entity name. So the keyless provider borrows the
 * reader instead and points it at DuckDuckGo's lite results page — the reader
 * does send the header, and a results page is just a page.
 */

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface PageContent {
  url: string
  title: string
  text: string
}

export type SearchProvider = 'duckduckgo' | 'wikipedia' | 'langsearch' | 'jina'

/** The keys a provider can ask for, and the fields they are stored under. */
export type SearchKeyField = 'jinaApiKey' | 'langsearchApiKey'

export interface WebAccessConfig {
  provider: SearchProvider
  /**
   * One key for everything Jina serves: `s.jina.ai` search needs it, and the
   * reader — which backs `read_page` and the DuckDuckGo provider — is faster
   * and rate-limited less harshly with it.
   */
  jinaApiKey?: string
  /** Only the LangSearch provider uses this one; nothing else Jarvis calls accepts it. */
  langsearchApiKey?: string
  /**
   * Origin of an optional tool proxy, for example `http://localhost:8787`.
   * When set, DuckDuckGo search and page reads go there instead of through the
   * reader. Invalid values are ignored so a typo cannot take search down.
   */
  proxyUrl?: string
}

export interface SearchProviderInfo {
  id: SearchProvider
  label: string
  /** The key this provider cannot search without. Absent where it needs none. */
  keyField?: SearchKeyField
  /** Shown under the provider choice, so the trade-off is visible before it bites. */
  note: string
}

const DUCKDUCKGO_PROVIDER: SearchProviderInfo = {
  id: 'duckduckgo',
  label: 'DuckDuckGo',
  note: 'Full web search including current events, with no key and no signup. German questions prefer German results. Its results page is read through r.jina.ai, which allows 20 requests a minute without a key — a search and a page read spend one each.',
}

export const SEARCH_PROVIDERS: SearchProviderInfo[] = [
  DUCKDUCKGO_PROVIDER,
  {
    id: 'wikipedia',
    label: 'Wikipedia',
    note: 'Encyclopedic facts with a full lead paragraph each, in the language of the question. Nothing about current events.',
  },
  {
    id: 'langsearch',
    label: 'LangSearch',
    keyField: 'langsearchApiKey',
    note: 'Full web search from a search API, on a key that costs nothing: the free tier allows 1,000 searches a day and one a second. Its snippets are index text rather than prose, so they read less cleanly than the others.',
  },
  {
    id: 'jina',
    label: 'Jina',
    keyField: 'jinaApiKey',
    note: 'Full web search from a search API rather than a scraped results page. Needs a Jina key, which also raises the reader’s limits.',
  },
]

export function searchProviderInfo(id: SearchProvider): SearchProviderInfo {
  return SEARCH_PROVIDERS.find((entry) => entry.id === id) ?? DUCKDUCKGO_PROVIDER
}

/**
 * Which key the chosen provider is still waiting for, if any.
 *
 * The Tools panel warns from this and `searchWeb` refuses on the same condition,
 * so the settings cannot report a provider as ready that then refuses — or warn
 * about a key the provider never wanted.
 */
export function missingSearchKey(config: WebAccessConfig): SearchKeyField | undefined {
  const field = searchProviderInfo(config.provider).keyField
  return field !== undefined && !config[field]?.trim() ? field : undefined
}

export const DEFAULT_WEB_ACCESS: WebAccessConfig = { provider: DUCKDUCKGO_PROVIDER.id }

/**
 * localStorage survives upgrades, so it can hold a provider this build no longer
 * offers. Left alone that shows a radio group with nothing selected.
 */
export function normalizeWebAccess(
  stored: Partial<WebAccessConfig> & { readerApiKey?: string },
): WebAccessConfig {
  const known = SEARCH_PROVIDERS.find((entry) => entry.id === stored.provider)
  return {
    provider: known?.id ?? DEFAULT_WEB_ACCESS.provider,
    // An earlier build kept the Jina key under `readerApiKey`. It is the same
    // key, so carry it over; a Tavily or Exa key from that build is not and is
    // dropped along with the provider that used it.
    jinaApiKey: stored.jinaApiKey ?? stored.readerApiKey,
    langsearchApiKey: stored.langsearchApiKey,
    ...(stored.proxyUrl?.trim() ? { proxyUrl: stored.proxyUrl.trim() } : {}),
  }
}

/**
 * Where DuckDuckGo search and page reads should go, or `undefined` to stay
 * browser-direct. An empty string means same-origin `/api`, which is what
 * `pnpm dev` serves.
 *
 * An empty variable is not a proxy. A workflow that forwards an unset
 * repository variable produces `''`, and reading that as same-origin would
 * point every hosted visitor at a `/api` their host does not serve.
 */
export function configuredProxyBase(config: WebAccessConfig): string | undefined {
  const runtime = config.proxyUrl?.trim()
  if (runtime) {
    try {
      const url = new URL(runtime)
      if (url.protocol === 'http:' || url.protocol === 'https:') return runtime.replace(/\/$/, '')
    } catch {
      // Fall through to the build-time setting rather than failing the turn.
    }
  }

  const env = import.meta.env.VITE_AGENT_API_BASE
  if (typeof env !== 'string') return undefined
  const trimmed = env.trim()
  if (trimmed === '') return undefined
  if (trimmed === 'same-origin') return ''
  return trimmed.replace(/\/$/, '')
}

const REQUEST_TIMEOUT_MS = 20_000
const MAX_SNIPPET_CHARS = 600
/** Matches the cap `read_page` applies, so MediaWiki does not ship a longer extract than the reader would. */
const MAX_WIKIPEDIA_CHARS = 8000

const JINA_SEARCH_ENDPOINT = 'https://s.jina.ai/'
const LANGSEARCH_ENDPOINT = 'https://api.langsearch.com/v1/web-search'
const READER_ENDPOINT = 'https://r.jina.ai/'

type WikiLang = 'de' | 'en'

/**
 * Which Wikipedia edition a query should search, and which DuckDuckGo region it
 * should prefer. Umlauts are enough on their own. Bare `was` is also English
 * (*who was Ada Lovelace*), so it only counts next to a German verb.
 */
export function queryLanguage(query: string): WikiLang {
  if (/[äöüßÄÖÜ]/.test(query)) return 'de'
  if (
    /\b(wer|wen|wem|wessen|wieso|weshalb|warum|welche[rsn]?|aktuell(?:e[rn]?)?|nachrichten|bundeskanzler|suche|schau|finde|kostet|gewonnen)\b/i.test(
      query,
    ) ||
    /\bwas (ist|sind|war|waren|kostet|passiert|l(ä|ae)uft)\b/i.test(query) ||
    /\bwie (viel|hei(ß|ss)t|lautet)\b/i.test(query)
  ) {
    return 'de'
  }
  return 'en'
}

function wikipediaOrigin(lang: string): string {
  const safe = /^[a-z]{2,3}$/.test(lang) ? lang : 'en'
  return `https://${safe}.wikipedia.org`
}

function wikipediaApi(lang: string): string {
  return `${wikipediaOrigin(lang)}/w/api.php`
}

/**
 * The two no-JavaScript results pages DuckDuckGo serves, tried in this order.
 *
 * Asking only one of them made a passing outage a total one. Observed: the
 * reader could not load the lite page at all, waited on it and returned a 422,
 * while the html page answered the same query in the same second — and an hour
 * later both were fine. One page is enough for the search to work and not
 * enough for it to keep working, which is why there are two.
 *
 * The html page leads because it is the one that answered during that outage.
 */
const DUCKDUCKGO_ENDPOINTS = ['https://duckduckgo.com/html/', 'https://lite.duckduckgo.com/lite/']

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

export interface Endpoint {
  label: string
  /**
   * What to suggest on a 429. Only the keyless reader gets faster with a key,
   * so the other endpoints must not send the user to a setting that cannot help.
   */
  rateLimitHint?: string
}

/**
 * A response that arrived and was refused, carrying the status so a caller can
 * tell "this endpoint is broken, try another" from "this whole reader is out of
 * quota, and so is every other page behind it".
 */
export class EndpointError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'EndpointError'
    this.status = status
  }
}

/** Turns transport failures into something the model can relay and the user can act on. */
function failureMessage(endpoint: Endpoint, status: number): string {
  if (status === 401 || status === 403) {
    return `${endpoint.label} rejected the API key (${status}). Check it under Tools → Web access.`
  }
  if (status === 429) {
    const hint = endpoint.rateLimitHint ?? 'Wait a moment and try again.'
    return `${endpoint.label} rate-limited this request (429). ${hint}`
  }
  return `${endpoint.label} responded with ${status}`
}

/** Shared by every network tool, so they all fail with the same timeout and the same wording. */
export async function requestJson<T>(url: string, endpoint: Endpoint, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new EndpointError(failureMessage(endpoint, response.status), response.status)
  return (await response.json()) as T
}

interface ProxyErrorBody {
  error?: string
}

async function proxyRequest<T extends ProxyErrorBody>(
  base: string,
  path: string,
  body: unknown,
  label: string,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  let payload: T
  try {
    payload = (await response.json()) as T
  } catch {
    throw new EndpointError(failureMessage({ label }, response.status), response.status)
  }
  if (!response.ok) {
    throw new EndpointError(
      payload.error?.trim() || failureMessage({ label }, response.status),
      response.status,
    )
  }
  return payload
}

async function searchViaProxy(base: string, query: string, limit: number): Promise<SearchResult[]> {
  const payload = await proxyRequest<{ results?: SearchResult[]; error?: string }>(
    base,
    '/api/search',
    { query, limit, region: queryLanguage(query) === 'de' ? 'de-de' : undefined },
    'The tool proxy',
  )
  if (!payload.results) {
    throw new Error(payload.error?.trim() || 'The tool proxy returned no result set for this query.')
  }
  return payload.results.slice(0, limit)
}

async function fetchViaProxy(base: string, url: string): Promise<PageContent> {
  const page = await proxyRequest<PageContent & { error?: string }>(
    base,
    '/api/fetch',
    { url },
    'The tool proxy',
  )
  if (!page.text?.trim()) throw new Error(`No readable content found at ${url}`)
  return {
    url: page.url || url,
    title: collapse(page.title ?? '') || new URL(page.url || url).hostname,
    text: page.text.trim(),
  }
}

/** Refuses before the request rather than spending a round trip on a key that is not there. */
function requireKey(key: string | undefined, complaint: string): string {
  const trimmed = key?.trim()
  if (!trimmed) throw new Error(`${complaint}. Add one under Tools → Web access.`)
  return trimmed
}

interface WikipediaPage {
  pageid: number
  title: string
  index?: number
  extract?: string
  fullurl?: string
  pageprops?: { disambiguation?: string }
}

/**
 * A disambiguation page is the top hit for many plain names — searching Stripe
 * returns "Stripe, striped, or stripes may refer to:" ahead of Stripe, Inc. Its
 * extract carries no facts, and a 0.8B model will summarise whatever comes
 * first, so these are pushed to the end rather than dropped.
 */
function isDisambiguation(page: WikipediaPage): boolean {
  return page.pageprops?.disambiguation !== undefined
}

interface WikipediaResponse {
  query?: { pages?: Record<string, WikipediaPage> }
}

/**
 * A Wikipedia article URL, or null for anything else.
 *
 * The reader spends the shared 20-request budget; MediaWiki does not. Matching
 * here is what lets `read_page` take the cheap path on the pages a research
 * turn actually opens.
 */
export function wikipediaPage(url: URL): { lang: string; title?: string; pageid?: string } | null {
  const host = /^(?:([a-z]{2,3})\.)?(?:m\.)?wikipedia\.org$/i.exec(url.hostname)
  if (!host) return null
  const lang = (host[1] ?? 'en').toLowerCase()

  const wiki = /^\/wiki\/(.+)$/.exec(url.pathname)
  if (wiki?.[1]) {
    try {
      return { lang, title: decodeURIComponent(wiki[1]) }
    } catch {
      return { lang, title: wiki[1] }
    }
  }

  const title = url.searchParams.get('title')
  if (title) return { lang, title }
  const pageid = url.searchParams.get('curid')
  if (pageid) return { lang, pageid }
  return null
}

async function searchWikipediaEdition(lang: WikiLang, query: string, limit: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: String(limit),
    prop: 'extracts|info|pageprops',
    exintro: '1',
    explaintext: '1',
    // Explicit so the number of extracts never rides on the API's default.
    exlimit: 'max',
    inprop: 'url',
    ppprop: 'disambiguation',
    format: 'json',
    // The MediaWiki API withholds `Access-Control-Allow-Origin` unless the
    // request asks for anonymous cross-origin access by name.
    origin: '*',
  })

  const origin = wikipediaOrigin(lang)
  const payload = await requestJson<WikipediaResponse>(`${wikipediaApi(lang)}?${params.toString()}`, {
    label: 'Wikipedia',
  })

  // `generator=search` returns pages keyed by id, so ranking survives only in `index`.
  return Object.values(payload.query?.pages ?? {})
    .sort(
      (a, b) => Number(isDisambiguation(a)) - Number(isDisambiguation(b)) || (a.index ?? 0) - (b.index ?? 0),
    )
    .map((page) => ({
      title: page.title,
      url: page.fullurl ?? `${origin}/?curid=${page.pageid}`,
      snippet: truncate(collapse(page.extract ?? ''), MAX_SNIPPET_CHARS),
    }))
}

async function searchWikipedia(query: string, limit: number): Promise<SearchResult[]> {
  const lang = queryLanguage(query)
  const results = await searchWikipediaEdition(lang, query, limit)
  // German Wikipedia is smaller. An empty result there is often a missing
  // article, not a missing subject, and English still has one.
  if (results.length > 0 || lang === 'en') return results
  return searchWikipediaEdition('en', query, limit)
}

interface JinaSearchResponse {
  data?: { title?: string; url?: string; description?: string }[]
}

async function searchJina(query: string, limit: number, apiKey: string): Promise<SearchResult[]> {
  const payload = await requestJson<JinaSearchResponse>(
    JINA_SEARCH_ENDPOINT,
    { label: 'Jina search' },
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        // Otherwise every result carries the whole page it points at, which is
        // tens of thousands of tokens for one search and money as well as context.
        'x-respond-with': 'no-content',
      },
      body: JSON.stringify({ q: query, num: limit }),
    },
  )

  return (payload.data ?? []).slice(0, limit).map((result) => ({
    title: result.title ?? '',
    url: result.url ?? '',
    snippet: truncate(collapse(result.description ?? ''), MAX_SNIPPET_CHARS),
  }))
}

interface LangSearchResponse {
  /** Set when the envelope carries a complaint rather than a result set. */
  msg?: string | null
  data?: { webPages?: { value?: { name?: string; url?: string; snippet?: string }[] } }
}

async function searchLangSearch(query: string, limit: number, apiKey: string): Promise<SearchResult[]> {
  const payload = await requestJson<LangSearchResponse>(
    LANGSEARCH_ENDPOINT,
    {
      label: 'LangSearch',
      rateLimitHint: 'A free key allows one search a second and 1,000 a day.',
    },
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      // `summary: true` returns the whole page behind each result, which is the
      // context a 0.8B model has for the answer as well as for the search.
      body: JSON.stringify({ query, count: limit, summary: false }),
    },
  )

  // LangSearch wraps its answer in an envelope, so a refusal it chose to report
  // with a 200 arrives as `msg` and no result set. Reading that as an empty
  // result set would tell the model there is nothing on the subject.
  const pages = payload.data?.webPages?.value
  if (!pages) {
    throw new Error(payload.msg?.trim() || 'LangSearch returned no result set for this query.')
  }

  return pages.slice(0, limit).map((page) => ({
    title: collapse(page.name ?? ''),
    url: page.url ?? '',
    // Snippets arrive as normalised index text — lower-cased, with spaces around
    // the punctuation. Collapsing the newlines is as far as this goes; putting
    // the prose back is not something a rule could do.
    snippet: truncate(collapse(page.snippet ?? ''), MAX_SNIPPET_CHARS),
  }))
}

interface ReaderResponse {
  data?: { title?: string; url?: string; content?: string }
}

/**
 * Both reader-backed calls share one budget — 20 requests a minute per IP
 * anonymously — so both point at the same way out of a 429.
 */
function readerEndpoint(label: string, apiKey?: string): Endpoint {
  return {
    label,
    rateLimitHint: apiKey
      ? 'Wait a moment and try again.'
      : 'Wait a moment, or add a Jina key under Tools → Web access to raise the limit.',
  }
}

/** The one request shape verified to survive CORS from the deployed origin. */
async function readWithReader(
  target: string,
  label: string,
  config: WebAccessConfig,
): Promise<ReaderResponse['data']> {
  const apiKey = config.jinaApiKey?.trim()

  const payload = await requestJson<ReaderResponse>(
    `${READER_ENDPOINT}${target}`,
    readerEndpoint(label, apiKey),
    {
      headers: {
        accept: 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
    },
  )

  return payload.data
}

/**
 * A hit on either page: `1.[Title](link)` on lite, `## [Title](link)` on html.
 */
const DUCKDUCKGO_HIT = /^(?:\d+\.|##\s+)\[(.+)\]\((\S+)\)$/

/** A whole line that is one markdown link, which is how the html page writes a snippet. */
const LINKED_LINE = /^\[(.+)\]\((\S+)\)$/

/**
 * The reader marks the query terms bold and drops the spaces around the marks,
 * so `Der**Bundeskanzler**der` and `**von****Bundeskanzler**` both arrive with
 * words fused. Substituting a space rather than deleting the marks is what
 * separates them again; `collapse` removes the ones that were not needed.
 *
 * It splits a word when only a stem was matched — `**earning**s` becomes
 * `earning s` — which is the cheaper of the two errors: a fused pair reads as
 * one nonexistent word, and the snippet exists to be read.
 */
function unbold(value: string): string {
  return value.replace(/\*\*/g, ' ')
}

/**
 * DuckDuckGo wraps each result in a redirect through its own domain and carries
 * the real target in `uddg`. Ads and the page's own furniture use links of the
 * same shape without one, which is what makes this the filter as well as the
 * decoder.
 */
function resultUrl(href: string): string | undefined {
  try {
    const target = new URL(href).searchParams.get('uddg')
    return target ? new URL(target).toString() : undefined
  } catch {
    return undefined
  }
}

/**
 * Reads a DuckDuckGo results page out of the reader's markdown.
 *
 * Scraping a layout is more fragile than parsing an API, and this is the price
 * of a keyless provider. It is contained: both shapes are asserted in the tests
 * against captured pages, and `searchDuckDuckGo` treats "parsed nothing" as a
 * failure rather than as an empty result set.
 *
 * The two pages write a snippet differently. Lite writes it as bare lines
 * ending in the display URL; html wraps every part of a hit — icon, display URL
 * and snippet — in a link back to the same target. So a linked line counts as
 * this hit's prose only when it points where the hit points, which is also what
 * keeps the page's own furniture, like its Feedback link, out of the snippet.
 */
export function parseDuckDuckGoResults(markdown: string): SearchResult[] {
  const results: SearchResult[] = []
  let title: string | undefined
  let url: string | undefined
  let lines: string[] = []

  const flush = (): void => {
    if (!title || !url) return
    // On lite the last line of a hit is the display URL rather than prose, and
    // it is the one line that always begins with the host it points at.
    const host = new URL(url).hostname
    const prose = lines.at(-1)?.startsWith(host) === true ? lines.slice(0, -1) : lines
    results.push({
      title: collapse(unbold(title)),
      url,
      snippet: truncate(collapse(unbold(prose.join(' '))), MAX_SNIPPET_CHARS),
    })
  }

  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    const hit = DUCKDUCKGO_HIT.exec(line)
    if (hit) {
      flush()
      title = hit[1]
      url = resultUrl(hit[2] ?? '')
      lines = []
      continue
    }
    if (!line || !title) continue

    // The icon and display-URL line, which carries no prose and does not always
    // end at the link, so it is recognised by the image rather than by shape.
    if (line.includes('![Image')) continue

    const linked = LINKED_LINE.exec(line)
    if (!linked) {
      lines.push(line)
      continue
    }
    if (url && resultUrl(linked[2] ?? '') === url) lines.push(linked[1] ?? '')
  }
  flush()

  return results
}

const UNREADABLE =
  'DuckDuckGo returned nothing this parser could read. It may have refused the reader — try again in a moment.'

function duckDuckGoTarget(endpoint: string, query: string): string {
  const target = `${endpoint}?q=${encodeURIComponent(query)}`
  // `kl` is DDG's region. English questions keep the unregionalised URL the
  // parser and the tests already know; German ones prefer German sites.
  return queryLanguage(query) === 'de' ? `${target}&kl=de-de` : target
}

/**
 * Asks each results page in turn and returns the first that could be read.
 *
 * A page the reader cannot fetch is the failure this provider has actually had,
 * and it is transient, so it is worth another request rather than an apology.
 * The cost is that second request, and only on a query the first page could not
 * serve.
 */
async function searchDuckDuckGo(
  query: string,
  limit: number,
  config: WebAccessConfig,
): Promise<SearchResult[]> {
  let failure: Error | undefined

  for (const endpoint of DUCKDUCKGO_ENDPOINTS) {
    const target = duckDuckGoTarget(endpoint, query)
    let content: string

    try {
      content = (await readWithReader(target, 'DuckDuckGo through the reader', config))?.content ?? ''
    } catch (error) {
      // Both pages are fetched by the same reader on the same per-IP budget, so
      // a spent quota or a rejected key is not something the other one survives.
      if (error instanceof EndpointError && [401, 403, 429].includes(error.status)) throw error
      failure = error instanceof Error ? error : new Error(String(error))
      continue
    }

    const results = parseDuckDuckGoResults(content).slice(0, limit)
    if (results.length > 0) return results

    // A search that genuinely matched nothing and a page DuckDuckGo refused to
    // serve both arrive as prose with no hits in it. The difference matters: the
    // first is an answer, the second must not reach the model as "there is
    // nothing", which is what it would otherwise tell the user.
    if (/no results/i.test(content)) return []
    failure = new Error(UNREADABLE)
  }

  throw failure ?? new Error(UNREADABLE)
}

export async function searchWeb(
  query: string,
  limit: number,
  config: WebAccessConfig,
): Promise<SearchResult[]> {
  if (config.provider === 'jina') {
    return searchJina(query, limit, requireKey(config.jinaApiKey, 'Jina search needs a Jina API key'))
  }
  if (config.provider === 'langsearch') {
    return searchLangSearch(
      query,
      limit,
      requireKey(config.langsearchApiKey, 'LangSearch needs a LangSearch API key'),
    )
  }
  if (config.provider === 'wikipedia') {
    return searchWikipedia(query, limit)
  }
  const proxy = configuredProxyBase(config)
  if (proxy !== undefined) {
    try {
      return await searchViaProxy(proxy, query, limit)
    } catch {
      // The proxy is an optimisation, not a dependency. A hosted build points
      // every visitor at one process, so an outage, a spent budget or an
      // allowlist that has not caught up must cost a slower search rather than
      // the answer. Browser-direct is what this build did before the proxy.
    }
  }
  return searchDuckDuckGo(query, limit, config)
}

/** Literal private hosts only: a page has no resolver, so a name cannot be checked here. */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase()

  // Brackets are the only form a URL delivers an IPv6 literal in, and testing
  // for them is what stops the unique-local prefixes matching fcc.gov or fda.gov.
  if (host.startsWith('[')) {
    const address = host.slice(1, -1)
    return (
      address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80')
    )
  }

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true

  // The URL parser has already normalised integer and hex forms such as
  // http://2130706433/ into dotted quads, so matching octets is enough.
  const octets = host.split('.').map(Number)
  const [a, b] = octets
  if (octets.length !== 4 || a === undefined || b === undefined) return false
  if (octets.some((octet) => !Number.isInteger(octet))) return false
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/**
 * The reader runs on the public internet and cannot see the user's network, so
 * this is not the SSRF guard a proxy would need. It is here to fail clearly on
 * a target that could never work, and to hold the line if the reader is swapped.
 */
function assertPublicHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Malformed URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed')
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error('Refusing to read a private or loopback address')
  }
  return url
}

/**
 * Reads a Wikipedia article through MediaWiki instead of the page reader.
 *
 * The extract is plaintext, CORS-friendly, and does not spend the reader's
 * 20-request budget — which is the whole point, because a research turn that
 * searches and then opens the Wikipedia hit used to spend two of those on one
 * question. An empty or missing extract returns null so the caller can still
 * try the reader.
 */
async function readWikipediaPage(url: URL): Promise<PageContent | null> {
  const target = wikipediaPage(url)
  if (!target) return null

  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts|info',
    explaintext: '1',
    inprop: 'url',
    redirects: '1',
    format: 'json',
    origin: '*',
  })
  if (target.pageid) params.set('pageids', target.pageid)
  else if (target.title) params.set('titles', target.title)
  else return null

  const payload = await requestJson<WikipediaResponse>(`${wikipediaApi(target.lang)}?${params.toString()}`, {
    label: 'Wikipedia',
  })
  const page = Object.values(payload.query?.pages ?? {}).find((entry) => entry.extract?.trim())
  if (!page?.extract) return null

  // `exchars` is capped at 1,200 on Wikipedia, which cuts off before the
  // sentence that names a current office holder. Truncate here instead.
  return {
    url: page.fullurl ?? url.toString(),
    title: collapse(page.title) || url.hostname,
    text: page.extract.trim().slice(0, MAX_WIKIPEDIA_CHARS),
  }
}

/**
 * Reads a page through r.jina.ai, which reflects the request origin and returns
 * extracted markdown. Anonymous use is capped at 20 requests per minute per IP;
 * a key raises that.
 *
 * Wikipedia is the exception: MediaWiki already sends CORS headers and a
 * plaintext extract, so those URLs skip the reader. A configured tool proxy
 * is the other exception: it fetches the page itself, so the reader budget
 * is not spent.
 */
export async function readPage(rawUrl: string, config: WebAccessConfig): Promise<PageContent> {
  const url = assertPublicHttpUrl(rawUrl)

  if (wikipediaPage(url)) {
    try {
      const page = await readWikipediaPage(url)
      if (page?.text) return page
    } catch {
      // Wikipedia is the cheap path, not the only one. A MediaWiki failure still
      // has the reader behind it.
    }
  }

  const proxy = configuredProxyBase(config)
  if (proxy !== undefined) {
    try {
      return await fetchViaProxy(proxy, url.toString())
    } catch {
      // Same bargain as search: the reader behind this still works, and a page
      // the proxy could not fetch is worth one more attempt rather than an
      // apology. `assertPublicHttpUrl` already refused the private targets, so
      // nothing the proxy blocks on principle reaches this line.
    }
  }

  const data = await readWithReader(url.toString(), 'The page reader', config)
  if (!data?.content) throw new Error(`No readable content found at ${url.toString()}`)

  // Left at full length: `read_page` in builtins.ts owns the cap that matters,
  // which is how much of this reaches the model's context.
  return {
    url: data.url ?? url.toString(),
    title: collapse(data.title ?? '') || url.hostname,
    text: data.content.trim(),
  }
}
