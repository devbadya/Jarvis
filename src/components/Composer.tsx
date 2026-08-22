import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Button } from '@heroui/react/button'
import { TextArea } from '@heroui/react/textarea'
import { useChatStore } from '@/store/chat'

export function Composer() {
  const [draft, setDraft] = useState('')
  const busy = useChatStore((state) => state.busy)
  const send = useChatStore((state) => state.send)
  const stop = useChatStore((state) => state.stop)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <TextArea
          ref={textareaRef}
          value={draft}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Ask something. Enter sends, Shift+Enter adds a line."
          aria-label="Message"
          className="max-h-40 min-h-11 flex-1 resize-none"
        />

        {busy ? (
          <Button variant="danger-soft" onPress={stop}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" isDisabled={draft.trim().length === 0} onPress={submit}>
            Send
          </Button>
        )}
      </div>
    </div>
  )
}
