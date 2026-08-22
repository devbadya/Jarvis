import { describe, expect, it } from 'vitest'
import { parseModelOutput, parsePartial } from './parse'

describe('parseModelOutput', () => {
  it('separates reasoning from the visible answer', () => {
    const result = parseModelOutput('<think>The user greets me.</think>Hello!')
    expect(result.reasoning).toBe('The user greets me.')
    expect(result.content).toBe('Hello!')
    expect(result.toolCalls).toEqual([])
  })

  it('extracts a tool call and removes it from the answer', () => {
    const raw =
      'Let me look that up.\n<tool_call>\n{"name": "web_search", "arguments": {"query": "vite 8"}}\n</tool_call>'
    const result = parseModelOutput(raw)
    expect(result.toolCalls).toEqual([{ name: 'web_search', arguments: { query: 'vite 8' } }])
    expect(result.content).toBe('Let me look that up.')
  })

  it('handles several tool calls in one response', () => {
    const raw =
      '<tool_call>{"name":"a","arguments":{}}</tool_call><tool_call>{"name":"b","arguments":{"x":1}}</tool_call>'
    expect(parseModelOutput(raw).toolCalls).toHaveLength(2)
  })

  it('ignores a tool call whose JSON is malformed', () => {
    const result = parseModelOutput('<tool_call>{"name": broken}</tool_call>ok')
    expect(result.toolCalls).toEqual([])
    expect(result.content).toBe('ok')
  })

  it('tolerates a think block truncated by the token limit', () => {
    const result = parseModelOutput('<think>still reasoning when the budget ran out')
    expect(result.reasoning).toBe('still reasoning when the budget ran out')
    expect(result.content).toBe('')
  })

  it('strips chat-template special tokens', () => {
    expect(parseModelOutput('Answer<|im_end|>').content).toBe('Answer')
  })

  it('defaults missing arguments to an empty object', () => {
    expect(parseModelOutput('<tool_call>{"name":"current_time"}</tool_call>').toolCalls).toEqual([
      { name: 'current_time', arguments: {} },
    ])
  })
})

describe('parsePartial', () => {
  it('reports that reasoning is still open', () => {
    expect(parsePartial('<think>hmm').inThinkBlock).toBe(true)
    expect(parsePartial('<think>hmm</think>done').inThinkBlock).toBe(false)
  })

  it('hides a tool call that is still streaming in', () => {
    expect(parsePartial('Searching now.\n<tool_call>{"name":"web_se').content).toBe('Searching now.')
  })
})
