/**
 * Whether the browser believes it has a connection.
 *
 * Unknown counts as online. `navigator.onLine` reports whether there is a
 * network interface, not whether anything is reachable across it, so it is
 * reliable in one direction only: `false` really does mean nothing can be
 * fetched, while `true` is a guess. Refusing to answer on a guess would be the
 * worse failure of the two, so only the certain half is acted on.
 */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/** Calls back on every change until the returned function is called. */
export function watchOnline(onChange: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const report = (): void => onChange(isOnline())
  window.addEventListener('online', report)
  window.addEventListener('offline', report)
  return () => {
    window.removeEventListener('online', report)
    window.removeEventListener('offline', report)
  }
}
