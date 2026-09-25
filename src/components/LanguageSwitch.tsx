import { LOCALES, useLocale, useT, type Locale } from '@/i18n'

const SHORT: Record<Locale, string> = { en: 'EN', de: 'DE' }

/**
 * The language, as two pills that are always on screen.
 *
 * Not a menu: a menu hides the fact that there is a choice, and the point of
 * this control is that anyone opening the page sees they can switch before
 * they have read a word of English. `size="sm"` keeps it in the header; the
 * landing page renders the same control larger with `prominent`.
 */
export function LanguageSwitch({ prominent = false }: { prominent?: boolean }) {
  const locale = useLocale((state) => state.locale)
  const setLocale = useLocale((state) => state.setLocale)
  const t = useT()

  return (
    <div
      aria-label={t('header.language')}
      className={`inline-flex items-center rounded-full border border-border/70 bg-surface/60 p-0.5 ${
        prominent ? 'text-sm' : 'text-xs'
      }`}
      role="radiogroup"
    >
      {LOCALES.map((option) => {
        const active = option === locale
        return (
          <button
            key={option}
            aria-checked={active}
            aria-label={t(`language.${option}`)}
            className={`rounded-full font-medium tracking-wide transition-colors ${
              prominent ? 'px-4 py-1.5' : 'px-2.5 py-1'
            } ${active ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted hover:text-foreground'}`}
            lang={option}
            role="radio"
            type="button"
            onClick={() => setLocale(option)}
          >
            {prominent ? t(`language.${option}`) : SHORT[option]}
          </button>
        )
      })}
    </div>
  )
}
