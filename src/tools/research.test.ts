import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  digest,
  diverseFirst,
  focusQuery,
  isUnreadableUrl,
  looksBlocked,
  paragraphsOf,
  passagesFor,
  pickCandidates,
  related,
  researchQuestion,
} from './research'
import type { SearchResult, WebAccessConfig } from './web'

function result(url: string, title = 'Title', snippet = 'A snippet.'): SearchResult {
  return { url, title, snippet }
}

describe('diverseFirst', () => {
  it('puts the first hit on each host ahead of any second hit on one', () => {
    const chosen = diverseFirst(
      [
        result('https://news.example/one'),
        result('https://news.example/two'),
        result('https://other.example/a'),
        result('https://third.example/b'),
      ],
      3,
    )

    expect(chosen.map((entry) => entry.url)).toEqual([
      'https://news.example/one',
      'https://other.example/a',
      'https://third.example/b',
    ])
  })

  it('treats www as the same host', () => {
    const chosen = diverseFirst(
      [result('https://www.news.example/one'), result('https://news.example/two')],
      2,
    )

    expect(chosen.map((entry) => entry.url)).toEqual([
      'https://www.news.example/one',
      'https://news.example/two',
    ])
  })

  // Wikipedia returns every result on one host. Collapsing to a single source
  // there would make the tool useless under that provider, so the list refills
  // with further pages from the same host rather than being cut short.
  it('fills the quota from one host when that is all there is', () => {
    const chosen = diverseFirst(
      [
        result('https://en.wikipedia.org/wiki/A'),
        result('https://en.wikipedia.org/wiki/B'),
        result('https://en.wikipedia.org/wiki/C'),
      ],
      3,
    )

    expect(chosen).toHaveLength(3)
  })

  it('drops a URL the provider returned twice', () => {
    const chosen = diverseFirst([result('https://news.example/one'), result('https://news.example/one')], 5)

    expect(chosen).toHaveLength(1)
  })

  it('treats company subdomains as one site', () => {
    const chosen = diverseFirst(
      [
        result('https://investor.nvidia.com/a'),
        result('https://nvidianews.nvidia.com/b'),
        result('https://www.reuters.com/c'),
      ],
      2,
    )

    expect(chosen.map((entry) => entry.url)).toEqual([
      'https://investor.nvidia.com/a',
      'https://www.reuters.com/c',
    ])
  })

  it('keeps bbc.co.uk and theguardian.co.uk as two sites', () => {
    expect(
      diverseFirst([result('https://www.bbc.co.uk/news/1'), result('https://www.theguardian.co.uk/2')], 2),
    ).toHaveLength(2)
  })
})

describe('related', () => {
  it('treats a German inflection as the same word', () => {
    expect(related('bundeskanzler', 'bundeskanzlers')).toBe(true)
    expect(related('kanzler', 'kanzlerin')).toBe(true)
  })

  it('does not treat a short stem as every word that starts with it', () => {
    expect(related('news', 'newspaper')).toBe(false)
    expect(related('the', 'there')).toBe(false)
  })
})

describe('focusQuery', () => {
  it.each([
    ['What is the capital of France?', 'capital of France'],
    ['Who is the current secretary-general of the UN?', 'current secretary-general of the UN'],
    ['Warum ist der Himmel blau?', 'Warum ist der Himmel blau'],
    ['Why is the sky blue?', 'Why is the sky blue'],
    ['How does photosynthesis work?', 'How does photosynthesis work'],
    ['Wer ist der Bundeskanzler?', 'Bundeskanzler'],
    ["What's the population of Tokyo", 'population of Tokyo'],
    ['How much is a Big Mac in Japan?', 'Big Mac in Japan'],
    ['Was ist die Hauptstadt von Frankreich?', 'Hauptstadt von Frankreich'],
  ])('narrows %j to %j', (raw, expected) => {
    expect(focusQuery(raw)).toBe(expected)
  })
})

