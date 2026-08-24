import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { SettingsPanel } from './SettingsPanel'
import { useChatStore } from '@/store/chat'
import { DEFAULT_WEB_ACCESS } from '@/tools/web'

beforeEach(() => {
  useChatStore.getState().setWebAccess(DEFAULT_WEB_ACCESS)
  useChatStore.setState({ mcpFailures: [] })
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

  it('refuses a server address fetch could never reach', async () => {
    const user = await openPanel()
    await user.type(screen.getByLabelText('Server name'), 'local')
    await user.type(screen.getByLabelText('Server URL'), 'localhost:3000')

    expect(screen.getByText('Needs a full http:// or https:// address.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add server' })).toBeDisabled()

    await user.clear(screen.getByLabelText('Server URL'))
    await user.type(screen.getByLabelText('Server URL'), 'https://localhost:3000/mcp')

    expect(screen.queryByText('Needs a full http:// or https:// address.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add server' })).toBeEnabled()
  })

  it('lets a pasted key be checked once before it is trusted', async () => {
    const user = await openPanel()

    const key = (): HTMLInputElement => screen.getByLabelText('Jina API key') as HTMLInputElement
    expect(key()).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Show Jina API key' }))
    expect(key()).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: 'Hide Jina API key' }))
    expect(key()).toHaveAttribute('type', 'password')
  })

  it('does not demand a key on the default provider', async () => {
    await openPanel()
    expect(screen.getByRole('radio', { name: 'Wikipedia' })).toBeChecked()
    // The key field is always offered, because it also speeds up read_page.
    expect(screen.getByLabelText('Jina API key')).toBeInTheDocument()
    expect(screen.queryByText('web_search will fail until a key is set.')).not.toBeInTheDocument()
  })

  it('warns until a key is given once the keyed provider is picked', async () => {
    const user = await openPanel()

    await user.click(screen.getByRole('radio', { name: 'Jina' }))

    expect(screen.getByText('web_search will fail until a key is set.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Jina API key'), 'jina_abc')

    expect(screen.queryByText('web_search will fail until a key is set.')).not.toBeInTheDocument()
    expect(useChatStore.getState().webAccess).toEqual({ provider: 'jina', jinaApiKey: 'jina_abc' })
  })

  it('counts unreachable servers on the closed trigger', () => {
    useChatStore.setState({ mcpFailures: [{ id: 'github', message: 'Failed to fetch' }] })
    render(<SettingsPanel />)

    expect(screen.getByRole('button', { name: /Tools, 1 server not connected/ })).toBeInTheDocument()
  })

  it('says nothing on the trigger when every server connected', () => {
    render(<SettingsPanel />)
    expect(screen.getByRole('button', { name: 'Tools' })).toBeInTheDocument()
  })

  it('retells the model which search it has when the provider changes', async () => {
    const user = await openPanel()

    const description = (): string =>
      useChatStore.getState().tools.find((tool) => tool.schema.function.name === 'web_search')!.schema
        .function.description

    expect(description()).toMatch(/Search Wikipedia/)
    await user.click(screen.getByRole('radio', { name: 'Jina' }))
    expect(description()).toMatch(/Search the web/)
  })
})
