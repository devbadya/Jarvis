/**
 * Hosted chat through the tool proxy: `POST /api/chat`.
 *
 * Default provider is Anthropic Claude Opus (`ANTHROPIC_API_KEY`). An
 * OpenAI-compatible host (`OPENAI_API_KEY`, Groq, OpenRouter, …) still works.
 * The key never enters the bundle. Tools still run in the tab.
 *
 * Set either key to the literal `mock` to exercise the wiring without a provider.
 */

import type { ServerResponse } from 'node:http'

export const CHAT_TIMEOUT_MS = 120_000
export const MAX_CHAT_TURNS = 64
export const MOCK_CHAT_KEY = 'mock'
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5'
export const ANTHROPIC_VERSION = '2023-06-01'

export interface ChatToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatEvent {
  text?: string
  tool_calls?: ChatToolCall[]
  usage?: { completion_tokens?: number; total_tokens?: number }
  error?: string
}

export type ChatProvider = 'anthropic' | 'openai' | 'mock'

export interface ChatConfig {
  provider: ChatProvider
  apiKey: string
  baseUrl: string
  model: string
}

export interface OpenAiMessage {
  role: string
  content: string | null
  tool_call_id?: string
  tool_calls?: {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }[]
}

export interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
}

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

interface IncomingTurn {
  role?: unknown
  content?: unknown
  toolCallId?: unknown
  toolCalls?: unknown
}

export function chatConfig(): ChatConfig | null {
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim()
  const openai = process.env.OPENAI_API_KEY?.trim()
  if (anthropic === MOCK_CHAT_KEY || openai === MOCK_CHAT_KEY) {
    return { provider: 'mock', apiKey: MOCK_CHAT_KEY, baseUrl: '', model: 'mock' }
  }
  if (anthropic) {
    return {
      provider: 'anthropic',
      apiKey: anthropic,
      baseUrl: (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, ''),
      model: process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
    }
  }
  if (openai) {
    return {
      provider: 'openai',
      apiKey: openai,
      baseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
    }
  }
  return null
}

export function chatPublicInfo(): { model: string; provider: ChatProvider } | null {
  const config = chatConfig()
  return config ? { model: config.model, provider: config.provider } : null
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // The model sometimes emits a bare string. Keep it so the tool can coerce.
  }
  return { value: trimmed }
}

function asTurn(value: unknown): IncomingTurn | null {
  if (!value || typeof value !== 'object') return null
  return value as IncomingTurn
}

/**
 * Turns our `{ role, content, toolCalls?, toolCallId? }` conversation into the
 * Chat Completions shape. Invalid entries are dropped rather than failing the
 * whole request — a stale tool id is not worth a 400.
 */
export function toOpenAiMessages(raw: unknown): OpenAiMessage[] {
  if (!Array.isArray(raw)) return []
  const messages: OpenAiMessage[] = []

  for (const entry of raw.slice(-MAX_CHAT_TURNS)) {
    const turn = asTurn(entry)
    if (!turn) continue
    const role = String(turn.role ?? '')
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) continue
    const content = typeof turn.content === 'string' ? turn.content : ''

    if (role === 'tool') {
      const toolCallId = typeof turn.toolCallId === 'string' ? turn.toolCallId.trim() : ''
      messages.push({
        role: 'tool',
        content,
        ...(toolCallId ? { tool_call_id: toolCallId } : {}),
      })
      continue
    }

    if (role === 'assistant' && Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0) {
      const tool_calls: NonNullable<OpenAiMessage['tool_calls']> = []
      for (const call of turn.toolCalls) {
        if (!call || typeof call !== 'object') continue
        const record = call as { id?: unknown; name?: unknown; arguments?: unknown }
        const id = String(record.id ?? '').trim()
        const name = String(record.name ?? '').trim()
        if (!id || !name) continue
        tool_calls.push({
          id,
          type: 'function',
          function: {
            name,
            arguments: JSON.stringify(
              record.arguments && typeof record.arguments === 'object' ? record.arguments : {},
            ),
          },
        })
      }
      if (tool_calls.length > 0) {
        messages.push({ role: 'assistant', content: content || null, tool_calls })
        continue
      }
    }

    messages.push({ role, content })
  }

  return messages
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function toAnthropicTools(
  raw: unknown,
): { name: string; description: string; input_schema: Record<string, unknown> }[] {
  if (!Array.isArray(raw)) return []
  const tools: { name: string; description: string; input_schema: Record<string, unknown> }[] = []
  for (const entry of raw.slice(0, 32)) {
    const record = asRecord(entry)
    const fn = asRecord(record?.function)
    const name = typeof fn?.name === 'string' ? fn.name.trim() : ''
    if (!fn || !name) continue
    const parameters = asRecord(fn.parameters) ?? { type: 'object', properties: {} }
    tools.push({
      name,
      description: typeof fn.description === 'string' ? fn.description : '',
      input_schema: parameters,
    })
  }
  return tools
}

