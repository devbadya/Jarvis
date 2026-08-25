import { runAgent } from '@/agent/loop'
import type { ReviewCheck } from '@/agent/review'
import type { LlmClient } from '@/llm/client'
import type { GenerationStrategy } from '@/llm/config'
import type { ChatTurn } from '@/llm/protocol'
import { recallFor } from '@/memory/select'
import type { MemoryRecord } from '@/memory/types'
import { activate, composeTurns } from '@/skills/activate'
import type { RouteReason } from '@/skills/route'
import type { SkillEntry } from '@/skills/types'
import type { Tool } from '@/tools/types'
import type { Invocation, Scenario } from './scenarios'

/**
 * One configuration under test.
 *
 * Reasoning budget and skills are varied together in a single dimension rather
 * than as a matrix, because what matters is comparing whole configurations that
 * could actually ship, not attributing credit between two knobs.
 */
export interface EvalArm {
  id: string
  strategy: GenerationStrategy
  /** Empty means the model gets the plain system prompt and every tool. */
  skills: SkillEntry[]
  /** Check answers before returning them. Defaults to on, as the app ships. */
  review?: boolean
}

export interface Attempt {
  scenarioId: string
  category: Scenario['category']
  armId: string
  repeat: number
  /** Skill that fired, if any. Worth recording: a mis-trigger is its own bug. */
  skill: string | null
  /** How the router found it: by trigger, by keyword search, or carried over. */
  skillReason: RouteReason | null
  /** Every call the model made, in order, arguments included and invalid ones kept. */
  calls: Invocation[]
  /** Names the model asked for that no tool answers to. */
  hallucinated: string[]
  answer: string
  /** Reached for the right tool, or correctly reached for none. */
  routedCorrectly: boolean
  /** Passed sensible arguments. `null` when the scenario does not check them. */
  calledWell: boolean | null
  answeredCorrectly: boolean
  /** What the answer check found in the first draft, if it ran at all. */
  flagged: ReviewCheck[]
  /** Whether a corrected answer replaced that draft. */
  corrected: boolean
  /**
   * Whether the turn spent its whole tool budget and had to be wound down. The
   * answer can still be right, so this is reported beside accuracy rather than
   * folded into it: it is the cost of getting there.
   */
  windDown: boolean
  thinkTokens: number
  tokens: number
  durationMs: number
  error?: string
}

export interface RunOptions {
  scenarios: Scenario[]
  arms: EvalArm[]
  /** Repeats per scenario. Sampling is on, so one run tells you very little. */
  repeats: number
  tools: Tool[]
  onAttempt?: (attempt: Attempt) => void
  /** Polled between attempts so a long sweep can be cancelled from the UI. */
  shouldStop?: () => boolean
}

function history(scenario: Scenario): ChatTurn[] {
  return [...(scenario.history ?? []), { role: 'user', content: scenario.prompt }]
}

/**
 * The scenario's memories put through the real selection, so what lands in the
 * prompt is what a turn would have produced — including nothing, when the
 * question is about none of them.
 *
 * They are built here rather than written to IndexedDB: the harness should
 * measure the model, not leave a row behind in whatever the user has stored.
 */
function recall(scenario: Scenario, now = Date.now()): string {
  if (!scenario.memories?.length) return ''
  const records: MemoryRecord[] = scenario.memories.map((entry, index) => ({
    id: `eval${index}`,
    text: entry.text,
    kind: entry.kind ?? 'fact',
    source: 'user',
    createdAt: now,
    updatedAt: now,
  }))
  return recallFor(scenario.prompt, records)
}

