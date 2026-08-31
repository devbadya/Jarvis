import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertPublicUrl,
  createRateLimiter,
  decodeEntities,
  extractPage,
  isBlockedHostname,
  isPrivateAddress,
  parseDuckDuckGoHtml,
  resolveHostAddresses,
  routeAgentApi,
  unwrapDuckDuckGoHref,
} from './agent-api.ts'

const realLookup = resolveHostAddresses.lookup

beforeEach(() => {
  resolveHostAddresses.lookup = async (host: string) => {
    if (host === 'private.example') return ['10.0.0.9']
    return ['93.184.216.34']
  }
})

afterEach(() => {
  resolveHostAddresses.lookup = realLookup
  vi.unstubAllGlobals()
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_MODEL
  delete process.env.ANTHROPIC_API_KEY
})

const HTML_RESULTS = `
<html><body>
  <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Finvestor.nvidia.com%2Fq2">NVIDIA Q2</a>
  <a class="result__snippet" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Finvestor.nvidia.com%2Fq2">Second quarter earnings.</a>
  <a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=example.com">Cheap GPUs</a>
  <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FWebGPU">WebGPU</a>
  <a class="result__snippet" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FWebGPU">A GPU API for the web.</a>
</body></html>
`

const LITE_RESULTS = `
<table>
  <tr>
    <td><a class="result-link" href="//lite.duckduckgo.com/lite/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">Example page</a></td>
  </tr>
  <tr>
    <td class="result-snippet">A page about examples.</td>
  </tr>
</table>
`

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.9',
    '172.16.5.5',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    '::ffff:127.0.0.1',
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each(['8.8.8.8', '93.184.216.34', '1.1.1.1'])('treats %s as public', (address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })
})

describe('isBlockedHostname', () => {
  it.each(['localhost', 'foo.localhost', 'printer.local', 'corp.internal', '127.0.0.1', '[::1]'])(
    'blocks %s before a lookup',
    (host) => {
      expect(isBlockedHostname(host)).toBe(true)
    },
  )

  it.each(['example.com', 'fcc.gov', 'fda.gov'])('leaves %s for the resolver', (host) => {
    expect(isBlockedHostname(host)).toBe(false)
  })
})

describe('assertPublicUrl', () => {
  it.each(['http://127.0.0.1/', 'http://localhost/admin', 'file:///etc/passwd', 'ftp://example.com/'])(
    'refuses %s without fetching it',
    async (raw) => {
      await expect(assertPublicUrl(raw)).rejects.toThrow(/http and https|private or loopback|Malformed/)
    },
  )

  it('refuses a name that resolves onto RFC1918', async () => {
    await expect(assertPublicUrl('https://private.example/secret')).rejects.toThrow(/private or loopback/)
  })

  it('accepts a name that resolves onto a public address', async () => {
    await expect(assertPublicUrl('https://example.com/page')).resolves.toMatchObject({
      hostname: 'example.com',
    })
  })
})

describe('parseDuckDuckGoHtml', () => {
  it('unwraps uddg links and skips ads that have none', () => {
    const results = parseDuckDuckGoHtml(HTML_RESULTS)
    expect(results.map((result) => result.title)).toEqual(['NVIDIA Q2', 'WebGPU'])
    expect(results[0]).toEqual({
      title: 'NVIDIA Q2',
      url: 'https://investor.nvidia.com/q2',
      snippet: 'Second quarter earnings.',
    })
  })

  it('reads the lite page’s result-link rows', () => {
    expect(parseDuckDuckGoHtml(LITE_RESULTS)).toEqual([
      { title: 'Example page', url: 'https://example.com/page', snippet: 'A page about examples.' },
    ])
  })
})

describe('unwrapDuckDuckGoHref', () => {
  it('decodes the uddg target and drops duckduckgo furniture', () => {
    expect(unwrapDuckDuckGoHref('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa')).toBe(
      'https://example.com/a',
    )
    expect(unwrapDuckDuckGoHref('https://duckduckgo.com/y.js?ad_domain=example.com')).toBeUndefined()
  })
})

describe('extractPage', () => {
  it('takes the title and strips tags from the body', () => {
    const page = extractPage(
      '<html><head><title>Hello &amp; Co</title></head><body><script>x()</script><p>Hi there.</p></body></html>',
      'fallback',
    )
    expect(page).toEqual({ title: 'Hello & Co', text: 'Hi there.' })
  })
})

describe('decodeEntities', () => {
  it('turns named and numeric entities back into characters', () => {
    expect(decodeEntities('A &amp; B &#39;quote&#39;')).toBe("A & B 'quote'")
  })
})

