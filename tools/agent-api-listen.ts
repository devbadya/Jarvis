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
import { handleAgentApiRequest } from './agent-api.ts'

const PORT = Number(process.env.PORT) || 8787
const HOST = process.env.HOST ?? '0.0.0.0'
const ALLOWLIST = (process.env.PROXY_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

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

const server = createServer((req, res) => {
  void (async () => {
    if (!applyCors(req, res)) return
    if ((req.method ?? '').toUpperCase() === 'OPTIONS') {
      res.statusCode = 204
      res.end()
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
  if (ALLOWLIST.length > 0) console.log(`Origins: ${ALLOWLIST.join(', ')}`)
})
