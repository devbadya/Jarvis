import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Composer } from './Composer'

describe('Composer', () => {
  it('renders the input and disables sending while empty', () => {
    render(<Composer />)
    expect(screen.getByLabelText('Message')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('enables sending once text is typed', async () => {
    const user = userEvent.setup()
    render(<Composer />)
    await user.type(screen.getByLabelText('Message'), 'Hello')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })
})
