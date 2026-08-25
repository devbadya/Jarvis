/**
 * Model cache backed by IndexedDB, for browsers where OPFS is not usable.
 *
 * OPFS is the better home for 448 MB of weights and stays the default: it takes
 * raw bytes without passing them through the structured clone algorithm, writes
 * through a synchronous handle, and can be written at an offset — measured
 * across the ecosystem at roughly an order of magnitude faster for large
 * sequential writes. This exists because "not usable" happens: Safari disables
 * OPFS entirely in private browsing, and an engine can expose
 * `navigator.storage.getDirectory` without the synchronous access handle the
 * resumable path needs. Until now those cases fell through to the Cache API,
 * which is exactly where the 448 MB file fails — so the model was re-downloaded
 * on every single visit. Slower storage beats no storage by that margin.
 *
 * The file is split across records rather than stored as one value. A single
 * 448 MB entry would have to be assembled in memory before it could be written
 * and again after it was read, and a transfer interrupted at 400 MB would leave
 * nothing behind. Chunks are appended one at a time, each committed with the
 * byte count in the same transaction so the two cannot disagree, which is what
 * makes a resume possible here at all.
 */

import {
  ATTEMPTS,
  REPORT_EVERY_BYTES,
  RETRY_DELAY_MS,
  cacheKeyFor,
  headersOf,
  planWrite,
  reportProgress,
  type CachedFile,
  type ModelCacheBackend,
  type ResumeMeta,
} from './resume'

const DB_NAME = 'jarvis-model-cache'
const DB_VERSION = 1
const FILES = 'files'
const CHUNKS = 'chunks'

/**
 * How much of the download one record holds.
 *
 * Every chunk is a structured-clone copy on the way in, so larger records mean
 * fewer copies; but a chunk is also the unit a resume rounds down to, and the
 * largest allocation held in memory at once. Four megabytes puts a 448 MB file
 * in a bit over a hundred records and risks losing four of them to an
 * interruption.
 */
export const CHUNK_BYTES = 4 * 1024 * 1024

/** One file's worth of bookkeeping. The bytes are in `CHUNKS`. */
interface FileRecord {
  name: string
  /** Entity tag the stored bytes came from, when the host provided one. */
  etag: string | null
  /** Size of the complete file, or 0 when the host did not say. */
  total: number
  /** Bytes stored so far, always the exact sum of this file's chunks. */
  loaded: number
  /** How many chunk records there are, which is where the next one goes. */
  chunks: number
  /** Whether every byte arrived. Anything else is a resume point, not a file. */
  complete: boolean
}

export function idbCacheAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

let connection: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(FILES)) database.createObjectStore(FILES, { keyPath: 'name' })
      if (!database.objectStoreNames.contains(CHUNKS)) {
        // Keyed by name and position together, so one file's chunks are a
        // contiguous range that can be read in order and deleted in one call.
        database.createObjectStore(CHUNKS, { keyPath: ['name', 'index'] })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      // A cached handle to a closed database throws on every later transaction.
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
      reject(request.error ?? new Error('Could not open the model cache'))
    }
    request.onblocked = () => {
      connection = null
      reject(new Error('The model cache is open in another tab running an older version'))
    }
  })
  return connection
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Model cache request failed'))
  })
}

function commit(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Model cache transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Model cache transaction aborted'))
  })
}

/** Every chunk of one file, as a key range. */
function chunksOf(name: string): IDBKeyRange {
  return IDBKeyRange.bound([name, 0], [name, Number.MAX_SAFE_INTEGER])
}

async function readRecord(name: string): Promise<FileRecord | null> {
  const database = await open()
  const record = await promisify<FileRecord | undefined>(
    database.transaction(FILES, 'readonly').objectStore(FILES).get(name),
  )
  return record ?? null
}

