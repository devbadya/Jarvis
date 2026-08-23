import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './SettingsPanel'
import { useChatStore } from '@/store/chat'
import { DEFAULT_WEB_ACCESS } from '@/tools/web'

beforeEach(() => {
  useChatStore.getState().setWebAccess(DEFAULT_WEB_ACCESS)
  localStorage.clear()
})

describe('SettingsPanel', () => {
  it('lists the built-in tools and the server form', () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    expect(screen.getByText('web_search')).toBeInTheDocument()
    expect(screen.getByText('calculator')).toBeInTheDocument()
    expect(screen.getByLabelText('Server URL')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add server' })).toBeDisabled()
  })

  it('does not demand a key on the default provider', () => {
    render(<SettingsPanel onClose={vi.fn()} />)
    expect(screen.getByRole('radio', { name: 'Wikipedia' })).toBeChecked()
    // The key field is always offered, because it also speeds up read_page.
    expect(screen.getByLabelText('Jina API key')).toBeInTheDocument()
    expect(screen.queryByText('web_search will fail until a key is set.')).not.toBeInTheDocument()
  })

  it('warns until a key is given once the keyed provider is picked', async () => {
    const user = userEvent.setup()
    render(<SettingsPanel onClose={vi.fn()} />)

    await user.click(screen.getByRole('radio', { name: 'Jina' }))

    expect(screen.getByText('web_search will fail until a key is set.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Jina API key'), 'jina_abc')

    expect(screen.queryByText('web_search will fail until a key is set.')).not.toBeInTheDocument()
    expect(useChatStore.getState().webAccess).toEqual({ provider: 'jina', jinaApiKey: 'jina_abc' })
  })

  it('retells the model which search it has when the provider changes', async () => {
    const user = userEvent.setup()
    render(<SettingsPanel onClose={vi.fn()} />)

    const description = (): string =>
      useChatStore.getState().tools.find((tool) => tool.schema.function.name === 'web_search')!.schema
        .function.description

    expect(description()).toMatch(/Search Wikipedia/)
    await user.click(screen.getByRole('radio', { name: 'Jina' }))
    expect(description()).toMatch(/Search the web/)
  })
})
