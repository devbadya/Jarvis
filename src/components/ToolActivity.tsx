import { Chip } from '@heroui/react/chip'
import { Disclosure } from '@heroui/react/disclosure'
import { Spinner } from '@heroui/react/spinner'
import { ToolCallCard } from './ToolCallCard'
import { WrenchIcon } from './ui/icons'
import { formatDuration } from '@/lib/format'
import { describeTool } from '@/lib/tool-labels'
import type { ToolCall } from '@/types'

/**
 * What the agent did before answering.
 *
 * One call is shown as itself. Several are collected behind a single row,
 * because a turn that searched, read two pages and then added up what it found
 * otherwise pushes the answer off the screen with the evidence for it — and
 * unlike reasoning this is observed behaviour, so the row can say what happened
 * without opening anything.
 */
export function ToolActivity({ calls }: { calls: ToolCall[] }) {
  if (calls.length === 0) return null
  const [only] = calls
  if (calls.length === 1 && only) return <ToolCallCard call={only} />

  const inFlight = calls.find((call) => call.status === 'running' || call.status === 'pending')
  const failed = calls.filter((call) => call.status === 'error').length
  const spent = calls.reduce((total, call) => total + (call.durationMs ?? 0), 0)

  return (
    <Disclosure className="rounded-lg border border-border bg-surface-secondary">
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
          {inFlight ? <Spinner aria-hidden="true" size="sm" /> : <WrenchIcon className="size-4 opacity-60" />}
          <span className="shrink-0">
            {inFlight ? `${describeTool(inFlight.name, inFlight.status)}…` : `Used ${calls.length} tools`}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
            {calls.map((call) => call.name).join(' · ')}
          </span>
          {failed > 0 && (
            <Chip color="danger" variant="soft">
              {failed} failed
            </Chip>
          )}
          {!inFlight && spent > 0 && <span className="text-xs text-muted">{formatDuration(spent)}</span>}
          <Disclosure.Indicator />
        </Disclosure.Trigger>
      </Disclosure.Heading>

      <Disclosure.Content>
        <Disclosure.Body className="space-y-2 border-t border-border px-3 py-2">
          {calls.map((call) => (
            <ToolCallCard key={call.id} call={call} />
          ))}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}
