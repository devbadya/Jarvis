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

  it('keeps the thinking collapsed behind a trigger the reader can open', async () => {
    const user = userEvent.setup()
    render(
      <MessageItem
        message={message({ content: 'Answer', reasoning: 'Internal notes', reasoningMs: 3200 })}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Thought for 3.2 s' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Answer')).toBeInTheDocument()

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Internal notes')).toBeInTheDocument()
  })

  it('says what a tool call did, and keeps its name for when that matters', () => {
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
    expect(screen.getByRole('button', { name: /Searched the web/ })).toBeInTheDocument()
    expect(screen.getByText('web_search')).toBeInTheDocument()
  })

  it('collects a turn that used several tools into one row', () => {
    render(
      <MessageItem
        message={message({
          content: 'Done',
          toolCalls: [
            { id: 't1', name: 'web_search', arguments: {}, status: 'done', durationMs: 400 },
            { id: 't2', name: 'read_page', arguments: {}, status: 'error', error: 'CORS', durationMs: 600 },
          ],
        })}
      />,
    )

    expect(screen.getByRole('button', { name: /Used 2 tools/ })).toBeInTheDocument()
    expect(screen.getByText('1 failed')).toBeInTheDocument()
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

  it('turns the citation line the skills ask for into a pill', () => {
    render(<MessageItem message={message({ content: 'Ama Osei.\n\nSource: https://example.com/who' })} />)

    const link = screen.getByRole('link', { name: 'example.com' })
    expect(link).toHaveAttribute('href', 'https://example.com/who')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    // Lifted out of the prose, not duplicated into it.
    expect(screen.queryByText(/Source:/)).not.toBeInTheDocument()
  })

  it('leaves a URL the reply used in a sentence where it was written', () => {
    render(<MessageItem message={message({ content: 'See https://example.com/docs for the rest.' })} />)

    expect(screen.getByRole('link', { name: 'https://example.com/docs' })).toBeInTheDocument()
  })

  it('waits for the reply to finish before lifting out a half-typed citation', () => {
    render(
      <MessageItem message={message({ content: 'Ama Osei.\n\nSource: https://exa', streaming: true })} />,
    )

    expect(screen.getByText(/Source:/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'exa' })).not.toBeInTheDocument()
  })

  it('renders a bulleted reply as a list rather than as hyphens', () => {
    render(<MessageItem message={message({ content: 'Plans:\n- Free\n- Team' })} />)

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Free', 'Team'])
  })

  it('renders fenced code as a block instead of printing the backticks', () => {
    render(<MessageItem message={message({ content: '```ts\nconst a = 1\n```' })} />)

    expect(screen.getByText('const a = 1')).toBeInTheDocument()
    expect(screen.queryByText(/```/)).not.toBeInTheDocument()
  })

  it('names the language of a code block and copies just the code', async () => {
    const user = userEvent.setup()
    render(<MessageItem message={message({ content: 'Try:\n\n```ts\nconst a = 1\n```' })} />)

    expect(screen.getByText('ts')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy code' }))

    expect(await navigator.clipboard.readText()).toBe('const a = 1')
  })

  it('marks a failed turn as a failure rather than passing it off as an answer', () => {
    render(<MessageItem isLatest message={message({ error: 'The inference worker crashed' })} />)

    expect(screen.getByText('The reply did not finish')).toBeInTheDocument()
    expect(screen.getByText('The inference worker crashed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('keeps whatever streamed before the failure', () => {
    render(<MessageItem isLatest message={message({ content: 'Half an ans', error: 'Interrupted' })} />)

    expect(screen.getByText('Half an ans')).toBeInTheDocument()
    expect(screen.getByText('The reply did not finish')).toBeInTheDocument()
    // The rerun lives in the alert, so the footer must not offer a second one.
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument()
  })

  it('says the answer is being rewritten rather than letting it reset silently', () => {
    render(
      <MessageItem
        message={message({
          content: '',
          streaming: true,
          review: { found: ['missing-source'], corrected: false },
        })}
      />,
    )

    expect(screen.getByText(/Correcting a missing source/)).toBeInTheDocument()
    // The generic placeholder would say nothing about why the draft vanished.
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument()
  })

  it('reports a correction the self-check made', () => {
    render(
      <MessageItem
        message={message({
          content: 'Ama Osei.\n\nSource: https://example.com/who',
          review: { found: ['missing-source'], corrected: true },
        })}
      />,
    )

    expect(screen.getByText('corrected')).toBeInTheDocument()
    expect(screen.getByText(/self-check found a missing source and fixed it/)).toBeInTheDocument()
  })

  it('admits it when a problem was found and not fixed', () => {
    render(
      <MessageItem
        message={message({
          content: 'Ama Osei.',
          review: { found: ['invented-source'], corrected: false },
        })}
      />,
    )

    expect(screen.getByText('flagged')).toBeInTheDocument()
    expect(screen.getByText(/self-check found a source no tool returned/)).toBeInTheDocument()
  })

  it('names the skill a reply was answered with', () => {
    render(
      <MessageItem
        message={message({ content: '14°C', skill: { name: 'weather', reason: 'trigger', matched: [] } })}
      />,
    )

    expect(screen.getByText('weather skill')).toBeInTheDocument()
  })

  it('says which keyword found the skill, so a mis-route can be spotted', () => {
    render(
      <MessageItem
        message={message({
          content: '14°C',
          skill: { name: 'weather', reason: 'search', matched: ['wetter'] },
        })}
      />,
    )

    expect(screen.getByText('weather skill · matched “wetter”')).toBeInTheDocument()
  })

  it('admits when a skill was carried over rather than matched', () => {
    render(
      <MessageItem
        message={message({
          content: '19°C',
          skill: { name: 'weather', reason: 'carried-over', matched: [] },
        })}
      />,
    )

    expect(screen.getByText('weather skill · carried over')).toBeInTheDocument()
  })

  it('says nothing about a reply that passed the check', () => {
    render(<MessageItem message={message({ content: 'Answer', review: { found: [], corrected: false } })} />)

    expect(screen.queryByText(/self-check/)).not.toBeInTheDocument()
  })

  it('offers a rerun on the newest reply only', () => {
    const { rerender } = render(<MessageItem isLatest message={message({ content: 'Answer' })} />)
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()

    rerender(<MessageItem message={message({ content: 'Answer' })} />)
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument()
  })
})
