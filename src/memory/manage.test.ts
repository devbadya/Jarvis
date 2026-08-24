import { beforeEach, describe, expect, it } from 'vitest'
import { deleteRecords, readAllRecords, writeRecords } from './db'
import {
  clearMemories,
  deleteMemory,
  emptyTrash,
  findMemories,
  loadMemory,
  purgeMemory,
  restoreMemory,
  saveMemory,
  updateMemory,
} from './manage'
import {
  MAX_MEMORIES,
  MAX_MEMORY_TEXT_CHARS,
  MAX_TRASHED,
  TRASH_RETENTION_MS,
  type MemoryRecord,
} from './types'

/** These run against `fake-indexeddb`, which `src/test/setup.ts` installs globally. */
async function emptyStore(): Promise<void> {
  const records = await readAllRecords()
  await deleteRecords(records.map((record) => record.id))
}

function record(overrides: Partial<MemoryRecord> & { id: string }): MemoryRecord {
  return {
    text: `memory ${overrides.id}`,
    kind: 'fact',
    source: 'user',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

beforeEach(emptyStore)

describe('saveMemory', () => {
  it('stores a memory and reads it back', async () => {
    await saveMemory({ text: 'Lives in Lisbon', kind: 'fact', source: 'user' })

    const { live } = await loadMemory()
    expect(live.map((entry) => entry.text)).toEqual(['Lives in Lisbon'])
    expect(live[0]?.id).toHaveLength(6)
  })

  it('folds an exact repeat into the entry that is already there', async () => {
    const first = await saveMemory({ text: 'Prefers tea', source: 'user' }, 1_000)
    const again = await saveMemory({ text: '  prefers TEA.  ', source: 'model' }, 2_000)

    expect(again.duplicate).toBe(true)
    expect(again.record.id).toBe(first.record.id)
    expect(again.record.updatedAt).toBe(2_000)
    expect((await loadMemory()).live).toHaveLength(1)
  })

  it('keeps a contradiction rather than guessing which one is current', async () => {
    await saveMemory({ text: 'Lives in Berlin', source: 'user' }, 1_000)
    await saveMemory({ text: 'Lives in Lisbon', source: 'user' }, 2_000)

    // Both are kept, newest first, so recall prefers the correction and the
    // panel shows the user exactly what there is to disagree with.
    expect((await loadMemory()).live.map((entry) => entry.text)).toEqual([
      'Lives in Lisbon',
      'Lives in Berlin',
    ])
  })

  it('shortens a memory too long to belong in every prompt', async () => {
    const { record: saved } = await saveMemory({ text: 'x'.repeat(500), source: 'model' })

    expect(saved.text).toHaveLength(MAX_MEMORY_TEXT_CHARS)
    expect(saved.text.endsWith('…')).toBe(true)
  })

  it('falls back to a fact when the model invents a kind', async () => {
    const { record: saved } = await saveMemory({ text: 'Owns a bike', kind: 'thought', source: 'model' })
    expect(saved.kind).toBe('fact')
  })

  it('refuses an empty memory', async () => {
    await expect(saveMemory({ text: '   ', source: 'model' })).rejects.toThrow('must not be empty')
  })

  it('bins the oldest when the store is full', async () => {
    await writeRecords(
      Array.from({ length: MAX_MEMORIES }, (_, index) => record({ id: `id${index}`, updatedAt: index + 1 })),
    )

    const outcome = await saveMemory({ text: 'The newest thing', source: 'user' }, 10_000)

    expect(outcome.evicted?.id).toBe('id0')
    const { live, trashed } = await loadMemory(10_000)
    expect(live).toHaveLength(MAX_MEMORIES)
    expect(trashed.map((entry) => entry.id)).toEqual(['id0'])
  })
})

describe('deleting', () => {
  it('moves a memory to the bin rather than erasing it', async () => {
    const { record: saved } = await saveMemory({ text: 'Lives in Lisbon', source: 'user' })

    await deleteMemory(saved.id, 5_000)

    const { live, trashed } = await loadMemory(5_000)
    expect(live).toEqual([])
    expect(trashed.map((entry) => entry.text)).toEqual(['Lives in Lisbon'])
  })

  it('restores one from the bin', async () => {
    const { record: saved } = await saveMemory({ text: 'Lives in Lisbon', source: 'user' })
    await deleteMemory(saved.id, 5_000)

    await restoreMemory(saved.id, 6_000)

    expect((await loadMemory(6_000)).live.map((entry) => entry.text)).toEqual(['Lives in Lisbon'])
  })

  it('clears everything into the bin at once', async () => {
    await saveMemory({ text: 'One', source: 'user' })
    await saveMemory({ text: 'Two', source: 'user' })

    expect(await clearMemories(5_000)).toBe(2)

    const { live, trashed } = await loadMemory(5_000)
    expect(live).toEqual([])
    expect(trashed).toHaveLength(2)
  })

  it('purges a single memory for good', async () => {
    const { record: saved } = await saveMemory({ text: 'One', source: 'user' })
    await deleteMemory(saved.id)

    await purgeMemory(saved.id)

    expect(await readAllRecords()).toEqual([])
  })

  it('empties the bin without touching what is live', async () => {
    const { record: kept } = await saveMemory({ text: 'Kept', source: 'user' })
    const { record: dropped } = await saveMemory({ text: 'Dropped', source: 'user' })
    await deleteMemory(dropped.id)

    expect(await emptyTrash()).toBe(1)
    expect((await readAllRecords()).map((entry) => entry.id)).toEqual([kept.id])
  })

  it('keeps the bin to a fixed size, oldest deletion first', async () => {
    // Saving and deleting can be repeated for ever without ever exceeding the
    // limit on live memories, so the bin needs a ceiling of its own.
    await writeRecords(
      Array.from({ length: MAX_TRASHED + 5 }, (_, index) =>
        record({ id: `id${index}`, deletedAt: index + 1 }),
      ),
    )

    const { trashed } = await loadMemory(1_000)

    expect(trashed).toHaveLength(MAX_TRASHED)
    expect(trashed.at(-1)?.id).toBe('id5')
    expect(await readAllRecords()).toHaveLength(MAX_TRASHED)
  })

  it('drops a memory the bin has held past its retention', async () => {
    const { record: saved } = await saveMemory({ text: 'Long gone', source: 'user' }, 0)
    await deleteMemory(saved.id, 0)

    const { trashed } = await loadMemory(TRASH_RETENTION_MS + 1)

    expect(trashed).toEqual([])
    expect(await readAllRecords()).toEqual([])
  })
})

describe('updateMemory', () => {
  it('replaces the text and keeps the id', async () => {
    const { record: saved } = await saveMemory({ text: 'Lives in Berlin', source: 'model' }, 1_000)

    const updated = await updateMemory(saved.id, { text: 'Lives in Lisbon' }, 2_000)

    expect(updated).toMatchObject({ id: saved.id, text: 'Lives in Lisbon', createdAt: 1_000 })
  })

  it('brings a correction back out of the bin', async () => {
    const { record: saved } = await saveMemory({ text: 'Lives in Berlin', source: 'model' })
    await deleteMemory(saved.id)

    await updateMemory(saved.id, { text: 'Lives in Lisbon' })

    expect((await loadMemory()).live.map((entry) => entry.text)).toEqual(['Lives in Lisbon'])
  })

  it('says so when the id does not exist', async () => {
    await expect(updateMemory('nope01', { text: 'Anything' })).rejects.toThrow('No memory with id nope01')
  })
})

describe('findMemories', () => {
  const records = [
    record({ id: 'a', text: 'Lives in Lisbon' }),
    record({ id: 'b', text: 'Works in Lisbon on Tuesdays' }),
    record({ id: 'c', text: 'Prefers metric units' }),
  ]

  it('matches every word of the query, in any order', () => {
    expect(findMemories(records, 'lisbon lives').map((entry) => entry.id)).toEqual(['a'])
  })

  it('sees past the filler in the way the model phrases it', () => {
    // The shape a delete actually arrives in. Matching raw words missed this
    // on "that" and again on "live" against "Lives".
    expect(findMemories(records, 'that I live in Lisbon').map((entry) => entry.id)).toEqual(['a'])
  })

  it('finds nothing when the query names something extra', () => {
    // Better than deleting the closest thing: the tool reports the miss and
    // the model can list and pick an id.
    expect(findMemories(records, 'lives in Lisbon with a cat')).toEqual([])
  })

  it('returns every candidate when the query is ambiguous', () => {
    expect(findMemories(records, 'Lisbon').map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('does not match on a fragment of a word', () => {
    // "metr" would delete "Prefers metric units" if this were a substring test.
    expect(findMemories(records, 'metr')).toEqual([])
  })

  it('matches nothing for an empty query', () => {
    expect(findMemories(records, '   ')).toEqual([])
  })
})
