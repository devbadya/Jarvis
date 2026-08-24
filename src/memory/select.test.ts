import { describe, expect, it } from 'vitest'
import {
  MAX_STANDING_PREFERENCES,
  recallFor,
  renderMemoryBlock,
  scoreMemory,
  selectMemories,
  tokenize,
} from './select'
import type { MemoryRecord } from './types'

function memory(text: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: text.slice(0, 6),
    text,
    kind: 'fact',
    source: 'user',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('tokenize', () => {
  it('drops the words every message contains', () => {
    expect(tokenize('What do you know about my flat?')).toEqual(['know', 'flat'])
  })
})

describe('scoreMemory', () => {
  it('counts the distinct words the memory shares with the question', () => {
    expect(scoreMemory('where is my flat in Lisbon?', memory('The flat in Lisbon has no lift'))).toBe(2)
  })

  it('scores nothing for an unrelated memory', () => {
    expect(scoreMemory('what is the capital of France?', memory('Owns a bike'))).toBe(0)
  })
})

describe('selectMemories', () => {
  it('carries preferences into a turn that never mentions them', () => {
    const records = [memory('Prefers short answers', { kind: 'preference' }), memory('Owns a bike')]

    expect(selectMemories('What is the capital of France?', records).map((entry) => entry.text)).toEqual([
      'Prefers short answers',
    ])
  })

  it('adds the facts the question is about', () => {
    const records = [memory('Owns a bike'), memory('Lives in Lisbon')]

    expect(selectMemories('Is my bike insured?', records).map((entry) => entry.text)).toEqual(['Owns a bike'])
  })

  it('prefers the newest when two memories match equally well', () => {
    const records = [
      memory('Lives in Berlin', { id: 'old', updatedAt: 1 }),
      memory('Lives in Lisbon', { id: 'new', updatedAt: 2 }),
    ]

    expect(selectMemories('Where do I live?', records).map((entry) => entry.id)).toEqual(['new', 'old'])
  })

  it('carries only the most recent standing preferences', () => {
    const records = Array.from({ length: 6 }, (_, index) =>
      memory(`Preference ${index}`, { kind: 'preference', updatedAt: index }),
    )

    expect(selectMemories('Hello', records)).toHaveLength(MAX_STANDING_PREFERENCES)
  })

  it('stops at the character budget rather than at the count', () => {
    const records = [memory('a'.repeat(30)), memory('b'.repeat(30))]

    const selected = selectMemories(`${'a'.repeat(30)} ${'b'.repeat(30)}`, records, { budget: 40 })

    expect(selected).toHaveLength(1)
  })

  it('recalls nothing from an empty store', () => {
    expect(selectMemories('Where do I live?', [])).toEqual([])
  })
})

describe('renderMemoryBlock', () => {
  it('lists the memories as bare sentences', () => {
    expect(renderMemoryBlock([memory('Lives in Lisbon'), memory('Owns a bike')])).toBe(
      'What you already know about this user:\n- Lives in Lisbon\n- Owns a bike',
    )
  })

  it('is empty when there is nothing to recall, so no prompt grows', () => {
    expect(renderMemoryBlock([])).toBe('')
    expect(recallFor('Where do I live?', [])).toBe('')
  })
})
