/**
 * Handlers for the optional tool proxy: `/api/search` and `/api/fetch`.
 *
 * The published GitHub Pages site does not run this. `pnpm dev` does, via the
 * Vite plugin, and `pnpm proxy` runs the same handlers as a standalone server
 * so a hosted static build can point at them. Inference stays in the tab either
 * way — this process only fetches.
 *
 * A fetch-on-behalf proxy is a confused deputy. Every target is resolved and
 * refused if it lands on loopback, link-local or RFC1918, and redirects are
 * followed by hand so a public URL cannot bounce into one of those.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const FETCH_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 2_000_000
const MAX_TEXT_CHARS = 12_000
const MAX_SNIPPET_CHARS = 600
const MAX_REDIRECTS = 5
const MAX_SEARCH_LIMIT = 10

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

export interface AgentApiResult {
  status: number
  payload: unknown
}

const READABLE_TYPE = /text\/html|text\/plain|application\/xhtml|application\/xml|application\/json/i

/**
 * The two no-JavaScript results pages, then the POST endpoint the original
 * proxy used. One page is enough for a search to work and not enough for it to
 * keep working — the reader-backed client learned that the hard way.
 */
const DUCKDUCKGO_GET = ['https://duckduckgo.com/html/', 'https://lite.duckduckgo.com/lite/']
const DUCKDUCKGO_POST = 'https://html.duckduckgo.com/html/'

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase()
    if (key in NAMED_ENTITIES) return NAMED_ENTITIES[key] ?? match
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16))
    if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)))
    return match
  })
}

export function stripTags(html: string): string {
  return collapse(
    decodeEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  )
}

/** Blocks loopback, link-local, unique-local, and RFC1918 ranges. */
export function isPrivateAddress(address: string): boolean {
  const mapped = address.replace(/^::ffff:/i, '')
  if (mapped !== address) return isPrivateAddress(mapped)

  if (address === '::1' || address === '0.0.0.0') return true
  const lower = address.toLowerCase()
  if (
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80') ||
    lower.startsWith('ff')
  ) {
    return true
  }

  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false
  const [a, b] = parts
  if (a === undefined || b === undefined) return false
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/** Names a resolver would turn into a private address, caught before the lookup. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host.startsWith('[')) {
    return isPrivateAddress(host.slice(1, -1))
  }
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true
  }
  return isIP(host) !== 0 && isPrivateAddress(host)
}

/**
 * Resolves a hostname to addresses. Exposed so tests can stub it without
 * mocking `node:dns` — Vite already imported this module before the test file.
 */
export const resolveHostAddresses = {
  lookup: async (hostname: string): Promise<string[]> =>
    (await dnsLookup(hostname, { all: true })).map((entry) => entry.address),
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Malformed URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed')
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error('Refusing to fetch a private or loopback address')
  }
  if (isIP(url.hostname) !== 0) return url

  const addresses = await resolveHostAddresses.lookup(url.hostname)
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error('Refusing to fetch a private or loopback address')
  }
  return url
}

async function readLimitedBody(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > MAX_RESPONSE_BYTES) throw new Error('Response too large')
  const body = await response.text()
  if (body.length > MAX_RESPONSE_BYTES) throw new Error('Response too large')
  return body
}

/**
 * Fetches a URL after the SSRF checks, following redirects only onto other
 * public targets. `redirect: 'follow'` would let a public hop land on
 * 169.254.169.254; this will not.
 */
export async function fetchPublic(raw: string, init?: RequestInit): Promise<{ url: string; body: string }> {
  let current = await assertPublicUrl(raw)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current.toString(), {
      ...init,
      headers: { 'user-agent': USER_AGENT, ...init?.headers },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual',
    })

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('Redirect with no location')
      current = await assertPublicUrl(new URL(location, current).toString())
      continue
    }

    if (!response.ok) throw new Error(`Upstream responded with ${response.status}`)
    const type = response.headers.get('content-type') ?? ''
    if (type && !READABLE_TYPE.test(type)) {
      await response.body?.cancel()
      throw new Error(`Refusing to read ${type}`)
    }
    return { url: current.toString(), body: await readLimitedBody(response) }
  }

  throw new Error('Too many redirects')
}

function duckDuckGoUrl(endpoint: string, query: string, region?: string): string {
  const url = new URL(endpoint)
  url.searchParams.set('q', query)
  if (region) url.searchParams.set('kl', region)
  return url.toString()
}

