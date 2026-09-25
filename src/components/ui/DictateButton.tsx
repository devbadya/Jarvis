import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react/button'
import { Tooltip } from '@heroui/react/tooltip'
import { MicIcon } from './icons'
import { speechTag, translate, useLocale, useT, type MessageKey } from '@/i18n'
import {
  appendDictation,
  canListen,
  createRecognition,
  failureKey,
  transcriptFrom,
  type RecognitionLike,
} from '@/lib/speech'

/**
 * Dictation into the composer.
 *
 * The recogniser is the browser's, so this renders nothing where there is
 * none rather than a button that can only apologise. One press listens for a
 * sentence, a second press stops early. The words land in the draft rather
 * than being sent, so a misheard word can be fixed before it goes anywhere.
 *
 * It listens in the chosen language. That is the whole point of the choice:
 * a German speaker who picked Deutsch should not be transcribed as English.
 */
export function DictateButton({
  draft,
  onDraft,
  onStatus,
}: {
  draft: string
  onDraft: (next: string) => void
  /** Why a session ended without words, or null once a new one starts. Shown by the caller. */
  onStatus?: (failure: string | null) => void
}) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<RecognitionLike | null>(null)
  const locale = useLocale((state) => state.locale)
  const t = useT()
  // The draft as it was when listening began, so interim words replace each
  // other rather than piling up.
  const baseRef = useRef(draft)

  useEffect(() => () => recognitionRef.current?.abort(), [])

  if (!canListen()) return null

  const say = (key: MessageKey | null): void => onStatus?.(key ? translate(locale, key) : null)

  const stop = (): void => {
    recognitionRef.current?.stop()
  }

  const start = (): void => {
    const recognition = createRecognition(speechTag(locale))
    if (!recognition) return
    baseRef.current = draft
    say(null)
    let failed = false
    let heardAnything = false
    recognition.onresult = (event) => {
      heardAnything = true
      const { finalText, interimText } = transcriptFrom(event)
      onDraft(appendDictation(baseRef.current, `${finalText} ${interimText}`))
    }
    recognition.onerror = (event) => {
      if (event.error === 'aborted') return
      failed = true
      say(failureKey(event.error))
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setListening(false)
      // A session that ended with nothing heard and no error is Chrome giving
      // up on silence; say so rather than leaving the button to blink back.
      if (!failed && !heardAnything) say('dictation.nothingHeard')
    }
    recognitionRef.current = recognition
    setListening(true)
    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      setListening(false)
      say('dictation.couldNotStart')
    }
  }

  const label = listening ? t('composer.stopDictating') : t('composer.dictate')

  return (
    <Tooltip>
      <Button
        aria-label={label}
        aria-pressed={listening}
        className="rounded-full"
        isIconOnly
        variant={listening ? 'danger-soft' : 'ghost'}
        onPress={listening ? stop : start}
      >
        <MicIcon />
      </Button>
      <Tooltip.Content>{listening ? t('composer.listening') : t('composer.dictate.hint')}</Tooltip.Content>
    </Tooltip>
  )
}
