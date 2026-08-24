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
 * Entries the model could actually carry out.
 *
 * A skill teaches by worked tool calls, so one whose tools are all missing —
 * memory switched off, an MCP server that did not connect — teaches a call to
 * something that is not there. The model imitates it, `runAgent` answers
 * "Unknown tool", and the round is gone. Filtering before routing rather than
 * after means the turn falls to the next skill that can do the work, or to the
 * model unaided, instead of being spent on one that cannot.
 *
 * Only an entry with *nothing* available is dropped. One that names four tools
 * and has three still knows what it is doing. This is also why `tools` is on
 * the catalogue entry: deciding it by loading every skill would give back
 * exactly what the catalogue is for.
 */
export function usableSkills(catalog: SkillEntry[], tools: Tool[]): SkillEntry[] {
  const available = new Set(tools.map((tool) => tool.schema.function.name))
  return catalog.filter(
    (entry) => entry.tools.length === 0 || entry.tools.some((name) => available.has(name)),
  )
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
  const routing = route(text, usableSkills(catalog, tools), memory)
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
 *
 * `recall` is whatever `memory/select.ts` decided this turn is owed, already
 * rendered and budgeted. It goes last in the system message, after the skill
 * guidance, because it is about this user rather than about this kind of
 * request — and it is an empty string whenever nothing was recalled, so a
 * prompt is never lengthened to announce that nothing is known.
 */
export function composeTurns(history: ChatTurn[], activation: Activation | null, recall = ''): ChatTurn[] {
  const guidance = activation ? `${SYSTEM_PROMPT}\n\n${activation.skill.guidance}` : SYSTEM_PROMPT
  const system = recall ? `${guidance}\n\n${recall}` : guidance
  const exemplars = activation?.exemplars.flatMap(exemplarTurns) ?? []
  return [{ role: 'system', content: system }, ...exemplars, ...history]
}
