import { renderToolCall } from '@/agent/render'
import { STRATEGIES, SYSTEM_PROMPT, type GenerationStrategy } from '@/llm/config'
import type { ChatTurn } from '@/llm/protocol'
import type { Tool } from '@/tools/types'
import type { Skill, SkillExemplar } from './types'

export interface Activation {
  skill: Skill
  /** Only the tools this skill declares, so the model chooses from a short list. */
  tools: Tool[]
  strategy?: GenerationStrategy
}

/**
 * Picks the skill whose triggers match the user's message.
 *
 * Matching is deterministic rather than model-driven, and that is the point.
 * Routing by asking the model which skill applies spends the very capacity the
 * skill is meant to conserve, and metadata-only routing is unreliable even for
 * far larger models (arXiv:2603.22455). A regex costs nothing and cannot
 * hallucinate. It also caps the library: this approach stops scaling somewhere
 * around twenty skills, which is past where a 0.8B model's skill-selection
 * accuracy falls apart anyway.
 */
export function selectSkill(text: string, skills: Skill[]): Skill | null {
  return skills.find((skill) => skill.triggers.some((trigger) => trigger.test(text))) ?? null
}

export function activate(text: string, skills: Skill[], tools: Tool[]): Activation | null {
  const skill = selectSkill(text, skills)
  if (!skill) return null

  const byName = new Map(tools.map((tool) => [tool.schema.function.name, tool]))
  const selected = skill.tools
    .map((name) => byName.get(name))
    .filter((tool): tool is Tool => tool !== undefined)

  return {
    skill,
    // An empty declaration means the skill does not restrict the tool list.
    tools: skill.tools.length === 0 ? tools : selected,
    ...(skill.strategy ? { strategy: STRATEGIES[skill.strategy] } : {}),
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
  const exemplars = activation?.skill.exemplars.flatMap(exemplarTurns) ?? []
  return [{ role: 'system', content: system }, ...exemplars, ...history]
}
