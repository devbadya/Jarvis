import { beforeEach, describe, expect, it } from 'vitest'
import { deleteRecords, readAllRecords } from '@/memory/db'
import { loadMemory, saveMemory } from '@/memory/manage'
import { memory } from './memory'

async function emptyStore(): Promise<void> {
  const records = await readAllRecords()
  await deleteRecords(records.map((record) => record.id))
}

/** Ids are generated, so a test that wants one has to ask what it got. */
async function firstId(): Promise<string> {
  const { live } = await loadMemory()
  return live[0]?.id ?? ''
}

beforeEach(emptyStore)

describe('the memory tool', () => {
  it('saves what it is given and hands back the id', async () => {
    const result = await memory.execute({ command: 'save', text: 'Prefers metric units' })

    expect(result).toMatch(/^Saved \[\w{6}\] \(fact\) Prefers metric units$/)
    expect((await loadMemory()).live).toHaveLength(1)
  })

  it('takes the kind when the model supplies one', async () => {
    await memory.execute({ command: 'save', text: 'Prefers metric units', kind: 'preference' })

    expect((await loadMemory()).live[0]?.kind).toBe('preference')
  })

  it('accepts the verb the user used instead of the command name', async () => {
    // Qwen reaches for `remember` and `forget` far more readily than for the
    // schema's own words, and a rejected call costs a whole tool round.
    await memory.execute({ command: 'remember', text: 'Owns a bike' })
    expect(await memory.execute({ command: 'recall' })).toContain('Owns a bike')

    await memory.execute({ command: 'forget', query: 'owns a bike' })
    expect((await loadMemory()).live).toEqual([])
  })

  it('reads back what is stored, with ids to act on', async () => {
    await saveMemory({ text: 'Lives in Lisbon', source: 'user' })

    expect(await memory.execute({ command: 'list' })).toMatch(
      /^1 memory:\n\[\w{6}\] \(fact\) Lives in Lisbon$/,
    )
  })

  it('says plainly when it knows nothing', async () => {
    expect(await memory.execute({ command: 'list' })).toBe('Nothing remembered about the user yet.')
  })

  it('filters the list by a query', async () => {
    await saveMemory({ text: 'Lives in Lisbon', source: 'user' })
    await saveMemory({ text: 'Owns a bike', source: 'user' })

    expect(await memory.execute({ command: 'list', query: 'bike' })).toContain('Owns a bike')
    expect(await memory.execute({ command: 'list', query: 'bike' })).not.toContain('Lisbon')
  })

  it('corrects an entry by id', async () => {
    await saveMemory({ text: 'Lives in Berlin', source: 'model' })

    const result = await memory.execute({ command: 'update', id: await firstId(), text: 'Lives in Lisbon' })

    expect(result).toContain('Lives in Lisbon')
    expect((await loadMemory()).live).toHaveLength(1)
  })

  it('deletes the one memory a query names', async () => {
    await saveMemory({ text: 'Lives in Lisbon', source: 'user' })

    expect(await memory.execute({ command: 'delete', query: 'lives in Lisbon' })).toContain('Deleted')

    const { live, trashed } = await loadMemory()
    expect(live).toEqual([])
    expect(trashed).toHaveLength(1)
  })

  it('asks which one rather than deleting the wrong memory', async () => {
    await saveMemory({ text: 'Lives in Lisbon', source: 'user' })
    await saveMemory({ text: 'Works in Lisbon', source: 'user' })

    await expect(memory.execute({ command: 'delete', query: 'Lisbon' })).rejects.toThrow(/matches 2 memories/)
    expect((await loadMemory()).live).toHaveLength(2)
  })

  it('refuses a query that matches nothing', async () => {
    await expect(memory.execute({ command: 'delete', query: 'a bike' })).rejects.toThrow('no memory matches')
  })

  it('refuses an id it does not have', async () => {
    await expect(memory.execute({ command: 'delete', id: 'zzzzzz' })).rejects.toThrow('no memory has id')
  })

  it('will not wipe everything without being asked twice', async () => {
    await saveMemory({ text: 'Lives in Lisbon', source: 'user' })
    await saveMemory({ text: 'Owns a bike', source: 'user' })

    await expect(memory.execute({ command: 'clear' })).rejects.toThrow(/confirm=yes/)
    expect((await loadMemory()).live).toHaveLength(2)

    expect(await memory.execute({ command: 'clear', confirm: 'yes' })).toContain('Deleted all 2 memories')
    expect((await loadMemory()).live).toEqual([])
  })

  it('names the commands it does have when given one it does not', async () => {
    await expect(memory.execute({ command: 'summarise' })).rejects.toThrow(
      'unknown command "summarise". Use one of: save, list, update, delete, clear',
    )
  })

  it('reads a bare text argument as a save', async () => {
    await memory.execute({ text: 'Owns a bike' })
    expect((await loadMemory()).live.map((entry) => entry.text)).toEqual(['Owns a bike'])
  })

  it('describes itself in one line the model can route on', () => {
    expect(memory.schema.function.name).toBe('memory')
    expect(memory.schema.function.parameters.required).toEqual(['command'])
  })
})
