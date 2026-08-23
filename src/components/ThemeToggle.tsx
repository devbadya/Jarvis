import { useEffect, useState } from 'react'
import { Button } from '@heroui/react/button'
import { Tooltip } from '@heroui/react/tooltip'
import {
  applyTheme,
  readThemePreference,
  systemTheme,
  watchSystemTheme,
  writeThemePreference,
  type Theme,
} from '@/lib/theme'
import { MoonIcon, SunIcon } from './ui/icons'

/**
 * Follows the operating system until the user overrides it, and remembers the
 * override from then on — the usual contract, and the reason the preference is
 * kept separately from the theme actually in force.
 */
export function ThemeToggle() {
  const [preference, setPreference] = useState(readThemePreference)
  const [system, setSystem] = useState<Theme>(systemTheme)

  useEffect(() => watchSystemTheme(setSystem), [])

  const theme = preference === 'system' ? system : preference
  useEffect(() => applyTheme(theme), [theme])

  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  const label = `Switch to ${next} theme`

  const choose = (): void => {
    writeThemePreference(next)
    setPreference(next)
  }

  return (
    <Tooltip>
      <Button aria-label={label} isIconOnly size="sm" variant="ghost" onPress={choose}>
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  )
}
