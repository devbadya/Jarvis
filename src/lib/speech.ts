import { splitSources } from './sources'
import { queryLanguage } from '@/tools/web'

/**
 * Voice in and voice out, on what the browser already ships.
 *
 * Recognition is the browser's own `SpeechRecognition`. In Chrome and Edge the
 * audio goes to the browser vendor's service and the text comes back, so this
 * is the one input path that leaves the tab — the microphone button says so.
 * Synthesis is `speechSynthesis`, which uses the voices installed on the device.
 *
 * Neither is available in every browser, and neither exists in jsdom, so
 * everything here is a plain function that can be tested for the decision it
 * makes rather than the sound it produces.
 */

const SPEAK_ALOUD_KEY = 'jarvis.speak-replies'

/** How long a pause, after a finished phrase, before it is sent. */
export const TURN_PAUSE_MS = 900

export type TalkPhase = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface TalkActivity {
  phase: TalkPhase
  heard: string
  failure: string | null
}

/** What the composer says while a conversation is in that phase. */
export function describeTalk(phase: TalkPhase, heard: string): string | null {
  switch (phase) {
    case 'listening': {
      const words = heard.trim()
      return words ? `Listening… ${words}` : 'Listening…'
    }
    case 'thinking':
      return 'Jarvis is thinking'
    case 'speaking':
      return 'Jarvis is speaking'
    default:
      return null
  }
}

export interface RecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: RecognitionResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

export interface RecognitionResultEvent {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

type RecognitionConstructor = new () => RecognitionLike

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const candidate = window as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null
}

export function canListen(): boolean {
  return recognitionConstructor() !== null
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}

/**
 * The language a recognition session should listen in.
 *
 * The browser's own language is the best available guess before anyone has
 * spoken. Once a message exists, the language it was written in is better.
 */
export function listeningLanguage(lastMessage?: string, browserLanguage = navigator.language): string {
  if (lastMessage?.trim()) return queryLanguage(lastMessage) === 'de' ? 'de-DE' : 'en-US'
  return browserLanguage || 'en-US'
}

/** The words spoken so far, final and interim together, from one result event. */
export function transcriptFrom(event: RecognitionResultEvent): { finalText: string; interimText: string } {
  let finalText = ''
  let interimText = ''
  for (let index = 0; index < event.results.length; index++) {
    const result = event.results[index]
    if (!result) continue
    const alternative = result[0]
    const text = alternative?.transcript ?? ''
    if (result.isFinal) finalText += text
    else interimText += text
  }
  return { finalText: finalText.trim(), interimText: interimText.trim() }
}

/** A draft plus dictated words, with exactly one space between them. */
export function appendDictation(draft: string, dictated: string): string {
  const spoken = dictated.trim()
  if (!spoken) return draft
  const base = draft.replace(/\s+$/, '')
  return base ? `${base} ${spoken}` : spoken
}

/** The recogniser's error codes, said the way a person would find useful. */
export function describeFailure(error?: string): string {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was refused.'
    case 'audio-capture':
      return 'No microphone was found.'
    case 'no-speech':
      return 'Nothing was heard.'
    case 'network':
      return 'The speech service could not be reached.'
    default:
      return 'Dictation stopped.'
  }
}

export function createRecognition(lang: string, options?: { continuous?: boolean }): RecognitionLike | null {
  const Recognition = recognitionConstructor()
  if (!Recognition) return null
  const recognition = new Recognition()
  recognition.lang = lang
  recognition.interimResults = true
  recognition.continuous = options?.continuous ?? false
  return recognition
}

/**
 * What a reply sounds like read aloud: the prose without the markup a screen
 * shows and a listener does not need — the citation line, code fences, list
 * bullets, bold markers and bare URLs.
 */
