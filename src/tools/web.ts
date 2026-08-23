/**
 * Browser-direct implementations of the agent's two network tools.
 *
 * There is no server in this project, so these requests leave the page itself.
 * That rules out most of the web: a browser may only read a response whose
 * origin opts in with CORS headers, and an arbitrary page does not — which is
 * why `read_page` goes through a reader service rather than fetching the page.
 * Every provider below was checked to send the headers this needs.
 *
 * Search providers other than Wikipedia want an API key. It is the user's own
 * key, entered at runtime and kept in localStorage; a key baked into the bundle
 * would be readable by anyone who loads the app.
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

export type SearchProvider = 'wikipedia' | 'tavily' | 'exa'

export interface WebAccessConfig {
  provider: SearchProvider
  /** Required by every provider except Wikipedia. */
  searchApiKey?: string
  /** Optional. Raises the reader's anonymous rate limit. */
  readerApiKey?: string
}

export interface SearchProviderInfo {
  id: SearchProvider
  label: string
  needsKey: boolean
  /** Shown under the provider choice, so the trade-off is visible before it bites. */
  note: string
  keyPlaceholder?: string
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
    id: 'tavily',
    label: 'Tavily',
    needsKey: true,
    note: 'Full web search. Free tier available; the key stays in this browser.',
    keyPlaceholder: 'tvly-…',
  },
  {
    id: 'exa',
    label: 'Exa',
    needsKey: true,
    note: 'Full web search. Free tier available; the key stays in this browser.',
    keyPlaceholder: 'Exa API key',
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
export function normalizeWebAccess(stored: Partial<WebAccessConfig>): WebAccessConfig {
  const known = SEARCH_PROVIDERS.find((entry) => entry.id === stored.provider)
  return { ...stored, provider: known?.id ?? DEFAULT_WEB_ACCESS.provider }
}

const REQUEST_TIMEOUT_MS = 20_000
const MAX_SNIPPET_CHARS = 600

const WIKIPEDIA_ENDPOINT = 'https://en.wikipedia.org/w/api.php'
const TAVILY_ENDPOINT = 'https://api.tavily.com/search'
const EXA_ENDPOINT = 'https://api.exa.ai/search'
const READER_ENDPOINT = 'https://r.jina.ai/'

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/** Turns transport failures into something the model can relay and the user can act on. */
function failureMessage(provider: string, status: number): string {
  if (status === 401 || status === 403) {
    return `${provider} rejected the API key (${status}). Check it under Tools → Web access.`
  }
  if (status === 429) {
    return `${provider} rate-limited this request (429). Wait a moment, or add an API key under Tools → Web access.`
  }
  return `${provider} responded with ${status}`
}

async function requestJson<T>(url: string, provider: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new Error(failureMessage(provider, response.status))
  return (await response.json()) as T
}

function requireKey(config: WebAccessConfig, provider: string): string {
  const key = config.searchApiKey?.trim()
  if (!key) throw new Error(`${provider} needs an API key. Add one under Tools → Web access.`)
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

  const payload = await requestJson<WikipediaResponse>(
    `${WIKIPEDIA_ENDPOINT}?${params.toString()}`,
    'Wikipedia',
  )

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

interface TavilyResponse {
  results?: { title?: string; url?: string; content?: string }[]
}

async function searchTavily(query: string, limit: number, apiKey: string): Promise<SearchResult[]> {
  const payload = await requestJson<TavilyResponse>(TAVILY_ENDPOINT, 'Tavily', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: limit, search_depth: 'basic' }),
  })

  return (payload.results ?? []).map((result) => ({
    title: result.title ?? '',
    url: result.url ?? '',
    snippet: truncate(collapse(result.content ?? ''), MAX_SNIPPET_CHARS),
  }))
}

interface ExaResponse {
  results?: { title?: string; url?: string; text?: string }[]
}

async function searchExa(query: string, limit: number, apiKey: string): Promise<SearchResult[]> {
  const payload = await requestJson<ExaResponse>(EXA_ENDPOINT, 'Exa', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      query,
      numResults: limit,
      contents: { text: { maxCharacters: MAX_SNIPPET_CHARS } },
    }),
  })

  return (payload.results ?? []).map((result) => ({
    title: result.title ?? '',
    url: result.url ?? '',
    snippet: truncate(collapse(result.text ?? ''), MAX_SNIPPET_CHARS),
  }))
}

export async function searchWeb(
  query: string,
  limit: number,
  config: WebAccessConfig,
): Promise<SearchResult[]> {
  switch (config.provider) {
    case 'tavily':
      return searchTavily(query, limit, requireKey(config, 'Tavily'))
    case 'exa':
      return searchExa(query, limit, requireKey(config, 'Exa'))
    default:
      return searchWikipedia(query, limit)
  }
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
  const readerKey = config.readerApiKey?.trim()

  const payload = await requestJson<ReaderResponse>(
    `${READER_ENDPOINT}${url.toString()}`,
    'The reader service',
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
