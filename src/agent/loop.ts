import type { LlmClient } from '@/llm/client'
import type { ChatTurn } from '@/llm/protocol'
import { DEFAULT_STRATEGY, MAX_TOOL_ROUNDS, type GenerationStrategy } from '@/llm/config'
import type { Tool } from '@/tools/types'
import type { GenerationStats } from '@/types'
import { parseModelOutput, parsePartial, type ParsedToolCall } from './parse'

export interface AgentCallbacks {
  /** Fired on every streamed token with the markup already stripped. */
  onPartial: (view: { content: string; reasoning: string; inThinkBlock: boolean }) => void
  onToolStart: (call: ParsedToolCall & { id: string }) => void
  onToolEnd: (id: string, outcome: { result?: string; error?: string; durationMs: number }) => void
  /** Called once per model round so the UI can show intermediate reasoning. */
  onRoundEnd: (round: { content: string; reasoning: string; stats: GenerationStats }) => void
}

export interface AgentResult {
  content: string
  reasoning: string
  stats: GenerationStats
}

export interface AgentOptions {
  /** How reasoning is budgeted. Defaults to whatever `config.ts` ships. */
  strategy?: GenerationStrategy
}

/**
 * The model often spends a whole turn inside the think block and stops without
 * restating its conclusion. Leaving that answer hidden would show the user an
 * empty reply and, worse, push an empty assistant message into the history, so
 * the next turn loses the context. Treat the reasoning as the answer instead.
 */
function promoteReasoningIfEmpty(result: AgentResult): AgentResult {
  if (result.content || !result.reasoning) return result
  return { ...result, content: result.reasoning, reasoning: '' }
}

/**
 * Runs generate → execute tools → generate again until the model answers without
 * requesting a tool, or the round budget is spent.
 */
export async function runAgent(
  client: LlmClient,
  turns: ChatTurn[],
  tools: Tool[],
  callbacks: AgentCallbacks,
  options: AgentOptions = {},
): Promise<AgentResult> {
  const byName = new Map(tools.map((tool) => [tool.schema.function.name, tool]))
  const schemas = tools.map((tool) => tool.schema)
  const conversation = [...turns]
  const strategy = options.strategy ?? DEFAULT_STRATEGY

  let last: AgentResult = {
    content: '',
    reasoning: '',
    stats: { tokens: 0, thinkTokens: 0, durationMs: 0, tokensPerSecond: 0 },
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    let raw = ''
    const generation = await client.generate(conversation, schemas, {
      strategy,
      onChunk: (chunk) => {
        raw += chunk
        callbacks.onPartial(parsePartial(raw))
      },
    })

    const parsed = parseModelOutput(generation.text || raw)
    const stats: GenerationStats = {
      tokens: generation.tokens,
      thinkTokens: generation.thinkTokens,
      durationMs: generation.durationMs,
      tokensPerSecond: generation.durationMs > 0 ? (generation.tokens / generation.durationMs) * 1000 : 0,
    }
    const outcome = { content: parsed.content, reasoning: parsed.reasoning, stats }
    // Only when the turn is over: before a tool call, reasoning is just reasoning.
    last = parsed.toolCalls.length === 0 ? promoteReasoningIfEmpty(outcome) : outcome
    callbacks.onRoundEnd(last)

    if (parsed.toolCalls.length === 0) return last

    // Echo the assistant's tool request back so the model sees its own decision.
    conversation.push({ role: 'assistant', content: generation.text || raw })

    for (const call of parsed.toolCalls) {
      const id = crypto.randomUUID()
      callbacks.onToolStart({ ...call, id })
      const startedAt = performance.now()
      const tool = byName.get(call.name)

      if (!tool) {
        const error = `Unknown tool "${call.name}". Available tools: ${[...byName.keys()].join(', ')}`
        callbacks.onToolEnd(id, { error, durationMs: performance.now() - startedAt })
        conversation.push({ role: 'tool', content: error })
        continue
      }

      try {
        const result = await tool.execute(call.arguments)
        callbacks.onToolEnd(id, { result, durationMs: performance.now() - startedAt })
        conversation.push({ role: 'tool', content: result })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        callbacks.onToolEnd(id, { error: message, durationMs: performance.now() - startedAt })
        conversation.push({ role: 'tool', content: `Tool "${call.name}" failed: ${message}` })
      }
    }
  }

  return {
    ...last,
    content:
      last.content ||
      `I reached the limit of ${MAX_TOOL_ROUNDS} tool rounds without settling on an answer. Try narrowing the question.`,
  }
}
