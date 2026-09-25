import { splitSources } from './sources'
import { speechTag, type Locale, type MessageKey } from '@/i18n'

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
export function speak(
  content: string,
  onEnd?: () => void,
  locale: Locale = 'en',
): SpeechSynthesisUtterance | null {
  if (!canSpeak()) return null
  const text = speakableText(content)
  if (!text) return null
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = speechLanguage(content, locale)
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
