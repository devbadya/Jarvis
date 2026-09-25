import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Landing } from './Landing'
import { useLocale } from '@/i18n'
import { EMPTY_STORAGE_STATUS } from '@/lib/storage'
import { useChatStore } from '@/store/chat'

/** jsdom has no WebGPU, and without an adapter the install panel never reaches its body. */
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
  vi.spyOn(useChatStore.getState(), 'refreshStorage').mockResolvedValue()
  useChatStore.setState({ status: 'idle', error: null, storage: EMPTY_STORAGE_STATUS })
})

afterEach(() => {
  vi.restoreAllMocks()
  useChatStore.setState({ status: 'idle', storage: EMPTY_STORAGE_STATUS })
  localStorage.clear()
  useLocale.setState({ locale: 'en' })
})

describe('Landing', () => {
  it('says what the app is before asking for the download', async () => {
    render(<Landing />)

    expect(screen.getByRole('heading', { name: 'The model runs in this tab.' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Install model/ })).toBeInTheDocument()
  })

  it('carries the install panel exactly once', async () => {
    render(<Landing />)

    // Two panels would report two of every state, and `getByRole` says so by
    // throwing rather than by picking one.
    expect(await screen.findByRole('button', { name: /Install model/ })).toBeInTheDocument()
    expect(screen.getByText(/one-time download/)).toBeInTheDocument()
  })

  it('shows every section where there is no IntersectionObserver to reveal them', async () => {
    expect(typeof IntersectionObserver).toBe('undefined')
    render(<Landing />)

    // The class starts hidden, so a section nothing marks visible would be
    // markup a reader never sees and a test still passes against.
    for (const heading of ['Your GPU does the work', 'Install once', 'Stays in this tab']) {
      expect(screen.getByText(heading).closest('.reveal')).toHaveAttribute('data-visible')
    }

    await screen.findByRole('button', { name: /Install model/ })
  })

  it('offers the language before the first English sentence, and switches the whole page', async () => {
    const user = userEvent.setup()
    render(<Landing />)

    const switcher = screen.getByRole('radiogroup', { name: 'Language' })
    const headline = screen.getByRole('heading', { name: 'The model runs in this tab.' })
    expect(switcher.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(screen.getByRole('radio', { name: 'Deutsch' }))

    expect(screen.getByRole('heading', { name: 'Das Modell läuft in diesem Tab.' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Modell installieren/ })).toBeInTheDocument()
    expect(screen.getByText('Was es kann')).toBeInTheDocument()
    expect(screen.queryByText('What it can do')).not.toBeInTheDocument()
  })
})