describe('isUnreadableUrl', () => {
  it('flags a login wall and a PDF gallery', () => {
    expect(isUnreadableUrl('https://example.com/login')).toBe(true)
    expect(isUnreadableUrl('https://nvidianews.nvidia.com/_gallery/download_pdf/68af/')).toBe(true)
  })

  it('leaves an ordinary article alone', () => {
    expect(isUnreadableUrl('https://investor.nvidia.com/news/q2/')).toBe(false)
  })
})

describe('pickCandidates', () => {
  const question = 'Who is the chief executive of Nvidia?'

  it('puts a Wikipedia article ahead of other sites, because MediaWiki is free', () => {
    const chosen = pickCandidates(question, [
      result('https://www.reuters.com/nvidia', 'Reuters', 'Nvidia named a new chief executive.'),
      result('https://en.wikipedia.org/wiki/Nvidia', 'Nvidia', 'Nvidia is a computing company.'),
      result('https://www.bbc.co.uk/nvidia', 'BBC', 'Nvidia chief executive spoke today.'),
    ])

    expect(chosen[0]?.url).toBe('https://en.wikipedia.org/wiki/Nvidia')
  })

  it('ranks other sites by whether the snippet already answers the question', () => {
    const chosen = pickCandidates(question, [
      result('https://flights.example/routes', 'Routes', 'The airline flies to thirty cities.'),
      result(
        'https://fictionalairways.example/leadership',
        'Leadership',
        'Ama Osei was appointed chief executive in March 2023.',
      ),
    ])

    expect(chosen[0]?.url).toBe('https://fictionalairways.example/leadership')
  })

  it('demotes a login wall behind pages that can actually be read', () => {
    const chosen = pickCandidates(question, [
      result('https://example.com/login', 'Sign in', 'Sign in to read about the chief executive.'),
      result('https://news.example/nvidia', 'News', 'Nvidia chief executive Jensen Huang.'),
    ])

    expect(chosen.map((entry) => entry.url)).toEqual([
      'https://news.example/nvidia',
      'https://example.com/login',
    ])
  })

  it('does not let a second Wikipedia article crowd out another site', () => {
    const chosen = pickCandidates(question, [
      result('https://en.wikipedia.org/wiki/Nvidia', 'Nvidia', 'Nvidia is a computing company.'),
      result(
        'https://en.wikipedia.org/wiki/Jensen_Huang',
        'Huang',
        'Jensen Huang is Nvidia chief executive.',
      ),
      result('https://www.reuters.com/nvidia', 'Reuters', 'Nvidia chief executive spoke today.'),
    ])

    expect(chosen.slice(0, 2).map((entry) => entry.url)).toEqual([
      'https://en.wikipedia.org/wiki/Jensen_Huang',
      'https://www.reuters.com/nvidia',
    ])
  })

  it('gives the Wikipedia slot to the article whose snippet is the question, not a same-word trap', () => {
    const chosen = pickCandidates('What is the capital of France?', [
      result(
        'https://en.wikipedia.org/wiki/List_of_capitals_of_France',
        'List of capitals of France',
        'A chronological list of former seats of government.',
      ),
      result(
        'https://en.wikipedia.org/wiki/Capital_punishment_in_France',
        'Capital punishment in France',
        'Capital punishment in France is banned by the constitution.',
      ),
      result(
        'https://en.wikipedia.org/wiki/Paris',
        'Paris',
        'Capital of France. Paris is the capital and largest city of France.',
      ),
      result('https://www.britannica.com/paris', 'Britannica', 'Paris is the capital of France.'),
    ])

    expect(chosen[0]?.url).toBe('https://en.wikipedia.org/wiki/Paris')
    expect(chosen[1]?.url).toBe('https://www.britannica.com/paris')
  })
})

