import { describe, expect, it, vi } from 'vitest'
import type { LlmClient } from '@/llm/client'
import { MAX_TOOL_ROUNDS } from '@/llm/config'
import { defineTool } from '@/tools/types'
import { collectEvidence } from './review'
import { runAgent } from './loop'
import type { AgentCallbacks } from './loop'

/** Replays canned model outputs, one per generation round. */
function fakeClient(outputs: string[]): LlmClient {
  let round = 0
  return {
    generate: vi.fn(async () => {
      const text = outputs[round] ?? ''
      round += 1
      return { text, tokens: 10, thinkTokens: 4, durationMs: 100 }
    }),
  } as unknown as LlmClient
}

function callbacks(): AgentCallbacks {
  return {
    onPartial: vi.fn(),
    onToolStart: vi.fn(),
    onToolEnd: vi.fn(),
    onRoundEnd: vi.fn(),
    onCorrection: vi.fn(),
  }
}

const turns = [{ role: 'user' as const, content: 'hi' }]

function toolCall(name: string, parameter: string, value: string): string {
  return `thinking</think><tool_call><function=${name}><parameter=${parameter}>${value}</parameter></function></tool_call>`
}

const searchResult =
  '1. Leadership — Fictional Airways\n   https://fictionalairways.example/leadership\n   Ama Osei leads it.'

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

  it('gives up after the tool round budget rather than looping', async () => {
    const search = defineTool(
      'web_search',
      'search',
      { type: 'object', properties: {} },
      async () => 'nothing',
    )
    const client = fakeClient(Array(6).fill(toolCall('web_search', 'query', 'again')))

    const result = await runAgent(client, turns, [search], callbacks())

    expect(client.generate).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS)
    expect(result.content).toContain(`limit of ${MAX_TOOL_ROUNDS} tool rounds`)
  })
})

