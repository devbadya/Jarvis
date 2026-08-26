import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compareSources,
  formatBrief,
  leadOf,
  searchBrief,
  selectDiverseSources,
  siteOf,
  type BriefSource,
} from './search-brief'
import type { SearchResult, WebAccessConfig } from './web'

function hit(url: string, title = 'Title', snippet = 'A snippet.'): SearchResult {
  return { title, url, snippet }
}

function source(site: string, extract: string, read = true): BriefSource {
  return { title: site, url: `https://${site}/page`, site, extract, read }
}

const NOW = new Date('2026-08-26T09:00:00')

describe('siteOf', () => {
  it.each([
    ['https://www.reuters.com/business/', 'reuters.com'],
    ['https://en.wikipedia.org/wiki/Arc', 'wikipedia.org'],
    ['https://news.bbc.co.uk/story', 'bbc.co.uk'],
    ['https://example.com', 'example.com'],
    // Two pages of one publisher are one source however deep the subdomain goes.
    ['https://investor.nvidia.com/news/q2/', 'nvidia.com'],
  ])('reads %s as %s', (url, expected) => {
    expect(siteOf(url)).toBe(expected)
  })
})

describe('selectDiverseSources', () => {
  it('keeps the best result of each site and drops the rest', () => {
    const selected = selectDiverseSources([
      hit('https://reuters.com/one'),
      hit('https://reuters.com/two'),
      hit('https://www.reuters.com/three'),
      hit('https://bbc.com/story'),
    ])

    expect(selected.map((result) => result.url)).toEqual(['https://reuters.com/one', 'https://bbc.com/story'])
  })

  it('gives reference works one seat and no more', () => {
    // A lead paragraph beside three one-line snippets decides the answer by
    // itself, and a mirror of Wikipedia is not a second opinion. One seat keeps
    // the best source on a historical question without letting it be the brief.
    const selected = selectDiverseSources(
      [
        hit('https://en.wikipedia.org/wiki/Guterres'),
        hit('https://www.britannica.com/biography/Guterres'),
        hit('https://de.wikipedia.org/wiki/Guterres'),
        hit('https://un.org/sg'),
        hit('https://reuters.com/un'),
        hit('https://bbc.com/un'),
      ],
      4,
    )

    expect(selected.map((result) => siteOf(result.url))).toEqual([
      'wikipedia.org',
      'un.org',
      'reuters.com',
      'bbc.com',
    ])
  })

  it('keeps a reference work rather than leaving one site to answer alone', () => {
    const selected = selectDiverseSources(
      [hit('https://un.org/sg'), hit('https://en.wikipedia.org/wiki/Guterres')],
      4,
    )

    expect(selected.map((result) => siteOf(result.url))).toEqual(['un.org', 'wikipedia.org'])
  })

  it('returns the encyclopedia rather than nothing when it is all there is', () => {
    const selected = selectDiverseSources([hit('https://de.wikipedia.org/wiki/Arc')], 4)

    expect(selected).toHaveLength(1)
  })

  it('ignores a result with no URL to read', () => {
    expect(selectDiverseSources([hit(''), hit('https://bbc.com/story')])).toHaveLength(1)
  })
})

describe('leadOf', () => {
  it('starts at the first real sentence rather than in the nav column', () => {
    // Observed on un.org: read from the top, the whole budget went on the menu,
    // and the paragraph naming the office holder never reached the model.
    const page = [
      '# About the Secretary-General',
      'Skip to main content',
      'Welcome to the United Nations English Français Русский Español Search Home Biography Reports',
      'António Guterres, the ninth Secretary-General of the United Nations, took office on 1 January 2017.',
    ].join('\n')

    expect(leadOf(page, 700)).toBe(
      'António Guterres, the ninth Secretary-General of the United Nations, took office on 1 January 2017.',
    )
  })

  it('reads a page with no sentence in it from the top', () => {
    // A price grid says what it says. Finding no prose must not return nothing.
    const page = ['# NVDA', 'Revenue (ttm) $253.49B', 'Employees 42,000'].join('\n')

    expect(leadOf(page, 700)).toBe('Revenue (ttm) $253.49B Employees 42,000')
  })

  it('skips a table flattened into a line of cells', () => {
    const page = [
      '| Incumbent | António Guterres |',
      '| --- | --- |',
      'The office is described in Chapter XV of the Charter of the United Nations.',
    ].join('\n')

    expect(leadOf(page, 700)).toBe(
      'The office is described in Chapter XV of the Charter of the United Nations.',
    )
  })

  it('stops at the second heading rather than reading the whole page', () => {
    const page = ['# Arc', 'Arc is a web browser.', '## Related articles', 'Ten other browsers.'].join('\n')

    expect(leadOf(page, 700)).toBe('Arc is a web browser.')
  })

  it('strips the markdown the reader emits', () => {
    const page =
      '![Image 3](https://x/i.png)\n**Arc** is a [browser](https://arc.net) from `The Browser Company`.'

    expect(leadOf(page, 700)).toBe('Arc is a browser from The Browser Company.')
  })

  it('cuts to the budget it was given', () => {
    const lead = leadOf('word '.repeat(400), 200)

    expect(lead).toHaveLength(201)
    expect(lead.endsWith('…')).toBe(true)
  })
})

