/**
 * Model cache backed by the Origin Private File System.
 *
 * Transformers.js defaults to the Cache API, but Chrome rejects the ~440 MB
 * weights file there with "Failed to execute 'put' on 'Cache': Unexpected
 * internal error", so the download silently never persisted. OPFS is designed
 * for large binary files and streams them to disk without buffering the whole
 * body in memory.
 */

export const MODEL_CACHE_DIR = 'model-cache'

/** Marks an in-flight download so an interrupted write is never mistaken for a complete file. */
const PARTIAL_SUFFIX = '.part'

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

export const opfsCache = {
  async match(request: string): Promise<Response | undefined> {
    if (!opfsAvailable()) return undefined
    try {
      const handle = await (await cacheDir()).getFileHandle(cacheKeyFor(request))
      const file = await handle.getFile()
      if (file.size === 0) return undefined
      return new Response(file, { headers: { 'content-length': String(file.size) } })
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
      await writable.abort().catch(() => undefined)
      await directory.removeEntry(partialName).catch(() => undefined)
      throw error
    }

    // Publish under the real name only once the bytes are all on disk.
    await directory.removeEntry(name).catch(() => undefined)
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

export async function listCachedFiles(): Promise<CachedFile[]> {
  if (!opfsAvailable()) return []
  try {
    const directory = await cacheDir()
    const files: CachedFile[] = []
    for await (const [name, handle] of directory as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (handle.kind !== 'file' || name.endsWith(PARTIAL_SUFFIX)) continue
      files.push({ name, size: (await (handle as FileSystemFileHandle).getFile()).size })
    }
    return files
  } catch {
    return []
  }
}

export async function clearCachedFiles(predicate: (name: string) => boolean): Promise<void> {
  if (!opfsAvailable()) return
  const directory = await cacheDir()
  for (const file of await listCachedFiles()) {
    if (predicate(file.name)) await directory.removeEntry(file.name).catch(() => undefined)
  }
}
