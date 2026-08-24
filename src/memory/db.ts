import type { MemoryRecord } from './types'

/**
 * Memories live in IndexedDB.
 *
 * `localStorage` holds the rest of this app's settings and is the wrong place
 * for these: it is synchronous, so every write would block the main thread in
 * the middle of token streaming; it stores strings, so a single edit means
 * serialising the whole set; and it is unavailable to workers, which is where
 * anything later doing extraction in the background would have to run.
 * IndexedDB is asynchronous, stores structured objects, and shares the same
 * quota and persistence grant that `lib/storage.ts` already asks for on behalf
 * of the model weights.
 *
 * This module is persistence only. What may be stored, and what happens when
 * two memories say the same thing, is policy and lives in `manage.ts`.
 */

const DB_NAME = 'jarvis-memory'
const DB_VERSION = 1
const STORE = 'memories'

export function memoryDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

let connection: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      // No secondary indexes: the store is capped at a couple of hundred rows,
      // so every read is a full scan that costs less than maintaining an index.
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the memory database'))
    // Another tab holds an older version open. Nothing here can resolve that,
    // and hanging forever would freeze whichever action triggered the open.
    request.onblocked = () => reject(new Error('Memory is open in another tab running an older version'))
  })
  return connection
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Memory request failed'))
  })
}

function commit(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Memory transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Memory transaction aborted'))
  })
}

type Listener = () => void

const listeners = new Set<Listener>()

/**
 * Fired after every write. The model can change memory mid-turn through the
 * `memory` tool, which runs nowhere near React, so the panel has to be told
 * rather than polled.
 */
export function onMemoryChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  for (const listener of listeners) listener()
}

/** Every record, deleted ones included. Filtering by state is the caller's job. */
export async function readAllRecords(): Promise<MemoryRecord[]> {
  if (!memoryDbAvailable()) return []
  try {
    const database = await open()
    return await promisify(database.transaction(STORE, 'readonly').objectStore(STORE).getAll())
  } catch {
    // A browser in private mode, or a blocked upgrade. Memory is an
    // enhancement: losing it must never take the conversation down with it.
    return []
  }
}

export async function writeRecords(records: MemoryRecord[]): Promise<void> {
  if (!memoryDbAvailable() || records.length === 0) return
  const database = await open()
  const transaction = database.transaction(STORE, 'readwrite')
  const store = transaction.objectStore(STORE)
  for (const record of records) store.put(record)
  await commit(transaction)
  notify()
}

export async function deleteRecords(ids: string[]): Promise<void> {
  if (!memoryDbAvailable() || ids.length === 0) return
  const database = await open()
  const transaction = database.transaction(STORE, 'readwrite')
  const store = transaction.objectStore(STORE)
  for (const id of ids) store.delete(id)
  await commit(transaction)
  notify()
}

/** Test seam: drops the cached connection so a fresh database can be opened. */
export function resetMemoryDb(): void {
  connection = null
}