describe('paragraphsOf', () => {
  it('keeps link text and drops the address', () => {
    const [paragraph] = paragraphsOf(
      'The airline was founded by [Ama Osei](https://who.example/osei) in 1974 and still flies daily.',
    )

    expect(paragraph).toContain('Ama Osei')
    expect(paragraph).not.toContain('who.example')
  })

  it('drops headings, bullets and images but keeps what they introduced', () => {
    const paragraphs = paragraphsOf(
      '# Leadership\n\n![Image 1: portrait](https://img.example/1.png)\n\n- Ama Osei has led the airline as chief executive since March 2023.',
    )

    expect(paragraphs).toEqual(['Ama Osei has led the airline as chief executive since March 2023.'])
  })

  it('leaves out nav items and bylines, which are too short to be prose', () => {
    expect(paragraphsOf('Home\n\nBy our reporter\n\nShare')).toEqual([])
  })

  it('strips a footnote link without leaving the anchor behind as a source', () => {
    // Observed on Wikipedia. `reviewAnswer` reads every URL in a tool result as a
    // source the answer may cite, so a citation anchor left in a passage becomes
    // a citable source that states nothing.
    const [paragraph] = paragraphsOf(
      'Huang has been Nvidia\'s chief executive for three decades, a tenure described as "almost unheard of".[[47]](https://en.wikipedia.org/wiki/Jensen_Huang#cite_note-fitch20240226-50) He owns 3.6% of Nvidia.',
    )

    expect(paragraph).not.toContain('http')
    expect(paragraph).not.toContain('cite_note')
    // The number goes with it: a bare `47` mid-sentence reads as part of the claim.
    expect(paragraph).toBe(
      'Huang has been Nvidia\'s chief executive for three decades, a tenure described as "almost unheard of". He owns 3.6% of Nvidia.',
    )
  })

  it('strips emphasis and a heading mark that survived being joined into a line', () => {
    const [paragraph] = paragraphsOf(
      '### Sommer-Pressekonferenz des Bundeskanzlers\nRede von Bundeskanzler Merz in _Paderborn_ über **Europa** und Deutschland.',
    )

    expect(paragraph).toBe(
      'Sommer-Pressekonferenz des Bundeskanzlers Rede von Bundeskanzler Merz in Paderborn über Europa und Deutschland.',
    )
  })

  /**
   * The reader drops the spaces around its own emphasis marks, so deleting them
   * fuses the words either side. Observed as `,NVIDIA Facebookpage` in a passage
   * that had read `,**NVIDIA Facebook**page`.
   */
  it('separates words the reader fused with emphasis rather than joining them', () => {
    const [paragraph] = paragraphsOf(
      'We intend to use our **NVIDIA** Twitter account,**NVIDIA Facebook**page and company **blog** as a means of disclosing information about the company.',
    )

    expect(paragraph).toContain('account, NVIDIA Facebook page')
    expect(paragraph).not.toContain('Facebookpage')
  })

  /**
   * The same fusion from the other direction: a page writes two links with
   * nothing between them, so removing the brackets joins what they held.
   * `our@NVIDIATwitter account,NVIDIA Facebookpage` was three adjacent links.
   */
  it('separates adjacent links instead of running their text together', () => {
    const [paragraph] = paragraphsOf(
      'We intend to use our [@NVIDIA](https://x.example/nvidia)[Twitter](https://x.example) account,[NVIDIA Facebook](https://fb.example)page as a means of disclosing information.',
    )

    expect(paragraph).toBe(
      'We intend to use our @NVIDIA Twitter account, NVIDIA Facebook page as a means of disclosing information.',
    )
  })

  it('strips a Wikipedia link whose target carries brackets of its own', () => {
    // `[^)]*` stops at the bracket inside `Betreuung_(Recht)` and leaves the
    // reader's quoted title stranded in the passage.
    const [paragraph] = paragraphsOf(
      'Auch [Betreuung](https://de.wikipedia.org/wiki/Betreuung_(Recht) "Betreuung (Recht)") oder Unterbringung in einem Krankenhaus würden ihn disqualifizieren.',
    )

    expect(paragraph).toBe(
      'Auch Betreuung oder Unterbringung in einem Krankenhaus würden ihn disqualifizieren.',
    )
  })

  /**
   * Nav rows, breadcrumbs and share links clear every length floor and answer
   * nothing. Both of these were quoted as sources for *wer ist der Bundeskanzler*.
   */
  it('drops a breadcrumb and a share row, which no full stop ends', () => {
    expect(
      paragraphsOf('Sie befinden sich hier Bundesregierung | Startseite Bundesregierung Bundeskabinett'),
    ).toEqual([])
    expect(
      paragraphsOf('Governance Management Team Board of Directors Governance Documents Contact the Board'),
    ).toEqual([])
  })

  /**
   * Both of these outranked the sentence that answered the question when this ran
   * against the live web, and they are why the filters exist rather than being a
   * precaution.
   */
  it('drops a consent notice, which is prose and answers nothing', () => {
    expect(
      paragraphsOf(
        'These cookies may store a unique ID so that our system will remember you when you return, and are used to improve website performance.',
      ),
    ).toEqual([])
    expect(
      paragraphsOf(
        'Das Tool verwendet Cookies. Mit diesen Cookies können wir Besuche zählen und die Nutzung der Seite auswerten.',
      ),
    ).toEqual([])
  })

  it('drops a citation list, which repeats the subject in every entry', () => {
    expect(
      paragraphsOf(
        '"Here\'s how Nvidia CEO Jensen Huang won over his wife". Business Insider. Retrieved December 24, 2024. ↑ "#61 Jen-Hsun Huang". Forbes. Archived from the original on May 9, 2008.',
      ),
    ).toEqual([])
  })

  it('keeps prose that merely mentions a year and a source', () => {
    const kept = paragraphsOf(
      'Jensen Huang founded NVIDIA in 1993 and has served since its inception as president and chief executive officer.',
    )

    expect(kept).toHaveLength(1)
  })

  it('joins the lines of one paragraph and separates two', () => {
    expect(
      paragraphsOf(
        'Ama Osei has led the airline as its chief\nexecutive since March 2023.\n\nThe airline was founded in 1974 and is based in Accra, Ghana.',
      ),
    ).toEqual([
      'Ama Osei has led the airline as its chief executive since March 2023.',
      'The airline was founded in 1974 and is based in Accra, Ghana.',
    ])
  })
})

