import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCachedFiles, listCachedFiles, listPartialFiles, opfsCache } from './opfs-cache'
import { cacheKeyFor, setDownloadProgress, type DownloadProgress } from './resume'
import { complete, severed, tail, truncated, weights } from '@/test/responses'

/**
 * In-memory stand-in for OPFS: jsdom implements none of it, and the resume path
 * is mostly about what survives on disk between two attempts.
 */
function fakeOpfs() {
  const files = new Map<string, Uint8Array>()
  const locked = new Set<string>()

  const bytesOf = (value: unknown): Uint8Array =>
    typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value as ArrayBufferLike)

  function handleFor(name: string) {
    const read = (): Uint8Array => files.get(name) ?? new Uint8Array()
    return {
      kind: 'file' as const,
      name,
      // Node's Blob rather than jsdom's: only that one has the `stream()` a
      // Response body is read through.
      getFile: async () => new NodeBlob([read()]),
      move: async (next: string) => {
        files.set(next, read())
        files.delete(name)
      },
      createWritable: async () => {
        let buffer = new Uint8Array()
        return {
          write: async (chunk: unknown) => {
            const incoming = bytesOf(chunk instanceof Uint8Array ? chunk : chunk)
            const next = new Uint8Array(buffer.length + incoming.length)
            next.set(buffer)
            next.set(incoming, buffer.length)
            buffer = next
          },
          close: async () => void files.set(name, buffer),
          abort: async () => undefined,
        }
      },
      createSyncAccessHandle: async () => {
        if (locked.has(name)) throw new Error('NoModificationAllowedError')
        locked.add(name)
        return {
          getSize: () => read().length,
          read: (buffer: Uint8Array, options?: { at?: number }) => {
            const source = read()
            const at = options?.at ?? 0
            const length = Math.max(0, Math.min(buffer.length, source.length - at))
            buffer.set(source.subarray(at, at + length))
            return length
          },
          write: (chunk: Uint8Array, options?: { at?: number }) => {
            const at = options?.at ?? 0
            const current = read()
            const next = new Uint8Array(Math.max(current.length, at + chunk.length))
            next.set(current)
            next.set(chunk, at)
            files.set(name, next)
            return chunk.length
          },
          truncate: (size: number) => {
            const current = read()
            const next = new Uint8Array(size)
            next.set(current.subarray(0, Math.min(size, current.length)))
            files.set(name, next)
          },
          flush: () => undefined,
          close: () => void locked.delete(name),
        }
      },
    }
  }

  const directory = {
    kind: 'directory' as const,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (!options?.create) throw new Error('NotFoundError')
        files.set(name, new Uint8Array())
      }
      return handleFor(name)
    },
    removeEntry: async (name: string) => {
      if (!files.delete(name)) throw new Error('NotFoundError')
    },
    [Symbol.asyncIterator]: async function* () {
      for (const name of [...files.keys()]) yield [name, handleFor(name)] as const
    },
  }

  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
      getDirectory: async () => ({ getDirectoryHandle: async () => directory }),
    },
  })

  return files
}

const WEIGHTS = weights(4096)

async function drain(response: Response | undefined): Promise<Uint8Array> {
  if (!response) throw new Error('nothing to read')
  return new Uint8Array(await response.arrayBuffer())
}

