import { describe, expect, it, vi } from 'vitest'
import type { LlmClient } from '@/llm/client'
import { MAX_TOOL_ROUNDS } from '@/llm/config'
import { defineTool, type Tool } from '@/tools/types'
import { FINAL_ANSWER_PROMPT, windDownNote } from './budget'
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

  it('stops calling tools after the round budget rather than looping', async () => {
    const search = defineTool(
      'web_search',
      'search',
      { type: 'object', properties: {} },
      async () => 'nothing',
    )
    const execute = vi.spyOn(search, 'execute')
    // Every round rephrases and searches again, including the one that cannot.
    const client = fakeClient(
      Array.from({ length: 8 }, (_, round) => toolCall('web_search', 'query', `attempt ${round}`)),
    )

    await runAgent(client, turns, [search], callbacks())

    expect(execute).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS)
    // One generation per tool round, plus the wind-down round that has to answer.
    expect(client.generate).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1)
  })
})

describe('running out of tool rounds', () => {
  const nothing = 'No results for "again".'

  function searching(result = nothing): Tool {
    return defineTool('web_search', 'search', { type: 'object', properties: {} }, async () => result)
  }

  /**
   * Spends the whole budget on searches, then whatever the wind-down round says.
   * The query is rephrased each round, as the transcript this was written for
   * did: an identical repeat is caught before it costs a round.
   */
  function outOfRounds(...windDown: string[]): string[] {
    return [
      ...Array.from({ length: MAX_TOOL_ROUNDS }, (_, round) =>
        toolCall('web_search', 'query', `attempt ${round}`),
      ),
      ...windDown,
    ]
  }

  it('answers from what the tools returned instead of giving up', async () => {
    const client = fakeClient(outOfRounds('enough</think>Nothing I searched names him.'))

    const result = await runAgent(client, turns, [searching()], callbacks())

    expect(result.content).toBe('Nothing I searched names him.')
    expect(result.windDown).toBe(true)
  })

  it('withholds the tools on that round, so no call format is offered at all', async () => {
    const client = fakeClient(outOfRounds('enough</think>Nothing I searched names him.'))

    await runAgent(client, turns, [searching()], callbacks())

    const rounds = vi.mocked(client.generate).mock.calls
    expect(rounds[0]?.[1]).toHaveLength(1)
    expect(rounds[MAX_TOOL_ROUNDS]?.[1]).toEqual([])
  })

  it('warns the model while it still has a round to spend', async () => {
    const client = fakeClient(outOfRounds('enough</think>Nothing I searched names him.'))

    await runAgent(client, turns, [searching()], callbacks())

    // Every call gets the same conversation array, so this reads its final state.
    const conversation = vi.mocked(client.generate).mock.calls[0]?.[0] ?? []
    const said = conversation.map((turn) => turn.content)
    expect(said).toContain(windDownNote(1))
    // The note is only useful before the last round, and the demand for an
    // answer only after it.
    expect(said.indexOf(windDownNote(1))).toBeLessThan(said.indexOf(FINAL_ANSWER_PROMPT))
    expect(conversation.at(-1)?.content).toBe(FINAL_ANSWER_PROMPT)
  })

  it('runs no tool the model asks for once they are gone', async () => {
    const search = searching()
    const execute = vi.spyOn(search, 'execute')
    const client = fakeClient(outOfRounds(toolCall('web_search', 'query', 'one more')))

    await runAgent(client, turns, [search], callbacks())

    expect(execute).not.toHaveBeenCalledWith({ query: 'one more' })
    expect(execute).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS)
  })

  it('does not spend a round on a search it has already run', async () => {
    const search = searching()
    const execute = vi.spyOn(search, 'execute')
    // Four rounds of the identical query, then the same again with tools gone.
    const client = fakeClient(Array(6).fill(toolCall('web_search', 'query', 'again')))

    const result = await runAgent(client, turns, [search], callbacks())

    expect(execute).toHaveBeenCalledTimes(1)
    expect(result.windDown).toBe(true)
  })

  it('hands over the sources it found when that round produces nothing', async () => {
    const client = fakeClient(outOfRounds(''))

    const result = await runAgent(client, turns, [searching(searchResult)], callbacks())

    expect(result.content).toContain('could not settle on an answer')
    expect(result.content).toContain('https://fictionalairways.example/leadership')
    expect(result.windDown).toBe(true)
  })

  it('leaves a turn that answers on its own untouched', async () => {
    const client = fakeClient([toolCall('web_search', 'query', 'again'), 'read it</think>Nothing found.'])

    const result = await runAgent(client, turns, [searching()], callbacks())

    const said = (vi.mocked(client.generate).mock.calls[0]?.[0] ?? []).map((turn) => turn.content)
    expect(said).not.toContain(FINAL_ANSWER_PROMPT)
    expect(said).not.toContain(windDownNote(1))
    expect(result.windDown).toBeUndefined()
  })
})

describe('a tool asked for twice with the same arguments', () => {
  const search = defineTool(
    'web_search',
    'search',
    { type: 'object', properties: {} },
    async () => 'No results for "sergej kunz".',
  )

  it('is run once, and the model is told the result has not changed', async () => {
    const execute = vi.spyOn(search, 'execute')
    const client = fakeClient([
      toolCall('web_search', 'query', 'sergej kunz'),
      toolCall('web_search', 'query', ' Sergej  Kunz '),
      'no more ideas</think>I could not find him.',
    ])

    await runAgent(client, turns, [search], callbacks())

    expect(execute).toHaveBeenCalledTimes(1)
    const conversation = vi.mocked(client.generate).mock.calls[0]?.[0] ?? []
    expect(conversation.at(-1)?.content).toContain('was already called')
    // The result itself comes back with it, not just a complaint about the repeat.
    expect(conversation.at(-1)?.content).toContain('No results for "sergej kunz".')
  })

  it('shows the repeat in the transcript rather than hiding the round', async () => {
    const hooks = callbacks()
    const client = fakeClient([
      toolCall('web_search', 'query', 'sergej kunz'),
      toolCall('web_search', 'query', 'sergej kunz'),
      'no more ideas</think>I could not find him.',
    ])

    await runAgent(client, turns, [search], hooks)

    expect(hooks.onToolStart).toHaveBeenCalledTimes(2)
    expect(hooks.onToolEnd).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({ result: expect.stringContaining('was already called') as string }),
    )
  })

  it('runs the clock again, because the same place a minute later is a new reading', async () => {
    const clock = defineTool(
      'current_time',
      'clock',
      { type: 'object', properties: {} },
      async () => 'Germany — 22:40 CEST (UTC+2, Europe/Berlin), Thu 27 Aug 2026',
    )
    const execute = vi.spyOn(clock, 'execute')
    const client = fakeClient([
      toolCall('current_time', 'place', 'Germany'),
      toolCall('current_time', 'place', 'Germany'),
      'done</think>In Germany it is 22:41 CEST.',
    ])

    await runAgent(client, turns, [clock], callbacks())

    expect(execute).toHaveBeenCalledTimes(2)
    const conversation = vi.mocked(client.generate).mock.calls[0]?.[0] ?? []
    expect(conversation.some((turn) => turn.content.includes('was already called'))).toBe(false)
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
