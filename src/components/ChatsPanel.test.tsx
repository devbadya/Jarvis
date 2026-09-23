import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ChatsPanel } from './ChatsPanel'
import { deleteChat, listChats, saveChat } from '@/chats/db'
import { ACTIVE_CHAT_KEY } from '@/chats/types'
import { useChatStore } from '@/store/chat'
import type { Message } from '@/types'

const messages: Message[] = [
  { id: 'u1', role: 'user', content: 'Weather in Berlin', createdAt: 1 },
  { id: 'a1', role: 'assistant', content: '14°C', createdAt: 2 },
]

beforeEach(async () => {
  const saved = await listChats()
  for (const chat of saved) await deleteChat(chat.id)
  localStorage.removeItem(ACTIVE_CHAT_KEY)
  useChatStore.setState({
    messages: [],
    chatId: null,
    chats: [],
    chatsError: null,
    chatsLoaded: false,
    busy: false,
    queued: [],
  })
})

async function openPanel(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  render(<ChatsPanel />)
  await user.click(screen.getByRole('button', { name: 'Chats' }))
  return user
}

describe('ChatsPanel', () => {
  it('says when nothing has been saved', async () => {
    await openPanel()
    expect(await screen.findByText(/Nothing saved yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New chat' })).toBeDisabled()
  })

  it('opens a saved chat', async () => {
    await saveChat({
      id: 'c1',
      title: 'Weather in Berlin',
      createdAt: 1,
      updatedAt: Date.now(),
      messages,
    })
    const user = await openPanel()

    await user.click(await screen.findByRole('button', { name: /^Weather in Berlin/ }))

    expect(useChatStore.getState().chatId).toBe('c1')
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'Weather in Berlin',
      '14°C',
    ])
  })

  it('deletes a chat after confirming', async () => {
    await saveChat({
      id: 'c1',
      title: 'Weather in Berlin',
      createdAt: 1,
      updatedAt: Date.now(),
      messages,
    })
    const user = await openPanel()

    await user.click(await screen.findByRole('button', { name: 'Delete chat: Weather in Berlin' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText(/Nothing saved yet/)).toBeInTheDocument()
    expect(await listChats()).toEqual([])
  })

  it('leaves the chat in place when deletion is declined', async () => {
    await saveChat({
      id: 'c1',
      title: 'Weather in Berlin',
      createdAt: 1,
      updatedAt: Date.now(),
      messages,
    })
    const user = await openPanel()

    await user.click(await screen.findByRole('button', { name: 'Delete chat: Weather in Berlin' }))
    await user.click(screen.getByRole('button', { name: 'Keep' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await listChats()).toHaveLength(1)
  })

  it('shows why a chat could not be saved', async () => {
    useChatStore.setState({ chatsError: 'this browser has no IndexedDB, so chats cannot be saved' })
    await openPanel()
    expect(screen.getByRole('alert')).toHaveTextContent(/IndexedDB/)
  })
})
