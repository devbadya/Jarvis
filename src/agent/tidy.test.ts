import { describe, expect, it } from 'vitest'
import { collapseRepeats } from './tidy'

describe('collapseRepeats', () => {
  it('takes a repetition loop down to one saying of it', () => {
    const looped = [
      'Früher war er Oppositionsführer, jetzt ist er Bundeskanzler. Er ist 70 Jahre alt.',
      'Früher war er Oppositionsführer, jetzt ist er Bundeskanzler. Er ist 70 Jahre alt.',
      'Er ist 70 Jahre alt.',
      'Er ist 70 Jahre alt.',
      'Er ist',
    ].join('\n\n')

    expect(collapseRepeats(looped)).toBe(
      'Früher war er Oppositionsführer, jetzt ist er Bundeskanzler. Er ist 70 Jahre alt.\n\nEr ist 70 Jahre alt.',
    )
  })

  it('says a sentence repeated in a row once', () => {
    expect(collapseRepeats('Es ist 22:53 Uhr. Es ist 22:53 Uhr. Schönen Abend!')).toBe(
      'Es ist 22:53 Uhr. Schönen Abend!',
    )
  })

  it('leaves a reply with no repeat exactly as it was', () => {
    const reply =
      'Erstens: früh ins Bett.\n\n\nZweitens: kein Kaffee am Abend.\n\nQuelle: https://example.com'
    expect(collapseRepeats(reply)).toBe(reply)
  })

  it('leaves verse alone, where a repeated line is the point', () => {
    const poem = 'Der Regen fällt,\nder Regen fällt,\nund still wird die Welt.'
    expect(collapseRepeats(poem)).toBe(poem)
  })
})