async function runAttempt(
  client: LlmClient,
  scenario: Scenario,
  arm: EvalArm,
  repeat: number,
  tools: Tool[],
): Promise<Attempt> {
  const { activation } = activate(scenario.prompt, arm.skills, tools)
  const available = activation?.tools ?? tools
  const known = new Set(available.map((tool) => tool.schema.function.name))
  const calls: Invocation[] = []

  const base = {
    scenarioId: scenario.id,
    category: scenario.category,
    armId: arm.id,
    repeat,
    skill: activation?.skill.name ?? null,
    skillReason: activation?.reason ?? null,
  }

  try {
    const result = await runAgent(
      client,
      composeTurns(history(scenario), activation, recall(scenario)),
      available,
      {
        onPartial: () => {},
        // Recorded on start rather than on completion, so a call that throws is
        // still scored: bad arguments are often exactly why it threw.
        onToolStart: (call) => calls.push({ name: call.name, arguments: call.arguments }),
        onToolEnd: () => {},
        onRoundEnd: () => {},
      },
      { strategy: activation?.strategy ?? arm.strategy, review: arm.review ?? true },
    )

    const names = calls.map((call) => call.name)
    return {
      ...base,
      calls,
      hallucinated: names.filter((name) => !known.has(name)),
      answer: result.content,
      routedCorrectly:
        scenario.expectTool === null ? names.length === 0 : names.includes(scenario.expectTool),
      calledWell: scenario.acceptCall ? scenario.acceptCall(calls) : null,
      answeredCorrectly: scenario.accept(result.content),
      flagged: result.review?.found ?? [],
      corrected: result.review?.corrected ?? false,
      windDown: result.windDown ?? false,
      thinkTokens: result.stats.thinkTokens,
      tokens: result.stats.tokens,
      durationMs: result.stats.durationMs,
    }
  } catch (error) {
    return {
      ...base,
      calls,
      hallucinated: [],
      answer: '',
      routedCorrectly: false,
      calledWell: scenario.acceptCall ? false : null,
      answeredCorrectly: false,
      flagged: [],
      corrected: false,
      windDown: false,
      thinkTokens: 0,
      tokens: 0,
      durationMs: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Runs every arm against every scenario, `repeats` times each.
 *
 * Repeat is the outer loop deliberately: a GPU that thermally throttles part way
 * through would otherwise penalise whichever arm happened to be scheduled last,
 * and comparing the arms is the entire point.
 */
export async function runEval(client: LlmClient, options: RunOptions): Promise<Attempt[]> {
  const results: Attempt[] = []

  for (let repeat = 0; repeat < options.repeats; repeat += 1) {
    for (const arm of options.arms) {
      for (const scenario of options.scenarios) {
        if (options.shouldStop?.()) return results
        const attempt = await runAttempt(client, scenario, arm, repeat, options.tools)
        results.push(attempt)
        options.onAttempt?.(attempt)
      }
    }
  }

  return results
}

export interface Summary {
  armId: string
  attempts: number
  /** Fraction that reached for the right tool. */
  routing: number
  /**
   * Fraction that passed acceptable arguments, over the scenarios that check.
   * `null` when none of them did.
   */
  callQuality: number | null
  /** Fraction whose final answer was accepted. */
  answers: number
  /** Fraction that invented a tool name. */
  hallucination: number
  /** Fraction whose first draft failed a check. */
  flagged: number
  /** Fraction where a correction replaced that draft. */
  corrected: number
  /** Fraction that ran out of tool rounds and had to be wound down. */
  windDown: number
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
  const byArm = new Map<string, Attempt[]>()
  for (const attempt of results) {
    const bucket = byArm.get(attempt.armId) ?? []
    bucket.push(attempt)
    byArm.set(attempt.armId, bucket)
  }

  return [...byArm.entries()].map(([armId, attempts]) => {
    const categories = [...new Set(attempts.map((attempt) => attempt.category))]
    const checked = attempts.filter((attempt) => attempt.calledWell !== null)
    return {
      armId,
      attempts: attempts.length,
      routing: fraction(attempts.map((attempt) => attempt.routedCorrectly)),
      callQuality:
        checked.length === 0 ? null : fraction(checked.map((attempt) => attempt.calledWell === true)),
      answers: fraction(attempts.map((attempt) => attempt.answeredCorrectly)),
      hallucination: fraction(attempts.map((attempt) => attempt.hallucinated.length > 0)),
      flagged: fraction(attempts.map((attempt) => attempt.flagged.length > 0)),
      corrected: fraction(attempts.map((attempt) => attempt.corrected)),
      windDown: fraction(attempts.map((attempt) => attempt.windDown)),
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
