import { formatClockFace, formatLiveClock } from '@/tools/clock'
import { useNow } from '@/lib/now'

/**
 * The wall clock in a named zone, kept current after the tool result froze.
 *
 * The model still answers from the snapshot it was given. This is presentation:
 * `message.content` is not rewritten, and the review still checks that snapshot.
 */
export function LiveClock({
  timeZone,
  place,
  full = false,
}: {
  timeZone: string
  place?: string | null
  full?: boolean
}) {
  const now = useNow()
  const label = full ? formatLiveClock(now, timeZone, place ?? undefined) : formatClockFace(now, timeZone)

  return (
    <time aria-label={`Live time in ${timeZone}`} className="tabular-nums" dateTime={now.toISOString()}>
      {label}
    </time>
  )
}
