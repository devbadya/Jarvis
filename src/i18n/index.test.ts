import { afterEach, describe, expect, it } from 'vitest'
import { de } from './de'
import { en, type MessageKey } from './en'
import { fill, isLocale, readLocale, replyLanguage, speechTag, translate, useLocale } from './index'

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
    expect(translate('fr', 'header.newChat')).toBe('New chat')
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
    localStorage.setItem('jarvis.language', 'xx')
    expect(readLocale()).toBe('en')
    expect(isLocale('xx')).toBe(false)
    expect(isLocale('fr')).toBe(true)
    useLocale.getState().setLocale('xx')
    expect(useLocale.getState().locale).toBe('en')
  })

  it('tells the model to answer only in the chosen language', () => {
    expect(replyLanguage('en')).toBe('Reply only in English, never in any other language.')
    expect(replyLanguage('de')).toBe('Reply only in German, never in any other language.')
    expect(replyLanguage('ja')).toBe('Reply only in Japanese, never in any other language.')
    expect(speechTag('de')).toBe('de-DE')
    expect(speechTag('no')).toBe('nb-NO')
    expect(speechTag('zh')).toBe('zh-CN')
  })
})
