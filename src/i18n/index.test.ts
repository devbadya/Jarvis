import { afterEach, describe, expect, it } from 'vitest'
import { de } from './de'
import { en, type MessageKey } from './en'
import { fill, isLocale, readLocale, REPLY_LANGUAGE, translate, useLocale } from './index'

afterEach(() => {
  localStorage.clear()
  useLocale.setState({ locale: 'en' })
})

describe('the dictionaries', () => {
  it('give German every key English has, and nothing empty', () => {
    const keys = Object.keys(en) as MessageKey[]
    expect(Object.keys(de).sort()).toEqual([...keys].sort())
    for (const key of keys) {
      expect(de[key].trim(), key).not.toBe('')
    }
  })

  it('keep the same placeholders in both languages', () => {
    for (const key of Object.keys(en) as MessageKey[]) {
      const slots = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort()
      expect(slots(de[key]), key).toEqual(slots(en[key]))
    }
  })
})

describe('translate', () => {
  it('fills slots and leaves an unknown one visible', () => {
    expect(translate('en', 'install.install', { size: '467 MB' })).toBe('Install model (467 MB)')
    expect(translate('de', 'install.install', { size: '467 MB' })).toBe('Modell installieren (467 MB)')
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}')
  })
})

describe('the choice', () => {
  it('starts in English and remembers a change', () => {
    expect(readLocale()).toBe('en')
    useLocale.getState().setLocale('de')
    expect(localStorage.getItem('jarvis.language')).toBe('de')
    expect(document.documentElement.lang).toBe('de')
    expect(readLocale()).toBe('de')
  })

  it('ignores a language this build does not have', () => {
    localStorage.setItem('jarvis.language', 'fr')
    expect(readLocale()).toBe('en')
    expect(isLocale('fr')).toBe(false)
  })

  it('asks the model for German only when German is chosen', () => {
    expect(REPLY_LANGUAGE.en).toBe('')
    expect(REPLY_LANGUAGE.de).toMatch(/Deutsch/)
  })
})