/**
 * Appends one chunk and records that it is there, in a single transaction.
 *
 * Bytes stored without their count would be re-downloaded; a count without its
 * bytes would make the file a lie that only surfaces when the weights are
 * loaded. Neither happens if the two land together or not at all.
 */
async function appendChunk(record: FileRecord, bytes: Uint8Array): Promise<FileRecord> {
  const database = await open()
  const transaction = database.transaction([FILES, CHUNKS], 'readwrite')
  transaction.objectStore(CHUNKS).put({ name: record.name, index: record.chunks, bytes })
  const next: FileRecord = {
    ...record,
    chunks: record.chunks + 1,
    loaded: record.loaded + bytes.byteLength,
  }
  transaction.objectStore(FILES).put(next)
  await commit(transaction)
  return next
}

async function writeRecord(record: FileRecord): Promise<void> {
  const database = await open()
  const transaction = database.transaction(FILES, 'readwrite')
  transaction.objectStore(FILES).put(record)
  await commit(transaction)
}

/** Drops a file and its bytes together, so no chunk is ever left orphaned. */
async function removeFile(name: string): Promise<void> {
  const database = await open()
  const transaction = database.transaction([FILES, CHUNKS], 'readwrite')
  transaction.objectStore(FILES).delete(name)
  transaction.objectStore(CHUNKS).delete(chunksOf(name))
  await commit(transaction)
}

/**
 * The stored file as a body, read one chunk at a time.
 *
 * Deliberately a stream rather than a single blob: concatenating a hundred-odd
 * records would hold the whole 448 MB in this worker's heap before the consumer
 * had asked for any of it. Each pull opens a transaction of its own, which is
 * the price of not doing that.
 */
