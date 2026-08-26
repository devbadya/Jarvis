import { describe, expect, it } from 'vitest'
import { collectEvidence, correctionPrompt, isUnsourced, reviewAnswer, type ReviewEvidence } from './review'

function evidence(overrides: Partial<ReviewEvidence> = {}): ReviewEvidence {
  return { toolResults: [], knownUrls: [], knownFigures: [], ...overrides }
}

const searchResult = {
  tool: 'web_search',
  result:
    '1. Leadership — Fictional Airways\n   https://fictionalairways.example/leadership\n   Ama Osei has led it since 2023.',
}

function checks(answer: string, given: ReviewEvidence): string[] {
  return reviewAnswer(answer, given).map((finding) => finding.check)
}

describe('reviewAnswer', () => {
  it('passes an answer with nothing to check it against', () => {
    expect(reviewAnswer('Paris is the capital of France.', evidence())).toEqual([])
  })

  it('passes an empty draft, which the reasoning promotion handles instead', () => {
    expect(reviewAnswer('   ', evidence({ toolResults: [searchResult] }))).toEqual([])
  })

  describe('numbers', () => {
    const calculated = evidence({ toolResults: [{ tool: 'calculator', result: '6748 * 9 = 60732' }] })

    it('accepts the number the calculator returned', () => {
      expect(checks('6748 × 9 = 60,732.', calculated)).toEqual([])
    })

    it('accepts it with separators the model chose', () => {
      expect(checks('The product is 60 732.', calculated)).toEqual([])
    })

    it('catches an answer that states a different number', () => {
      expect(checks('The product is about 60,000.', calculated)).toEqual(['wrong-number'])
    })

    it('quotes the tool result in the correction', () => {
      const [finding] = reviewAnswer('Roughly 60,000.', calculated)

      expect(finding?.instruction).toContain('6748 * 9 = 60732')
    })

    it('accepts a long decimal quoted to fewer places', () => {
      const third = evidence({ toolResults: [{ tool: 'calculator', result: '1 / 3 = 0.3333333333333333' }] })

      expect(checks('About 0.333.', third)).toEqual([])
    })

    it('leaves a failed calculation alone', () => {
      const failed = evidence({
        toolResults: [
          { tool: 'calculator', result: 'Tool "calculator" failed: expression must not be empty' },
        ],
      })

      expect(checks('I could not work that out.', failed)).toEqual([])
    })

    it('reports one correction however many sums were dropped', () => {
      const two = evidence({
        toolResults: [
          { tool: 'calculator', result: '2 + 2 = 4' },
          { tool: 'calculator', result: '3 + 3 = 6' },
        ],
      })

      expect(checks('I am not sure.', two)).toEqual(['wrong-number'])
    })
  })

  describe('figures', () => {
    const searched = evidence({ toolResults: [searchResult] })

    it('catches a figure no source gave', () => {
      // The reported failure: an answer about a life that stated an age nothing
      // had returned. Its only finding used to be that it cited no source, so
      // the correction attached a real URL to an invented number.
      expect(
        checks('He lived to 142.\n\nSource: https://fictionalairways.example/leadership', searched),
      ).toEqual(['unsupported-figure'])
    })

    it('names the figure to drop', () => {
      const [finding] = reviewAnswer('He was 200 years old.', searched)

      expect(finding?.instruction).toContain('No source gives 200')
    })

    it('accepts a figure the search returned', () => {
      expect(checks('Since 2023.\n\nSource: https://fictionalairways.example/leadership', searched)).toEqual(
        [],
      )
    })

    it('accepts a figure the user supplied', () => {
      const asked = evidence({ toolResults: [searchResult], knownFigures: ['1889'] })

      expect(
        checks('Yes, 1889 is right.\n\nSource: https://fictionalairways.example/leadership', asked),
      ).toEqual([])
    })

    it.each([
      ['an age that is two digits', 'He was 56 when he died.'],
      ['a percentage', 'Revenue grew 85%.'],
      ['a figure with a decimal point', 'Revenue was 81.62 billion.'],
      ['a figure with a thousands separator', 'It reached 46,700 units.'],
      ['a thousands group written with a space', 'It reached 46 700 units.'],
    ])('is too shy to challenge %s', (_case, answer) => {
      // Every one of these is a way a correct number can be written that the
      // evidence does not contain verbatim. A check that fires on a correct
      // answer costs a generation and teaches the reader to ignore the label.
      expect(checks(`${answer}\n\nSource: https://fictionalairways.example/leadership`, searched)).toEqual([])
    })

    it('ignores digits that are part of a URL', () => {
      const linked = evidence({
        toolResults: [{ tool: 'web_search', result: 'https://example.com/2026/08/report' }],
      })

      expect(checks('See https://example.com/2026/08/report', linked)).toEqual([])
    })

    it('says nothing about figures when no tool returned anything', () => {
      // With no evidence every figure is unsupported, and reporting that would
      // be telling the model off for answering. `isUnsourced` covers this case.
      expect(checks('He lived to 142.', evidence())).toEqual([])
    })
  })

  describe('sources', () => {
    const searched = evidence({ toolResults: [searchResult] })

    it('accepts the URL the search returned', () => {
      expect(checks('Ama Osei.\n\nSource: https://fictionalairways.example/leadership', searched)).toEqual([])
    })

    it('accepts the site when the tool returned a page on it', () => {
      expect(checks('Ama Osei.\n\nSource: https://fictionalairways.example', searched)).toEqual([])
    })

    it('catches a missing source after a search', () => {
      expect(checks('Ama Osei has led the airline since 2023.', searched)).toEqual(['missing-source'])
    })

    it('names the URL to append', () => {
      const [finding] = reviewAnswer('Ama Osei.', searched)

      expect(finding?.instruction).toContain('Source: https://fictionalairways.example/leadership')
    })

    it('prefers the page that was actually read over the search hit', () => {
      const read = evidence({
        toolResults: [
          searchResult,
          { tool: 'read_page', result: '# Leadership\nSource: https://fictionalairways.example/team/osei' },
        ],
      })
      const [finding] = reviewAnswer('Ama Osei.', read)

      expect(finding?.instruction).toContain('https://fictionalairways.example/team/osei')
    })

    it('catches a source on a host nothing returned', () => {
      expect(checks('Ama Osei.\n\nSource: https://wikipedia.org/Fictional_Airways', searched)).toEqual([
        'invented-source',
      ])
    })

    it('catches an invented path on the right host', () => {
      expect(checks('Ama Osei.\n\nSource: https://fictionalairways.example/about/ceo', searched)).toEqual([
        'invented-source',
      ])
    })

    it('does not ask a clarifying question to cite anything', () => {
      expect(checks('Which city do you mean?', searched)).toEqual([])
    })

    it('does not ask an answer that found nothing to cite anything', () => {
      expect(checks('I could not find who runs it.', searched)).toEqual([])
    })

    it('leaves an answer alone when no tool returned a URL', () => {
      const timed = evidence({ toolResults: [{ tool: 'current_time', result: '2026-08-24T12:00:00.000Z' }] })

      expect(checks('It is 2026.', timed)).toEqual([])
    })

    it('accepts a URL the user supplied but no tool returned', () => {
      const failed = evidence({
        knownUrls: ['https://example.com/pricing'],
        toolResults: [{ tool: 'read_page', result: 'Tool "read_page" failed: network error' }],
      })

      expect(checks('I could not open https://example.com/pricing.', failed)).toEqual([])
    })

    it('accepts a source carried over from an earlier reply', () => {
      // A follow-up question runs no tools of its own, so the URL is only in the
      // history — treating that as an invention would nag on every second turn.
      const followUp = evidence({ knownUrls: ['https://fictionalairways.example/leadership'] })

      expect(checks('Since 2023.\n\nSource: https://fictionalairways.example/leadership', followUp)).toEqual(
        [],
      )
    })

    it('reports both a wrong number and a bad source together', () => {
      const both = evidence({
        toolResults: [searchResult, { tool: 'calculator', result: '2 + 2 = 4' }],
      })

      expect(checks('It is five, per https://wikipedia.org/Maths', both)).toEqual([
        'wrong-number',
        'invented-source',
      ])
    })
  })
})

