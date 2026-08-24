import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Composer } from './Composer'
import { useChatStore } from '@/store/chat'

afterEach(() => useChatStore.setState({ busy: false, queued: [], messages: [] }))

describe('Composer', () => {
  it('renders the input and disables sending while empty', () => {
    render(<Composer />)
    expect(screen.getByLabelText('Message')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('enables sending once text is typed', async () => {
    const user = userEvent.setup()
    render(<Composer />)
    await user.type(screen.getByLabelText('Message'), 'Hello')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('trades sending for stopping while a reply is running', () => {
    useChatStore.setState({ busy: true })
    render(<Composer />)

    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    // Typing is still allowed, so it has to say what will happen to what is typed.
    expect(screen.getByLabelText('Message')).toBeEnabled()
    expect(screen.getByText('Jarvis is replying')).toBeInTheDocument()
  })

  it('queues what is typed during a reply instead of dropping it', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ status: 'ready', busy: true })
    render(<Composer />)

    await user.type(screen.getByLabelText('Message'), 'And in Lisbon?{Enter}')

    expect(useChatStore.getState().queued).toEqual(['And in Lisbon?'])
    // Shown, so the follow-up is not a promise the interface made in private.
    const waiting = screen.getByRole('list', { name: 'Waiting to be sent' })
    expect(waiting).toHaveTextContent('And in Lisbon?')
    // And the box is empty, ready for the next one.
    expect(screen.getByLabelText('Message')).toHaveValue('')
  })

  it('offers the queue to a pointer as well as to Enter', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ status: 'ready', busy: true })
    render(<Composer />)

    expect(screen.queryByRole('button', { name: 'Queue' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Message'), 'Later, then')
    await user.click(screen.getByRole('button', { name: 'Queue' }))

    expect(useChatStore.getState().queued).toEqual(['Later, then'])
  })

  it('takes a queued message back out again', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ status: 'ready', busy: true, queued: ['first', 'second'] })
    render(<Composer />)

    await user.click(screen.getByRole('button', { name: 'Remove “first” from the queue' }))

    expect(useChatStore.getState().queued).toEqual(['second'])
  })
})
