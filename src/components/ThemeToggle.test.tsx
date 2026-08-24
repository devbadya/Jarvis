import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from './ThemeToggle'

afterEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
})

describe('ThemeToggle', () => {
  it('applies the class HeroUI keys its dark tokens off', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    expect(document.documentElement).not.toHaveClass('dark')
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))

    expect(document.documentElement).toHaveClass('dark')
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument()
  })

  it('remembers the choice across mounts', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<ThemeToggle />)
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    unmount()

    render(<ThemeToggle />)
    expect(document.documentElement).toHaveClass('dark')
  })
})
