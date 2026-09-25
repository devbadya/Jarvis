import { create } from 'zustand'
import { de } from './de'
import { en, type MessageKey } from './en'
import { languageById, LANGUAGES, replyInstruction } from './languages'

export { LANGUAGES }

/**
 * Which language the interface, the voice and the replies use.
 *
 * English is the start. The picker lists every language Jarvis is asked to
 * answer in, and the choice is remembered in this browser. The words on screen
 * are translated for English and German; every other choice still decides the
 * reply, the dictation and the voice. Nothing is read from the browser's own
 * language — a guess that happened to be wrong would hide the picker behind
 * words the reader could not read.
 */
export type Locale = string

export const LOCALES = LANGUAGES.map((language) => language.id)

export const replyLanguage = replyInstruction

/** BCP 47 tag for recognition and synthesis. */
export function speechTag(locale: string): string {
  return languageById(locale).speech
}

const STORAGE_KEY = 'jarvis.language'

const MESSAGES: Record<string, Record<MessageKey, string>> = { en, de }

export function isLocale(value: unknown): value is string {
  return typeof value === 'string' && LOCALES.includes(value)
}

export function readLocale(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isLocale(stored) ? stored : 'en'
  } catch {
    return 'en'
  }
}

function writeLocale(locale: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Still applies to this tab.
  }
}

interface LocaleState {
  locale: string
  setLocale: (locale: string) => void
}

export const useLocale = create<LocaleState>((set) => ({
  locale: readLocale(),
  setLocale(locale) {
    if (!isLocale(locale)) return
    writeLocale(locale)
    document.documentElement.lang = locale
    set({ locale })
  },
}))

/** Fills `{name}` slots. A slot with no value is left as written, so a typo shows rather than vanishes. */
export function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  )
}

export function translate(locale: string, key: MessageKey, values?: Record<string, string | number>): string {
  return fill((MESSAGES[locale] ?? en)[key], values)
}

/** The current language's `t`. Components re-render when the language changes. */
export function useT(): (key: MessageKey, values?: Record<string, string | number>) => string {
  const locale = useLocale((state) => state.locale)
  return (key, values) => translate(locale, key, values)
}

export type { MessageKey }
