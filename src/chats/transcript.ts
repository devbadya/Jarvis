import type { Message, ToolCall } from '@/types'

const TITLE_CHARS = 72

/**
 * A tool that was still running when the tab closed would spin forever on the
 * next visit. The call did not finish, so it is stored as a failure.
 */
function settleCall(call: ToolCall): ToolCall {
  if (call.status !== 'running' && call.status !== 'pending') return call
  return { ...call, status: 'error', error: call.error ?? 'Stopped before it finished' }
}

/**
 * The transcript as it can be reopened.
 *
 * An assistant row that is only a streaming placeholder has nothing to show
 * and is left out, so a reload during the first tokens of a reply comes back
 * as the question on its own. `streaming` is cleared either way: restoring it
 * would leave a caret blinking on a reply that is no longer being written.
 */
export function durableMessages(messages: Message[]): Message[] {
  const kept: Message[] = []
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const hasBody = message.content.length > 0 || Boolean(message.error) || Boolean(message.toolCalls?.length)
    if (message.role === 'assistant' && !hasBody) continue
    const { streaming: _streaming, ...rest } = message
    kept.push({
      ...rest,
      ...(rest.toolCalls ? { toolCalls: rest.toolCalls.map(settleCall) } : {}),
    })
  }
  return kept
}

/** The first thing the user asked, shortened so a drawer row can hold it. */
export function chatTitle(messages: Message[]): string {
  const first = messages.find((message) => message.role === 'user')?.content ?? ''
  const title = first.trim().replace(/\s+/g, ' ')
  if (!title) return 'New chat'
  if (title.length <= TITLE_CHARS) return title
  return `${title.slice(0, TITLE_CHARS - 1).trimEnd()}…`
}