function assistantBlocks(turn: IncomingTurn): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = []
  const text = typeof turn.content === 'string' ? turn.content.trim() : ''
  if (text) blocks.push({ type: 'text', text })
  if (!Array.isArray(turn.toolCalls)) return blocks
  for (const call of turn.toolCalls) {
    const record = asRecord(call)
    const id = typeof record?.id === 'string' ? record.id.trim() : ''
    const name = typeof record?.name === 'string' ? record.name.trim() : ''
    if (!record || !id || !name) continue
    blocks.push({
      type: 'tool_use',
      id,
      name,
      input: asRecord(record.arguments) ?? {},
    })
  }
  return blocks
}

function mergeAnthropic(messages: AnthropicMessage[]): AnthropicMessage[] {
  const merged: AnthropicMessage[] = []
  for (const message of messages) {
    const previous = merged.at(-1)
    if (!previous || previous.role !== message.role) {
      merged.push(message)
      continue
    }
    const left =
      typeof previous.content === 'string' ? [{ type: 'text', text: previous.content }] : previous.content
    const right =
      typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content
    previous.content = [...left, ...right]
  }
  return merged
}

/**
 * Anthropic wants `system` as a top-level field, tool results as `user` blocks,
 * and strictly alternating roles. Our loop already has that information; this
 * just rearranges it.
 */
export function toAnthropicRequest(raw: unknown): { system?: string; messages: AnthropicMessage[] } {
  if (!Array.isArray(raw)) return { messages: [] }
  const system: string[] = []
  const staged: AnthropicMessage[] = []

  for (const entry of raw.slice(-MAX_CHAT_TURNS)) {
    const turn = asTurn(entry)
    if (!turn) continue
    const role = String(turn.role ?? '')
    const content = typeof turn.content === 'string' ? turn.content : ''
    if (role === 'system') {
      if (content.trim()) system.push(content.trim())
      continue
    }
    if (role === 'tool') {
      const toolUseId = typeof turn.toolCallId === 'string' ? turn.toolCallId.trim() : ''
      staged.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId || 'missing',
            content,
          },
        ],
      })
      continue
    }
    if (role === 'assistant') {
      const blocks = assistantBlocks(turn)
      staged.push({ role: 'assistant', content: blocks.length > 0 ? blocks : content })
      continue
    }
    if (role === 'user') staged.push({ role: 'user', content })
  }

  return { ...(system.length > 0 ? { system: system.join('\n\n') } : {}), messages: mergeAnthropic(staged) }
}

/**
 * Opus 5 thinks by default, and thinking blocks must be echoed unmodified on
 * the next tool round or the API 400s. This proxy rebuilds messages from our
 * `{ content, toolCalls }` shape, so thinking is switched off. Disabling is
 * only valid at effort `high` or below.
 */
export function anthropicChatBody(
  model: string,
  converted: { system?: string; messages: AnthropicMessage[] },
  tools: unknown[],
): Record<string, unknown> | null {
  if (converted.messages.length === 0) return null
  const anthropicTools = toAnthropicTools(tools)
  return {
    model,
    max_tokens: 8192,
    stream: true,
    thinking: { type: 'disabled' },
    output_config: { effort: 'high' },
    ...converted,
    ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
  }
}

type AnthropicToolBucket = { id?: string; name?: string; arguments: string }

export function eventsFromAnthropicEvent(
  event: unknown,
  buckets: Map<number, AnthropicToolBucket>,
): ChatEvent[] {
  const record = asRecord(event)
  if (!record) return []
  if (record.type === 'error') {
    const error = asRecord(record.error)
    return [{ error: String(error?.message ?? 'The model provider returned an error') }]
  }

  const events: ChatEvent[] = []
  const index = typeof record.index === 'number' ? record.index : 0

  if (record.type === 'content_block_start') {
    const block = asRecord(record.content_block)
    if (block?.type === 'tool_use') {
      buckets.set(index, {
        id: typeof block.id === 'string' ? block.id : undefined,
        name: typeof block.name === 'string' ? block.name : undefined,
        arguments: '',
      })
    }
    return events
  }

  if (record.type === 'content_block_delta') {
    const delta = asRecord(record.delta)
    if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
      events.push({ text: delta.text })
    }
    if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      const bucket = buckets.get(index) ?? { arguments: '' }
      bucket.arguments += delta.partial_json
      buckets.set(index, bucket)
    }
    return events
  }

  if (record.type === 'message_delta') {
    const delta = asRecord(record.delta)
    const usage = asRecord(record.usage)
    if (delta?.stop_reason === 'tool_use') {
      const tool_calls = finalizeToolCalls(buckets)
      if (tool_calls.length > 0) events.push({ tool_calls })
      buckets.clear()
    }
    if (typeof usage?.output_tokens === 'number') {
      events.push({ usage: { completion_tokens: usage.output_tokens } })
    }
  }

  return events
}

