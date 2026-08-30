import { useEffect, useState } from 'react'

/**
 * A clock that keeps moving.
 *
 * Tool results are snapshots. The world-clock card has to tick after that
 * line is written, or the minutes freeze at whatever second the model called.
 * One-second steps are enough for the minute to roll over on time.
 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return now
}
