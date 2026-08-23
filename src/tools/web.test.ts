import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeWebAccess, readPage, searchWeb, type SearchProvider, type WebAccessConfig } from './web'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn(async () => responses.shift() ?? jsonResponse({}))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Reads the request the code under test actually sent. */
function lastRequest(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit | undefined]
  return {
    url: new URL(url),
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
  }
}

const wikipedia: WebAccessConfig = { provider: 'wikipedia' }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchWeb with Wikipedia', () => {
  const payload = {
    query: {
      pages: {
        // Keyed by page id and deliberately out of rank order, as the API returns them.
        '77': { pageid: 77, title: 'Second', index: 2, extract: 'Runner  up.', fullurl: 'https://w/2' },
        '12': { pageid: 12, title: 'First', index: 1, extract: 'Best\nmatch.', fullurl: 'https://w/1' },
      },
    },
  }

  it('asks for anonymous cross-origin access and returns results in rank order', async () => {
    const fetchMock = stubFetch(jsonResponse(payload))

    const results = await searchWeb('webgpu', 2, wikipedia)

    const { url } = lastRequest(fetchMock)
    expect(url.hostname).toBe('en.wikipedia.org')
    // Without origin=* the API withholds the CORS header and the browser drops the response.
    expect(url.searchParams.get('origin')).toBe('*')
    expect(url.searchParams.get('gsrsearch')).toBe('webgpu')
    expect(url.searchParams.get('gsrlimit')).toBe('2')
    expect(results.map((result) => result.title)).toEqual(['First', 'Second'])
    expect(results[0]).toEqual({ title: 'First', url: 'https://w/1', snippet: 'Best match.' })
  })

  it('builds a page URL when the API omits one', async () => {
    stubFetch(jsonResponse({ query: { pages: { '5': { pageid: 5, title: 'Solo', index: 1 } } } }))

    const results = await searchWeb('solo', 1, wikipedia)

    expect(results).toEqual([{ title: 'Solo', url: 'https://en.wikipedia.org/?curid=5', snippet: '' }])
  })

  it('demotes a disambiguation page below a real article', async () => {
    // Searching a plain name puts "X may refer to:" first, which is the one
    // result carrying no facts for the model to use.
    stubFetch(
      jsonResponse({
        query: {
          pages: {
            '1': {
              pageid: 1,
              title: 'Stripe',
              index: 1,
              extract: 'Stripe, striped, or stripes may refer to:',
              pageprops: { disambiguation: '' },
            },
            '2': { pageid: 2, title: 'Stripe, Inc.', index: 2, extract: 'A payments company.' },
          },
        },
      }),
    )

    const results = await searchWeb('Stripe', 2, wikipedia)

    expect(results.map((result) => result.title)).toEqual(['Stripe, Inc.', 'Stripe'])
  })

  it('returns nothing when the query matches no article', async () => {
    stubFetch(jsonResponse({ batchcomplete: '' }))

    expect(await searchWeb('zzzz', 5, wikipedia)).toEqual([])
  })
})

