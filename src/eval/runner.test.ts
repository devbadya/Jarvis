import { describe, expect, it, vi } from 'vitest'
import type { LlmClient } from '@/llm/client'
import { STRATEGIES } from '@/llm/config'
import { builtinTools } from '@/tools/builtins'
import { runEval, summarize, type Attempt } from './runner'
import type { Scenario } from './scenarios'

/** Replays one canned model output per generation round. */
function fakeClient(outputs: string[]): LlmClient {
  let round = 0
  return {
    generate: vi.fn(async () => {
      const text = outputs[round % outputs.length] ?? ''
      round += 1
      return { text, tokens: 20, thinkTokens: 5, durationMs: 100 }
    }),
  } as unknown as LlmClient
}

const arithmetic: Scenario = {
  id: 'arith',
  category: 'arithmetic',
  prompt: 'What is 2 + 2?',
  expectTool: 'calculator',
  accept: (answer) => answer.includes('4'),
}

const chat: Scenario = {
  id: 'chat',
  category: 'no-tool',
  prompt: 'Say hello.',
  expectTool: null,
  accept: (answer) => answer.length > 0,
}

const CALL =
  '</think><tool_call><function=calculator><parameter=expression>2+2</parameter></function></tool_call>'

describe('runEval', () => {
  it('scores the tool choice and the answer separately', async () => {
    const [attempt] = await runEval(fakeClient([CALL, '</think>2 + 2 = 4']), {
      scenarios: [arithmetic],
      strategies: [STRATEGIES.baseline],
      repeats: 1,
      tools: builtinTools,
    })

    expect(attempt?.toolsCalled).toEqual(['calculator'])
    expect(attempt?.routedCorrectly).toBe(true)
    expect(attempt?.answeredCorrectly).toBe(true)
  })

  it('counts a tool call as mis-routed when the scenario wanted none', async () => {
    const [attempt] = await runEval(fakeClient([CALL, '</think>Hello.']), {
      scenarios: [chat],
      strategies: [STRATEGIES.baseline],
      repeats: 1,
      tools: builtinTools,
    })

    // Answering correctly while reaching for a tool it did not need is still a
    // routing failure, and conflating the two would hide it.
    expect(attempt?.routedCorrectly).toBe(false)
    expect(attempt?.answeredCorrectly).toBe(true)
  })

  it('records an invented tool name', async () => {
    const invented =
      '</think><tool_call><function=wolfram><parameter=q>2+2</parameter></function></tool_call>'
    const [attempt] = await runEval(fakeClient([invented, '</think>4']), {
      scenarios: [arithmetic],
      strategies: [STRATEGIES.baseline],
      repeats: 1,
      tools: builtinTools,
    })

    expect(attempt?.hallucinated).toEqual(['wolfram'])
  })

  it('runs every strategy on every scenario, once per repeat', async () => {
    const attempts = await runEval(fakeClient(['</think>ok']), {
      scenarios: [arithmetic, chat],
      strategies: [STRATEGIES.baseline, STRATEGIES.capped],
      repeats: 3,
      tools: builtinTools,
    })

    expect(attempts).toHaveLength(12)
  })

  it('stops between attempts when asked', async () => {
    const attempts = await runEval(fakeClient(['</think>ok']), {
      scenarios: [arithmetic, chat],
      strategies: [STRATEGIES.baseline],
      repeats: 5,
      tools: builtinTools,
      shouldStop: () => true,
    })

    expect(attempts).toEqual([])
  })

  it('records a failed generation instead of aborting the sweep', async () => {
    const client = {
      generate: vi.fn(async () => {
        throw new Error('WebGPU device lost')
      }),
    } as unknown as LlmClient

    const [attempt] = await runEval(client, {
      scenarios: [arithmetic],
      strategies: [STRATEGIES.baseline],
      repeats: 1,
      tools: builtinTools,
    })

    expect(attempt?.error).toBe('WebGPU device lost')
    expect(attempt?.answeredCorrectly).toBe(false)
  })
})

function attempt(overrides: Partial<Attempt>): Attempt {
  return {
    scenarioId: 'x',
    category: 'arithmetic',
    strategyId: 'baseline',
    repeat: 0,
    toolsCalled: [],
    hallucinated: [],
    answer: '',
    routedCorrectly: false,
    answeredCorrectly: false,
    thinkTokens: 0,
    tokens: 0,
    durationMs: 0,
    ...overrides,
  }
}

describe('summarize', () => {
  it('reports each strategy separately', () => {
    const summaries = summarize([
      attempt({ strategyId: 'a', routedCorrectly: true }),
      attempt({ strategyId: 'b', routedCorrectly: false }),
    ])

    expect(summaries.map((summary) => summary.strategyId)).toEqual(['a', 'b'])
    expect(summaries[0]?.routing).toBe(1)
    expect(summaries[1]?.routing).toBe(0)
  })

  it('takes the median think tokens, so one runaway turn does not set the number', () => {
    const summaries = summarize([
      attempt({ thinkTokens: 10 }),
      attempt({ thinkTokens: 12 }),
      attempt({ thinkTokens: 900 }),
    ])

    expect(summaries[0]?.medianThinkTokens).toBe(12)
  })

  it('breaks results down by category', () => {
    const summaries = summarize([
      attempt({ category: 'arithmetic', answeredCorrectly: true }),
      attempt({ category: 'no-tool', answeredCorrectly: false }),
    ])

    expect(summaries[0]?.byCategory).toEqual([
      { category: 'arithmetic', attempts: 1, routing: 0, answers: 1 },
      { category: 'no-tool', attempts: 1, routing: 0, answers: 0 },
    ])
  })

  it('returns nothing for no results rather than dividing by zero', () => {
    expect(summarize([])).toEqual([])
  })
})