function bodyOf(name: string, chunks: number): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= chunks) {
        controller.close()
        return
      }
      try {
        const database = await open()
        const chunk = await promisify<{ bytes: Uint8Array } | undefined>(
          database.transaction(CHUNKS, 'readonly').objectStore(CHUNKS).get([name, index]),
        )
        if (!chunk) throw new Error(`Chunk ${index} of ${name} is missing`)
        controller.enqueue(new Uint8Array(chunk.bytes))
        index += 1
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

async function cachedResponse(name: string): Promise<Response | undefined> {
  const record = await readRecord(name)
  if (!record?.complete || record.loaded === 0) return undefined
  return new Response(bodyOf(name, record.chunks), {
    headers: { 'content-length': String(record.loaded) },
  })
}

/** A file with no bytes yet, ready to be appended to. */
function emptyRecord(name: string): FileRecord {
  return { name, etag: null, total: 0, loaded: 0, chunks: 0, complete: false }
}

/**
 * Gathers a stream into whole records.
 *
 * Both ways bytes arrive — downloaded here, or handed over by Transformers.js —
 * store them identically, and the part that has to be right in both is that a
 * record is only ever written whole. `pending` is the one copy of the download
 * held in memory, and it never exceeds one chunk.
 */
function chunkWriter(initial: FileRecord, chunkBytes: number) {
  let record = initial
  let pending: Uint8Array[] = []
  let pendingBytes = 0

  const flush = async (): Promise<void> => {
    if (pendingBytes === 0) return
    const chunk = new Uint8Array(pendingBytes)
    let at = 0
    for (const part of pending) {
      chunk.set(part, at)
      at += part.byteLength
    }
    pending = []
    pendingBytes = 0
    record = await appendChunk(record, chunk)
  }

  return {
    /** Everything received, whether or not it has reached a record yet. */
    get loaded(): number {
      return record.loaded + pendingBytes
    },
    /** Everything committed, which is what survives an interruption. */
    get stored(): FileRecord {
      return record
    },
    async add(bytes: Uint8Array): Promise<void> {
      pending.push(bytes)
      pendingBytes += bytes.byteLength
      if (pendingBytes >= chunkBytes) await flush()
    },
    flush,
  }
}

/**
 * URLs this backend cannot download, as opposed to ones it failed to. A network
 * failure is worth another attempt; a 404 will read the same way next time.
 */
const unavailable = new Set<string>()

/** One download per URL, however many callers ask for it. */
const inFlight = new Map<string, Promise<void>>()

/**
 * Fetches whatever is still missing and appends it.
 *
 * Returns true once every byte is stored. A false return means the attempt is
 * worth repeating: what arrived has been kept, so the next one asks for less.
 * Throws only when the response was not a download at all.
 */
async function attempt(url: string, name: string, chunkBytes: number): Promise<boolean> {
  const stored = await readRecord(name)
  const meta: ResumeMeta | null =
    stored && stored.etag && stored.total > 0 ? { etag: stored.etag, total: stored.total } : null
  const resumeFrom = stored && meta && stored.loaded > 0 && stored.loaded < meta.total ? stored.loaded : 0

  // A first attempt asks for the file exactly as Transformers.js would. Only a
  // continuation carries a Range, whose simple byte form needs no preflight.
  let response = await fetch(url, resumeFrom > 0 ? { headers: { Range: `bytes=${resumeFrom}-` } } : undefined)
  let plan = planWrite(headersOf(response), resumeFrom, meta)

  // What is stored cannot be continued — the file changed upstream, or the host
  // ignored the range. Ask for the whole thing and replace it.
  if (!plan && resumeFrom > 0) {
    response = await fetch(url)
    plan = planWrite(headersOf(response), 0, null)
  }
  if (!response.ok || !plan || !response.body) throw new Error(`HTTP ${response.status} for ${url}`)

  const etag = response.headers.get('etag')
  let record: FileRecord
  if (plan.start === 0) {
    await removeFile(name)
    record = { ...emptyRecord(name), etag, total: plan.total }
    await writeRecord(record)
  } else {
    record = { ...(stored ?? emptyRecord(name)), etag, total: plan.total }
  }

  const writer = chunkWriter(record, chunkBytes)
  const reader = response.body.getReader()
  let sinceReport = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      await writer.add(value)
      sinceReport += value.byteLength
      if (sinceReport >= REPORT_EVERY_BYTES) {
        reportProgress({ url, loaded: writer.loaded, total: plan.total })
        sinceReport = 0
      }
    }
    await writer.flush()
  } catch {
    // Whatever reached a record is still stored and still resumable — including
    // the tail this flush commits, which is why it runs before giving up.
    await writer.flush().catch(() => undefined)
    return false
  }

  // A body that stops early is an unfinished download, not a shorter file. The
  // difference matters: Transformers.js sizes its buffer from the content length
  // and zero-pads the rest, so publishing this would mean corrupt weights.
  const written = writer.stored
  if (plan.total > 0 && written.loaded !== plan.total) {
    reportProgress({ url, loaded: written.loaded, total: plan.total })
    return false
  }

  await writeRecord({ ...written, complete: true, total: written.loaded })
  reportProgress({ url, loaded: written.loaded, total: written.loaded })
  return true
}

/**
 * Downloads `url` into IndexedDB, continuing an earlier attempt where one is
 * stored and retrying the transfer a few times before giving up.
 *
 * Leaves the file absent rather than throwing. `match` looks for the result, so
 * a failure here simply means Transformers.js downloads the file itself.
 */
async function download(url: string, chunkBytes: number): Promise<void> {
  const name = cacheKeyFor(url)

  for (let attemptsLeft = ATTEMPTS; attemptsLeft > 0; attemptsLeft -= 1) {
    try {
      if (await attempt(url, name, chunkBytes)) return
    } catch {
      // Either the response was not a download at all — a 404, a redirect to an
      // error page — or the database refused outright. Both read the same way
      // next time, so this URL is handed back to Transformers.js for good.
      unavailable.add(url)
      return
    }
    if (attemptsLeft > 1) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
  }
}

