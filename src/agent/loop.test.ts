import { describe, expect, it, vi } from 'vitest'
import type { LlmClient } from '@/llm/client'
import { defineTool } from '@/tools/types'
import { runAgent } from './loop'
import type { AgentCallbacks } from './loop'

/** Replays canned model outputs, one per generation round. */
function fakeClient(outputs: string[]): LlmClient {
  let round = 0
  return {
    generate: vi.fn(async () => {
      const text = outputs[round] ?? ''
      round += 1
      return { text, tokens: 10, durationMs: 100 }
    }),
  } as unknown as LlmClient
}

function callbacks(): AgentCallbacks {
  return { onPartial: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(), onRoundEnd: vi.fn() }
}

const turns = [{ role: 'user' as const, content: 'hi' }]

describe('runAgent', () => {
  it('keeps reasoning separate when the model states an answer', async () => {
    const result = await runAgent(fakeClient(['thought</think>The answer is teal.']), turns, [], callbacks())

    expect(result.content).toBe('The answer is teal.')
    expect(result.reasoning).toBe('thought')
  })

  it('answers with the reasoning when the model never leaves the think block', async () => {
    const result = await runAgent(fakeClient(['Your colour is teal.</think>']), turns, [], callbacks())

    // Otherwise the reply renders empty and the history gains an empty turn.
    expect(result.content).toBe('Your colour is teal.')
    expect(result.reasoning).toBe('')
  })

  it('leaves reasoning alone on a round that requests a tool', async () => {
    const toolCall =
      'need maths</think><tool_call><function=calculator><parameter=expression>2+2</parameter></function></tool_call>'
    const execute = vi.fn(async () => '4')
    const calculator = defineTool('calculator', 'maths', { type: 'object', properties: {} }, execute)
    const hooks = callbacks()

    const result = await runAgent(fakeClient([toolCall, 'done</think>2 + 2 = 4']), turns, [calculator], hooks)

    expect(execute).toHaveBeenCalledWith({ expression: '2+2' })
    expect(result.content).toBe('2 + 2 = 4')
    // The first round had no visible content, but its reasoning must not become an answer.
    expect(hooks.onRoundEnd).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ content: '', reasoning: 'need maths' }),
    )
  })
})
