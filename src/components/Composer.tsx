import { useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Button } from '@heroui/react/button'
import { Kbd } from '@heroui/react/kbd'
import { TextArea } from '@heroui/react/textarea'
import { ArrowUpIcon, StopIcon } from './ui/icons'
import { useChatStore } from '@/store/chat'

/** Beyond this the box stops growing and scrolls, so the transcript keeps most of the window. */
const MAX_ROWS_PX = 160

export function Composer() {
  const [draft, setDraft] = useState('')
  const busy = useChatStore((state) => state.busy)
  const send = useChatStore((state) => state.send)
  const stop = useChatStore((state) => state.stop)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // A textarea will not size itself to its content, so a multi-line draft would
  // otherwise scroll inside a single visible row.
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_ROWS_PX)}px`
  }, [draft])

  const submit = (): void => {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    void send(text)
    textareaRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter sends; Shift+Enter inserts a newline, matching common chat conventions.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-border bg-background p-3">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2">
          <TextArea
            ref={textareaRef}
            value={draft}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask something…"
            aria-label="Message"
            className="min-h-11 flex-1 resize-none overflow-y-auto"
          />

          {/* The arrow is the shape every chat composer has taught people to
              look for, and the label keeps saying Send for anyone who cannot
              see it. */}
          {busy ? (
            <Button
              aria-label="Stop"
              className="rounded-full"
              isIconOnly
              variant="danger-soft"
              onPress={stop}
            >
              <StopIcon />
            </Button>
          ) : (
            <Button
              aria-label="Send"
              className="rounded-full"
              isDisabled={draft.trim().length === 0}
              isIconOnly
              variant="primary"
              onPress={submit}
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>

        {/* In the placeholder this vanished the moment anyone started typing. */}
        {busy ? (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span className="shimmer">Jarvis is replying</span>
            <span aria-hidden="true">·</span>
            what you type now sends when it finishes
          </p>
        ) : (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <Kbd>Enter</Kbd> sends
            <span aria-hidden="true">·</span>
            <Kbd>Shift</Kbd>
            <span aria-hidden="true">+</span>
            <Kbd>Enter</Kbd> adds a line
          </p>
        )}
      </div>
    </div>
  )
}
