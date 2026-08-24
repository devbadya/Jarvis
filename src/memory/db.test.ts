import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryDbAvailable, readAllRecords, writeRecords } from './db'
import type { MemoryRecord } from './types'

const record: MemoryRecord = {
  id: 'abc123',
  text: 'Lives in Lisbon',
  kind: 'fact',
  source: 'user',
  createdAt: 0,
  updatedAt: 0,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a browser that will not store anything', () => {
  it('reads as empty rather than taking the conversation down with it', async () => {
    vi.stubGlobal('indexedDB', undefined)

    expect(memoryDbAvailable()).toBe(false)
    expect(await readAllRecords()).toEqual([])
  })

  it('refuses a write instead of accepting one it cannot keep', async () => {
    vi.stubGlobal('indexedDB', undefined)

    // The panel and the model both report what this throws. Returning quietly
    // would leave the user believing something had been remembered.
    await expect(writeRecords([record])).rejects.toThrow(/IndexedDB/)
  })
})
