import { afterEach, describe, expect, it, vi } from 'vitest'
import { digest, diverseFirst, looksBlocked, paragraphsOf, passagesFor, researchQuestion } from './research'
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
 */
describe('researchQuestion', () => {
  const config: WebAccessConfig = { provider: 'langsearch', langsearchApiKey: 'key' }
  const question = 'Who is the chief executive of Fictional Airways?'

  const LEADERSHIP = 'https://fictionalairways.example/leadership'
  const AIRTIMES = 'https://airtimes.example/osei'

  const HITS = [
    { name: 'Leadership', url: LEADERSHIP, snippet: 'Ama Osei leads the airline.' },
    { name: 'Airtimes', url: AIRTIMES, snippet: 'The board appointed Ama Osei in 2023.' },
  ]

  /** A page body, or the status the reader should refuse it with. */
  type Reply = string | number

  function stubNetwork(pages: Record<string, Reply>, hits = HITS) {
    const calls: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input)
        calls.push(url)

        if (url.startsWith('https://api.langsearch.com')) {
          return { ok: true, status: 200, json: async () => ({ data: { webPages: { value: hits } } }) }
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
      [LEADERSHIP]: 'Ama Osei has led Fictional Airways as chief executive since March 2023 in Accra.',
      [AIRTIMES]: 'The board appointed Ama Osei as chief executive in March 2023, succeeding Piet Hendriks.',
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
      [LEADERSHIP]: 'Ama Osei has led Fictional Airways as chief executive since March 2023 in Accra.',
      [AIRTIMES]: 'The board appointed Ama Osei as chief executive in March 2023, succeeding Piet Hendriks.',
    })

    await researchQuestion(question, config)

    // One search and one read per source: the cost of the call is what the
    // reader's per-minute budget is spent on, so it is worth pinning.
    expect(calls).toHaveLength(3)
  })

  /**
   * The reader's budget is shared between search and every page, so a 429 on one
   * source is an ordinary event. Losing the two that arrived over it would turn a
   * partial answer into no answer.
   */
  it('stands a page that would not open in as its search snippet', async () => {
    stubNetwork({
      [LEADERSHIP]: 'Ama Osei has led Fictional Airways as chief executive since March 2023 in Accra.',
      [AIRTIMES]: 429,
    })

    const result = await researchQuestion(question, config)

    expect(result).toContain('1 read in full, 1 from the search snippet only')
    expect(result).toContain('"The board appointed Ama Osei in 2023."')
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
