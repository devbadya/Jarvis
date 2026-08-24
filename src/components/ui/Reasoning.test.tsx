import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Reasoning } from './Reasoning'

describe('Reasoning', () => {
  it('says the model is thinking before there is a thought to show', () => {
    render(<Reasoning streaming text="" />)

    expect(screen.getByText('Thinking…')).toBeInTheDocument()
    // Nothing to open yet, so nothing pretends to be openable.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows nothing at all for a finished reply that never reasoned', () => {
    const { container } = render(<Reasoning text="" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('stays collapsed while the thinking streams in', () => {
    render(<Reasoning streaming text="Checking the date first." />)

    const trigger = screen.getByRole('button', { name: 'Thinking…' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('counts the thinking, not the reply, so the number cannot shrink at the end', () => {
    const { rerender } = render(<Reasoning durationMs={3200} streaming text="Still going." />)
    expect(screen.getByRole('button', { name: 'Thinking… 3s' })).toBeInTheDocument()

    // The answer then takes several more seconds, and the thinking clock has
    // already stopped: the finished label must agree with what was on screen.
    rerender(<Reasoning durationMs={3200} text="Still going." />)
    expect(screen.getByRole('button', { name: 'Thought for 3.2 s' })).toBeInTheDocument()
  })

  it('reports how long the thinking took once the answer has landed', () => {
    render(<Reasoning durationMs={4200} text="Checked the date." />)

    expect(screen.getByRole('button', { name: 'Thought for 4.2 s' })).toBeInTheDocument()
  })

  it('falls back to a label with no duration when none was measured', () => {
    render(<Reasoning text="Some earlier reply." />)

    expect(screen.getByRole('button', { name: 'Thoughts' })).toBeInTheDocument()
  })

  it('reveals the thinking on click, one step per break the model wrote', async () => {
    const user = userEvent.setup()
    render(<Reasoning durationMs={1000} text={'First, the date.\n\nThen, the search.'} />)

    const trigger = screen.getByRole('button', { name: 'Thought for 1.0 s' })
    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('listitem').map((step) => step.textContent)).toEqual([
      'First, the date.',
      'Then, the search.',
    ])
  })

  it('does not make a link out of a URL the model talked itself into', async () => {
    const user = userEvent.setup()
    render(<Reasoning durationMs={1000} text="I think it was https://invented.example/page" />)

    await user.click(screen.getByRole('button', { name: 'Thought for 1.0 s' }))

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
