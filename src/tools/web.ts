/**
 * Browser-direct implementations of the agent's two network tools.
 *
 * There is no server in this project, so these requests leave the page itself.
 * That rules out most of the web: a browser may only read a response whose
 * origin opts in with CORS headers, and an arbitrary page does not — which is
 * why `read_page` goes through a reader service rather than fetching the page.
 * Every provider below was checked to send the headers this needs.
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
  note: 'Full web search including current events, with no key and no signup. Its results page is read through r.jina.ai, which allows 20 requests a minute without a key — a search and a page read spend one each.',
}

export const SEARCH_PROVIDERS: SearchProviderInfo[] = [
  DUCKDUCKGO_PROVIDER,
  {
    id: 'wikipedia',
    label: 'Wikipedia',
    note: 'Encyclopedic facts with a full lead paragraph each, straight from the MediaWiki API. Nothing about current events.',
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
 * The Tools panel and `searchWeb` both ask this, so the settings cannot promise
 * a search that then refuses — or warn about a key the provider never wanted.
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
  }
}

const REQUEST_TIMEOUT_MS = 20_000
const MAX_SNIPPET_CHARS = 600

const WIKIPEDIA_ENDPOINT = 'https://en.wikipedia.org/w/api.php'
const JINA_SEARCH_ENDPOINT = 'https://s.jina.ai/'
const LANGSEARCH_ENDPOINT = 'https://api.langsearch.com/v1/web-search'
const READER_ENDPOINT = 'https://r.jina.ai/'
/** The lite page carries the same results as the main one without the images and scripts. */
const DUCKDUCKGO_ENDPOINT = 'https://lite.duckduckgo.com/lite/'

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
  if (!response.ok) throw new Error(failureMessage(endpoint, response.status))
  return (await response.json()) as T
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

async function searchWikipedia(query: string, limit: number): Promise<SearchResult[]> {
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

  const payload = await requestJson<WikipediaResponse>(`${WIKIPEDIA_ENDPOINT}?${params.toString()}`, {
    label: 'Wikipedia',
  })

  // `generator=search` returns pages keyed by id, so ranking survives only in `index`.
  return Object.values(payload.query?.pages ?? {})
    .sort(
      (a, b) => Number(isDisambiguation(a)) - Number(isDisambiguation(b)) || (a.index ?? 0) - (b.index ?? 0),
    )
    .map((page) => ({
      title: page.title,
      url: page.fullurl ?? `https://en.wikipedia.org/?curid=${page.pageid}`,
      snippet: truncate(collapse(page.extract ?? ''), MAX_SNIPPET_CHARS),
    }))
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

/** Every hit on the lite page is `1.[Title](link)`, its snippet, then its display URL. */
const DUCKDUCKGO_HIT = /^\d+\.\[(.+)\]\((\S+)\)$/

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
 * Reads DuckDuckGo's lite results page out of the reader's markdown.
 *
 * Scraping a layout is more fragile than parsing an API, and this is the price
 * of a keyless provider. It is contained: the shape is asserted in the tests
 * against a captured page, and `searchDuckDuckGo` treats "parsed nothing" as a
 * failure rather than as an empty result set.
 */
export function parseDuckDuckGoResults(markdown: string): SearchResult[] {
  const results: SearchResult[] = []
  let title: string | undefined
  let url: string | undefined
  let lines: string[] = []

  const flush = (): void => {
    if (!title || !url) return
    // The last line of a hit is the display URL rather than prose, and it is
    // the one line that always begins with the host it points at.
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
    } else if (line && title) {
      lines.push(line)
    }
  }
  flush()

  return results
}

async function searchDuckDuckGo(
  query: string,
  limit: number,
  config: WebAccessConfig,
): Promise<SearchResult[]> {
  const target = `${DUCKDUCKGO_ENDPOINT}?q=${encodeURIComponent(query)}`
  const data = await readWithReader(target, 'DuckDuckGo through the reader', config)
  const content = data?.content ?? ''
  const results = parseDuckDuckGoResults(content).slice(0, limit)

  // A search that genuinely matched nothing and a page DuckDuckGo refused to
  // serve both arrive as prose with no hits in it. The difference matters: the
  // first is an answer, the second must not reach the model as "there is
  // nothing", which is what it would otherwise tell the user.
  if (results.length === 0 && !/no results/i.test(content)) {
    throw new Error(
      'DuckDuckGo returned nothing this parser could read. It may have refused the reader — try again in a moment.',
    )
  }

  return results
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
 * Reads a page through r.jina.ai, which reflects the request origin and returns
 * extracted markdown. Anonymous use is capped at 20 requests per minute per IP;
 * a key raises that.
 */
export async function readPage(rawUrl: string, config: WebAccessConfig): Promise<PageContent> {
  const url = assertPublicHttpUrl(rawUrl)

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
