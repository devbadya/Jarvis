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

  describe('clock', () => {
    const germany = evidence({
      toolResults: [
        {
          tool: 'current_time',
          result: 'Germany — 22:40 CEST (UTC+2, Europe/Berlin), Thu 27 Aug 2026',
        },
      ],
    })

    it('accepts the local hour the clock returned', () => {
      expect(checks('In Deutschland ist es 22:40 Uhr CEST.', germany)).toEqual([])
    })

    it('accepts a dotted German time and hour-only Uhr', () => {
      expect(checks('Es ist 22.40 Uhr.', germany)).toEqual([])
      expect(checks('Es ist 22 Uhr.', germany)).toEqual([])
    })

    it('accepts a 12-hour rendering with a meridiem', () => {
      expect(checks('In Germany it is 10:40 PM.', germany)).toEqual([])
    })

    it('catches the UTC hour copied off the same instant', () => {
      expect(checks('Es ist 20:40 Uhr. Dies ist korrekt für diese Zeitzone.', germany)).toEqual([
        'wrong-number',
      ])
    })

    it('catches an ISO instant that still carries the UTC hour', () => {
      expect(checks('The time is 2026-08-27T20:40:19.483Z.', germany)).toEqual(['wrong-number'])
    })

    it('quotes the local time in the correction', () => {
      const [finding] = reviewAnswer('20:40 Uhr', germany)

      expect(finding?.instruction).toContain('22:40')
    })

    it('leaves a year-only answer alone', () => {
      expect(checks('It is 2026.', germany)).toEqual([])
    })

    it('leaves a date without a clock time alone', () => {
      expect(checks('Heute ist der 27.08.2026.', germany)).toEqual([])
      expect(checks('Heute ist der 12.08.2026.', germany)).toEqual([])
    })

    it('leaves a failed clock call alone', () => {
      const failed = evidence({
        toolResults: [
          { tool: 'current_time', result: 'Tool "current_time" failed: No place called "Narnia"' },
        ],
      })

      expect(checks('I could not find that place.', failed)).toEqual([])
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
      const timed = evidence({
        toolResults: [{ tool: 'current_time', result: '12:00 GST (UTC+4, Asia/Dubai), Mon 24 Aug 2026' }],
      })

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
    })
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
