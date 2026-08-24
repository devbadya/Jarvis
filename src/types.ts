import type { ReviewOutcome } from '@/agent/review'
import type { RouteReason } from '@/skills/route'

export type Role = 'system' | 'user' | 'assistant' | 'tool'

/** The skill a reply was answered with, and how the router got there. */
export interface AppliedSkill {
  name: string
  reason: RouteReason
  /** The keywords that found it, when search is what found it. */
  matched: string[]
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: 'pending' | 'running' | 'done' | 'error'
  result?: string
  error?: string
  durationMs?: number
}

export interface Message {
  id: string
  role: Role
  /** Visible answer text, with reasoning and tool-call markup already stripped out. */
  content: string
  /** Contents of the model's <think> block, shown collapsed. */
  reasoning?: string
  toolCalls?: ToolCall[]
  /** Set on tool messages so results can be matched back to their call. */
  toolCallId?: string
  createdAt: number
  /** True while tokens are still streaming into this message. */
  streaming?: boolean
  /**
   * Why the turn ended early. Kept apart from `content` so a failure is never
   * mistaken for an answer, and whatever streamed before it still survives.
   */
  error?: string
  stats?: GenerationStats
  /**
   * What the answer check made of this reply. Present from the moment a problem
   * is found, so the interface can say why the text is being rewritten.
   */
  review?: ReviewOutcome
  /** Which skill was loaded for this turn, if any, and why. */
  skill?: AppliedSkill
}

export interface GenerationStats {
  tokens: number
  /** Of those tokens, how many were spent inside the reasoning block. */
  thinkTokens: number
  durationMs: number
  tokensPerSecond: number
}

/** JSON-schema style description handed to the model's chat template. */
export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}
