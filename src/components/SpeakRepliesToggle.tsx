import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react/button'
import { Tooltip } from '@heroui/react/tooltip'
import { SpeakerIcon, SpeakerOffIcon } from './ui/icons'
import { useLocale, useT } from '@/i18n'
import {
  canSpeak,
  claimSpokenReply,
  readSpeakReplies,
  speak,
  stopSpeaking,
  writeSpeakReplies,
} from '@/lib/speech'
import { useChatStore } from '@/store/chat'

/**
 * Reads every finished reply aloud. On for every chat until switched off.
 *
 * A reply is spoken once, when it stops streaming, and only if it finished
 * without an error. One that was already on screen when its chat opened is
 * history. Switching off also stops whatever is still being read.
 * Renders nothing where the browser has no voices.
 */
export function SpeakRepliesToggle() {
  const [enabled, setEnabled] = useState(readSpeakReplies)
  const messages = useChatStore((state) => state.messages)
  const chatId = useChatStore((state) => state.chatId)
  const chatsLoaded = useChatStore((state) => state.chatsLoaded)
  const spokenRef = useRef<string | null>(null)
  // `undefined` is "no chat seen yet", which is distinct from the empty chat.
  const seenChatRef = useRef<string | null | undefined>(undefined)
  const liveRef = useRef<Set<string>>(new Set())
  const t = useT()
  const locale = useLocale((state) => state.locale)

  useEffect(() => {
    for (const message of messages) {
      if (message.role === 'assistant' && message.streaming) liveRef.current.add(message.id)
    }
  }, [messages])

  useEffect(() => {
    if (!chatsLoaded || seenChatRef.current === chatId) return
    seenChatRef.current = chatId
    const last = messages.at(-1)
    // A reply that streamed in this tab is news, even if the chat id arrived late.
    if (!last || last.role !== 'assistant' || last.streaming || last.error || !last.content) return
    if (liveRef.current.has(last.id)) return
    spokenRef.current = last.id
  }, [chatsLoaded, chatId, messages])

  useEffect(() => {
    if (!enabled) return
    const last = messages.at(-1)
    if (!last || last.role !== 'assistant' || last.streaming || last.error || !last.content) return
    if (spokenRef.current === last.id) return
    // Saved history stays quiet. A reply still being written, or one that
    // finished before the chat list did, is this visit and gets read.
    if (!chatsLoaded && !liveRef.current.has(last.id)) return
    // A live conversation speaks this reply itself, and needs the ending.
    if (!claimSpokenReply(last.id, 'toggle')) {
      spokenRef.current = last.id
      return
    }
    spokenRef.current = last.id
    speak(last.content, undefined, locale)
  }, [enabled, chatsLoaded, messages, locale])

  if (!canSpeak()) return null

  const label = enabled ? t('header.readAloud.off') : t('header.readAloud.on')

  const toggle = (): void => {
    const next = !enabled
    if (!next) stopSpeaking()
    // A reply that was already on screen when this is switched on is not news.
    spokenRef.current = messages.at(-1)?.id ?? null
    writeSpeakReplies(next)
    setEnabled(next)
  }

  return (
    <Tooltip>
      <Button
        aria-label={label}
        aria-pressed={enabled}
        className="rounded-full"
        isIconOnly
        size="sm"
        variant="ghost"
        onPress={toggle}
      >
        {enabled ? <SpeakerIcon /> : <SpeakerOffIcon />}
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  )
}
