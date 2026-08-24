import { describe, expect, it } from 'vitest'
import { rewindToLastPrompt } from './chat'
import type { Message } from '@/types'

function message(role: Message['role'], content: string): Message {
  return { id: content, role, content, createdAt: 0 }
}

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
