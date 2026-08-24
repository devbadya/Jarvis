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
    request.onsuccess = () => {
      const database = request.result
      // A cached handle to a closed database throws on every later
      // transaction, so both ways it can close have to drop the cache. The
      // first is another tab upgrading: refusing to get out of its way would
      // block that tab indefinitely, which is worse than reopening here.
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
      reject(request.error ?? new Error('Could not open the memory database'))
    }
    // Another tab holds an older version open. Nothing here can resolve that,
    // and hanging forever would freeze whichever action triggered the open.
    request.onblocked = () => {
      connection = null
      reject(new Error('Memory is open in another tab running an older version'))
    }
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
 * IndexedDB fires nothing when its contents change, and this app has two ways
 * to change them that React cannot see: the `memory` tool, which runs inside
 * the agent loop, and a second tab. `window.BroadcastChannel` covers the
 * second — jsdom does not implement it, hence the check rather than a bare
 * `typeof`, and there is nothing to fall back to if a browser lacks it beyond
 * that tab being a little out of date.
 */
const channel =
  typeof window !== 'undefined' && 'BroadcastChannel' in window ? new BroadcastChannel('jarvis-memory') : null

if (channel) channel.onmessage = () => announce()

/** Fired after every write, in this tab and in any other one that is open. */
export function onMemoryChange(listener: Listener): () => void {
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

/**
 * Reads degrade to nothing and writes refuse loudly. A browser that will not
 * store this — private mode, or storage switched off — must not be allowed to
 * accept a memory and drop it: the user would go on believing it was kept.
 */
function assertWritable(): void {
  if (!memoryDbAvailable()) {
    throw new Error('this browser has no IndexedDB, so nothing can be remembered')
  }
}

export async function writeRecords(records: MemoryRecord[]): Promise<void> {
  if (records.length === 0) return
  assertWritable()
  const database = await open()
  const transaction = database.transaction(STORE, 'readwrite')
  const store = transaction.objectStore(STORE)
  for (const record of records) store.put(record)
  await commit(transaction)
  notify()
}

export async function deleteRecords(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  assertWritable()
  const database = await open()
  const transaction = database.transaction(STORE, 'readwrite')
  const store = transaction.objectStore(STORE)
  for (const id of ids) store.delete(id)
  await commit(transaction)
  notify()
}
