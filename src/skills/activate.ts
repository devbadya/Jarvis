import { renderToolCall } from '@/agent/render'
import { STRATEGIES, SYSTEM_PROMPT, type GenerationStrategy } from '@/llm/config'
import type { ChatTurn } from '@/llm/protocol'
import type { Tool } from '@/tools/types'
import { route, type RouteReason, type SkillMemory } from './route'
import { MAX_SKILL_CONTEXT_CHARS, type Skill, type SkillEntry, type SkillExemplar } from './types'

export interface Activation {
  skill: Skill
  /** Only the tools this skill declares, so the model chooses from a short list. */
  tools: Tool[]
  /** The exemplars that fit the context budget, in the order they were written. */
  exemplars: SkillExemplar[]
  /** How the skill was chosen, so the interface can say. */
  reason: RouteReason
  /** The keywords that found it, when search is what found it. */
  matched: string[]
  strategy?: GenerationStrategy
}

export interface ActivationResult {
  activation: Activation | null
  /** Handed back to the next turn. Null means nothing stays resident. */
  memory: SkillMemory | null
}

/**
 * How much of the skill actually gets loaded.
 *
 * The guidance always does — it is capped at 600 characters and is the skill's
 * point. Exemplars are taken in order until the budget is spent, and the first
 * is kept whatever it costs, because a skill with no worked example is prose,
 * which is the thing measured not to work at this model size.
 */
function withinBudget(skill: Skill): SkillExemplar[] {
  let spent = skill.guidance.length
  const kept: SkillExemplar[] = []

  for (const exemplar of skill.exemplars) {
    const cost =
      exemplar.user.length +
      exemplar.answer.length +
      exemplar.steps.reduce(
        (total, step) => total + renderToolCall(step.tool, step.arguments).length + step.result.length,
        0,
      )

    if (kept.length > 0 && spent + cost > MAX_SKILL_CONTEXT_CHARS) break
    spent += cost
    kept.push(exemplar)
  }

  return kept
}

/**
 * Routes the message, then loads the winning skill and nothing else.
 *
 * The loading is the reason routing is worth doing in code: the catalogue never
 * reaches the prompt, so a library can grow without every message paying for
 * every skill in it. Only the one skill that won is materialised, and only as
 * much of it as the budget allows.
 */
export function activate(
  text: string,
  catalog: SkillEntry[],
  tools: Tool[],
  memory: SkillMemory | null = null,
): ActivationResult {
  const routing = route(text, catalog, memory)
  if (!routing.route) return { activation: null, memory: routing.memory }

  const skill = routing.route.entry.load()
  const byName = new Map(tools.map((tool) => [tool.schema.function.name, tool]))
  const selected = skill.tools
    .map((name) => byName.get(name))
    .filter((tool): tool is Tool => tool !== undefined)

  return {
    activation: {
      skill,
      // An empty declaration means the skill does not restrict the tool list.
      tools: skill.tools.length === 0 ? tools : selected,
      exemplars: withinBudget(skill),
      reason: routing.route.reason,
      matched: routing.route.matched,
      ...(skill.strategy ? { strategy: STRATEGIES[skill.strategy] } : {}),
    },
    memory: routing.memory,
  }
}

/**
 * Expands an exemplar into the turns it stands for.
 *
 * The assistant turn carries the raw tool-call markup rather than a description
 * of it, so the example the model sees is identical in form to the output it is
 * expected to produce. Several steps become several call-and-result pairs, which
 * is how a workflow like "search, then open the best result" gets taught as one
 * behaviour rather than two unrelated ones.
 */
function exemplarTurns(exemplar: SkillExemplar): ChatTurn[] {
  const turns: ChatTurn[] = [{ role: 'user', content: exemplar.user }]

  for (const step of exemplar.steps) {
    turns.push({ role: 'assistant', content: renderToolCall(step.tool, step.arguments) })
    turns.push({ role: 'tool', content: step.result })
  }

  turns.push({ role: 'assistant', content: exemplar.answer })
  return turns
}

/**
 * Builds the conversation sent to the model: system prompt, then the active
 * skill's worked examples, then the real history.
 *
 * Exemplars go before the history so the most recent turns stay nearest the
 * model's output, where they are least likely to be lost.
 */
export function composeTurns(history: ChatTurn[], activation: Activation | null): ChatTurn[] {
  const system = activation ? `${SYSTEM_PROMPT}\n\n${activation.skill.guidance}` : SYSTEM_PROMPT
  const exemplars = activation?.exemplars.flatMap(exemplarTurns) ?? []
  return [{ role: 'system', content: system }, ...exemplars, ...history]
}
