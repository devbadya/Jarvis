import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpeakRepliesToggle } from './SpeakRepliesToggle'
import { claimSpokenReply, resetSpokenClaims } from '@/lib/speech'
import { useChatStore } from '@/store/chat'
import type { Message } from '@/types'

const synthesis = { cancel: vi.fn(), speak: vi.fn() }

class Utterance {
  text: string
  lang = ''
  constructor(text: string) {
    this.text = text
  }
}

function reply(id: string, content: string, extra: Partial<Message> = {}): Message {
  return { id, role: 'assistant', content, createdAt: Date.now(), ...extra }
}

function spokenText(): string[] {
  return synthesis.speak.mock.calls.map(([utterance]) => (utterance as Utterance).text)
}

beforeEach(() => {
  vi.stubGlobal('speechSynthesis', synthesis)
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
})

afterEach(() => {
  vi.unstubAllGlobals()
  synthesis.cancel.mockClear()
  synthesis.speak.mockClear()
  localStorage.clear()
  resetSpokenClaims()
  useChatStore.setState({ messages: [], chatId: null, chatsLoaded: false })
})

describe('SpeakRepliesToggle', () => {
  it('renders nothing where the browser has no voices', () => {
    vi.unstubAllGlobals()
    render(<SpeakRepliesToggle />)
    expect(screen.queryByRole('button', { name: /aloud/ })).not.toBeInTheDocument()
  })

  it('reads each new reply as it finishes, without being switched on first', () => {
    useChatStore.setState({ chatsLoaded: true })
    render(<SpeakRepliesToggle />)
    expect(screen.getByRole('button', { name: 'Stop reading replies aloud' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    act(() => useChatStore.setState({ messages: [reply('b', 'Second', { streaming: true })] }))
    expect(synthesis.speak).not.toHaveBeenCalled()

    act(() => useChatStore.setState({ messages: [reply('b', 'Second answer.')] }))
    expect(spokenText()).toEqual(['Second answer.'])

    act(() => useChatStore.setState({ messages: [reply('b', 'Second answer.', { reasoningMs: 1 })] }))
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })

  it('does not read a reply that was already on screen when the chat loaded', () => {
    useChatStore.setState({
      chatsLoaded: false,
      chatId: 'old',
      messages: [reply('a', 'Already there.')],
    })
    render(<SpeakRepliesToggle />)

    act(() => useChatStore.setState({ chatsLoaded: true }))
    expect(synthesis.speak).not.toHaveBeenCalled()

    act(() =>
      useChatStore.setState({
        messages: [reply('a', 'Already there.'), reply('b', 'New answer.')],
      }),
    )
    expect(spokenText()).toEqual(['New answer.'])
  })

  it('does not read the reply already in a chat that was just opened', () => {
    useChatStore.setState({ chatsLoaded: true, chatId: 'current', messages: [] })
    render(<SpeakRepliesToggle />)

    act(() => useChatStore.setState({ chatId: 'other', messages: [reply('a', 'Old answer.')] }))
    expect(synthesis.speak).not.toHaveBeenCalled()

    act(() =>
      useChatStore.setState({
        messages: [reply('a', 'Old answer.'), reply('b', 'New answer.')],
      }),
    )
    expect(spokenText()).toEqual(['New answer.'])
  })

  it('still reads a reply that finished before the chat list did', () => {
    useChatStore.setState({ chatsLoaded: false })
    render(<SpeakRepliesToggle />)

    act(() => useChatStore.setState({ messages: [reply('b', 'partial', { streaming: true })] }))
    act(() => useChatStore.setState({ messages: [reply('b', 'Finished before the chat list.')] }))
    expect(spokenText()).toEqual(['Finished before the chat list.'])

    act(() => useChatStore.setState({ chatsLoaded: true, chatId: 'new' }))
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })

  it('leaves a reply to the live conversation once that has claimed it', () => {
    claimSpokenReply('b', 'conversation')
    useChatStore.setState({ chatsLoaded: true })
    render(<SpeakRepliesToggle />)

    act(() => useChatStore.setState({ messages: [reply('b', 'Second answer.')] }))

    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('stops speaking when switched off and remembers the choice', async () => {
    const user = userEvent.setup()
    useChatStore.setState({ chatsLoaded: true })
    render(<SpeakRepliesToggle />)

    await user.click(screen.getByRole('button', { name: 'Stop reading replies aloud' }))

    expect(synthesis.cancel).toHaveBeenCalled()
    expect(localStorage.getItem('jarvis.speak-replies')).toBe('false')
    expect(screen.getByRole('button', { name: 'Read replies aloud' })).toBeInTheDocument()

    act(() => useChatStore.setState({ messages: [reply('b', 'Second answer.')] }))
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('stays quiet when that choice is already off, and skips the reply on screen when switched back on', async () => {
    const user = userEvent.setup()
    localStorage.setItem('jarvis.speak-replies', 'false')
    useChatStore.setState({ chatsLoaded: true, messages: [reply('a', 'Already there.')] })
    render(<SpeakRepliesToggle />)

    expect(screen.getByRole('button', { name: 'Read replies aloud' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    act(() => useChatStore.setState({ messages: [reply('a', 'Already there.'), reply('b', 'While off.')] }))
    expect(synthesis.speak).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Read replies aloud' }))
    expect(synthesis.speak).not.toHaveBeenCalled()

    act(() =>
      useChatStore.setState({
        messages: [reply('a', 'Already there.'), reply('b', 'While off.'), reply('c', 'After on.')],
      }),
    )
    expect(spokenText()).toEqual(['After on.'])
  })
})
