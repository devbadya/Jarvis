/**
 * Inference through `POST /api/chat` on the tool proxy, used when that process
 * has a model key. The tab still executes tools; this client only generates.
 */

import type { ToolSchema } from '@/types'
import type { ParsedToolCall } from '@/agent/parse'
import { configuredProxyBase, type WebAccessConfig } from '@/tools/web'
import type { GenerateHandlers, GenerateResult, InferenceClient, LoadHandlers } from './client'
import type { ChatTurn } from './protocol'

export interface HostedChatInfo {
  base: string
  model: string
}

interface ChatStreamEvent {
  text?: string
  tool_calls?: ParsedToolCall[]
  usage?: { completion_tokens?: number; total_tokens?: number }
  error?: string
}

export async function probeHostedChat(config: WebAccessConfig): Promise<HostedChatInfo | null> {
  const base = configuredProxyBase(config)
  if (base === undefined) return null
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(4_000) })
    if (!response.ok) return null
    const payload = (await response.json()) as { chat?: { model?: unknown } }
    const model = payload.chat?.model
    if (typeof model !== 'string' || !model.trim()) return null
    return { base, model: model.trim() }
  } catch {
    return null
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string }
    if (payload.error?.trim()) return payload.error.trim()
  } catch {
    // Fall through to the status line.
  }
  return `The hosted model responded with ${response.status}`
}

export async function* readChatSse(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const event = eventFromSseFrame(frame)
      if (event) yield event
    }
  }
  const trailing = eventFromSseFrame(buffer)
  if (trailing) yield trailing
}

export function eventFromSseFrame(frame: string): ChatStreamEvent | null {
  for (const line of frame.split('\n')) {
    const data = line.startsWith('data:') ? line.slice(5).trim() : ''
    if (!data || data === '[DONE]') continue
    try {
      return JSON.parse(data) as ChatStreamEvent
    } catch {
      return null
    }
  }
  return null
}

/**
 * Same shape as `LlmClient`, talking to `/api/chat` instead of a Web Worker.
 */
export class HostedLlmClient implements InferenceClient {
  private abort: AbortController | null = null
  private readonly base: string

  constructor(base: string) {
    this.base = base
  }

  load(handlers: LoadHandlers): Promise<void> {
    handlers.onStatus('Connected to the hosted model')
    handlers.onProgress([])
    return Promise.resolve()
  }

  async generate(
    turns: ChatTurn[],
    tools: ToolSchema[],
    handlers: GenerateHandlers,
  ): Promise<GenerateResult> {
    this.abort?.abort()
    this.abort = new AbortController()
    const startedAt = performance.now()
    const response = await fetch(`${this.base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ messages: turns, tools }),
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(120_000)]),
    })
    if (!response.ok) throw new Error(await readError(response))
    if (!response.body) throw new Error('The hosted model returned an empty body')

    let text = ''
    let tokens = 0
    let toolCalls: ParsedToolCall[] | undefined
    for await (const event of readChatSse(response.body)) {
      if (event.error) throw new Error(event.error)
      if (event.text) {
        text += event.text
        handlers.onChunk(event.text)
      }
      if (event.tool_calls?.length) toolCalls = event.tool_calls
      const counted = event.usage?.completion_tokens ?? event.usage?.total_tokens
      if (typeof counted === 'number') tokens = counted
    }

    return {
      text,
      tokens: tokens || Math.max(1, Math.ceil(text.length / 4)),
      thinkTokens: 0,
      durationMs: performance.now() - startedAt,
      ...(toolCalls?.length ? { toolCalls } : {}),
    }
  }

  interrupt(): void {
    this.abort?.abort()
    this.abort = null
  }

  dispose(): void {
    this.interrupt()
  }
}
