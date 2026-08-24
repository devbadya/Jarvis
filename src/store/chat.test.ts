import { describe, expect, it } from 'vitest'
import { residentSkill, rewindToLastPrompt } from './chat'
import type { AppliedSkill, Message } from '@/types'

function message(role: Message['role'], content: string): Message {
  return { id: content, role, content, createdAt: 0 }
}

function answer(content: string, skill?: AppliedSkill): Message {
  return { ...message('assistant', content), ...(skill ? { skill } : {}) }
}

const matched: AppliedSkill = { name: 'weather', reason: 'trigger', matched: [] }
const carried: AppliedSkill = { name: 'weather', reason: 'carried-over', matched: [] }

describe('rewindToLastPrompt', () => {
  it('drops the reply being rerun but keeps the request', () => {
    const rewound = rewindToLastPrompt([
      message('user', 'first'),
      message('assistant', 'first answer'),
      message('user', 'second'),
      message('assistant', 'failed'),
    ])

    expect(rewound?.map((entry) => entry.content)).toEqual(['first', 'first answer', 'second'])
  })

  it('leaves a transcript already ending in a request alone', () => {
    const messages = [message('user', 'only')]
    expect(rewindToLastPrompt(messages)?.map((entry) => entry.content)).toEqual(['only'])
  })

  it('has nothing to rerun without a request', () => {
    expect(rewindToLastPrompt([])).toBeNull()
    expect(rewindToLastPrompt([message('assistant', 'orphan')])).toBeNull()
  })
})

describe('residentSkill', () => {
  it('has nothing to carry into a fresh conversation', () => {
    expect(residentSkill([])).toBeNull()
    expect(residentSkill([message('user', 'hello')])).toBeNull()
  })

  it('offers the skill the last reply used', () => {
    expect(residentSkill([message('user', 'weather in Berlin?'), answer('14°C', matched)])).toEqual({
      name: 'weather',
      carried: 0,
    })
  })

  it('counts the turns it has been carried without matching again', () => {
    const transcript = [
      message('user', 'weather in Berlin?'),
      answer('14°C', matched),
      message('user', 'and in Lisbon?'),
      answer('19°C', carried),
      message('user', 'and tomorrow?'),
      answer('Showers', carried),
    ]

    expect(residentSkill(transcript)).toEqual({ name: 'weather', carried: 2 })
  })

  it('resets the count when the skill matched outright again', () => {
    const transcript = [
      message('user', 'and in Lisbon?'),
      answer('19°C', carried),
      message('user', 'what is the weather in Rome?'),
      answer('21°C', matched),
    ]

    expect(residentSkill(transcript)).toEqual({ name: 'weather', carried: 0 })
  })

  it('forgets a skill the newest reply did not use', () => {
    const transcript = [message('user', 'weather?'), answer('14°C', matched), answer('A poem')]

    // The reply in between routed to nothing, which is itself the eviction.
    expect(residentSkill(transcript)).toBeNull()
  })

  it('is read off the transcript, so rewinding a rerun rewinds it too', () => {
    const transcript = [
      message('user', 'weather in Berlin?'),
      answer('14°C', matched),
      message('user', 'and in Lisbon?'),
      answer('19°C', carried),
    ]
    const rewound = rewindToLastPrompt(transcript) ?? []

    // A counter kept to one side would still be carrying the turn just discarded,
    // and the rerun would route differently from the run it replaces.
    expect(residentSkill(rewound)).toEqual({ name: 'weather', carried: 0 })
  })
})
