import { runAgent } from '@/agent/loop'
import type { LlmClient } from '@/llm/client'
import { SYSTEM_PROMPT, type GenerationStrategy } from '@/llm/config'
import type { ChatTurn } from '@/llm/protocol'
import type { Tool } from '@/tools/types'
import type { Scenario } from './scenarios'

export interface Attempt {
  scenarioId: string
  category: Scenario['category']
  strategyId: string
  repeat: number
  /** Every tool name the model asked for, in order, including invalid ones. */
  toolsCalled: string[]
  /** Names the model asked for that no tool answers to. */
  hallucinated: string[]
  answer: string
  /** Reached for the right tool, or correctly reached for none. */
  routedCorrectly: boolean
  answeredCorrectly: boolean
  thinkTokens: number
  tokens: number
  durationMs: number
  error?: string
}

export interface RunOptions {
  scenarios: Scenario[]
  strategies: GenerationStrategy[]
  /** Repeats per scenario. Sampling is on, so one run tells you very little. */
  repeats: number
  tools: Tool[]
  onAttempt?: (attempt: Attempt) => void
  /** Polled between attempts so a long sweep can be cancelled from the UI. */
  shouldStop?: () => boolean
}

function toTurns(scenario: Scenario): ChatTurn[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(scenario.history ?? []),
    { role: 'user', content: scenario.prompt },
  ]
}

async function runAttempt(
  client: LlmClient,
  scenario: Scenario,
  strategy: GenerationStrategy,
  repeat: number,
  tools: Tool[],
): Promise<Attempt> {
  const known = new Set(tools.map((tool) => tool.schema.function.name))
  const toolsCalled: string[] = []

  const base = {
    scenarioId: scenario.id,
    category: scenario.category,
    strategyId: strategy.id,
    repeat,
  }

  try {
    const result = await runAgent(
      client,
      toTurns(scenario),
      tools,
      {
        onPartial: () => {},
        onToolStart: (call) => toolsCalled.push(call.name),
        onToolEnd: () => {},
        onRoundEnd: () => {},
      },
      { strategy },
    )

    return {
      ...base,
      toolsCalled,
      hallucinated: toolsCalled.filter((name) => !known.has(name)),
      answer: result.content,
      routedCorrectly:
        scenario.expectTool === null ? toolsCalled.length === 0 : toolsCalled.includes(scenario.expectTool),
      answeredCorrectly: scenario.accept(result.content),
      thinkTokens: result.stats.thinkTokens,
      tokens: result.stats.tokens,
      durationMs: result.stats.durationMs,
    }
  } catch (error) {
    return {
      ...base,
      toolsCalled,
      hallucinated: [],
      answer: '',
      routedCorrectly: false,
      answeredCorrectly: false,
      thinkTokens: 0,
      tokens: 0,
      durationMs: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Runs every strategy against every scenario, `repeats` times each.
 *
 * Repeat is the outer loop deliberately: a GPU that thermally throttles part way
 * through would otherwise penalise whichever strategy happened to be scheduled
 * last, and comparing them is the entire point.
 */
export async function runEval(client: LlmClient, options: RunOptions): Promise<Attempt[]> {
  const results: Attempt[] = []

  for (let repeat = 0; repeat < options.repeats; repeat += 1) {
    for (const strategy of options.strategies) {
      for (const scenario of options.scenarios) {
        if (options.shouldStop?.()) return results
        const attempt = await runAttempt(client, scenario, strategy, repeat, options.tools)
        results.push(attempt)
        options.onAttempt?.(attempt)
      }
    }
  }

  return results
}

export interface Summary {
  strategyId: string
  attempts: number
  /** Fraction that reached for the right tool. */
  routing: number
  /** Fraction whose final answer was accepted. */
  answers: number
  /** Fraction that invented a tool name. */
  hallucination: number
  medianThinkTokens: number
  meanDurationMs: number
  byCategory: { category: Scenario['category']; attempts: number; routing: number; answers: number }[]
}

function fraction(values: boolean[]): number {
  return values.length === 0 ? 0 : values.filter(Boolean).length / values.length
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length
}

export function summarize(results: Attempt[]): Summary[] {
  const byStrategy = new Map<string, Attempt[]>()
  for (const attempt of results) {
    const bucket = byStrategy.get(attempt.strategyId) ?? []
    bucket.push(attempt)
    byStrategy.set(attempt.strategyId, bucket)
  }

  return [...byStrategy.entries()].map(([strategyId, attempts]) => {
    const categories = [...new Set(attempts.map((attempt) => attempt.category))]
    return {
      strategyId,
      attempts: attempts.length,
      routing: fraction(attempts.map((attempt) => attempt.routedCorrectly)),
      answers: fraction(attempts.map((attempt) => attempt.answeredCorrectly)),
      hallucination: fraction(attempts.map((attempt) => attempt.hallucinated.length > 0)),
      medianThinkTokens: median(attempts.map((attempt) => attempt.thinkTokens)),
      meanDurationMs: mean(attempts.map((attempt) => attempt.durationMs)),
      byCategory: categories.map((category) => {
        const subset = attempts.filter((attempt) => attempt.category === category)
        return {
          category,
          attempts: subset.length,
          routing: fraction(subset.map((attempt) => attempt.routedCorrectly)),
          answers: fraction(subset.map((attempt) => attempt.answeredCorrectly)),
        }
      }),
    }
  })
}
