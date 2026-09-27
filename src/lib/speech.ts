import { readPresence } from './presence'
import { splitSources } from './sources'
import { speechTag, translate, type Locale, type MessageKey } from '@/i18n'

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

const TALK_LABELS = {
  listening: 'Listening…',
  thinking: 'Jarvis is thinking',
  speaking: 'Jarvis is speaking',
}

/** What the composer says while a conversation is in that phase. */
export function describeTalk(
  phase: TalkPhase,
  heard: string,
  labels: { listening: string; thinking: string; speaking: string } = TALK_LABELS,
): string | null {
  switch (phase) {
    case 'listening': {
      const words = heard.trim()
      return words ? `${labels.listening} ${words}` : labels.listening
    }
    case 'thinking':
      return labels.thinking
    case 'speaking':
      return labels.speaking
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

/** The recogniser's error codes, as the message key a person would find useful. */
export function failureKey(error?: string): MessageKey {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'dictation.refused'
    case 'audio-capture':
      return 'dictation.noMicrophone'
    case 'no-speech':
      return 'dictation.nothingHeard'
    case 'network':
      return 'dictation.network'
    default:
      return 'dictation.stopped'
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

/**
 * The voice a reply is read in.
 *
 * The chosen language is the only one. A reply that came out in another
 * language is still read with the voice for the choice, because that is the
 * language the reply was supposed to be in.
 */
export function speechLanguage(_content: string, locale: Locale = 'en'): string {
  return speechTag(locale)
}

/** A short spoken line when a turn failed, in the language that was chosen. */
export function unansweredNotice(locale: Locale = 'en'): string {
  return translate(locale, 'composer.talk.unanswered')
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
 * An installed voice for the language wins, and a natural one among those.
 * A voice the browser fetches is used only when nothing installed speaks it.
 */
export function pickVoice<T extends VoiceLike>(voices: readonly T[], lang: string): T | null {
  const matching = voices.filter((voice) => languageMatches(voice.lang, lang))
  if (matching.length === 0) return null
  const local = matching.filter((voice) => voice.localService)
  const pool = local.length > 0 ? local : matching
  const score = (voice: T): number => {
    const code = voice.lang.toLowerCase().replace('_', '-')
    const wanted = lang.toLowerCase().replace('_', '-')
    let value = 0
    if (code === wanted) value += 2
    if (NATURAL_VOICE.test(voice.name)) value += 8
    if (voice.default) value += 1
    if (COMPACT_VOICE.test(voice.name)) value -= 6
    return value
  }
  return [...pool].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))[0] ?? null
}

/** Voices that speak `lang`, in name order, for the presence menu. */
export function voicesForLanguage<T extends VoiceLike>(voices: readonly T[], lang: string): T[] {
  return voices
    .filter((voice) => languageMatches(voice.lang, lang))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The voice the presence menu asked for, when it still speaks this language.
 * Otherwise the same choice `pickVoice` would make.
 */
export function resolveVoice<T extends VoiceLike>(
  voices: readonly T[],
  lang: string,
  preferredName?: string | null,
): T | null {
  if (preferredName) {
    const named = voices.find((voice) => voice.name === preferredName && languageMatches(voice.lang, lang))
    if (named) return named
  }
  return pickVoice(voices, lang)
}

/** Deeper and a little slower, so the default does not sound like the browser's own voice. */
export const JARVIS_PITCH = 0.84
export const JARVIS_RATE = 0.94

const JARVIS_NAMED =
  /\b(daniel|alex|aaron|fred|stefan|steffan|conrad|markus|hans|david|guy|ryan|thomas|rishi|george|male)\b/i
const LIGHTER_NAMED = /\b(female|samantha|anna|hedda|katja|zira|victoria|serena|susan|karen|moira)\b/i

/**
 * Jarvis's own voice for this language: an installed one when the device has
 * it, and a deeper name when several do. Pitch and rate then pull it further
 * from the browser default.
 */
export function pickJarvisVoice<T extends VoiceLike>(voices: readonly T[], lang: string): T | null {
  const matching = voices.filter((voice) => languageMatches(voice.lang, lang))
  if (matching.length === 0) return null
  const wanted = lang.toLowerCase().replace('_', '-')
  const score = (voice: T): number => {
    const code = voice.lang.toLowerCase().replace('_', '-')
    let value = 0
    if (code === wanted) value += 3
    if (voice.localService) value += 8
    if (JARVIS_NAMED.test(voice.name)) value += 12
    if (NATURAL_VOICE.test(voice.name)) value += 2
    if (LIGHTER_NAMED.test(voice.name)) value -= 4
    if (COMPACT_VOICE.test(voice.name)) value -= 8
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

/** Voices the browser will actually speak with. Empty where synthesis is missing. */
export function listVoices(): SpeechSynthesisVoice[] {
  return availableVoices()
}

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

function resumeSynth(synth: SpeechSynthesis): void {
  if (typeof synth.resume === 'function') synth.resume()
}

/**
 * Chrome drops an utterance that is spoken in the same turn as `cancel()`,
 * and a reply that starts long after the click is dropped too unless the
 * engine was primed during that click. The gap lets the cancellation finish.
 */
export const SPEAK_GAP_MS = 100

export type SpeechOutcome = 'ended' | 'failed'

let speakGeneration = 0
let pendingSpeak = 0

function clearPendingSpeak(): void {
  if (!pendingSpeak) return
  window.clearTimeout(pendingSpeak)
  pendingSpeak = 0
}

/**
 * Primes the speech engine from the click that starts a conversation.
 * Volume 0 keeps the primer itself silent. A later reply can then be heard
 * even though it no longer rides that click.
 */
export function warmSpeech(): void {
  if (!canSpeak()) return
  const synth = window.speechSynthesis
  if (typeof synth.getVoices === 'function') synth.getVoices()
  resumeSynth(synth)
  const primer = new SpeechSynthesisUtterance(' ')
  primer.volume = 0
  synth.speak(primer)
}

function applyDelivery(utterance: SpeechSynthesisUtterance, voices: readonly SpeechSynthesisVoice[]): void {
  const preference = readPresence()
  const named = preference.voiceName
    ? (voices.find(
        (voice) => voice.name === preference.voiceName && languageMatches(voice.lang, utterance.lang),
      ) ?? null)
    : null
  if (named) {
    utterance.voice = named
    utterance.pitch = 1
    utterance.rate = 1
  } else {
    utterance.voice = pickJarvisVoice(voices, utterance.lang)
    utterance.pitch = JARVIS_PITCH
    utterance.rate = JARVIS_RATE
  }
  utterance.volume = 1
}

/** Chrome fills `getVoices()` only after `voiceschanged`. Speaking before that stays silent. */
const VOICE_WAIT_MS = 600
let releaseVoiceWait: (() => void) | null = null

function cancelVoiceWait(): void {
  releaseVoiceWait?.()
  releaseVoiceWait = null
}

function withVoices(
  synth: SpeechSynthesis,
  generation: number,
  done: (voices: SpeechSynthesisVoice[]) => void,
): void {
  const read = (): SpeechSynthesisVoice[] => (typeof synth.getVoices === 'function' ? synth.getVoices() : [])
  const ready = read()
  if (ready.length > 0 || typeof synth.addEventListener !== 'function') {
    done(ready)
    return
  }
  let settled = false
  const finish = (): void => {
    if (settled) return
    settled = true
    cancelVoiceWait()
    if (generation !== speakGeneration) return
    done(read())
  }
  const onChange = (): void => {
    if (read().length > 0) finish()
  }
  const timer = window.setTimeout(finish, VOICE_WAIT_MS)
  synth.addEventListener('voiceschanged', onChange)
  releaseVoiceWait = () => {
    window.clearTimeout(timer)
    synth.removeEventListener('voiceschanged', onChange)
  }
}

/**
 * Speaks a reply and resolves when it has finished or been cut off. Anything
 * already speaking is stopped first: two replies at once are noise.
 */
export function speak(
  content: string,
  onEnd?: (outcome: SpeechOutcome) => void,
  locale: Locale = 'en',
): SpeechSynthesisUtterance | null {
  if (!canSpeak()) return null
  const text = speakableText(content)
  if (!text) return null
  const synth = window.speechSynthesis
  const generation = ++speakGeneration
  clearPendingSpeak()
  cancelVoiceWait()
  synth.cancel()
  clearKeepAlive()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = speechLanguage(content, locale)
  let finished = false
  let started = false
  let retried = false
  const finish = (outcome: SpeechOutcome): void => {
    if (finished || generation !== speakGeneration) return
    finished = true
    clearKeepAlive()
    onEnd?.(outcome)
  }
  const enqueue = (fallback: boolean): void => {
    if (generation !== speakGeneration) return
    const deliver = (voices: readonly SpeechSynthesisVoice[]): void => {
      if (generation !== speakGeneration) return
      if (fallback) utterance.voice = null
      else applyDelivery(utterance, voices)
      resumeSynth(synth)
      synth.speak(utterance)
      resumeSynth(synth)
      armKeepAlive()
    }
    if (fallback) deliver([])
    else withVoices(synth, generation, deliver)
  }
  utterance.onstart = () => {
    started = true
  }
  utterance.onend = () => finish('ended')
  utterance.onerror = (event) => {
    const code = event.error
    if ((code === 'interrupted' || code === 'canceled') && started) {
      finish('ended')
      return
    }
    if (!retried) {
      retried = true
      clearPendingSpeak()
      pendingSpeak = window.setTimeout(() => {
        pendingSpeak = 0
        enqueue(true)
      }, SPEAK_GAP_MS)
      return
    }
    finish('failed')
  }
  pendingSpeak = window.setTimeout(() => {
    pendingSpeak = 0
    enqueue(false)
  }, SPEAK_GAP_MS)
  return utterance
}

export function stopSpeaking(): void {
  speakGeneration += 1
  clearPendingSpeak()
  cancelVoiceWait()
  clearKeepAlive()
  if (!canSpeak()) return
  window.speechSynthesis.cancel()
}
