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

const STOPWORDS = new Set([
  'the',
  'and',
  'but',
  'for',
  'you',
  'your',
  'yours',
  'are',
  'was',
  'were',
  'not',
  'that',
  'this',
  'with',
  'what',
  'when',
  'where',
  'which',
  'who',
  'how',
  'why',
  'about',
  'from',
  'into',
  'have',
  'has',
  'had',
  'can',
  'could',
  'would',
  'should',
  'did',
  'does',
  'done',
  'please',
  'tell',
  'give',
  'them',
  'they',
  'there',
  'then',
  'than',
  'get',
  'got',
])

/**
 * A trailing `s` is dropped so `lives` matches `live` and `bikes` matches
 * `bike`. That is the whole of the stemming here, deliberately: the question is
 * "does this memory mention what was asked about", and a real stemmer is a
 * dependency and a table of exceptions for a handful of extra hits.
 */
function stem(word: string): string {
  return word.length >= 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}

/** Words worth matching on: three letters or more, and not one everybody uses. */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return words.filter((word) => word.length >= 3 && !STOPWORDS.has(word)).map(stem)
}

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
    if (used + record.text.length > budget) continue
    selected.push(record)
    used += record.text.length
  }
  return selected
}

/**
 * The block appended to the system prompt. Bare sentences, no ids and no kinds:
 * the model needs the fact, and every other character is one the answer does
 * not get. An empty string when there is nothing to recall, so a prompt is
 * never lengthened to say that nothing is known.
 */
export function renderMemoryBlock(records: MemoryRecord[]): string {
  if (records.length === 0) return ''
  const lines = records.map((record) => `- ${record.text}`).join('\n')
  return `What you already know about this user:\n${lines}`
}

/** Convenience for the one place that does both. */
export function recallFor(query: string, records: MemoryRecord[]): string {
  return renderMemoryBlock(selectMemories(query, records))
}
