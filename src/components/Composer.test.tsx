import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Composer } from './Composer'
import { useChatStore } from '@/store/chat'

afterEach(() => useChatStore.setState({ busy: false }))

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
})