describe('checking the answer before returning it', () => {
  const search = defineTool(
    'web_search',
    'search',
    { type: 'object', properties: {} },
    async () => searchResult,
  )
  const calculator = defineTool(
    'calculator',
    'maths',
    { type: 'object', properties: {} },
    async () => '6748 * 9 = 60732',
  )

  it('returns an answer that passes untouched, at no extra cost', async () => {
    const client = fakeClient(['done</think>Paris is the capital of France.'])

    const result = await runAgent(client, turns, [], callbacks())

    expect(client.generate).toHaveBeenCalledTimes(1)
    expect(result.content).toBe('Paris is the capital of France.')
    expect(result.review).toEqual({ found: [], corrected: false })
  })

  it('sends a sourceless answer back and returns the corrected one', async () => {
    const client = fakeClient([
      toolCall('web_search', 'query', 'Fictional Airways chief executive'),
      'read it</think>Ama Osei has led the airline since 2023.',
      'adding the source</think>Ama Osei has led the airline since 2023.\n\nSource: https://fictionalairways.example/leadership',
    ])

    const result = await runAgent(client, turns, [search], callbacks())

    expect(result.content).toContain('Source: https://fictionalairways.example/leadership')
    expect(result.review).toEqual({ found: ['missing-source'], corrected: true })
  })

  it('hands the model the draft and the fix, not a request to look for one', async () => {
    const client = fakeClient([
      toolCall('web_search', 'query', 'Fictional Airways chief executive'),
      'read it</think>Ama Osei has led the airline since 2023.',
      'ok</think>Ama Osei.\n\nSource: https://fictionalairways.example/leadership',
    ])

    await runAgent(client, turns, [search], callbacks())

    // Every call gets the same conversation array, so this reads its final state.
    const conversation = vi.mocked(client.generate).mock.calls[0]?.[0] ?? []
    expect(conversation.at(-2)).toEqual({
      role: 'assistant',
      content: 'Ama Osei has led the airline since 2023.',
    })
    expect(conversation.at(-1)?.content).toBe(
      'The answer cites no source. End it with "Source: https://fictionalairways.example/leadership". ' +
        'Reply with the corrected answer only.',
    )
  })

  it('corrects a number the answer did not take from the calculator', async () => {
    const client = fakeClient([
      toolCall('calculator', 'expression', '6748 * 9'),
      'in my head</think>That is roughly 60,000.',
      'reading the tool</think>6748 × 9 = 60,732.',
    ])

    const result = await runAgent(client, turns, [calculator], callbacks())

    expect(result.content).toBe('6748 × 9 = 60,732.')
    expect(result.review).toEqual({ found: ['wrong-number'], corrected: true })
  })

  it('keeps the draft when the correction fixes nothing', async () => {
    const client = fakeClient([
      toolCall('web_search', 'query', 'Fictional Airways chief executive'),
      'read it</think>Ama Osei has led the airline since 2023.',
      'no change</think>Ama Osei runs the airline.',
    ])

    const result = await runAgent(client, turns, [search], callbacks())

    // Neither answer cites anything, so replacing one with the other would risk
    // a worse reply for nothing.
    expect(result.content).toBe('Ama Osei has led the airline since 2023.')
    expect(result.review).toEqual({ found: ['missing-source'], corrected: false })
  })

  it('takes a half-fixed correction but does not call it corrected', async () => {
    const both = `thinking</think>${[
      '<tool_call><function=calculator><parameter=expression>6748 * 9</parameter></function></tool_call>',
      '<tool_call><function=web_search><parameter=query>6748 times 9</parameter></function></tool_call>',
    ].join('')}`
    const client = fakeClient([
      both,
      'guessing</think>About 60,000, per https://wikipedia.org/Maths',
      'number fixed</think>6748 × 9 = 60,732, per https://wikipedia.org/Maths',
    ])

    const result = await runAgent(client, turns, [calculator, search], callbacks())

    // Two problems, one fixed: the better answer is shown, and the label names
    // what is still wrong with it rather than claiming a clean bill of health.
    expect(result.content).toContain('60,732')
    expect(result.review).toEqual({ found: ['invented-source'], corrected: false })
  })

  it('keeps the draft when the correction comes back empty', async () => {
    const client = fakeClient([
      toolCall('web_search', 'query', 'Fictional Airways chief executive'),
      'read it</think>Ama Osei has led the airline since 2023.',
      '',
    ])

    const result = await runAgent(client, turns, [search], callbacks())

    expect(result.content).toBe('Ama Osei has led the airline since 2023.')
    expect(result.review?.corrected).toBe(false)
  })

  it('corrects once and then stops', async () => {
    const client = fakeClient([
      toolCall('web_search', 'query', 'Fictional Airways chief executive'),
      'read it</think>Ama Osei has led the airline since 2023.',
      'still nothing</think>Ama Osei, since 2023.',
      'and again</think>Ama Osei.',
    ])

    await runAgent(client, turns, [search], callbacks())

    expect(client.generate).toHaveBeenCalledTimes(3)
  })

  it('says why the reply the user is watching is about to change', async () => {
    const hooks = callbacks()
    const client = fakeClient([
      toolCall('web_search', 'query', 'Fictional Airways chief executive'),
      'read it</think>Ama Osei has led the airline since 2023.',
      'fixed</think>Ama Osei.\n\nSource: https://fictionalairways.example/leadership',
    ])

    await runAgent(client, turns, [search], hooks)

    expect(hooks.onCorrection).toHaveBeenCalledWith(['missing-source'])
  })

  it('treats a URL copied out of a worked example as an invention', async () => {
    // The turns a skill composes begin with its exemplars, and repeating their
    // URLs instead of citing what was fetched is a failure a model this size
    // makes. So the evidence comes from the real conversation, passed in.
    const exemplar = 'Ama Osei.\n\nSource: https://exemplar.example/leadership'
    const composed = [
      { role: 'user' as const, content: 'Who is the chief executive of Fictional Airways?' },
      { role: 'assistant' as const, content: exemplar },
      ...turns,
    ]
    const client = fakeClient([
      toolCall('web_search', 'query', 'Fictional Airways chief executive'),
      'copying the example</think>Ama Osei.\n\nSource: https://exemplar.example/leadership',
      'using what came back</think>Ama Osei.\n\nSource: https://fictionalairways.example/leadership',
    ])

    const result = await runAgent(client, composed, [search], callbacks(), {
      evidence: collectEvidence(turns),
    })

    expect(result.review).toEqual({ found: ['invented-source'], corrected: true })
    expect(result.content).toContain('https://fictionalairways.example/leadership')
  })

  it('can be switched off so the eval can measure what it is worth', async () => {
    const client = fakeClient([
      toolCall('web_search', 'query', 'Fictional Airways chief executive'),
      'read it</think>Ama Osei has led the airline since 2023.',
    ])

    const result = await runAgent(client, turns, [search], callbacks(), { review: false })

    expect(client.generate).toHaveBeenCalledTimes(2)
    expect(result.content).toBe('Ama Osei has led the airline since 2023.')
  })
})
