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
  it('starts in English and lists every language in the header menu', () => {
    render(<LanguageSwitch />)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    const menu = screen.getByRole('combobox', { name: 'Choose language' })
    expect(menu).toHaveValue('en')
    expect(screen.getByRole('option', { name: 'Français' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '日本語' })).toBeInTheDocument()
  })

  it('switches the whole interface from the landing pills and keeps the choice', async () => {
    const user = userEvent.setup()
    render(<LanguageSwitch prominent />)

    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Choose language' })).toHaveValue('')

    await user.click(screen.getByRole('radio', { name: 'Deutsch' }))

    expect(useLocale.getState().locale).toBe('de')
    expect(localStorage.getItem('jarvis.language')).toBe('de')
    expect(screen.getByRole('radiogroup', { name: 'Sprache' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Deutsch' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Sprache wählen' })).toHaveValue('')
  })

  it('keeps the English words when another language is chosen for the replies', async () => {
    const user = userEvent.setup()
    render(<LanguageSwitch />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Choose language' }), 'fr')

    expect(useLocale.getState().locale).toBe('fr')
    expect(localStorage.getItem('jarvis.language')).toBe('fr')
    expect(screen.getByRole('combobox', { name: 'Choose language' })).toHaveValue('fr')
  })
})