describe('looksBlocked', () => {
  // The reader answers 200 with these, so nothing upstream can tell them from a
  // page. One was quoted as a source for *wer ist der Bundeskanzler*.
  it('recognises a firewall page the reader returned as a result', () => {
    expect(
      looksBlocked(
        'Sucuri WebSite Firewall - Access Denied',
        'Access Denied - Sucuri Website Firewall\n\nTime:2026-08-25 17:56:05 Server ID:20017',
      ),
    ).toBe(true)
  })

  it('recognises a JavaScript gate', () => {
    expect(looksBlocked('Just a moment...', 'Enable JavaScript and cookies to continue')).toBe(true)
  })

  /** Length is half the test, or an article about Cloudflare would be discarded. */
  it('leaves a long article that happens to name a firewall vendor', () => {
    const article = `Cloudflare reported revenue growth this quarter. ${'The company operates a global network. '.repeat(40)}`

    expect(looksBlocked('Cloudflare earnings', article)).toBe(false)
  })

  it('leaves an ordinary short page alone', () => {
    expect(looksBlocked('Leadership', 'Ama Osei has led the airline since 2023.')).toBe(false)
  })
})

describe('passagesFor', () => {
  /**
   * As many paragraphs as a real page has, and that is the point rather than the
   * prose: the term weights are measured over them. A four-paragraph fixture
   * makes `the` exactly as rare as `executive` and ranks the wrong paragraph
   * first, which is what pooling the weights across everything fetched fixes.
   */
  const PAGE = [
    'Skip to content and sign up for the newsletter so you never miss an update from us.',
    'The airline was founded in 1974 in Accra and now flies to thirty destinations.',
    'Ama Osei was appointed chief executive in March 2023, succeeding Piet Hendriks.',
    'The cabin refurbishment programme was completed across the whole fleet last summer.',
    'The company reported a modest profit for the financial year ending in December 2025.',
    'Cookies help the site deliver its services, and you may choose to accept all of them.',
    'The head office moved to a new building near the airport in the early part of 2024.',
    'Passengers may check two bags on the international routes without paying a fee.',
  ].join('\n\n')

  function forOnePage(question: string, markdown: string): string[] {
    return passagesFor(question, [paragraphsOf(markdown)])[0] ?? []
  }

  it('picks the paragraph that answers the question over one that merely shares its words', () => {
    const [first] = forOnePage('Who is the chief executive of the airline?', PAGE)

    expect(first).toContain('Ama Osei')
  })

  it('matches a German inflection, so the answering sentence is not silent', () => {
    const page = [
      'Die Bundesrepublik hat eine parlamentarische Demokratie mit einem Bundestag.',
      'Das Amt des Bundeskanzlers übt Friedrich Merz seit dem 6. Mai 2025 aus.',
    ].join('\n\n')

    const [first] = forOnePage('Wer ist der Bundeskanzler?', page)

    expect(first).toContain('Friedrich Merz')
  })

  it('returns at most two passages, however long the page is', () => {
    expect(forOnePage('airline chief executive founded Accra 1974', PAGE)).toHaveLength(2)
  })

  it('gives every page its own list, in the order the sources were selected', () => {
    const chosen = passagesFor('chief executive', [paragraphsOf(PAGE), [], paragraphsOf(PAGE)])

    // The middle page is one that could not be read. Dropping it here would
    // shift every source after it onto the wrong URL.
    expect(chosen.map((passages) => passages.length)).toEqual([1, 0, 1])
  })

  it('has nothing to say about a page with no prose on it', () => {
    expect(forOnePage('who runs it', 'Home\n\nContact\n\nShare')).toEqual([])
  })

  /**
   * A definition is answered by a lead paragraph that repeats none of the words
   * in the question, so a page whose score is zero everywhere still contributes
   * its opening rather than going silent.
   */
  it('falls back to the opening paragraph when nothing matches', () => {
    const [first] = forOnePage(
      'zzz qqq',
      'Stripe is a payments company that builds financial infrastructure for online businesses.',
    )

    expect(first).toBe(
      'Stripe is a payments company that builds financial infrastructure for online businesses.',
    )
  })

  /**
   * The densest window is often a heading. Asked who runs Nvidia, this returned
   * the FAQ question "Who leads NVIDIA?" — every word of it earning, and the
   * answer underneath it left out.
   */
  it('does not shrink a passage to a heading just because it scores densely', () => {
    const faq = [
      'Who leads NVIDIA?',
      'Jensen Huang founded NVIDIA in 1993 and has served since its inception as president and chief executive officer of the company.',
      'Who is part of the NVIDIA executive team?',
      'The executive staff includes Colette Kress as chief financial officer and Debora Shoquist in operations, alongside several others.',
    ].join(' ')

    const [first] = forOnePage('Who leads NVIDIA?', faq)

    expect(first!.length).toBeGreaterThanOrEqual(60)
    expect(first).toContain('Jensen Huang')
  })

  it('cuts a long paragraph down to the sentences that carry the question', () => {
    const filler = 'The catering was reviewed in a report nobody read. '.repeat(6)
    const [first] = forOnePage(
      'Who was appointed chief executive?',
      `${filler}Ama Osei was appointed chief executive in March 2023.${filler}`,
    )

    expect(first).toContain('Ama Osei was appointed chief executive in March 2023.')
    expect(first!.length).toBeLessThanOrEqual(280)
  })

  it('cuts a single sentence that is longer than the cap on its own', () => {
    const [first] = forOnePage('chief executive', `Ama Osei ${'and others '.repeat(60)}is chief executive.`)

    expect(first!.length).toBeLessThanOrEqual(281)
    expect(first).toContain('…')
  })

  it('does not quote the same claim twice', () => {
    const twice = [
      'Ama Osei was appointed chief executive of the airline in March 2023 after nine years.',
      'Ama Osei was appointed chief executive of the airline in March 2023 after nine years.',
    ].join('\n\n')

    expect(forOnePage('who is the chief executive', twice)).toHaveLength(1)
  })
})

