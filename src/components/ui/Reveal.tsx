import { useEffect, useRef, useState, type ReactNode } from 'react'
import { prefersReducedMotion } from '@/lib/motion'

/**
 * Fades a section of the landing page in as it is scrolled to.
 *
 * The `.reveal` class starts hidden, which is the safe half of the deal only for
 * as long as something is guaranteed to mark it visible. Two cases never reach
 * an observer and are answered before the first paint rather than after it:
 * jsdom, where `IntersectionObserver` does not exist and a hidden section would
 * be a test asserting against invisible markup, and a reader who has asked for
 * less motion, for whom the whole effect is the thing being declined.
 *
 * The observer takes `null` as its root on purpose. The landing scrolls inside
 * its own element, and intersection against the viewport already accounts for
 * clipping by that ancestor.
 */
export function Reveal({
  children,
  className = '',
  delayMs = 0,
}: {
  children: ReactNode
  className?: string
  delayMs?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === 'undefined' || prefersReducedMotion(),
  )

  useEffect(() => {
    if (visible) return
    const node = ref.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setVisible(true)
        observer.disconnect()
      },
      // A section counts as arrived a little before its top edge does, so the
      // fade finishes while it is being read rather than after.
      { rootMargin: '0px 0px -12% 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])

  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      data-visible={visible || undefined}
      style={delayMs > 0 ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  )
}
