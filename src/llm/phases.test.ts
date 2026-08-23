import { describe, expect, it } from 'vitest'
import { parseModelOutput } from '@/agent/parse'
import { closeReasoning, splitReasoning } from './phases'

describe('closeReasoning', () => {
  it('closes a block the budget cut off mid-sentence', () => {
    const { text, appended } = closeReasoning('I should multiply these so I will')

    expect(text).toBe('I should multiply these so I will\n</think>')
    expect(appended).toBe('</think>')
  })

  it('leaves a block the model closed itself alone', () => {
    const { text, appended } = closeReasoning('Simple enough.</think>The answer is four.')

    expect(text).toBe('Simple enough.</think>The answer is four.')
    expect(appended).toBe('')
  })
})

describe('splitReasoning', () => {
  it('treats everything before the marker as reasoning', () => {
    expect(splitReasoning('thinking</think>answering')).toEqual({
      reasoning: 'thinking',
      rest: 'answering',
    })
  })

  it('treats an unclosed block as all reasoning', () => {
    expect(splitReasoning('still thinking')).toEqual({ reasoning: 'still thinking', rest: '' })
  })
})

describe('the two-phase output', () => {
  it('parses as reasoning plus a tool call once the phases are joined', () => {
    // What the worker hands back: a truncated reasoning trace it closed itself,
    // followed by whatever the second pass generated.
    const reasoning = closeReasoning('Tool needed: calculator, because 98765 * 4321 is')
    const answer =
      '<tool_call><function=calculator><parameter=expression>98765 * 4321</parameter></function></tool_call>'
    const parsed = parseModelOutput(reasoning.text + answer)

    expect(parsed.reasoning).toBe('Tool needed: calculator, because 98765 * 4321 is')
    expect(parsed.toolCalls).toEqual([{ name: 'calculator', arguments: { expression: '98765 * 4321' } }])
    expect(parsed.content).toBe('')
  })

  it('keeps the routing preamble in the reasoning trace, not the answer', () => {
    const reasoning = closeReasoning('Tool needed: none')
    const parsed = parseModelOutput(`${reasoning.text}Paris.`)

    expect(parsed.reasoning).toBe('Tool needed: none')
    expect(parsed.content).toBe('Paris.')
  })
})
