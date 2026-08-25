import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  missingSearchKey,
  normalizeWebAccess,
  parseDuckDuckGoResults,
  readPage,
  searchWeb,
  type SearchProvider,
  type WebAccessConfig,
} from './web'

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

describe('searchWeb with DuckDuckGo', () => {
  const duckduckgo: WebAccessConfig = { provider: 'duckduckgo' }

  /**
   * Trimmed from a real r.jina.ai response for the lite results page, keeping
   * every shape that changes the outcome: a snippet that ends with the display
   * URL on its own line, one with the date glued to that URL, a promoted link
   * carrying no `uddg` target, and a hit with no snippet at all.
   */
  const resultsPage = [
    '1.[NVIDIA Announces Financial Results for Second Quarter Fiscal 2026](https://duckduckgo.com/l/?uddg=https%3A%2F%2Finvestor.nvidia.com%2Fnews%2Fq2%2F&rut=500bcb3e)',
    '**NVIDIA** will conduct a conference call with analysts and investors',
    'to discuss its second quarter fiscal **2026** results.',
    'investor.nvidia.com/news/q2/ 2025-08-27T00:00:00.0000000',
    '',
    '2.[Fiscal 2026 Second Quarter](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fnvidianews.nvidia.com%2F_gallery%2Fdownload_pdf%2F68af%2F&rut=3a2244f8)',
    'Revenue of $46.7 billion, up 56% from a year ago',
    'nvidianews.nvidia.com/_gallery/download_pdf/68af/2025-08-27T00:00:00.0000000',
    '',
    '3.[Cheap GPUs, buy now](https://duckduckgo.com/y.js?ad_domain=example.com&ad_provider=bingv7aa)',
    'example.com',
    '',
    '4.[NVDA Earnings Report](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fmarketbeat.com%2Fnvda%2F&rut=a563341f)',
    'marketbeat.com/nvda/',
  ].join('\n')

  /**
   * The same, from the html page, which writes a hit as a heading and wraps its
   * icon, display URL and snippet in links back to the same target. Trimmed
   * from a real r.jina.ai response, including the Feedback link the page ends
   * with — it is a linked line like a snippet and points somewhere else.
   */
  const htmlResultsPage = [
    '[](https://duckduckgo.com/html/ "DuckDuckGo")',
    '',
    '## [António Guterres - Wikipedia](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FAnt%25C3%25B3nio_Guterres&rut=151aca)',
    '',
    '[![Image 3](https://external-content.duckduckgo.com/ip3/en.wikipedia.org.ico)](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FAnt%25C3%25B3nio_Guterres&rut=151aca)[en.wikipedia.org/wiki/António_Guterres](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FAnt%25C3%25B3nio_Guterres&rut=151aca)',
    '',
    '[António Manuel de Oliveira Guterres (born 30 April 1949) is a Portuguese politician **who**, since 2017, has served as the ninth **Secretary-General****of****the****United****Nations**.](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FAnt%25C3%25B3nio_Guterres&rut=151aca)',
    '',
    '## [Secretary-General | United Nations](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.un.org%2Fsg%2Fen&rut=1be8b8)',
    '',
    // The display-URL line does not always end at the link: a date can follow it.
    '[![Image 4](https://external-content.duckduckgo.com/ip3/www.un.org.ico)](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.un.org%2Fsg%2Fen&rut=1be8b8)[www.un.org/sg/en](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.un.org%2Fsg%2Fen&rut=1be8b8) 2026-06-15T00:00:00.0000000',
    '',
    '[António Guterres, **United****Nations****Secretary-General**](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.un.org%2Fsg%2Fen&rut=1be8b8)',
    '',
    '[Feedback](https://duckduckgo.com/feedback.html)',
  ].join('\n')

  it('reads the html results page through the reader and returns the real targets', async () => {
    const fetchMock = stubFetch(jsonResponse({ data: { content: htmlResultsPage } }))

    const results = await searchWeb('who is the secretary-general', 5, duckduckgo)

    // html leads because it is the page that answered while the reader could
    // not load lite. Everything else about the request is unchanged.
    expect(lastRequest(fetchMock).url.href).toBe(
      'https://r.jina.ai/https://duckduckgo.com/html/?q=who%20is%20the%20secretary-general',
    )
    expect(results).toEqual([
      {
        title: 'António Guterres - Wikipedia',
        url: 'https://en.wikipedia.org/wiki/Ant%C3%B3nio_Guterres',
        snippet:
          'António Manuel de Oliveira Guterres (born 30 April 1949) is a Portuguese politician who , since 2017, has served as the ninth Secretary-General of the United Nations .',
      },
      {
        title: 'Secretary-General | United Nations',
        url: 'https://www.un.org/sg/en',
        // Not "…Secretary-General Feedback": the page's own link points elsewhere.
        snippet: 'António Guterres, United Nations Secretary-General',
      },
    ])
  })

  it('falls back to the lite page when the html one cannot be read', async () => {
    const fetchMock = stubFetch(
      jsonResponse({ data: { content: 'Unfortunately, bots use DuckDuckGo too.' } }),
      jsonResponse({ data: { content: resultsPage } }),
    )

    const results = await searchWeb('nvidia', 5, duckduckgo)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(lastRequest(fetchMock).url.href).toBe(
      'https://r.jina.ai/https://lite.duckduckgo.com/lite/?q=nvidia',
    )
    expect(results[0]?.url).toBe('https://investor.nvidia.com/news/q2/')
  })

  it('does not spend a second request when the reader itself is out of quota', async () => {
    // Both pages are read by the same reader on the same per-IP budget, so
    // asking again can only fail the same way and use up the retry.
    const fetchMock = stubFetch(jsonResponse({}, 429))

    await expect(searchWeb('nvidia', 5, duckduckgo)).rejects.toThrow('rate-limited')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads the lite results page through the reader and returns the real targets', async () => {
    const fetchMock = stubFetch(
      jsonResponse({ data: { content: '' } }),
      jsonResponse({ data: { content: resultsPage } }),
    )

    const results = await searchWeb('nvidia q2 2026 earnings', 5, duckduckgo)

    const { url, headers } = lastRequest(fetchMock)
    expect(url.href).toBe(
      'https://r.jina.ai/https://lite.duckduckgo.com/lite/?q=nvidia%20q2%202026%20earnings',
    )
    expect(headers.accept).toBe('application/json')
    // Keyless is the point of this provider.
    expect(headers.authorization).toBeUndefined()
    expect(results).toEqual([
      {
        title: 'NVIDIA Announces Financial Results for Second Quarter Fiscal 2026',
        url: 'https://investor.nvidia.com/news/q2/',
        snippet:
          'NVIDIA will conduct a conference call with analysts and investors to discuss its second quarter fiscal 2026 results.',
      },
      {
        title: 'Fiscal 2026 Second Quarter',
        url: 'https://nvidianews.nvidia.com/_gallery/download_pdf/68af/',
        snippet: 'Revenue of $46.7 billion, up 56% from a year ago',
      },
      { title: 'NVDA Earnings Report', url: 'https://marketbeat.com/nvda/', snippet: '' },
    ])
  })

  it('honours the limit', async () => {
    stubFetch(jsonResponse({ data: { content: htmlResultsPage } }))

    expect(await searchWeb('nvidia', 1, duckduckgo)).toHaveLength(1)
  })

  it('authenticates when a Jina key is configured, since the reader is quicker with one', async () => {
    const fetchMock = stubFetch(jsonResponse({ data: { content: htmlResultsPage } }))

    await searchWeb('nvidia', 5, { provider: 'duckduckgo', jinaApiKey: ' jina_k ' })

    expect(lastRequest(fetchMock).headers.authorization).toBe('Bearer jina_k')
  })

  it('reports a query that matched nothing as no results', async () => {
    stubFetch(jsonResponse({ data: { content: 'No results found for asdkjhasd.' } }))

    expect(await searchWeb('asdkjhasd', 5, duckduckgo)).toEqual([])
  })

  // A refused or redesigned results page must not reach the model as an empty
  // result set: it would answer that nothing on the subject exists.
  it('fails loudly when neither page holds anything it can read', async () => {
    stubFetch(
      jsonResponse({ data: { content: 'Unfortunately, bots use DuckDuckGo too.' } }),
      jsonResponse({ data: { content: 'Unfortunately, bots use DuckDuckGo too.' } }),
    )

    await expect(searchWeb('nvidia', 5, duckduckgo)).rejects.toThrow(/nothing this parser could read/)
  })

  it('offers the key as a way out of the reader’s rate limit', async () => {
    stubFetch(jsonResponse({}, 429))

    await expect(searchWeb('nvidia', 5, duckduckgo)).rejects.toThrow(
      'DuckDuckGo through the reader rate-limited this request (429). Wait a moment, or add a Jina key under Tools → Web access to raise the limit.',
    )
  })

  // Observed against the live page: the reader emits `Der**Bundeskanzler**der`
  // and `**von****Bundeskanzler**`, so deleting the marks fuses words that the
  // model then reads as one it has never seen.
  it('separates words the bold marks had fused', () => {
    const page = [
      '1.[Bundeskanzler](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F)',
      'Der**Bundeskanzler**der Bundesrepublik. Der Internetauftritt **von****Bundeskanzler** Friedrich Merz.',
      'example.com',
    ].join('\n')

    expect(parseDuckDuckGoResults(page)[0]?.snippet).toBe(
      'Der Bundeskanzler der Bundesrepublik. Der Internetauftritt von Bundeskanzler Friedrich Merz.',
    )
  })

  it('caps a long snippet', () => {
    const long = 'word '.repeat(400)
    const page = `1.[Title](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F)\n${long}\nexample.com`

    const [result] = parseDuckDuckGoResults(page)

    expect(result?.snippet).toHaveLength(601)
    expect(result?.snippet.endsWith('…')).toBe(true)
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

describe('searchWeb with LangSearch', () => {
  const langsearch: WebAccessConfig = { provider: 'langsearch', langsearchApiKey: ' sk-live ' }

  const payload = {
    code: 200,
    msg: null,
    data: {
      webPages: {
        value: [
          {
            name: 'Chancellor of Germany',
            url: 'https://en.wikipedia.org/wiki/Chancellor_of_Germany',
            snippet:
              'the chancellor of germany  is the head of government .\n friedrich merz holds the office .',
            summary: 'A much longer text this provider only sends when asked.',
          },
          { name: 'Bundeskanzler', url: 'https://www.bundeskanzler.de/', snippet: 'der bundeskanzler' },
        ],
      },
    },
  }

  it('authenticates, suppresses the long summaries, and maps the results', async () => {
    const fetchMock = stubFetch(jsonResponse(payload))

    const results = await searchWeb('chancellor of germany', 2, langsearch)

    const { url, headers, body } = lastRequest(fetchMock)
    expect(url.href).toBe('https://api.langsearch.com/v1/web-search')
    expect(headers.authorization).toBe('Bearer sk-live')
    // A summary per result is the whole page behind it, which would crowd out
    // the answer as well as the prompt.
    expect(body).toEqual({ query: 'chancellor of germany', count: 2, summary: false })
    expect(results).toEqual([
      {
        title: 'Chancellor of Germany',
        url: 'https://en.wikipedia.org/wiki/Chancellor_of_Germany',
        snippet: 'the chancellor of germany is the head of government . friedrich merz holds the office .',
      },
      { title: 'Bundeskanzler', url: 'https://www.bundeskanzler.de/', snippet: 'der bundeskanzler' },
    ])
  })

  it('honours the limit even when the provider overshoots it', async () => {
    stubFetch(jsonResponse(payload))

    expect(await searchWeb('chancellor of germany', 1, langsearch)).toHaveLength(1)
  })

  it('returns nothing when the query matched nothing', async () => {
    stubFetch(jsonResponse({ code: 200, msg: null, data: { webPages: { value: [] } } }))

    expect(await searchWeb('zzzz', 5, langsearch)).toEqual([])
  })

  // The envelope is the trap: a refusal reported with a 200 and no result set
  // would otherwise reach the model as "there is nothing on this subject".
  it('relays a refusal the envelope carried instead of reporting no results', async () => {
    stubFetch(jsonResponse({ code: 403, msg: 'Insufficient balance' }))

    await expect(searchWeb('news', 5, langsearch)).rejects.toThrow('Insufficient balance')
  })

  it('says so when the envelope carries neither results nor a reason', async () => {
    stubFetch(jsonResponse({ code: 200 }))

    await expect(searchWeb('news', 5, langsearch)).rejects.toThrow(/no result set/)
  })

  it('explains the missing key instead of calling the provider', async () => {
    const fetchMock = stubFetch()

    await expect(searchWeb('news', 5, { provider: 'langsearch' })).rejects.toThrow(
      'LangSearch needs a LangSearch API key. Add one under Tools → Web access.',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the API key when the provider rejects it', async () => {
    stubFetch(jsonResponse({}, 401))

    await expect(searchWeb('news', 5, langsearch)).rejects.toThrow(/rejected the API key \(401\)/)
  })

  // A Jina key does nothing for this provider, so the reader's way out of a 429
  // must not be offered here.
  it('states its own allowance when it rate-limits a search', async () => {
    stubFetch(jsonResponse({}, 429))

    await expect(searchWeb('news', 5, langsearch)).rejects.toThrow(
      'LangSearch rate-limited this request (429). A free key allows one search a second and 1,000 a day.',
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
      provider: 'duckduckgo',
      jinaApiKey: 'jina_k',
    })
  })

  // Wikipedia stopped being the default and is still a provider, so a user who
  // chose it deliberately must not be moved off it by an upgrade.
  it('leaves a stored provider that is no longer the default alone', () => {
    expect(normalizeWebAccess({ provider: 'wikipedia' }).provider).toBe('wikipedia')
  })

  it.each([{}, { provider: 'bing' as SearchProvider }])(
    'falls back to the default provider for %o',
    (stored) => {
      expect(normalizeWebAccess(stored).provider).toBe('duckduckgo')
    },
  )

  // Two keys now, and neither is the other's: carrying only the Jina one over
  // would silently sign a LangSearch user out on the next upgrade.
  it('keeps both keys apart', () => {
    expect(
      normalizeWebAccess({ provider: 'langsearch', langsearchApiKey: 'sk-a', jinaApiKey: 'jina_b' }),
    ).toEqual({ provider: 'langsearch', langsearchApiKey: 'sk-a', jinaApiKey: 'jina_b' })
  })
})

describe('missingSearchKey', () => {
  it.each([
    [{ provider: 'duckduckgo' } as WebAccessConfig, undefined],
    [{ provider: 'wikipedia' } as WebAccessConfig, undefined],
    [{ provider: 'jina' } as WebAccessConfig, 'jinaApiKey'],
    [{ provider: 'jina', jinaApiKey: 'jina_k' } as WebAccessConfig, undefined],
    [{ provider: 'langsearch' } as WebAccessConfig, 'langsearchApiKey'],
    [{ provider: 'langsearch', langsearchApiKey: 'sk-k' } as WebAccessConfig, undefined],
    // The other provider's key is no help, and saying nothing here would let the
    // panel report a provider as ready that then refuses.
    [{ provider: 'langsearch', jinaApiKey: 'jina_k' } as WebAccessConfig, 'langsearchApiKey'],
    [{ provider: 'langsearch', langsearchApiKey: '   ' } as WebAccessConfig, 'langsearchApiKey'],
  ])('reads %o as missing %s', (config, expected) => {
    expect(missingSearchKey(config)).toBe(expected)
  })
})
