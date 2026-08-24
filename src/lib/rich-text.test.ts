import { describe, expect, it } from 'vitest'
import { parseBlocks, parseSpans, type Span } from './rich-text'

/** Every skill exemplar ends this way, so it is the case that matters most. */
const SOURCED_ANSWER =
  'Ama Osei, chief executive since 2023.\n\nSource: https://fictionalairways.example/leadership'

function links(spans: Span[]): string[] {
  return spans.filter((span) => span.type === 'link').map((span) => span.href)
}

describe('parseSpans', () => {
  it('makes a bare URL a link', () => {
    expect(parseSpans('See https://example.com/pricing for the plans')).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'link', href: 'https://example.com/pricing', text: 'https://example.com/pricing' },
      { type: 'text', text: ' for the plans' },
    ])
  })

  it('leaves the sentence its full stop', () => {
    const spans = parseSpans('Read https://example.com/pricing.')
    expect(links(spans)).toEqual(['https://example.com/pricing'])
    expect(spans.at(-1)).toEqual({ type: 'text', text: '.' })
  })

  it('keeps a bracket the URL opened and drops one it did not', () => {
    expect(links(parseSpans('https://en.wikipedia.org/wiki/Mercury_(planet)'))).toEqual([
      'https://en.wikipedia.org/wiki/Mercury_(planet)',
    ])
    expect(links(parseSpans('(see https://example.com/a)'))).toEqual(['https://example.com/a'])
  })

  it('reads a labelled link without also matching its target', () => {
    expect(parseSpans('[the docs](https://example.com/docs)')).toEqual([
      { type: 'link', href: 'https://example.com/docs', text: 'the docs' },
    ])
  })

  it('reads bold and inline code', () => {
    expect(parseSpans('Run `pnpm check` before **pushing**')).toEqual([
      { type: 'text', text: 'Run ' },
      { type: 'code', text: 'pnpm check' },
      { type: 'text', text: ' before ' },
      { type: 'strong', text: 'pushing' },
    ])
  })

  it('leaves markup inside a code span alone', () => {
    expect(parseSpans('`**not bold**`')).toEqual([{ type: 'code', text: '**not bold**' }])
  })

  it('does not read arithmetic as emphasis', () => {
    expect(parseSpans('17 * 23 * 2 = 782')).toEqual([{ type: 'text', text: '17 * 23 * 2 = 782' }])
  })

  it('never produces a link the model could choose the scheme of', () => {
    const spans = parseSpans('[click](javascript:alert(1)) and javascript:alert(2)')
    expect(links(spans)).toEqual([])
  })
})

describe('parseBlocks', () => {
  it('links the source line every skill asks the model to end with', () => {
    const blocks = parseBlocks(SOURCED_ANSWER)

    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toMatchObject({ type: 'paragraph' })
    expect(links(blocks[1]?.type === 'paragraph' ? blocks[1].spans : [])).toEqual([
      'https://fictionalairways.example/leadership',
    ])
  })

  it('groups consecutive bullets into one list', () => {
    const blocks = parseBlocks('Plans:\n- Free\n- Team\n- Enterprise')

    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toEqual({
      type: 'list',
      ordered: false,
      items: [
        [{ type: 'text', text: 'Free' }],
        [{ type: 'text', text: 'Team' }],
        [{ type: 'text', text: 'Enterprise' }],
      ],
    })
  })

  it('tells a numbered list from a bulleted one', () => {
    const blocks = parseBlocks('1. First\n2. Second\n- Unordered')

    expect(blocks.map((block) => block.type === 'list' && block.ordered)).toEqual([true, false])
  })

  it('reads a fenced code block with its language', () => {
    const blocks = parseBlocks('Try:\n```ts\nconst a = 1\n\nconst b = 2\n```\nDone')

    expect(blocks[1]).toEqual({ type: 'code', language: 'ts', text: 'const a = 1\n\nconst b = 2' })
    expect(blocks[2]).toMatchObject({ type: 'paragraph' })
  })

  it('treats a fence still streaming in as code', () => {
    expect(parseBlocks('```\nconst half =')).toEqual([{ type: 'code', language: '', text: 'const half =' }])
  })

  it('does not mistake a bold line opener for a bullet', () => {
    expect(parseBlocks('**Note**: read this')).toEqual([
      {
        type: 'paragraph',
        spans: [
          { type: 'strong', text: 'Note' },
          { type: 'text', text: ': read this' },
        ],
      },
    ])
  })

  it('keeps the soft line breaks inside a paragraph', () => {
    expect(parseBlocks('one\ntwo')).toEqual([
      { type: 'paragraph', spans: [{ type: 'text', text: 'one\ntwo' }] },
    ])
  })

  it('has nothing to render for empty content', () => {
    expect(parseBlocks('')).toEqual([])
  })
})
