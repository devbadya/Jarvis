import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@heroui/react/button'
import { Disclosure } from '@heroui/react/disclosure'
import { Orb } from './Orb'
import { speechTag, useLocale, useT, type MessageKey } from '@/i18n'
import { prefersReducedMotion } from '@/lib/motion'
import {
  PRESENCE_COLORS,
  PRESENCE_DESIGNS,
  PRESENCE_PALETTES,
  readPresence,
  writePresence,
  type PresenceColor,
  type PresenceDesign,
  type PresencePreference,
} from '@/lib/presence'
import { levelFromTimeDomain } from '@/lib/sound-level'
import { listVoices, speak, speakableText, voicesForLanguage, type TalkPhase } from '@/lib/speech'
import { useChatStore } from '@/store/chat'

const COLOR_KEY: Record<PresenceColor, MessageKey> = {
  cyan: 'stage.color.cyan',
  violet: 'stage.color.violet',
  amber: 'stage.color.amber',
  emerald: 'stage.color.emerald',
  rose: 'stage.color.rose',
}

const DESIGN_KEY: Record<PresenceDesign, MessageKey> = {
  orb: 'stage.design.orb',
  rings: 'stage.design.rings',
  bars: 'stage.design.bars',
}

/**
 * Loudness for the figure. The microphone drives it while Jarvis listens; a
 * reply drives it while Jarvis speaks. A browser that will not share the mic
 * with recognition still pulses when words arrive.
 */
function useLevel(listening: boolean, heard: string, speaking: boolean): number {
  const [mic, setMic] = useState(0)
  const [pulse, setPulse] = useState({ heard: '', level: 0 })
  const [wave, setWave] = useState(0)

  if (heard !== pulse.heard) setPulse({ heard, level: heard ? 0.72 : 0 })

  useEffect(() => {
    if (!listening) return
    const devices = navigator.mediaDevices
    if (!devices?.getUserMedia || typeof AudioContext === 'undefined') return
    let stopped = false
    let stream: MediaStream | null = null
    let audio: AudioContext | null = null
    let frame = 0
    void devices
      .getUserMedia({ audio: true })
      .then((next) => {
        if (stopped) {
          next.getTracks().forEach((track) => track.stop())
          return
        }
        stream = next
        audio = new AudioContext()
        const analyser = audio.createAnalyser()
        analyser.fftSize = 256
        audio.createMediaStreamSource(next).connect(analyser)
        const samples = new Uint8Array(analyser.fftSize)
        const tick = (): void => {
          if (stopped) return
          analyser.getByteTimeDomainData(samples)
          setMic(levelFromTimeDomain(samples))
          frame = requestAnimationFrame(tick)
        }
        void audio.resume()
        frame = requestAnimationFrame(tick)
      })
      .catch(() => {
        // Recognition already owns the microphone in some browsers.
      })
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
      void audio?.close()
    }
  }, [listening])

  useEffect(() => {
    if (!pulse.level) return
    const id = window.setTimeout(() => setPulse((current) => ({ ...current, level: 0 })), 220)
    return () => window.clearTimeout(id)
  }, [pulse.heard, pulse.level])

  useEffect(() => {
    if (!speaking || prefersReducedMotion()) return
    let frame = 0
    const started = performance.now()
    const tick = (now: number): void => {
      setWave(0.3 + Math.abs(Math.sin((now - started) / 140)) * 0.55)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [speaking])

  const micLevel = listening ? mic : 0
  const waveLevel = !speaking ? 0 : prefersReducedMotion() ? 0.45 : wave
  return Math.min(1, Math.max(micLevel, pulse.level, waveLevel))
}

/** A short ribbon under the figure, so a sound reads even when the shape barely moves. */
function VoiceMeter({ level }: { level: number }) {
  return (
    <div aria-hidden="true" className="flex h-8 items-end justify-center gap-1">
      {Array.from({ length: 9 }, (_, index) => {
        const wave = (Math.sin(index * 0.85 + level * 7) + 1) / 2
        return (
          <span
            key={index}
            className="w-1 rounded-full bg-brand"
            style={{ height: 4 + wave * (6 + level * 22), opacity: 0.35 + level * 0.65 }}
          />
        )
      })}
    </div>
  )
}

function Figure({ design, level }: { design: PresenceDesign; level: number }) {
  const glow = 12 + level * 36
  if (design === 'orb') {
    return (
      <div
        className="grid size-72 place-items-center"
        style={{
          transform: `scale(${1 + level * 0.14})`,
          filter: `drop-shadow(0 0 ${glow}px color-mix(in oklab, var(--brand) 55%, transparent))`,
        }}
      >
        <Orb active size={196} />
      </div>
    )
  }

  if (design === 'bars') {
    return (
      <div className="relative grid size-72 place-items-center">
        {Array.from({ length: 18 }, (_, index) => {
          const swing = (Math.sin(index * 0.7 + level * 8) + 1) / 2
          const height = 16 + swing * (20 + level * 64)
          return (
            <span
              key={index}
              aria-hidden="true"
              className="absolute bottom-1/2 left-1/2 w-1 rounded-full bg-brand"
              style={{
                height,
                transform: `translateX(-50%) rotate(${index * 20}deg)`,
                transformOrigin: 'center 8.5rem',
                opacity: 0.45 + level * 0.55,
              }}
            />
          )
        })}
        <Orb active={level > 0.05} size={112} />
      </div>
    )
  }

  return (
    <div className="relative grid size-72 place-items-center">
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          aria-hidden="true"
          className="presence-ring absolute rounded-full border"
          style={{
            inset: `${20 - index * 5}%`,
            transform: `scale(${1 + level * (0.06 + index * 0.05)})`,
            opacity: 0.28 + level * 0.55,
            animationDelay: `${index * 0.35}s`,
          }}
        />
      ))}
      <span aria-hidden="true" className="presence-scan pointer-events-none absolute inset-x-[28%] h-10" />
      <Orb active size={148} />
    </div>
  )
}

