import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelGate } from './ModelGate'
import { EMPTY_STORAGE_STATUS, type StorageStatus } from '@/lib/storage'
import { useChatStore } from '@/store/chat'

/** jsdom has no WebGPU, and without an adapter the gate never reaches its body. */
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

/** `refreshStorage` runs on mount and would otherwise clear whatever the test seeded. */
function stubStorage(status: StorageStatus): void {
  vi.spyOn(useChatStore.getState(), 'refreshStorage').mockResolvedValue()
  useChatStore.setState({ storage: status })
}

function storage(overrides: Partial<StorageStatus>): StorageStatus {
  return { ...EMPTY_STORAGE_STATUS, ...overrides }
}

beforeEach(() => {
  stubAdapter()
  useChatStore.setState({ status: 'idle', error: null })
})

afterEach(() => {
  vi.restoreAllMocks()
  useChatStore.setState({ status: 'idle', storage: EMPTY_STORAGE_STATUS })
})

describe('ModelGate', () => {
  it('gets out of the way once the model is ready', () => {
    useChatStore.setState({ status: 'ready' })
    render(
      <ModelGate>
        <p>Chat</p>
      </ModelGate>,
    )
    expect(screen.getByText('Chat')).toBeInTheDocument()
  })

  it('measures the space already spent against the quota', async () => {
    stubStorage(storage({ quotaBytes: 4 * 1024 ** 3, usageBytes: 1024 ** 3 }))
    render(<ModelGate>{null}</ModelGate>)

    const meter = await screen.findByRole('meter', { name: 'Browser storage used' })
    expect(meter).toHaveAttribute('aria-valuenow', String(1024 ** 3))
    expect(meter).toHaveAttribute('aria-valuemax', String(4 * 1024 ** 3))
    expect(screen.getByText(/3\.00 GB free of 4\.00 GB/)).toBeInTheDocument()
  })

  it('warns before an install that cannot fit rather than after it fails', async () => {
    stubStorage(storage({ quotaBytes: 1024 ** 3, usageBytes: 900 * 1024 ** 2 }))
    render(<ModelGate>{null}</ModelGate>)

    expect(await screen.findByText('There may not be room for the download')).toBeInTheDocument()
  })

  it('offers to continue a download that stopped part way through', async () => {
    stubStorage(storage({ modelCached: false, partialBytes: 300 * 1024 ** 2 }))
    render(<ModelGate>{null}</ModelGate>)

    expect(await screen.findByText('partly downloaded')).toBeInTheDocument()
    expect(screen.getByText(/300 MB of 467 MB saved/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume install (167 MB left)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard download' })).toBeInTheDocument()
  })

  it('says nothing about room when the model is already installed', async () => {
    stubStorage(storage({ modelCached: true, quotaBytes: 1024 ** 3, usageBytes: 900 * 1024 ** 2 }))
    render(<ModelGate>{null}</ModelGate>)

    expect(await screen.findByText('installed')).toBeInTheDocument()
    expect(screen.queryByText('There may not be room for the download')).not.toBeInTheDocument()
  })
})
