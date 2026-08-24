import { describe, expect, it } from 'vitest'
import { createThinkingClock, splitThoughts } from './reasoning'

describe('splitThoughts', () => {
  it('takes a blank line as the step boundary', () => {
    expect(splitThoughts('First I check the date.\n\nThen I search.')).toEqual([
      'First I check the date.',
      'Then I search.',
    ])
  })

  it('falls back to single newlines when the model left no blank line', () => {
    expect(splitThoughts('Need the sum.\nCall the calculator.\nReport it.')).toEqual([
      'Need the sum.',
      'Call the calculator.',
      'Report it.',
    ])
  })

  it('keeps a wrapped paragraph whole once blank lines are present', () => {
    expect(splitThoughts('The user asked about\nthe weather in Berlin.\n\nSo: search.')).toEqual([
      'The user asked about\nthe weather in Berlin.',
      'So: search.',
    ])
  })

  it('drops the padding a truncated block leaves behind', () => {
    expect(splitThoughts('\n\n  Only one thought.  \n\n\n')).toEqual(['Only one thought.'])
  })

  it('has nothing to show for empty reasoning', () => {
    expect(splitThoughts('')).toEqual([])
    expect(splitThoughts('   \n  \n')).toEqual([])
  })
})

describe('createThinkingClock', () => {
  /** A stream, replayed at whatever times the test says the chunks arrived. */
  function replay(chunks: { at: number; inThinkBlock: boolean }[], readAt: number) {
    let time = 0
    const clock = createThinkingClock(() => time)
    for (const chunk of chunks) {
      time = chunk.at
      clock.observe(chunk.inThinkBlock)
    }
    time = readAt
    return clock
  }

  it('runs from the first token, because the prompt opened the block', () => {
    const clock = replay(
      [
        { at: 100, inThinkBlock: true },
        { at: 900, inThinkBlock: false },
      ],
      5000,
    )

    expect(clock.elapsed()).toBe(800)
  })

  it('stops when the block closes, however long the answer then takes', () => {
    const clock = replay(
      [
        { at: 0, inThinkBlock: true },
        { at: 500, inThinkBlock: false },
        { at: 4000, inThinkBlock: false },
      ],
      9000,
    )

    expect(clock.elapsed()).toBe(500)
  })

  it('sums the block each tool round opens', () => {
    const clock = replay(
      [
        { at: 0, inThinkBlock: true },
        { at: 300, inThinkBlock: false },
        // The next round starts thinking again, from its own open <think>.
        { at: 1000, inThinkBlock: true },
        { at: 1200, inThinkBlock: false },
      ],
      2000,
    )

    expect(clock.elapsed()).toBe(500)
  })

  it('keeps counting a turn that ended mid-thought', () => {
    const clock = replay([{ at: 200, inThinkBlock: true }], 1200)
    expect(clock.elapsed()).toBe(1000)
  })

  it('measures nothing for a turn that never reported a think block', () => {
    expect(replay([{ at: 10, inThinkBlock: false }], 900).elapsed()).toBe(0)
  })
})
