import type { ReactNode } from 'react'

type Tone = 'neutral' | 'success' | 'danger'

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-surface-tertiary text-surface-tertiary-foreground',
  success: 'bg-success-soft text-success-soft-foreground',
  danger: 'bg-danger-soft text-danger-soft-foreground',
}

/**
 * Static status pill. HeroUI's Tag is a React Aria collection item and throws
 * when rendered outside a TagGroup, which is the wrong shape for read-only labels.
 */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  )
}
