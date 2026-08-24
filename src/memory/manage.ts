import { deleteRecords, readAllRecords, writeRecords } from './db'
import { normalizeText, tokenize } from './text'
import {
  coerceKind,
  MAX_MEMORIES,
  MAX_MEMORY_TEXT_CHARS,
  MAX_TRASHED,
  TRASH_RETENTION_MS,
  type MemoryKind,
  type MemoryRecord,
} from './types'

/**
 * Everything that decides *what* is stored, shared by the `memory` tool and the
 * panel so a memory written by the model and one typed by the user are subject
 * to exactly the same rules.
 *
 * Writes are explicit here — the model calls the tool, or the user types. There
 * is deliberately no background extraction pass over the transcript: ChatGPT's
 * "dreaming" and mem0's extractor both spend a second model call on every
 * conversation, and on a 0.8B model running on the user's own GPU that call
 * would double the cost of a turn to produce notes of a quality nobody wants
 * injected into the next prompt.
 */

export interface MemorySnapshot {
  /** Live memories, most recently touched first. */
  live: MemoryRecord[]
  /** Deleted but still restorable, most recently deleted first. */
  trashed: MemoryRecord[]
}

/** Short, lowercase, unambiguous under the model's transcription. */
function generateId(taken: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = Math.random().toString(36).slice(2, 8)
    if (id.length === 6 && !taken.has(id)) return id
  }
  return `${Date.now().toString(36)}`
}

function clampText(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length <= MAX_MEMORY_TEXT_CHARS ? trimmed : `${trimmed.slice(0, MAX_MEMORY_TEXT_CHARS - 1)}…`
}

function byUpdatedDesc(a: MemoryRecord, b: MemoryRecord): number {
  return b.updatedAt - a.updatedAt
}

function isLive(record: MemoryRecord): boolean {
  return record.deletedAt === undefined
}

function byDeletedDesc(a: MemoryRecord, b: MemoryRecord): number {
  return (b.deletedAt ?? 0) - (a.deletedAt ?? 0)
}

/**
 * Reads the store, dropping whatever the bin should no longer be holding:
 * anything past its retention, and anything beyond `MAX_TRASHED`.
 *
 * The count matters as much as the age. Nothing caps how often a memory can be
 * saved and deleted again, so an undo window with no ceiling is a way to grow
 * the database without ever exceeding the limit on live memories.
 *
 * Purging on read rather than on a timer keeps it to one place, and the only
 * cost is that a browser nobody opens keeps its bin a while longer.
 */
export async function loadMemory(now = Date.now()): Promise<MemorySnapshot> {
  const records = await readAllRecords()
  const trashed = records.filter((record) => !isLive(record)).sort(byDeletedDesc)

  const purged = new Set(
    trashed
      .filter((record, index) => index >= MAX_TRASHED || now - (record.deletedAt ?? 0) > TRASH_RETENTION_MS)
      .map((record) => record.id),
  )
  if (purged.size > 0) await deleteRecords([...purged])

  return {
    live: records.filter(isLive).sort(byUpdatedDesc),
    trashed: trashed.filter((record) => !purged.has(record.id)),
  }
}

export interface SaveOutcome {
  record: MemoryRecord
  /** The text was already stored; its timestamp was refreshed instead of a second copy being made. */
  duplicate: boolean
  /** Moved to the trash to stay under `MAX_MEMORIES`. */
  evicted?: MemoryRecord
}

export interface SaveInput {
  text: string
  kind?: unknown
  source: MemoryRecord['source']
}

/**
 * Stores one memory.
 *
 * Exact repeats are folded into the existing entry. Contradictions are not:
 * deciding that "lives in Berlin" and "lives in Lisbon" are the same slot needs
 * a model, and mem0 — which has one — still ships an append-only pipeline and
 * resolves the conflict at retrieval instead. Here recall prefers the most
 * recent, and the user can see both and delete one.
 */
export async function saveMemory(input: SaveInput, now = Date.now()): Promise<SaveOutcome> {
  const text = clampText(input.text)
  if (!text) throw new Error('text must not be empty')

  const kind: MemoryKind = coerceKind(input.kind)
  const records = await readAllRecords()
  const normalized = normalizeText(text)

  const existing = records.find((record) => isLive(record) && normalizeText(record.text) === normalized)
  if (existing) {
    const refreshed: MemoryRecord = { ...existing, kind, updatedAt: now }
    await writeRecords([refreshed])
    return { record: refreshed, duplicate: true }
  }

  const record: MemoryRecord = {
    id: generateId(new Set(records.map((entry) => entry.id))),
    text,
    kind,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  }

  const live = records.filter(isLive).sort(byUpdatedDesc)
  const stale = live.length >= MAX_MEMORIES ? live.at(-1) : undefined
  const evicted = stale ? { ...stale, deletedAt: now } : undefined

  await writeRecords(evicted ? [record, evicted] : [record])
  return { record, duplicate: false, ...(evicted ? { evicted } : {}) }
}

async function mutate(id: string, change: (record: MemoryRecord) => MemoryRecord): Promise<MemoryRecord> {
  const records = await readAllRecords()
  const found = records.find((record) => record.id === id)
  if (!found) throw new Error(`No memory with id ${id}`)
  const next = change(found)
  await writeRecords([next])
  return next
}

export async function updateMemory(
  id: string,
  changes: { text?: string; kind?: unknown },
  now = Date.now(),
): Promise<MemoryRecord> {
  const text = changes.text === undefined ? undefined : clampText(changes.text)
  if (text !== undefined && !text) throw new Error('text must not be empty')

  return mutate(id, (record) => ({
    ...record,
    ...(text === undefined ? {} : { text }),
    ...(changes.kind === undefined ? {} : { kind: coerceKind(changes.kind) }),
    // An edited memory is also an undeleted one: correcting an entry from the
    // trash should put it back rather than leave the fix invisible.
    deletedAt: undefined,
    updatedAt: now,
  }))
}

export async function deleteMemory(id: string, now = Date.now()): Promise<MemoryRecord> {
  return mutate(id, (record) => ({ ...record, deletedAt: now }))
}

export async function restoreMemory(id: string, now = Date.now()): Promise<MemoryRecord> {
  return mutate(id, (record) => ({ ...record, deletedAt: undefined, updatedAt: now }))
}

/** Soft-deletes everything live and reports how many. Recoverable from the panel. */
export async function clearMemories(now = Date.now()): Promise<number> {
  const live = (await readAllRecords()).filter(isLive)
  await writeRecords(live.map((record) => ({ ...record, deletedAt: now })))
  return live.length
}

export async function purgeMemory(id: string): Promise<void> {
  await deleteRecords([id])
}

export async function emptyTrash(): Promise<number> {
  const trashed = (await readAllRecords()).filter((record) => !isLive(record))
  await deleteRecords(trashed.map((record) => record.id))
  return trashed.length
}

/**
 * Memories that mention every word the query is actually about.
 *
 * This is how "forget that I live in Berlin" becomes an id. It compares
 * tokens — so the filler words in the model's phrasing are dropped and `live`
 * reaches `Lives in Berlin` — but every remaining word must be there. Requiring
 * all of them is what keeps the loose matching safe: an extra word narrows the
 * result to nothing, which the tool reports, where a partial match would delete
 * a memory nobody named.
 */
export function findMemories(records: MemoryRecord[], query: string): MemoryRecord[] {
  const asked = tokenize(query)
  if (asked.length === 0) return []
  return records.filter((record) => {
    const mentioned = new Set(tokenize(record.text))
    return asked.every((word) => mentioned.has(word))
  })
}
