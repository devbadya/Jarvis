import type { Connect, Plugin } from 'vite'
import type { ServerResponse } from 'node:http'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Dev-server endpoints backing the agent's network tools.
 *
 * The browser cannot reach arbitrary origins directly (CORS), and a search API
 * key must never reach client code, so both tools are proxied here. The same
 * handlers are reused by the serverless deployment described in the README.
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const FETCH_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 2_000_000
const MAX_TEXT_CHARS = 12_000

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

/** Blocks loopback, link-local, and RFC1918 ranges so the proxy can't be aimed at internal services. */
function isPrivateAddress(address: string): boolean {
  if (
    address === '::1' ||
    address.startsWith('fc') ||
    address.startsWith('fd') ||
    address.startsWith('fe80')
  ) {
    return true
  }
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Malformed URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed')
  }
  const host = url.hostname
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address)
  if (addresses.some(isPrivateAddress)) {
    throw new Error('Refusing to fetch a private or loopback address')
  }
  return url
}

async function fetchWithLimits(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, {
    ...init,
    headers: { 'user-agent': USER_AGENT, ...init?.headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  })
  if (!response.ok) {
    throw new Error(`Upstream responded with ${response.status}`)
  }
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > MAX_RESPONSE_BYTES) {
    throw new Error('Response too large')
  }
  const body = await response.text()
  return body.slice(0, MAX_RESPONSE_BYTES)
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    '#39': "'",
    apos: "'",
    nbsp: ' ',
  }
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase()
    if (key in named) return named[key]
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16))
    if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)))
    return match
  })
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/** DuckDuckGo's HTML endpoint needs no API key, which keeps first-run setup to zero configuration. */
export async function search(query: string, limit = 5): Promise<SearchResult[]> {
  const html = await fetchWithLimits('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: query }).toString(),
  })

  const results: SearchResult[] = []
  const linkPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetPattern = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
  const snippets = [...html.matchAll(snippetPattern)].map((match) => stripTags(match[1]))

  let match: RegExpExecArray | null
  let index = 0
  while ((match = linkPattern.exec(html)) !== null && results.length < limit) {
    let href = decodeEntities(match[1])
    // DuckDuckGo wraps outbound links in a redirector; unwrap to the real target.
    const redirected = /[?&]uddg=([^&]+)/.exec(href)
    if (redirected) href = decodeURIComponent(redirected[1])
    if (href.startsWith('//')) href = `https:${href}`
    results.push({ title: stripTags(match[2]), url: href, snippet: snippets[index] ?? '' })
    index += 1
  }
  return results
}

export async function readPage(rawUrl: string): Promise<{ url: string; title: string; text: string }> {
  const url = await assertPublicUrl(rawUrl)
  const html = await fetchWithLimits(url.toString())
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? url.hostname
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html
  return { url: url.toString(), title: stripTags(title), text: stripTags(body).slice(0, MAX_TEXT_CHARS) }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(body)
}

export function agentApi(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/api/')) return next()

    const run = async () => {
      if (url.pathname === '/api/search') {
        const query = url.searchParams.get('q')?.trim()
        if (!query) return sendJson(res, 400, { error: 'Missing query parameter "q"' })
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 5) || 5, 10)
        return sendJson(res, 200, { results: await search(query, limit) })
      }
      if (url.pathname === '/api/fetch') {
        const target = url.searchParams.get('url')
        if (!target) return sendJson(res, 400, { error: 'Missing query parameter "url"' })
        return sendJson(res, 200, await readPage(target))
      }
      return sendJson(res, 404, { error: 'Unknown endpoint' })
    }

    run().catch((error: unknown) => {
      sendJson(res, 502, { error: error instanceof Error ? error.message : 'Request failed' })
    })
  }

  return {
    name: 'jarvis:agent-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