describe('searchWeb with Jina', () => {
  it('authenticates, suppresses page content, and maps the description to the snippet', async () => {
    const fetchMock = stubFetch(
      jsonResponse({
        data: [{ title: 'Post', url: 'https://x/1', description: 'Some  text.', content: 'huge' }],
      }),
    )

    const results = await searchWeb('news', 3, { provider: 'jina', jinaApiKey: ' jina_k ' })

    const { url, headers, body } = lastRequest(fetchMock)
    expect(url.href).toBe('https://s.jina.ai/')
    expect(headers.authorization).toBe('Bearer jina_k')
    // Each result would otherwise carry the whole page it points at.
    expect(headers['x-respond-with']).toBe('no-content')
    expect(body).toMatchObject({ q: 'news', num: 3 })
    expect(results).toEqual([{ title: 'Post', url: 'https://x/1', snippet: 'Some text.' }])
  })

  it('explains the missing key instead of calling the provider', async () => {
    const fetchMock = stubFetch()

    await expect(searchWeb('news', 5, { provider: 'jina' })).rejects.toThrow(
      /Jina search needs a Jina API key/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the API key when the provider rejects it', async () => {
    stubFetch(jsonResponse({}, 401))

    await expect(searchWeb('news', 5, { provider: 'jina', jinaApiKey: 'bad' })).rejects.toThrow(
      /rejected the API key \(401\)/,
    )
  })
})

describe('rate limiting', () => {
  // Wikipedia takes no key, so telling the user to add one would send them to a
  // setting that cannot help.
  it('does not suggest a key when a key would not help', async () => {
    stubFetch(jsonResponse({}, 429))

    await expect(searchWeb('news', 5, wikipedia)).rejects.toThrow(
      'Wikipedia rate-limited this request (429). Wait a moment and try again.',
    )
  })

  it('suggests a key when the reader is being used without one', async () => {
    stubFetch(jsonResponse({}, 429))

    await expect(readPage('https://example.com', wikipedia)).rejects.toThrow(/add a Jina key/)
  })

  it('stops suggesting a key once the reader has one', async () => {
    stubFetch(jsonResponse({}, 429))

    await expect(
      readPage('https://example.com', { provider: 'wikipedia', jinaApiKey: 'jina_k' }),
    ).rejects.toThrow('The page reader rate-limited this request (429). Wait a moment and try again.')
  })
})

describe('readPage', () => {
  const page = {
    data: { title: '  Example  Domain ', url: 'https://example.com/', content: 'Body text.' },
  }

  it('reads through the reader service and normalises the result', async () => {
    const fetchMock = stubFetch(jsonResponse(page))

    const result = await readPage('https://example.com', wikipedia)

    const { url, headers } = lastRequest(fetchMock)
    expect(url.href).toBe('https://r.jina.ai/https://example.com/')
    expect(headers.accept).toBe('application/json')
    expect(headers.authorization).toBeUndefined()
    expect(result).toEqual({
      url: 'https://example.com/',
      title: 'Example Domain',
      text: 'Body text.',
    })
  })

  it('authenticates when a Jina key is configured', async () => {
    const fetchMock = stubFetch(jsonResponse(page))

    await readPage('https://example.com', { provider: 'wikipedia', jinaApiKey: 'jina_k' })

    expect(lastRequest(fetchMock).headers.authorization).toBe('Bearer jina_k')
  })

  it('says so when the reader finds nothing to read', async () => {
    stubFetch(jsonResponse({ data: { title: 'Empty', content: '' } }))

    await expect(readPage('https://example.com', wikipedia)).rejects.toThrow(/No readable content/)
  })

  it.each([
    ['file:///etc/passwd', /http and https/],
    ['not a url', /Malformed URL/],
    ['http://localhost:8080/admin', /private or loopback/],
    ['http://printer.local/', /private or loopback/],
    ['http://192.168.1.1/', /private or loopback/],
    ['http://127.0.0.1/', /private or loopback/],
    // The URL parser folds these into 127.0.0.1 before the octet check sees them.
    ['http://2130706433/', /private or loopback/],
    ['http://[::1]/', /private or loopback/],
    ['http://[fd00::1]/', /private or loopback/],
  ])('refuses %s without issuing a request', async (target, expected) => {
    const fetchMock = stubFetch()

    await expect(readPage(target, wikipedia)).rejects.toThrow(expected)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // The unique-local IPv6 prefixes are fc00::/7 and fe80::/10, and a hostname is
  // not an IPv6 literal just because it starts with those letters.
  it.each(['https://fcc.gov/rules', 'https://fda.gov/food', 'https://fe80.example.com/'])(
    'reads %s rather than mistaking it for an IPv6 address',
    async (target) => {
      const fetchMock = stubFetch(jsonResponse({ data: { title: 'Page', content: 'Body.' } }))

      await expect(readPage(target, wikipedia)).resolves.toMatchObject({ title: 'Page' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )
})

describe('normalizeWebAccess', () => {
  it('keeps a provider this build still offers, along with the key', () => {
    expect(normalizeWebAccess({ provider: 'jina', jinaApiKey: 'k' })).toEqual({
      provider: 'jina',
      jinaApiKey: 'k',
    })
  })

  // Settings written by the build that offered Tavily and Exa.
  it('carries the old reader key over and drops a key for a removed provider', () => {
    expect(normalizeWebAccess({ provider: 'tavily' as SearchProvider, readerApiKey: 'jina_k' })).toEqual({
      provider: 'wikipedia',
      jinaApiKey: 'jina_k',
    })
  })

  it.each([{}, { provider: 'bing' as SearchProvider }])(
    'falls back to the default provider for %o',
    (stored) => {
      expect(normalizeWebAccess(stored).provider).toBe('wikipedia')
    },
  )
})
