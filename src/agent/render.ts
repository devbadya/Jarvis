/**
 * The inverse of `parse.ts`: turns a tool call back into the markup Qwen emits.
 *
 * Skill exemplars need this. Telling a 0.8B model about a format does not work
 * nearly as well as showing it — few-shot examples are worth around +21.5 points
 * on small-model tool use where prose documentation is worth about +5
 * (arXiv:2604.20148) — and an example is only worth anything if it is byte-for-byte
 * the shape the model is supposed to produce.
 */
export function renderToolCall(name: string, args: Record<string, string>): string {
  const parameters = Object.entries(args)
    .map(([key, value]) => `<parameter=${key}>${value}</parameter>`)
    .join('')
  return `<tool_call><function=${name}>${parameters}</function></tool_call>`
}
