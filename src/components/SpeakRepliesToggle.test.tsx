import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpeakRepliesToggle } from './SpeakRepliesToggle'
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

beforeEach(() => {
  vi.stubGlobal('speechSynthesis', synthesis)
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
})

afterEach(() => {
  vi.unstubAllGlobals()
  synthesis.cancel.mockClear()
  synthesis.speak.mockClear()
  localStorage.clear()
  useChatStore.setState({ messages: [] })
})

describe('SpeakRepliesToggle', () => {
  it('renders nothing where the browser has no voices', () => {
    vi.unstubAllGlobals()
    render(<SpeakRepliesToggle />)
    expect(screen.queryByRole('button', { name: /aloud/ })).not.toBeInTheDocument()
  })

  it('reads a reply once it has finished, and only while switched on', async () => {
    const user = userEvent.setup()
    render(<SpeakRepliesToggle />)

    act(() => useChatStore.setState({ messages: [reply('a', 'First answer.')] }))
    expect(synthesis.speak).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Read replies aloud' }))
    expect(screen.getByRole('button', { name: 'Stop reading replies aloud' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // Already on screen when switched on: not read.
    expect(synthesis.speak).not.toHaveBeenCalled()

    act(() =>
      useChatStore.setState({
        messages: [reply('a', 'First answer.'), reply('b', 'Second', { streaming: true })],
      }),
    )
    expect(synthesis.speak).not.toHaveBeenCalled()

    act(() =>
      useChatStore.setState({ messages: [reply('a', 'First answer.'), reply('b', 'Second answer.')] }),
    )
    expect(synthesis.speak).toHaveBeenCalledOnce()
    const spoken = synthesis.speak.mock.calls.map(([utterance]) => (utterance as Utterance).text)
    expect(spoken).toEqual(['Second answer.'])

    // Same reply patched again: still once.
    act(() =>
      useChatStore.setState({
        messages: [reply('a', 'First answer.'), reply('b', 'Second answer.', { reasoningMs: 1 })],
      }),
    )
    expect(synthesis.speak).toHaveBeenCalledOnce()
  })

  it('stops speaking when switched off and remembers the choice', async () => {
    const user = userEvent.setup()
    localStorage.setItem('jarvis.speak-replies', 'true')
    render(<SpeakRepliesToggle />)

    await user.click(screen.getByRole('button', { name: 'Stop reading replies aloud' }))

    expect(synthesis.cancel).toHaveBeenCalled()
    expect(localStorage.getItem('jarvis.speak-replies')).toBe('false')
    expect(screen.getByRole('button', { name: 'Read replies aloud' })).toBeInTheDocument()
  })
})