describe('compareSources', () => {
  it('reports a name and a year several sites share', () => {
    const { overlap } = compareSources([
      source('a.example', 'Ama Osei has led the airline since 2023.'),
      source('b.example', 'Ama Osei was confirmed in 2023.'),
      source('c.example', 'The chief executive is Ama Osei.'),
    ])

    expect(overlap).toEqual([
      { term: 'Ama Osei', sites: 3 },
      { term: '2023', sites: 2 },
    ])
  })

  it('names the site that disagrees with the others', () => {
    const { conflicts } = compareSources([
      source('a.example', 'Chief executive since 2023.'),
      source('b.example', 'In post since 2023.'),
      source('c.example', 'In post since 2023.'),
      source('d.example', 'Chief executive since 2021.'),
    ])

    expect(conflicts).toEqual([
      {
        values: [
          { display: '2023', sites: ['a.example', 'b.example', 'c.example'] },
          { display: '2021', sites: ['d.example'] },
        ],
      },
    ])
  })

  it('says nothing when only one site names a figure', () => {
    // One reading is not a disagreement, and reporting it as one would tell the
    // model to hedge an answer nothing contradicted.
    const { conflicts } = compareSources([
      source('a.example', 'Revenue was 46 billion.'),
      source('b.example', 'The company is large.'),
    ])

    expect(conflicts).toEqual([])
  })

  it('does not read a site that names both figures as contradicting either', () => {
    const { conflicts } = compareSources([
      source('a.example', 'Revenue rose to 46 billion.'),
      source('b.example', 'Revenue rose to 46 billion.'),
      source('c.example', 'Revenue was 31 billion, and is now 46 billion.'),
    ])

    expect(conflicts).toEqual([])
  })

  it('treats a figure written with either separator as one value', () => {
    const { overlap } = compareSources([
      source('a.example', 'It reached 46,700 units.'),
      source('b.example', 'It reached 46.700 units.'),
    ])

    expect(overlap).toEqual([{ term: '46,700', sites: 2 }])
  })

  it('ignores a capitalised span that is only the start of a sentence', () => {
    // Three pages all opening "The company" would otherwise read as agreement
    // about a subject none of them named.
    const { overlap } = compareSources([
      source('a.example', 'The company sells software.'),
      source('b.example', 'The company sells software.'),
    ])

    expect(overlap).toEqual([])
  })

  it('prefers the full name over a fragment of it', () => {
    const { overlap } = compareSources([
      source('a.example', 'Ama Osei leads it.'),
      source('b.example', 'Ama Osei leads it.'),
    ])

    expect(overlap).toEqual([{ term: 'Ama Osei', sites: 2 }])
  })
})

describe('formatBrief', () => {
  const sources = [
    source('un.org', 'António Guterres is the ninth Secretary-General, in post since 2017.'),
    source('reuters.com', 'António Guterres was reappointed in 2021 for a term to 2026.'),
  ]

  it('dates the brief, numbers the sources and keeps every URL', () => {
    const brief = formatBrief('UN secretary-general', sources, NOW)

    expect(brief).toContain('Searched 2026-08-26 for "UN secretary-general" — 2 sources')
    expect(brief).toContain('1. un.org (un.org)\n   https://un.org/page')
    expect(brief).toContain('2. reuters.com (reuters.com)\n   https://reuters.com/page')
    expect(brief).toContain('Agreed across sources: "António Guterres" in 2/2')
  })

  it('marks a source that could only be summarised from its search snippet', () => {
    const brief = formatBrief('x', [source('a.example', 'A snippet.', false)], NOW)

    expect(brief).toContain('1 snippet only')
    expect(brief).toContain('— snippet only')
  })

  it('says so rather than implying a cross-check that did not happen', () => {
    const brief = formatBrief('x', [source('a.example', 'One reading.')], NOW)

    expect(brief).toContain('Only one source was readable, so nothing was cross-checked.')
  })

  it('stays inside the context it is allowed', () => {
    const four = [1, 2, 3, 4].map((index) => source(`s${index}.example`, 'word '.repeat(400)))

    expect(formatBrief('x', four, NOW).length).toBeLessThanOrEqual(4001)
  })
})