describe('isUnsourced', () => {
  const searched = evidence({ toolResults: [searchResult] })

  it('is true for a factual answer no tool contributed to', () => {
    // The whole reason this exists: every other check needs evidence to fire, so
    // the answer that consulted nothing was the one nothing was said about.
    expect(isUnsourced('Hitler lived from 1889 to 1945.', evidence())).toBe(true)
  })

  it('is false once a tool returned a source, cited or not', () => {
    // Not citing it is `missing-source`, which has a fix. Calling a turn that
    // searched "answered from memory" would simply be untrue.
    expect(isUnsourced('Ama Osei runs it.', searched)).toBe(false)
  })

  it('is false when the answer cites a source from earlier in the conversation', () => {
    // A follow-up runs no tools of its own, and the source is still on screen.
    const followUp = evidence({ knownUrls: ['https://fictionalairways.example/leadership'] })

    expect(isUnsourced('Since 2023.\n\nSource: https://fictionalairways.example/leadership', followUp)).toBe(
      false,
    )
  })

  it('is false for a URL the model invented', () => {
    // `invented-source` owns that one, and stacking both labels on one reply
    // would say the same thing twice.
    expect(isUnsourced('Ama Osei.\n\nSource: https://madeup.example/ceo', searched)).toBe(false)
  })

  it.each(['Which city do you mean?', 'I could not find out who runs it.'])(
    'is false for %j, which claims nothing',
    (answer) => {
      expect(isUnsourced(answer, evidence())).toBe(false)
    },
  )

  it('is false for an empty draft, which the reasoning promotion handles', () => {
    expect(isUnsourced('   ', evidence())).toBe(false)
  })
})

describe('collectEvidence', () => {
  it('takes the URLs already in the conversation and no tool results yet', () => {
    const collected = collectEvidence([
      { role: 'system', content: 'Prompt mentioning https://system.example' },
      { role: 'user', content: 'Summarise https://example.com/pricing' },
      { role: 'assistant', content: 'Source: https://example.com/old' },
      { role: 'tool', content: 'https://exemplar.example/page' },
    ])

    // The system turn and the exemplar tool turns are not evidence: a URL from a
    // worked example is exactly the kind of thing the model should not cite.
    expect(collected).toEqual({
      toolResults: [],
      knownUrls: ['https://example.com/pricing', 'https://example.com/old'],
      knownFigures: [],
    })
  })

  it('takes figures from the user and nowhere else', () => {
    // A skill's worked example is an assistant turn. Reading figures out of it
    // would whitelist the example's own numbers on every turn that skill wins.
    const collected = collectEvidence([
      { role: 'user', content: 'Is 1889 right?' },
      { role: 'assistant', content: 'Earlier I said 1723.' },
      { role: 'tool', content: 'A tool once returned 1456.' },
    ])

    expect(collected.knownFigures).toEqual(['1889'])
  })
})

describe('correctionPrompt', () => {
  it('states every fix and asks for the answer alone', () => {
    const prompt = correctionPrompt([
      { check: 'wrong-number', instruction: 'Say 4.' },
      { check: 'missing-source', instruction: 'Cite the page.' },
    ])

    expect(prompt).toBe('Say 4. Cite the page. Reply with the corrected answer only.')
  })
})
