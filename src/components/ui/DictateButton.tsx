import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react/button'
import { Tooltip } from '@heroui/react/tooltip'
import { MicIcon } from './icons'
import {
  appendDictation,
  canListen,
  createRecognition,
  describeFailure,
  listeningLanguage,
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
 */
export function DictateButton({
  draft,
  onDraft,
  onStatus,
  lastMessage,
}: {
  draft: string
  onDraft: (next: string) => void
  /** Why a session ended without words, or null once a new one starts. Shown by the caller. */
  onStatus?: (failure: string | null) => void
  lastMessage?: string
}) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<RecognitionLike | null>(null)
  const setFailure = (failure: string | null): void => onStatus?.(failure)
  // The draft as it was when listening began, so interim words replace each
  // other rather than piling up.
  const baseRef = useRef(draft)

  useEffect(() => () => recognitionRef.current?.abort(), [])

  if (!canListen()) return null

  const stop = (): void => {
    recognitionRef.current?.stop()
  }

  const start = (): void => {
    const recognition = createRecognition(listeningLanguage(lastMessage))
    if (!recognition) return
    baseRef.current = draft
    setFailure(null)
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
      setFailure(describeFailure(event.error))
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setListening(false)
      // A session that ended with nothing heard and no error is Chrome giving
      // up on silence; say so rather than leaving the button to blink back.
      if (!failed && !heardAnything) setFailure(describeFailure('no-speech'))
    }
    recognitionRef.current = recognition
    setListening(true)
    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      setListening(false)
      setFailure('Dictation could not start.')
    }
  }

  const label = listening ? 'Stop dictating' : 'Dictate'

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
      <Tooltip.Content>
        {listening ? 'Listening…' : 'Dictate. The browser sends the audio to its speech service.'}
      </Tooltip.Content>
    </Tooltip>
  )
}
