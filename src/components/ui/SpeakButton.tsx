import { useEffect, useState } from 'react'
import { Button } from '@heroui/react/button'
import { SpeakerIcon, StopIcon } from './icons'
import { useLocale, useT } from '@/i18n'
import { canSpeak, speak, stopSpeaking } from '@/lib/speech'

/**
 * Reads one reply aloud with the voices installed on this device. Renders
 * nothing where the browser cannot speak, for the same reason the copy button
 * stays quiet when the clipboard is refused.
 */
export function SpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false)
  const locale = useLocale((state) => state.locale)
  const t = useT()

  useEffect(() => {
    if (!speaking) return
    return () => stopSpeaking()
  }, [speaking])

  if (!canSpeak()) return null

  const toggle = (): void => {
    if (speaking) {
      stopSpeaking()
      setSpeaking(false)
      return
    }
    const utterance = speak(text, () => setSpeaking(false), locale)
    setSpeaking(utterance !== null)
  }

  return (
    <Button
      aria-label={speaking ? t('message.stopReading') : t('message.readAloud')}
      aria-pressed={speaking}
      isIconOnly
      size="sm"
      variant="ghost"
      onPress={toggle}
    >
      {speaking ? <StopIcon /> : <SpeakerIcon />}
    </Button>
  )
}
