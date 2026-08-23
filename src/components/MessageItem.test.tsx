import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MessageItem } from './MessageItem'
import type { Message } from '@/types'

function message(overrides: Partial<Message>): Message {
  return { id: '1', role: 'assistant', content: '', createdAt: 0, ...overrides }
}

describe('MessageItem', () => {
  it('renders a user message', () => {
    render(<MessageItem message={message({ role: 'user', content: 'Hello there' })} />)
    expect(screen.getByText('Hello there')).toBeInTheDocument()
  })

  it('shows a placeholder while the assistant has produced nothing yet', () => {
    render(<MessageItem message={message({ streaming: true })} />)
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
  })

  it('collapses reasoning behind a disclosure', () => {
    render(<MessageItem message={message({ content: 'Answer', reasoning: 'Internal notes' })} />)
    expect(screen.getByText('Reasoning')).toBeInTheDocument()
    expect(screen.getByText('Answer')).toBeInTheDocument()
  })

  it('lists tool calls with their status', () => {
    render(
      <MessageItem
        message={message({
          content: 'Done',
          toolCalls: [
            { id: 't1', name: 'web_search', arguments: { query: 'vite' }, status: 'done', result: 'ok' },
          ],
        })}
      />,
    )
    expect(screen.getByText('web_search')).toBeInTheDocument()
    expect(screen.getByText('done')).toBeInTheDocument()
  })

  it('reports throughput once generation finished', () => {
    render(
      <MessageItem
        message={message({
          content: 'Answer',
          stats: { tokens: 40, thinkTokens: 12, durationMs: 2000, tokensPerSecond: 20 },
        })}
      />,
    )
    expect(screen.getByText(/20\.0 tok\/s/)).toBeInTheDocument()
  })

  it('copies a finished reply to the clipboard', async () => {
    const user = userEvent.setup()
    render(<MessageItem message={message({ content: 'The answer is 42' })} />)

    await user.click(screen.getByRole('button', { name: 'Copy reply' }))

    expect(await navigator.clipboard.readText()).toBe('The answer is 42')
    expect(screen.getByRole('button', { name: 'Reply copied' })).toBeInTheDocument()
  })

  it('offers no copy button while tokens are still arriving', () => {
    render(<MessageItem message={message({ content: 'Partial', streaming: true })} />)
    expect(screen.queryByRole('button', { name: 'Copy reply' })).not.toBeInTheDocument()
  })
})
