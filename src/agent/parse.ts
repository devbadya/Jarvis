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

const CLOSE_THINK = '</think>'

/**
 * Splits off reasoning the model started before the stream began.
 *
 * With thinking enabled the chat template ends the prompt with an open `<think>`,
 * so the model's first tokens are already reasoning and the opening tag never
 * appears in the output — only its closing counterpart does.
 */
function takeLeadingReasoning(raw: string): { reasoning: string | null; rest: string } {
  const close = raw.indexOf(CLOSE_THINK)
  const open = raw.indexOf('<think>')
  if (close === -1 || (open !== -1 && open < close)) return { reasoning: null, rest: raw }
  return { reasoning: raw.slice(0, close).trim(), rest: raw.slice(close + CLOSE_THINK.length) }
}

/**
 * Qwen3.5 interleaves chain-of-thought in <think> blocks and emits tool calls as
 * JSON inside <tool_call> blocks. Both are stripped before display; a truncated
 * trailing block (generation hit the token cap) is tolerated.
 */
export function parseModelOutput(raw: string): ParsedOutput {
  const leading = takeLeadingReasoning(raw)
  const reasoning: string[] = leading.reasoning ? [leading.reasoning] : []
  const toolCalls: ParsedToolCall[] = []

  let content = leading.rest.replace(THINK_BLOCK, (_match, body: string) => {
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

const FUNCTION_BLOCK = /<function=([^>\s]+)>([\s\S]*?)(?:<\/function>|$)/
const PARAMETER_BLOCK = /<parameter=([^>\s]+)>([\s\S]*?)(?:<\/parameter>|$)/g

/**
 * Qwen3.5's chat template asks for an XML-ish call:
 *
 *   <tool_call><function=name><parameter=key>value</parameter></function></tool_call>
 *
 * Values arrive as raw text — the format carries no types — so they are passed to
 * tools as trimmed strings.
 */
function parseXmlToolCall(body: string): ParsedToolCall | null {
  const fn = FUNCTION_BLOCK.exec(body)
  if (!fn?.[1]) return null

  const args: Record<string, unknown> = {}
  for (const [, key, value] of (fn[2] ?? '').matchAll(PARAMETER_BLOCK)) {
    if (key) args[key] = (value ?? '').trim()
  }
  return { name: fn[1], arguments: args }
}

function parseJsonToolCall(body: string): ParsedToolCall | null {
  try {
    const parsed = JSON.parse(body) as { name?: unknown; arguments?: unknown }
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

function parseToolCallBody(body: string): ParsedToolCall | null {
  const cleaned = body.replace(SPECIAL_TOKEN, '').trim()
  if (!cleaned) return null
  // JSON remains supported because other Qwen builds emit it.
  return parseXmlToolCall(cleaned) ?? parseJsonToolCall(cleaned)
}

/** Live view of a partial stream, used to hide markup while tokens are still arriving. */
export function parsePartial(raw: string): { content: string; reasoning: string; inThinkBlock: boolean } {
  const openThink = raw.lastIndexOf('<think>')
  const closeThink = raw.lastIndexOf(CLOSE_THINK)
  const parsed = parseModelOutput(raw)
  return {
    content: parsed.content.replace(/<tool_call>[\s\S]*$/, '').trim(),
    reasoning: parsed.reasoning,
    // Nothing closed yet means we are still inside the block the prompt opened.
    inThinkBlock: closeThink === -1 || openThink > closeThink,
  }
}
