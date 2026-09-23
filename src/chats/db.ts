import { MAX_CHATS, type ChatRecord, type ChatSummary } from './types'

/**
 * Conversations live in IndexedDB, in their own database from memories.
 *
 * A transcript is the wrong shape for `localStorage`: it is rewritten as a
 * reply streams, and a synchronous write on the main thread is exactly what
 * the memory store already refuses to do. Nothing here is uploaded. The cap
 * and the title are decided by the caller; this module stores the record and
 * drops the least recently updated conversation past {@link MAX_CHATS}.
 */

const DB_NAME = 'jarvis-chats'
const DB_VERSION = 1
const STORE = 'chats'

export function chatsDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

let connection: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => {
        database.close()
        connection = null
      }
      database.onclose = () => {
        connection = null
      }
      resolve(database)
    }
    request.onerror = () => {
      connection = null
      reject(request.error ?? new Error('Could not open the chat database'))
    }
    request.onblocked = () => {
      connection = null
      reject(new Error('Chats are open in another tab running an older version'))
    }
  })
  return connection
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Chat request failed'))
  })
}

function commit(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Chat transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Chat transaction aborted'))
  })
}

type Listener = () => void

const listeners = new Set<Listener>()

const channel =
  typeof window !== 'undefined' && 'BroadcastChannel' in window ? new BroadcastChannel('jarvis-chats') : null

if (channel) channel.onmessage = () => announce()

/** Fired after every write, in this tab and in any other one that is open. */
export function onChatsChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function announce(): void {
  for (const listener of listeners) listener()
}

function notify(): void {
  announce()
  channel?.postMessage('changed')
}

function assertWritable(): void {
  if (!chatsDbAvailable()) {
    throw new Error('this browser has no IndexedDB, so chats cannot be saved')
  }
}

function toSummary(record: ChatRecord): ChatSummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Every saved conversation, newest first. A browser that refuses IndexedDB reads as none. */
export async function listChats(): Promise<ChatSummary[]> {
  if (!chatsDbAvailable()) return []
  try {
    const database = await open()
    const records = await promisify<ChatRecord[]>(
      database.transaction(STORE, 'readonly').objectStore(STORE).getAll(),
    )
    return records.map(toSummary).sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export async function readChat(id: string): Promise<ChatRecord | null> {
  if (!chatsDbAvailable()) return null
  try {
    const database = await open()
    const record = await promisify<ChatRecord | undefined>(
      database.transaction(STORE, 'readonly').objectStore(STORE).get(id),
    )
    return record ?? null
  } catch {
    return null
  }
}

async function dropOldest(activeId: string): Promise<void> {
  const database = await open()
  const records = await promisify<ChatRecord[]>(
    database.transaction(STORE, 'readonly').objectStore(STORE).getAll(),
  )
  if (records.length <= MAX_CHATS) return
  const overflow = records.length - MAX_CHATS
  const drop = records
    .filter((record) => record.id !== activeId)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, overflow)
  if (drop.length === 0) return
  const transaction = database.transaction(STORE, 'readwrite')
  const store = transaction.objectStore(STORE)
  for (const record of drop) store.delete(record.id)
  await commit(transaction)
}

/**
 * Writes one conversation and enforces the cap.
 *
 * `createdAt` is kept from the row already stored, so a later reply does not
 * look like a chat that was just started. Returns the list the drawer shows.
 */
export async function saveChat(record: ChatRecord): Promise<ChatSummary[]> {
  assertWritable()
  const existing = await readChat(record.id)
  const stored: ChatRecord = { ...record, createdAt: existing?.createdAt ?? record.createdAt }
  const database = await open()
  const transaction = database.transaction(STORE, 'readwrite')
  transaction.objectStore(STORE).put(stored)
  await commit(transaction)
  await dropOldest(stored.id)
  notify()
  return listChats()
}

export async function deleteChat(id: string): Promise<void> {
  assertWritable()
  const database = await open()
  const transaction = database.transaction(STORE, 'readwrite')
  transaction.objectStore(STORE).delete(id)
  await commit(transaction)
  notify()
}