describe('digest', () => {
  const sources = [
    {
      url: 'https://fictionalairways.example/leadership',
      title: 'Leadership',
      passages: ['Ama Osei has led Fictional Airways as chief executive since 2023.'],
      read: true,
    },
    {
      url: 'https://airtimes.example/osei',
      title: 'Airtimes',
      passages: ['The board appointed Ama Osei in March 2023.'],
      read: true,
    },
  ]

  it('numbers each source and puts its URL on the same line as its name', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-26T15:00:00'))

    expect(digest('Who runs Fictional Airways?', sources)).toBe(
      [
        'Researched 2026-08-26 for "Who runs Fictional Airways?" across 2 sources, all read in full.',
        '',
        '1. Leadership — https://fictionalairways.example/leadership',
        '   "Ama Osei has led Fictional Airways as chief executive since 2023."',
        '2. Airtimes — https://airtimes.example/osei',
        '   "The board appointed Ama Osei in March 2023."',
      ].join('\n'),
    )

    vi.useRealTimers()
  })

  // A snippet is weaker evidence than a page, and once both are quoted lines in
  // a list nothing else says which is which.
  it('says how many sources are snippets rather than pages', () => {
    const mixed = [sources[0]!, { ...sources[1]!, read: false }]

    expect(digest('Who runs it?', mixed)).toContain(
      'across 2 sources; 1 read in full, 1 from the search snippet only',
    )
  })

  it('warns when no page could be opened at all', () => {
    const snippets = sources.map((source) => ({ ...source, read: false }))

    expect(digest('Who runs it?', snippets)).toContain('none could be opened, so these are search snippets')
  })

  it('caps the whole result, because a page-length digest is what this avoids', () => {
    const long = Array.from({ length: 5 }, (_, at) => ({
      url: `https://example.com/${at}`,
      title: 'T'.repeat(400),
      passages: ['x'.repeat(600), 'y'.repeat(600)],
      read: true,
    }))

    const built = digest('anything', long)

    expect(built).toContain('[Truncated: further sources were dropped.]')
    expect(built.length).toBeLessThan(4_100)
  })

  it('does not double the quotes around a passage that arrived with them', () => {
    const quoted = [{ ...sources[0]!, passages: ['"Already quoted."'] }]

    expect(digest('q', quoted)).toContain('   "Already quoted."')
  })
})

