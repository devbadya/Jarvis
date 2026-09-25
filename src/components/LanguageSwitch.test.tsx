import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { LanguageSwitch } from './LanguageSwitch'
import { useLocale } from '@/i18n'

afterEach(() => {
  localStorage.clear()
  useLocale.setState({ locale: 'en' })
})

describe('LanguageSwitch', () => {
  it('starts in English and offers German in German', () => {
    render(<LanguageSwitch />)
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Deutsch' })).not.toBeChecked()
  })

  it('switches the whole interface and keeps the choice', async () => {
    const user = userEvent.setup()
    render(<LanguageSwitch prominent />)

    await user.click(screen.getByRole('radio', { name: 'Deutsch' }))

    expect(useLocale.getState().locale).toBe('de')
    expect(localStorage.getItem('jarvis.language')).toBe('de')
    expect(screen.getByRole('radiogroup', { name: 'Sprache' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Deutsch' })).toBeChecked()
  })
})
