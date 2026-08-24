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
 * live. Transformers.js reads the whole response into a buffer *before* handing
 * it to a cache, so by the time `put` is called every byte has already arrived
 * and a connection that dropped at 400 MB left nothing behind. Owning the fetch
 * on the read side instead means a partial file survives the failure and the
 * next attempt continues from it. Upstream has this for Node's filesystem cache
 * (huggingface/transformers.js#1715); the browser side is still open (#1220).
 */

export const MODEL_CACHE_DIR = 'model-cache'

/** Marks an in-flight download so an interrupted write is never mistaken for a complete file. */
const PARTIAL_SUFFIX = '.part'

/** Records what a partial is a prefix of, so a later attempt can prove it still matches. */
const META_SUFFIX = '.part-meta'

/** Written bytes are forced to disk this often, capping what a crash costs. */
const FLUSH_EVERY_BYTES = 16 * 1024 * 1024

/** Read size when replaying an existing partial back to the caller. */
const REPLAY_CHUNK_BYTES = 4 * 1024 * 1024

export function cacheKeyFor(request: string): string {
  return request.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_')
}

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

/** What an unfinished download is known to be a prefix of. */
export interface ResumeMeta {
  /** Entity tag the bytes on disk came from. */
  etag: string
  /** Size of the complete file. */
  total: number
}

/** Where a response's bytes belong in the file being assembled. */
export interface WritePlan {
  /** Offset the body starts at. Zero for a full response. */
  start: number
  /** Size of the complete file, or 0 when the server did not say. */
  total: number
}

/** `bytes 1024-4095/4096` → where the body starts and how large the file is. */
function parseContentRange(value: string | null): { start: number; total: number } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value?.trim() ?? '')
  if (!match) return null
  return { start: Number(match[1]), total: Number(match[3]) }
}

/**
 * Whether a response can be appended to what is already on disk.
 *
 * A 206 is trusted only when it continues the partial exactly: same entity tag,
 * same total, starting where the file ends. The check cannot be delegated to
 * the server, because the Hub's CDN ignores `If-Range` — a stale validator
 * still comes back as 206 with the old range, which would splice bytes from two
 * different files together. A 200 is always a whole file, so it restarts.
 * Anything else means this backend should stand aside.
 */
export function planWrite(
  response: {
    status: number
    etag: string | null
    contentRange: string | null
    contentLength: string | null
  },
  requested: number,
  meta: ResumeMeta | null,
): WritePlan | null {
  if (response.status === 200) {
    return { start: 0, total: Number(response.contentLength ?? 0) || 0 }
  }
  if (response.status !== 206 || requested <= 0 || !meta) return null

  const range = parseContentRange(response.contentRange)
  if (!range || range.start !== requested || range.total !== meta.total) return null
  if (!response.etag || response.etag !== meta.etag) return null
  return range
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
  meta: ResumeMeta,
): Promise<void> {
  const handle = await directory.getFileHandle(`${name}${META_SUFFIX}`, { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(meta))
  await writable.close()
}

async function discard(directory: FileSystemDirectoryHandle, ...names: string[]): Promise<void> {
  for (const name of names) await directory.removeEntry(name).catch(() => undefined)
}

/**
 * URLs this backend has already declined to download.
 *
 * Transformers.js re-checks the cache before storing a file it fetched itself,
 * and that check must not kick off a second download of the same bytes.
 */
const declined = new Set<string>()

function headersOf(response: Response) {
  return {
    status: response.status,
    etag: response.headers.get('etag'),
    contentRange: response.headers.get('content-range'),
    contentLength: response.headers.get('content-length'),
  }
}

/**
 * Streams `source` into the partial file while handing the same bytes on to the
 * caller, replaying whatever an earlier attempt already saved first so the
 * consumer still sees the whole file.
 */
function assemble(
  access: FileSystemSyncAccessHandle,
  plan: WritePlan,
  source: ReadableStream<Uint8Array>,
  finish: () => Promise<void>,
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  let replayed = 0
  let position = plan.start
  let sinceFlush = 0
  let open = true

  /** Leaves the bytes so far on disk: the next attempt is what they are for. */
  const release = (): void => {
    if (!open) return
    open = false
    access.flush()
    access.close()
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (replayed < plan.start) {
          const chunk = new Uint8Array(Math.min(REPLAY_CHUNK_BYTES, plan.start - replayed))
          const read = access.read(chunk, { at: replayed })
          if (read === 0) throw new Error('The partial download could not be read back')
          replayed += read
          controller.enqueue(read === chunk.length ? chunk : chunk.subarray(0, read))
          return
        }

        const { done, value } = await reader.read()
        if (done) {
          // A body that stops early has to be an error, not a shorter file. The
          // consumer sizes its buffer from the content length and pads the rest
          // with zeros, so a truncated transfer would otherwise be published as
          // corrupt weights rather than retried.
          if (plan.total > 0 && position !== plan.total) {
            throw new Error(`Transfer ended at ${position} of ${plan.total} bytes`)
          }
          release()
          await finish()
          controller.close()
          return
        }

        access.write(value, { at: position })
        position += value.byteLength
        sinceFlush += value.byteLength
        if (sinceFlush >= FLUSH_EVERY_BYTES) {
          access.flush()
          sinceFlush = 0
        }
        controller.enqueue(value)
      } catch (error) {
        release()
        controller.error(error)
      }
    },
    cancel(reason) {
      release()
      return reader.cancel(reason)
    },
  })
}

