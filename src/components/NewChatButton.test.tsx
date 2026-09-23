import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { NewChatButton } from './NewChatButton'
import { useChatStore } from '@/store/chat'
import type { Message } from '@/types'

function seed(): void {
  const messages: Message[] = [
    { id: 'u1', role: 'user', content: 'Hello', createdAt: 0 },
    { id: 'a1', role: 'assistant', content: 'Hi', createdAt: 1 },
  ]
  useChatStore.setState({ messages, busy: false })
}

afterEach(() => useChatStore.setState({ messages: [], busy: false, chatId: null }))

describe('NewChatButton', () => {
  it('stays hidden until there is a conversation to leave', () => {
    render(<NewChatButton />)
    expect(screen.queryByRole('button', { name: /New chat/ })).not.toBeInTheDocument()
  })

  it('starts a blank chat, and leaves the button gone with it', async () => {
    const user = userEvent.setup()
    seed()
    render(<NewChatButton />)

    await user.click(screen.getByRole('button', { name: /New chat/ }))

    expect(useChatStore.getState().messages).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /New chat/ })).not.toBeInTheDocument()
  })

  it('does nothing while a reply is still being written', () => {
    seed()
    useChatStore.setState({ busy: true })
    render(<NewChatButton />)

    expect(screen.getByRole('button', { name: /New chat/ })).toBeDisabled()
  })
})
