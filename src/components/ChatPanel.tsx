import { useEffect, useRef } from 'react'
import { Composer } from './Composer'
import { MessageItem } from './MessageItem'
import { useChatStore } from '@/store/chat'

const EXAMPLES = [
  'What happened in tech news this week?',
  'Calculate (17 * 23) / sqrt(2)',
  'Summarise https://example.com in three sentences',
]

export function ChatPanel() {
  const messages = useChatStore((state) => state.messages)
  const send = useChatStore((state) => state.send)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
          {messages.length === 0 ? (
            <div className="space-y-4 pt-12 text-center">
              <h2 className="text-xl font-semibold">What can I do for you?</h2>
              <p className="text-sm text-muted">
                The model runs on your GPU. It can search the web, read pages, and do exact arithmetic.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => void send(example)}
                    className="rounded-full border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => <MessageItem key={message.id} message={message} />)
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      <Composer />
    </div>
  )
}
