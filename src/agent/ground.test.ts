import { describe, expect, it } from 'vitest'
import { defineTool } from '@/tools/types'
import type { TopicTurn } from '@/memory/topic'
import { formatResearchedReply, researchQuery, researchSeed, settleResearch } from './ground'
import type { ReviewEvidence } from './review'

function turn(role: TopicTurn['role'], content: string, toolCalls?: TopicTurn['toolCalls']): TopicTurn {
  return { role, content, toolCalls }
}

const chancellor: TopicTurn[] = [
  turn('user', 'Wer ist der Bundeskanzler?'),
  turn('assistant', 'Friedrich Merz, seit Mai 2025.', [
    {
      name: 'research',
      arguments: { query: 'Bundeskanzler' },
      status: 'done',
      result: [
        'Answer: Friedrich Merz.',
        '',
        'Researched 2026-09-10 for "Bundeskanzler" across 1 source, all read in full.',
        '',
        '1. Bundeskanzler — https://de.wikipedia.org/wiki/Bundeskanzler',
        '   "Amtsträger ist Friedrich Merz."',
      ].join('\n'),
    },
  ]),
]

const franceThen: TopicTurn[] = [
  turn('user', 'Who is the president of France?'),
  turn('assistant', 'Emmanuel Macron.'),
]

function evidence(results: { tool: string; result: string }[] = []): ReviewEvidence {
  return { toolResults: results, knownUrls: [] }
}

const merzDigest = [
  'Answer: Friedrich Merz.',
  '',
  'Researched 2026-09-10 for "Bundeskanzler" across 1 source, all read in full.',
  '',
  '1. Bundeskanzler — https://de.wikipedia.org/wiki/Bundeskanzler',
  '   "Amtsträger ist Friedrich Merz."',
].join('\n')

describe('researchQuery', () => {
  it('passes a complete question through', () => {
    expect(researchQuery('who is the president of the USA')).toBe('who is the president of the USA')
  })

  it('does not mix a new complete question with the previous office', () => {
    expect(researchQuery('who is the president of the USA', franceThen)).toBe(
      'who is the president of the USA',
    )
  })

  it('keeps the last office and adds the new place on a follow-up', () => {
    expect(researchQuery('und der von Frankreich?', chancellor)).toBe('Bundeskanzler Frankreich')
  })

  it('keeps the last office on a correction that only names a place', () => {
    const russia = [turn('user', 'Wer ist der russische Präsident?'), turn('assistant', 'Wladimir Putin.')]
    expect(researchQuery('nein in russland', russia)).toBe('russische Präsident russland')
  })

  it('does not pin the last office onto a new person', () => {
    expect(researchQuery('Wer ist Elon Musk?', chancellor)).toBe('Wer ist Elon Musk?')
    expect(researchQuery('und Elon Musk?', chancellor)).toBe('und Elon Musk?')
  })
})

describe('researchSeed', () => {
  const research = defineTool('research', 'look it up', { type: 'object', properties: {} }, async () => '')

  it('seeds research when that skill routed', () => {
    expect(
      researchSeed({ skill: { name: 'research-question' }, tools: [research] }, 'Who wrote Dune?'),
    ).toEqual({ name: 'research', arguments: { query: 'Who wrote Dune?' } })
  })

  it('does not seed another skill', () => {
    expect(researchSeed({ skill: { name: 'weather' }, tools: [research] }, 'Who wrote Dune?')).toBeNull()
  })

  it('does not seed when the research tool is missing', () => {
    expect(researchSeed({ skill: { name: 'research-question' }, tools: [] }, 'Who wrote Dune?')).toBeNull()
  })
})

describe('formatResearchedReply', () => {
  it('hands over the extract and its source', () => {
    expect(formatResearchedReply(evidence([{ tool: 'research', result: merzDigest }]))).toBe(
      'Friedrich Merz.\n\nSource: https://de.wikipedia.org/wiki/Bundeskanzler',
    )
  })

  it('stays silent when the digest committed to no extract', () => {
    expect(
      formatResearchedReply(
        evidence([{ tool: 'research', result: 'Researched 2026-09-11 for "x". No results.' }]),
      ),
    ).toBeNull()
  })
})

describe('settleResearch', () => {
  it('prefers the extract over a passage', () => {
    expect(
      settleResearch(evidence([{ tool: 'research', result: merzDigest }]), 'Wer ist der Bundeskanzler?'),
    ).toBe('Friedrich Merz.\n\nSource: https://de.wikipedia.org/wiki/Bundeskanzler')
  })

  it('quotes a passage when research has sources but no extract', () => {
    const digest = [
      'Researched 2026-09-11 for "Elon Musk" across 1 source, all read in full.',
      '',
      '1. Elon Musk — https://en.wikipedia.org/wiki/Elon_Musk',
      '   "Elon Musk is a businessman."',
    ].join('\n')

    expect(settleResearch(evidence([{ tool: 'research', result: digest }]), 'Who is Elon Musk?')).toBe(
      'Elon Musk is a businessman.\n\nSource: https://en.wikipedia.org/wiki/Elon_Musk',
    )
  })

  it('refuses in the language of the question when nothing came back', () => {
    expect(settleResearch(evidence(), 'who is the president of the USA')).toBe(
      'I could not find a reliable answer.',
    )
    expect(settleResearch(evidence(), 'Wer ist der Präsident der USA?')).toBe(
      'Dazu habe ich keine verlässliche Antwort gefunden.',
    )
  })

  it('surfaces a lookup failure instead of inventing a fact', () => {
    expect(settleResearch(evidence(), 'who is the president of the USA', 'rate-limited')).toBe(
      'Lookup failed: rate-limited',
    )
    expect(settleResearch(evidence(), 'Wer ist der Präsident?', 'rate-limited')).toBe(
      'Nachschlagen fehlgeschlagen: rate-limited',
    )
  })
})