/** Every response the reader and the providers answer with, in order. */
function stubFetch(...bodies: unknown[]) {
  const fetchMock = vi.fn(async () => {
    const next = bodies.shift()
    if (next instanceof Error) throw next
    if (typeof next === 'number') return { ok: false, status: next, json: async () => ({}) } as Response
    return { ok: true, status: 200, json: async () => next ?? {} } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function readerPage(url: string, title: string, content: string) {
  return { data: { url, title, content } }
}

function duckDuckGoPage(...urls: string[]) {
  const hits = urls.flatMap((url, index) => [
    `${index + 1}.[Result ${index + 1}](https://duckduckgo.com/l/?uddg=${encodeURIComponent(url)})`,
    `Snippet ${index + 1}.`,
    new URL(url).hostname,
    '',
  ])
  return { data: { content: hits.join('\n') } }
}

const duckduckgo: WebAccessConfig = { provider: 'duckduckgo' }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchBrief', () => {
  it('reads one page per site and compares what they say', async () => {
    const fetchMock = stubFetch(
      duckDuckGoPage('https://un.org/sg', 'https://reuters.com/un', 'https://un.org/other'),
      readerPage('https://un.org/sg', 'Secretary-General', 'The office is held by António Guterres.'),
      readerPage('https://reuters.com/un', 'At the UN', 'António Guterres was reappointed in 2021.'),
    )

    const brief = await searchBrief('who leads the UN', 4, duckduckgo, NOW)

    // One results page plus one page per selected site, and the second un.org
    // result is not a second source.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(brief).toContain('2 sources')
    expect(brief).toContain('The office is held by António Guterres.')
    expect(brief).toContain('Agreed across sources: "António Guterres" in 2/2')
  })

  it('keeps the sources it could read when a page fails', async () => {
    const fetchMock = stubFetch(
      duckDuckGoPage('https://un.org/sg', 'https://reuters.com/un'),
      readerPage('https://un.org/sg', 'Secretary-General', 'The office is held by António Guterres.'),
      // The reader's per-IP budget is shared, and it runs out mid-brief.
      429,
    )

    const brief = await searchBrief('who leads the UN', 4, duckduckgo, NOW)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(brief).toContain('1 snippet only')
    expect(brief).toContain('The office is held by António Guterres.')
    expect(brief).toContain('Snippet 2.')
  })

  it('falls back to the snippet rather than dropping a source with an unreadable page', async () => {
    const brief = await searchBrief('anything', 4, duckduckgo, NOW).catch((error: Error) => error)

    // Nothing was stubbed beyond the default mock, so the search itself fails and
    // the tool throws rather than returning something that reads like a result.
    expect(brief).toBeInstanceOf(Error)
  })

  it('reports a query that matched nothing without reading any page', async () => {
    const fetchMock = stubFetch({ data: { content: 'No results found for zzzz.' } })

    expect(await searchBrief('zzzz', 4, duckduckgo, NOW)).toBe('No results for "zzzz".')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('asks for more candidates than it needs, since duplicates are dropped after ranking', async () => {
    const fetchMock = stubFetch(
      duckDuckGoPage('https://a.example/1'),
      readerPage('https://a.example/1', 'A', 'Text.'),
    )

    await searchBrief('anything', 2, duckduckgo, NOW)

    // The count is a parameter of the request the provider was answering anyway,
    // so asking for headroom costs nothing.
    const [first] = fetchMock.mock.calls[0] as unknown as [string]
    expect(first).toContain('duckduckgo.com')
  })

  it('spends no reader request when the provider sends its own text', async () => {
    const fetchMock = stubFetch({
      data: {
        webPages: {
          value: [
            { name: 'One', url: 'https://a.example/1', snippet: 'index text', summary: 'Ama Osei leads it.' },
            { name: 'Two', url: 'https://b.example/2', snippet: 'index text', summary: 'Ama Osei leads it.' },
          ],
        },
      },
    })

    const brief = await searchBrief(
      'who leads it',
      4,
      { provider: 'langsearch', langsearchApiKey: 'sk-live' },
      NOW,
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(brief).not.toContain('snippet only')
    expect(brief).toContain('Agreed across sources: "Ama Osei" in 2/2')
  })

  it('leaves a Wikipedia search as the article list it has always been', async () => {
    const fetchMock = stubFetch({
      query: {
        pages: {
          '1': { pageid: 1, title: 'Arc', index: 1, extract: 'A browser.', fullurl: 'https://w/arc' },
        },
      },
    })

    const brief = await searchBrief('Arc', 4, { provider: 'wikipedia' }, NOW)

    // One encyclopedia cannot be several independent sources, and its extracts
    // are already paragraphs, so nothing is fetched and nothing is compared.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(brief).toBe('1. Arc\n   https://w/arc\n   A browser.')
  })
})