/**
 * The whole call, over a stubbed network: LangSearch answers the search and the
 * reader answers each page, which is the shape every provider reduces to.
 * Wikipedia is searched alongside and answers empty unless a test fills it.
 */
describe('researchQuestion', () => {
  const config: WebAccessConfig = { provider: 'langsearch', langsearchApiKey: 'key' }
  const question = 'Who is the chief executive of Fictional Airways?'

  const LEADERSHIP = 'https://fictionalairways.example/leadership'
  const AIRTIMES = 'https://airtimes.example/osei'
  const GAZETTE = 'https://gazette.example/osei'
  const WIKI = 'https://en.wikipedia.org/wiki/Fictional_Airways'

  const HITS = [
    { name: 'Leadership', url: LEADERSHIP, snippet: 'Ama Osei leads the airline.' },
    { name: 'Airtimes', url: AIRTIMES, snippet: 'The board appointed Ama Osei in 2023.' },
  ]

  const LEADERSHIP_PAGE = 'Ama Osei has led Fictional Airways as chief executive since March 2023 in Accra.'
  const AIRTIMES_PAGE =
    'The board appointed Ama Osei as chief executive in March 2023, succeeding Piet Hendriks.'
  const WIKI_EXTRACT =
    'Fictional Airways is an airline based in Accra. Ama Osei has been its chief executive since 2023.'

  /** A page body, or the status the reader should refuse it with. */
  type Reply = string | number

  function stubNetwork(
    pages: Record<string, Reply>,
    hits = HITS,
    wiki: { title: string; url: string; extract: string }[] = [],
  ) {
    const calls: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input)
        calls.push(url)

        if (url.startsWith('https://api.langsearch.com')) {
          return { ok: true, status: 200, json: async () => ({ data: { webPages: { value: hits } } }) }
        }

        if (url.includes('wikipedia.org')) {
          const parsed = new URL(url)
          if (parsed.searchParams.has('gsrsearch')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                query: {
                  pages: Object.fromEntries(
                    wiki.map((entry, at) => [
                      String(at + 1),
                      {
                        pageid: at + 1,
                        title: entry.title,
                        index: at + 1,
                        extract: entry.extract,
                        fullurl: entry.url,
                      },
                    ]),
                  ),
                },
              }),
            }
          }
          const requested = (parsed.searchParams.get('titles') ?? '').replace(/_/g, ' ')
          const match = wiki.find((entry) => entry.title.replace(/_/g, ' ') === requested)
          if (match) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                query: {
                  pages: {
                    '1': {
                      pageid: 1,
                      title: match.title,
                      extract: match.extract,
                      fullurl: match.url,
                    },
                  },
                },
              }),
            }
          }
          return { ok: true, status: 200, json: async () => ({ batchcomplete: '' }) }
        }

        const target = url.replace('https://r.jina.ai/', '')
        const reply = pages[target]
        if (reply === undefined || typeof reply === 'number') {
          return { ok: false, status: typeof reply === 'number' ? reply : 404 }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { title: 'T', url: target, content: reply } }),
        }
      }),
    )

    return calls
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('quotes every source it could read, each against its own URL', async () => {
    stubNetwork({
      [LEADERSHIP]: LEADERSHIP_PAGE,
      [AIRTIMES]: AIRTIMES_PAGE,
    })

    const result = await researchQuestion(question, config)

    expect(result).toContain('across 2 sources, all read in full')
    expect(result).toContain(`1. T — ${LEADERSHIP}`)
    expect(result).toContain(
      '"Ama Osei has led Fictional Airways as chief executive since March 2023 in Accra."',
    )
    expect(result).toContain(`2. T — ${AIRTIMES}`)
    expect(result).toContain('succeeding Piet Hendriks')
  })

  it('reads the pages at the same time rather than one after another', async () => {
    const calls = stubNetwork({
      [LEADERSHIP]: LEADERSHIP_PAGE,
      [AIRTIMES]: AIRTIMES_PAGE,
    })

    await researchQuestion(question, config)

    const searches = calls.filter(
      (url) => url.startsWith('https://api.langsearch.com') || url.includes('gsrsearch'),
    )
    const reads = calls.filter((url) => url.startsWith('https://r.jina.ai/'))
    expect(searches).toHaveLength(2)
    expect(reads).toHaveLength(2)
  })

  /**
   * The reader's budget is shared between search and every page, so a 429 on one
   * source is an ordinary event. Losing the two that arrived over it would turn a
   * partial answer into no answer.
   */
  it('stands a page that would not open in as its search snippet', async () => {
    stubNetwork({
      [LEADERSHIP]: LEADERSHIP_PAGE,
      [AIRTIMES]: 429,
    })

    const result = await researchQuestion(question, config)

    expect(result).toContain('1 read in full, 1 from the search snippet only')
    expect(result).toContain('"The board appointed Ama Osei in 2023."')
  })

  it('replaces a blocked page from the remaining hits rather than quoting the firewall', async () => {
    const fourth = 'https://profile.example/osei'
    stubNetwork(
      {
        [LEADERSHIP]: 'Sucuri WebSite Firewall - Access Denied. Time: 2026-08-31.',
        [AIRTIMES]: AIRTIMES_PAGE,
        [GAZETTE]: 'Ama Osei took office as chief executive of Fictional Airways in Accra in 2023.',
        [fourth]: 'Ama Osei joined Fictional Airways from the civil aviation authority in 2014.',
      },
      [
        {
          name: 'Leadership',
          url: LEADERSHIP,
          snippet: 'Ama Osei is the chief executive of Fictional Airways.',
        },
        ...HITS.slice(1),
        { name: 'Gazette', url: GAZETTE, snippet: 'Ama Osei took office in Accra.' },
        { name: 'Profile', url: fourth, snippet: 'A profile of the airline.' },
      ],
    )

    const result = await researchQuestion(question, config)

    expect(result).not.toContain('Access Denied')
    expect(result).toContain(fourth)
    expect(result).toContain('all read in full')
  })

  it('searches Wikipedia alongside the web and reads the article through MediaWiki', async () => {
    stubNetwork(
      {
        [LEADERSHIP]: LEADERSHIP_PAGE,
        [AIRTIMES]: AIRTIMES_PAGE,
      },
      HITS,
      [{ title: 'Fictional Airways', url: WIKI, extract: WIKI_EXTRACT }],
    )

    const result = await researchQuestion(question, config)

    expect(result).toContain(WIKI)
    expect(result).toContain('Ama Osei has been its chief executive since 2023')
    expect(result).toContain('across 3 sources, all read in full')
  })

  it('does not search Wikipedia twice when Wikipedia is already the provider', async () => {
    const calls = stubNetwork({}, [], [{ title: 'Fictional Airways', url: WIKI, extract: WIKI_EXTRACT }])

    await researchQuestion(question, { provider: 'wikipedia' })

    const searches = calls.filter((url) => url.includes('gsrsearch'))
    expect(searches).toHaveLength(1)
    expect(calls.some((url) => url.startsWith('https://api.langsearch.com'))).toBe(false)
  })

  it('searches for the subject rather than the question shell', async () => {
    const calls = stubNetwork({
      [LEADERSHIP]: LEADERSHIP_PAGE,
      [AIRTIMES]: AIRTIMES_PAGE,
    })

    await researchQuestion('What is the capital of France?', config)

    const wiki = calls.find((url) => url.includes('gsrsearch'))
    const asked = wiki ? new URL(wiki).searchParams.get('gsrsearch') : null
    expect(asked).toBe('capital of France')
  })

  it('says so when no page opened and only snippets are left', async () => {
    stubNetwork({ [LEADERSHIP]: 500, [AIRTIMES]: 429 })

    const result = await researchQuestion(question, config)

    expect(result).toContain('none could be opened, so these are search snippets only')
  })

  /**
   * Nothing readable and nothing to quote is a failure, not an empty result. A
   * 0.8B model relays "no sources" as "there is nothing on this subject", which
   * is the one answer that must never come out of a page that simply would not
   * load.
   */
  it('fails rather than reporting that it found nothing', async () => {
    stubNetwork({ [LEADERSHIP]: 500 }, [{ name: 'Leadership', url: LEADERSHIP, snippet: '' }])

    await expect(researchQuestion(question, config)).rejects.toThrow('could not read any of them')
  })

  it('reports a search that genuinely matched nothing as such', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-26T15:00:00'))
    stubNetwork({}, [])

    await expect(researchQuestion(question, config)).resolves.toBe(
      `Researched 2026-08-26 for "${question}". No results.`,
    )
    vi.useRealTimers()
  })
})
