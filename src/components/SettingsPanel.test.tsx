import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { SettingsPanel } from './SettingsPanel'
import { useChatStore } from '@/store/chat'
import { DEFAULT_WEB_ACCESS } from '@/tools/web'

beforeEach(() => {
  useChatStore.getState().setWebAccess(DEFAULT_WEB_ACCESS)
  localStorage.clear()
})

/** The panel is a drawer, so everything in it is behind the header trigger. */
async function openPanel(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  render(<SettingsPanel />)
  await user.click(screen.getByRole('button', { name: 'Tools' }))
  return user
}

describe('SettingsPanel', () => {
  it('lists the built-in tools and the server form once opened', async () => {
    await openPanel()
    expect(screen.getByText('web_search')).toBeInTheDocument()
    expect(screen.getByText('calculator')).toBeInTheDocument()
    expect(screen.getByLabelText('Server URL')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add server' })).toBeDisabled()
  })

  it('closes on Escape', async () => {
    const user = await openPanel()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('enables the submit button once both server fields are filled', async () => {
    const user = await openPanel()
    await user.type(screen.getByLabelText('Server name'), 'github')
    await user.type(screen.getByLabelText('Server URL'), 'https://example.com/mcp')
    expect(screen.getByRole('button', { name: 'Add server' })).toBeEnabled()
  })

  it('needs no API key on the default provider', async () => {
    await openPanel()
    expect(screen.getByRole('radio', { name: 'Wikipedia' })).toBeChecked()
    expect(screen.queryByLabelText(/^(Tavily|Exa) API key$/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Reader API key')).toBeInTheDocument()
  })

  it('asks for a key and warns until one is given when a keyed provider is picked', async () => {
    const user = await openPanel()

    await user.click(screen.getByRole('radio', { name: 'Tavily' }))

    expect(screen.getByLabelText('Tavily API key')).toBeInTheDocument()
    expect(screen.getByText('web_search will fail until a key is set.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Tavily API key'), 'tvly-abc')

    expect(screen.queryByText('web_search will fail until a key is set.')).not.toBeInTheDocument()
    expect(useChatStore.getState().webAccess).toEqual({ provider: 'tavily', searchApiKey: 'tvly-abc' })
  })

  it('retells the model which search it has when the provider changes', async () => {
    const user = await openPanel()

    const description = (): string =>
      useChatStore.getState().tools.find((tool) => tool.schema.function.name === 'web_search')!.schema
        .function.description

    expect(description()).toMatch(/Search Wikipedia/)
    await user.click(screen.getByRole('radio', { name: 'Exa' }))
    expect(description()).toMatch(/Search the web/)
  })
})
