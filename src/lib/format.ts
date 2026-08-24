export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const megabytes = bytes / (1024 * 1024)
  if (megabytes < 1) return `${Math.round(bytes / 1024)} KB`
  if (megabytes < 1024) return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)} MB`
  return `${(megabytes / 1024).toFixed(2)} GB`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

/** Clock time only: a transcript never outlives the tab it was typed into. */
export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long ago, for things that do outlive the tab. A memory saved months back
 * is worth a date; one saved this morning is not, and "14:32" would say nothing
 * about whether it is still current.
 */
export function formatAge(epochMs: number, now = Date.now()): string {
  const elapsed = now - epochMs
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} d ago`
  return new Date(epochMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
