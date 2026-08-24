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
