/**
 * How long the model thought, and how that thinking reads.
 *
 * Reasoning arrives as one run of text, and reads as a wall of it. The model
 * does separate its steps, though — usually with a blank line, sometimes with a
 * single newline — so the breaks it already wrote are what the trace is drawn
 * from. Nothing is invented here: no step is split, merged or relabelled.
 */
export function splitThoughts(text: string): string[] {
  const paragraphs = pieces(text, /\n{2,}/)
  // A model that never left a blank line would otherwise get a one-step
  // "timeline", which is just an indented wall of text with a dot on it.
  return paragraphs.length > 1 ? paragraphs : pieces(text, /\n/)
}

function pieces(text: string, separator: RegExp): string[] {
  return text
    .split(separator)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
}

export interface ThinkingClock {
  /** Records which side of the block the stream is on, and returns the total so far. */
  observe: (inThinkBlock: boolean) => number
  elapsed: () => number
}

/**
 * Times the think block from the stream itself.
 *
 * With thinking enabled the chat template ends the prompt with an open
 * `<think>`, so the block is already running before the first token arrives and
 * no timestamp on the message could describe it. The only observable edge is
 * `inThinkBlock` flipping — and a turn that calls tools opens a block per
 * round, which is why this sums phases instead of keeping a start time.
 *
 * `stats.thinkTokens` cannot stand in for this. Tokens are not seconds, and a
 * throttling GPU makes the ratio between them drift within a single turn.
 */
export function createThinkingClock(now: () => number = () => performance.now()): ThinkingClock {
  let since: number | null = null
  let total = 0

  const elapsed = (): number => (since === null ? total : total + (now() - since))

  return {
    observe(inThinkBlock: boolean): number {
      if (inThinkBlock) since ??= now()
      else if (since !== null) {
        total += now() - since
        since = null
      }
      return elapsed()
    },
    elapsed,
  }
}
