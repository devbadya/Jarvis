import { LANGUAGES, isLocale, useLocale, useT } from '@/i18n'

const PRIMARY = ['en', 'de'] as const

/**
 * English and German stay as two pills, because those two have to be obvious
 * before anyone has read a sentence. Every other language lives in the menu
 * beside them, labelled in the current interface language.
 */
export function LanguageSwitch({ prominent = false }: { prominent?: boolean }) {
  const locale = useLocale((state) => state.locale)
  const setLocale = useLocale((state) => state.setLocale)
  const t = useT()
  const chosen = isLocale(locale) ? locale : 'en'
  const fromMenu = chosen !== 'en' && chosen !== 'de'

  return (
    <div className={`flex flex-wrap items-center justify-center gap-2 ${prominent ? 'text-sm' : 'text-xs'}`}>
      <div
        aria-label={t('header.language')}
        className="inline-flex items-center rounded-full border border-border/70 bg-surface/60 p-0.5"
        role="radiogroup"
      >
        {PRIMARY.map((option) => {
          const active = option === chosen
          const name = LANGUAGES.find((language) => language.id === option)?.name ?? option
          return (
            <button
              key={option}
              aria-checked={active}
              aria-label={name}
              className={`rounded-full font-medium tracking-wide transition-colors ${
                prominent ? 'px-4 py-1.5' : 'px-2.5 py-1'
              } ${active ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted hover:text-foreground'}`}
              lang={option}
              role="radio"
              type="button"
              onClick={() => setLocale(option)}
            >
              {prominent ? name : option.toUpperCase()}
            </button>
          )
        })}
      </div>
      <select
        aria-label={t('language.choose')}
        className={`cursor-pointer rounded-full border border-border/70 bg-surface/60 font-medium outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent ${
          prominent ? 'px-4 py-1.5' : 'max-w-40 px-2.5 py-1'
        } ${fromMenu ? 'bg-accent text-accent-foreground' : 'text-muted'}`}
        value={fromMenu ? chosen : ''}
        onChange={(event) => {
          const next = event.target.value
          if (next) setLocale(next)
        }}
      >
        <option value="">{t('language.choose')}</option>
        {LANGUAGES.map((language) => (
          <option key={language.id} lang={language.id} value={language.id}>
            {language.name}
          </option>
        ))}
      </select>
    </div>
  )
}