export function speakableText(content: string): string {
  const { body } = splitSources(content)
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

/** German function words a reply of any length will contain; `queryLanguage` is tuned for questions. */
const GERMAN_PROSE =
  /\b(der|die|das|und|ist|nicht|ich|sie|mit|ein|eine|auf|für|von|dem|den|auch|noch|wird|sind|habe|hat|kann|bei|nach|wie|oder|aber|wenn|dass)\b/gi
const ENGLISH_PROSE =
  /\b(the|and|is|not|you|with|for|of|to|in|that|this|are|was|have|has|can|will|it|on|at|from|be|or|but|if|which|what)\b/gi

export function speechLanguage(content: string): string {
  if (queryLanguage(content) === 'de') return 'de-DE'
  const german = content.match(GERMAN_PROSE)?.length ?? 0
  const english = content.match(ENGLISH_PROSE)?.length ?? 0
  return german > english ? 'de-DE' : 'en-US'
}

/** A short spoken line when a turn failed, in the language the person was using. */
export function unansweredNotice(sample?: string): string {
  return speechLanguage(sample ?? '') === 'de-DE'
    ? 'Darauf konnte ich nicht antworten.'
    : 'I could not answer that.'
}

export interface VoiceLike {
  lang: string
  name: string
  localService?: boolean
  default?: boolean
}

const NATURAL_VOICE = /natural|premium|enhanced|neural|wavenet/i
const COMPACT_VOICE = /compact|espeak/i

function languageMatches(voiceLang: string, wanted: string): boolean {
  const code = voiceLang.toLowerCase().replace('_', '-')
  const target = wanted.toLowerCase().replace('_', '-')
  const prefix = target.slice(0, 2)
  return code === target || code === prefix || code.startsWith(`${prefix}-`)
}

/**
 * The voice a reply should be read in.
 *
 * Setting `utterance.lang` alone leaves the browser's default voice, which
 * reads a German answer in an English accent whenever that default is English.
 * An installed voice wins over one the browser fetches, and a natural voice
 * wins over a basic one — a flat installed voice is worse than a natural one
 * the browser supplies.
 */
export function pickVoice<T extends VoiceLike>(voices: readonly T[], lang: string): T | null {
  const matching = voices.filter((voice) => languageMatches(voice.lang, lang))
  if (matching.length === 0) return null
  const score = (voice: T): number => {
    const code = voice.lang.toLowerCase().replace('_', '-')
    const wanted = lang.toLowerCase().replace('_', '-')
    let value = 0
    if (code === wanted) value += 2
    if (voice.localService) value += 3
    if (NATURAL_VOICE.test(voice.name)) value += 8
    if (voice.default) value += 1
    if (COMPACT_VOICE.test(voice.name)) value -= 6
    return value
  }
  return [...matching].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))[0] ?? null
}

/**
 * One reply is spoken by one owner. A live conversation takes a reply the
 * header toggle already claimed, because it has to know when the voice
 * finishes so it can listen again. The toggle does not take it back.
 */
let claimedReplyId: string | null = null
let claimedByConversation = false

export function claimSpokenReply(id: string, owner: 'conversation' | 'toggle'): boolean {
  if (claimedReplyId === id) {
    if (owner === 'conversation' && !claimedByConversation) {
      claimedByConversation = true
      return true
    }
    return false
  }
  claimedReplyId = id
  claimedByConversation = owner === 'conversation'
  return true
}

export function resetSpokenClaims(): void {
  claimedReplyId = null
  claimedByConversation = false
}

export function readSpeakReplies(): boolean {
  try {
    return localStorage.getItem(SPEAK_ALOUD_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeSpeakReplies(enabled: boolean): void {
  try {
    localStorage.setItem(SPEAK_ALOUD_KEY, String(enabled))
  } catch {
    // A preference that cannot be stored still applies to this tab.
  }
}

let voiceCache: SpeechSynthesisVoice[] = []
let voicesHooked = false
let cachedSynth: SpeechSynthesis | null = null
let keepAlive = 0

function availableVoices(): SpeechSynthesisVoice[] {
  if (!canSpeak() || typeof window.speechSynthesis.getVoices !== 'function') return []
  const synth = window.speechSynthesis
  // A new synth (a test stub, a reloaded page) does not inherit the previous list.
  if (cachedSynth !== synth) {
    cachedSynth = synth
    voiceCache = []
    voicesHooked = false
  }
  const live = synth.getVoices()
  if (live.length > 0) voiceCache = live
  if (!voicesHooked && typeof synth.addEventListener === 'function') {
    voicesHooked = true
    synth.addEventListener('voiceschanged', () => {
      const next = synth.getVoices()
      if (next.length > 0) voiceCache = next
    })
  }
  return voiceCache
}

function clearKeepAlive(): void {
  if (!keepAlive) return
  window.clearInterval(keepAlive)
  keepAlive = 0
}

/**
 * Chrome pauses `speechSynthesis` after about fifteen seconds and never
 * resumes it. Nudging it keeps a long reply from stopping mid-sentence.
 */
function armKeepAlive(): void {
  clearKeepAlive()
  const synth = window.speechSynthesis
  if (typeof synth.pause !== 'function' || typeof synth.resume !== 'function') return
  keepAlive = window.setInterval(() => {
    if (!synth.speaking) {
      clearKeepAlive()
      return
    }
    synth.pause()
    synth.resume()
  }, 10_000)
}

/**
 * Speaks a reply and resolves when it has finished or been cut off. Anything
 * already speaking is stopped first: two replies at once are noise.
 */
export function speak(content: string, onEnd?: () => void): SpeechSynthesisUtterance | null {
  if (!canSpeak()) return null
  const text = speakableText(content)
  if (!text) return null
  const synth = window.speechSynthesis
  synth.cancel()
  clearKeepAlive()
  if (synth.paused && typeof synth.resume === 'function') synth.resume()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = speechLanguage(content)
  const voice = pickVoice(availableVoices(), utterance.lang)
  if (voice) utterance.voice = voice
  let finished = false
  const finish = (): void => {
    if (finished) return
    finished = true
    clearKeepAlive()
    onEnd?.()
  }
  utterance.onend = finish
  utterance.onerror = finish
  synth.speak(utterance)
  armKeepAlive()
  return utterance
}

export function stopSpeaking(): void {
  if (!canSpeak()) return
  clearKeepAlive()
  window.speechSynthesis.cancel()
}
