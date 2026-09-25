import { create } from 'zustand'
import { de } from './de'
import { en, type MessageKey } from './en'

/**
 * Which language the interface, the voice and the replies use.
 *
 * English is the default: the model is strongest in it and every skill is
 * written in it. The choice is one control in the header and on the landing
 * page, and it is remembered in this browser. Nothing here is read from the
 * browser's own language on purpose — the switch is the promise that anyone
 * can change it, and a guess that happened to be wrong would hide the switch
 * behind words the reader could not read.
 */
export type Locale = 'en' | 'de'

export const LOCALES: Locale[] = ['en', 'de']

/** What the model is asked to reply in. English needs no sentence: the prompt already is English. */
export const REPLY_LANGUAGE: Record<Locale, string> = {
  en: '',
  de: 'Antworte immer auf Deutsch.',
}

/** BCP 47 tags for recognition and synthesis. */
export const SPEECH_TAG: Record<Locale, string> = { en: 'en-US', de: 'de-DE' }

const STORAGE_KEY = 'jarvis.language'

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, de }

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as string[]).includes(value)
}

export function readLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isLocale(stored) ? stored : 'en'
  } catch {
    return 'en'
  }
}

function writeLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Still applies to this tab.
  }
}

interface LocaleState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const useLocale = create<LocaleState>((set) => ({
  locale: readLocale(),
  setLocale(locale) {
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

export function translate(locale: Locale, key: MessageKey, values?: Record<string, string | number>): string {
  return fill(MESSAGES[locale][key] ?? en[key], values)
}

/** The current language's `t`. Components re-render when the language changes. */
export function useT(): (key: MessageKey, values?: Record<string, string | number>) => string {
  const locale = useLocale((state) => state.locale)
  return (key, values) => translate(locale, key, values)
}

export type { MessageKey }
