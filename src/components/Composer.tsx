import { useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Button } from '@heroui/react/button'
import { Kbd } from '@heroui/react/kbd'
import { TextArea } from '@heroui/react/textarea'
import { DictateButton } from './ui/DictateButton'
import { TalkButton } from './ui/TalkButton'
import { ArrowUpIcon, StopIcon, WifiOffIcon, XIcon } from './ui/icons'
import { useT } from '@/i18n'
import { describeTalk, type TalkActivity } from '@/lib/speech'
import { useChatStore } from '@/store/chat'

/** Beyond this the box stops growing and scrolls, so the transcript keeps most of the window. */
const MAX_ROWS_PX = 160

export function Composer() {
  const [draft, setDraft] = useState('')
  const [dictation, setDictation] = useState<string | null>(null)
  const [talk, setTalk] = useState<TalkActivity>({ phase: 'idle', heard: '', failure: null })
  const busy = useChatStore((state) => state.busy)
  const online = useChatStore((state) => state.online)
  const queued = useChatStore((state) => state.queued)
  const send = useChatStore((state) => state.send)
  const unqueue = useChatStore((state) => state.unqueue)
  const stop = useChatStore((state) => state.stop)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const t = useT()

  // A textarea will not size itself to its content, so a multi-line draft would
  // otherwise scroll inside a single visible row.
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_ROWS_PX)}px`
  }, [draft])

  // `send` decides whether this is answered now or waits its turn, so the
  // composer clears either way and the draft is never silently swallowed. The
  // one thing it will not do is answer offline, and a draft cleared into that
  // refusal would be swallowed — so the question stays in the box.
  const submit = (): void => {
    const text = draft.trim()
    if (!text || !online) return
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
    <div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
      <div className="glass-dim dock edge-beam relative mx-auto max-w-3xl rounded-3xl border border-border/60 p-3">
        {/* The same fact as the label below, at the edge of vision: something is
            being generated. Hidden from the reading order because the label is
            where it is said in words. */}
        {busy && <span aria-hidden="true" className="busy-line absolute inset-x-6 top-0 h-0.5" />}

        {/* The model would still generate without a connection. What it could
            not do is check a word of it, so the refusal is stated here rather
            than left for the reader to work out from a disabled button. */}
        {!online && (
          <p
            className="mb-2 flex animate-in items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground fade-in slide-in-from-bottom-1 duration-300"
            role="status"
          >
            <WifiOffIcon aria-hidden="true" className="size-4 shrink-0" />
            {t('composer.offline')}
          </p>
        )}

        {/* Announced, because queueing happens on Enter and otherwise says
            nothing to anyone who cannot see the row appear. */}
        {queued.length > 0 && (
          <ul aria-label={t('composer.waiting')} aria-live="polite" className="mb-2 space-y-1">
            {queued.map((text, index) => (
              <li
                key={index}
                className="flex animate-in items-center gap-2 rounded-xl border border-dashed border-border bg-surface-secondary/80 ps-3 pe-1 py-1 text-xs text-muted fade-in slide-in-from-bottom-1 duration-300"
              >
                <span className="min-w-0 flex-1 truncate">{text}</span>
                <Button
                  aria-label={t('composer.removeQueued', { text })}
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  onPress={() => unqueue(text)}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-2">
          {/* The glow lives on a wrapper rather than on the field: HeroUI already
              owns the field's own border and shadow, and a second ring drawn on
              top of them reads as two boxes. */}
          <div className="focus-glow min-w-0 flex-1 rounded-[var(--field-radius)]">
            <TextArea
              ref={textareaRef}
              value={draft}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={t('composer.placeholder')}
              aria-label={t('composer.message')}
              className="min-h-11 w-full resize-none overflow-y-auto"
            />
          </div>

          {/* A live conversation listens, sends on a pause, and reads the
              reply back. Dictation is the other microphone, and only one
              recogniser can run, so it steps aside while a conversation is open. */}
          <TalkButton onActivity={setTalk} />
          {talk.phase === 'idle' && (
            <DictateButton draft={draft} onDraft={setDraft} onStatus={setDictation} />
          )}

          {/* Queueing cannot be an Enter-only affordance, so the arrow stays
              available while a reply runs — but only once there is something to
              queue, rather than sitting there greyed out beside Stop. */}
          {busy && draft.trim().length > 0 && (
            <Button
              aria-label={t('composer.queue')}
              className="rounded-full"
              isIconOnly
              variant="secondary"
              onPress={submit}
            >
              <ArrowUpIcon />
            </Button>
          )}

          {/* The arrow is the shape every chat composer has taught people to
              look for, and the label keeps saying Send for anyone who cannot
              see it. */}
          {busy ? (
            <Button
              aria-label={t('composer.stop')}
              className="rounded-full"
              isIconOnly
              variant="danger-soft"
              onPress={stop}
            >
              <StopIcon />
            </Button>
          ) : (
            <Button
              aria-label={t('composer.send')}
              className="rounded-full"
              isDisabled={draft.trim().length === 0 || !online}
              isIconOnly
              variant="primary"
              onPress={submit}
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>

        {/* A dictation that ended without words says why, here rather than in a
            tooltip nobody is hovering. */}
        {dictation && talk.phase === 'idle' && (
          <p className="mt-2 text-xs text-danger" role="status">
            {dictation}
          </p>
        )}

        {talk.failure && (
          <p className="mt-2 text-xs text-danger" role="status">
            {talk.failure}
          </p>
        )}

        {/* In the placeholder this vanished the moment anyone started typing. */}
        {talk.phase === 'listening' || talk.phase === 'speaking' ? (
          <p className="mt-2 text-xs text-muted" role="status">
            {describeTalk(talk.phase, talk.heard, {
              listening: t('composer.listening'),
              thinking: t('composer.talk.thinking'),
              speaking: t('composer.talk.speaking'),
            })}
          </p>
        ) : talk.phase === 'thinking' && !busy ? (
          <p className="mt-2 text-xs text-muted" role="status">
            {t('composer.talk.thinking')}
          </p>
        ) : busy ? (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span className="shimmer">{t('composer.replying')}</span>
            <span aria-hidden="true">·</span>
            <Kbd>Enter</Kbd> {t('composer.enterQueues')}
          </p>
        ) : (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <Kbd>Enter</Kbd> {t('composer.enterSends')}
            <span aria-hidden="true">·</span>
            <Kbd>Shift</Kbd>
            <span aria-hidden="true">+</span>
            <Kbd>Enter</Kbd> {t('composer.shiftEnter')}
          </p>
        )}
      </div>
      <p className="mx-auto mt-2 max-w-3xl px-2 text-center text-[0.7rem] text-muted">
        {t('composer.disclaimer')}
      </p>
    </div>
  )
}