type ToolCallBucket = { id?: string; name?: string; arguments: string }

export function applyOpenAiToolDelta(buckets: Map<number, ToolCallBucket>, deltas: unknown): void {
  if (!Array.isArray(deltas)) return
  for (const delta of deltas) {
    if (!delta || typeof delta !== 'object') continue
    const entry = delta as {
      index?: unknown
      id?: unknown
      function?: { name?: unknown; arguments?: unknown }
    }
    const index = typeof entry.index === 'number' ? entry.index : 0
    const bucket = buckets.get(index) ?? { arguments: '' }
    if (typeof entry.id === 'string' && entry.id) bucket.id = entry.id
    if (typeof entry.function?.name === 'string' && entry.function.name) bucket.name = entry.function.name
    if (typeof entry.function?.arguments === 'string') bucket.arguments += entry.function.arguments
    buckets.set(index, bucket)
  }
}

export function finalizeToolCalls(buckets: Map<number, ToolCallBucket>): ChatToolCall[] {
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, bucket]) => {
      const name = bucket.name?.trim()
      const id = bucket.id?.trim()
      if (!name || !id) return []
      return [{ id, name, arguments: parseToolArguments(bucket.arguments) }]
    })
}

export function eventsFromOpenAiChunk(chunk: unknown, buckets: Map<number, ToolCallBucket>): ChatEvent[] {
  if (!chunk || typeof chunk !== 'object') return []
  const record = chunk as {
    error?: { message?: unknown }
    usage?: { completion_tokens?: unknown; total_tokens?: unknown }
    choices?: { delta?: { content?: unknown; tool_calls?: unknown }; finish_reason?: unknown }[]
  }
  if (record.error?.message) return [{ error: String(record.error.message) }]

  const events: ChatEvent[] = []
  const choice = record.choices?.[0]
  const content = choice?.delta?.content
  if (typeof content === 'string' && content) events.push({ text: content })
  if (choice?.delta?.tool_calls) applyOpenAiToolDelta(buckets, choice.delta.tool_calls)
  if (choice?.finish_reason === 'tool_calls') {
    const tool_calls = finalizeToolCalls(buckets)
    if (tool_calls.length > 0) events.push({ tool_calls })
    buckets.clear()
  }
  if (record.usage) {
    events.push({
      usage: {
        completion_tokens:
          typeof record.usage.completion_tokens === 'number' ? record.usage.completion_tokens : undefined,
        total_tokens: typeof record.usage.total_tokens === 'number' ? record.usage.total_tokens : undefined,
      },
    })
  }
  return events
}

function lastUserText(messages: OpenAiMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && typeof message.content === 'string') return message.content
  }
  return ''
}

function lastToolText(messages: OpenAiMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'tool' && typeof message.content === 'string') return message.content
  }
  return ''
}

function toolNames(tools: unknown): Set<string> {
  const names = new Set<string>()
  if (!Array.isArray(tools)) return names
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue
    const name = (tool as { function?: { name?: unknown } }).function?.name
    if (typeof name === 'string' && name) names.add(name)
  }
  return names
}

/**
 * A tiny stand-in so the hosted path can be exercised without a provider key.
 * It calls `calculator` for a sum and otherwise answers in one sentence.
 */
export function mockChatEvents(messages: OpenAiMessage[], tools: unknown): ChatEvent[] {
  const names = toolNames(tools)
  const toolText = lastToolText(messages)
  if (toolText)
    return [{ text: toolText.slice(0, 800) }, { usage: { completion_tokens: 16, total_tokens: 48 } }]

  const asked = lastUserText(messages)
  if (names.has('calculator') && /[\d.][\d.\s]*[+\-*/][\d.\s]+/.test(asked)) {
    const expression =
      asked
        .match(/[\d.+\-*/() \t]+/g)
        ?.find((part) => /[+\-*/]/.test(part))
        ?.trim() ?? asked
    return [
      {
        tool_calls: [{ id: 'mock_calc', name: 'calculator', arguments: { expression } }],
      },
    ]
  }

  const text = asked.trim()
    ? `I can help with that. For facts I will search or read a page rather than guess.`
    : 'Hello. Ask a question and I will use tools when I need a fact.'
  return [{ text }, { usage: { completion_tokens: 24, total_tokens: 40 } }]
}

function writeSse(res: ServerResponse, event: ChatEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(body)
}

