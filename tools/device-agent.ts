/**
 * Opens apps and http(s) links for Jarvis. It listens on 127.0.0.1 only.
 *
 *   pnpm device
 *
 * Then paste http://127.0.0.1:8791 into Tools → Device agent URL. A phone is
 * not this process: it opens things on the computer it is running on. Do not
 * put this on the public tool proxy. That process is allowed to be reachable
 * from the internet; this one must not be.
 */

import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { planOpen, parseOpenTarget } from '../src/tools/device-open.ts'

const PORT = Number(process.env.DEVICE_PORT) || 8791
const HOST = '127.0.0.1'

const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://devbadya.github.io']

function allowedOrigins(): string[] {
  const fromEnv = (process.env.DEVICE_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  return fromEnv.length > 0 ? fromEnv : DEFAULT_ORIGINS
}

export function corsHeaders(origin: string | undefined, origins: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-private-network': 'true',
    'access-control-max-age': '600',
    vary: 'Origin',
  }
  if (origin && origins.includes(origin)) headers['access-control-allow-origin'] = origin
  return headers
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function launch(target: string): Promise<string> {
  const parsed = parseOpenTarget(target)
  const plan = planOpen(parsed, process.platform)
  return new Promise((resolve, reject) => {
    const child = spawn(plan.file, plan.args, {
      env: plan.env ? { ...process.env, ...plan.env } : process.env,
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve(parsed.kind === 'url' ? `Opened ${parsed.url}` : `Opened ${parsed.name}`)
    })
  })
}

const server = createServer((req, res) => {
  void handle(req, res)
})

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origins = allowedOrigins()
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  for (const [name, value] of Object.entries(corsHeaders(origin, origins))) res.setHeader(name, value)

  if (origin && !origins.includes(origin)) {
    res.statusCode = 403
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'Origin not allowed' }))
    return
  }

  if ((req.method ?? '').toUpperCase() === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/health' && (req.method ?? '').toUpperCase() === 'GET') {
    res.statusCode = 200
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (url.pathname !== '/open' || (req.method ?? '').toUpperCase() !== 'POST') {
    res.statusCode = 404
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'Unknown endpoint' }))
    return
  }

  try {
    const raw = await readBody(req)
    const body = JSON.parse(raw) as { target?: unknown }
    const target = String(body.target ?? '')
    const message = await launch(target)
    res.statusCode = 200
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ message }))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not open that'
    res.statusCode = 400
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: message }))
  }
}

server.listen(PORT, HOST, () => {
  console.log(`Jarvis device agent on http://${HOST}:${PORT}`)
  console.log('POST /open  { target }')
  console.log(`Origins: ${allowedOrigins().join(', ')}`)
})
