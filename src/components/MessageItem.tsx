import { Disclosure } from '@heroui/react/disclosure'
import { ToolCallCard } from './ToolCallCard'
import { formatDuration } from '@/lib/format'
import type { Message } from '@/types'

export function MessageItem({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-accent-foreground">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    )
  }

  const showCaret = message.streaming && message.content.length > 0
  const waiting = message.streaming && !message.content && !message.reasoning

  return (
    <div className="space-y-2">
      {message.reasoning && (
        <Disclosure className="rounded-lg border border-border bg-surface-secondary">
          <Disclosure.Heading>
            <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted">
              <Disclosure.Indicator />
              Reasoning
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content>
            <Disclosure.Body className="border-t border-border px-3 py-2 text-xs whitespace-pre-wrap text-muted">
              {message.reasoning}
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      )}

      {message.toolCalls?.map((call) => (
        <ToolCallCard key={call.id} call={call} />
      ))}

      {waiting ? (
        <p className="text-sm text-muted">Thinking…</p>
      ) : (
        <div className={`max-w-none whitespace-pre-wrap break-words ${showCaret ? 'caret' : ''}`}>
          {message.content}
        </div>
      )}

      {message.stats && !message.streaming && (
        <p className="text-xs text-muted">
          {message.stats.tokens} tokens · {message.stats.tokensPerSecond.toFixed(1)} tok/s ·{' '}
          {formatDuration(message.stats.durationMs)}
        </p>
      )}
    </div>
  )
}
