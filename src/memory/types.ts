/**
 * What Jarvis is allowed to remember between sessions.
 *
 * The CoALA taxonomy (arXiv:2309.02427) splits an agent's memory four ways:
 * working memory is the live context window, and the three durable kinds are
 * semantic (facts), episodic (things that happened) and procedural (how to
 * behave). Only the durable three are stored here — working memory is the
 * transcript, which this app already keeps in the tab. The last place a
 * weather turn resolved is also pinned into the system prompt by `topic.ts`,
 * because a 0.8B model does not reliably read earlier turns.
 *
 * The kinds are named in plain words rather than in the paper's terms because
 * the model has to pick one: `preference` is a word a 0.8B model uses correctly
 * far more often than `procedural`.
 */
export const MEMORY_KINDS = ['fact', 'preference', 'event'] as const

export type MemoryKind = (typeof MEMORY_KINDS)[number]

export interface MemoryRecord {
  /**
   * Short and opaque rather than a UUID: the model quotes this id back to
   * update or delete an entry, and 36 characters is a lot for a small model to
   * copy without a typo.
   */
  id: string
  /** One self-contained sentence. Capped, because every one of these may be prompted with. */
  text: string
  kind: MemoryKind
  /** Whether the model wrote it during a turn or the user typed it in the panel. */
  source: 'model' | 'user'
  createdAt: number
  updatedAt: number
  /**
   * Set instead of erasing the row. A destructive tool call is one token away
   * from a 0.8B model misreading "forget it" as "forget everything", so
   * deletions are recoverable from the panel until they are purged.
   */
  deletedAt?: number
}

/** Roughly 50 tokens. A memory longer than this is a note, and notes do not belong in every prompt. */
export const MAX_MEMORY_TEXT_CHARS = 200

/**
 * The ceiling on the store. Recall only ever injects a handful, so a larger
 * store would not make answers better — it would only make the panel unusable
 * and the scan slower. Past this the oldest live memory is moved to the trash.
 */
export const MAX_MEMORIES = 200

/** How long a deleted memory stays restorable. */
export const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * How many deleted memories the bin holds, oldest dropped first.
 *
 * Retention alone does not bound it: saving and deleting can be repeated any
 * number of times without ever exceeding `MAX_MEMORIES`, so an undo window with
 * no ceiling is a way to fill the database anyway.
 */
export const MAX_TRASHED = 100

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value)
}

/** Tool arguments arrive as free text, so an unrecognised kind becomes the neutral one. */
export function coerceKind(value: unknown): MemoryKind {
  return isMemoryKind(value) ? value : 'fact'
}
