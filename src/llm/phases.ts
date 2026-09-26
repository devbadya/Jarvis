/** Closing marker of Qwen's reasoning block, which the think budget cuts on. */
export const CLOSE_THINK = '</think>'

/**
 * Closes the reasoning block if the model has not closed it itself.
 *
 * When the budget runs out mid-sentence, appending the marker is what moves the
 * model from reasoning into answering. Leaving it open would let the second pass
 * carry on reasoning, which is the behaviour the budget exists to prevent.
 *
 * `appended` tells the caller whether anything was added, so the same text can be
 * streamed to the UI as was fed back into the model.
 */
export function closeReasoning(reasoning: string): { text: string; appended: string } {
  if (reasoning.includes(CLOSE_THINK)) return { text: reasoning, appended: '' }
  return { text: `${reasoning.trimEnd()}\n${CLOSE_THINK}`, appended: CLOSE_THINK }
}

/**
 * Splits generated text at the end of reasoning.
 *
 * The opening `<think>` lives in the prompt rather than the output, so everything
 * up to the first close marker is reasoning.
 */
export function splitReasoning(text: string): { reasoning: string; rest: string } {
  const close = text.indexOf(CLOSE_THINK)
  if (close === -1) return { reasoning: text, rest: '' }
  return { reasoning: text.slice(0, close), rest: text.slice(close + CLOSE_THINK.length) }
}

/**
 * Whether a pass stopped because it ran out of tokens while still reasoning.
 *
 * The baseline strategy lets reasoning run until the model stops, and on a
 * plain *Was ist der Unterschied zwischen dass und das?* the model spent all
 * 1024 tokens on an English "Thinking Process" and never answered. That text
 * then became the reply. A pass that closed its reasoning, or stopped short of
 * the budget, finished on its own and is left alone.
 */
export function reasoningRanOut(text: string, tokens: number, budget: number): boolean {
  return !text.includes(CLOSE_THINK) && tokens >= budget - RAN_OUT_MARGIN
}

/** Streamed chunks and tokens are not one-to-one, so "used the budget" allows a little slack. */
const RAN_OUT_MARGIN = 8
