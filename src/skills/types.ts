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
   * Words and phrases the router searches, beyond what the triggers match.
   *
   * The Agent Skills standard routes on the `description`, because there the
   * reader is a frontier model. Here the reader is code, and prose written for
   * people makes a poor index: `temperature` appears in the weather
   * description, so a bag-of-words match fires it on *what temperature does
   * water boil at*. Keywords are curated instead, which also gives a skill
   * reach into the languages the description is not written in.
   */
  keywords: string[]
  /**
   * The SKILL.md body, appended to the system prompt.
   *
   * Deliberately tiny. The Agent Skills spec targets under 500 lines here, which
   * assumes a frontier model; this app has already measured that lengthening the
   * system prompt drove tool use down to 1 in 6, so `MAX_GUIDANCE_CHARS` keeps it
   * honest and the exemplars do the real work.
   */
  guidance: string
  /**
   * Tool names the model may see while this skill is active.
   *
   * Three states, and the difference between the last two matters. Absent means
   * the skill does not restrict the list. A list of names narrows it to those.
   * An **empty** list means no tools at all — the chat template then renders no
   * tool block, which is the only thing that reliably stops a 0.8B model
   * reaching for a search it has no use for.
   */
  tools?: string[]
  triggers: RegExp[]
  exemplars: SkillExemplar[]
  /** Higher wins when several skills match. */
  priority: number
  /** Optional per-skill reasoning budget override. */
  strategy?: StrategyId
}

/**
 * A skill in the catalogue, before its body has been read.
 *
 * This is the whole of what routing needs, and it is the reason a library can
 * grow without every skill costing something: the entry stays in code, never in
 * the prompt, and `load` is what pulls the guidance and the exemplars in — for
 * the one skill that won.
 */
export interface SkillEntry {
  name: string
  description: string
  keywords: string[]
  triggers: RegExp[]
  priority: number
  /**
   * The tool names the skill declares, which routing needs before deciding.
   *
   * A skill with none of its tools available teaches a call the model cannot
   * make, so it must not win the route — and answering that by loading every
   * skill to look would give back what the catalogue is for. A skill that
   * declares an empty list wants no tools and is always available.
   */
  tools?: string[]
  /** Materialises the body and exemplars. Memoised, so calling it twice is free. */
  load: () => Skill
}

/**
 * Roughly 150 tokens. Past this, a skill is being written for a model that does
 * not exist here and the guidance belongs in an exemplar instead.
 */
export const MAX_GUIDANCE_CHARS = 600

/**
 * How much of the prompt one skill may occupy, guidance and exemplars together.
 *
 * Exemplars are what make a skill work, so this is generous — every shipped
 * skill fits with room to spare, and a test says so. It exists for the skill
 * that does not: at this model size the prompt is the scarce resource, and a
 * library is only safe to grow if no single member of it can take the context.
 */
export const MAX_SKILL_CONTEXT_CHARS = 3000
