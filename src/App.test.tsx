import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { EMPTY_STORAGE_STATUS } from '@/lib/storage'
import { useChatStore } from '@/store/chat'

function stubAdapter(): void {
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: {
      requestAdapter: async () => ({
        info: { vendor: 'test', architecture: 'gpu' },
        limits: { maxBufferSize: 1024 * 1024 * 1024 },
      }),
    },
  })
}

beforeEach(() => {
  stubAdapter()
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no proxy'))
  vi.spyOn(useChatStore.getState(), 'refreshStorage').mockResolvedValue()
  vi.spyOn(useChatStore.getState(), 'probeHosted').mockResolvedValue()
  useChatStore.setState({
    status: 'idle',
    error: null,
    storage: EMPTY_STORAGE_STATUS,
    hostedChat: null,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  useChatStore.setState({ status: 'idle', storage: EMPTY_STORAGE_STATUS, hostedChat: null })
})

describe('App header', () => {
  it('names the on-device model until a hosted one is advertised', () => {
    render(<App />)
    expect(screen.getByText('Qwen3.5-0.8B · on-device')).toBeInTheDocument()
  })

  it('names the hosted model once the proxy advertises one', () => {
    useChatStore.setState({ hostedChat: { base: 'https://proxy.example', model: 'claude-opus-5' } })
    render(<App />)
    expect(screen.getByText('claude-opus-5 · hosted')).toBeInTheDocument()
    expect(screen.queryByText('Qwen3.5-0.8B · on-device')).not.toBeInTheDocument()
  })
})
