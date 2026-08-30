import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ToolActivity } from './ToolActivity'
import type { ToolCall } from '@/types'

function call(overrides: Partial<ToolCall> & { id: string }): ToolCall {
  return { name: 'web_search', arguments: {}, status: 'done', ...overrides }
}

describe('ToolActivity', () => {
  it('shows a single call as itself', () => {
    render(<ToolActivity calls={[call({ id: 't1', arguments: { query: 'vite' }, durationMs: 900 })]} />)

    expect(screen.getByRole('button', { name: /Searched the web/ })).toBeInTheDocument()
    expect(screen.getByText('query: vite')).toBeInTheDocument()
  })

  it('names the tool that is still running rather than counting the finished ones', () => {
    render(
      <ToolActivity
        calls={[
          call({ id: 't1', durationMs: 500 }),
          call({ id: 't2', name: 'read_page', status: 'running' }),
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: /Reading a page…/ })).toBeInTheDocument()
  })

  it('adds up the time a finished group spent and counts what failed', async () => {
    const user = userEvent.setup()
    render(
      <ToolActivity
        calls={[
          call({ id: 't1', durationMs: 400 }),
          call({ id: 't2', name: 'read_page', status: 'error', error: 'CORS', durationMs: 1600 }),
        ]}
      />,
    )

    const group = screen.getByRole('button', { name: /Used 2 tools/ })
    expect(group).toHaveAccessibleName(expect.stringContaining('2.0 s'))
    expect(screen.getByText('1 failed')).toBeInTheDocument()

    await user.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('CORS')).toBeInTheDocument()
  })

  it('keeps a world-clock reading live after the snapshot froze', () => {
    render(
      <ToolActivity
        calls={[
          call({
            id: 't1',
            name: 'current_time',
            arguments: { place: 'Deutschland' },
            result: 'Germany — 22:40 CEST (UTC+2, Europe/Berlin), Thu 27 Aug 2026',
          }),
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: /Live clock/ })).toBeInTheDocument()
    expect(screen.getAllByLabelText('Live time in Europe/Berlin').length).toBeGreaterThan(0)
    expect(screen.getByText('place: Deutschland')).toBeInTheDocument()
  })

  it('renders nothing for a turn that called no tools', () => {
    const { container } = render(<ToolActivity calls={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
