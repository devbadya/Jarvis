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
 * Jina wants an API key. It is the user's own, entered at runtime and kept in
 * localStorage; a key baked into the bundle would be readable by anyone who
 * loads the app.
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

export type SearchProvider = 'wikipedia' | 'jina'

export interface WebAccessConfig {
  provider: SearchProvider
  /** One key for both Jina services: search needs it, the reader is faster with it. */
  jinaApiKey?: string
}

export interface SearchProviderInfo {
  id: SearchProvider
  label: string
  needsKey: boolean
  /** Shown under the provider choice, so the trade-off is visible before it bites. */
  note: string
}

const WIKIPEDIA_PROVIDER: SearchProviderInfo = {
  id: 'wikipedia',
  label: 'Wikipedia',
  needsKey: false,
  note: 'No key, no signup. Encyclopedic facts only — it cannot answer questions about current events.',
}

export const SEARCH_PROVIDERS: SearchProviderInfo[] = [
  WIKIPEDIA_PROVIDER,
  {
    id: 'jina',
    label: 'Jina',
    needsKey: true,
    note: 'Full web search, including current events. Needs a Jina key, which also speeds up page reads.',
  },
]

export function searchProviderInfo(id: SearchProvider): SearchProviderInfo {
  return SEARCH_PROVIDERS.find((entry) => entry.id === id) ?? WIKIPEDIA_PROVIDER
}

export const DEFAULT_WEB_ACCESS: WebAccessConfig = { provider: WIKIPEDIA_PROVIDER.id }

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
  }
}

const REQUEST_TIMEOUT_MS = 20_000
const MAX_SNIPPET_CHARS = 600

const WIKIPEDIA_ENDPOINT = 'https://en.wikipedia.org/w/api.php'
const JINA_SEARCH_ENDPOINT = 'https://s.jina.ai/'
const READER_ENDPOINT = 'https://r.jina.ai/'

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

interface Endpoint {
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

async function requestJson<T>(url: string, endpoint: Endpoint, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new Error(failureMessage(endpoint, response.status))
  return (await response.json()) as T
}

function requireJinaKey(config: WebAccessConfig, label: string): string {
  const key = config.jinaApiKey?.trim()
  if (!key) throw new Error(`${label} needs a Jina API key. Add one under Tools → Web access.`)
  return key
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

export async function searchWeb(
  query: string,
  limit: number,
  config: WebAccessConfig,
): Promise<SearchResult[]> {
  if (config.provider === 'jina') {
    return searchJina(query, limit, requireJinaKey(config, 'Jina search'))
  }
  return searchWikipedia(query, limit)
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

interface ReaderResponse {
  data?: { title?: string; url?: string; content?: string }
}

/**
 * Reads a page through r.jina.ai, which reflects the request origin and returns
 * extracted markdown. Anonymous use is capped at 20 requests per minute per IP;
 * a key raises that.
 */
export async function readPage(rawUrl: string, config: WebAccessConfig): Promise<PageContent> {
  const url = assertPublicHttpUrl(rawUrl)
  const readerKey = config.jinaApiKey?.trim()

  const payload = await requestJson<ReaderResponse>(
    `${READER_ENDPOINT}${url.toString()}`,
    {
      label: 'The page reader',
      rateLimitHint: readerKey
        ? 'Wait a moment and try again.'
        : 'Wait a moment, or add a Jina key under Tools → Web access to raise the limit.',
    },
    {
      headers: {
        accept: 'application/json',
        ...(readerKey ? { authorization: `Bearer ${readerKey}` } : {}),
      },
    },
  )

  const data = payload.data
  if (!data?.content) throw new Error(`No readable content found at ${url.toString()}`)

  // Left at full length: `read_page` in builtins.ts owns the cap that matters,
  // which is how much of this reaches the model's context.
  return {
    url: data.url ?? url.toString(),
    title: collapse(data.title ?? '') || url.hostname,
    text: data.content.trim(),
  }
}
