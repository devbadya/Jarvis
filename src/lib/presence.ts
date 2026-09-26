const STORAGE_KEY = 'jarvis.presence'

export const PRESENCE_DESIGNS = ['orb', 'rings', 'bars'] as const
export const PRESENCE_COLORS = ['cyan', 'violet', 'amber', 'emerald', 'rose'] as const

export type PresenceDesign = (typeof PRESENCE_DESIGNS)[number]
export type PresenceColor = (typeof PRESENCE_COLORS)[number]

export interface PresencePreference {
  design: PresenceDesign
  color: PresenceColor
  /** A speech-synthesis voice name. Null lets the language pick one. */
  voiceName: string | null
}

export const PRESENCE_PALETTES: Record<PresenceColor, { brand: string; secondary: string }> = {
  cyan: { brand: 'oklch(0.82 0.14 204)', secondary: 'oklch(0.74 0.16 280)' },
  violet: { brand: 'oklch(0.7 0.2 300)', secondary: 'oklch(0.75 0.16 250)' },
  amber: { brand: 'oklch(0.84 0.15 78)', secondary: 'oklch(0.7 0.17 40)' },
  emerald: { brand: 'oklch(0.78 0.16 162)', secondary: 'oklch(0.74 0.12 200)' },
  rose: { brand: 'oklch(0.74 0.17 12)', secondary: 'oklch(0.7 0.16 330)' },
}

const DEFAULT_PRESENCE: PresencePreference = { design: 'rings', color: 'cyan', voiceName: null }

function isDesign(value: unknown): value is PresenceDesign {
  return typeof value === 'string' && (PRESENCE_DESIGNS as readonly string[]).includes(value)
}

function isColor(value: unknown): value is PresenceColor {
  return typeof value === 'string' && (PRESENCE_COLORS as readonly string[]).includes(value)
}

export function readPresence(): PresencePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PRESENCE
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PRESENCE
    const record = parsed as { design?: unknown; color?: unknown; voiceName?: unknown }
    return {
      design: isDesign(record.design) ? record.design : DEFAULT_PRESENCE.design,
      color: isColor(record.color) ? record.color : DEFAULT_PRESENCE.color,
      voiceName: typeof record.voiceName === 'string' && record.voiceName ? record.voiceName : null,
    }
  } catch {
    return DEFAULT_PRESENCE
  }
}

export function writePresence(preference: PresencePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preference))
  } catch {
    // The choice still applies for this visit when storage is blocked.
  }
}
