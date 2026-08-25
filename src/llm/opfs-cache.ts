/**
 * Model cache backed by the Origin Private File System.
 *
 * Transformers.js defaults to the Cache API, but Chrome rejects the ~448 MB
 * weights file there with "Failed to execute 'put' on 'Cache': Unexpected
 * internal error", so the download silently never persisted. OPFS is designed
 * for large binary files and streams them to disk without buffering the whole
 * body in memory.
 *
 * This backend also performs the download, which is the only place a resume can
 * live. Transformers.js reads a whole response into a buffer *before* handing it
 * to a cache, so by the time `put` is called every byte has already arrived and
 * a connection that dropped at 400 MB left nothing behind. Owning the fetch
 * means the bytes that did arrive stay on disk, and the next attempt continues
 * from them with a Range request. Upstream has this for Node's filesystem cache
 * (huggingface/transformers.js#1715); the browser side is still open (#1220).
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

export const MODEL_CACHE_DIR = 'model-cache'

/** Marks an in-flight download so an interrupted write is never mistaken for a complete file. */
const PARTIAL_SUFFIX = '.part'

/** Records what a partial is a prefix of, so a later attempt can prove it still matches. */
const META_SUFFIX = '.part-meta'

/** Written bytes are forced to disk this often, capping what a crash costs. */
const FLUSH_EVERY_BYTES = 16 * 1024 * 1024

export function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
}

async function cacheDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(MODEL_CACHE_DIR, { create: true })
}

interface ProgressUpdate {
  progress: number
  loaded: number
  total: number
}

/** `move` is implemented by Chrome for OPFS handles but is not yet in the DOM lib types. */
interface MovableFileHandle extends FileSystemFileHandle {
  move?: (name: string) => Promise<void>
}

/**
 * Publishes a finished download under its final name. `move` is a cheap rename;
 * the copy fallback exists only for engines that have OPFS but not `move`.
 */
async function publish(
  directory: FileSystemDirectoryHandle,
  partialName: string,
  finalName: string,
): Promise<void> {
  const partial = (await directory.getFileHandle(partialName)) as MovableFileHandle

  if (typeof partial.move === 'function') {
    await partial.move(finalName)
    return
  }

  const target = await directory.getFileHandle(finalName, { create: true })
  const writable = await target.createWritable()
  await (await partial.getFile()).stream().pipeTo(writable)
  await directory.removeEntry(partialName)
}

async function readMeta(directory: FileSystemDirectoryHandle, name: string): Promise<ResumeMeta | null> {
  try {
    const handle = await directory.getFileHandle(`${name}${META_SUFFIX}`)
    const parsed = JSON.parse(await (await handle.getFile()).text()) as Partial<ResumeMeta>
    if (typeof parsed.etag !== 'string' || typeof parsed.total !== 'number' || parsed.total <= 0) return null
    return { etag: parsed.etag, total: parsed.total }
  } catch {
    return null
  }
}

