import { useEffect, useRef } from 'react'
import { Disclosure } from '@heroui/react/disclosure'
import { Spinner } from '@heroui/react/spinner'
import { SparkleIcon } from './icons'
import { formatDuration } from '@/lib/format'
import { splitThoughts } from '@/lib/reasoning'

/** How far from the tail of the trace still counts as following it. */
const FOLLOWING_SLACK_PX = 24

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
 * The one line the trace hides behind.
 *
 * Both forms report the same measurement, which is the point: the store patches
 * the thinking clock in as the tokens arrive, so the number the reader watches
 * climb is the number that ends up on the finished reply. Counting wall-clock
 * time here instead would let "Thinking… 12s" settle into "Thought for 3.2 s"
 * and read as a correction of itself.
 *
 * A reply from before the phase was measured has no duration to report, and
 * says so by not reporting one.
 */
function describeThinking(streaming: boolean, durationMs?: number): string {
  const seconds = Math.floor((durationMs ?? 0) / 1000)
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
  const bodyRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)

  // Reasoning streams in far faster than anyone reads it, so an open trace has
  // to follow its own tail or it sits on the first paragraph for the whole turn
  // — but only while the reader is still at that tail. Scrolling up to reread a
  // step has to survive the next token, which is the same thing the transcript
  // itself learned to do.
  useEffect(() => {
    const body = bodyRef.current
    if (!streaming || !body || !following.current) return
    body.scrollTop = body.scrollHeight
  }, [streaming, text])

  const onScroll = (): void => {
    const body = bodyRef.current
    if (!body) return
    following.current = body.scrollHeight - body.scrollTop - body.clientHeight <= FOLLOWING_SLACK_PX
  }

  const label = describeThinking(streaming, durationMs)

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
            onScroll={onScroll}
          >
            <Thoughts caret={streaming} text={text} />
          </div>
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}
