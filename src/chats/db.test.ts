import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatsDbAvailable, deleteChat, listChats, readChat, saveChat } from './db'
import { MAX_CHATS, type ChatRecord } from './types'

function record(id: string, updatedAt: number): ChatRecord {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt,
    messages: [{ id: 'u', role: 'user', content: id, createdAt: 1 }],
  }
}

async function empty(): Promise<void> {
  const chats = await listChats()
  for (const chat of chats) await deleteChat(chat.id)
}

afterEach(async () => {
  vi.unstubAllGlobals()
  if (chatsDbAvailable()) await empty()
})

describe('saveChat', () => {
  it('keeps the original createdAt when the same chat is saved again', async () => {
    await saveChat(record('a', 10))
    await saveChat({ ...record('a', 20), createdAt: 99, title: 'renamed' })

    const stored = await readChat('a')
    expect(stored?.createdAt).toBe(1)
    expect(stored?.updatedAt).toBe(20)
    expect(stored?.title).toBe('renamed')
  })

  it('drops the least recently updated chat past the cap, and never the one just saved', async () => {
    for (let index = 0; index < MAX_CHATS + 1; index++) {
      await saveChat(record(`c${index}`, index))
    }

    const ids = (await listChats()).map((chat) => chat.id)
    expect(ids).toHaveLength(MAX_CHATS)
    expect(ids).toContain(`c${MAX_CHATS}`)
    expect(ids).not.toContain('c0')
  })
})

describe('a browser that will not store anything', () => {
  it('lists nothing rather than taking the conversation down with it', async () => {
    vi.stubGlobal('indexedDB', undefined)

    expect(chatsDbAvailable()).toBe(false)
    expect(await listChats()).toEqual([])
    expect(await readChat('missing')).toBeNull()
  })

  it('refuses a write instead of accepting one it cannot keep', async () => {
    vi.stubGlobal('indexedDB', undefined)

    await expect(saveChat(record('a', 1))).rejects.toThrow(/IndexedDB/)
  })
})
