import { useEffect, useState } from 'react'
import { Alert } from '@heroui/react/alert'
import { Button } from '@heroui/react/button'
import { Disclosure } from '@heroui/react/disclosure'
import { Spinner } from '@heroui/react/spinner'
import { ToolCallCard } from './ToolCallCard'
import { CheckIcon, CopyIcon, RefreshIcon } from './ui/icons'
import { formatDuration, formatTime } from '@/lib/format'
import { useChatStore } from '@/store/chat'
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

/**
 * Only the newest reply can be rerun. `retry` rewinds to the last request, so
 * offering it further up the transcript would silently discard everything after
 * the message the button sits on.
 */
function RetryButton({ children }: { children: string }) {
  const busy = useChatStore((state) => state.busy)
  const retry = useChatStore((state) => state.retry)

  return (
    <Button isDisabled={busy} size="sm" variant="ghost" onPress={() => void retry()}>
      <RefreshIcon />
      {children}
    </Button>
  )
}

export function MessageItem({ message, isLatest = false }: { message: Message; isLatest?: boolean }) {
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
            {/* The indicator carries `ms-auto`, so it belongs last; leading it
                pushes the whole row to the trailing edge. */}
            <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted">
              Reasoning
              <Disclosure.Indicator />
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

      {message.error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>The reply did not finish</Alert.Title>
            <Alert.Description className="break-words">{message.error}</Alert.Description>
            {isLatest && (
              <div className="pt-2">
                <RetryButton>Try again</RetryButton>
              </div>
            )}
          </Alert.Content>
        </Alert>
      )}

      {!message.streaming && message.content && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <CopyButton text={message.content} />
          {isLatest && !message.error && <RetryButton>Regenerate</RetryButton>}
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
