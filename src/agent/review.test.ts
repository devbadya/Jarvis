import { describe, expect, it } from 'vitest'
import { collectEvidence, correctionPrompt, reviewAnswer, type ReviewEvidence } from './review'

function evidence(overrides: Partial<ReviewEvidence> = {}): ReviewEvidence {
  return { toolResults: [], knownUrls: [], ...overrides }
}

const searchResult = {
  tool: 'web_search',
  result:
    '1. Leadership — Fictional Airways\n   https://fictionalairways.example/leadership\n   Ama Osei leads it.',
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

    it('accepts a negative written with the minus sign prose uses', () => {
      const owed = evidence({ toolResults: [{ tool: 'calculator', result: '3 - 8 = -5' }] })

      // U+2212, which a model writing prose reaches for and `Number` never does.
      expect(checks('The result is \u22125.', owed)).toEqual([])
    })

    it('checks nothing when the value only exists in exponent form', () => {
      const huge = evidence({ toolResults: [{ tool: 'calculator', result: '10 ^ 21 = 1e+21' }] })

      // `String` and `toFixed` both keep the `e`, so an answer that writes the
      // number out in full would read as the wrong number.
      expect(checks('That is 1,000,000,000,000,000,000,000.', huge)).toEqual([])
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

    it('does not treat a URL as a citation when nothing was fetched', () => {
      // *What is Anthropic's website* is answered with a URL, and that URL is
      // the answer rather than a source for one.
      expect(checks('It is https://anthropic.com.', evidence())).toEqual([])
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

describe('collectEvidence', () => {
  it('takes the URLs already in the conversation and no tool results yet', () => {
    const collected = collectEvidence([
      { role: 'system', content: 'Prompt mentioning https://system.example' },
      { role: 'user', content: 'Summarise https://example.com/pricing' },
      { role: 'assistant', content: 'Source: https://example.com/old' },
      { role: 'tool', content: 'https://exemplar.example/page' },
    ])

    // The system turn and any tool turn already in the history are not evidence.
    expect(collected).toEqual({
      toolResults: [],
      knownUrls: ['https://example.com/pricing', 'https://example.com/old'],
    })
  })

  it('carries over the URLs an earlier reply cited', () => {
    const history = [
      { role: 'user' as const, content: 'Who runs it?' },
      { role: 'assistant' as const, content: 'Ama Osei.\n\nSource: https://fictionalairways.example' },
    ]

    expect(collectEvidence(history).knownUrls).toEqual(['https://fictionalairways.example'])
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