/**
 * Downloads `url` into OPFS and streams it back, continuing an earlier attempt
 * where one is on disk.
 *
 * Returns undefined when this backend cannot take the download on — no sync
 * access handle, a request that failed, or a response the partial cannot be
 * reconciled with. Transformers.js then fetches the file itself exactly as it
 * did before, so the fallback costs correctness nothing.
 */
async function download(url: string): Promise<Response | undefined> {
  const name = cacheKeyFor(url)
  const partialName = `${name}${PARTIAL_SUFFIX}`
  const directory = await cacheDir()
  const handle = await directory.getFileHandle(partialName, { create: true })

  // Only a dedicated worker gets a sync access handle, and only a sync handle
  // writes straight through to the file: a `FileSystemWritableFileStream`
  // buffers into a swap file that is discarded unless it is closed cleanly,
  // which would leave nothing to resume from.
  if (typeof handle.createSyncAccessHandle !== 'function') {
    declined.add(url)
    return undefined
  }

  let access: FileSystemSyncAccessHandle
  try {
    access = await handle.createSyncAccessHandle()
  } catch {
    // Another writer holds the file. Downloading it twice would be worse.
    declined.add(url)
    return undefined
  }

  try {
    const meta = await readMeta(directory, name)
    const saved = access.getSize()
    const resumeFrom = meta && saved > 0 && saved < meta.total ? saved : 0

    // A first attempt asks for the file exactly as Transformers.js would. Only a
    // continuation carries a Range, whose simple byte form needs no preflight.
    let response = await fetch(
      url,
      resumeFrom > 0 ? { headers: { Range: `bytes=${resumeFrom}-` } } : undefined,
    )
    let plan = planWrite(headersOf(response), resumeFrom, meta)

    // The partial cannot be continued — the file changed upstream, or the host
    // ignored the range. Ask for the whole thing and overwrite.
    if (!plan && resumeFrom > 0) {
      response = await fetch(url)
      plan = planWrite(headersOf(response), 0, null)
    }
    if (!plan || !response.ok || !response.body) {
      throw new Error(`HTTP ${response.status} for ${url}`)
    }

    access.truncate(plan.start)

    const etag = response.headers.get('etag')
    if (plan.total > 0 && etag) await writeMeta(directory, name, { etag, total: plan.total })
    else await discard(directory, `${name}${META_SUFFIX}`)

    const body = assemble(access, plan, response.body, async () => {
      await discard(directory, name, `${name}${META_SUFFIX}`)
      await publish(directory, partialName, name)
    })

    // Transformers.js reports progress against this, so a resumed download has
    // to declare the size of the whole file rather than of the tail.
    return new Response(body, plan.total > 0 ? { headers: { 'content-length': String(plan.total) } } : {})
  } catch {
    const saved = access.getSize()
    access.flush()
    access.close()
    // An empty partial is not a resume point, only clutter.
    if (saved === 0) await discard(directory, partialName, `${name}${META_SUFFIX}`)
    declined.add(url)
    return undefined
  }
}

export const opfsCache = {
  async match(request: string): Promise<Response | undefined> {
    if (!opfsAvailable()) return undefined

    try {
      const handle = await (await cacheDir()).getFileHandle(cacheKeyFor(request))
      const file = await handle.getFile()
      if (file.size > 0) return new Response(file, { headers: { 'content-length': String(file.size) } })
    } catch {
      // Not installed yet, which is the interesting case below.
    }

    // Only a real URL can be fetched. Transformers.js also probes this cache
    // with local paths, which are not ours to go and download.
    if (declined.has(request) || !/^https?:\/\//.test(request)) return undefined

    try {
      return await download(request)
    } catch {
      return undefined
    }
  },

  async put(
    request: string,
    response: Response,
    progress_callback?: (data: ProgressUpdate) => void,
  ): Promise<void> {
    if (!opfsAvailable() || !response.body) return

    const name = cacheKeyFor(request)
    const directory = await cacheDir()
    const partialName = `${name}${PARTIAL_SUFFIX}`
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

export interface CachedFile {
  name: string
  size: number
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
