/**
 * Standalone tool proxy for a static build that cannot host `/api` itself.
 *
 *   pnpm proxy
 *
 * Then paste http://localhost:8787 into Tools → Tool proxy URL, or set
 * VITE_AGENT_API_BASE to that origin when building. Bind it to a public host
 * only with PROXY_ORIGINS set, otherwise any site can aim this process at the
 * public internet. Railway injects PORT; listen on 0.0.0.0 so the edge can reach it.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createRateLimiter, handleAgentApiRequest } from './agent-api.ts'
import { chatPublicInfo } from './agent-chat.ts'

const PORT = Number(process.env.PORT) || 8787
const HOST = process.env.HOST ?? '0.0.0.0'
const ALLOWLIST = (process.env.PROXY_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const RATE_LIMIT = Number(process.env.PROXY_RATE_LIMIT ?? 30)
const RATE_WINDOW_MS = 60_000
const limiter = createRateLimiter(RATE_LIMIT, RATE_WINDOW_MS)

/**
 * Railway and every other edge terminate the connection themselves, so the
 * socket address is the proxy in front of us and would put every visitor in one
 * bucket. The left-most forwarded address is the caller.
 */
function callerKey(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  return first || req.socket.remoteAddress || 'unknown'
}

function allowedOrigin(req: IncomingMessage): string | undefined {
  const origin = req.headers.origin
  if (ALLOWLIST.length === 0) return origin ?? '*'
  if (origin && ALLOWLIST.includes(origin)) return origin
  return undefined
}

function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin
  if (ALLOWLIST.length > 0 && origin && !ALLOWLIST.includes(origin)) {
    res.statusCode = 403
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'Origin not allowed' }))
    return false
  }
  const allow = allowedOrigin(req)
  if (allow) res.setHeader('access-control-allow-origin', allow)
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-max-age', '600')
  return true
}

/**
 * Search and fetch without an Origin are annoying; chat without one is a bill.
 * When an allowlist is set, `/api/chat` requires a matching Origin so a curl
 * from the public internet cannot spend the model key.
 */
function chatOriginAllowed(req: IncomingMessage, pathname: string): boolean {
  if (pathname !== '/api/chat' || ALLOWLIST.length === 0) return true
  const origin = req.headers.origin
  return Boolean(origin && ALLOWLIST.includes(origin))
}

const server = createServer((req, res) => {
  void (async () => {
    if (!applyCors(req, res)) return
    if ((req.method ?? '').toUpperCase() === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!chatOriginAllowed(req, url.pathname)) {
      res.statusCode = 403
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'Origin not allowed' }))
      return
    }
    // Health is exempt: the platform polls it far more often than a person
    // searches, and a restart loop triggered by our own limit would be absurd.
    if (url.pathname !== '/api/health' && !limiter.take(callerKey(req))) {
      res.statusCode = 429
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('retry-after', String(Math.ceil(RATE_WINDOW_MS / 1000)))
      res.end(JSON.stringify({ error: 'Too many requests' }))
      return
    }
    const handled = await handleAgentApiRequest(req, res)
    if (!handled) {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'Unknown endpoint' }))
    }
  })().catch((error: unknown) => {
    if (!res.headersSent) {
      res.statusCode = 502
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Request failed' }))
    }
  })
})

server.listen(PORT, HOST, () => {
  console.log(`Jarvis tool proxy on http://${HOST}:${PORT}`)
  console.log('POST /api/search  { query, limit?, region? }')
  console.log('POST /api/fetch   { url }')
  const chat = chatPublicInfo()
  console.log(
    chat
      ? `POST /api/chat    hosted model ${chat.model}`
      : 'POST /api/chat    disabled (set ANTHROPIC_API_KEY)',
  )
  if (ALLOWLIST.length > 0) console.log(`Origins: ${ALLOWLIST.join(', ')}`)
  console.log(RATE_LIMIT > 0 ? `Rate limit: ${RATE_LIMIT} per minute per caller` : 'Rate limit: off')
})
