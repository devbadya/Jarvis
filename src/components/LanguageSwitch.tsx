import { LANGUAGES, isLocale, useLocale, useT } from '@/i18n'

const PRIMARY = ['en', 'de'] as const

/**
 * English and German stay as two pills on the landing page, because those two
 * have to be obvious before anyone has read a sentence. Every language,
 * including those two, lives in the menu beside them.
 *
 * The header only has the menu. A second copy of the pills there does not fit
 * on a phone, and the menu already names the language that is on.
 */
export function LanguageSwitch({ prominent = false }: { prominent?: boolean }) {
  const locale = useLocale((state) => state.locale)
  const setLocale = useLocale((state) => state.setLocale)
  const t = useT()
  const chosen = isLocale(locale) ? locale : 'en'
  const fromMenu = chosen !== 'en' && chosen !== 'de'

  const menu = (
    <select
      aria-label={t('language.choose')}
      className={`cursor-pointer rounded-full border border-border/70 bg-surface/60 font-medium outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent ${
        prominent ? 'px-4 py-1.5' : 'max-w-36 px-2.5 py-1'
      } ${fromMenu ? 'bg-accent text-accent-foreground' : 'text-muted'}`}
      value={prominent && !fromMenu ? '' : chosen}
      onChange={(event) => {
        const next = event.target.value
        if (next) setLocale(next)
      }}
    >
      {prominent && <option value="">{t('language.choose')}</option>}
      {LANGUAGES.map((language) => (
        <option key={language.id} lang={language.id} value={language.id}>
          {language.name}
        </option>
      ))}
    </select>
  )

  if (!prominent) return menu

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
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
              className={`rounded-full px-4 py-1.5 font-medium tracking-wide transition-colors ${
                active ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted hover:text-foreground'
              }`}
              lang={option}
              role="radio"
              type="button"
              onClick={() => setLocale(option)}
            >
              {name}
            </button>
          )
        })}
      </div>
      {menu}
    </div>
  )
}
