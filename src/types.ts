export type Role = 'system' | 'user' | 'assistant' | 'tool'

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
  stats?: GenerationStats
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
