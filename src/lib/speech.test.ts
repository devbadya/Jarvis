import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendDictation,
  canListen,
  canSpeak,
  claimSpokenReply,
  describeTalk,
  JARVIS_PITCH,
  JARVIS_RATE,
  pickJarvisVoice,
  pickVoice,
  readSpeakReplies,
  resolveVoice,
  resetSpokenClaims,
  SPEAK_GAP_MS,
  speak,
  speakableText,
  speechLanguage,
  stopSpeaking,
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

  it('reads every reply in the chosen language', () => {
    expect(speechLanguage('Berlin ist die Hauptstadt von Deutschland.')).toBe('en-US')
    expect(speechLanguage('Paris is the capital of France.', 'de')).toBe('de-DE')
    expect(speechLanguage('42', 'de')).toBe('de-DE')
    expect(speechLanguage('42')).toBe('en-US')
    expect(speechLanguage('bonjour', 'fr')).toBe('fr-FR')
    expect(speechLanguage('こんにちは', 'ja')).toBe('ja-JP')
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
  it('follows the language that was chosen', () => {
    expect(unansweredNotice('de')).toBe('Darauf konnte ich nicht antworten.')
    expect(unansweredNotice('en')).toBe('I could not answer that.')
    expect(unansweredNotice('fr')).toBe('I could not answer that.')
  })
})

describe('pickVoice', () => {
  const anna: VoiceLike = { lang: 'de-DE', name: 'Anna', localService: true }
  const natural: VoiceLike = { lang: 'de-DE', name: 'German Natural', localService: false }
  const samantha: VoiceLike = { lang: 'en-US', name: 'Samantha', localService: true, default: true }

  it('picks an installed voice for the language, and a fetched one only when none is installed', () => {
    expect(pickVoice([samantha, anna, natural], 'de-DE')).toBe(anna)
    expect(pickVoice([samantha, natural], 'de-DE')).toBe(natural)
    expect(pickVoice([samantha], 'de-DE')).toBeNull()
  })

  it('prefers an installed natural voice, then an exact locale', () => {
    const installed: VoiceLike = { lang: 'de-DE', name: 'Hedda Natural', localService: true }
    const generic: VoiceLike = { lang: 'de', name: 'German', localService: true }
    expect(pickVoice([natural, installed], 'de-DE')).toBe(installed)
    expect(pickVoice([generic, anna], 'de-DE')).toBe(anna)
  })

  it('uses a named voice when it speaks the language, and otherwise the usual pick', () => {
    expect(resolveVoice([anna, natural, samantha], 'de-DE', 'German Natural')).toBe(natural)
    expect(resolveVoice([anna, samantha], 'de-DE', 'Samantha')).toBe(anna)
    expect(resolveVoice([anna, samantha], 'de-DE', null)).toBe(anna)
  })

  it('gives Jarvis a deeper installed voice when the device has one', () => {
    const stefan: VoiceLike = { lang: 'de-DE', name: 'Stefan', localService: true }
    const hedda: VoiceLike = { lang: 'de-DE', name: 'Hedda', localService: true }
    const remote: VoiceLike = { lang: 'de-DE', name: 'Google Deutsch', localService: false }
    expect(pickJarvisVoice([hedda, remote, stefan], 'de-DE')).toBe(stefan)
    expect(pickJarvisVoice([hedda, remote], 'de-DE')).toBe(hedda)
    expect(pickJarvisVoice([samantha], 'de-DE')).toBeNull()
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

function waitForSpeech(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SPEAK_GAP_MS + 30))
}

describe('speak', () => {
  it('returns null where there is nothing to speak with', () => {
    expect(speak('Hello')).toBeNull()
  })

  it('cancels what was speaking and speaks the cleaned reply in the chosen language', async () => {
    const synthesis = { cancel: vi.fn(), speak: vi.fn() }
    class Utterance {
      text: string
      lang = ''
      pitch = 1
      rate = 1
      volume = 1
      constructor(text: string) {
        this.text = text
      }
    }
    vi.stubGlobal('speechSynthesis', synthesis)
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)

    const utterance = speak('Berlin ist **schön**.\nSource: https://example.com', undefined, 'de')

    expect(synthesis.cancel).toHaveBeenCalledOnce()
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(utterance?.text).toBe('Berlin ist schön.')
    expect(utterance?.lang).toBe('de-DE')

    await waitForSpeech()
    expect(synthesis.speak).toHaveBeenCalledWith(utterance)
    expect(utterance?.pitch).toBe(JARVIS_PITCH)
    expect(utterance?.rate).toBe(JARVIS_RATE)
  })

  it('uses Jarvis pitch with a voice for the language, and a chosen voice as it is', async () => {
    const german = { lang: 'de-DE', name: 'German Natural', localService: false }
    const stefan = { lang: 'de-DE', name: 'Stefan', localService: true }
    const english = { lang: 'en-US', name: 'Samantha', localService: true, default: true }
    const synthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
      paused: false,
      getVoices: () => [english, german, stefan],
    }
    class Utterance {
      text: string
      lang = ''
      voice: unknown = null
      pitch = 1
      rate = 1
      volume = 1
      constructor(text: string) {
        this.text = text
      }
    }
    vi.stubGlobal('speechSynthesis', synthesis)
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)

    const jarvis = speak('Berlin ist schön.', undefined, 'de')
    await waitForSpeech()
    expect(jarvis?.voice).toBe(stefan)
    expect(jarvis?.pitch).toBe(JARVIS_PITCH)
    expect(jarvis?.lang).toBe('de-DE')

    localStorage.setItem(
      'jarvis.presence',
      JSON.stringify({ design: 'rings', color: 'cyan', voiceName: 'German Natural' }),
    )
    const chosen = speak('Berlin ist schön.', undefined, 'de')
    await waitForSpeech()
    expect(chosen?.voice).toBe(german)
    expect(chosen?.pitch).toBe(1)
  })

  it('stays quiet when stopped before the reply is spoken', async () => {
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

    speak('Hello', undefined, 'en')
    stopSpeaking()
    await waitForSpeech()
    expect(synthesis.speak).not.toHaveBeenCalled()
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
