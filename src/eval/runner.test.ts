import { describe, expect, it, vi } from 'vitest'
import type { LlmClient } from '@/llm/client'
import { STRATEGIES } from '@/llm/config'
import { parseSkillEntry } from '@/skills/load'
import { builtinTools } from '@/tools/builtins'
import { runEval, summarize, type Attempt, type EvalArm } from './runner'
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

const BASELINE: EvalArm = { id: 'baseline', strategy: STRATEGIES.baseline, skills: [] }
const CAPPED: EvalArm = { id: 'capped', strategy: STRATEGIES.capped, skills: [] }

const CALL =
  '</think><tool_call><function=calculator><parameter=expression>2+2</parameter></function></tool_call>'

describe('runEval', () => {
  it('scores the tool choice and the answer separately', async () => {
    const [attempt] = await runEval(fakeClient([CALL, '</think>2 + 2 = 4']), {
      scenarios: [arithmetic],
      arms: [BASELINE],
      repeats: 1,
      tools: builtinTools,
    })

    expect(attempt?.calls).toEqual([{ name: 'calculator', arguments: { expression: '2+2' } }])
    expect(attempt?.routedCorrectly).toBe(true)
    expect(attempt?.answeredCorrectly).toBe(true)
  })

  it('counts a tool call as mis-routed when the scenario wanted none', async () => {
    const [attempt] = await runEval(fakeClient([CALL, '</think>Hello.']), {
      scenarios: [chat],
      arms: [BASELINE],
      repeats: 1,
      tools: builtinTools,
    })

    // Answering correctly while reaching for a tool it did not need is still a
    // routing failure, and conflating the two would hide it.
    expect(attempt?.routedCorrectly).toBe(false)
    expect(attempt?.answeredCorrectly).toBe(true)
  })

  it('scores the arguments separately from the tool choice', async () => {
    // The 1inch failure in miniature: right tool, query rewritten into a
    // different question. Tool names alone cannot see this.
    const rewritten =
      '</think><tool_call><function=web_search><parameter=query>1 inch in centimeters</parameter></function></tool_call>'
    const [attempt] = await runEval(fakeClient([rewritten, '</think>2.54 cm.']), {
      scenarios: [
        {
          ...arithmetic,
          expectTool: 'web_search',
          acceptCall: (calls) => calls[0]?.arguments.query === '1inch',
          accept: () => true,
        },
      ],
      arms: [BASELINE],
      repeats: 1,
      tools: builtinTools,
    })

    expect(attempt?.routedCorrectly).toBe(true)
    expect(attempt?.calledWell).toBe(false)
  })

  it('leaves argument quality unscored when the scenario does not check', async () => {
    const [attempt] = await runEval(fakeClient([CALL, '</think>4']), {
      scenarios: [arithmetic],
      arms: [BASELINE],
      repeats: 1,
      tools: builtinTools,
    })

    expect(attempt?.calledWell).toBeNull()
  })

  it('records an invented tool name', async () => {
    const invented =
      '</think><tool_call><function=wolfram><parameter=q>2+2</parameter></function></tool_call>'
    const [attempt] = await runEval(fakeClient([invented, '</think>4']), {
      scenarios: [arithmetic],
      arms: [BASELINE],
      repeats: 1,
      tools: builtinTools,
    })

    expect(attempt?.hallucinated).toEqual(['wolfram'])
  })

  it('records which skill fired, and shows the model its exemplar', async () => {
    const skill = parseSkillEntry(
      `---
name: arithmetic-skill
description: A description.
jarvis:
  tools:
    - calculator
  triggers:
    - '\\d\\s*\\+\\s*\\d'
  exemplars:
    - user: What is 1 + 1?
      steps:
        - tool: calculator
          arguments:
            expression: 1 + 1
          result: 1 + 1 = 2
      answer: Two.
---
Use the calculator.`,
      'test/SKILL.md',
    )

    const client = fakeClient([CALL, '</think>2 + 2 = 4'])
    const [attempt] = await runEval(client, {
      scenarios: [arithmetic],
      arms: [{ id: 'baseline+skills', strategy: STRATEGIES.baseline, skills: [skill] }],
      repeats: 1,
      tools: builtinTools,
    })

    expect(attempt?.skill).toBe('arithmetic-skill')
    expect(attempt?.skillReason).toBe('trigger')

    // A skill that fires but whose exemplar never reaches the prompt would score
    // identically to one that works, which is the failure worth guarding.
    const [turns, offered] = vi.mocked(client.generate).mock.calls[0] ?? []
    expect(turns).toContainEqual({ role: 'user', content: 'What is 1 + 1?' })
    expect(offered).toHaveLength(1)
  })

  it('records what the answer check found and whether it fixed it', async () => {
    const [attempt] = await runEval(fakeClient([CALL, '</think>It comes to 5.', '</think>2 + 2 = 4']), {
      scenarios: [arithmetic],
      arms: [BASELINE],
      repeats: 1,
      tools: builtinTools,
    })

    expect(attempt?.flagged).toEqual(['wrong-number'])
    expect(attempt?.corrected).toBe(true)
    expect(attempt?.answeredCorrectly).toBe(true)
  })

  it('honours an arm that runs with the check off', async () => {
    const [attempt] = await runEval(fakeClient([CALL, '</think>It comes to 5.', '</think>2 + 2 = 4']), {
      scenarios: [arithmetic],
      arms: [{ ...BASELINE, id: 'baseline-nocheck', review: false }],
      repeats: 1,
      tools: builtinTools,
    })

    // Without it, the arm has to live with the answer the model first produced,
    // which is the comparison the flag exists to make.
    expect(attempt?.flagged).toEqual([])
    expect(attempt?.answeredCorrectly).toBe(false)
  })

  it('runs every arm on every scenario, once per repeat', async () => {
    const attempts = await runEval(fakeClient(['</think>ok']), {
      scenarios: [arithmetic, chat],
      arms: [BASELINE, CAPPED],
      repeats: 3,
      tools: builtinTools,
    })

    expect(attempts).toHaveLength(12)
  })

  it('stops between attempts when asked', async () => {
    const attempts = await runEval(fakeClient(['</think>ok']), {
      scenarios: [arithmetic, chat],
      arms: [BASELINE],
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
      arms: [BASELINE],
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
    armId: 'baseline',
    repeat: 0,
    skill: null,
    skillReason: null,
    calls: [],
    hallucinated: [],
    answer: '',
    routedCorrectly: false,
    calledWell: null,
    answeredCorrectly: false,
    flagged: [],
    corrected: false,
    thinkTokens: 0,
    tokens: 0,
    durationMs: 0,
    ...overrides,
  }
}

describe('summarize', () => {
  it('reports each arm separately', () => {
    const summaries = summarize([
      attempt({ armId: 'a', routedCorrectly: true }),
      attempt({ armId: 'b', routedCorrectly: false }),
    ])

    expect(summaries.map((summary) => summary.armId)).toEqual(['a', 'b'])
    expect(summaries[0]?.routing).toBe(1)
    expect(summaries[1]?.routing).toBe(0)
  })

  it('measures argument quality only over the scenarios that check it', () => {
    const summaries = summarize([
      attempt({ calledWell: true }),
      attempt({ calledWell: false }),
      // Unchecked attempts must not dilute the figure toward zero.
      attempt({ calledWell: null }),
      attempt({ calledWell: null }),
    ])

    expect(summaries[0]?.callQuality).toBe(0.5)
  })

  it('reports no argument quality when nothing checked it', () => {
    expect(summarize([attempt({})])[0]?.callQuality).toBeNull()
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
