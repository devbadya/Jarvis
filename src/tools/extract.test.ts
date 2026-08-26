import { describe, expect, it } from 'vitest'
import { MAX_PAGE_CHARS, pageExtract, queryTerms, rankPassages, splitPassages } from './extract'

/** A page in the shape the reader returns one: chrome, then an article. */
const PAGE = `![Image 1: logo](https://example.com/logo.png)

[Home](https://example.com/)
[News](https://example.com/news)
[About](https://example.com/about)

Cookies

We use cookies. Accept all

# The Eiffel Tower

## Construction

Construction began in January 1887 and the tower was completed in March 1889 for the World's Fair.

## Visiting

The lift runs from 09:30 until 23:00 in summer, and tickets cost 29.40 euro for the top floor.

## Related articles

[The Statue of Liberty](https://example.com/liberty)

Advertisement`

describe('splitPassages', () => {
  it('drops the site and keeps the page', () => {
    const passages = splitPassages(PAGE)

    expect(passages.join('\n')).not.toMatch(/logo|Home|Accept all|Advertisement|Statue of Liberty/)
    expect(passages.some((passage) => passage.includes('1887'))).toBe(true)
  })

  it('keeps a heading with the paragraph under it', () => {
    // A heading alone matches a question and answers nothing; attached, it is the
    // context for the paragraph that does answer it.
    const construction = splitPassages(PAGE).find((passage) => passage.includes('1887'))

    expect(construction).toContain('## Construction')
  })

  it('keeps a sentence about cookies in an article about cookies', () => {
    // The chrome list only applies to short lines, or a page about cookie law
    // would lose its subject.
    const passages = splitPassages(
      'The 2002 directive made cookies a matter of consent across the European Union, which changed how sites are built.',
    )

    expect(passages).toHaveLength(1)
  })

  it('drops a navigation strip repeated on every screen', () => {
    expect(splitPassages('Menu\n\nMenu\n\nMenu')).toEqual([])
  })
})

describe('rankPassages', () => {
  const passages = splitPassages(PAGE)

  it('puts the passage about the question first', () => {
    const [best] = rankPassages(passages, 'When was the Eiffel Tower built?')

    expect(best?.text).toContain('1887')
  })

  it('ranks a different question onto a different passage', () => {
    const [best] = rankPassages(passages, 'What do tickets cost?')

    expect(best?.text).toContain('29.40')
  })

  it('scores nothing when the page and the question share no word', () => {
    expect(rankPassages(passages, 'Wie ist das Wetter in Hamburg?')).toEqual([])
  })

  it('ignores a term the whole page uses', () => {
    // Inverse document frequency, measured over this page: a word in every
    // passage cannot distinguish between them, whatever the question asks.
    const repeated = ['Alpha carries the word tower.', 'Beta carries the word tower and 1887.']
    const [best] = rankPassages(repeated, 'tower 1887')

    expect(best?.text).toContain('Beta')
  })
})

describe('pageExtract', () => {
  it('returns a short page whole, minus its furniture', () => {
    const extracted = pageExtract(PAGE, 'When was it built?')

    expect(extracted).toContain('1887')
    expect(extracted).toContain('29.40')
    expect(extracted).not.toContain('Accept all')
    expect(extracted).not.toContain('Shortened')
  })

  /**
   * The case this exists for: the answer is past the cap, so a head-first
   * truncation cannot see it however large the cap is.
   */
  describe('a page longer than the budget', () => {
    const filler = Array.from(
      { length: 200 },
      (_, index) => `Paragraph ${index} of general history, describing the period at some length.`,
    ).join('\n\n')
    const buried = `${filler}\n\nThe tower was completed in March 1889 and cost 7.8 million francs.\n\n${filler}`

    it('finds the answer the old truncation cut off', () => {
      const extracted = pageExtract(buried, 'What did the tower cost?')

      expect(buried.slice(0, MAX_PAGE_CHARS)).not.toContain('7.8 million')
      expect(extracted).toContain('7.8 million')
      expect(extracted.length).toBeLessThanOrEqual(MAX_PAGE_CHARS)
    })

    it('says that it left something out', () => {
      expect(pageExtract(buried, 'What did the tower cost?')).toContain('[Shortened')
    })

    it('marks where passages were skipped', () => {
      // Two answers, far apart, with several thousand characters of history in
      // between: the gap is what tells the model it is not reading a whole page.
      const twice = `${filler}\n\nThe tower cost 7.8 million francs.\n\n${filler}\n\nThe tower cost 40 million to repaint.\n\n${filler}`
      const extracted = pageExtract(twice, 'What did the tower cost?')

      expect(extracted).toContain('7.8 million')
      expect(extracted).toContain('40 million')
      expect(extracted).toContain('[…]')
    })

    it('spends what is left over on the paragraphs either side of the answer', () => {
      // A long page, one matching paragraph, and budget to spare: the sentence
      // that continues the answer is worth more than the unused characters.
      const short = `Paragraph before.\n\nThe tower cost 7.8 million francs.\n\nThat figure is in 1889 money.\n\n${filler}`
      const extracted = pageExtract(short, 'What did the tower cost?', 400)

      expect(extracted).toContain('7.8 million')
      expect(extracted).toContain('1889 money')
    })

    it('falls back to the head when there is no question', () => {
      const extracted = pageExtract(buried)

      expect(extracted).toContain('Paragraph 0')
      expect(extracted).toContain('[Truncated')
      expect(extracted.length).toBeLessThanOrEqual(MAX_PAGE_CHARS + 60)
    })

    it('falls back to the head when the question matches nothing on the page', () => {
      const extracted = pageExtract(buried, 'Wetter Hamburg Regenwahrscheinlichkeit')

      expect(extracted).toContain('Paragraph 0')
      expect(extracted).toContain('[Truncated')
    })
  })
})

describe('queryTerms', () => {
  it('keeps what a question is about and drops what every question has', () => {
    expect(queryTerms('What did the tower cost?')).toEqual(['tower', 'cost'])
    expect(queryTerms('Wie hoch ist der Eiffelturm?')).toEqual(['hoch', 'eiffelturm'])
  })

  it('keeps short acronyms and numbers, which the other tokenizers drop', () => {
    expect(queryTerms('Who leads the UN in 2026?')).toEqual(['leads', 'un', '2026'])
  })
})
