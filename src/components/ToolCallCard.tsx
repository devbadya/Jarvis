import { Disclosure } from '@heroui/react/disclosure'
import { Spinner } from '@heroui/react/spinner'
import { Badge } from './ui/Badge'
import { formatDuration } from '@/lib/format'
import type { ToolCall } from '@/types'

const STATUS_LABEL: Record<ToolCall['status'], string> = {
  pending: 'queued',
  running: 'running',
  done: 'done',
  error: 'failed',
}

export function ToolCallCard({ call }: { call: ToolCall }) {
  const summary = Object.entries(call.arguments)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ')

  return (
    <Disclosure className="rounded-lg border border-border bg-surface-secondary">
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
          {call.status === 'running' ? <Spinner size="sm" /> : <Disclosure.Indicator />}
          <span className="font-mono text-xs">{call.name}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted">{summary}</span>
          <Badge tone={call.status === 'error' ? 'danger' : call.status === 'done' ? 'success' : 'neutral'}>
            {STATUS_LABEL[call.status]}
          </Badge>
          {call.durationMs !== undefined && (
            <span className="text-xs text-muted">{formatDuration(call.durationMs)}</span>
          )}
        </Disclosure.Trigger>
      </Disclosure.Heading>

      <Disclosure.Content>
        <Disclosure.Body className="space-y-2 border-t border-border px-3 py-2">
          <div>
            <p className="text-xs font-medium text-muted">Arguments</p>
            <pre className="mt-1 overflow-x-auto rounded bg-background p-2 text-xs">
              {JSON.stringify(call.arguments, null, 2)}
            </pre>
          </div>
          {(call.result ?? call.error) && (
            <div>
              <p className="text-xs font-medium text-muted">{call.error ? 'Error' : 'Result'}</p>
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