/** DuckDuckGo wraps outbound links in a redirector; ads use the same shape without `uddg`. */
export function unwrapDuckDuckGoHref(href: string): string | undefined {
  let next = decodeEntities(href).trim()
  if (!next) return undefined
  if (next.startsWith('//')) next = `https:${next}`
  try {
    const url = new URL(next)
    const target = url.searchParams.get('uddg')
    if (target) return new URL(target).toString()
    if (/(^|\.)duckduckgo\.com$/i.test(url.hostname)) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

/**
 * Reads a DuckDuckGo HTML results page. The html endpoint uses `result__a`;
 * lite uses `result-link`. Both wrap the real target in `uddg`.
 */
export function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const results: SearchResult[] = []
  const seen = new Set<string>()

  const htmlLinks = [
    ...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi),
  ]
  const htmlSnippets = [
    ...html.matchAll(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi),
  ].map((match) => stripTags(match[1] ?? ''))

  htmlLinks.forEach((match) => {
    const url = unwrapDuckDuckGoHref(match[1] ?? '')
    const title = stripTags(match[2] ?? '')
    if (!url || !title || seen.has(url)) return
    seen.add(url)
    results.push({
      title,
      url,
      snippet: truncate(htmlSnippets[results.length] ?? '', MAX_SNIPPET_CHARS),
    })
  })

  if (results.length > 0) return results

  const liteLinks = [
    ...html.matchAll(/<a[^>]+class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi),
  ]
  const liteSnippets = [
    ...html.matchAll(/<td[^>]+class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/gi),
  ].map((match) => stripTags(match[1] ?? ''))

  liteLinks.forEach((match) => {
    const url = unwrapDuckDuckGoHref(match[1] ?? '')
    const title = stripTags(match[2] ?? '')
    if (!url || !title || seen.has(url)) return
    seen.add(url)
    results.push({
      title,
      url,
      snippet: truncate(liteSnippets[results.length] ?? '', MAX_SNIPPET_CHARS),
    })
  })

  return results
}

export function extractPage(html: string, fallbackTitle: string): { title: string; text: string } {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '') || fallbackTitle
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html
  return { title, text: stripTags(body).slice(0, MAX_TEXT_CHARS) }
}

export async function searchDuckDuckGo(
  query: string,
  limit: number,
  region?: string,
): Promise<SearchResult[]> {
  const capped = Math.min(Math.max(limit, 1), MAX_SEARCH_LIMIT)
  let failure: Error | undefined

  for (const endpoint of DUCKDUCKGO_GET) {
    try {
      const { body } = await fetchPublic(duckDuckGoUrl(endpoint, query, region), {
        headers: { accept: 'text/html' },
      })
      const results = parseDuckDuckGoHtml(body).slice(0, capped)
      if (results.length > 0) return results
      if (/no results/i.test(stripTags(body))) return []
      failure = new Error('DuckDuckGo returned nothing this parser could read.')
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
    }
  }

  try {
    const { body } = await fetchPublic(DUCKDUCKGO_POST, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
      body: new URLSearchParams({ q: query, ...(region ? { kl: region } : {}) }).toString(),
    })
    const results = parseDuckDuckGoHtml(body).slice(0, capped)
    if (results.length > 0) return results
    if (/no results/i.test(stripTags(body))) return []
    failure = new Error('DuckDuckGo returned nothing this parser could read.')
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error))
  }

  throw failure ?? new Error('DuckDuckGo returned nothing this parser could read.')
}

export async function readPage(rawUrl: string): Promise<PageContent> {
  const { url, body } = await fetchPublic(rawUrl)
  const page = extractPage(body, new URL(url).hostname)
  if (!page.text) throw new Error(`No readable content found at ${url}`)
  return { url, title: page.title, text: page.text }
}

function clampLimit(value: unknown): number {
  const n = Number(value ?? 5)
  if (!Number.isFinite(n)) return 5
  return Math.min(Math.max(Math.trunc(n) || 5, 1), MAX_SEARCH_LIMIT)
}

export async function routeAgentApi(
  method: string,
  pathname: string,
  body: unknown,
): Promise<AgentApiResult> {
  const verb = method.toUpperCase()

  if (pathname === '/api/health') {
    if (verb !== 'GET' && verb !== 'HEAD') return { status: 405, payload: { error: 'Method not allowed' } }
    return { status: 200, payload: { ok: true } }
  }

  if (pathname === '/api/search') {
    if (verb !== 'POST') return { status: 405, payload: { error: 'Method not allowed' } }
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    const query = String(payload.query ?? '').trim()
    if (!query) return { status: 400, payload: { error: 'Missing query' } }
    const region = String(payload.region ?? '').trim() || undefined
    try {
      return {
        status: 200,
        payload: { results: await searchDuckDuckGo(query, clampLimit(payload.limit), region) },
      }
    } catch (error) {
      return { status: 502, payload: { error: error instanceof Error ? error.message : 'Search failed' } }
    }
  }

  if (pathname === '/api/fetch') {
    if (verb !== 'POST') return { status: 405, payload: { error: 'Method not allowed' } }
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    const target = String(payload.url ?? '').trim()
    if (!target) return { status: 400, payload: { error: 'Missing url' } }
    try {
      return { status: 200, payload: await readPage(target) }
    } catch (error) {
      return { status: 502, payload: { error: error instanceof Error ? error.message : 'Fetch failed' } }
    }
  }

  if (pathname.startsWith('/api/')) return { status: 404, payload: { error: 'Unknown endpoint' } }
  return { status: 404, payload: { error: 'Unknown endpoint' } }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      const total = chunks.reduce((sum, part) => sum + part.length, 0)
      if (total > MAX_RESPONSE_BYTES) {
        reject(new Error('Request too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * True when the request was an agent-api path and has been answered.
 * False when the caller should pass the request on.
 */
export async function handleAgentApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/')) return false

  const verb = (req.method ?? 'GET').toUpperCase()
  if (verb === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return true
  }

  let parsed: unknown
  if (verb === 'POST' || verb === 'PUT' || verb === 'PATCH') {
    const raw = await readBody(req)
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw) as unknown
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' })
        return true
      }
    }
  }

  const result = await routeAgentApi(verb, url.pathname, parsed)
  sendJson(res, result.status, result.payload)
  return true
}
