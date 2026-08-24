import { describe, expect, it } from 'vitest'
import { normalizeText, tokenize } from './text'

describe('tokenize', () => {
  it('drops the words every message contains', () => {
    expect(tokenize('What do you know about my flat?')).toEqual(['know', 'flat'])
  })

  it('folds a plural onto its singular, so a question reaches the memory', () => {
    expect(tokenize('Where do I live?')).toEqual(tokenize('Lives in Lisbon').slice(0, 1))
  })

  it('leaves a word that merely ends in a double s alone', () => {
    expect(tokenize('my address')).toEqual(['address'])
  })

  it('has nothing to match on in a message made only of filler', () => {
    expect(tokenize('what about them')).toEqual([])
  })
})

describe('normalizeText', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(normalizeText('  I like TEA.  ')).toBe('i like tea')
  })

  it('keeps every word, unlike tokenize, so a repeat is judged on the whole sentence', () => {
    expect(normalizeText('What about the flat')).toBe('what about the flat')
  })
})
