export type Theme = 'light' | 'dark'
export type ThemePreference = Theme | 'system'

const STORAGE_KEY = 'jarvis.theme'

/**
 * Painted behind the browser chrome and the installed app's title bar, so it has
 * to follow the theme. These are HeroUI's own `--background` for each palette, in
 * hex because `theme-color` support for oklch cannot be relied on. Kept in step
 * with the inline script in `index.html`, which applies them before React mounts.
 */
const THEME_COLOR: Record<Theme, string> = { light: '#f5f5f5', dark: '#060607' }

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // A blocked localStorage costs the user their preference, not the app.
  }
}

export function systemTheme(): Theme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function watchSystemTheme(onChange: (theme: Theme) => void): () => void {
  if (typeof matchMedia !== 'function') return () => {}
  const query = matchMedia('(prefers-color-scheme: dark)')
  const listener = (event: MediaQueryListEvent): void => onChange(event.matches ? 'dark' : 'light')
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

/**
 * HeroUI's dark tokens hang off `.dark` / `[data-theme="dark"]`; without one of
 * them the whole palette stays light whatever the system is set to.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.dataset.theme = theme
  root.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
}
