import type { ToolSchema } from '@/types'
import type { GenerationStrategy } from './config'

/** Plain chat turns as the tokenizer's chat template expects them. */
export interface ChatTurn {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export type MainToWorker =
  | { type: 'load' }
  | {
      type: 'generate'
      requestId: string
      turns: ChatTurn[]
      tools: ToolSchema[]
      strategy: GenerationStrategy
    }
  | { type: 'interrupt' }

export interface LoadProgress {
  file: string
  loaded: number
  total: number
}

export type WorkerToMain =
  | { type: 'loading'; message: string }
  | { type: 'progress'; files: LoadProgress[] }
  | { type: 'ready' }
  | { type: 'chunk'; requestId: string; text: string }
  | {
      type: 'complete'
      requestId: string
      text: string
      tokens: number
      /** Tokens spent inside the reasoning block, reported so the eval can chart it. */
      thinkTokens: number
      durationMs: number
    }
  | { type: 'error'; requestId?: string; message: string }