describe('routeAgentApi', () => {
  it('answers health without touching the network', async () => {
    await expect(routeAgentApi('GET', '/api/health', undefined)).resolves.toEqual({
      status: 200,
      payload: { ok: true },
    })
  })

  it('advertises hosted Opus on health when the Anthropic key is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    try {
      await expect(routeAgentApi('GET', '/api/health', undefined)).resolves.toEqual({
        status: 200,
        payload: { ok: true, chat: { model: 'claude-opus-5', provider: 'anthropic' } },
      })
    } finally {
      delete process.env.ANTHROPIC_API_KEY
    }
  })

  it('advertises hosted chat on health when a key is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.OPENAI_MODEL = 'gpt-4o-mini'
    try {
      await expect(routeAgentApi('GET', '/api/health', undefined)).resolves.toEqual({
        status: 200,
        payload: { ok: true, chat: { model: 'gpt-4o-mini', provider: 'openai' } },
      })
    } finally {
      delete process.env.OPENAI_API_KEY
      delete process.env.OPENAI_MODEL
    }
  })

  it('refuses a search with no query', async () => {
    await expect(routeAgentApi('POST', '/api/search', {})).resolves.toEqual({
      status: 400,
      payload: { error: 'Missing query' },
    })
  })

  it('refuses to fetch a loopback address', async () => {
    const result = await routeAgentApi('POST', '/api/fetch', { url: 'http://127.0.0.1/secret' })
    expect(result.status).toBe(502)
    expect(result.payload).toEqual({ error: 'Refusing to fetch a private or loopback address' })
  })

  it('refuses a non-http URL', async () => {
    const result = await routeAgentApi('POST', '/api/fetch', { url: 'file:///etc/passwd' })
    expect(result.status).toBe(502)
    expect(result.payload).toEqual({ error: 'Only http and https URLs are allowed' })
  })

  it('searches from a stubbed DuckDuckGo page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(HTML_RESULTS, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    )

    const result = await routeAgentApi('POST', '/api/search', { query: 'webgpu', limit: 5 })
    expect(result.status).toBe(200)
    expect(result.payload).toEqual({
      results: [
        { title: 'NVIDIA Q2', url: 'https://investor.nvidia.com/q2', snippet: 'Second quarter earnings.' },
        { title: 'WebGPU', url: 'https://en.wikipedia.org/wiki/WebGPU', snippet: 'A GPU API for the web.' },
      ],
    })
  })

  it('reads a stubbed page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html><title>Doc</title><body><p>Readable text here.</p></body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
      ),
    )

    const result = await routeAgentApi('POST', '/api/fetch', { url: 'https://example.com/doc' })
    expect(result.status).toBe(200)
    expect(result.payload).toEqual({
      url: 'https://example.com/doc',
      title: 'Doc',
      text: 'Readable text here.',
    })
  })

  it('does not follow a redirect onto a private address', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://127.0.0.1/metadata' },
          }),
      ),
    )

    const result = await routeAgentApi('POST', '/api/fetch', { url: 'https://example.com/go' })
    expect(result.status).toBe(502)
    expect(result.payload).toEqual({ error: 'Refusing to fetch a private or loopback address' })
  })
})

describe('createRateLimiter', () => {
  it('allows the quota and refuses the next call', () => {
    const limiter = createRateLimiter(3, 60_000)
    expect([1, 2, 3].map(() => limiter.take('1.2.3.4', 1000))).toEqual([true, true, true])
    expect(limiter.take('1.2.3.4', 1000)).toBe(false)
  })

  it('counts each caller on its own', () => {
    const limiter = createRateLimiter(1, 60_000)
    expect(limiter.take('1.2.3.4', 1000)).toBe(true)
    expect(limiter.take('1.2.3.4', 1000)).toBe(false)
    expect(limiter.take('5.6.7.8', 1000)).toBe(true)
  })

  it('lets the window slide rather than resetting on a tick', () => {
    const limiter = createRateLimiter(2, 60_000)
    limiter.take('1.2.3.4', 1000)
    limiter.take('1.2.3.4', 30_000)
    expect(limiter.take('1.2.3.4', 50_000)).toBe(false)
    // The first call has aged out by now; the second has not.
    expect(limiter.take('1.2.3.4', 62_000)).toBe(true)
    expect(limiter.take('1.2.3.4', 62_000)).toBe(false)
  })

  // The map is the one thing here that grows with the number of strangers who
  // find the URL, so callers that stopped must not stay in it.
  it('forgets a caller that fell silent', () => {
    const limiter = createRateLimiter(1, 60_000)
    limiter.take('1.2.3.4', 1000)
    limiter.take('5.6.7.8', 200_000)
    expect(limiter.take('1.2.3.4', 200_000)).toBe(true)
  })

  it('is off when the limit is zero', () => {
    const limiter = createRateLimiter(0, 60_000)
    expect([1, 2, 3, 4].every(() => limiter.take('1.2.3.4', 1000))).toBe(true)
  })
})
