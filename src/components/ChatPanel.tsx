import { useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react/button'
import { Composer } from './Composer'
import { MessageItem } from './MessageItem'
import { ArrowDownIcon } from './ui/icons'
import { useChatStore } from '@/store/chat'

const EXAMPLES = [
  'What happened in tech news this week?',
  'Calculate (17 * 23) / sqrt(2)',
  'Summarise https://example.com in three sentences',
]

/** How far from the bottom still counts as following along. */
const PINNED_SLACK_PX = 48

export function ChatPanel() {
  const messages = useChatStore((state) => state.messages)
  const busy = useChatStore((state) => state.busy)
  const send = useChatStore((state) => state.send)
  const scrollRef = useRef<HTMLElement>(null)
  const [pinned, setPinned] = useState(true)

  // Following the tail is the default, but scrolling up to reread something has
  // to survive the next token — the previous unconditional scrollIntoView on
  // every store patch made the transcript impossible to read during generation.
  useLayoutEffect(() => {
    const viewport = scrollRef.current
    if (!viewport || !pinned) return
    viewport.scrollTop = viewport.scrollHeight
  }, [messages, pinned])

  const onScroll = (): void => {
    const viewport = scrollRef.current
    if (!viewport) return
    setPinned(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= PINNED_SLACK_PX)
  }

  const jumpToLatest = (): void => {
    setPinned(true)
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <section
          ref={scrollRef}
          aria-label="Conversation"
          className="flex-1 overflow-y-auto"
          onScroll={onScroll}
        >
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
            {messages.length === 0 ? (
              <div className="space-y-4 pt-12 text-center">
                <h2 className="text-xl font-semibold">What can I do for you?</h2>
                <p className="text-sm text-muted">
                  The model runs on your GPU. It can search the web, read pages, and do exact arithmetic.
                </p>
                <div
                  aria-label="Example prompts"
                  className="flex flex-wrap justify-center gap-2 pt-2"
                  role="group"
                >
                  {EXAMPLES.map((example) => (
                    <Button key={example} size="sm" variant="outline" onPress={() => void send(example)}>
                      {example}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message, index) => (
                <MessageItem key={message.id} isLatest={index === messages.length - 1} message={message} />
              ))
            )}
          </div>
        </section>

        {/* Streaming changes nothing a screen reader can perceive; announce the
            coarse state rather than every token. */}
        <p aria-live="polite" className="sr-only" role="status">
          {busy ? 'Jarvis is working on a reply' : ''}
        </p>

        {!pinned && messages.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button
              className="pointer-events-auto shadow-md"
              size="sm"
              variant="secondary"
              onPress={jumpToLatest}
            >
              <ArrowDownIcon />
              Jump to latest
            </Button>
          </div>
        )}
      </div>

      <Composer />
    </div>
  )
}
