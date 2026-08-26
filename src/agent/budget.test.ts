import { describe, expect, it } from 'vitest'
import { MAX_TOOL_ROUNDS } from '@/llm/config'
import { splitSources } from '@/lib/sources'
import { budgetFallback, callFingerprint, repeatedCallNote, windDownNote } from './budget'
import type { ReviewEvidence } from './review'

function evidence(results: { tool: string; result: string }[] = []): ReviewEvidence {
  return { toolResults: results, knownUrls: [], question: 'Who leads Fictional Airways?' }
}

const searchResult = {
  tool: 'web_search',
  result:
    '1. Leadership — Fictional Airways\n   https://fictionalairways.example/leadership\n   Ama Osei leads it.',
}

describe('windDownNote', () => {
  it('says how much is left and what happens after it', () => {
    const note = windDownNote(1)

    expect(note).toContain('one more round')
    expect(note).toContain('answer with what you have')
  })

  it('agrees with itself about more than one round', () => {
    expect(windDownNote(2)).toContain('2 more rounds')
  })
})

describe('callFingerprint', () => {
  it('matches the same call written differently', () => {
    // Arguments arrive as untyped strings and in whatever order the model emitted.
    expect(callFingerprint('web_search', { query: ' Sergej  Kunz ', limit: '5' })).toBe(
      callFingerprint('web_search', { limit: '5', query: 'sergej kunz' }),
    )
  })

  it('separates a call that would fetch something else', () => {
    expect(callFingerprint('web_search', { query: 'weather Berlin' })).not.toBe(
      callFingerprint('web_search', { query: 'weather Munich' }),
    )
  })

  it('separates the same arguments passed to another tool', () => {
    expect(callFingerprint('web_search', { query: 'pi' })).not.toBe(
      callFingerprint('read_page', { query: 'pi' }),
    )
  })

  it('ignores an argument the model left empty', () => {
    expect(callFingerprint('web_search', { query: 'pi', limit: '  ' })).toBe(
      callFingerprint('web_search', { query: 'pi' }),
    )
  })
})

describe('repeatedCallNote', () => {
  it('repeats the result rather than pointing back at it', () => {
    const note = repeatedCallNote('web_search', searchResult.result)

    expect(note).toContain('was already called')
    expect(note).toContain('https://fictionalairways.example/leadership')
  })
})

describe('budgetFallback', () => {
  it('hands over the pages the turn found', () => {
    const text = budgetFallback(evidence([searchResult]))

    expect(text).toContain(`${MAX_TOOL_ROUNDS} rounds`)
    // A trailing one-line citation is the shape the interface lifts into pills,
    // so the sources of a failed turn are still clickable.
    expect(splitSources(text).sources).toEqual(['https://fictionalairways.example/leadership'])
  })

  it('lists each page once, however many results carried it', () => {
    const text = budgetFallback(evidence([searchResult, searchResult]))

    expect(splitSources(text).sources).toEqual(['https://fictionalairways.example/leadership'])
  })

  it('asks for a narrower question when no tool returned a source', () => {
    const text = budgetFallback(evidence([{ tool: 'calculator', result: '2 + 2 = 4' }]))

    expect(text).toContain('Try narrowing the question')
    expect(splitSources(text).sources).toEqual([])
  })
})
