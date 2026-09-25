import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react/button'
import { Tooltip } from '@heroui/react/tooltip'
import { StopIcon, WaveIcon } from './icons'
import {
  TURN_PAUSE_MS,
  canListen,
  canSpeak,
  claimSpokenReply,
  createRecognition,
  describeFailure,
  listeningLanguage,
  speak,
  speakableText,
  stopSpeaking,
  transcriptFrom,
  unansweredNotice,
  type RecognitionLike,
  type TalkActivity,
  type TalkPhase,
} from '@/lib/speech'
import { useChatStore } from '@/store/chat'

/** Chrome ends a silent session; wait briefly before opening the next one. */
const RESTART_MS = 200

/**
 * A spoken conversation with Jarvis.
 *
 * One press listens. A pause sends the finished phrase and the reply is read
 * aloud, then it listens again. A second press hangs up. The microphone is the
 * browser's, so the button is absent where the browser can neither listen nor
 * speak — dictation and the speaker already cover the halves.
 */
export function TalkButton({
  lastMessage,
  onActivity,
}: {
  lastMessage?: string
  onActivity?: (activity: TalkActivity) => void
}) {
  const [phase, setPhase] = useState<TalkPhase>('idle')
  const [heard, setHeard] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const messages = useChatStore((state) => state.messages)
  const busy = useChatStore((state) => state.busy)
  const online = useChatStore((state) => state.online)

  const phaseRef = useRef<TalkPhase>('idle')
  const heardFinal = useRef('')
  const recognitionRef = useRef<RecognitionLike | null>(null)
  const pauseRef = useRef<number | null>(null)
  const restartRef = useRef<number | null>(null)
  const activeRef = useRef(false)
  const spokenRef = useRef<string | null>(null)
  const skipRef = useRef<string | null>(null)
  const lastMessageRef = useRef(lastMessage)
  const listenRef = useRef<() => void>(() => {})
  const replyRef = useRef<() => void>(() => {})

  const setPhaseNow = (next: TalkPhase): void => {
    phaseRef.current = next
    setPhase(next)
  }

  const clearTimers = (): void => {
    if (pauseRef.current !== null) {
      window.clearTimeout(pauseRef.current)
      pauseRef.current = null
    }
    if (restartRef.current !== null) {
      window.clearTimeout(restartRef.current)
      restartRef.current = null
    }
  }

  const dropRecognition = (): void => {
    const recognition = recognitionRef.current
    recognitionRef.current = null
    recognition?.abort()
  }

  const finish = (): void => {
    activeRef.current = false
    clearTimers()
    dropRecognition()
    stopSpeaking()
    heardFinal.current = ''
    setHeard('')
    setPhaseNow('idle')
  }

  const beginListening = (): void => {
    if (!activeRef.current || phaseRef.current !== 'listening') return
    if (!useChatStore.getState().online) {
      setFailure('No connection. Jarvis waits until you are back online.')
      finish()
      return
    }
    clearTimers()
    dropRecognition()
    const sample =
      useChatStore.getState().messages.findLast((message) => message.role === 'user')?.content ??
      lastMessageRef.current
    const recognition = createRecognition(listeningLanguage(sample), { continuous: true })
    if (!recognition) {
      setFailure('This browser cannot listen.')
      finish()
      return
    }
    heardFinal.current = ''
    setHeard('')

    const commitPhrase = (phrase: string): void => {
      if (!phrase || !activeRef.current || phaseRef.current !== 'listening') return
      heardFinal.current = ''
      setHeard('')
      setPhaseNow('thinking')
      clearTimers()
      dropRecognition()
      const before = useChatStore.getState()
      const messageCount = before.messages.length
      const queuedCount = before.queued.length
      // `send` resolves only once the whole turn has finished, or immediately
      // when it queues or refuses. A refusal leaves the phase on thinking,
      // which is where a conversation would otherwise wait forever.
      void before.send(phrase).then(() => {
        if (!activeRef.current) return
        if (phaseRef.current === 'speaking' || phaseRef.current === 'listening') return
        const after = useChatStore.getState()
        const queued = after.queued.length > queuedCount
        const last = after.messages.at(-1)
        const replied = after.messages.length > messageCount && last?.role === 'assistant'
        if (queued || after.busy || replied) return
        if (!after.online) {
          setFailure('No connection. Jarvis waits until you are back online.')
          finish()
          return
        }
        resumeListening()
      })
    }

    recognition.onresult = (event) => {
      if (!activeRef.current || phaseRef.current !== 'listening') return
      const { finalText, interimText } = transcriptFrom(event)
      heardFinal.current = finalText
      setHeard([finalText, interimText].filter(Boolean).join(' '))
      if (!finalText) return
      if (pauseRef.current !== null) window.clearTimeout(pauseRef.current)
      pauseRef.current = window.setTimeout(() => {
        pauseRef.current = null
        commitPhrase(heardFinal.current.trim())
      }, TURN_PAUSE_MS)
    }
    recognition.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return
      setFailure(describeFailure(event.error))
      finish()
    }
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return
      recognitionRef.current = null
      if (pauseRef.current !== null) {
        window.clearTimeout(pauseRef.current)
        pauseRef.current = null
      }
      if (!activeRef.current || phaseRef.current !== 'listening') return
      const phrase = heardFinal.current.trim()
      if (phrase) {
        commitPhrase(phrase)
        return
      }
      restartRef.current = window.setTimeout(() => {
        restartRef.current = null
        beginListening()
      }, RESTART_MS)
    }
    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      setFailure('The conversation could not start.')
      finish()
    }
  }
  const resumeListening = (): void => {
    if (!activeRef.current) return
    setPhaseNow('listening')
  }

  const handleReply = (): void => {
    if (!activeRef.current) return
    const last = messages.at(-1)
    if (!last || last.role !== 'assistant') return
    if (last.id === skipRef.current || spokenRef.current === last.id) return
    if (last.streaming || busy) {
      if (phaseRef.current === 'listening') {
        setPhaseNow('thinking')
        clearTimers()
        dropRecognition()
      }
      return
    }
    const say = last.error ? unansweredNotice(lastMessageRef.current) : last.content
    if (!speakableText(say)) {
      spokenRef.current = last.id
      resumeListening()
      return
    }
    if (!claimSpokenReply(last.id, 'conversation')) {
      spokenRef.current = last.id
      return
    }
    spokenRef.current = last.id
    setPhaseNow('speaking')
    setHeard('')
    clearTimers()
    dropRecognition()
    if (!speak(say, resumeListening)) resumeListening()
  }

  // The effects below call these. Writing the refs here, before those effects,
  // keeps the assignment off the render path.
  useEffect(() => {
    lastMessageRef.current = lastMessage
    listenRef.current = beginListening
    replyRef.current = handleReply
  })

  useEffect(() => {
    onActivity?.({ phase, heard, failure })
  }, [phase, heard, failure, onActivity])

  useEffect(() => {
    replyRef.current()
  }, [messages, busy])

  // Starting the recogniser from the effect, not the click, lets dictation
  // unmount and release the microphone first. Only one session can hold it.
  // The timeout is cleared on the way out, including the extra setup/cleanup
  // pass React runs in development, so a second session is never opened.
  useEffect(() => {
    if (phase !== 'listening') return
    const startId = window.setTimeout(() => listenRef.current(), 0)
    return () => {
      window.clearTimeout(startId)
      clearTimers()
      dropRecognition()
    }
  }, [phase])

  useEffect(
    () => () => {
      activeRef.current = false
      if (pauseRef.current !== null) window.clearTimeout(pauseRef.current)
      if (restartRef.current !== null) window.clearTimeout(restartRef.current)
      recognitionRef.current?.abort()
      recognitionRef.current = null
      stopSpeaking()
    },
    [],
  )

  if (!canListen() || !canSpeak()) return null

  const active = phase !== 'idle'
  const label = active ? 'End conversation' : 'Talk'

  const toggle = (): void => {
    if (activeRef.current) {
      const wasBusy = useChatStore.getState().busy
      finish()
      setFailure(null)
      if (wasBusy) useChatStore.getState().stop()
      return
    }
    setFailure(null)
    const state = useChatStore.getState()
    const last = state.messages.at(-1)
    skipRef.current = last?.role === 'assistant' && !last.streaming ? last.id : null
    spokenRef.current = skipRef.current
    activeRef.current = true
    if (state.busy) {
      setPhaseNow('thinking')
      return
    }
    setPhaseNow('listening')
  }

  return (
    <Tooltip>
      <Button
        aria-label={label}
        aria-pressed={active}
        className="rounded-full"
        isDisabled={!active && !online}
        isIconOnly
        variant={active ? 'danger-soft' : 'ghost'}
        onPress={toggle}
      >
        {active ? <StopIcon /> : <WaveIcon />}
      </Button>
      <Tooltip.Content>
        {active
          ? 'End the conversation'
          : 'Talk with Jarvis. Speak, then pause. The browser sends the audio to its speech service, and the reply is read aloud.'}
      </Tooltip.Content>
    </Tooltip>
  )
}
