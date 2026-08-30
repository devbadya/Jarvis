import { Chip } from '@heroui/react/chip'
import { Disclosure } from '@heroui/react/disclosure'
import { Spinner } from '@heroui/react/spinner'
import { LiveClock } from './LiveClock'
import { CheckIcon, WarningIcon } from './ui/icons'
import { formatDuration } from '@/lib/format'
import { describeTool } from '@/lib/tool-labels'
import { clockViewFromResult } from '@/tools/clock'
import type { ToolCall } from '@/types'

const STATUS_LABEL: Record<ToolCall['status'], string> = {
  pending: 'queued',
  running: 'running',
  done: 'done',
  error: 'failed',
}

/**
 * A tool that worked is not news, so the tick is quiet and the failure is the
 * only one with a shape of its own — colour alone would say nothing to a reader
 * who cannot see it, and the row carries the word "failed" for the same reason.
 */
function StatusIcon({ status }: { status: ToolCall['status'] }) {
  // Hidden from the reading order: the trigger it sits in already says the call
  // is running, and the spinner's own label would be read out in front of that.
  if (status === 'running' || status === 'pending') return <Spinner aria-hidden="true" size="sm" />
  if (status === 'error') return <WarningIcon className="size-4 text-danger" />
  return <CheckIcon className="size-4 text-success-soft-foreground" />
}

export function ToolCallCard({ call }: { call: ToolCall }) {
  const summary = Object.entries(call.arguments)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ')

  // A tool reports that it is running and nothing else — no fraction, no
  // estimate — so the row says so by moving rather than by claiming a position.
  const running = call.status === 'running' || call.status === 'pending'
  const clock =
    call.name === 'current_time' && call.status === 'done' && call.result
      ? clockViewFromResult(call.result)
      : null

  return (
    <Disclosure className="relative overflow-hidden rounded-xl border border-border/70 bg-surface-secondary/70">
      <Disclosure.Heading>
        <Disclosure.Trigger
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${running ? 'row-sweep' : ''}`}
        >
          <StatusIcon status={call.status} />
          <span className="shrink-0">{describeTool(call.name, call.status)}</span>
          {clock ? (
            <span className="min-w-0 flex-1 truncate font-mono text-xs">
              <LiveClock timeZone={clock.timeZone} />
              {summary ? <span className="ml-2 font-sans text-muted">{summary}</span> : null}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{summary}</span>
          )}
          {call.status === 'error' && (
            <Chip color="danger" variant="soft">
              {STATUS_LABEL.error}
            </Chip>
          )}
          {call.durationMs !== undefined && (
            <span className="text-xs text-muted">{formatDuration(call.durationMs)}</span>
          )}
          <Disclosure.Indicator />
        </Disclosure.Trigger>
      </Disclosure.Heading>

      <Disclosure.Content>
        <Disclosure.Body className="space-y-2 border-t border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* The identifier the model actually asked for, which is what a
                mis-routed turn is diagnosed from. */}
            <span className="font-mono text-xs">{call.name}</span>
            <Chip variant="soft">{STATUS_LABEL[call.status]}</Chip>
          </div>
          <div>
            <p className="text-xs font-medium text-muted">Arguments</p>
            <pre className="mt-1 overflow-x-auto rounded bg-background p-2 text-xs">
              {JSON.stringify(call.arguments, null, 2)}
            </pre>
          </div>
          {clock && (
            <div>
              <p className="text-xs font-medium text-muted">Live</p>
              <p className="mt-1 font-mono text-sm">
                <LiveClock full place={clock.place} timeZone={clock.timeZone} />
              </p>
            </div>
          )}
          {(call.result ?? call.error) && (
            <div>
              <p className="text-xs font-medium text-muted">
                {call.error ? 'Error' : clock ? 'Read at' : 'Result'}
              </p>
              <pre className="mt-1 max-h-64 overflow-auto rounded bg-background p-2 text-xs whitespace-pre-wrap">
                {call.error ?? call.result}
              </pre>
            </div>
          )}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}
