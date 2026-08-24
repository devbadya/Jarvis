import { describe, expect, it } from 'vitest'
import { domainOf, labelSources, splitSources } from './sources'

describe('splitSources', () => {
  it('lifts the citation line every skill asks for out of the answer', () => {
    expect(splitSources('Ama Osei.\n\nSource: https://example.com/who')).toEqual({
      body: 'Ama Osei.',
      sources: ['https://example.com/who'],
    })
  })

  it('takes several URLs off one line', () => {
    const { sources } = splitSources('Two of them.\n\nSources: https://a.example/x https://b.example/y')
    expect(sources).toEqual(['https://a.example/x', 'https://b.example/y'])
  })

  it('reads the label through the emphasis an instruct model adds', () => {
    expect(splitSources('Berlin, 14°C.\n\n**Source:** https://example.com/weather').sources).toEqual([
      'https://example.com/weather',
    ])
  })

  it('gives the sentence back its full stop', () => {
    expect(splitSources('Yes.\n\nSource: https://example.com/pricing.').sources).toEqual([
      'https://example.com/pricing',
    ])
  })

  it('lists a repeated URL once', () => {
    expect(splitSources('Both agree.\n\nSources: https://a.example/x, https://a.example/x').sources).toEqual([
      'https://a.example/x',
    ])
  })

  it('leaves a sentence that only starts like a citation where it is', () => {
    const text = 'It is 14°C.\n\nSource: my own recollection, which you should not trust.'
    expect(splitSources(text)).toEqual({ body: text, sources: [] })
  })

  it('leaves a URL in the middle of the reply inline', () => {
    const text = 'See https://example.com/docs for the details.'
    expect(splitSources(text)).toEqual({ body: text, sources: [] })
  })

  it('leaves a reply that is nothing but its citation alone', () => {
    // Lifting the only line out would leave pills where the answer should be.
    const text = 'Source: https://example.com/who'
    expect(splitSources(text)).toEqual({ body: text, sources: [] })
  })

  it('says nothing about a reply with no citation at all', () => {
    expect(splitSources('42')).toEqual({ body: '42', sources: [] })
    expect(splitSources('')).toEqual({ body: '', sources: [] })
  })
})

describe('labelSources', () => {
  it('names a citation by its site', () => {
    expect(labelSources(['https://www.example.com/a/b'])).toEqual([
      { url: 'https://www.example.com/a/b', label: 'example.com' },
    ])
  })

  it('adds the page when two citations share a site', () => {
    expect(
      labelSources(['https://example.com/ai-act/summary', 'https://example.com/ai-act/template']),
    ).toEqual([
      { url: 'https://example.com/ai-act/summary', label: 'example.com/summary' },
      { url: 'https://example.com/ai-act/template', label: 'example.com/template' },
    ])
  })

  it('leaves different sites short', () => {
    expect(labelSources(['https://a.example/x', 'https://b.example/y']).map((one) => one.label)).toEqual([
      'a.example',
      'b.example',
    ])
  })

  it('falls back to the query when two links differ only there', () => {
    expect(
      labelSources(['https://example.com/?q=one', 'https://example.com/?q=two']).map((s) => s.label),
    ).toEqual(['example.com/q=one', 'example.com/q=two'])
  })
})

describe('domainOf', () => {
  it('names the host without its www', () => {
    expect(domainOf('https://www.example.com/a/b?c=d')).toBe('example.com')
  })

  it('falls back to the URL when it cannot be parsed', () => {
    expect(domainOf('not a url')).toBe('not a url')
  })
})
