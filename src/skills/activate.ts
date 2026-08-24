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

/**
 * Skills the model could actually carry out.
 *
 * A skill teaches by worked tool calls, so one whose tools are all missing —
 * memory switched off, an MCP server that did not connect — teaches a call to
 * something that is not there. The model imitates it, `runAgent` answers
 * "Unknown tool", and the round is gone. Standing aside is the better failure:
 * a lower-priority skill gets its turn, or the model answers unaided.
 *
 * Only a skill with *nothing* available is dropped. One that names four tools
 * and has three still knows what it is doing.
 */
export function usableSkills(skills: Skill[], tools: Tool[]): Skill[] {
  const available = new Set(tools.map((tool) => tool.schema.function.name))
  return skills.filter((skill) => skill.tools.length === 0 || skill.tools.some((name) => available.has(name)))
}

export function activate(text: string, skills: Skill[], tools: Tool[]): Activation | null {
  const skill = selectSkill(text, usableSkills(skills, tools))
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
  const exemplars = activation?.skill.exemplars.flatMap(exemplarTurns) ?? []
  return [{ role: 'system', content: system }, ...exemplars, ...history]
}
