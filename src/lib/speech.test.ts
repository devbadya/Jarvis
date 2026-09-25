import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendDictation,
  canListen,
  canSpeak,
  claimSpokenReply,
  describeTalk,
  listeningLanguage,
  pickVoice,
  readSpeakReplies,
  resetSpokenClaims,
  speak,
  speakableText,
  speechLanguage,
  transcriptFrom,
  unansweredNotice,
  writeSpeakReplies,
  type VoiceLike,
} from './speech'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  resetSpokenClaims()
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

describe('listeningLanguage', () => {
  it('follows the browser before anyone has written anything', () => {
    expect(listeningLanguage(undefined, 'fr-FR')).toBe('fr-FR')
    expect(listeningLanguage('', '')).toBe('en-US')
  })

  it('follows the language of the last message once there is one', () => {
    expect(listeningLanguage('Wie viel ist 7 mal 8?', 'en-US')).toBe('de-DE')
    expect(listeningLanguage('What is the weather in Berlin?', 'de-DE')).toBe('en-US')
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

  it('picks a German voice for a German reply', () => {
    expect(speechLanguage('Berlin ist die Hauptstadt von Deutschland.')).toBe('de-DE')
    expect(speechLanguage('Paris is the capital of France.')).toBe('en-US')
  })
})

describe('describeTalk', () => {
  it('names the phase, and the words only while they are still being heard', () => {
    expect(describeTalk('idle', 'hello')).toBeNull()
    expect(describeTalk('listening', '')).toBe('Listening…')
    expect(describeTalk('listening', ' Wie spät ')).toBe('Listening… Wie spät')
    expect(describeTalk('thinking', '')).toBe('Jarvis is thinking')
    expect(describeTalk('speaking', '')).toBe('Jarvis is speaking')
  })
})

describe('unansweredNotice', () => {
  it('follows the language of the question that failed', () => {
    expect(unansweredNotice('Wie spät ist es?')).toBe('Darauf konnte ich nicht antworten.')
    expect(unansweredNotice('What time is it?')).toBe('I could not answer that.')
  })
})

describe('pickVoice', () => {
  const anna: VoiceLike = { lang: 'de-DE', name: 'Anna', localService: true }
  const natural: VoiceLike = { lang: 'de-DE', name: 'German Natural', localService: false }
  const samantha: VoiceLike = { lang: 'en-US', name: 'Samantha', localService: true, default: true }

  it('picks a voice that speaks the reply, and a natural one over a plain one', () => {
    expect(pickVoice([samantha, anna, natural], 'de-DE')).toBe(natural)
    expect(pickVoice([samantha, anna], 'de-DE')).toBe(anna)
    expect(pickVoice([samantha], 'de-DE')).toBeNull()
  })

  it('prefers an installed natural voice, then an exact locale', () => {
    const installed: VoiceLike = { lang: 'de-DE', name: 'Hedda Natural', localService: true }
    const generic: VoiceLike = { lang: 'de', name: 'German', localService: true }
    expect(pickVoice([natural, installed], 'de-DE')).toBe(installed)
    expect(pickVoice([generic, anna], 'de-DE')).toBe(anna)
  })
})

describe('claimSpokenReply', () => {
  it('lets a conversation take over a reply the toggle had claimed', () => {
    expect(claimSpokenReply('a', 'toggle')).toBe(true)
    expect(claimSpokenReply('a', 'toggle')).toBe(false)
    expect(claimSpokenReply('a', 'conversation')).toBe(true)
    expect(claimSpokenReply('a', 'conversation')).toBe(false)
    expect(claimSpokenReply('b', 'conversation')).toBe(true)
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

  it('uses a voice that speaks the reply rather than the default', () => {
    const german = { lang: 'de-DE', name: 'German Natural', localService: false }
    const english = { lang: 'en-US', name: 'Samantha', localService: true, default: true }
    const synthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
      paused: false,
      getVoices: () => [english, german],
    }
    class Utterance {
      text: string
      lang = ''
      voice: unknown = null
      constructor(text: string) {
        this.text = text
      }
    }
    vi.stubGlobal('speechSynthesis', synthesis)
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)

    const utterance = speak('Berlin ist schön.')

    expect(utterance?.voice).toBe(german)
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
