import { describe, expect, it } from 'vitest'
import { chatTitle, durableMessages } from './transcript'
import type { Message } from '@/types'

function message(role: Message['role'], content: string, extra: Partial<Message> = {}): Message {
  return { id: content || role, role, content, createdAt: 0, ...extra }
}

describe('durableMessages', () => {
  it('drops a reply that has not produced anything yet', () => {
    const saved = durableMessages([
      message('user', 'Hello'),
      message('assistant', '', { streaming: true, toolCalls: [] }),
    ])

    expect(saved.map((entry) => entry.content)).toEqual(['Hello'])
  })

  it('keeps a finished reply and clears the streaming flag', () => {
    const [saved] = durableMessages([message('assistant', '14°C', { streaming: true })]).slice(-1)

    expect(saved?.content).toBe('14°C')
    expect(saved?.streaming).toBeUndefined()
  })

  it('does not restore a tool call that was still running', () => {
    const [saved] = durableMessages([
      message('assistant', '', {
        toolCalls: [{ id: 't', name: 'web_search', arguments: { query: 'news' }, status: 'running' }],
      }),
    ])

    expect(saved?.toolCalls?.[0]?.status).toBe('error')
    expect(saved?.toolCalls?.[0]?.error).toMatch(/Stopped/)
  })
})

describe('chatTitle', () => {
  it('uses the first question, collapsed onto one line', () => {
    expect(chatTitle([message('user', '  Weather\nin Berlin  ')])).toBe('Weather in Berlin')
  })

  it('shortens a question that would not fit a row', () => {
    const title = chatTitle([message('user', 'a'.repeat(80))])
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(72)
  })
})
