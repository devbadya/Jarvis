import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatPanel } from './ChatPanel'
import { useChatStore } from '@/store/chat'
import type { Message } from '@/types'

/** jsdom lays nothing out, so the geometry the scroll handler reads is supplied here. */
function fakeScroll(viewport: HTMLElement, scrollTop: number): void {
  Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 2000 })
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 500 })
  Object.defineProperty(viewport, 'scrollTop', { configurable: true, value: scrollTop, writable: true })
  fireEvent.scroll(viewport)
}

function seed(): void {
  const messages: Message[] = [
    { id: 'u1', role: 'user', content: 'Hello', createdAt: 0 },
    { id: 'a1', role: 'assistant', content: 'Hi there', createdAt: 1 },
  ]
  useChatStore.setState({ messages })
}

afterEach(() => useChatStore.setState({ messages: [], busy: false }))

describe('ChatPanel', () => {
  it('suggests example prompts while the transcript is empty', () => {
    render(<ChatPanel />)
    expect(screen.getByRole('button', { name: 'Calculate (17 * 23) / sqrt(2)' })).toBeInTheDocument()
  })

  it('offers a way back to the tail only after the reader scrolls away from it', () => {
    seed()
    render(<ChatPanel />)
    const viewport = screen.getByRole('region', { name: 'Conversation' })

    expect(screen.queryByRole('button', { name: /Jump to latest/ })).not.toBeInTheDocument()

    fakeScroll(viewport, 0)
    expect(screen.getByRole('button', { name: /Jump to latest/ })).toBeInTheDocument()

    fakeScroll(viewport, 1500)
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).not.toBeInTheDocument()
  })

  it('announces that a reply is being generated', () => {
    seed()
    useChatStore.setState({ busy: true })
    render(<ChatPanel />)
    expect(screen.getByRole('status')).toHaveTextContent('Jarvis is working on a reply')
  })
})
