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

export function createRecognition(lang: string): RecognitionLike | null {
  const Recognition = recognitionConstructor()
  if (!Recognition) return null
  const recognition = new Recognition()
  recognition.lang = lang
  recognition.interimResults = true
  recognition.continuous = false
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

/**
 * Speaks a reply and resolves when it has finished or been cut off. Anything
 * already speaking is stopped first: two replies at once are noise.
 */
export function speak(content: string, onEnd?: () => void): SpeechSynthesisUtterance | null {
  if (!canSpeak()) return null
  const text = speakableText(content)
  if (!text) return null
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = speechLanguage(content)
  if (onEnd) {
    utterance.onend = onEnd
    utterance.onerror = onEnd
  }
  window.speechSynthesis.speak(utterance)
  return utterance
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel()
}
