import type { ToolSchema } from '@/types'

export interface Tool {
  schema: ToolSchema
  /** Returns a compact string; it is fed straight back into the model's context. */
  execute: (args: Record<string, unknown>) => Promise<string>
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