function once(url: string, chunkBytes: number): Promise<void> {
  let pending = inFlight.get(url)
  if (!pending) {
    pending = download(url, chunkBytes).finally(() => inFlight.delete(url))
    inFlight.set(url, pending)
  }
  return pending
}

/**
 * The record size is a parameter rather than a constant so the multi-record
 * paths can be exercised without moving megabytes through a fake IndexedDB,
 * whose structured clone is thousands of times slower than a browser's.
 */
export function createIdbCache(chunkBytes: number = CHUNK_BYTES): ModelCacheBackend {
  return {
    /**
     * The cached file, downloading it first if it is not there yet.
     *
     * Transformers.js also calls this to ask whether a file exists and how
     * large it is, and drops the body when it does — which is why the download
     * finishes before anything is returned rather than streaming through the
     * response.
     */
    async match(request: string): Promise<Response | undefined> {
      if (!idbCacheAvailable()) return undefined

      const name = cacheKeyFor(request)
      try {
        const cached = await cachedResponse(name)
        if (cached) return cached

        // Only a real URL can be fetched. Transformers.js also probes this
        // cache with local paths, which are not ours to go and download.
        if (unavailable.has(request) || !/^https?:\/\//.test(request)) return undefined

        await once(request, chunkBytes)
        return await cachedResponse(name)
      } catch {
        // A browser that will not open the database at all — private mode, or
        // storage switched off. Transformers.js fetches the file itself.
        return undefined
      }
    },

    async put(
      request: string,
      response: Response,
      progress_callback?: (data: { progress: number; loaded: number; total: number }) => void,
    ): Promise<void> {
      if (!idbCacheAvailable() || !response.body) return

      const name = cacheKeyFor(request)
      const total = Number(response.headers.get('content-length') ?? 0)
      await removeFile(name)
      const record: FileRecord = { ...emptyRecord(name), total }
      await writeRecord(record)

      const writer = chunkWriter(record, chunkBytes)
      const reader = response.body.getReader()

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          await writer.add(value)
          const loaded = writer.loaded
          progress_callback?.({ progress: total > 0 ? (loaded / total) * 100 : 0, loaded, total })
        }
        await writer.flush()
      } catch (error) {
        // Half a file under the real name would be loaded as if it were whole.
        // Unlike a download, nothing here can resume it: the body is gone.
        await removeFile(name)
        throw error
      }

      await writeRecord({ ...writer.stored, complete: true, total: writer.stored.loaded })
    },

    async delete(request: string): Promise<boolean> {
      if (!idbCacheAvailable()) return false
      try {
        const name = cacheKeyFor(request)
        if (!(await readRecord(name))) return false
        await removeFile(name)
        return true
      } catch {
        return false
      }
    },
  }
}

export const idbCache: ModelCacheBackend = createIdbCache()

async function allRecords(): Promise<FileRecord[]> {
  if (!idbCacheAvailable()) return []
  try {
    const database = await open()
    return await promisify<FileRecord[]>(database.transaction(FILES, 'readonly').objectStore(FILES).getAll())
  } catch {
    return []
  }
}

/** Complete files only: a partial is not something the app can load. */
export async function listIdbCachedFiles(): Promise<CachedFile[]> {
  return (await allRecords())
    .filter((record) => record.complete)
    .map((record) => ({ name: record.name, size: record.loaded }))
}

/** Unfinished downloads, which a later attempt will continue rather than repeat. */
export async function listIdbPartialFiles(): Promise<CachedFile[]> {
  return (await allRecords())
    .filter((record) => !record.complete && record.loaded > 0)
    .map((record) => ({ name: record.name, size: record.loaded }))
}

/**
 * Removes cached files whose name matches, partials included: leaving a
 * half-downloaded 448 MB file behind after "Remove model" would occupy the
 * space the user asked to get back.
 */
export async function clearIdbCachedFiles(predicate: (name: string) => boolean): Promise<void> {
  for (const record of await allRecords()) {
    if (predicate(record.name)) await removeFile(record.name)
  }
}
