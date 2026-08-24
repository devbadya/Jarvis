import { useEffect, useRef, useState } from 'react'
import { Disclosure } from '@heroui/react/disclosure'
import { Spinner } from '@heroui/react/spinner'
import { SparkleIcon } from './icons'
import { formatDuration } from '@/lib/format'
import { splitThoughts } from '@/lib/reasoning'

/** Slow enough to be free, fast enough that the wait reads as progress. */
const TICK_MS = 1000

/**
 * Seconds since this reply started, while it is still running.
 *
 * The store measures the finished phase; this only fills the wait, so a
 * timestamp of its own is unnecessary — the component mounts when the reply
 * does.
 */
function useElapsedSeconds(active: boolean): number {
  // Read in the effect rather than during render: a clock is not a pure value,
  // and React may render this component more than once before it commits.
  const startedAt = useRef<number | null>(null)
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!active) return
    startedAt.current ??= Date.now()
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000)),
      TICK_MS,
    )
    return () => clearInterval(timer)
  }, [active])

  return active ? seconds : 0
}

/**
 * One thought per step, from the breaks the model wrote. Deliberately not
 * `RichText`: reasoning is not an answer, and a URL the model talked itself
 * into is exactly the thing that should not become a link here.
 */
function Thoughts({ text, caret }: { text: string; caret: boolean }) {
  const steps = splitThoughts(text)
  // One step is not a timeline; it is a paragraph with a dot in front of it.
  if (steps.length < 2) {
    return <p className={`whitespace-pre-wrap ${caret ? 'caret' : ''}`}>{steps[0] ?? ''}</p>
  }

  return (
    <ol className="space-y-2">
      {steps.map((step, index) => (
        <li key={index} className="flex gap-2">
          <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted/50" />
          <p
            className={`min-w-0 flex-1 whitespace-pre-wrap ${caret && index === steps.length - 1 ? 'caret' : ''}`}
          >
            {step}
          </p>
        </li>
      ))}
    </ol>
  )
}

/**
 * The one line the trace hides behind: a wait while it is one, and afterwards
 * how long that wait was. A reply from before the phase was measured has no
 * duration to report, and says so by not reporting one.
 */
function describeThinking(streaming: boolean, seconds: number, durationMs?: number): string {
  if (streaming) return seconds > 0 ? `Thinking… ${seconds}s` : 'Thinking…'
  if (durationMs === undefined || durationMs <= 0) return 'Thoughts'
  return `Thought for ${formatDuration(durationMs)}`
}

/**
 * The reply's thinking, collapsed.
 *
 * Reasoning is supporting context and never the answer, so it stays behind one
 * line the reader can open and is never expanded for them: a trace that opens
 * itself buries the answer it was meant to explain, and by the third turn of a
 * conversation nobody can find anything. While the model is still thinking the
 * line is the only thing there is to show, so it carries the wait — a spinner,
 * a shimmer and the seconds — and once the answer lands it becomes a footnote
 * that says how long the thinking took.
 */
export function Reasoning({
  text,
  streaming = false,
  durationMs,
}: {
  text: string
  streaming?: boolean
  durationMs?: number
}) {
  const seconds = useElapsedSeconds(streaming)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Reasoning streams in far faster than anyone reads it, so an open trace has
  // to follow its own tail or it sits on the first paragraph for the whole turn.
  useEffect(() => {
    if (!streaming) return
    const body = bodyRef.current
    if (body) body.scrollTop = body.scrollHeight
  }, [streaming, text])

  const label = describeThinking(streaming, seconds, durationMs)

  // Nothing to reveal yet. A chevron that opens an empty panel is worse than
  // the plain statement that the model is working on it.
  if (!text.trim()) {
    if (!streaming) return null
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        {/* The spinner ships with its own "Loading" label, which here would be
            read out in front of a row that already says what is happening. */}
        <Spinner aria-hidden="true" size="sm" />
        <span className="shimmer">{label}</span>
      </p>
    )
  }

  return (
    <Disclosure>
      <Disclosure.Heading>
        <Disclosure.Trigger className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-secondary px-3 py-1.5 text-xs text-muted hover:bg-surface-hover">
          {streaming ? (
            <Spinner aria-hidden="true" size="sm" />
          ) : (
            <SparkleIcon className="size-3.5 opacity-70" />
          )}
          <span className={streaming ? 'shimmer' : undefined}>{label}</span>
          {/* The indicator ships with `ms-auto`, which in a pill this size
              would park the chevron a long way from the words it belongs to. */}
          <Disclosure.Indicator className="ms-0" />
        </Disclosure.Trigger>
      </Disclosure.Heading>

      <Disclosure.Content>
        <Disclosure.Body>
          <div
            ref={bodyRef}
            className="max-h-64 overflow-y-auto rounded-lg border border-border bg-surface-secondary px-3 py-2 text-xs text-muted"
          >
            <Thoughts caret={streaming} text={text} />
          </div>
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}