async function writeMeta(
  directory: FileSystemDirectoryHandle,
  name: string,
  meta: ResumeMeta | null,
): Promise<void> {
  if (!meta) {
    await discard(directory, `${name}${META_SUFFIX}`)
    return
  }
  const handle = await directory.getFileHandle(`${name}${META_SUFFIX}`, { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(meta))
  await writable.close()
}

async function discard(directory: FileSystemDirectoryHandle, ...names: string[]): Promise<void> {
  for (const name of names) await directory.removeEntry(name).catch(() => undefined)
}

/**
 * URLs this backend cannot download, as opposed to ones it failed to.
 *
 * A missing sync access handle or a file another writer holds will not fix
 * itself, so those are handed back to Transformers.js for good. A network
 * failure is the opposite: the next attempt is the one that resumes.
 */
const unavailable = new Set<string>()

/** One download per URL, however many callers ask for it. */
const inFlight = new Map<string, Promise<void>>()

/**
 * Fetches whatever is still missing and appends it to the partial.
 *
 * Returns true once every byte is on disk. A false return means the attempt is
 * worth repeating: what arrived has been kept, so the next one asks for less.
 * Throws only when the response was not a download at all.
 */
async function attempt(
  url: string,
  directory: FileSystemDirectoryHandle,
  access: FileSystemSyncAccessHandle,
  name: string,
): Promise<boolean> {
  const meta = await readMeta(directory, name)
  const saved = access.getSize()
  const resumeFrom = meta && saved > 0 && saved < meta.total ? saved : 0

  // A first attempt asks for the file exactly as Transformers.js would. Only a
  // continuation carries a Range, whose simple byte form needs no preflight.
  let response = await fetch(url, resumeFrom > 0 ? { headers: { Range: `bytes=${resumeFrom}-` } } : undefined)
  let plan = planWrite(headersOf(response), resumeFrom, meta)

  // The partial cannot be continued — the file changed upstream, or the host
  // ignored the range. Ask for the whole thing and overwrite.
  if (!plan && resumeFrom > 0) {
    response = await fetch(url)
    plan = planWrite(headersOf(response), 0, null)
  }
  if (!response.ok || !plan || !response.body) throw new Error(`HTTP ${response.status} for ${url}`)

  access.truncate(plan.start)
  const etag = response.headers.get('etag')
  await writeMeta(directory, name, plan.total > 0 && etag ? { etag, total: plan.total } : null)

  let position = plan.start
  let sinceFlush = 0
  let sinceReport = 0
  const reader = response.body.getReader()

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      access.write(value, { at: position })
      position += value.byteLength
      sinceFlush += value.byteLength
      sinceReport += value.byteLength
      if (sinceFlush >= FLUSH_EVERY_BYTES) {
        access.flush()
        sinceFlush = 0
      }
      if (sinceReport >= REPORT_EVERY_BYTES) {
        reportProgress({ url, loaded: position, total: plan.total })
        sinceReport = 0
      }
    }
  } finally {
    access.flush()
  }

  // A body that stops early is an unfinished download, not a shorter file. The
  // difference matters: Transformers.js sizes its buffer from the content length
  // and zero-pads the rest, so publishing this would mean corrupt weights.
  if (plan.total > 0 && position !== plan.total) {
    reportProgress({ url, loaded: position, total: plan.total })
    return false
  }

  reportProgress({ url, loaded: position, total: position })
  return true
}

/**
 * Downloads `url` into OPFS, continuing an earlier attempt where one is on disk
 * and retrying the transfer a few times before giving up.
 *
 * Leaves the file absent rather than throwing. `match` looks for the result, so
 * a failure here simply means Transformers.js downloads the file itself, as it
 * did before this backend existed.
 */
