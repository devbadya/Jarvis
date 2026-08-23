import type { StrategyId } from '@/llm/config'

/** One tool call and what it returned, as the model will see them. */
export interface SkillStep {
  tool: string
  arguments: Record<string, string>
  result: string
}

/**
 * One worked example, injected into the conversation as real turns.
 *
 * `steps` may be empty, which teaches the model *not* to reach for a tool, and
 * may hold several, which is how a multi-step workflow gets taught: searching
 * and then opening a result is one behaviour, and split across two exemplars the
 * model has no reason to connect them.
 */
export interface SkillExemplar {
  user: string
  steps: SkillStep[]
  answer: string
}

export interface Skill {
  name: string
  /** Frontmatter description, in the Agent Skills sense: what and when. */
  description: string
  /**
   * The SKILL.md body, appended to the system prompt.
   *
   * Deliberately tiny. The Agent Skills spec targets under 500 lines here, which
   * assumes a frontier model; this app has already measured that lengthening the
   * system prompt drove tool use down to 1 in 6, so `MAX_GUIDANCE_CHARS` keeps it
   * honest and the exemplars do the real work.
   */
  guidance: string
  /** Tool names the model may see while this skill is active. */
  tools: string[]
  triggers: RegExp[]
  exemplars: SkillExemplar[]
  /** Higher wins when several skills match. */
  priority: number
  /** Optional per-skill reasoning budget override. */
  strategy?: StrategyId
}

/**
 * Roughly 150 tokens. Past this, a skill is being written for a model that does
 * not exist here and the guidance belongs in an exemplar instead.
 */
export const MAX_GUIDANCE_CHARS = 600
