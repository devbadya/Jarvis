import type { ToolSchema } from '@/types'

/**
 * What the turn is about, passed to every tool and asked of none.
 *
 * `read_page` needs the question to decide which part of a long page is worth
 * the model's context, and the alternative was a fourth argument on the schema
 * for the model to fill in. That would spend tool-calling accuracy — which falls
 * as arguments multiply — on something the agent loop already knows. A tool that
 * has no use for it simply ignores it.
 */
export interface ToolContext {
  /** The user's message for this turn, verbatim. */
  question: string
}

export interface Tool {
  schema: ToolSchema
  /** Returns a compact string; it is fed straight back into the model's context. */
  execute: (args: Record<string, unknown>, context?: ToolContext) => Promise<string>
}

export function defineTool(
  name: string,
  description: string,
  parameters: ToolSchema['function']['parameters'],
  execute: Tool['execute'],
): Tool {
  return {
    schema: { type: 'function', function: { name, description, parameters } },
    execute,
  }
}
