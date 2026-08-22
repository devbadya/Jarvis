export interface ParsedToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface ParsedOutput {
  /** Text meant for the user, with reasoning and tool markup removed. */
  content: string
  reasoning: string
  toolCalls: ParsedToolCall[]
}

const THINK_BLOCK = /<think>([\s\S]*?)(?:<\/think>|$)/g
const TOOL_CALL_BLOCK = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g
const SPECIAL_TOKEN = /<\|[^|]*\|>/g

/**
 * Qwen3.5 interleaves chain-of-thought in <think> blocks and emits tool calls as
 * JSON inside <tool_call> blocks. Both are stripped before display; a truncated
 * trailing block (generation hit the token cap) is tolerated.
 */
export function parseModelOutput(raw: string): ParsedOutput {
  const reasoning: string[] = []
  const toolCalls: ParsedToolCall[] = []

  let content = raw.replace(THINK_BLOCK, (_match, body: string) => {
    reasoning.push(body.trim())
    return ''
  })

  content = content.replace(TOOL_CALL_BLOCK, (_match, body: string) => {
    const call = parseToolCallBody(body)
    if (call) toolCalls.push(call)
    return ''
  })

  return {
    content: content.replace(SPECIAL_TOKEN, '').trim(),
    reasoning: reasoning.join('\n\n').trim(),
    toolCalls,
  }
}

function parseToolCallBody(body: string): ParsedToolCall | null {
  const cleaned = body.replace(SPECIAL_TOKEN, '').trim()
  if (!cleaned) return null
  try {
    const parsed = JSON.parse(cleaned) as { name?: unknown; arguments?: unknown }
    if (typeof parsed.name !== 'string') return null
    const args = parsed.arguments
    return {
      name: parsed.name,
      arguments: typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {},
    }
  } catch {
    return null
  }
}

/** Live view of a partial stream, used to hide markup while tokens are still arriving. */
export function parsePartial(raw: string): { content: string; reasoning: string; inThinkBlock: boolean } {
  const openThink = raw.lastIndexOf('<think>')
  const closeThink = raw.lastIndexOf('</think>')
  const parsed = parseModelOutput(raw)
  return {
    content: parsed.content.replace(/<tool_call>[\s\S]*$/, '').trim(),
    reasoning: parsed.reasoning,
    inThinkBlock: openThink > closeThink,
  }
}
