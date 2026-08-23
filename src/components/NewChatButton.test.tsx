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
  useChatStore.setState({ messages })
}

afterEach(() => useChatStore.setState({ messages: [] }))

describe('NewChatButton', () => {
  it('stays hidden until there is something to discard', () => {
    render(<NewChatButton />)
    expect(screen.queryByRole('button', { name: /New chat/ })).not.toBeInTheDocument()
  })

  it('keeps the transcript when the confirmation is declined', async () => {
    const user = userEvent.setup()
    seed()
    render(<NewChatButton />)

    await user.click(screen.getByRole('button', { name: /New chat/ }))
    await user.click(screen.getByRole('button', { name: 'Keep chatting' }))

    expect(useChatStore.getState().messages).toHaveLength(2)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('clears the transcript once confirmed', async () => {
    const user = userEvent.setup()
    seed()
    render(<NewChatButton />)

    await user.click(screen.getByRole('button', { name: /New chat/ }))
    await user.click(screen.getByRole('button', { name: 'Discard and start over' }))

    expect(useChatStore.getState().messages).toHaveLength(0)
  })
})