function openSse(res: ServerResponse): void {
  res.statusCode = 200
  res.setHeader('content-type', 'text/event-stream; charset=utf-8')
  res.setHeader('cache-control', 'no-cache')
  res.setHeader('connection', 'keep-alive')
  res.setHeader('x-accel-buffering', 'no')
}

async function relayOpenAiStream(response: Response, res: ServerResponse): Promise<void> {
  if (!response.body) throw new Error('The model provider returned an empty body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const buckets = new Map<number, ToolCallBucket>()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : ''
        if (!data || data === '[DONE]') continue
        let chunk: unknown
        try {
          chunk = JSON.parse(data) as unknown
        } catch {
          continue
        }
        for (const event of eventsFromOpenAiChunk(chunk, buckets)) writeSse(res, event)
      }
    }
  }

  const leftover = finalizeToolCalls(buckets)
  if (leftover.length > 0) writeSse(res, { tool_calls: leftover })
}

function asToolSchemas(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw.slice(0, 32) : []
}

/**
 * Answers `POST /api/chat` by streaming `ChatEvent` frames. Callers must not
 * have written to `res` yet.
 */
export async function handleChatRequest(body: unknown, res: ServerResponse): Promise<void> {
  const config = chatConfig()
  if (!config) {
    sendJson(res, 503, {
      error: 'Hosted chat is not configured. Set ANTHROPIC_API_KEY on the tool proxy.',
    })
    return
  }

  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const tools = asToolSchemas(payload.tools)
  const openaiMessages = toOpenAiMessages(payload.messages)
  if (openaiMessages.length === 0 && toAnthropicRequest(payload.messages).messages.length === 0) {
    sendJson(res, 400, { error: 'Missing messages' })
    return
  }

  if (config.provider === 'mock') {
    openSse(res)
    for (const event of mockChatEvents(openaiMessages, tools)) writeSse(res, event)
    res.end()
    return
  }

  if (config.provider === 'anthropic') {
    await streamAnthropic(config, payload.messages, tools, res)
    return
  }

  await streamOpenAi(config, openaiMessages, tools, res)
}

async function streamAnthropic(
  config: ChatConfig,
  rawMessages: unknown,
  tools: unknown[],
  res: ServerResponse,
): Promise<void> {
  const converted = toAnthropicRequest(rawMessages)
  const request = anthropicChatBody(config.model, converted, tools)
  if (!request) {
    sendJson(res, 400, { error: 'Missing messages' })
    return
  }

  const upstream = await callProvider(
    `${config.baseUrl}/v1/messages`,
    {
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    request,
    res,
  )
  if (!upstream) return

  openSse(res)
  try {
    await relayAnthropicStream(upstream, res)
  } catch (error) {
    writeSse(res, { error: error instanceof Error ? error.message : 'The model stream failed' })
  }
  res.end()
}

async function streamOpenAi(
  config: ChatConfig,
  messages: OpenAiMessage[],
  tools: unknown[],
  res: ServerResponse,
): Promise<void> {
  const request: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.7,
  }
  if (tools.length > 0) {
    request.tools = tools
    request.tool_choice = 'auto'
  }

  const upstream = await callProvider(
    `${config.baseUrl}/chat/completions`,
    {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    request,
    res,
  )
  if (!upstream) return

  openSse(res)
  try {
    await relayOpenAiStream(upstream, res)
  } catch (error) {
    writeSse(res, { error: error instanceof Error ? error.message : 'The model stream failed' })
  }
  res.end()
}

async function callProvider(
  url: string,
  headers: Record<string, string>,
  request: Record<string, unknown>,
  res: ServerResponse,
): Promise<Response | null> {
  let upstream: Response
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    })
  } catch (error) {
    sendJson(res, 502, {
      error: error instanceof Error ? error.message : 'The model provider could not be reached',
    })
    return null
  }

  if (!upstream.ok) {
    let detail = `The model provider responded with ${upstream.status}`
    try {
      const failed = (await upstream.json()) as { error?: { message?: string }; message?: string }
      if (failed.error?.message) detail = failed.error.message
      else if (failed.message) detail = failed.message
    } catch {
      // Keep the status line when the body is not JSON.
    }
    sendJson(res, 502, { error: detail })
    return null
  }
  return upstream
}

async function relayAnthropicStream(response: Response, res: ServerResponse): Promise<void> {
  if (!response.body) throw new Error('The model provider returned an empty body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const buckets = new Map<number, AnthropicToolBucket>()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : ''
        if (!data || data === '[DONE]') continue
        let event: unknown
        try {
          event = JSON.parse(data) as unknown
        } catch {
          continue
        }
        for (const next of eventsFromAnthropicEvent(event, buckets)) writeSse(res, next)
      }
    }
  }

  const leftover = finalizeToolCalls(buckets)
  if (leftover.length > 0) writeSse(res, { tool_calls: leftover })
}
