import type { CalendarEvent } from './types'

/**
 * Appointments live in IndexedDB, in their own database from memories and chats.
 *
 * A calendar is rewritten while a reply is streaming, and a synchronous
 * `localStorage` write on the main thread is what those stores already refuse.
 * Nothing here is uploaded.
 */

const DB_NAME = 'jarvis-calendar'
const DB_VERSION = 1
const STORE = 'events'

export function calendarDbAvailable(): boolean {
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
      reject(request.error ?? new Error('Could not open the calendar database'))
    }
    request.onblocked = () => {
      connection = null
      reject(new Error('The calendar is open in another tab running an older version'))
    }
  })
  return connection
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Calendar request failed'))
  })
}

function commit(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Calendar transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Calendar transaction aborted'))
  })
}

type Listener = () => void

const listeners = new Set<Listener>()

const channel =
  typeof window !== 'undefined' && 'BroadcastChannel' in window
    ? new BroadcastChannel('jarvis-calendar')
    : null

if (channel) channel.onmessage = () => announce()

/** Fired after every write, in this tab and in any other one that is open. */
export function onCalendarChange(listener: Listener): () => void {
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
  if (!calendarDbAvailable()) {
    throw new Error('this browser has no IndexedDB, so the calendar cannot be saved')
  }
}

/** Every appointment, earliest first. A browser that refuses IndexedDB reads as none. */
export async function readEvents(): Promise<CalendarEvent[]> {
  if (!calendarDbAvailable()) return []
  try {
    const database = await open()
    const records = await promisify<CalendarEvent[]>(
      database.transaction(STORE, 'readonly').objectStore(STORE).getAll(),
    )
    return records.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
  } catch {
    return []
  }
}

export async function writeEvents(records: CalendarEvent[]): Promise<void> {
  assertWritable()
  const database = await open()
  const transaction = database.transaction(STORE, 'readwrite')
  const store = transaction.objectStore(STORE)
  for (const record of records) store.put(record)
  await commit(transaction)
  notify()
}

export async function deleteEvents(ids: string[]): Promise<void> {
  assertWritable()
  if (ids.length === 0) return
  const database = await open()
  const transaction = database.transaction(STORE, 'readwrite')
  const store = transaction.objectStore(STORE)
  for (const id of ids) store.delete(id)
  await commit(transaction)
  notify()
}
