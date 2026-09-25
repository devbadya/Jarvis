import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendDictation,
  canListen,
  canSpeak,
  readSpeakReplies,
  speak,
  speakableText,
  speechLanguage,
  transcriptFrom,
  writeSpeakReplies,
} from './speech'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('capability checks', () => {
  it('says no where the browser has no speech API, as jsdom has none', () => {
    expect(canListen()).toBe(false)
    expect(canSpeak()).toBe(false)
  })

  it('finds the prefixed recogniser Chrome ships', () => {
    vi.stubGlobal('webkitSpeechRecognition', class {})
    expect(canListen()).toBe(true)
  })
})

describe('transcriptFrom', () => {
  it('separates final words from the ones still being recognised', () => {
    const results = [
      Object.assign([{ transcript: 'Open ' }], { isFinal: true }),
      Object.assign([{ transcript: 'Safari' }], { isFinal: false }),
    ]
    expect(transcriptFrom({ resultIndex: 0, results })).toEqual({ finalText: 'Open', interimText: 'Safari' })
  })
})

describe('appendDictation', () => {
  it('joins dictated words to the draft with one space', () => {
    expect(appendDictation('', 'hello')).toBe('hello')
    expect(appendDictation('Hello ', 'there')).toBe('Hello there')
    expect(appendDictation('Hello', '   ')).toBe('Hello')
  })
})

describe('speakableText', () => {
  it('drops the citation line, code fences, bullets and URLs', () => {
    const reply = [
      'Paris is the **capital** of France.',
      '- one',
      '2. two',
      '```js',
      'console.log(1)',
      '```',
      'See https://example.com for more.',
      'Source: https://en.wikipedia.org/wiki/Paris',
    ].join('\n')
    expect(speakableText(reply)).toBe('Paris is the capital of France.\none\ntwo\nSee for more.')
  })

  it('picks the voice of the reply, and the chosen language when the reply gives nothing away', () => {
    expect(speechLanguage('Berlin ist die Hauptstadt von Deutschland.')).toBe('de-DE')
    expect(speechLanguage('Paris is the capital of France.', 'de')).toBe('en-US')
    expect(speechLanguage('42', 'de')).toBe('de-DE')
    expect(speechLanguage('42')).toBe('en-US')
  })
})

describe('speak', () => {
  it('returns null where there is nothing to speak with', () => {
    expect(speak('Hello')).toBeNull()
  })

  it('cancels what was speaking and speaks the cleaned reply in its language', () => {
    const synthesis = { cancel: vi.fn(), speak: vi.fn() }
    class Utterance {
      text: string
      lang = ''
      constructor(text: string) {
        this.text = text
      }
    }
    vi.stubGlobal('speechSynthesis', synthesis)
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)

    const utterance = speak('Berlin ist **schön**.\nSource: https://example.com')

    expect(synthesis.cancel).toHaveBeenCalledOnce()
    expect(synthesis.speak).toHaveBeenCalledWith(utterance)
    expect(utterance?.text).toBe('Berlin ist schön.')
    expect(utterance?.lang).toBe('de-DE')
  })
})

describe('the read-aloud preference', () => {
  it('is off until switched on, and remembered once it is', () => {
    expect(readSpeakReplies()).toBe(false)
    writeSpeakReplies(true)
    expect(readSpeakReplies()).toBe(true)
    writeSpeakReplies(false)
    expect(readSpeakReplies()).toBe(false)
  })
})