async function download(url: string): Promise<void> {
  const name = cacheKeyFor(url)
  const directory = await cacheDir()
  const partialName = `${name}${PARTIAL_SUFFIX}`
  const handle = await directory.getFileHandle(partialName, { create: true })

  // Only a dedicated worker gets a sync access handle, and only a sync handle
  // writes straight through to the file: a `FileSystemWritableFileStream`
  // buffers into a swap file that is discarded unless it is closed cleanly,
  // which would leave nothing to resume from.
  /** Only the empty file this function just created, never a real resume point. */
  const standAside = async (): Promise<void> => {
    unavailable.add(url)
    if ((await handle.getFile().catch(() => null))?.size === 0) await discard(directory, partialName)
  }

  if (typeof handle.createSyncAccessHandle !== 'function') {
    await standAside()
    return
  }

  let access: FileSystemSyncAccessHandle
  try {
    access = await handle.createSyncAccessHandle()
  } catch {
    // Another writer holds the file. Downloading it twice would be worse.
    await standAside()
    return
  }

  let closed = false
  try {
    for (let attemptsLeft = ATTEMPTS; attemptsLeft > 0; attemptsLeft -= 1) {
      let complete = false
      try {
        complete = await attempt(url, directory, access, name)
      } catch (error) {
        // A response that was not a download at all — a 404, a redirect to an
        // error page — will read the same way next time.
        if (error instanceof Error && error.message.startsWith('HTTP')) break
      }

      if (complete) {
        access.flush()
        access.close()
        closed = true
        await discard(directory, name, `${name}${META_SUFFIX}`)
        await publish(directory, partialName, name)
        return
      }
      if (attemptsLeft > 1) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  } catch {
    // A failure is reported by the file's absence, not by throwing: see above.
  } finally {
    if (!closed) {
      const saved = access.getSize()
      access.flush()
      access.close()
      // An empty partial is not a resume point, only clutter.
      if (saved === 0) await discard(directory, partialName, `${name}${META_SUFFIX}`)
    }
  }
}

function once(url: string): Promise<void> {
  let pending = inFlight.get(url)
  if (!pending) {
    pending = download(url).finally(() => inFlight.delete(url))
    inFlight.set(url, pending)
  }
  return pending
}

async function cachedResponse(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<Response | undefined> {
  try {
    const file = await (await directory.getFileHandle(name)).getFile()
    if (file.size === 0) return undefined
    return new Response(file, { headers: { 'content-length': String(file.size) } })
  } catch {
    return undefined
  }
}

export const opfsCache: ModelCacheBackend = {
  /**
   * The cached file, downloading it first if it is not there yet.
   *
   * Transformers.js also calls this to ask whether a file exists and how large
   * it is, and drops the body when it does — which is why the download finishes
   * before anything is returned rather than streaming through the response.
   */
  async match(request: string): Promise<Response | undefined> {
    if (!opfsAvailable()) return undefined

    let directory: FileSystemDirectoryHandle
    try {
      directory = await cacheDir()
    } catch {
      return undefined
    }

    const name = cacheKeyFor(request)
    const cached = await cachedResponse(directory, name)
    if (cached) return cached

    // Only a real URL can be fetched. Transformers.js also probes this cache
    // with local paths, which are not ours to go and download.
    if (unavailable.has(request) || !/^https?:\/\//.test(request)) return undefined

    await once(request)
    return cachedResponse(directory, name)
  },

  async put(
    request: string,
    response: Response,
    progress_callback?: (data: ProgressUpdate) => void,
  ): Promise<void> {
    if (!opfsAvailable() || !response.body) return

    const name = cacheKeyFor(request)
    const directory = await cacheDir()
    // A name of its own, so storing a file this backend did not download cannot
    // collide with a partial that is being resumed.
    const partialName = `${name}${PARTIAL_SUFFIX}-${crypto.randomUUID().slice(0, 8)}`
    const partial = await directory.getFileHandle(partialName, { create: true })
    const writable = await partial.createWritable()
    const total = Number(response.headers.get('content-length') ?? 0)

    try {
      const reader = response.body.getReader()
      let loaded = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        await writable.write(value)
        loaded += value.byteLength
        progress_callback?.({ progress: total > 0 ? (loaded / total) * 100 : 0, loaded, total })
      }
      await writable.close()
    } catch (error) {
      // Nothing written through a writable survives an abort, so there is no
      // partial worth keeping on this path — see `download` for the one there is.
      await writable.abort().catch(() => undefined)
      await discard(directory, partialName)
      throw error
    }

    // Publish under the real name only once the bytes are all on disk.
    await discard(directory, name)
    await publish(directory, partialName, name)
  },

  async delete(request: string): Promise<boolean> {
    if (!opfsAvailable()) return false
    try {
      await (await cacheDir()).removeEntry(cacheKeyFor(request))
      return true
    } catch {
      return false
    }
  },
}

async function listEntries(): Promise<CachedFile[]> {
  if (!opfsAvailable()) return []
  try {
    const directory = await cacheDir()
    const files: CachedFile[] = []
    for await (const [name, handle] of directory as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (handle.kind !== 'file') continue
      files.push({ name, size: (await (handle as FileSystemFileHandle).getFile()).size })
    }
    return files
  } catch {
    return []
  }
}

/** Complete files only: a partial is not something the app can load. */
export async function listCachedFiles(): Promise<CachedFile[]> {
  return (await listEntries()).filter((file) => !file.name.includes(PARTIAL_SUFFIX))
}

/** Unfinished downloads, which a later attempt will continue rather than repeat. */
export async function listPartialFiles(): Promise<CachedFile[]> {
  return (await listEntries()).filter((file) => file.name.endsWith(PARTIAL_SUFFIX))
}

/**
 * Removes cached files whose name matches, partials included: leaving a
 * half-downloaded 448 MB file behind after "Remove model" would occupy the
 * space the user asked to get back.
 */
export async function clearCachedFiles(predicate: (name: string) => boolean): Promise<void> {
  if (!opfsAvailable()) return
  const directory = await cacheDir()
  for (const file of await listEntries()) {
    if (predicate(file.name)) await discard(directory, file.name)
  }
}
