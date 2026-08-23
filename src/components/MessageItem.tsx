import { useEffect, useState } from 'react'
import { Button } from '@heroui/react/button'
import { Disclosure } from '@heroui/react/disclosure'
import { Spinner } from '@heroui/react/spinner'
import { ToolCallCard } from './ToolCallCard'
import { CheckIcon, CopyIcon } from './ui/icons'
import { formatDuration, formatTime } from '@/lib/format'
import type { Message } from '@/types'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Denied clipboard permission or an insecure origin: leave the label alone
      // rather than claim a copy that did not happen.
    }
  }

  return (
    <Button
      aria-label={copied ? 'Reply copied' : 'Copy reply'}
      isIconOnly
      size="sm"
      variant="ghost"
      onPress={() => void copy()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

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
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner size="sm" /> Thinking…
        </p>
      ) : (
        <div className={`max-w-none whitespace-pre-wrap break-words ${showCaret ? 'caret' : ''}`}>
          {message.content}
        </div>
      )}

      {!message.streaming && message.content && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <CopyButton text={message.content} />
          {message.stats && (
            <span>
              {message.stats.tokens} tokens · {message.stats.tokensPerSecond.toFixed(1)} tok/s ·{' '}
              {formatDuration(message.stats.durationMs)}
            </span>
          )}
          <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>
        </div>
      )}
    </div>
  )
}
