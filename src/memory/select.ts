import { tokenize } from './text'
import type { MemoryRecord } from './types'

/**
 * Recall.
 *
 * Memories are put in front of the model by adding them to the system prompt,
 * not by hoping it calls a tool to look them up. Every production assistant
 * that ships memory does it this way — ChatGPT injects a synthesised memory
 * state at the start of a conversation — and here there is a second reason:
 * a 0.8B model that had to call a tool before answering "what did I tell you
 * about my flat?" would usually just answer, and spend one of four tool rounds
 * when it did remember.
 *
 * Selection is lexical rather than semantic. An embedding model is another
 * download and another forward pass per turn; word overlap over a store capped
 * at a couple of hundred short sentences costs nothing and is wrong in ways the
 * user can see and fix, since the panel shows exactly what is stored.
 */

/**
 * Injected memories compete with the skill guidance and the reply for the same
 * context, and this app has already measured a longer system prompt dropping
 * tool use to 1 in 6. Roughly 100 tokens is the most this is worth.
 */
export const MAX_RECALL_CHARS = 400

/** Beyond a handful the model starts answering about the wrong one. */
export const MAX_RECALL_ENTRIES = 6

/**
 * Preferences apply to a turn that never mentions them — "keep answers short"
 * is relevant to every question — so they are carried without needing a lexical
 * hit. Facts and events are not: injecting all of them would be a worse version
 * of pasting the user's profile into every prompt.
 */
export const MAX_STANDING_PREFERENCES = 3

/** How many distinct query words the memory mentions. */
export function scoreMemory(query: string, record: MemoryRecord): number {
  const asked = new Set(tokenize(query))
  if (asked.size === 0) return 0
  return new Set(tokenize(record.text).filter((word) => asked.has(word))).size
}

/**
 * The memories worth spending prompt on for this turn: the standing
 * preferences, then whatever the message actually asks about, newest first
 * within each group so a later correction outranks the thing it corrects.
 */
export function selectMemories(
  query: string,
  records: MemoryRecord[],
  options: { limit?: number; budget?: number } = {},
): MemoryRecord[] {
  const limit = options.limit ?? MAX_RECALL_ENTRIES
  const budget = options.budget ?? MAX_RECALL_CHARS

  const byRecency = [...records].sort((a, b) => b.updatedAt - a.updatedAt)
  const standing = byRecency
    .filter((record) => record.kind === 'preference')
    .slice(0, MAX_STANDING_PREFERENCES)
  const chosen = new Set(standing)

  const matched = byRecency
    .filter((record) => !chosen.has(record))
    .map((record) => ({ record, score: scoreMemory(query, record) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt)
    .map((entry) => entry.record)

  const selected: MemoryRecord[] = []
  let used = 0
  for (const record of [...standing, ...matched]) {
    if (selected.length >= limit) break
    // Skipped rather than stopped at: one long memory should not shut out the
    // shorter ones behind it when they would all have fitted.
    const cost = renderMemoryLine(record).length
    if (used + cost > budget) continue
    selected.push(record)
    used += cost
  }
  return selected
}

/**
 * One memory as the model will read it. No id and no kind: it needs the fact,
 * and every other character is one the answer does not get.
 *
 * An `event` is the exception and carries the date it was recorded, because an
 * undated one is precisely the failure that made OpenAI rebuild memory — "going
 * to Singapore in July" is still read as upcoming in September. Nothing here
 * can rewrite a stale memory, but the model can weigh one it is told the age of.
 */
export function renderMemoryLine(record: MemoryRecord): string {
  const noted =
    record.kind === 'event' ? ` (noted ${new Date(record.createdAt).toISOString().slice(0, 10)})` : ''
  return `- ${record.text}${noted}`
}

/**
 * The block appended to the system prompt. An empty string when there is
 * nothing to recall, so a prompt is never lengthened to say that nothing is
 * known.
 */
export function renderMemoryBlock(records: MemoryRecord[]): string {
  if (records.length === 0) return ''
  return `What you already know about this user:\n${records.map(renderMemoryLine).join('\n')}`
}

/** Convenience for the one place that does both. */
export function recallFor(query: string, records: MemoryRecord[]): string {
  return renderMemoryBlock(selectMemories(query, records))
}
