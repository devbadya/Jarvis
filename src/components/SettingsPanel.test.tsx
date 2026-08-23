import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SettingsPanel } from './SettingsPanel'

async function openPanel(): Promise<void> {
  const user = userEvent.setup()
  render(<SettingsPanel />)
  await user.click(screen.getByRole('button', { name: 'Tools' }))
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
    const user = userEvent.setup()
    await openPanel()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('enables the submit button once both fields are filled', async () => {
    const user = userEvent.setup()
    await openPanel()
    await user.type(screen.getByLabelText('Server name'), 'github')
    await user.type(screen.getByLabelText('Server URL'), 'https://example.com/mcp')
    expect(screen.getByRole('button', { name: 'Add server' })).toBeEnabled()
  })
})