/**
 * The screen a live conversation takes over. Jarvis is the figure in the
 * middle: it swells with the microphone, and it keeps moving while a reply is
 * read aloud. Colour, figure and voice are remembered in this browser.
 */
export function TalkStage({
  phase,
  heard,
  failure,
  onEnd,
}: {
  phase: TalkPhase
  heard: string
  failure: string | null
  onEnd: () => void
}) {
  const t = useT()
  const locale = useLocale((state) => state.locale)
  const messages = useChatStore((state) => state.messages)
  const [presence, setPresence] = useState(readPresence)
  const [voices, setVoices] = useState(listVoices)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onEndRef = useRef(onEnd)
  const level = useLevel(phase === 'listening', heard, phase === 'speaking')
  const palette = PRESENCE_PALETTES[presence.color]
  const choices = voicesForLanguage(voices, speechTag(locale))
  const selected =
    presence.voiceName && choices.some((voice) => voice.name === presence.voiceName) ? presence.voiceName : ''
  const reply = messages.findLast((message) => message.role === 'assistant' && message.content)?.content ?? ''
  const shown = phase === 'listening' ? heard : speakableText(reply)
  const body = shown || t('stage.prompt')
  const eyebrow =
    phase === 'listening'
      ? t('composer.listening')
      : phase === 'speaking'
        ? t('composer.talk.speaking')
        : t('composer.talk.thinking')

  useEffect(() => {
    onEndRef.current = onEnd
  })

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onEndRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const refresh = (): void => setVoices(listVoices())
    refresh()
    const synth = window.speechSynthesis
    if (!synth?.addEventListener) return
    synth.addEventListener('voiceschanged', refresh)
    return () => synth.removeEventListener('voiceschanged', refresh)
  }, [])

  const update = (next: PresencePreference): void => {
    writePresence(next)
    setPresence(next)
  }

  const stage = (
    <div
      ref={dialogRef}
      aria-label={t('stage.title')}
      aria-modal="true"
      className="fixed inset-0 z-50 flex overflow-y-auto bg-background/88 px-4 py-8 backdrop-blur-md"
      role="dialog"
      style={
        {
          '--brand': palette.brand,
          '--brand-secondary': palette.secondary,
          '--color-brand': palette.brand,
          '--color-brand-secondary': palette.secondary,
        } as CSSProperties
      }
      tabIndex={-1}
    >
      <div aria-hidden="true" className="presence-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative mx-auto flex w-full max-w-lg flex-col items-center justify-center gap-6 text-center">
        <Figure design={presence.design} level={level} />
        <VoiceMeter level={level} />
        <div className="space-y-2">
          <p className="text-[0.68rem] font-medium tracking-[0.22em] text-brand uppercase">{eyebrow}</p>
          <p className="text-lg text-pretty text-foreground">{body}</p>
          {failure && <p className="text-sm text-danger">{failure}</p>}
        </div>

        <Disclosure className="w-full text-start">
          <Disclosure.Heading>
            <Disclosure.Trigger className="flex w-full items-center gap-2 rounded-2xl border border-border/70 bg-surface/70 px-4 py-2.5 text-sm">
              {t('stage.appearance')}
              <Disclosure.Indicator className="ms-0" />
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content>
            <Disclosure.Body className="space-y-4 rounded-2xl border border-border/70 bg-surface/60 px-4 py-4">
              <div className="space-y-2">
                <p className="text-xs text-muted">{t('stage.color')}</p>
                <div aria-label={t('stage.color')} className="flex flex-wrap gap-2" role="group">
                  {PRESENCE_COLORS.map((color) => {
                    const swatch = PRESENCE_PALETTES[color]
                    return (
                      <button
                        key={color}
                        aria-label={t(COLOR_KEY[color])}
                        aria-pressed={presence.color === color}
                        className="size-8 rounded-full ring-offset-2 ring-offset-background aria-pressed:ring-2 aria-pressed:ring-foreground"
                        style={{
                          background: `linear-gradient(135deg, ${swatch.brand}, ${swatch.secondary})`,
                        }}
                        type="button"
                        onClick={() => update({ ...presence, color })}
                      />
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted">{t('stage.design')}</p>
                <div aria-label={t('stage.design')} className="flex flex-wrap gap-2" role="group">
                  {PRESENCE_DESIGNS.map((design) => (
                    <Button
                      key={design}
                      aria-pressed={presence.design === design}
                      size="sm"
                      variant={presence.design === design ? 'primary' : 'secondary'}
                      onPress={() => update({ ...presence, design })}
                    >
                      {t(DESIGN_KEY[design])}
                    </Button>
                  ))}
                </div>
              </div>

              <label className="block text-xs text-muted">
                {t('stage.voice')}
                <select
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={selected}
                  onChange={(event) => update({ ...presence, voiceName: event.target.value || null })}
                >
                  <option value="">{t('stage.voice.auto')}</option>
                  {choices.map((voice) => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name}
                    </option>
                  ))}
                </select>
              </label>

              <Button size="sm" variant="ghost" onPress={() => speak(t('stage.sample'), undefined, locale)}>
                {t('stage.preview')}
              </Button>
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>

        <Button className="rounded-full" variant="danger-soft" onPress={onEnd}>
          {t('stage.hangUp')}
        </Button>
      </div>
    </div>
  )

  return createPortal(stage, document.body)
}
