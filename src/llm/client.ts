import type { ToolSchema } from '@/types'
import { DEFAULT_STRATEGY, type GenerationStrategy } from './config'
import type { ChatTurn, LoadProgress, MainToWorker, WorkerToMain } from './protocol'

export interface GenerateHandlers {
  onChunk: (text: string) => void
  strategy?: GenerationStrategy
}

export interface GenerateResult {
  text: string
  tokens: number
  thinkTokens: number
  durationMs: number
}

export interface LoadHandlers {
  onStatus: (message: string) => void
  onProgress: (files: LoadProgress[]) => void
}

/**
 * Promise-shaped facade over the inference worker. Requests are correlated by id
 * so a stale generation can never resolve a newer one.
 */
export class LlmClient {
  private worker: Worker
  private pending = new Map<
    string,
    { resolve: (r: GenerateResult) => void; reject: (e: Error) => void; onChunk: (t: string) => void }
  >()
  private loadWaiters: { resolve: () => void; reject: (e: Error) => void }[] = []
  private loadHandlers: LoadHandlers | null = null
  private loaded = false

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', (event) => {
      this.failAll(new Error(event.message || 'The inference worker crashed'))
    })
  }

  private handleMessage = (event: MessageEvent<WorkerToMain>): void => {
    const message = event.data
    switch (message.type) {
      case 'loading':
        this.loadHandlers?.onStatus(message.message)
        break
      case 'progress':
        this.loadHandlers?.onProgress(message.files)
        break
      case 'ready':
        this.loaded = true
        this.loadWaiters.forEach((waiter) => waiter.resolve())
        this.loadWaiters = []
        break
      case 'chunk':
        this.pending.get(message.requestId)?.onChunk(message.text)
        break
      case 'complete': {
        const entry = this.pending.get(message.requestId)
        this.pending.delete(message.requestId)
        entry?.resolve({
          text: message.text,
          tokens: message.tokens,
          thinkTokens: message.thinkTokens,
          durationMs: message.durationMs,
        })
        break
      }
      case 'error': {
        const error = new Error(message.message)
        if (message.requestId) {
          const entry = this.pending.get(message.requestId)
          this.pending.delete(message.requestId)
          entry?.reject(error)
        } else {
          this.failAll(error)
        }
        break
      }
    }
  }

  private failAll(error: Error): void {
    this.pending.forEach((entry) => entry.reject(error))
    this.pending.clear()
    this.loadWaiters.forEach((waiter) => waiter.reject(error))
    this.loadWaiters = []
  }

  private send(message: MainToWorker): void {
    this.worker.postMessage(message)
  }

  load(handlers: LoadHandlers): Promise<void> {
    this.loadHandlers = handlers
    if (this.loaded) return Promise.resolve()
    const waiter = new Promise<void>((resolve, reject) => {
      this.loadWaiters.push({ resolve, reject })
    })
    this.send({ type: 'load' })
    return waiter
  }

  generate(turns: ChatTurn[], tools: ToolSchema[], handlers: GenerateHandlers): Promise<GenerateResult> {
    const requestId = crypto.randomUUID()
    const result = new Promise<GenerateResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, onChunk: handlers.onChunk })
    })
    this.send({
      type: 'generate',
      requestId,
      turns,
      tools,
      strategy: handlers.strategy ?? DEFAULT_STRATEGY,
    })
    return result
  }

  interrupt(): void {
    this.send({ type: 'interrupt' })
  }

  dispose(): void {
    this.worker.terminate()
    this.failAll(new Error('Client disposed'))
  }
}
