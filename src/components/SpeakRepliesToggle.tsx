import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react/button'
import { Tooltip } from '@heroui/react/tooltip'
import { SpeakerIcon, SpeakerOffIcon } from './ui/icons'
import { useLocale, useT } from '@/i18n'
import { canSpeak, readSpeakReplies, speak, stopSpeaking, writeSpeakReplies } from '@/lib/speech'
import { useChatStore } from '@/store/chat'

/**
 * Reads every finished reply aloud while switched on.
 *
 * A reply is spoken once, when it stops streaming, and only if it finished
 * without an error. Switching off also stops whatever is still being read.
 * Renders nothing where the browser has no voices.
 */
export function SpeakRepliesToggle() {
  const [enabled, setEnabled] = useState(readSpeakReplies)
  const messages = useChatStore((state) => state.messages)
  const spokenRef = useRef<string | null>(null)
  const t = useT()
  const locale = useLocale((state) => state.locale)

  useEffect(() => {
    if (!enabled) return
    const last = messages.at(-1)
    if (!last || last.role !== 'assistant' || last.streaming || last.error || !last.content) return
    if (spokenRef.current === last.id) return
    spokenRef.current = last.id
    speak(last.content, undefined, locale)
  }, [enabled, messages, locale])

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
