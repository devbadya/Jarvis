import { afterEach, describe, expect, it } from 'vitest'
import { readPresence, writePresence } from './presence'

afterEach(() => localStorage.clear())

describe('the Jarvis presence', () => {
  it('starts as rings in cyan, with the language choosing the voice', () => {
    expect(readPresence()).toEqual({ design: 'rings', color: 'cyan', voiceName: null })
  })

  it('remembers a colour, a figure and a voice', () => {
    writePresence({ design: 'bars', color: 'violet', voiceName: 'Anna' })
    expect(readPresence()).toEqual({ design: 'bars', color: 'violet', voiceName: 'Anna' })
  })

  it('ignores a stored value it does not know', () => {
    localStorage.setItem('jarvis.presence', JSON.stringify({ design: 'cube', color: 'neon', voiceName: '' }))
    expect(readPresence()).toEqual({ design: 'rings', color: 'cyan', voiceName: null })
  })
})