let files: Map<string, Uint8Array>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  files = fakeOpfs()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  setDownloadProgress(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * Each test uses a URL of its own. The cache remembers which downloads it had to
 * hand back to Transformers.js, and that memory is per module rather than per test.
 */
function urlFor(name: string): string {
  return `https://huggingface.co/onnx-community/Model/resolve/main/${name}`
}

describe('opfsCache downloads', () => {
  it('downloads to disk and publishes under the final name', async () => {
    const url = urlFor('fresh.onnx_data')
    fetchMock.mockResolvedValueOnce(complete(WEIGHTS))

    expect(await drain(await opfsCache.match(url))).toEqual(WEIGHTS)

    expect(files.get(cacheKeyFor(url))).toEqual(WEIGHTS)
    expect([...files.keys()].filter((name) => name.includes('.part'))).toEqual([])
    // A first attempt asks for the file exactly as Transformers.js would.
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined()
  })

  it('reports progress, since Transformers.js never sees this download', async () => {
    const url = urlFor('progress.onnx_data')
    const seen: DownloadProgress[] = []
    setDownloadProgress((progress: DownloadProgress) => void seen.push(progress))
    fetchMock.mockResolvedValueOnce(complete(WEIGHTS))

    await drain(await opfsCache.match(url))

    expect(seen.at(-1)).toEqual({ url, loaded: WEIGHTS.length, total: WEIGHTS.length })
  })

  it('serves an installed file without going near the network', async () => {
    const url = urlFor('installed.onnx_data')
    files.set(cacheKeyFor(url), WEIGHTS)

    expect(await drain(await opfsCache.match(url))).toEqual(WEIGHTS)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never fetches for the local paths Transformers.js also probes', async () => {
    expect(await opfsCache.match('/models/onnx-community/Model/onnx/model_q4f16.onnx_data')).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resumes from what arrived when the connection drops mid-transfer', async () => {
    const url = urlFor('dropped.onnx_data')
    fetchMock.mockResolvedValueOnce(severed(WEIGHTS, 1500)).mockResolvedValueOnce(tail(WEIGHTS, 1500))

    expect(await drain(await opfsCache.match(url))).toEqual(WEIGHTS)

    // The second attempt asked only for the bytes that were still missing.
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({ headers: { Range: 'bytes=1500-' } })
    expect(files.get(cacheKeyFor(url))).toEqual(WEIGHTS)
    expect([...files.keys()].filter((name) => name.includes('.part'))).toEqual([])
  })

  it('keeps the partial for the next attempt when every attempt fails', async () => {
    const url = urlFor('offline.onnx_data')
    const key = cacheKeyFor(url)
    fetchMock
      .mockResolvedValueOnce(severed(WEIGHTS, 1500))
      .mockResolvedValueOnce(severed(WEIGHTS, 1500))
      .mockResolvedValueOnce(severed(WEIGHTS, 1500))

    // Nothing loadable is on offer, so the app must not call itself installed.
    expect(await opfsCache.match(url)).toBeUndefined()
    expect(files.has(key)).toBe(false)
    expect(files.get(`${key}.part`)).toEqual(WEIGHTS.subarray(0, 1500))
    expect(await listCachedFiles()).toEqual([])
    expect(await listPartialFiles()).toEqual([{ name: `${key}.part`, size: 1500 }])

    fetchMock.mockResolvedValueOnce(tail(WEIGHTS, 1500))
    expect(await drain(await opfsCache.match(url))).toEqual(WEIGHTS)
    expect(fetchMock.mock.calls[3]?.[1]).toEqual({ headers: { Range: 'bytes=1500-' } })
  })

  it('starts again when the file changed upstream while a partial was on disk', async () => {
    const url = urlFor('changed.onnx_data')
    const key = cacheKeyFor(url)
    const replacement: Uint8Array<ArrayBuffer> = new Uint8Array(2048).fill(7)

    // The Hub ignores If-Range, so a stale partial is answered with a 206 that
    // belongs to different bytes. It has to be recognised here.
    fetchMock
      .mockResolvedValueOnce(severed(WEIGHTS, 900))
      .mockResolvedValueOnce(tail(replacement, 900, '"a-new-export"'))
      .mockResolvedValueOnce(complete(replacement, '"a-new-export"'))

    expect(await drain(await opfsCache.match(url))).toEqual(replacement)
    expect(files.get(key)).toEqual(replacement)
  })

  it('starts again when the host ignores the range and sends the whole file', async () => {
    const url = urlFor('no-ranges.onnx_data')
    fetchMock.mockResolvedValueOnce(severed(WEIGHTS, 700)).mockResolvedValueOnce(complete(WEIGHTS))

    expect(await drain(await opfsCache.match(url))).toEqual(WEIGHTS)
    expect(files.get(cacheKeyFor(url))).toEqual(WEIGHTS)
  })

  it('treats a body that stops short as unfinished rather than as a shorter file', async () => {
    const url = urlFor('short.onnx_data')
    const key = cacheKeyFor(url)
    fetchMock
      .mockResolvedValueOnce(truncated(WEIGHTS, 2000))
      .mockResolvedValueOnce(truncated(WEIGHTS, 2000))
      .mockResolvedValueOnce(truncated(WEIGHTS, 2000))

    expect(await opfsCache.match(url)).toBeUndefined()
    expect(files.has(key)).toBe(false)
    expect(files.get(`${key}.part`)).toEqual(WEIGHTS.subarray(0, 2000))
  })

  it('stands aside when the file cannot be reached at all', async () => {
    const url = urlFor('missing.json')
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }))

    expect(await opfsCache.match(url)).toBeUndefined()
    // One attempt only: a 404 reads the same way however often it is asked for.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // No empty partial left behind for the next visit to trip over.
    expect([...files.keys()]).toEqual([])
  })

  it('downloads once however many callers ask at the same time', async () => {
    const url = urlFor('shared.onnx_data')
    fetchMock.mockResolvedValueOnce(complete(WEIGHTS))

    const [first, second] = await Promise.all([opfsCache.match(url), opfsCache.match(url)])

    expect(await drain(first)).toEqual(WEIGHTS)
    expect(await drain(second)).toEqual(WEIGHTS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('leaves the download to Transformers.js when the write lock is held', async () => {
    const url = urlFor('locked.onnx_data')
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('model-cache')
    const partial = (await directory.getFileHandle(`${cacheKeyFor(url)}.part`, {
      create: true,
    })) as FileSystemFileHandle & { createSyncAccessHandle: () => Promise<unknown> }
    await partial.createSyncAccessHandle()

    expect(await opfsCache.match(url)).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('opfsCache.put', () => {
  it('stores a file Transformers.js downloaded without touching a resumable partial', async () => {
    const url = urlFor('stored.json')
    const key = cacheKeyFor(url)
    files.set(`${key}.part`, WEIGHTS.subarray(0, 100))

    await opfsCache.put(url, complete(WEIGHTS))

    expect(files.get(key)).toEqual(WEIGHTS)
    expect(files.get(`${key}.part`)).toEqual(WEIGHTS.subarray(0, 100))
  })
})

describe('clearCachedFiles', () => {
  it('removes unfinished downloads too, since they hold the space back', async () => {
    const url = urlFor('discarded.onnx_data')
    const key = cacheKeyFor(url)

    fetchMock.mockResolvedValue(severed(WEIGHTS, 1200))
    expect(await opfsCache.match(url)).toBeUndefined()
    files.set('huggingface.co_some-other-model_resolve_main_model.onnx', new Uint8Array(4))

    await clearCachedFiles((name) => name.includes(cacheKeyFor('onnx-community/Model')))

    expect([...files.keys()]).toEqual(['huggingface.co_some-other-model_resolve_main_model.onnx'])
    expect(key).toContain('onnx-community_Model')
  })
})
